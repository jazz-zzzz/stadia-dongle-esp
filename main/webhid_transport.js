export const USB_CONFIG = Object.freeze({
  vendorId: 0x045e,
  productId: 0x0289,
  usagePage: 0xff00,
  usage: 0x01,
  reportId: 0x10,
  reportSize: 63,
  headerSize: 8,
  maxPayload: 55,
  magic: 0x53,
  version: 1,
});

export const COMMAND = Object.freeze({
  ping: 0x01,
  getDeviceInfo: 0x02,
  getStatus: 0x03,
  getConfig: 0x04,
  setConfig: 0x05,
  getControllerCount: 0x06,
  getController: 0x07,
  getInput: 0x08,
  startPairing: 0x10,
  stopPairing: 0x11,
  forgetController: 0x12,
  forgetAll: 0x13,
  startWifi: 0x14,
  stopWifi: 0x15,
  reboot: 0x16,
});

export const STATUS = Object.freeze({
  ok: 0,
  pending: 1,
  badMagic: 2,
  unsupportedVersion: 3,
  unknownCommand: 4,
  invalidPayload: 5,
  internalError: 6,
  busy: 7,
  notFound: 8,
  unsupported: 9,
  notReady: 10,
});

export const CAPABILITY = Object.freeze({
  keymap: 1 << 0,
  controllers: 1 << 1,
  liveInput: 1 << 2,
  pairing: 1 << 3,
  forget: 1 << 4,
  wifiControl: 1 << 5,
  reboot: 1 << 6,
  bleReadiness: 1 << 7,
});

export const ACTION_NAMES = Object.freeze([
  "none",
  "f13",
  "f14",
  "printscreen",
  "escape",
  "space",
  "enter",
  "volume_up",
  "volume_down",
  "play_pause",
  "start_webui",
  "remote_wake_only",
  "f15",
  "f16",
  "f17",
  "f18",
  "f19",
  "f20",
  "f21",
  "f22",
  "f23",
  "f24",
  "tab",
  "backspace",
  "insert",
  "delete",
  "home",
  "end",
  "page_up",
  "page_down",
  "arrow_up",
  "arrow_down",
  "arrow_left",
  "arrow_right",
  "mute",
  "next_track",
  "prev_track",
]);

const STATE_NAMES = Object.freeze([
  "booting",
  "no_bond_setup",
  "scanning",
  "pairing",
  "connecting",
  "connected",
  "connected_webui_active",
  "disconnected",
  "ota_update",
  "error",
]);

const BUTTON_NAMES = Object.freeze([
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "ls",
  "rs",
  "menu",
  "options",
  "stadia",
  "assistant",
  "capture",
]);

const STATUS_MESSAGES = Object.freeze({
  [STATUS.badMagic]: "接收器拒绝了请求头。",
  [STATUS.unsupportedVersion]: "接收器使用了不兼容的 USB 配置协议。",
  [STATUS.unknownCommand]: "当前固件不支持这个命令。",
  [STATUS.invalidPayload]: "接收器拒绝了命令数据。",
  [STATUS.internalError]: "接收器无法完成此操作。",
  [STATUS.busy]: "接收器正忙，请稍后重试。",
  [STATUS.notFound]: "没有找到指定的手柄。",
  [STATUS.unsupported]: "此操作暂不支持通过 USB 完成。",
  [STATUS.notReady]: "蓝牙仍在启动，请稍后重试。",
});

