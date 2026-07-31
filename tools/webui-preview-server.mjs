import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = Number(process.env.STADIA_PREVIEW_PORT || 8766);

let config = {
  assistant_short: "f14",
  assistant_long: "start_webui",
  capture_short: "printscreen",
  capture_long: "none",
  long_press_ms: 700,
  webui_timeout_seconds: 120,
  disable_ap_on_suspend: true,
};

const input = {
  pressed: "a,capture",
  raw: "01 00 10 00 00 00 00 00 00 00",
  raw_len: 10,
  lx: 1200,
  ly: -840,
  rx: 160,
  ry: -320,
  lt: 48,
  rt: 196,
};

function json(response, value, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function text(response, value, type = "text/plain; charset=utf-8") {
  response.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
  });
  response.end(value);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/") {
    text(
      response,
      (await readFile(resolve(root, "main", "index.html"), "utf8")).replace(
        "const isDevicePage =",
        "const isDevicePage = true ||",
      ),
      "text/html; charset=utf-8",
    );
    return;
  }
  if (
    request.method === "GET" &&
    url.pathname === "/webhid_transport.js"
  ) {
    text(
      response,
      await readFile(resolve(root, "main", "webhid_transport.js"), "utf8"),
      "application/javascript; charset=utf-8",
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    json(response, {
      firmware_version: "local-preview",
      build_date: "2026-07-31",
      state: "connected_webui_active",
      webui_active: true,
      webui_clients: 1,
      webui_auto_off_seconds: 120,
      battery_percent: 84,
      controller_address: "A4:77:58:12:34:56",
      controller_name: "Stadia Controller",
      ble_connected: true,
      usb_configured: true,
      usb_suspended: false,
      usb_remote_wakeup_enabled: true,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/buttons") {
    json(response, input);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/controllers") {
    json(response, {
      mouse_mode_0: false,
      mouse_mode_1: true,
      controllers: [
        {
          name: "Stadia Controller",
          address: "A4:77:58:12:34:56",
          connected: true,
          bonded: true,
          battery_percent: 84,
          usb_gamepad_index: 0,
          slot_index: 0,
          ready: true,
          mouse_mode: false,
          ...input,
        },
        {
          name: "Living Room Controller",
          address: "A4:77:58:65:43:21",
          connected: false,
          bonded: true,
          battery_percent: null,
          usb_gamepad_index: -1,
          slot_index: -1,
          ready: false,
          mouse_mode: false,
          pressed: "",
          raw: "",
          lx: 0,
          ly: 0,
          rx: 0,
          ry: 0,
          lt: 0,
          rt: 0,
        },
      ],
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/config/keymap") {
    json(response, config);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/config/keymap") {
    const body = new URLSearchParams(await requestBody(request));
    config = {
      assistant_short: body.get("assistant_short"),
      assistant_long: body.get("assistant_long"),
      capture_short: body.get("capture_short"),
      capture_long: body.get("capture_long"),
      long_press_ms: Number(body.get("long_press_ms")),
      webui_timeout_seconds: Number(body.get("webui_timeout_seconds")),
      disable_ap_on_suspend: body.get("disable_ap_on_suspend") === "on",
    };
    json(response, config);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/update") {
    await requestBody(request);
    text(response, "Preview upload accepted. No hardware was changed.");
    return;
  }
  if (
    request.method === "POST" &&
    [
      "/api/pairing/start",
      "/api/pairing/stop",
      "/api/controllers/forget",
      "/api/controllers/forget-all",
      "/api/webui/disable",
      "/api/reboot",
    ].includes(url.pathname)
  ) {
    await requestBody(request);
    json(response, { ok: true });
    return;
  }
  json(response, { error: "Not found" }, 404);
});

server.listen(port, host, () => {
  console.log(`Stadia WebUI preview: http://${host}:${port}/`);
});

