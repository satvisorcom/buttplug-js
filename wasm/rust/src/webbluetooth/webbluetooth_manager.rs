use super::webbluetooth_hardware::WebBluetoothHardwareConnector;

use buttplug::{
  core::ButtplugResultFuture,
  server::device::{
    configuration::ProtocolCommunicationSpecifier,
    hardware::communication::{
      HardwareCommunicationManager, HardwareCommunicationManagerBuilder,
      HardwareCommunicationManagerEvent,
    },
  },
  util::device_configuration::{load_protocol_configs, DEVICE_CONFIGURATION_JSON},
};
use futures::future;
use tokio::sync::mpsc::Sender;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::BluetoothDevice;

fn console_log(msg: &str) {
  web_sys::console::log_1(&JsValue::from_str(msg));
}

fn console_error(msg: &str) {
  web_sys::console::error_1(&JsValue::from_str(msg));
}

#[derive(Default)]
pub struct WebBluetoothCommunicationManagerBuilder {
}

impl HardwareCommunicationManagerBuilder for WebBluetoothCommunicationManagerBuilder {
  fn finish(&mut self, sender: Sender<HardwareCommunicationManagerEvent>) -> Box<dyn HardwareCommunicationManager> {
    Box::new(WebBluetoothCommunicationManager {
      sender,
    })
  }
}

pub struct WebBluetoothCommunicationManager {
  sender: Sender<HardwareCommunicationManagerEvent>,
}

impl HardwareCommunicationManager for WebBluetoothCommunicationManager {
  fn name(&self) -> &'static str {
    "WebBluetoothCommunicationManager"
  }

  fn can_scan(&self) -> bool {
    true
  }

  fn start_scanning(&mut self) -> ButtplugResultFuture {
    console_log("[bt] start_scanning called");
    let sender_clone = self.sender.clone();
    spawn_local(async move {
      let nav = web_sys::window().unwrap().navigator();
      if nav.bluetooth().is_none() {
        console_error("[bt] WebBluetooth is NOT supported on this browser");
        return;
      }
      console_log("[bt] WebBluetooth supported, building filters...");
      let config_manager = load_protocol_configs(
        &Some(DEVICE_CONFIGURATION_JSON.to_string()),
        &None,
        false,
      ).expect("Failed to load device configs").finish().expect("Failed to build DCM");
      let options = web_sys::RequestDeviceOptions::new();
      let mut filters: Vec<web_sys::BluetoothLeScanFilterInit> = Vec::new();
      let mut optional_services: Vec<js_sys::JsString> = Vec::new();
      for vals in config_manager.protocol_device_configurations().iter() {
        for config in vals.1 {
          if let ProtocolCommunicationSpecifier::BluetoothLE(btle) = &config {
            for name in btle.names() {
              let filter = web_sys::BluetoothLeScanFilterInit::new();
              if name.contains("*") {
                let mut name_clone = name.clone();
                name_clone.pop();
                filter.set_name_prefix(&name_clone);
              } else {
                filter.set_name(&name);
              }
              filters.push(filter);
            }
            for (service, _) in btle.services() {
              optional_services.push(service.to_string().into());
            }
          }
        }
      }
      console_log(&format!("[bt] Built {} filters, {} services", filters.len(), optional_services.len()));
      options.set_filters(&filters);
      options.set_optional_services(&optional_services);
      console_log("[bt] Calling requestDevice()...");
      let nav = web_sys::window().unwrap().navigator();
      match JsFuture::from(nav.bluetooth().unwrap().request_device(&options)).await {
        Ok(device) => {
          let bt_device = BluetoothDevice::from(device);
          if bt_device.name().is_none() {
            console_log("[bt] Device has no name, skipping");
            return;
          }
          let name = bt_device.name().unwrap();
          let address = bt_device.id();
          console_log(&format!("[bt] Device found: {} ({})", name, address));
          let device_creator = Box::new(WebBluetoothHardwareConnector::new(bt_device));
          if sender_clone
            .send(HardwareCommunicationManagerEvent::DeviceFound {
              name,
              address,
              creator: device_creator,
            })
            .await
            .is_err()
          {
            console_error("[bt] Device manager receiver dropped");
          } else {
            console_log("[bt] Device sent to manager");
          }
        }
        Err(e) => {
          console_error(&format!("[bt] requestDevice() error: {:?}", e));
        }
      };
      let _ = sender_clone
        .send(HardwareCommunicationManagerEvent::ScanningFinished)
        .await;
    });
    Box::pin(future::ready(Ok(())))
  }

  fn stop_scanning(&mut self) -> ButtplugResultFuture {
    Box::pin(future::ready(Ok(())))
  }
}
