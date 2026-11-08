// The music dock: a small Spotify player pinned to the corner that keeps playing across tabs and over Drift.
// It uses Spotify's embed iFrame API — whole songs when you're logged in to Spotify in this browser, 30-second
// previews otherwise — and steps through a queue on its own when a song ends. "Play in: Spotify app" hands each song
// to the Spotify desktop app instead (full songs on your account; no auto-advance — next / N moves on).
import { esc } from "./ui.js";
import { by, cover } from "./music-lib.js";

let apiP = null, ctl = null, dock = null, cur = null, kickTimer = 0;
const state = { queue: [], i: -1, label: "" };
let mode = (() => { try { return localStorage.getItem("hub.player.mode") || "hub"; } catch { return "hub"; } })();
export const playerMode = () => mode;
function openInApp(uri) { const a = Object.assign(document.createElement("a"), { href: uri }); document.body.append(a); a.click(); a.remove(); }
const log = (window.__hubPlayerLog = []);   // last few player events, for debugging playback
const note = (e) => { log.push({ t: Date.now(), ...e }); if (log.length > 80) log.shift(); };
const listeners = new Set();
export const onPlayer = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const now = () => state.queue[state.i] || null;

function api() {
  return (apiP ||= new Promise((res, rej) => {
    window.onSpotifyIframeApiReady = res;
    const s = Object.assign(document.createElement("script"), { src: "https://open.spotify.com/embed/iframe-api/v1", async: true });
    s.onerror = () => { apiP = null; rej(new Error("Spotify player couldn't load — are you online?")); };
    document.head.append(s);
  }));
}
function ensureDock() {
  if (dock) return;
  document.body.insertAdjacentHTML("beforeend", `<aside class="music-dock" aria-label="Music player">
      <div class="md-h"><img class="md-c" alt="" /><div class="md-t"><b></b><span></span></div>
        <button data-m="prev" title="Previous">‹</button><button data-m="next" title="Next">›</button><button data-m="close" title="Close the player">×</button></div>
      <div class="md-q"></div>
      <div class="md-mode" role="group" aria-label="Where songs play"><span>play in</span><button data-m="mode-hub">hub</button><button data-m="mode-app">Spotify app</button></div>
      <div class="md-spot"><div></div></div>
      <a class="md-open" href="#">Open in Spotify ↗</a>
      <p class="md-note" hidden>Spotify is only playing 30-second previews. Log in at <a href="https://open.spotify.com" target="_blank" rel="noopener">open.spotify.com</a> in this browser — or switch to <b>play in: Spotify app</b> for full songs every time.</p></aside>`);
  dock = document.body.lastElementChild;
  dock.addEventListener("click", (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    if (m === "prev") step(-1); else if (m === "next") step(1); else if (m === "close") closePlayer();
    else if (m === "mode-hub" || m === "mode-app") setMode(m.slice(5));
  });
}
function setMode(m) {
  if (m === mode) return;
  mode = m; try { localStorage.setItem("hub.player.mode", m); } catch {}
  if (m === "app") { ctl?.destroy(); ctl = null; clearTimeout(kickTimer); }
  if (now()) load();
}
function paint() {
  const t = now();
  if (!dock || !t) return;
  dock.classList.toggle("app", mode === "app");
  dock.querySelectorAll(".md-mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === `mode-${mode}`));
  dock.querySelector(".md-open").href = `spotify:track:${t.id}`;
  if (mode === "app") dock.querySelector(".md-note").hidden = true;
  dock.querySelector(".md-c").src = cover(t) || "";
  dock.querySelector(".md-c").hidden = !t.c;
  dock.querySelector(".md-t b").textContent = t.t;
  dock.querySelector(".md-t span").textContent = by(t);
  dock.querySelector(".md-q").innerHTML = `${esc(state.label)}${state.queue.length > 1 ? ` · ${state.i + 1} of ${state.queue.length}` : ""}`;
  listeners.forEach((fn) => fn(t));
}
/** Start the loaded song exactly once. resume() starts it if it hasn't begun and never rewinds it (play() can). */
function kick(reason) {
  if (!ctl || !cur || cur.kicked) return;
  cur.kicked = true; clearTimeout(kickTimer);
  note({ ev: "kick", reason, uri: cur.uri });
  ctl.resume();
}
function onUpdate({ data }) {
  if (!data || !cur) return;
  if (data.playingURI && data.playingURI !== cur.uri) return note({ ev: "stale", uri: data.playingURI });   // a late event from the previous song
  note({ ev: "update", p: Math.round(data.position), d: Math.round(data.duration), paused: data.isPaused, buf: data.isBuffering });
  if (!cur.kicked) return kick("loaded");   // the new song is loaded: start it once
  if (!data.isPaused && data.position > 0) cur.started = true;
  // previews: Spotify reports a ~30 s duration for a song that is really longer
  const t = now(), preview = data.duration > 0 && data.duration <= 31000 && (t?.ms || 0) > 45000;
  dock?.querySelector(".md-note")?.toggleAttribute("hidden", !preview);
  // it ended when playback stops at its last moment (or snaps back to 0 right after it)
  const atEnd = data.duration > 0 && (data.position >= data.duration - 800 || (data.position === 0 && cur.lastPos >= data.duration - 2500));
  if (!data.isBuffering) cur.lastPos = data.position;
  if (cur.started && data.isPaused && !data.isBuffering && atEnd && !cur.done) { cur.done = true; note({ ev: "ended" }); step(1); }
}
async function load() {
  const t = now(), uri = `spotify:track:${t.id}`;
  cur = { uri, kicked: false, started: false, done: false, lastPos: 0 };
  paint();
  if (mode === "app") { note({ ev: "app", uri }); return openInApp(uri); }   // the desktop app plays it in full
  try {
    const IFrameAPI = await api();
    if (!dock || cur?.uri !== uri) return;   // closed, or another song was picked while the API loaded
    clearTimeout(kickTimer);
    kickTimer = setTimeout(() => kick("timeout"), 1500);   // in case Spotify sends no update after loading
    if (ctl) { note({ ev: "load", uri }); ctl.loadUri(uri); return; }
    const spot = dock.querySelector(".md-spot");
    if (!spot.firstElementChild) spot.innerHTML = "<div></div>";   // destroy() removed the old mount point
    await new Promise((res) => IFrameAPI.createController(dock.querySelector(".md-spot > div"), { uri, width: "100%", height: 80 }, (c) => {
      ctl = c;
      c.addListener("ready", () => kick("ready"));
      c.addListener("playback_update", onUpdate);
      c.addListener("playback_started", (e) => { if (cur && e?.data?.playingURI === cur.uri) cur.started = true; });
      res();
    }));
  } catch (e) { dock.querySelector(".md-q").textContent = e.message; }
}

/** Play `tracks` from index `at`; `label` names the queue (a room, an atmosphere…). */
export function playQueue(tracks, at = 0, label = "") {
  if (!tracks.length) return;
  Object.assign(state, { queue: tracks, i: Math.max(0, Math.min(at, tracks.length - 1)), label });
  ensureDock();
  return load();
}
/** Swap what comes after the current song (Drift does this when the picture moves to another aesthetic). */
export function queueNext(tracks, label) {
  const cur = now();
  state.queue = cur ? [cur, ...tracks.filter((t) => t.id !== cur.id)] : tracks;
  state.i = 0; if (label) state.label = label;
  paint();
}
export function step(n) {
  if (!state.queue.length) return;
  state.i = (state.i + n + state.queue.length) % state.queue.length;
  load();
}
export const pause = () => ctl?.pause();
export function closePlayer() {
  clearTimeout(kickTimer); cur = null;
  ctl?.destroy(); ctl = null;
  dock?.remove(); dock = null;
  Object.assign(state, { queue: [], i: -1, label: "" });
  listeners.forEach((fn) => fn(null));
}
