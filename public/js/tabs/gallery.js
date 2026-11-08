// Gallery — a holographic exhibition for the art in images/<artist>/.
// The works float in a 3D hall (three.js) over a glossy floor that mirrors them, in one of three
// formations: Orbit (a slowly turning ring), Helix (a spiral tower you climb), Drift (you glide down
// a corridor of art). Every few seconds one work dissolves and a least-seen one prints in its place,
// so each visit is different, and the sky takes its colors from whatever is in front of you.
// Click a work to fly up to it. Archive = everything as a wall. Seen counts + favorites → hub.json "gallery".
import * as THREE from "../../vendor/three.module.min.js";
import { db, commit, today } from "../store.js";
import { esc, plural, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { setPalette, motionEnabled } from "../background.js";

const FORMS = {
  salon: { label: "Salon", n: 5, hint: "hover a work to keep it · click to see it full size",
    icon: `<rect x="1.5" y="2.5" width="6.5" height="11" rx="1"/><rect x="10" y="2.5" width="4.5" height="5" rx="1"/><rect x="10" y="9.5" width="4.5" height="4" rx="1"/>` },
  orbit: { label: "Orbit", n: 12, H: 1.75, hint: "drag to turn · scroll to spin · click a work",
    icon: `<ellipse cx="8" cy="8" rx="6.5" ry="2.8"/><circle cx="8" cy="8" r="1.6"/>` },
  helix: { label: "Helix", n: 21, H: 1.3, hint: "drag to turn and climb · click a work",
    icon: `<path d="M5 1.5c6 3 0 6.5 6 9.5M11 1.5c-6 3 0 6.5-6 9.5M5 11c3 1.5 3 2.5 3 3.5M11 11c-3 1.5-3 2.5-3 3.5"/>` },
  drift: { label: "Drift", n: 16, H: 1.65, hint: "scroll or drag to glide · click a work",
    icon: `<path d="M1.5 14.5 7 5.5M14.5 14.5 9 5.5M5 14.5 7.6 9.5M11 14.5 8.4 9.5M5.5 5.5h5"/>` },
};
let savedForm = "orbit";
try { savedForm = new URLSearchParams(location.search).get("form") || localStorage.getItem("hub.galleryForm") || "orbit"; } catch {}
const ui = { room: "all", mode: "exhibit", form: FORMS[savedForm] ? savedForm : "orbit", paused: false, every: 9, lb: null };
let catalog = null, loading = null, works = [], appRef = null;

const titleCase = (s) => s.replace(/(^|[\s(-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase());   // not after apostrophes: "Hell's"
// filenames from the web are messy: drop ids, sizes, "(1)", "image", "final", and the artist's own name
const JUNK = new Set(["image", "images", "img", "copy", "final", "download", "wallpaper", "hd", "4k", "photo", "pic", "artwork", "art", "by"]);
// short words that belong in real titles ("Streets of Dis"); other 1–2 character bits are filename noise
const SHORT = new Set(["a", "an", "of", "in", "on", "to", "at", "is", "it", "no", "my", "vs", "or", "and", "the"]);
function titleOf(file, artist = "") {
  const own = new Set(artist.toLowerCase().split(/\s+/));
  const raw = file.replace(/\.[^.]+$/, "").replace(/@\dx/gi, "").replace(/[_\-.()[\]]+/g, " ").trim().split(/\s+/)
    .filter((w) => !/^[0-9a-f]{8,}$/i.test(w) && !/^(?=.*\d)(?=.*[a-z])[a-z0-9]{9,}$/i.test(w) && !/^\d+$/.test(w) && !/^\d+x\d+$/i.test(w) && !(/^[a-z0-9]{1,2}$/i.test(w) && !SHORT.has(w.toLowerCase())));
  const gone = raw.map((w) => JUNK.has(w.toLowerCase()) || own.has(w.toLowerCase()) || own.has(w.toLowerCase().replace(/e$/, "")));
  // a short word only stays if it still joins real words: "Streets of Dis" yes, "(art) of Jean Giraud" no
  const short = (w) => SHORT.has(w.toLowerCase());
  let keep = raw.filter((w, i) => !gone[i] && !(short(w) && (i + 1 >= raw.length || gone[i + 1] || (i > 0 && gone[i - 1]))));
  while (keep.length && short(keep.at(-1))) keep.pop();
  while (keep.length && short(keep[0]) && !/^(the|a|an)$/i.test(keep[0])) keep.shift();
  if (keep.length && keep.every(short)) keep = [];
  const words = keep.length ? keep : raw.filter((w) => !JUNK.has(w.toLowerCase()));
  const t = titleCase(words.join(" ").replace(/(\D)\d+$/, "$1")).replace(/ (A|An|Of|In|On|To|At|And|The|Or|Vs|For|With|From)(?= )/g, (m) => m.toLowerCase());
  return t.length > 2 ? t : "Untitled";
}
const state = () => (db.gallery ||= { seen: {}, favorites: [] });
const seen = (w) => state().seen[w.url] || 0;
const isFav = (w) => state().favorites.includes(w.url);
const inRoom = (w) => ui.room === "all" || (ui.room === "♥" ? isFav(w) : w.artist === ui.room);

async function load() {
  loading ||= fetch("/api/gallery").then((r) => r.json()).then((list) => {
    catalog = list;
    works = list.flatMap((a) => a.works.map((w) => ({ ...w, artist: a.artist, artistName: titleCase(a.artist), title: titleOf(w.file, a.artist) })));
  }).catch(() => { catalog = []; works = []; });
  return loading;
}

/** Least-seen first, random among ties, never something already showing. */
function pickNext(exclude) {
  const pool = works.filter((w) => inRoom(w) && !exclude.includes(w.url));
  if (!pool.length) return null;
  const min = Math.min(...pool.map(seen));
  const fresh = pool.filter((w) => seen(w) <= min);
  return fresh[Math.floor(Math.random() * fresh.length)];
}
function markSeen(w) {
  const s = state();
  s.seen[w.url] = (s.seen[w.url] || 0) + 1;
  s.lastVisit = today();
  commit(true);   // view counts: saved, but not worth a "Leave site?" warning
}

/* ---------- color of the art → color of the room ---------- */
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lift = (c, f) => c.map((v) => v + (255 - v) * f);
function sample(src) {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(src, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let avg = [0, 0, 0], best = [200, 180, 140], bestScore = -1;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      avg[0] += r; avg[1] += g; avg[2] += b;
      const score = (mx - mn) * (mx / 255);
      if (score > bestScore) { bestScore = score; best = [r, g, b]; }
    }
    const n = d.length / 4;
    return { avg: avg.map((v) => v / n), vivid: best };
  } catch { return { avg: [40, 36, 44], vivid: [255, 217, 160] }; }
}
function paletteFrom(tones) {
  const avg = [0, 1, 2].map((k) => tones.reduce((a, x) => a + x.avg[k], 0) / tones.length);
  setPalette({ top: hex(avg.map((v) => v * 0.1)), bot: hex(avg.map((v) => v * 0.2)), glow: hex(tones[0].vivid),
    a: hex(lift(tones[0].vivid, 0.35)), b: hex(lift((tones[1] || tones[0]).vivid, 0.35)), c: hex(lift((tones[2] || tones[0]).vivid, 0.45)) });
}

/* ---------- textures: downscaled once, cached (least recently used goes first) ---------- */
const cache = new Map();
function art(url) {
  if (cache.has(url)) { const v = cache.get(url); cache.delete(url); cache.set(url, v); return v; }
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 4;
      res({ tex, aspect: img.naturalWidth / img.naturalHeight, tone: sample(c), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = rej;
    img.src = url;
  });
  cache.set(url, p);
  for (const [k, v] of cache) {
    if (cache.size <= 44) break;
    if (S?.panels.some((q) => q.work?.url === k)) continue;
    cache.delete(k); v.then((a) => a.tex.dispose(), () => {});
  }
  return p;
}

/* ---------- shaders ---------- */
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const NOISE = `float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  // printing: a ragged front sweeps up the picture; d > 0 means that pixel is printed
  float front(vec2 uv, float r, float t){ return mix(-0.3, 1.3, r) - (uv.y + vn(vec2(uv.x * 7.0, t * 0.5)) * 0.18 + vn(uv * 60.0) * 0.06); }`;
const PANEL_FS = `uniform sampler2D map; uniform float uReveal, uHover, uFade, uAspect, uTime; uniform vec3 uEdge; varying vec2 vUv;
  ${NOISE}
  void main(){
    float d = front(vUv, uReveal, uTime);
    float shown = smoothstep(0.0, 0.012, d);
    float edge = (1.0 - smoothstep(0.0, 0.05, abs(d))) * (1.0 - step(0.999, uReveal));
    vec3 c = texture2D(map, vUv).rgb;
    float fresh = (1.0 - smoothstep(0.0, 0.22, d)) * shown;        // just printed: scanlines + tint
    c = mix(c, c * (0.7 + 0.3 * sin(vUv.y * 700.0)) + uEdge * 0.25, fresh);
    vec2 px = vec2(min(vUv.x, 1.0 - vUv.x) * uAspect, min(vUv.y, 1.0 - vUv.y));
    float frame = 1.0 - smoothstep(0.0, 0.011, min(px.x, px.y));
    c *= 0.84 + 0.16 * uHover;
    c += uEdge * frame * (0.18 + 0.8 * uHover);
    c += uEdge * edge * 2.4;
    float a = max(shown, edge);
    if (!gl_FrontFacing) { c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.35) * 0.7; a *= 0.14; }  // from behind: a ghost
    gl_FragColor = vec4(c, a * uFade);
  }`;
const MIRROR_FS = `uniform sampler2D map; uniform float uReveal, uFade, uTime; uniform vec3 uEdge; varying vec2 vUv;
  ${NOISE}
  void main(){
    float d = front(vUv, uReveal, uTime);
    float shown = smoothstep(0.0, 0.012, d) + (1.0 - smoothstep(0.0, 0.05, abs(d))) * (1.0 - step(0.999, uReveal));
    vec3 c = texture2D(map, vUv, 2.5).rgb + uEdge * 0.05;
    float a = pow(1.0 - vUv.y, 2.6) * 0.34 * min(shown, 1.0) * uFade;   // strongest where it meets the floor
    gl_FragColor = vec4(c * (0.75 + 0.25 * sin(vUv.y * 260.0 + uTime)), a);
  }`;
const AURA_FS = `uniform float uReveal, uHover, uFade; uniform vec3 uEdge; varying vec2 vUv;
  void main(){ vec2 p = (vUv - 0.5) * 2.0; float g = exp(-dot(p, p) * 2.6);
    gl_FragColor = vec4(uEdge * g * (0.07 + 0.2 * uHover) * uReveal * uFade, 1.0); }`;
const FLOOR_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FLOOR_FS = `uniform vec3 uGlow, uPulseCol; uniform float uR, uMode, uScroll, uPulse; uniform vec2 uPulseAt; varying vec3 vW;
  float ln(float v, float w){ return 1.0 - smoothstep(0.0, w, abs(v)); }
  void main(){
    vec2 p = vW.xz; float d = length(p);
    float fade = 1.0 - smoothstep(5.0, 30.0, d);
    float lines = 0.0;
    if (uMode < 0.5) {                       // orbit + helix: a turntable of rings and ticks
      lines += ln(d - uR, 0.022) * 0.6 + ln(d - uR - 1.7, 0.016) * 0.3 + ln(d - uR * 0.45, 0.012) * 0.18;
      float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
      lines += step(0.86, fract(ang * 120.0)) * step(abs(d - uR - 2.05), 0.2) * 0.4;
    } else {                                 // drift: lanes that stream past
      lines += ln(abs(p.x) - 1.15, 0.02) * step(0.45, fract((p.y - uScroll) * 0.4)) * 0.55;
      lines += ln(abs(p.x) - 4.2, 0.03) * 0.25;
    }
    float pd = length(p - uPulseAt), pr = uPulse * 7.0;
    float pulse = ln(pd - pr, 0.18 + uPulse * 0.25) * (1.0 - smoothstep(0.1, 1.2, uPulse)) * step(0.0, uPulse);
    vec3 c = vec3(0.01, 0.009, 0.016) + uGlow * lines * 0.9 + uPulseCol * pulse * 0.8;
    gl_FragColor = vec4(c, fade * clamp(0.58 + lines * 0.5 + pulse, 0.0, 1.0));
  }`;
const HORIZON_FS = `uniform vec3 uGlow; varying vec2 vUv;
  void main(){ float y = vUv.y - 0.5; float g = exp(-y * y * 1400.0) * 0.22 + exp(-y * y * 50.0) * 0.2;
    gl_FragColor = vec4(uGlow * g * (1.0 - pow(abs(vUv.x - 0.5) * 2.0, 3.0)), 1.0); }`;

/* ---------- the stage (built once, kept across re-renders so the camera never resets) ---------- */
const TAU = Math.PI * 2, HR = 3.4, PER_TURN = 7, DY = 0.36, SPACING = 3.1;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const hash = (i) => { const s = Math.sin(i * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// additive light that leaves the canvas alpha alone, so glows brighten the page behind instead of blacking it out
const GLOW = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const icon = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
let S = null;

function stage() {
  if (S) return S;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  const el = document.createElement("div");
  el.className = "stage";
  el.innerHTML = `
    <svg class="leader" aria-hidden="true"><path/><circle r="3"/></svg>
    <div class="tag" aria-hidden="true"><span class="pa"></span><span class="pt"></span><span class="ps"></span></div>
    <div class="hud tl"><div class="forms" role="group" aria-label="Formation">${Object.entries(FORMS).map(([k, f]) =>
      `<button data-x="form" data-f="${k}" aria-pressed="false">${icon(f.icon)}${f.label}</button>`).join("")}</div></div>
    <div class="hud tr">
      <button class="hb" data-x="pause"></button>
      <button class="hb" data-x="rehang" title="Hang a new selection">${icon(`<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10"/>`)}Rehang</button>
      <label class="hb sel"><span>every</span><select data-x="every" aria-label="How often a work changes">${[5, 9, 15, 30, 60].map((s) => `<option value="${s}">${s}s</option>`).join("")}</select></label>
    </div>
    <div class="hud bl readout"><b class="rf"></b><span class="ri"></span><span class="rs"></span><i class="bar"><i></i></i></div>
    <div class="hud br hint"></div>
    <section class="salon-hall" aria-label="Salon wall"></section>
    <aside class="focus" aria-live="polite"></aside>
    <div class="empty-hall" hidden></div>
    <i class="corner a"></i><i class="corner b"></i><i class="corner c"></i><i class="corner d"></i>`;
  el.prepend(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  const uTime = { value: 0 };
  const floorU = { uGlow: { value: new THREE.Color("#ffd9a0") }, uPulseCol: { value: new THREE.Color("#ffd9a0") }, uR: { value: 4.8 },
    uMode: { value: 0 }, uScroll: { value: 0 }, uPulse: { value: -1 }, uPulseAt: { value: new THREE.Vector2() } };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShaderMaterial({ uniforms: floorU, vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS, transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  const horizon = new THREE.Mesh(new THREE.PlaneGeometry(140, 14), new THREE.ShaderMaterial({ uniforms: { uGlow: floorU.uGlow }, vertexShader: VS, fragmentShader: HORIZON_FS, transparent: true, depthWrite: false, ...GLOW }));
  horizon.position.set(0, 0, -40);
  scene.add(floor, horizon);

  S = { el, renderer, scene, camera, uTime, floorU, panels: [], dying: [], tweens: [], sal: { hung: [], last: -1 }, room: null, list: [],
    theta: 0, thetaGoal: null, hphase: 0, scroll: 0, scrollGoal: null, vel: 0, ft: 0,
    camPos: new THREE.Vector3(0, 7, 28), camLook: new THREE.Vector3(0, 1.2, 0), goalPos: new THREE.Vector3(), goalLook: new THREE.Vector3(),
    mouse: new THREE.Vector2(9, 9), inside: false, hover: null, focus: null, drag: null, left: ui.every,
    raf: 0, last: 0, wake: 0, palUrl: null, palAt: 0, tagKey: "", status: "", statusUntil: 0, ray: new THREE.Raycaster() };

  new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    wake();
  }).observe(el);

  /* pointer (mouse + touch): drag moves the formation, a tap flies to a work */
  const cv = renderer.domElement;
  const setMouse = (e) => { const r = cv.getBoundingClientRect(); S.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  cv.addEventListener("pointerdown", (e) => { setMouse(e); S.drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() }; cv.setPointerCapture(e.pointerId); wake(); });
  cv.addEventListener("pointermove", (e) => {
    setMouse(e); S.inside = true; wake();
    const d = S.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y, now = performance.now(), dt = Math.max(0.008, (now - d.t) / 1000);
    d.x = e.clientX; d.y = e.clientY; d.t = now; d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.moved < 6) return;
    if (S.focus) unfocus();
    S.vel = S.vel * 0.5 + (nudge(dx, dy) / dt) * 0.5;
  });
  cv.addEventListener("pointerup", (e) => {
    const d = S.drag; S.drag = null;
    if (!d || d.moved >= 6) return;
    setMouse(e);
    const hit = pick();
    if (hit && hit !== S.focus) focusOn(hit); else if (S.focus) unfocus();
  });
  cv.addEventListener("pointerleave", () => { S.inside = false; S.mouse.set(9, 9); });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); wake(); if (S.focus) unfocus(); S.vel += nudge(-e.deltaY * 0.12, -e.deltaY * 0.12) * 4; }, { passive: false });

  el.addEventListener("click", (e) => {
    const pc = e.target.closest(".salon-hall .piece:not(.leaving)");
    if (pc) { const list = S.sal.hung.filter(Boolean); return openViewer(list, Math.max(0, list.findIndex((w) => w.url === pc.dataset.url))); }
    const b = e.target.closest("[data-x]");
    if (!b || b.tagName === "SELECT") return;
    wake();
    switch (b.dataset.x) {
      case "form": if (b.dataset.f !== ui.form) reform(b.dataset.f); break;
      case "pause": ui.paused = !ui.paused; toast(ui.paused ? "Paused — the works stay put" : "The hall changes again"); break;
      case "rehang": hang(false); break;
      case "prev": stepFocus(-1); break;
      case "next": stepFocus(1); break;
      case "fav": toggleFocusFav(); break;
      case "full": { const list = S.panels.map((p) => p.work).filter(Boolean); openViewer(list, Math.max(0, list.indexOf(S.focus?.work))); break; }
      case "back": unfocus(); break;
    }
    syncHud();
  });
  el.querySelector('[data-x="every"]').addEventListener("change", (e) => { ui.every = +e.target.value; S.left = Math.min(S.left, ui.every); toast(`A new work every ${ui.every} seconds`); });
  addEventListener("resize", fit);
  return S;
}

/** Move the formation by a drag of (dx, dy) pixels; returns how far it moved. */
function nudge(dx, dy) {
  if (ui.form === "drift") { const v = -dy * 0.03 + dx * 0.01; S.scroll += v; return v; }
  if (ui.form === "helix") S.hphase -= dy * 0.004;
  const v = dx * 0.0055; S.theta += v; return v;
}
const wake = () => (S.wake = performance.now() + 1800);

function fit() {
  if (!S?.el.isConnected) return;
  const top = S.el.getBoundingClientRect().top + scrollY;
  S.el.style.height = `${Math.max(460, innerHeight - top - 22)}px`;
}

/* ---------- panels: picture + floor reflection + soft aura, all sharing one set of uniforms ---------- */
const GEO = new THREE.PlaneGeometry(1, 1);
const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); BLANK.needsUpdate = true;
function makePanel() {
  const u = { map: { value: BLANK }, uReveal: { value: 0 }, uHover: { value: 0 }, uFade: { value: 1 }, uAspect: { value: 0.75 }, uTime: S.uTime, uEdge: { value: new THREE.Color("#ffd9a0") } };
  const mat = (fs, extra = {}) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...extra });
  const mesh = new THREE.Mesh(GEO, mat(PANEL_FS)), mirror = new THREE.Mesh(GEO, mat(MIRROR_FS)), aura = new THREE.Mesh(GEO, mat(AURA_FS, { ...GLOW, side: THREE.FrontSide }));
  mirror.renderOrder = 1; aura.renderOrder = 2; mesh.renderOrder = 3;
  S.scene.add(mirror, aura, mesh);
  const p = { mesh, mirror, aura, u, work: null, a: null, w: 1.3, h: 1.75, wGoal: 1.3, hGoal: 1.75, pose: { x: 0, y: -4, z: 0, ry: 0, fade: 1 }, from: null, t0: 0, scale: 1, dim: 1, busy: false, gen: 0 };
  mesh.userData.p = p;
  return p;
}
function dropPanel(p) {
  S.scene.remove(p.mesh, p.mirror, p.aura);
  [p.mesh, p.mirror, p.aura].forEach((m) => m.material.dispose());
}
function sizeFor(p) {
  const H = FORMS[ui.form].H, asp = p.a?.aspect || 0.75;
  p.wGoal = Math.min(H * asp, H * 1.7); p.hGoal = p.wGoal / asp;
}
function setWork(p, w, a) {   // only while the panel is invisible, so the size can snap
  p.work = w; p.a = a;
  p.u.map.value = a.tex; p.u.uAspect.value = a.aspect;
  p.u.uEdge.value.setRGB(...lift(a.tone.vivid, 0.25).map((v) => v / 255));
  sizeFor(p); p.w = p.wGoal; p.h = p.hGoal;
}

/** a small tween engine that runs inside the stage's own frame loop */
function tween(obj, key, to, ms, delay = 0) {
  return new Promise((done) => {
    S.tweens = S.tweens.filter((t) => !(t.obj === obj && t.key === key));
    if (!motionEnabled() || ms <= 0) { obj[key] = to; return done(); }
    S.tweens.push({ obj, key, from: null, to, t0: performance.now() + delay, ms, done });
  });
}
function runTweens(now) {
  S.tweens = S.tweens.filter((t) => {
    if (now < t.t0) return true;
    if (t.from === null) t.from = t.obj[t.key];
    const k = clamp01((now - t.t0) / t.ms);
    t.obj[t.key] = t.from + (t.to - t.from) * (t.to > t.from ? 1 - Math.pow(1 - k, 3) : k * k);
    if (k >= 1) { t.done(); return false; }
    return true;
  });
}

const count = () => Math.min(FORMS[ui.form].n, S.list.length);
const ringR = (n) => Math.max(2.9, (n * 2.55) / TAU);
const helixTop = (n) => 0.55 + Math.max(0, n - 1) * DY + 1;
function formPose(i, n, p) {
  const t = S.ft;
  if (ui.form === "orbit") {
    const a = S.theta + (i * TAU) / n, R = ringR(n);
    return { x: Math.sin(a) * R, y: 0.45 + p.h / 2 + Math.sin(t * 0.7 + i * 1.7) * 0.06, z: Math.cos(a) * R, ry: a, fade: 1 };
  }
  if (ui.form === "helix") {
    const a = S.theta + (i * TAU) / PER_TURN;
    return { x: Math.sin(a) * HR, y: 0.55 + p.h / 2 + i * DY + Math.sin(t * 0.6 + i) * 0.04, z: Math.cos(a) * HR, ry: a, fade: 1 };
  }
  const L = Math.max(18, n * SPACING), z = ((((-i * SPACING + S.scroll) % L) + L) % L) - L + 5.5;
  const side = i % 2 ? 1 : -1;
  return { x: side * (2.35 + hash(i) * 0.8), y: 0.3 + hash(i + 3) * 0.75 + p.h / 2 + Math.sin(t * 0.6 + i) * 0.05, z, ry: -side * 0.55,
    fade: smooth(5.6, 2.8, z) * smooth(5.5 - L, 5.5 - L + 6, z) };
}
function place(p, i, n, now) {
  let pose = formPose(i, n, p);
  if (p.from) {
    const k = easeIO(clamp01((now - p.t0) / 1500));
    if (k >= 1) p.from = null;
    else {
      const f = p.from;
      pose = { x: f.x + (pose.x - f.x) * k, y: f.y + (pose.y - f.y) * k, z: f.z + (pose.z - f.z) * k, ry: f.ry + wrapA(pose.ry - f.ry) * k, fade: f.fade + (pose.fade - f.fade) * k };
    }
  }
  p.pose = pose;
  pose3(p);
}
function pose3(p) {
  const { x, y, z, ry, fade } = p.pose, s = p.scale, nx = Math.sin(ry), nz = Math.cos(ry);
  p.mesh.position.set(x, y, z); p.mesh.rotation.set(0, ry, 0); p.mesh.scale.set(p.w * s, p.h * s, 1);
  p.mirror.position.set(x, -y, z); p.mirror.rotation.set(0, ry, 0); p.mirror.scale.set(p.w * s, -p.h * s, 1);
  p.aura.position.set(x - nx * 0.08, y, z - nz * 0.08); p.aura.rotation.set(0, ry, 0); p.aura.scale.set(p.w * s * 1.8 + 0.9, p.h * s * 1.5 + 0.9, 1);
  p.u.uFade.value = fade * p.dim;
}

/** Hang a fresh selection (each visit, room change, or Rehang). */
function hang(intro) {
  if (isSalon()) {
    while (S.panels.length) dropPanel(S.panels.pop());
    S.tweens = []; S.focus = null; syncFocus();
    hangSalon();
    S.left = ui.every;
    return status(intro ? "opening the hall" : "rehanging");
  }
  S.el.querySelector(".salon-hall").innerHTML = ""; S.sal.hung = [];
  const n = count();
  while (S.panels.length > n) dropPanel(S.panels.pop());
  while (S.panels.length < n) S.panels.push(makePanel());
  S.tweens = [];
  S.focus = null; S.thetaGoal = S.scrollGoal = null; S.palUrl = null;
  syncFocus();
  if (intro) { S.theta = Math.random() * TAU; S.camPos.set(0, 6.5, ringR(n) + 22); S.camLook.set(0, 0.6, 0); }
  const taken = [];
  S.panels.forEach((p, i) => {
    const w = pickNext(taken);
    if (!w) return;
    taken.push(w.url);
    p.gen++; const gen = p.gen;
    p.work = w; p.busy = true; p.from = null; p.u.uReveal.value = 0;
    markSeen(w);
    art(w.url).then((a) => {
      if (p.gen !== gen) return;
      setWork(p, w, a);
      return tween(p.u.uReveal, "value", 1, 2000, 250 + i * 120);
    }).catch(() => {}).finally(() => { if (p.gen === gen) p.busy = false; });
  });
  S.left = ui.every;
  status(intro ? "opening the hall" : "rehanging");
}

/* ---------- Salon: the original wall — five works under spotlights, one swapped at a time ---------- */
const isSalon = () => ui.form === "salon";
const salonPiece = (w) => `<div class="piece" data-url="${esc(w.url)}">
    <div class="frame"><img src="${esc(w.url)}" alt="${esc(w.title)} by ${esc(w.artistName)}" draggable="false" /></div>
    <div class="placard"><span class="pa">${esc(w.artistName)}</span><span class="pt">${esc(w.title)}</span><span class="ps">${isFav(w) ? "♥ · " : ""}seen ${seen(w)}×</span></div>
  </div>`;
function salonPalette(hall) {
  const tones = [...hall.querySelectorAll(".piece:not(.leaving) img")].filter((i) => i.complete && i.naturalWidth).map(sample);
  if (!tones.length) return;
  paletteFrom(tones.slice(0, 3));
  S.el.style.setProperty("--art", hex(lift(tones[0].vivid, 0.4)));
}
function hangSalon() {
  const hall = S.el.querySelector(".salon-hall"), n = Math.min(FORMS.salon.n, S.list.length);
  hall.className = `salon-hall n${n}`;
  hall.innerHTML = [...Array(n).keys()].map((i) => `<div class="slot" data-slot="${i}"></div>`).join("");
  S.sal.hung = []; S.sal.last = -1;
  for (let i = 0; i < n; i++) { const w = pickNext(S.sal.hung.map((x) => x.url)); if (w) { S.sal.hung[i] = w; markSeen(w); } }
  hall.querySelectorAll(".slot").forEach((slot, i) => {
    if (S.sal.hung[i]) slot.innerHTML = salonPiece(S.sal.hung[i]);
    // the work tilts gently toward the cursor
    slot.onpointermove = (e) => { const r = slot.getBoundingClientRect(); slot.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - 0.5) * -6}deg`); slot.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`); };
    slot.onpointerleave = () => { slot.style.setProperty("--rx", "0deg"); slot.style.setProperty("--ry", "0deg"); };
  });
  const imgs = [...hall.querySelectorAll("img")];
  let left = imgs.length;
  imgs.forEach((im) => { const done = () => { if (--left <= 0) salonPalette(hall); }; im.complete ? done() : im.addEventListener("load", done, { once: true }); });
  if (motionEnabled()) animate(hall.querySelectorAll(".piece"), { opacity: [0, 1], translateY: [30, 0], scale: [0.96, 1], delay: stagger(140, { start: 150 }), duration: 1400, ease: "outExpo" });
}
function swapSalon() {
  const hall = S.el.querySelector(".salon-hall"), slots = [...hall.querySelectorAll(".slot")];
  const hovered = +(hall.querySelector(".slot:hover")?.dataset.slot ?? -1);
  const choices = slots.map((_, i) => i).filter((i) => i !== hovered && i !== S.sal.last);
  if (!choices.length) return;
  const i = choices[Math.floor(Math.random() * choices.length)], w = pickNext(S.sal.hung.filter(Boolean).map((x) => x.url));
  if (!w) return;
  S.sal.last = i;
  const slot = slots[i], old = slot.querySelector(".piece:not(.leaving)");
  slot.insertAdjacentHTML("beforeend", salonPiece(w));
  const fresh = slot.lastElementChild, img = fresh.querySelector("img");
  S.sal.hung[i] = w;
  markSeen(w);
  fresh.querySelector(".ps").textContent = `${isFav(w) ? "♥ · " : ""}seen ${seen(w)}×`;
  status(`now hanging · ${w.artistName} — ${w.title}`, 2600);
  const show = () => {
    if (old) old.classList.add("leaving");
    if (motionEnabled()) {
      animate(fresh, { opacity: [0, 1], scale: [1.035, 1], duration: 1600, ease: "outQuart" });
      if (old) animate(old, { opacity: [1, 0], scale: [1, 0.985], duration: 1100, ease: "inQuad", onComplete: () => old.remove() });
    } else old?.remove();
    salonPalette(hall);
  };
  img.complete ? show() : (img.onload = show);
  img.onerror = () => fresh.remove();
}

/** Switch formation: every work glides to its new place. */
function reform(form) {
  const now = performance.now(), glide = motionEnabled(), wasSalon = isSalon();
  if (S.focus) unfocus();
  ui.form = form;
  try { localStorage.setItem("hub.galleryForm", form); } catch {}
  if (wasSalon || isSalon()) return hang(wasSalon);   // to or from the flat wall: hang it fresh (3D swoops in)
  if (form === "drift") S.scroll = 0;
  const n = count();
  S.panels.forEach((p, i) => { p.from = glide ? { ...p.pose } : null; p.t0 = now + i * 45; sizeFor(p); });
  while (S.panels.length > n) {
    const p = S.panels.pop();
    S.dying.push(p);
    tween(p.u.uReveal, "value", 0, 700).then(() => { dropPanel(p); S.dying = S.dying.filter((q) => q !== p); });
  }
  while (S.panels.length < n) {
    const p = makePanel(), i = S.panels.length;
    S.panels.push(p);
    p.pose = { ...S.panels[0].pose, fade: 0 };
    p.from = glide ? { ...p.pose } : null; p.t0 = now + i * 45;
    reprint(p, 500);
  }
  status(`${FORMS[form].label.toLowerCase()} formation`);
}

/** One work dissolves; a least-seen one prints in its place. */
async function reprint(p, delay = 0) {
  if (!p) {
    const vis = S.panels.filter((q) => !q.busy && q !== S.hover && q !== S.focus && q.pose.fade > 0.6 &&
      (ui.form !== "orbit" || q.pose.z > -1) && (ui.form !== "helix" || Math.abs(q.pose.y - S.camLook.y) < 3));
    p = vis[Math.floor(Math.random() * vis.length)] || S.panels.find((q) => !q.busy && q !== S.focus);
    if (!p) return;
  }
  const w = pickNext(S.panels.map((q) => q.work?.url).filter(Boolean));
  if (!w) return;
  p.busy = true; p.gen++; const gen = p.gen;
  try {
    const a = await art(w.url);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (p.u.uReveal.value > 0) await tween(p.u.uReveal, "value", 0, 800);
    if (p.gen !== gen) return;
    setWork(p, w, a);
    markSeen(w);
    pulse(p);
    status(`printing · ${w.artistName} — ${w.title}`, 2600);
    await tween(p.u.uReveal, "value", 1, 2100);
  } catch {} finally { if (p.gen === gen) p.busy = false; }
}
function pulse(p) {
  S.floorU.uPulseAt.value.set(p.pose.x, p.pose.z);
  S.floorU.uPulseCol.value.copy(p.u.uEdge.value);
  S.floorU.uPulse.value = 0;
}
function status(text, ms = 1600) { S.status = text; S.statusUntil = performance.now() + ms; }

/* ---------- focus: fly up to one work ---------- */
function focusOn(p) {
  if (!p?.work) return;
  S.focus = p; wake();
  const i = S.panels.indexOf(p), n = S.panels.length;
  if (ui.form === "drift") S.scrollGoal = S.scroll + (-1.2 - p.pose.z);
  else S.thetaGoal = S.theta - wrapA(S.theta + (i * TAU) / (ui.form === "orbit" ? n : PER_TURN));
  if (ui.form === "helix") { const f = clamp01((p.pose.y - 1.3) / (helixTop(n) - 1.3)); S.hphase = Math.acos(1 - 2 * f); }
  syncFocus();
}
function unfocus() { S.focus = null; S.thetaGoal = S.scrollGoal = null; syncFocus(); }
function stepFocus(d) {
  const n = S.panels.length;
  if (!n) return;
  const i = S.focus ? S.panels.indexOf(S.focus) : nearest()?.i ?? 0;
  for (let k = 1; k <= n; k++) { const q = S.panels[(((i + d * k) % n) + n) % n]; if (q.work && q.a) return focusOn(q); }
}
function toggleFocusFav() {
  const w = S.focus?.work;
  if (!w) return;
  const f = state().favorites;
  state().favorites = isFav(w) ? f.filter((u) => u !== w.url) : [...f, w.url];
  commit(); syncFocus(); S.tagKey = "";
  toast(isFav(w) ? "Added to favorites" : "Removed from favorites");
}
function syncFocus() {
  const box = S.el.querySelector(".focus"), p = S.focus;
  S.el.classList.toggle("focused", !!p);
  if (!p) { box.innerHTML = ""; return; }
  const w = p.work, a = p.a, idx = S.panels.indexOf(p) + 1, fav = isFav(w);
  box.innerHTML = `<span class="pa">${esc(w.artistName)}</span><h3 class="pt">${esc(w.title)}</h3>
    <dl><div><dt>seen</dt><dd>${seen(w)}×</dd></div><div><dt>added</dt><dd>${esc(w.added || "—")}</dd></div>${a ? `<div><dt>size</dt><dd>${a.w} × ${a.h}</dd></div>` : ""}<div><dt>in view</dt><dd>${String(idx).padStart(2, "0")} / ${String(S.panels.length).padStart(2, "0")}</dd></div></dl>
    <div class="fa">
      <button class="hb${fav ? " on" : ""}" data-x="fav" aria-pressed="${fav}">${icon(`<path d="M8 13.5S2 10 2 5.8A3 3 0 0 1 8 4.4a3 3 0 0 1 6 1.4C14 10 8 13.5 8 13.5Z"/>`)}${fav ? "Favorited" : "Favorite"}</button>
      <button class="hb" data-x="full">${icon(`<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>`)}Full view</button>
    </div>
    <div class="fnav">
      <button class="hb" data-x="prev" aria-label="Previous work">${icon(`<path d="M10 3 5 8l5 5"/>`)}</button>
      <button class="back" data-x="back">back to the hall <kbd>Esc</kbd></button>
      <button class="hb" data-x="next" aria-label="Next work">${icon(`<path d="m6 3 5 5-5 5"/>`)}</button>
    </div>`;
  if (motionEnabled()) animate(box.children, { opacity: [0, 1], translateX: [18, 0], delay: stagger(55, { start: 260 }), duration: 700, ease: "outExpo" });
}

function nearest() {
  let best = null;
  S.panels.forEach((p, i) => {
    if (!p.a || p.pose.fade < 0.5 || p.u.uReveal.value < 0.5) return;
    const d = S.camera.position.distanceToSquared(p.mesh.position);
    if (!best || d < best.d) best = { p, i, d };
  });
  return best;
}
function pick() {
  if (Math.abs(S.mouse.x) > 1) return null;
  S.ray.setFromCamera(S.mouse, S.camera);
  const hits = S.ray.intersectObjects(S.panels.filter((p) => p.a && p.pose.fade > 0.3 && p.u.uReveal.value > 0.3).map((p) => p.mesh), false);
  return hits[0]?.object.userData.p || null;
}

/* ---------- HUD ---------- */
function syncHud() {
  if (!S) return;
  const el = S.el, n = isSalon() ? S.sal.hung.length : S.panels.length;
  el.classList.toggle("salon", isSalon());
  el.querySelectorAll("[data-x=form]").forEach((b) => { const on = b.dataset.f === ui.form; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  const pb = el.querySelector("[data-x=pause]");
  pb.innerHTML = ui.paused ? `${icon(`<path d="M4.5 2.5v11l9-5.5z"/>`)}Resume` : `${icon(`<path d="M5 2.5v11M11 2.5v11"/>`)}Pause`;
  pb.setAttribute("aria-pressed", ui.paused);
  el.querySelector("[data-x=every]").value = String(ui.every);
  el.querySelector(".hint").textContent = FORMS[ui.form].hint + (isSalon() ? "" : " · ← → to step");
  el.querySelector(".rf").textContent = FORMS[ui.form].label;
  S.renderer.domElement.setAttribute("aria-label", `3D gallery: ${plural(n, "work")} in the ${FORMS[ui.form].label} formation. Click a work or use the arrow keys to look closer.`);
  const empty = el.querySelector(".empty-hall");
  empty.hidden = n > 0;
  if (!n) empty.innerHTML = ui.room === "♥" ? "No favorites here yet — open a work and press <b>Favorite</b>." : "Nothing in this room yet.";
}
const proj = new THREE.Vector3();
function toScreen(obj, lx, ly) {
  proj.set(lx, ly, 0).applyMatrix4(obj.matrixWorld).project(S.camera);
  return { x: (proj.x * 0.5 + 0.5) * S.el.clientWidth, y: (-proj.y * 0.5 + 0.5) * S.el.clientHeight, behind: proj.z > 1 };
}
function drawHud(now) {
  const el = S.el;
  if (isSalon()) {
    const n = S.sal.hung.length;
    el.classList.remove("tagged");
    el.querySelector(".ri").textContent = `${String(n).padStart(2, "0")} / ${String(S.list.length).padStart(2, "0")}`;
    const st = now < S.statusUntil ? S.status : ui.paused ? "paused" : `next change in ${Math.ceil(S.left)}s`, rs = el.querySelector(".rs");
    if (rs.textContent !== st) rs.textContent = st;
    el.querySelector(".bar > i").style.transform = `scaleX(${ui.paused ? 0 : 1 - S.left / ui.every})`;
    return;
  }
  const n = S.panels.length, near = nearest();
  const subj = S.focus ? null : S.hover || near?.p;
  const tag = el.querySelector(".tag"), leader = el.querySelector(".leader");
  if (subj?.work && subj.u.uReveal.value > 0.6 && subj.pose.fade > 0.5) {
    const w = subj.work, key = w.url + (subj === S.hover) + isFav(w) + seen(w);
    if (key !== S.tagKey) {
      S.tagKey = key;
      tag.querySelector(".pa").textContent = w.artistName;
      tag.querySelector(".pt").textContent = w.title;
      tag.querySelector(".ps").textContent = `${isFav(w) ? "♥ · " : ""}seen ${seen(w)}× · ${subj === S.hover ? "click to look closer" : "now in front"}`;
    }
    const s = toScreen(subj.mesh, 0.5, 0.5), W = el.clientWidth, tw = tag.offsetWidth, th = tag.offsetHeight;
    const flip = s.x + 40 + tw > W - 12;
    const lx = flip ? s.x - 40 - tw : s.x + 40, ly = Math.max(60, s.y - 44 - th);
    tag.style.transform = `translate(${lx}px, ${ly}px)`;
    const ex = flip ? lx + tw : lx, ey = ly + th + 4;
    leader.querySelector("path").setAttribute("d", `M${s.x} ${s.y} L${ex} ${ey} L${flip ? lx : lx + tw} ${ey}`);
    leader.querySelector("circle").setAttribute("cx", s.x); leader.querySelector("circle").setAttribute("cy", s.y);
    el.classList.toggle("tagged", !s.behind);
  } else el.classList.remove("tagged");

  const idx = (S.focus ? S.panels.indexOf(S.focus) : near?.i ?? -1) + 1;
  el.querySelector(".ri").textContent = `${String(idx).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
  const st = now < S.statusUntil ? S.status : ui.paused ? "paused" : S.focus ? "holding still" : `next print in ${Math.ceil(S.left)}s`;
  const rs = el.querySelector(".rs");
  if (rs.textContent !== st) rs.textContent = st;
  el.querySelector(".bar > i").style.transform = `scaleX(${ui.paused || S.focus ? 0 : 1 - S.left / ui.every})`;
}

/* ---------- the frame loop (stops by itself when you leave the tab) ---------- */
function frame(now) {
  if (!S.el.isConnected) { S.raf = 0; return; }
  S.raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - S.last) / 1000 || 0.016);
  S.last = now;
  const moving = motionEnabled();
  if (isSalon()) {   // the flat wall needs no WebGL: just its own clock
    if (!ui.paused && !document.hidden && !ui.lb && S.sal.hung.length) { S.left -= dt; if (S.left <= 0) { S.left = ui.every; swapSalon(); } }
    return drawHud(now);
  }
  if (!moving && now > S.wake && !S.tweens.length) return;   // Motion off: draw only when something happens

  runTweens(now);
  S.uTime.value = now / 1000;
  const n = S.panels.length;

  // the formation's own motion
  const still = !moving || S.focus || S.drag;
  if (moving && !S.focus) S.ft += dt;
  if (!S.drag) { S.vel *= Math.exp(-dt * 2.4); if (Math.abs(S.vel) < 1e-4) S.vel = 0; }
  if (S.thetaGoal != null) S.theta += (S.thetaGoal - S.theta) * damp(4, dt);
  if (S.scrollGoal != null) S.scroll += (S.scrollGoal - S.scroll) * damp(3.5, dt);
  if (!S.drag && S.thetaGoal == null && S.scrollGoal == null) {
    const auto = still ? 0 : S.hover ? 0.25 : 1;
    if (ui.form === "drift") S.scroll += (0.55 * auto + S.vel) * dt;
    else { S.theta += (0.05 * auto + S.vel) * dt; if (ui.form === "helix") S.hphase += 0.035 * auto * dt; }
  }

  S.panels.forEach((p, i) => {
    p.w += (p.wGoal - p.w) * damp(5, dt); p.h += (p.hGoal - p.h) * damp(5, dt);
    p.dim += ((S.focus && p !== S.focus ? 0.14 : 1) - p.dim) * (moving ? damp(5, dt) : 1);
    place(p, i, n, now);
  });
  S.dying.forEach(pose3);

  // camera: glide toward the formation's viewpoint, or up to the focused work
  const cam = S.camera, mx = S.inside && !S.drag ? S.mouse.x : 0, my = S.inside && !S.drag ? S.mouse.y : 0;
  if (S.focus) {
    const f = S.focus, { x, y, z, ry } = f.pose, nx = Math.sin(ry), nz = Math.cos(ry), half = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const wide = S.el.clientWidth > 860, usable = wide ? 0.62 : 1;
    const dist = Math.max(f.h * 1.3, (f.w * 1.3) / (cam.aspect * usable)) / (2 * half);
    const shift = wide ? dist * half * cam.aspect * 0.33 : 0;
    S.goalLook.set(x + Math.cos(ry) * shift, y - (wide ? 0 : f.h * 0.3), z - Math.sin(ry) * shift);
    S.goalPos.set(S.goalLook.x + nx * dist, S.goalLook.y + 0.05, S.goalLook.z + nz * dist);
  } else if (ui.form === "orbit") {
    S.goalPos.set(mx * 0.7, 2.15 + my * 0.35, ringR(n) + 6.6); S.goalLook.set(0, 1.25, 0);
  } else if (ui.form === "helix") {
    const cy = 1.3 + (helixTop(n) - 1.3) * (0.5 - 0.5 * Math.cos(S.hphase));
    S.goalPos.set(mx * 0.7, cy + 0.9 + my * 0.3, HR + 7.6); S.goalLook.set(0, cy, 0);
  } else { S.goalPos.set(mx * 0.6, 1.6 + my * 0.25, 7.6); S.goalLook.set(mx * 0.4, 1.35, -6); }
  const k = moving ? damp(S.focus ? 3.2 : 2.4, dt) : 1;
  S.camPos.lerp(S.goalPos, k); S.camLook.lerp(S.goalLook, k);
  cam.position.copy(S.camPos); cam.lookAt(S.camLook);
  cam.updateMatrixWorld();
  S.scene.updateMatrixWorld();

  // hover
  const hit = S.inside && !S.drag ? pick() : null;
  if (hit !== S.hover) { S.hover = hit; S.tagKey = ""; }
  S.renderer.domElement.style.cursor = S.hover ? "pointer" : S.drag ? "grabbing" : "grab";
  S.panels.forEach((p) => {
    const on = p === S.hover || p === S.focus ? 1 : 0;
    p.u.uHover.value += (on - p.u.uHover.value) * (moving ? damp(8, dt) : 1);
    p.scale += ((p === S.hover && !S.focus ? 1.05 : 1) - p.scale) * (moving ? damp(9, dt) : 1);
  });

  // floor
  const fu = S.floorU;
  fu.uMode.value = ui.form === "drift" ? 1 : 0;
  fu.uR.value += ((ui.form === "orbit" ? ringR(n) : HR) - fu.uR.value) * damp(3, dt);
  fu.uScroll.value = S.scroll;
  if (fu.uPulse.value >= 0) { fu.uPulse.value += dt * 0.7; if (fu.uPulse.value > 2) fu.uPulse.value = -1; }

  // the sky follows whatever is in front of you
  if (now - S.palAt > 700) {
    S.palAt = now;
    const subj = S.focus || nearest()?.p;
    if (subj?.a && subj.work.url !== S.palUrl) {
      S.palUrl = subj.work.url;
      const others = S.panels.filter((p) => p !== subj && p.a && p.pose.fade > 0.5)
        .sort((a, b) => cam.position.distanceToSquared(a.mesh.position) - cam.position.distanceToSquared(b.mesh.position)).slice(0, 2);
      paletteFrom([subj.a.tone, ...others.map((p) => p.a.tone)]);
      fu.uGlow.value.setRGB(...lift(subj.a.tone.vivid, 0.3).map((v) => v / 255));
      S.el.style.setProperty("--art", hex(lift(subj.a.tone.vivid, 0.4)));
    }
  }

  // every few seconds a work changes
  if (!ui.paused && !S.focus && !document.hidden && !ui.lb && n) {
    S.left -= dt;
    if (S.left <= 0) { S.left = ui.every; reprint(); }
  }

  S.renderer.render(S.scene, cam);
  drawHud(now);
}
function start() {
  if (S.raf) return;
  S.last = performance.now(); wake();
  S.raf = requestAnimationFrame(frame);
}

addEventListener("keydown", (e) => {
  if (!S?.el.isConnected || ui.lb || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); stepFocus(k === "ArrowRight" ? 1 : -1); }
  else if (k === "Escape" && S.focus) unfocus();
  else if (k.toLowerCase() === "f" && S.focus) toggleFocusFav();
  else if (k === "Enter" && S.focus && !e.target.closest?.("button")) { const list = S.panels.map((p) => p.work).filter(Boolean); openViewer(list, list.indexOf(S.focus.work)); }
  else return;
  wake();
});

/* ---------- full-screen viewer (from a focused work or the archive) ---------- */
function openViewer(list, idx) { ui.lb = { list, idx }; drawViewer(); }
function drawViewer() {
  document.querySelector(".viewer")?.remove();
  if (!ui.lb) return;
  const { list, idx } = ui.lb, w = list[idx];
  document.body.insertAdjacentHTML("beforeend", `<div class="viewer" role="dialog" aria-label="${esc(w.title)}">
    <button class="vx" data-v="close" aria-label="Close">×</button>
    <button class="vnav l" data-v="prev" aria-label="Previous">‹</button>
    <figure><img src="${esc(w.url)}" alt="${esc(w.title)}" /><figcaption><span class="pa">${esc(w.artistName)}</span><span class="pt">${esc(w.title)}</span>
      <span class="ps">${idx + 1} of ${list.length} · seen ${seen(w)}× · added ${esc(w.added)}</span>
      <button class="btn ${isFav(w) ? "" : "ghost"} sm" data-v="fav">${isFav(w) ? "♥ Favorite" : "♡ Favorite"}</button></figcaption></figure>
    <button class="vnav r" data-v="next" aria-label="Next">›</button></div>`);
  const v = document.querySelector(".viewer");
  if (motionEnabled()) animate(v.querySelector("img"), { opacity: [0, 1], scale: [0.97, 1], duration: 500, ease: "outQuart" });
  v.onclick = (e) => {
    const a = e.target.closest("[data-v]")?.dataset.v;
    if (!a && e.target === v) return closeViewer();
    if (a === "close") closeViewer(); else if (a === "prev") step(-1); else if (a === "next") step(1); else if (a === "fav") toggleFav();
  };
}
function step(d) { const lb = ui.lb; lb.idx = (lb.idx + d + lb.list.length) % lb.list.length; drawViewer(); }
function closeViewer() { ui.lb = null; document.querySelector(".viewer")?.remove(); appRef?.refresh(); }
function toggleFav() {
  const w = ui.lb.list[ui.lb.idx], f = state().favorites;
  state().favorites = isFav(w) ? f.filter((u) => u !== w.url) : [...f, w.url];
  commit(); drawViewer(); toast(isFav(w) ? "Added to favorites" : "Removed from favorites");
}
addEventListener("keydown", (e) => {
  if (!ui.lb) return;
  if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1); else if (e.key.toLowerCase() === "f") toggleFav();
});

export default {
  id: "gallery", label: "Gallery", color: "var(--amber)",
  count: () => works.length || null,
  render(root, app, focus) {
    appRef = app;
    if (typeof focus === "string" && focus.startsWith("room:")) { ui.room = focus.slice(5); ui.mode = "exhibit"; }   // e.g. from a book's author
    if (!catalog) {
      root.innerHTML = `<div class="page-h"><h1>Gallery</h1><span class="sub">opening the hall…</span></div>`;
      load().then(() => { if (document.documentElement.dataset.mood === "gallery") app.refresh(); });
      return;
    }
    const unseen = works.filter((w) => !seen(w)).length;
    const artists = catalog.map((a) => a.artist);
    if (ui.room !== "all" && ui.room !== "♥" && !artists.includes(ui.room)) ui.room = "all";
    const cover = (a) => works.find((w) => w.artist === a)?.url || "";
    const st = ui.mode === "exhibit" && works.length ? stage() : null;

    root.innerHTML = `<div class="page-h"><h1>Gallery</h1><span class="sub">${plural(works.length, "work")} · ${plural(artists.length, "artist")} · ${unseen ? `${unseen} you haven't seen yet` : "you've seen them all — add more to images/"}</span><span class="sp"></span>
        <div class="seg"><button class="${ui.mode === "exhibit" ? "on" : ""}" data-act="mode" data-m="exhibit">Exhibition</button><button class="${ui.mode === "archive" ? "on" : ""}" data-act="mode" data-m="archive">Archive</button></div></div>
      <div class="rooms">
        <button class="room${ui.room === "all" ? " on" : ""}" data-act="room" data-r="all"><span class="rc all"></span>All rooms<em>${works.length}</em></button>
        ${artists.map((a) => `<button class="room${ui.room === a ? " on" : ""}" data-act="room" data-r="${esc(a)}"><span class="rc" style="background-image:url('${esc(cover(a))}')"></span>${esc(titleCase(a))}<em>${works.filter((w) => w.artist === a).length}</em></button>`).join("")}
        ${state().favorites.length ? `<button class="room${ui.room === "♥" ? " on" : ""}" data-act="room" data-r="♥"><span class="rc fav">♥</span>Favorites<em>${state().favorites.length}</em></button>` : ""}
      </div>
      ${!works.length ? `<div class="soon-page"><h2>The hall is empty</h2>Put pictures in <code>app\\images\\&lt;artist name&gt;\\</code> and they'll hang here.</div>`
        : ui.mode === "exhibit" ? (st ? `<div class="stage-host"></div>` : `<div class="soon-page"><h2>3D isn't available here</h2>This browser couldn't start WebGL — the Archive still shows everything.</div>`)
        : `<div class="archive">${artists.filter((a) => ui.room === "all" || ui.room === a || (ui.room === "♥" && works.some((w) => w.artist === a && isFav(w)))).map((a) => {
            const list = works.filter((w) => w.artist === a && inRoom(w));
            return `<section class="wing"><header><h2>${esc(titleCase(a))}</h2><span>${plural(list.length, "work")}</span></header>
              <div class="masonry">${list.map((w) => `<button class="tile-art" data-act="view" data-url="${esc(w.url)}"><img src="${esc(w.url)}" alt="${esc(w.title)}" loading="lazy" /><span>${esc(w.title)}${isFav(w) ? " ♥" : ""}<em>seen ${seen(w)}×</em></span></button>`).join("")}</div></section>`; }).join("")}</div>`}`;

    const host = root.querySelector(".stage-host");
    if (host) {
      host.append(st.el);
      st.list = works.filter(inRoom);
      const fresh = app.entering || st.room !== ui.room || (isSalon() ? st.sal.hung.length : st.panels.length) !== count();
      if (fresh) { st.room = ui.room; hang(app.entering || !st.panels.length); }
      else syncFocus();
      syncHud(); fit(); start();
    }

    root.onclick = (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      switch (b.dataset.act) {
        case "mode": ui.mode = b.dataset.m; return app.refresh();
        case "room": ui.room = b.dataset.r; if (S) S.room = null; return app.refresh();
        case "view": { const list = works.filter(inRoom); return openViewer(list, list.findIndex((w) => w.url === b.dataset.url)); }
      }
    };
  },
};
