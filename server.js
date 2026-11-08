// Personal Hub (web) — tiny local server, no dependencies.
// Serves public/ and stores everything in one file, data/hub.json (format: docs/DATA.md).
//
//   node server.js            → http://localhost:4400
//
// On first run data/hub.json starts empty, or as a copy of HUB_SEED if that is set (the original is never written).
// Every save keeps a dated copy in data/backups/ (one per day, last 30 kept).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { startNudges } from "./nudges.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4400;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA = process.env.HUB_DATA ? path.resolve(process.env.HUB_DATA) : path.join(DATA_DIR, "hub.json");   // HUB_DATA = test against a copy
const BACKUPS = process.env.HUB_DATA ? path.join(path.dirname(DATA), "backups") : path.join(DATA_DIR, "backups");
const SEED = process.env.HUB_SEED ? path.resolve(process.env.HUB_SEED) : "";   // HUB_SEED = start a new hub from a copy of an existing hub.json
const GALLERY = path.join(ROOT, "images");
const IMG = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
// Atmospheres: app/atmospheres/<aesthetic>/<sub-mood>/... images and videos (ATMOSPHERES = test folder)
const ATMO = process.env.ATMOSPHERES ? path.resolve(process.env.ATMOSPHERES) : path.join(ROOT, "atmospheres");
const VIDEO = new Set([".mp4", ".webm", ".m4v", ".mov"]);

fs.mkdirSync(BACKUPS, { recursive: true });
if (!fs.existsSync(DATA)) {
  if (SEED && fs.existsSync(SEED)) {
    fs.copyFileSync(SEED, DATA);
    console.log(`Started from a copy of ${SEED} (the original is untouched).`);
  } else {
    fs.writeFileSync(DATA, "{}");
  }
}

function save(body) {
  const parsed = JSON.parse(body); // refuse anything that isn't valid JSON
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error("bad shape");
  const day = new Date().toISOString().slice(0, 10);
  const backup = path.join(BACKUPS, `hub-${day}.json`);
  if (!fs.existsSync(backup)) fs.copyFileSync(DATA, backup);
  const old = fs.readdirSync(BACKUPS).sort();
  old.slice(0, Math.max(0, old.length - 30)).forEach((f) => fs.unlinkSync(path.join(BACKUPS, f)));
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2));
  fs.renameSync(tmp, DATA); // atomic: a crash mid-write can't corrupt hub.json
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".avif": "image/avif",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };

/** Folder tree for Atmospheres: { name, path, files: [{ file, url, kind }], children: [...] } */
function atmoTree(dir, rel = "", depth = 0) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));
  return {
    name: rel ? path.basename(dir) : "Atmospheres", path: rel,
    files: entries.filter((e) => e.isFile() && (IMG.has(path.extname(e.name).toLowerCase()) || VIDEO.has(path.extname(e.name).toLowerCase())))
      .map((e) => ({ file: e.name, kind: VIDEO.has(path.extname(e.name).toLowerCase()) ? "video" : "image",
        url: "/atmo/" + [...rel.split("/").filter(Boolean), e.name].map(encodeURIComponent).join("/") })),
    children: depth < 3 ? entries.filter((e) => e.isDirectory()).map((e) => atmoTree(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1)) : [],
  };
}

/** Send a big JSON file gzipped (several MB → a few hundred KB), and 304 when the browser already has this version. */
const gzCache = new Map();
function sendJSON(req, res, file, headers = {}) {
  const st = fs.statSync(file), etag = `"${Math.round(st.mtimeMs)}-${st.size}"`;
  if (req.headers["if-none-match"] === etag) return res.writeHead(304, { ETag: etag, ...headers }).end();
  let c = gzCache.get(file);
  if (!c || c.etag !== etag) gzCache.set(file, (c = { etag, gz: zlib.gzipSync(fs.readFileSync(file), { level: 6 }) }));
  const gzip = /gzip/.test(req.headers["accept-encoding"] || "");
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache", ETag: etag, Vary: "Accept-Encoding", ...(gzip ? { "Content-Encoding": "gzip" } : {}), ...headers });
  return gzip ? res.end(c.gz) : fs.createReadStream(file).pipe(res);
}

/** Send a file, honoring Range requests (videos need them to seek and loop smoothly). */
function sendFile(req, res, file, cache = "max-age=3600") {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404).end("not found");
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (m) {
      const start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) return res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": cache });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": cache });
    fs.createReadStream(file).pipe(res);
  });
}

