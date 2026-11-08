// Drive headless Edge over the DevTools protocol in real time: load a URL, run steps, take screenshots.
// usage: node tools/cdp-shot.mjs <url> <outDir> <steps.json>   (BROWSER=<path to chrome/edge/chromium> if not the Windows Edge default)
// steps: [{wait: ms} | {shot: "name"} | {eval: "js"} | {click: [x, y]} | {key: "ArrowRight"} | {wheel: [x, y, dy]} | {drag: [x1,y1,x2,y2]}]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [url, out, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8"));
const EDGE = process.env.BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const VW = +(process.env.VW || 1440), VH = +(process.env.VH || 900);
const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(out, "cdp-prof-" + port);
const edge = spawn(EDGE, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", ...(process.env.AUTOPLAY ? ["--autoplay-policy=no-user-gesture-required"] : []), `--remote-debugging-port=${port}`,
  `--user-data-dir=${prof}`, `--window-size=${VW},${VH}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await sleep(200); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && /error|warn/.test(d.params.type)) logs.push(d.params.type + " " + d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: VW < 700 });
await send("Page.navigate", { url });
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
for (const s of steps) {
  if (s.wait) await sleep(s.wait);
  if (s.eval) { const r = await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true, returnByValue: true }); console.log("eval:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text)); }
  if (s.hover) { await mouse("mouseMoved", ...s.hover, { button: "none" }); await sleep(300); }
  if (s.click) { await mouse("mouseMoved", ...s.click, { button: "none" }); await sleep(80); await mouse("mousePressed", ...s.click); await sleep(60); await mouse("mouseReleased", ...s.click); }
  if (s.move) await mouse("mouseMoved", ...s.move, { button: "none" });
  if (s.drag) { const [x1, y1, x2, y2] = s.drag; await mouse("mousePressed", x1, y1); for (let k = 1; k <= 12; k++) { await mouse("mouseMoved", x1 + ((x2 - x1) * k) / 12, y1 + ((y2 - y1) * k) / 12, { buttons: 1 }); await sleep(30); } await mouse("mouseReleased", x2, y2); }
  if (s.wheel) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: s.wheel[0], y: s.wheel[1], deltaX: 0, deltaY: s.wheel[2] });
  if (s.key) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: s.key, code: s.key, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13 }[s.key] || 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: s.key, code: s.key }); }
  if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(out, s.shot + ".png"), Buffer.from(r.result.data, "base64")); console.log("shot", s.shot); }
}
console.log(logs.length ? logs.join("\n") : "no console errors");
ws.close(); edge.kill();
await sleep(300);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(0);
