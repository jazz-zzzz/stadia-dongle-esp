import { COMMAND, STATUS, USB_CONFIG } from "./webhid_transport.js";

const put16 = (buffer, offset, value) => {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = value >>> 8;
};
const put32 = (buffer, offset, value) => {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = value >>> 8;
  buffer[offset + 2] = value >>> 16;
  buffer[offset + 3] = value >>> 24;
};
const putText = (buffer, offset, length, value) => {
  buffer.set(
    Uint8Array.from(value, (character) => character.charCodeAt(0)).slice(
      0,
      length - 1,
    ),
    offset,
  );
};

function makeResponse(sequence, command, status, payload = new Uint8Array()) {
  const report = new Uint8Array(USB_CONFIG.reportSize + 1);
  report.set(
    [
      USB_CONFIG.reportId,
      USB_CONFIG.magic,
      USB_CONFIG.version,
      sequence,
      command,
      status,
      payload.length,
    ],
    0,
  );
  report.set(payload, USB_CONFIG.headerSize + 1);
  return new DataView(report.buffer);
}

function makeInfo() {
  const payload = new Uint8Array(USB_CONFIG.maxPayload);
  payload.set([1, 2], 0);
  put32(payload, 2, 0x7f);
  putText(payload, 6, 24, "usb-preview");
  putText(payload, 30, 25, "2026-07-31");
  return payload;
}

function makeStatus(wifiActive) {
  const payload = new Uint8Array(USB_CONFIG.maxPayload);
  put32(payload, 0, 123456);
  payload[4] = 5;
  put16(payload, 5, (wifiActive ? 1 : 0) | (1 << 1) | (1 << 3));
  payload.set([1, 1, 84], 7);
  put16(payload, 10, wifiActive ? 120 : 0);
  putText(payload, 12, 18, "A4:77:58:12:34:56");
  putText(payload, 30, 25, "Stadia Controller");
  return payload;
}

function makeController() {
  const payload = new Uint8Array(USB_CONFIG.maxPayload);
  payload.set([1, 0, 0, 0, 0b0111, 84], 0);
  putText(payload, 6, 18, "A4:77:58:12:34:56");
  putText(payload, 24, 31, "Stadia Controller");
  return payload;
}

function makeInput() {
  const payload = new Uint8Array(49);
  payload.set([0, 0b0011], 0);
  put32(payload, 2, (1 << 4) | (1 << 15));
  payload[6] = 3;
  payload.set([0x01, 0x80, 0x10], 7);
  payload.set([32, 180], 39);
  put16(payload, 41, 640);
  put16(payload, 43, 0xff00);
  put16(payload, 45, 128);
  put16(payload, 47, 0xff80);
  return payload;
}

class PreviewDevice {
  constructor() {
    this.vendorId = USB_CONFIG.vendorId;
    this.productId = USB_CONFIG.productId;
    this.productName = "Stadia Dongle USB Preview";
    this.collections = [
      { usagePage: USB_CONFIG.usagePage, usage: USB_CONFIG.usage },
    ];
    this.opened = false;
    this.responses = [];
    this.wifiActive = false;
    this.config = Uint8Array.from([2, 10, 3, 0, 0xbc, 0x02, 120, 0, 3]);
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async sendFeatureReport(reportId, reportValue) {
    if (reportId !== USB_CONFIG.reportId) throw new Error("Unexpected report ID");
    const request = Uint8Array.from(reportValue);
    const [sequence, command, payloadLength] = [
      request[2],
      request[3],
      request[4],
    ];
    const requestPayload = request.slice(
      USB_CONFIG.headerSize,
      USB_CONFIG.headerSize + payloadLength,
    );
    let payload = new Uint8Array();
    let status = STATUS.ok;
    if (command === COMMAND.ping) payload = Uint8Array.of(1);
    else if (command === COMMAND.getDeviceInfo) payload = makeInfo();
    else if (command === COMMAND.getStatus) payload = makeStatus(this.wifiActive);
    else if (command === COMMAND.getConfig) payload = this.config;
    else if (command === COMMAND.setConfig) {
      this.config = Uint8Array.from(requestPayload);
      payload = this.config;
    } else if (command === COMMAND.getControllerCount) payload = Uint8Array.of(1);
    else if (command === COMMAND.getController) payload = makeController();
    else if (command === COMMAND.getInput) payload = makeInput();
    else if (command === COMMAND.startWifi) this.wifiActive = true;
    else if (command === COMMAND.stopWifi) this.wifiActive = false;
    else if (!Object.values(COMMAND).includes(command)) status = STATUS.unknownCommand;
    this.responses.push(
      makeResponse(sequence, command, STATUS.pending),
      makeResponse(sequence, command, status, payload),
    );
  }

  async receiveFeatureReport(reportId) {
    if (reportId !== USB_CONFIG.reportId) throw new Error("Unexpected report ID");
    return this.responses.shift();
  }
}

class PreviewHid extends EventTarget {
  constructor() {
    super();
    this.device = new PreviewDevice();
    this.authorized = false;
  }
  async getDevices() {
    return this.authorized ? [this.device] : [];
  }
  async requestDevice() {
    this.authorized = true;
    return [this.device];
  }
}

Object.defineProperty(navigator, "hid", {
  configurable: true,
  value: new PreviewHid(),
});

