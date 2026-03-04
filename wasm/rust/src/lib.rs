#[macro_use]
extern crate tracing;
#[macro_use]
extern crate futures;


mod webbluetooth;
use js_sys;
use tokio_stream::StreamExt;
use crate::webbluetooth::*;
use buttplug::{
  core::message::{ButtplugClientMessageV4, ButtplugServerMessageV4},
  server::ButtplugServer,
  util::async_manager, server::ButtplugServerBuilder,
  server::device::ServerDeviceManagerBuilder,
  util::device_configuration::{load_protocol_configs, DEVICE_CONFIGURATION_JSON},
};

type FFICallback = js_sys::Function;

use console_error_panic_hook;
use tracing_subscriber::{layer::SubscriberExt, Registry};
use tracing_wasm::{WASMLayer, WASMLayerConfig};
use wasm_bindgen::prelude::*;
use std::sync::Arc;
use js_sys::Uint8Array;

pub type ButtplugWASMServer = Arc<ButtplugServer>;

fn log_to_console(msg: &str) {
  web_sys::console::log_1(&JsValue::from_str(msg));
}

pub fn send_server_message(
  message: &ButtplugServerMessageV4,
  callback: &FFICallback,
) {
  // Serialize with serde_json directly — no schema validation needed for outbound
  let json_msg = serde_json::to_string(&[message]).unwrap_or_else(|e| {
    log_to_console(&format!("[buttplug-wasm] Failed to serialize response: {}", e));
    "[]".to_string()
  });
  let buf = json_msg.as_bytes();
  let this = JsValue::null();
  let uint8buf = unsafe { Uint8Array::new(&Uint8Array::view(buf)) };
  let _ = callback.call1(&this, &JsValue::from(uint8buf));
}

#[no_mangle]
#[wasm_bindgen]
pub fn buttplug_create_embedded_wasm_server(
  callback: &FFICallback,
) -> *mut ButtplugWASMServer {
  console_error_panic_hook::set_once();
  log_to_console("[buttplug-wasm] Loading device configurations...");

  let mut dcm_builder = load_protocol_configs(
    &Some(DEVICE_CONFIGURATION_JSON.to_string()),
    &None,
    false,
  ).expect("Failed to load built-in device configs");
  let dcm = dcm_builder.finish().expect("Failed to build device configuration manager");
  log_to_console("[buttplug-wasm] DCM created. Building device manager...");

  let mut dm_builder = ServerDeviceManagerBuilder::new(dcm);
  dm_builder.comm_manager(WebBluetoothCommunicationManagerBuilder::default());
  let device_manager = match dm_builder.finish() {
    Ok(dm) => dm,
    Err(e) => {
      log_to_console(&format!("[buttplug-wasm] ERROR building device manager: {:?}", e));
      panic!("Failed to build device manager: {:?}", e);
    }
  };
  log_to_console("[buttplug-wasm] Device manager built. Creating server...");

  let builder = ButtplugServerBuilder::new(device_manager);
  let server = match builder.finish() {
    Ok(s) => Arc::new(s),
    Err(e) => {
      log_to_console(&format!("[buttplug-wasm] ERROR building server: {:?}", e));
      panic!("Failed to build server: {:?}", e);
    }
  };
  log_to_console("[buttplug-wasm] Server created. Setting up event stream...");

  let event_stream = server.event_stream();
  let callback = callback.clone();
  async_manager::spawn(async move {
    pin_mut!(event_stream);
    while let Some(message) = event_stream.next().await {
      send_server_message(&message, &callback);
    }
  });
  log_to_console("[buttplug-wasm] Server ready!");

  Box::into_raw(Box::new(server))
}

#[no_mangle]
#[wasm_bindgen]
pub fn buttplug_free_embedded_wasm_server(ptr: *mut ButtplugWASMServer) {
  if !ptr.is_null() {
    unsafe {
      let _ = Box::from_raw(ptr);
    }
  }
}


#[no_mangle]
#[wasm_bindgen]
pub fn buttplug_client_send_json_message(
  server_ptr: *mut ButtplugWASMServer,
  buf: &[u8],
  callback: &FFICallback,
) {
  let server = unsafe {
    assert!(!server_ptr.is_null());
    &mut *server_ptr
  };
  let callback = callback.clone();

  // Deserialize directly with serde — bypass JSON schema validation
  let json_str = std::str::from_utf8(buf).unwrap();
  let messages: Vec<ButtplugClientMessageV4> = match serde_json::from_str(json_str) {
    Ok(msgs) => msgs,
    Err(e) => {
      log_to_console(&format!("[buttplug-wasm] Failed to deserialize: {} — input: {}", e, json_str));
      return;
    }
  };

  if messages.is_empty() {
    log_to_console("[buttplug-wasm] Empty message array received");
    return;
  }

  let client_msg = messages[0].clone();
  async_manager::spawn(async move {
    match server.parse_message(client_msg).await {
      Ok(response) => {
        send_server_message(&response, &callback);
      }
      Err(e) => {
        log_to_console(&format!("[buttplug-wasm] Server error: {:?}", e));
      }
    }
  });
}

#[no_mangle]
#[wasm_bindgen]
pub fn buttplug_activate_env_logger(_max_level: &str) {
  tracing::subscriber::set_global_default(
    Registry::default()
      .with(WASMLayer::new(WASMLayerConfig::default())),
  )
  .expect("default global");
}
