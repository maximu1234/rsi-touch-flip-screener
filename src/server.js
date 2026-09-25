import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScanController } from "./scan.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC = path.join(ROOT, "public");
const PORT = Math.max(1, Number(process.env.PORT) || 3847);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const controller = new ScanController(ROOT);
await controller.load();

const sseClients = new Set();

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

controller.on((kind, state) => {
  const event = kind === "progress" ? "progress" : "state";
  const payload =
    event === "progress"
      ? {
          running: state.running,
          progress: state.progress,
          counts: state.counts,
          log: state.log.slice(-8)
        }
      : state;
  for (const res of sseClients) {
    try {
      writeSse(res, event, payload);
    } catch {
      sseClients.delete(res);
    }
  }
});

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(json);
}

function sendDownload(res, filename, contentType, body) {
  res.writeHead(200, {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store"
  });
  res.end(body);
}

const MAX_BODY_BYTES = 32 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("Слишком большой запрос");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://local").pathname);
  if (urlPath === "/") {
    urlPath = "/index.html";
  }
  const publicRoot = path.resolve(PUBLIC);
  const file = path.resolve(path.join(PUBLIC, urlPath));
  if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, controller.getState());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      writeSse(res, "state", controller.getState());
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/export.csv") {
      const name = `${controller.exportBasename()}.csv`;
      sendDownload(
        res,
        name,
        "text/csv; charset=utf-8",
        `\uFEFF${controller.toCsv()}`
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/export.json") {
      const name = `${controller.exportBasename()}.json`;
      sendDownload(
        res,
        name,
        "application/json; charset=utf-8",
        JSON.stringify(controller.toJson(), null, 2)
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      if (controller.running) {
        sendJson(res, 409, { ok: false, error: "Подбор уже идёт" });
        return;
      }
      const body = await readBody(req);
      try {
        const state = await controller.importSnapshot(body);
        sendJson(res, 200, { ok: true, ...state });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err?.message || String(err) });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/reload") {
      if (controller.running) {
        sendJson(res, 200, controller.getState());
        return;
      }
      await controller.load();
      sendJson(res, 200, controller.getState());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/refresh-symbol") {
      const body = await readBody(req);
      try {
        const state = await controller.refreshSymbol(body?.symbol);
        sendJson(res, 200, { ok: true, ...state });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err?.message || String(err) });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      const body = await readBody(req);
      if (controller.running) {
        sendJson(res, 409, { ok: false, error: "Подбор уже идёт" });
        return;
      }
      sendJson(res, 200, { ok: true });
      controller.start(body).catch((err) => {
        console.error(err);
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cycle-sl") {
      const body = await readBody(req);
      sendJson(res, 200, { ok: true });
      controller.applyCycleSl(body).catch((err) => {
        console.error(err);
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/pause") {
      controller.pause();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/stop") {
      controller.stop();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      await controller.reset();
      sendJson(res, 200, controller.getState());
      return;
    }
    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    sendJson(res, Number(err.statusCode) || 500, {
      ok: false,
      error: err?.message || String(err)
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`RSI Touch Flip Screener: http://127.0.0.1:${PORT}`);
  if (controller.canResumeInterruptedScan()) {
    console.log("Resuming interrupted scan…");
    controller.start({ ...controller.config, force: false }).catch((err) => {
      console.error(err);
    });
  }
});