function sleepDefault(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function uint8View(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof DataView) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

function normalizeFeatureReport(value) {
  let bytes = uint8View(value);
  if (
    bytes.length === USB_CONFIG.reportSize + 1 &&
    bytes[0] === USB_CONFIG.reportId
  ) {
    bytes = bytes.subarray(1);
  }
  return bytes;
}

function readAscii(bytes, offset, length) {
  const end = Math.min(bytes.length, offset + length);
  let value = "";
  for (let index = offset; index < end && bytes[index] !== 0; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function writeU16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readI16(bytes, offset) {
  const value = readU16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readU32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function encodeAscii(value) {
  return Uint8Array.from(String(value), (character) => character.charCodeAt(0));
}

function actionCode(name) {
  const code = ACTION_NAMES.indexOf(name);
  if (code < 0) throw new Error(`未知的按键动作：${name}`);
  return code;
}

export class UsbProtocolError extends Error {
  constructor(message, status, command) {
    super(message);
    this.name = "UsbProtocolError";
    this.status = status;
    this.command = command;
  }
}

export class WebHidTransport {
  constructor({
    hid = globalThis.navigator?.hid,
    locks =
      typeof globalThis.window === "undefined"
        ? undefined
        : globalThis.navigator?.locks,
    sleep = sleepDefault,
    responseTimeoutMs = 2500,
    pollIntervalMs = 25,
  } = {}) {
    this.hid = hid;
    this.locks = locks;
    this.sleep = sleep;
    this.responseTimeoutMs = responseTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.device = null;
    this.deviceInfo = null;
    this.lockRelease = null;
    this.lockCompletion = null;
    this.sequence = 0;
    this.commandTail = Promise.resolve();
    this.disconnectListeners = new Set();
    this.handleDisconnect = (event) => {
      if (event.device !== this.device) return;
      this.device = null;
      this.deviceInfo = null;
      for (const listener of this.disconnectListeners) listener();
      void this.releaseSessionLock();
    };
  }

  static isSupported(hid = globalThis.navigator?.hid) {
    return Boolean(hid?.requestDevice && hid?.getDevices);
  }

  get connected() {
    return Boolean(this.device?.opened);
  }

  onDisconnect(listener) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async acquireSessionLock() {
    if (this.lockRelease || !this.locks?.request) return;

    let resolveAcquired;
    const acquired = new Promise((resolve) => {
      resolveAcquired = resolve;
    });
    let releaseHold;
    const hold = new Promise((resolve) => {
      releaseHold = resolve;
    });

    const request = this.locks.request(
      "stadia-dongle-webhid-session",
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolveAcquired({ acquired: false });
          return;
        }
        this.lockRelease = releaseHold;
        resolveAcquired({ acquired: true });
        await hold;
      },
    );
    this.lockCompletion = Promise.resolve(request).catch((error) => {
      resolveAcquired({ acquired: false, error });
    });

    const result = await acquired;
    if (!result.acquired) {
      this.lockCompletion = null;
      throw new Error(
        result.error?.message ||
          "另一个 Stadia 接收器配置页面已连接到设备。",
      );
    }
  }

  async releaseSessionLock() {
    const release = this.lockRelease;
    const completion = this.lockCompletion;
    this.lockRelease = null;
    this.lockCompletion = null;
    release?.();
    await completion?.catch(() => {});
  }
  async connect({ prompt = true } = {}) {
    if (!WebHidTransport.isSupported(this.hid)) {
      throw new Error("当前浏览器不支持 WebHID，请使用 Chrome 或 Edge。");
    }
    await this.acquireSessionLock();
    let device;
    try {
      let devices = await this.hid.getDevices();
      device = devices.find((candidate) => this.matches(candidate));
      if (!device && prompt) {
        devices = await this.hid.requestDevice({
          filters: [
            {
              vendorId: USB_CONFIG.vendorId,
              productId: USB_CONFIG.productId,
              usagePage: USB_CONFIG.usagePage,
              usage: USB_CONFIG.usage,
            },
          ],
        });
        device = devices.find((candidate) => this.matches(candidate));
      }
      if (!device) throw new Error("未选择 Stadia 接收器。");
      if (this.device && this.device !== device && this.device.opened) {
        await this.device.close();
      }
      this.device = device;
    } catch (error) {
      await this.releaseSessionLock();
      throw error;
    }

    try {
      if (!this.device.opened) await this.device.open();
      this.hid.addEventListener?.("disconnect", this.handleDisconnect);
      const ping = await this.command(COMMAND.ping);
      if (ping.length !== 1 || ping[0] !== USB_CONFIG.version) {
        throw new Error("接收器返回了无效的协议握手。");
      }
      this.deviceInfo = parseDeviceInfo(
        await this.command(COMMAND.getDeviceInfo),
      );
      return this.deviceInfo;
    } catch (error) {
      this.hid.removeEventListener?.("disconnect", this.handleDisconnect);
      this.device = null;
      this.deviceInfo = null;
      if (device.opened) {
        try {
          await device.close();
        } catch {
          // Preserve the handshake error; a close failure is secondary.
        }
      }
      await this.releaseSessionLock();
      throw error;
    }
  }

  async disconnect() {
    const device = this.device;
    this.device = null;
    this.deviceInfo = null;
    this.hid?.removeEventListener?.("disconnect", this.handleDisconnect);
    try {
      if (device?.opened) await device.close();
    } finally {
      await this.releaseSessionLock();
    }
  }

  matches(device) {
    if (
      device.vendorId !== USB_CONFIG.vendorId ||
      device.productId !== USB_CONFIG.productId
    ) {
      return false;
    }
    if (!Array.isArray(device.collections) || device.collections.length === 0) {
      return true;
    }
    return device.collections.some(
      (collection) =>
        collection.usagePage === USB_CONFIG.usagePage &&
        collection.usage === USB_CONFIG.usage,
    );
  }

  command(command, payload = new Uint8Array()) {
    const run = () => this.executeCommand(command, payload);
    const result = this.commandTail.then(run, run);
    this.commandTail = result.catch(() => {});
    return result;
  }

  async executeCommand(command, payloadValue) {
    if (!this.device?.opened) throw new Error("USB 接收器未连接。");
    const payload = uint8View(payloadValue);
    if (payload.length > USB_CONFIG.maxPayload) {
      throw new Error(`USB 命令数据超过 ${USB_CONFIG.maxPayload} 字节。`);
    }

    this.sequence = (this.sequence % 255) + 1;
    const sequence = this.sequence;
    const request = new Uint8Array(USB_CONFIG.reportSize);
    request[0] = USB_CONFIG.magic;
    request[1] = USB_CONFIG.version;
    request[2] = sequence;
    request[3] = command;
    request[4] = payload.length;
    request.set(payload, USB_CONFIG.headerSize);
    await this.device.sendFeatureReport(USB_CONFIG.reportId, request);

    const deadline = Date.now() + this.responseTimeoutMs;
    while (Date.now() < deadline) {
      const report = normalizeFeatureReport(
        await this.device.receiveFeatureReport(USB_CONFIG.reportId),
      );
      if (report.length < USB_CONFIG.headerSize) {
        throw new Error("接收器返回了不完整的 USB 报告。");
      }
      if (
        report[0] !== USB_CONFIG.magic ||
        report[1] !== USB_CONFIG.version
      ) {
        throw new Error("接收器返回了无效的 USB 报告。");
      }
      if (report[2] !== sequence || report[3] !== command) {
        await this.sleep(this.pollIntervalMs);
        continue;
      }
      if (report[4] === STATUS.pending) {
        await this.sleep(this.pollIntervalMs);
        continue;
      }
      if (report[4] !== STATUS.ok) {
        throw new UsbProtocolError(
          STATUS_MESSAGES[report[4]] ?? `USB 命令失败（${report[4]}）。`,
          report[4],
          command,
        );
      }
      const payloadLength = report[5];
      if (
        payloadLength > USB_CONFIG.maxPayload ||
        USB_CONFIG.headerSize + payloadLength > report.length
      ) {
        throw new Error("接收器返回了无效的数据长度。");
      }
      return report.slice(
        USB_CONFIG.headerSize,
        USB_CONFIG.headerSize + payloadLength,
      );
    }
    throw new Error("等待接收器响应超时。");
  }
}

export function parseDeviceInfo(payloadValue) {
  const payload = uint8View(payloadValue);
  if (payload.length !== USB_CONFIG.maxPayload) {
    throw new Error("设备信息数据无效。");
  }
  return {
    protocol_version: payload[0],
    controller_slots: payload[1],
    capabilities: readU32(payload, 2),
    firmware_version: readAscii(payload, 6, 24),
    build_date: readAscii(payload, 30, 25),
  };
}

export function parseStatus(payloadValue, deviceInfo = {}) {
  const payload = uint8View(payloadValue);
  if (payload.length !== USB_CONFIG.maxPayload) {
    throw new Error("状态数据无效。");
  }
  const flags = readU16(payload, 5);
  const battery = payload[9];
  return {
    firmware_version: deviceInfo.firmware_version ?? "",
    build_date: deviceInfo.build_date ?? "",
    uptime_ms: readU32(payload, 0),
    state: STATE_NAMES[payload[4]] ?? "error",
    webui_active: Boolean(flags & (1 << 0)),
    webui_auto_off_seconds: readU16(payload, 10),
    webui_clients: 0,
    ble_ready:
      !(deviceInfo.capabilities & CAPABILITY.bleReadiness) ||
      Boolean(flags & (1 << 7)),
    ble_connected: Boolean(flags & (1 << 1)),
    connected_count: payload[7],
    controller_slots: deviceInfo.controller_slots ?? 2,
    pairing_mode: Boolean(flags & (1 << 2)),
    controller_name: readAscii(payload, 30, 25),
    controller_address: readAscii(payload, 12, 18),
    battery_percent: battery === 255 ? null : battery,
    usb_configured: Boolean(flags & (1 << 3)),
    usb_suspended: Boolean(flags & (1 << 4)),
    usb_remote_wakeup_enabled: Boolean(flags & (1 << 5)),
    last_wake_attempt_allowed: Boolean(flags & (1 << 6)),
    last_error: "",
  };
}

export function parseConfig(payloadValue) {
  const payload = uint8View(payloadValue);
  if (payload.length !== 9) throw new Error("配置数据无效。");
  return {
    assistant_short: ACTION_NAMES[payload[0]] ?? "none",
    assistant_long: ACTION_NAMES[payload[1]] ?? "none",
    capture_short: ACTION_NAMES[payload[2]] ?? "none",
    capture_long: ACTION_NAMES[payload[3]] ?? "none",
    long_press_ms: readU16(payload, 4),
    webui_timeout_seconds: readU16(payload, 6),
    disable_ap_on_suspend: Boolean(payload[8] & (1 << 0)),
    webui_auto_start_if_no_bond: Boolean(payload[8] & (1 << 1)),
  };
}

export function encodeConfig(config) {
  const payload = new Uint8Array(9);
  payload[0] = actionCode(config.assistant_short);
  payload[1] = actionCode(config.assistant_long);
  payload[2] = actionCode(config.capture_short);
  payload[3] = actionCode(config.capture_long);
  writeU16(payload, 4, Number(config.long_press_ms));
  writeU16(payload, 6, Number(config.webui_timeout_seconds));
  payload[8] =
    (config.disable_ap_on_suspend ? 1 << 0 : 0) |
    (config.webui_auto_start_if_no_bond !== false ? 1 << 1 : 0);
  return payload;
}

export function parseController(payloadValue) {
  const payload = uint8View(payloadValue);
  if (payload.length !== USB_CONFIG.maxPayload) {
    throw new Error("手柄数据无效。");
  }
  const flags = payload[4];
  return {
    total: payload[0],
    index: payload[1],
    slot_index: payload[2] === 255 ? -1 : payload[2],
    usb_gamepad_index: payload[3] === 255 ? -1 : payload[3],
    bonded: Boolean(flags & (1 << 0)),
    connected: Boolean(flags & (1 << 1)),
    ready: Boolean(flags & (1 << 2)),
    mouse_mode: Boolean(flags & (1 << 3)),
    battery_percent: payload[5] === 255 ? null : payload[5],
    address: readAscii(payload, 6, 18),
    name: readAscii(payload, 24, 31),
  };
}

export function parseInput(payloadValue) {
  const payload = uint8View(payloadValue);
  if (payload.length !== 49) throw new Error("输入数据无效。");
  const pressedMask = readU32(payload, 2);
  const pressed = BUTTON_NAMES.filter(
    (_name, index) => pressedMask & (1 << index),
  );
  const rawLength = Math.min(payload[6], 32);
  const raw = Array.from(payload.slice(7, 7 + rawLength))
    .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  return {
    slot_index: payload[0] === 255 ? -1 : payload[0],
    connected: Boolean(payload[1] & (1 << 0)),
    ready: Boolean(payload[1] & (1 << 1)),
    mouse_mode: Boolean(payload[1] & (1 << 2)),
    pressed: pressed.join(","),
    raw,
    raw_len: rawLength,
    lt: payload[39],
    rt: payload[40],
    lx: readI16(payload, 41),
    ly: readI16(payload, 43),
    rx: readI16(payload, 45),
    ry: readI16(payload, 47),
    assistant_known: true,
    capture_known: true,
  };
}

export class StadiaUsbApi {
  constructor(transport = new WebHidTransport()) {
    this.transport = transport;
  }

  get connected() {
    return this.transport.connected;
  }

  get deviceInfo() {
    return this.transport.deviceInfo;
  }

  connect(options) {
    return this.transport.connect(options);
  }

  disconnect() {
    return this.transport.disconnect();
  }

  onDisconnect(listener) {
    return this.transport.onDisconnect(listener);
  }

  async request(path, options = {}) {
    const method = String(options.method ?? "GET").toUpperCase();
    if (method === "GET" && path === "/api/status") {
      return parseStatus(
        await this.transport.command(COMMAND.getStatus),
        this.transport.deviceInfo,
      );
    }
    if (method === "GET" && path === "/api/buttons") {
      return parseInput(
        await this.transport.command(COMMAND.getInput, Uint8Array.of(255)),
      );
    }
    if (method === "GET" && path === "/api/controllers") {
      return this.getControllers();
    }
    if (method === "GET" && path === "/api/config/keymap") {
      return parseConfig(await this.transport.command(COMMAND.getConfig));
    }
    if (method === "POST" && path === "/api/config/keymap") {
      const body = new URLSearchParams(options.body);
      const current = parseConfig(
        await this.transport.command(COMMAND.getConfig),
      );
      const config = {
        assistant_short: body.get("assistant_short"),
        assistant_long: body.get("assistant_long"),
        capture_short: body.get("capture_short"),
        capture_long: body.get("capture_long"),
        long_press_ms: Number(body.get("long_press_ms")),
        webui_timeout_seconds: Number(body.get("webui_timeout_seconds")),
        disable_ap_on_suspend: body.get("disable_ap_on_suspend") === "on",
        webui_auto_start_if_no_bond: current.webui_auto_start_if_no_bond,
      };
      return parseConfig(
        await this.transport.command(COMMAND.setConfig, encodeConfig(config)),
      );
    }
    if (method === "POST" && path === "/api/pairing/start") {
      await this.transport.command(COMMAND.startPairing);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/pairing/stop") {
      await this.transport.command(COMMAND.stopPairing);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/controllers/forget") {
      const address = new URLSearchParams(options.body).get("address") ?? "";
      const encoded = encodeAscii(address);
      if (encoded.length !== 17) throw new Error("手柄地址无效。");
      await this.transport.command(COMMAND.forgetController, encoded);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/controllers/forget-all") {
      await this.transport.command(COMMAND.forgetAll);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/webui/enable") {
      await this.transport.command(COMMAND.startWifi);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/webui/disable") {
      await this.transport.command(COMMAND.stopWifi);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/reboot") {
      await this.transport.command(COMMAND.reboot);
      return { ok: true };
    }
    if (method === "POST" && path === "/api/update") {
      throw new UsbProtocolError(
        "USB 暂不支持上传固件，请使用 Wi-Fi OTA。",
        STATUS.unsupported,
        0,
      );
    }
    throw new Error(`不支持的 USB API 请求：${method} ${path}`);
  }

  async getControllers() {
    const countPayload = await this.transport.command(
      COMMAND.getControllerCount,
    );
    if (countPayload.length !== 1) {
      throw new Error("手柄数量数据无效。");
    }
    const controllers = [];
    for (let index = 0; index < countPayload[0]; index += 1) {
      let controller;
      try {
        controller = parseController(
          await this.transport.command(
            COMMAND.getController,
            Uint8Array.of(index),
          ),
        );
      } catch (error) {
        if (
          error instanceof UsbProtocolError &&
          error.status === STATUS.notFound
        ) {
          continue;
        }
        throw error;
      }
      if (controller.slot_index >= 0) {
        try {
          Object.assign(
            controller,
            parseInput(
              await this.transport.command(
                COMMAND.getInput,
                Uint8Array.of(controller.slot_index),
              ),
            ),
          );
        } catch (error) {
          if (!(error instanceof UsbProtocolError) || error.status !== STATUS.notFound) {
            throw error;
          }
        }
      }
      controller.pressed ??= "";
      controller.raw ??= "";
      controller.raw_len ??= 0;
      controller.lt ??= 0;
      controller.rt ??= 0;
      controller.lx ??= 0;
      controller.ly ??= 0;
      controller.rx ??= 0;
      controller.ry ??= 0;
      controllers.push(controller);
    }
    return {
      mouse_mode_0: controllers.some(
        (controller) =>
          controller.usb_gamepad_index === 0 && controller.mouse_mode,
      ),
      mouse_mode_1: controllers.some(
        (controller) =>
          controller.usb_gamepad_index === 1 && controller.mouse_mode,
      ),
      controllers,
    };
  }
}

