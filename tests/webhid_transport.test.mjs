import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_NAMES,
  COMMAND,
  STATUS,
  StadiaUsbApi,
  USB_CONFIG,
  UsbProtocolError,
  WebHidTransport,
  encodeConfig,
  parseConfig,
  parseController,
  parseDeviceInfo,
  parseInput,
  parseStatus,
} from "../main/webhid_transport.js";

function ascii(target, offset, length, value) {
  const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0));
  target.set(bytes.slice(0, length - 1), offset);
}

function u16(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function u32(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function response(sequence, command, status, payload = new Uint8Array()) {
  const report = new Uint8Array(USB_CONFIG.reportSize + 1);
  report[0] = USB_CONFIG.reportId;
  report[1] = USB_CONFIG.magic;
  report[2] = USB_CONFIG.version;
  report[3] = sequence;
  report[4] = command;
  report[5] = status;
  report[6] = payload.length;
  report.set(payload, USB_CONFIG.headerSize + 1);
  return new DataView(report.buffer);
}

function deviceInfoPayload() {
  const payload = new Uint8Array(USB_CONFIG.maxPayload);
  payload[0] = USB_CONFIG.version;
  payload[1] = 2;
  u32(payload, 2, 0x7f);
  ascii(payload, 6, 24, "v1.05-webhid");
  ascii(payload, 30, 25, "Jul 31 2026");
  return payload;
}

function statusPayload() {
  const payload = new Uint8Array(USB_CONFIG.maxPayload);
  u32(payload, 0, 123456);
  payload[4] = 6;
  u16(payload, 5, 0b00101111);
  payload[7] = 1;
  payload[8] = 2;
  payload[9] = 84;
  u16(payload, 10, 120);
  ascii(payload, 12, 18, "A4:77:58:12:34:56");
  ascii(payload, 30, 25, "Stadia Controller");
  return payload;
}

function configPayload() {
  return encodeConfig({
    assistant_short: "f14",
    assistant_long: "start_webui",
    capture_short: "printscreen",
    capture_long: "none",
    long_press_ms: 700,
    webui_timeout_seconds: 120,
    disable_ap_on_suspend: true,
    webui_auto_start_if_no_bond: true,
  });
}

function controllerPayload() {
  const payload = new Uint8Array(USB_CONFIG.maxPayload);
  payload[0] = 1;
  payload[1] = 0;
  payload[2] = 0;
  payload[3] = 0;
  payload[4] = 0b0111;
  payload[5] = 84;
  ascii(payload, 6, 18, "A4:77:58:12:34:56");
  ascii(payload, 24, 31, "Stadia Controller");
  return payload;
}

function inputPayload() {
  const payload = new Uint8Array(49);
  payload[0] = 0;
  payload[1] = 0b0011;
  u32(payload, 2, (1 << 4) | (1 << 16));
  payload[6] = 3;
  payload.set([0x01, 0xa0, 0xff], 7);
  payload[39] = 48;
  payload[40] = 196;
  u16(payload, 41, 1200);
  u16(payload, 43, 0xfcb8);
  u16(payload, 45, 160);
  u16(payload, 47, 0xfec0);
  return payload;
}

class MockDevice {
  constructor(handler) {
    this.vendorId = USB_CONFIG.vendorId;
    this.productId = USB_CONFIG.productId;
    this.collections = [
      { usagePage: USB_CONFIG.usagePage, usage: USB_CONFIG.usage },
    ];
    this.opened = false;
    this.handler = handler;
    this.responses = [];
    this.requests = [];
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async sendFeatureReport(reportId, report) {
    assert.equal(reportId, USB_CONFIG.reportId);
    const request = Uint8Array.from(report);
    this.requests.push(request);
    const payloadLength = request[4];
    const payload = request.slice(
      USB_CONFIG.headerSize,
      USB_CONFIG.headerSize + payloadLength,
    );
    const result = await this.handler(request[3], payload, request);
    this.responses.push(
      response(request[2], request[3], STATUS.pending),
      response(
        request[2],
        request[3],
        result.status ?? STATUS.ok,
        result.payload ?? new Uint8Array(),
      ),
    );
  }

  async receiveFeatureReport(reportId) {
    assert.equal(reportId, USB_CONFIG.reportId);
    return this.responses.shift();
  }
}

class MockHid {
  constructor(device, { authorized = false } = {}) {
    this.device = device;
    this.authorized = authorized;
    this.request = null;
    this.listeners = new Map();
  }

  async getDevices() {
    return this.authorized ? [this.device] : [];
  }

  async requestDevice(request) {
    this.request = request;
    this.authorized = true;
    return [this.device];
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name) {
    this.listeners.delete(name);
  }
}

function protocolHandler(command, payload) {
  if (command === COMMAND.ping) {
    return { payload: Uint8Array.of(USB_CONFIG.version) };
  }
  if (command === COMMAND.getDeviceInfo) {
    return { payload: deviceInfoPayload() };
  }
  if (command === COMMAND.getStatus) {
    return { payload: statusPayload() };
  }
  if (command === COMMAND.getConfig || command === COMMAND.setConfig) {
    return { payload: command === COMMAND.setConfig ? payload : configPayload() };
  }
  if (command === COMMAND.getControllerCount) {
    return { payload: Uint8Array.of(1) };
  }
  if (command === COMMAND.getController) {
    return { payload: controllerPayload() };
  }
  if (command === COMMAND.getInput) {
    return { payload: inputPayload() };
  }
  return { payload: new Uint8Array() };
}

test("binary payload parsers match the firmware layout", () => {
  const info = parseDeviceInfo(deviceInfoPayload());
  assert.deepEqual(info, {
    protocol_version: 1,
    controller_slots: 2,
    capabilities: 0x7f,
    firmware_version: "v1.05-webhid",
    build_date: "Jul 31 2026",
  });

  const status = parseStatus(statusPayload(), info);
  assert.equal(status.state, "connected_webui_active");
  assert.equal(status.controller_address, "A4:77:58:12:34:56");
  assert.equal(status.controller_name, "Stadia Controller");
  assert.equal(status.battery_percent, 84);
  assert.equal(status.webui_auto_off_seconds, 120);
  assert.equal(status.ble_connected, true);

  const config = parseConfig(configPayload());
  assert.equal(config.assistant_short, "f14");
  assert.equal(config.assistant_long, "start_webui");
  assert.equal(config.capture_short, "printscreen");
  assert.equal(config.long_press_ms, 700);

  const controller = parseController(controllerPayload());
  assert.equal(controller.connected, true);
  assert.equal(controller.ready, true);
  assert.equal(controller.address, "A4:77:58:12:34:56");

  const input = parseInput(inputPayload());
  assert.equal(input.pressed, "a,capture");
  assert.equal(input.raw, "01 A0 FF");
  assert.equal(input.lx, 1200);
  assert.equal(input.ly, -840);
  assert.equal(input.ry, -320);
});

test("WebHID handshake uses the vendor collection filter and pending polling", async () => {
  const device = new MockDevice(protocolHandler);
  const hid = new MockHid(device);
  const transport = new WebHidTransport({ hid, sleep: async () => {} });
  const info = await transport.connect();
  assert.equal(info.firmware_version, "v1.05-webhid");
  assert.deepEqual(hid.request.filters, [
    {
      vendorId: USB_CONFIG.vendorId,
      productId: USB_CONFIG.productId,
      usagePage: USB_CONFIG.usagePage,
      usage: USB_CONFIG.usage,
    },
  ]);
  assert.equal(device.opened, true);
  assert.equal(device.requests[0][0], USB_CONFIG.magic);
  assert.equal(device.requests[0][3], COMMAND.ping);
});

test("StadiaUsbApi maps the existing HTTP-shaped API onto USB commands", async () => {
  const device = new MockDevice(protocolHandler);
  const transport = new WebHidTransport({
    hid: new MockHid(device),
    sleep: async () => {},
  });
  const api = new StadiaUsbApi(transport);
  await api.connect();

  const status = await api.request("/api/status");
  assert.equal(status.firmware_version, "v1.05-webhid");
  assert.equal(status.usb_configured, true);

  const buttons = await api.request("/api/buttons");
  assert.equal(buttons.pressed, "a,capture");

  const controllers = await api.request("/api/controllers");
  assert.equal(controllers.controllers.length, 1);
  assert.equal(controllers.controllers[0].pressed, "a,capture");

  const saved = await api.request("/api/config/keymap", {
    method: "POST",
    body: new URLSearchParams({
      assistant_short: "f15",
      assistant_long: "start_webui",
      capture_short: "printscreen",
      capture_long: "none",
      long_press_ms: "900",
      webui_timeout_seconds: "180",
      disable_ap_on_suspend: "on",
    }),
  });
  assert.equal(saved.assistant_short, "f15");
  assert.equal(saved.long_press_ms, 900);

  const setRequest = device.requests.find(
    (request) => request[3] === COMMAND.setConfig,
  );
  assert.equal(
    setRequest[USB_CONFIG.headerSize],
    ACTION_NAMES.indexOf("f15"),
  );
});

test("protocol errors are surfaced with status and command", async () => {
  const device = new MockDevice((command) => {
    if (command === COMMAND.ping) {
      return { payload: Uint8Array.of(USB_CONFIG.version) };
    }
    if (command === COMMAND.getDeviceInfo) {
      return { payload: deviceInfoPayload() };
    }
    return { status: STATUS.invalidPayload };
  });
  const transport = new WebHidTransport({
    hid: new MockHid(device),
    sleep: async () => {},
  });
  await transport.connect();
  await assert.rejects(
    transport.command(COMMAND.getStatus),
    (error) =>
      error instanceof UsbProtocolError &&
      error.status === STATUS.invalidPayload &&
      error.command === COMMAND.getStatus,
  );
});

test("a failed handshake closes the device and removes the disconnect listener", async () => {
  const device = new MockDevice((command) => {
    if (command === COMMAND.ping) {
      return { payload: Uint8Array.of(USB_CONFIG.version + 1) };
    }
    return { payload: new Uint8Array() };
  });
  const hid = new MockHid(device);
  const transport = new WebHidTransport({
    hid,
    sleep: async () => {},
  });

  await assert.rejects(
    transport.connect(),
    /invalid protocol handshake/,
  );
  assert.equal(device.opened, false);
  assert.equal(transport.connected, false);
  assert.equal(hid.listeners.has("disconnect"), false);
});

test("controller enumeration tolerates a disconnect between count and detail", async () => {
  const device = new MockDevice((command) => {
    if (command === COMMAND.ping) {
      return { payload: Uint8Array.of(USB_CONFIG.version) };
    }
    if (command === COMMAND.getDeviceInfo) {
      return { payload: deviceInfoPayload() };
    }
    if (command === COMMAND.getControllerCount) {
      return { payload: Uint8Array.of(1) };
    }
    if (command === COMMAND.getController) {
      return { status: STATUS.notFound };
    }
    return { payload: new Uint8Array() };
  });
  const transport = new WebHidTransport({
    hid: new MockHid(device),
    sleep: async () => {},
  });
  const api = new StadiaUsbApi(transport);
  await api.connect();

  const result = await api.getControllers();
  assert.deepEqual(result, {
    mouse_mode_0: false,
    mouse_mode_1: false,
    controllers: [],
  });
});

test("disconnect notification clears the active device", async () => {
  const device = new MockDevice(protocolHandler);
  const hid = new MockHid(device);
  const transport = new WebHidTransport({ hid, sleep: async () => {} });
  await transport.connect();
  let disconnected = false;
  transport.onDisconnect(() => {
    disconnected = true;
  });
  hid.listeners.get("disconnect")({ device });
  assert.equal(disconnected, true);
  assert.equal(transport.connected, false);
});

