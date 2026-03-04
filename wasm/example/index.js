import { ButtplugWasmClientConnector } from "../src/index.ts";
import { ButtplugClient, DeviceOutput, OutputType, InputType } from "../../js/src/index.ts";

const logEl = document.getElementById("log");
const btnInit = document.getElementById("btn-init");
const btnScan = document.getElementById("btn-scan");
const btnGo = document.getElementById("btn-go");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const deviceListEl = document.getElementById("device-list");
const btWarning = document.getElementById("bt-warning");

function log(msg, cls = "dim") {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, state) {
  statusText.textContent = text;
  statusDot.className = `dot ${state}`;
}

// Check Web Bluetooth support upfront
function checkBluetooth() {
  if (!navigator.bluetooth) {
    btWarning.style.display = "block";
    btWarning.innerHTML = `
      <strong>Web Bluetooth not available.</strong><br>
      <br>
      <u>How to enable:</u><br>
      &bull; <strong>Chrome/Edge (Linux)</strong>: go to <code>chrome://flags/#enable-web-bluetooth</code> → Enable → Relaunch<br>
      &bull; <strong>Chrome/Edge (Windows/macOS)</strong>: should work out of the box<br>
      &bull; <strong>Firefox/Safari</strong>: not supported<br>
      &bull; <strong>CLI launch</strong>: <code>google-chrome --enable-features=WebBluetooth</code><br>
      <br>
      HTTPS or localhost is required. The device picker needs a user gesture (button click).
    `;
    log("Web Bluetooth NOT available — see info above", "err");
    return false;
  }
  log("Web Bluetooth available", "ok");
  return true;
}

let client = null;
let connector = null;
let hasBluetooth = false;

async function renderDevices() {
  if (!client || client.devices.size === 0) {
    deviceListEl.innerHTML = '<span class="no-devices">No devices connected</span>';
    btnGo.disabled = true;
    return;
  }
  deviceListEl.innerHTML = '';
  for (const [, device] of client.devices) {
    const card = document.createElement("div");
    card.className = "device-card";

    // Collect feature tags from public API
    const tags = [];
    for (const t of Object.values(OutputType)) {
      if (device.hasOutput(t)) tags.push(`<span class="device-tag output">${t}</span>`);
    }
    for (const t of Object.values(InputType)) {
      if (device.hasInput(t)) tags.push(`<span class="device-tag input">${t}</span>`);
    }

    let batteryHtml = '';
    if (device.hasInput(InputType.Battery)) {
      try {
        const level = await device.battery();
        const pct = Math.round(level * 100);
        const cls = pct <= 15 ? 'low' : pct <= 40 ? 'mid' : '';
        batteryHtml = `<span class="device-battery ${cls}">${pct}%</span>`;
      } catch (e) {
        batteryHtml = `<span class="device-battery">?%</span>`;
        log(`${device.name} battery: ${e.message || e}`, "dim");
      }
    }

    card.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:0.5rem;justify-content:space-between;">
          <span class="device-name">${device.name}</span>
          <span class="device-meta">${batteryHtml}<span>idx ${device.index}</span></span>
        </div>
        ${tags.length ? `<div class="device-tags">${tags.join('')}</div>` : ''}
        ${device.hasOutput(OutputType.Vibrate) ? `
          <div class="device-slider-row">
            <label>Power</label>
            <input type="range" min="0" max="100" value="0" data-device-idx="${device.index}">
            <span class="slider-val">0%</span>
          </div>
        ` : ''}
      </div>
    `;

    // Wire up slider with throttling (BLE GATT needs ~100ms between ops)
    const slider = card.querySelector('input[type="range"]');
    if (slider) {
      const valSpan = card.querySelector('.slider-val');
      let pending = null;
      let sending = false;
      const sendValue = async (pct) => {
        sending = true;
        try {
          if (pct === 0) {
            await device.stop();
          } else {
            await device.runOutput(DeviceOutput.Vibrate.percent(pct));
          }
        } catch (e) {
          log(`${device.name}: ${e.message || e}`, "err");
        }
        sending = false;
        // If a newer value came in while we were sending, send it now
        if (pending !== null) {
          const next = pending;
          pending = null;
          sendValue(next);
        }
      };
      slider.addEventListener('input', () => {
        const pct = parseInt(slider.value) / 100;
        valSpan.textContent = `${slider.value}%`;
        syncButtonState();
        if (sending) {
          pending = pct;
        } else {
          sendValue(pct);
        }
      });
    }

    deviceListEl.appendChild(card);
  }
  btnGo.disabled = false;
}

// 1. Init WASM
btnInit.onclick = async () => {
  try {
    setStatus("Loading WASM...", "loading");
    log("Loading WASM module...", "info");
    connector = new ButtplugWasmClientConnector();

    log("Connecting to embedded server...", "info");
    client = new ButtplugClient("WASM Test");

    client.addListener("deviceadded", (device) => {
      log(`Device found: ${device.name}`, "device");
      renderDevices();
    });

    client.addListener("deviceremoved", (device) => {
      log(`Device removed: ${device.name}`, "device");
      renderDevices();
    });

    client.addListener("scanningfinished", () => {
      log("Scan finished", "info");
      btnScan.disabled = !hasBluetooth;
    });

    client.addListener("disconnect", () => {
      log("Disconnected", "err");
      setStatus("Disconnected", "err");
    });

    await client.connect(connector);
    setStatus("Connected", "ok");
    log("Server connected!", "ok");
    btnInit.disabled = true;
    btnScan.disabled = !hasBluetooth;
  } catch (e) {
    setStatus("Init failed", "err");
    log(`Error: ${e.message}`, "err");
    console.error(e);
  }
};

// 2. Scan
btnScan.onclick = async () => {
  try {
    log("Scanning — browser device picker should appear...", "info");
    btnScan.disabled = true;
    await client.startScanning();
  } catch (e) {
    log(`Scan error: ${e.message}`, "err");
    btnScan.disabled = false;
    console.error(e);
  }
};

// Sync big button appearance from slider state
function syncButtonState() {
  const anyActive = [...document.querySelectorAll('.device-slider-row input[type="range"]')]
    .some(s => parseInt(s.value) > 0);
  if (anyActive) {
    btnGo.classList.add("active");
    btnGo.innerHTML = "STOP";
  } else {
    btnGo.classList.remove("active");
    btnGo.innerHTML = "GO";
  }
}

// 3. THE BIG RED BUTTON — acts as toggle-all
btnGo.onclick = async () => {
  if (!client) return;

  const anyActive = [...document.querySelectorAll('.device-slider-row input[type="range"]')]
    .some(s => parseInt(s.value) > 0);

  if (!anyActive) {
    // Start all at 50%
    log("Vibrating all devices at 50%!", "device");
    for (const [, device] of client.devices) {
      try {
        await device.runOutput(DeviceOutput.Vibrate.percent(0.5));
      } catch (e) {
        log(`${device.name}: ${e.message}`, "err");
      }
    }
    document.querySelectorAll('.device-slider-row input[type="range"]').forEach(s => {
      s.value = 50;
      s.nextElementSibling.textContent = '50%';
    });
  } else {
    // Stop all
    log("Stopping all devices", "info");
    try {
      await client.stopAllDevices();
    } catch (e) {
      log(`Stop error: ${e.message}`, "err");
    }
    document.querySelectorAll('.device-slider-row input[type="range"]').forEach(s => {
      s.value = 0;
      s.nextElementSibling.textContent = '0%';
    });
  }
  syncButtonState();
};

// Startup
hasBluetooth = checkBluetooth();
log("Ready — click 'Init WASM' to start", "info");
