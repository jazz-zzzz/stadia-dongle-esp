import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = Number(process.env.STADIA_USB_PREVIEW_PORT || 8767);

function send(response, content, contentType) {
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(content);
}

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (url.pathname === "/") {
      const html = await readFile(resolve(root, "main", "index.html"), "utf8");
      send(
        response,
        html.replace(
          '<script type="module">',
          '<script type="module" src="/webhid-preview-mock.js"></script><script type="module">',
        ),
        "text/html; charset=utf-8",
      );
      return;
    }
    if (url.pathname === "/webhid_transport.js") {
      send(
        response,
        await readFile(resolve(root, "main", "webhid_transport.js"), "utf8"),
        "application/javascript; charset=utf-8",
      );
      return;
    }
    if (url.pathname === "/webhid-preview-mock.js") {
      send(
        response,
        await readFile(
          resolve(root, "tools", "webhid-preview-mock.js"),
          "utf8",
        ),
        "application/javascript; charset=utf-8",
      );
      return;
    }
    response.writeHead(url.pathname === "/favicon.ico" ? 204 : 404);
    response.end();
  })
  .listen(port, host, () => {
    console.log(`Stadia USB WebHID preview: http://${host}:${port}/`);
  });

