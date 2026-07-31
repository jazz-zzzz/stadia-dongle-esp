import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ACTION_NAMES, CAPABILITY, COMMAND, STATUS, USB_CONFIG } from "../main/webhid_transport.js";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("JavaScript command values match the firmware protocol header", async () => {
  const header = await source("../main/usb_config_protocol.h");
  const expected = {
    USB_CONFIG_CMD_PING: COMMAND.ping,
    USB_CONFIG_CMD_GET_DEVICE_INFO: COMMAND.getDeviceInfo,
    USB_CONFIG_CMD_GET_STATUS: COMMAND.getStatus,
    USB_CONFIG_CMD_GET_CONFIG: COMMAND.getConfig,
    USB_CONFIG_CMD_SET_CONFIG: COMMAND.setConfig,
    USB_CONFIG_CMD_GET_CONTROLLER_COUNT: COMMAND.getControllerCount,
    USB_CONFIG_CMD_GET_CONTROLLER: COMMAND.getController,
    USB_CONFIG_CMD_GET_INPUT: COMMAND.getInput,
    USB_CONFIG_CMD_START_PAIRING: COMMAND.startPairing,
    USB_CONFIG_CMD_STOP_PAIRING: COMMAND.stopPairing,
    USB_CONFIG_CMD_FORGET_CONTROLLER: COMMAND.forgetController,
    USB_CONFIG_CMD_FORGET_ALL: COMMAND.forgetAll,
    USB_CONFIG_CMD_START_WIFI: COMMAND.startWifi,
    USB_CONFIG_CMD_STOP_WIFI: COMMAND.stopWifi,
    USB_CONFIG_CMD_REBOOT: COMMAND.reboot,
  };
  for (const [name, value] of Object.entries(expected)) {
    const match = header.match(new RegExp(`${name}\\s*=\\s*(0x[0-9a-f]+|\\d+)`, "i"));
    assert.ok(match, `${name} is declared`);
    assert.equal(Number(match[1]), value, `${name} matches JavaScript`);
  }
  const notReady = header.match(/USB_CONFIG_STATUS_NOT_READY\s*=\s*(\d+)/);
  assert.ok(notReady, "USB_CONFIG_STATUS_NOT_READY is declared");
  assert.equal(
    Number(notReady[1]),
    STATUS.notReady,
    "NOT_READY matches JavaScript",
  );
  const capabilities = {
    USB_CONFIG_CAP_KEYMAP: CAPABILITY.keymap,
    USB_CONFIG_CAP_CONTROLLERS: CAPABILITY.controllers,
    USB_CONFIG_CAP_LIVE_INPUT: CAPABILITY.liveInput,
    USB_CONFIG_CAP_PAIRING: CAPABILITY.pairing,
    USB_CONFIG_CAP_FORGET: CAPABILITY.forget,
    USB_CONFIG_CAP_WIFI_CONTROL: CAPABILITY.wifiControl,
    USB_CONFIG_CAP_REBOOT: CAPABILITY.reboot,
    USB_CONFIG_CAP_BLE_READINESS: CAPABILITY.bleReadiness,
  };
  for (const [name, value] of Object.entries(capabilities)) {
    const match = header.match(
      new RegExp(`${name}\\s*=\\s*1u\\s*<<\\s*(\\d+)`),
    );
    assert.ok(match, `${name} is declared`);
    assert.equal(
      1 << Number(match[1]),
      value,
      `${name} matches JavaScript`,
    );
  }
});

test("action names stay in the same enum order as config_store", async () => {
  const store = await source("../main/config_store.c");
  const cases = [...store.matchAll(/case\s+DONGLE_ACTION_[A-Z0-9_]+:\s+return\s+"([^"]+)"/g)];
  assert.deepEqual(
    cases.map((match) => match[1]),
    ACTION_NAMES,
  );
});

test("utility HID descriptor advertises one 63-byte vendor feature report", async () => {
  const hidSource = await source("../main/hid_extra.c");
  const header = await source("../main/hid_extra.h");
  const descriptorMatch = hidSource.match(
    /s_hid_report_desc\[HID_EXTRA_REPORT_DESC_LEN\]\s*=\s*\{([\s\S]*?)\};/,
  );
  assert.ok(descriptorMatch, "HID report descriptor is present");
  const constants = new Map([
    ["RID_KEYBOARD", 1],
    ["RID_CONSUMER", 2],
    ["USB_CONFIG_REPORT_ID", USB_CONFIG.reportId],
    ["USB_CONFIG_REPORT_DATA_SIZE", USB_CONFIG.reportSize],
  ]);
  const bytes = descriptorMatch[1]
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => constants.get(token) ?? Number(token));
  assert.ok(bytes.every(Number.isFinite), "descriptor contains parseable bytes");
  const declaredLength = Number(
    header.match(/HID_EXTRA_REPORT_DESC_LEN\s+(\d+)/)[1],
  );
  assert.equal(bytes.length, declaredLength);
  assert.deepEqual(bytes.slice(-21), [
    0x06,
    0x00,
    0xff,
    0x09,
    0x01,
    0xa1,
    0x01,
    0x85,
    USB_CONFIG.reportId,
    0x15,
    0x00,
    0x26,
    0xff,
    0x00,
    0x75,
    0x08,
    0x95,
    USB_CONFIG.reportSize,
    0xb1,
    0x02,
    0xc0,
  ]);
});

test("localhost remains available for an offline USB configuration page", async () => {
  const index = await source("../main/index.html");
  assert.match(index, /new Set\(\["localhost", "127\.0\.0\.1", "::1"\]\)/);
  assert.match(index, /async function detectDevicePage\(\)/);
  assert.match(index, /fetch\("\/api\/status"/);
  assert.match(index, /__STADIA_DEVICE_PAGE__/);
  assert.doesNotMatch(index, /location\.hostname === "192\.168\.4\.1"/);
});

test("controller polling preserves interactive nodes and gates capabilities", async () => {
  const index = await source("../main/index.html");
  assert.match(index, /function createControllerElement\(key\)/);
  assert.match(index, /host\.insertBefore\(row/);
  assert.doesNotMatch(index, /host\.appendChild\(row\)/);
  assert.match(index, /data-capability="forget"/);
  assert.match(index, /controllerPollDue/);
  assert.match(index, /min-height:44px/);
  assert.doesNotMatch(index, /\$\("controllers"\)\.innerHTML\s*=\s*list\.map/);
});

test("firmware defers Bluetooth commands until the controller manager is ready", async () => {
  const protocol = await source("../main/usb_config_protocol.c");
  const server = await source("../main/web_server.c");
  assert.match(protocol, /command_needs_controller_manager/);
  assert.match(protocol, /USB_CONFIG_STATUS_NOT_READY/);
  assert.match(server, /void web_server_request_stop\(void\)/);
  assert.match(server, /controller_manager_not_ready/);
  assert.match(protocol, /web_server_request_stop\(\)/);
});