// Revision of hub.json = its modified time. A page sends back the revision it loaded; if the file
// changed since (edited by hand, by Claude, or saved from another tab) the save is refused, so a stale
// page can never overwrite newer data — it reloads instead.
const rev = () => String(Math.round(fs.statSync(DATA).mtimeMs));

// "go outside" notifications: Windows only, and off when testing against a copy of the data
const nudges = process.platform !== "win32" || process.env.HUB_DATA || process.env.NUDGES === "off" ? null
  : startNudges(() => { try { return JSON.parse(fs.readFileSync(DATA, "utf8")).nudges; } catch { return undefined; } });

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/data" && req.method === "GET") {
    return sendJSON(req, res, DATA, { "Cache-Control": "no-store", "X-Rev": rev() });
  }
  if (url.pathname === "/api/data" && req.method === "PUT") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-rev"] !== rev()) return res.writeHead(409, { "X-Rev": rev() }).end("hub.json changed since this page loaded");
      try { save(body); res.writeHead(204, { "X-Rev": rev() }).end(); }
      catch (e) { res.writeHead(400).end(String(e.message)); }
    });
    return;
  }
  if (url.pathname.startsWith("/api/nudge")) {
    const json = (v) => res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(v));
    if (!nudges) return json({ off: true });
    if (url.pathname === "/api/nudge" && req.method === "GET") return json(nudges.status());
    const kind = url.searchParams.get("kind") || "outside";
    if (url.pathname === "/api/nudge/test" && req.method === "POST") return nudges.test(kind).then((result) => json({ result }));
    if (url.pathname === "/api/nudge/done" && req.method === "POST") { nudges.done(kind); return json(nudges.status()); }
    return res.writeHead(404).end();
  }
  // art gallery: every subfolder of images/ is an artist, every picture in it a work
  if (url.pathname === "/api/gallery") {
    const artists = fs.existsSync(GALLERY) ? fs.readdirSync(GALLERY, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({
      artist: d.name,
      works: fs.readdirSync(path.join(GALLERY, d.name)).filter((f) => IMG.has(path.extname(f).toLowerCase())).map((f) => ({
        file: f, url: "/gallery-img/" + encodeURIComponent(d.name) + "/" + encodeURIComponent(f),
        added: fs.statSync(path.join(GALLERY, d.name, f)).mtime.toISOString().slice(0, 10),
      })),
    })).filter((a) => a.works.length) : [];
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(artists));
  }
  if (url.pathname === "/api/atmospheres/folder" && req.method === "POST") {   // new category = new folder
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const rel = String(JSON.parse(body).path || "").replace(/[:*?"<>|]/g, "");
        const dir = path.normalize(path.join(ATMO, rel));
        if (!rel || !dir.startsWith(ATMO + path.sep)) return res.writeHead(400).end("bad path");
        fs.mkdirSync(dir, { recursive: true }); res.writeHead(204).end();
      } catch (e) { res.writeHead(400).end(String(e.message)); }
    });
    return;
  }
  // music library (tools/import_music.py) sits next to hub.json but isn't part of it
  if (url.pathname === "/api/music") {
    const file = path.join(path.dirname(DATA), "music.json");
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    return sendJSON(req, res, file);
  }
  if (url.pathname === "/api/atmospheres") {
    fs.mkdirSync(ATMO, { recursive: true });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(atmoTree(ATMO)));
  }
  // media folders: /gallery-img/ → images/, /atmo/ → atmospheres/, /note-media/ and /place-media/ → next to hub.json
  const MEDIA_ROUTES = [["/gallery-img/", GALLERY], ["/atmo/", ATMO], ["/note-media/", path.join(path.dirname(DATA), "note-media")], ["/place-media/", path.join(path.dirname(DATA), "place-media")], ["/manga-covers/", path.join(path.dirname(DATA), "manga-covers")], ["/book-covers/", path.join(path.dirname(DATA), "book-covers")], ["/music-covers/", path.join(path.dirname(DATA), "music-covers")], ["/dream-media/", path.join(path.dirname(DATA), "dream-media")]];
  const route = MEDIA_ROUTES.find(([prefix]) => url.pathname.startsWith(prefix));
  if (route) {
    const [prefix, base] = route, ext = path.extname(url.pathname).toLowerCase();
    const file = path.normalize(path.join(base, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!file.startsWith(base + path.sep) || !(IMG.has(ext) || ((prefix === "/atmo/" || prefix === "/dream-media/") && VIDEO.has(ext)))) return res.writeHead(403).end();
    return sendFile(req, res, file);
  }
  // static files
  const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end("not found");
    // no-cache = the browser re-checks on every load, so edits to the app show up after a refresh
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Personal Hub → http://localhost:${PORT}`));
