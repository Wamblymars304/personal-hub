// npm run demo — the hub filled with made-up data, so you can see every tab working before adding your own.
// Copies examples/hub.demo.json to examples/.demo/hub.json (git-ignored), moves its dates so they land around
// today, and starts the server on that copy (port 4401 unless PORT is set). Your data/hub.json is never touched,
// and every run starts fresh from the example.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANCHOR = "2026-01-15";   // the example is written as if this were today
const DAY = 864e5;

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);   // local date, like the app
const shift = Math.round((Date.parse(today) - Date.parse(ANCHOR)) / DAY);
const moved = (iso) => new Date(Date.parse(iso) + shift * DAY).toISOString().slice(0, 10);
const text = fs.readFileSync(path.join(ROOT, "examples", "hub.demo.json"), "utf8")
  .replace(/"(\d{4}-\d{2}-\d{2})"/g, (_, d) => `"${moved(d)}"`)   // every date, and date keys
  .replace(/"targetMonth": "(\d{4}-\d{2})"/g, (_, m) => `"targetMonth": "${moved(m + "-15").slice(0, 7)}"`);

const dir = path.join(ROOT, "examples", ".demo");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "hub.json"), text);
process.env.HUB_DATA = path.join(dir, "hub.json");
process.env.PORT ||= "4401";
await import("../server.js");
