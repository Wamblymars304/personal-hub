// Living background: a three.js field of soft glowing particles over a gradient sky.
// Drifts slowly, leans away from the cursor, glows warmer at dusk, and changes mood per tab.
// pulse(x, y, color) throws a little burst of light from a point on screen (used on check-offs).
import * as THREE from "../vendor/three.module.min.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let motionOn = !reduce;
try { if (localStorage.getItem("hub.motion") === "off") motionOn = false; } catch {}

/* Each tab gets its own sky and light colours. a/b/c = particle colours, glow = horizon light. */
const MOODS = {
  dashboard: { top: "#0b0a1d", bot: "#1b0f22", glow: "#ff9a4d", a: "#b9a6ff", b: "#ffb347", c: "#7fd8e6" },
  blogs:     { top: "#071211", bot: "#0f1d19", glow: "#7fe0a8", a: "#8ff0c8", b: "#f3e9c6", c: "#8fd8ff" },
  media:     { top: "#130611", bot: "#220b19", glow: "#ff4fa3", a: "#ff9fd6", b: "#c49bff", c: "#ffb347" },
  schedule:  { top: "#051019", bot: "#0b1c29", glow: "#22d3ee", a: "#7fd8e6", b: "#b9a6ff", c: "#e8f4ff" },
  reminders: { top: "#140807", bot: "#22100c", glow: "#ff5a3c", a: "#ff8a6b", b: "#ffcf4a", c: "#ffd8c2" },
  projects:  { top: "#0c0820", bot: "#170d2e", glow: "#8b5cf6", a: "#b9a6ff", b: "#8fd8ff", c: "#ff9fd6" },
  hobbies:   { top: "#06120a", bot: "#0d1f12", glow: "#b8ff3c", a: "#d4ff7a", b: "#8ff0c8", c: "#ffe28a" },
  pomodoro:  { top: "#031a1c", bot: "#0a3634", glow: "#ff9f5a", a: "#7fd8e6", b: "#ff9f5a", c: "#e9fff4" },
  analytics: { top: "#060b14", bot: "#0d1626", glow: "#5fe6ff", a: "#5fe6ff", b: "#b9a6ff", c: "#e8edf5" },
  finance:   { top: "#04120d", bot: "#0b1f17", glow: "#ffd36e", a: "#7fe0a8", b: "#ffd36e", c: "#b8f3d8" },
  diet:      { top: "#150c05", bot: "#24140a", glow: "#ffb347", a: "#ffb38a", b: "#ffe28a", c: "#ff9fd6" },
  wisdom:    { top: "#0f0b05", bot: "#1c140a", glow: "#ffcf4a", a: "#ffe7a8", b: "#ffcf4a", c: "#c49bff" },
  diary:     { top: "#120c08", bot: "#22150d", glow: "#ff9a5a", a: "#ffd2a8", b: "#ff9a5a", c: "#f3e9c6" },
  review:    { top: "#06111a", bot: "#0d1b28", glow: "#5fe6ff", a: "#7fd8e6", b: "#b9a6ff", c: "#ffd36e" },
  places:    { top: "#0b0a18", bot: "#1a0e1c", glow: "#ff7a9a", a: "#ffb3c4", b: "#7fd8e6", c: "#ffd36e" },
  atmospheres: { top: "#08070f", bot: "#120f22", glow: "#9d8cff", a: "#c7bcff", b: "#8fd8ff", c: "#ffd9f2" },
  skills:    { top: "#070a14", bot: "#0e1322", glow: "#a8c4ff", a: "#c9d8ff", b: "#ffd9a0", c: "#e8edf5" },
  bucket:    { top: "#0d0a07", bot: "#1c140b", glow: "#ffd9a0", a: "#ffd9a0", b: "#ffb38a", c: "#e8edf5" },
  challenge: { top: "#0d0a08", bot: "#1a130d", glow: "#f3dcae", a: "#f3dcae", b: "#c9a77a", c: "#e8edf5" },
  music:     { top: "#060814", bot: "#0e0a1f", glow: "#4fd8ff", a: "#7fd8e6", b: "#ff8fc8", c: "#c7bcff" },
  dreams:    { top: "#05041a", bot: "#110b2e", glow: "#8f7bff", a: "#c7bcff", b: "#7fd8e6", c: "#ffd9f2" },
  notes:     { top: "#0b0d10", bot: "#15181d", glow: "#9fd3e0", a: "#dfe8ee", b: "#9fd3e0", c: "#f3e9c6" },
  gallery:   { top: "#08070b", bot: "#120e14", glow: "#ffd9a0", a: "#ffe9c9", b: "#ffd9a0", c: "#c9d6ff" },
};

const canvas = document.createElement("canvas");
canvas.id = "bg";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" }); }
catch { canvas.remove(); }

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
camera.position.z = 5;
const col = (h) => new THREE.Color(h);

/* sky: vertical gradient + horizon glow + faint grain */
const skyU = { uTop: { value: col("#0b0a1d") }, uBot: { value: col("#1b0f22") }, uGlow: { value: col("#ff9a4d") }, uTime: { value: 0 }, uAspect: { value: 1 } };
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: skyU, depthWrite: false,
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  fragmentShader: `uniform vec3 uTop, uBot, uGlow; uniform float uTime, uAspect; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, vUv.y));
      vec2 g = vec2((vUv.x - 0.72) * uAspect, vUv.y + 0.12);
      c += uGlow * 0.16 * exp(-dot(g, g) * 2.2);
      vec2 g2 = vec2((vUv.x - 0.08) * uAspect, vUv.y - 1.05);
      c += uGlow * 0.05 * exp(-dot(g2, g2) * 3.0);
      c += (h(vUv * 900.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
sky.renderOrder = -1;
scene.add(sky);

/* particle field: positions animate entirely on the GPU */
const N = 1400;
const seeds = new Float32Array(N * 4), base = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  base.set([Math.random() * 2.4 - 1.2, Math.random() * 2.2 - 1.1, 0], i * 3);
  seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
}
const fieldGeo = new THREE.BufferGeometry();
fieldGeo.setAttribute("position", new THREE.BufferAttribute(base, 3));
fieldGeo.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
const fieldU = { uTime: { value: 0 }, uMouse: { value: new THREE.Vector2(9, 9) }, uAspect: { value: 1 }, uScale: { value: 1 },
  uA: { value: col("#b9a6ff") }, uB: { value: col("#ffb347") }, uC: { value: col("#7fd8e6") }, uEnergy: { value: 1 } };
const field = new THREE.Points(fieldGeo, new THREE.ShaderMaterial({
  uniforms: fieldU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute vec4 seed; uniform float uTime, uAspect, uScale, uEnergy; uniform vec2 uMouse; uniform vec3 uA, uB, uC;
    varying vec3 vCol; varying float vAlpha;
    void main(){
      float t = uTime * (0.025 + seed.y * 0.05) * uEnergy;
      vec2 p = position.xy;
      p.x += sin(t * 6.2831 + seed.x * 40.0) * 0.06 + sin(uTime * 0.03 + p.y * 2.0) * 0.04;
      p.y = mod(position.y + t * 0.35 + 1.1, 2.2) - 1.1;  // slow rise, wraps top to bottom
      vec2 d = vec2((p.x - uMouse.x) * uAspect, p.y - uMouse.y);
      float f = smoothstep(0.32, 0.0, length(d));
      p += normalize(d + 1e-4) * f * 0.07 / vec2(uAspect, 1.0);
      gl_Position = vec4(p, 0.0, 1.0);
      float big = step(0.975, seed.w);
      gl_PointSize = (1.4 + seed.x * 3.2 + big * 9.0) * uScale;
      vCol = seed.y < 0.5 ? mix(uA, uC, seed.x) : mix(uB, uA, seed.x * 0.4);
      if (big > 0.5) vCol = uB;
      vAlpha = (0.18 + 0.55 * (0.5 + 0.5 * sin(uTime * (0.6 + seed.z * 1.4) + seed.w * 30.0))) * (0.55 + big * 0.45) + f * 0.4;
    }`,
  fragmentShader: `varying vec3 vCol; varying float vAlpha;
    void main(){ vec2 q = gl_PointCoord - 0.5; float d = dot(q, q); if (d > 0.25) discard;
      float a = exp(-d * 18.0) * vAlpha; gl_FragColor = vec4(vCol * a, a); }`,
}));
scene.add(field);

/* bursts (CPU, short-lived) */
const MAXB = 360;
const bPos = new Float32Array(MAXB * 3), bCol = new Float32Array(MAXB * 3), bLife = new Float32Array(MAXB), bVel = new Float32Array(MAXB * 2);
const burstGeo = new THREE.BufferGeometry();
burstGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
burstGeo.setAttribute("color", new THREE.BufferAttribute(bCol, 3));
burstGeo.setAttribute("life", new THREE.BufferAttribute(bLife, 1));
const burstU = { uScale: { value: 1 } };
const bursts = new THREE.Points(burstGeo, new THREE.ShaderMaterial({
  uniforms: burstU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute vec3 color; attribute float life; uniform float uScale; varying vec3 vC; varying float vL;
    void main(){ vC = color; vL = life; gl_Position = vec4(position.xy, 0.0, 1.0); gl_PointSize = (2.0 + 5.0 * life) * uScale; }`,
  fragmentShader: `varying vec3 vC; varying float vL; void main(){ vec2 q = gl_PointCoord - 0.5; float d = dot(q,q); if (d > 0.25 || vL <= 0.0) discard;
    float a = exp(-d * 14.0) * vL; gl_FragColor = vec4(vC * a, a); }`,
}));
scene.add(bursts);
let bNext = 0;

export function pulse(x, y, color = "#ffb347", count = 42) {
  if (!renderer) return;
  const c = col(getComputedStyle(document.documentElement).getPropertyValue(color.replace(/^var\((.*)\)$/, "$1")).trim() || color);
  const nx = (x / innerWidth) * 2 - 1, ny = -(y / innerHeight) * 2 + 1;
  for (let k = 0; k < count; k++) {
    const i = bNext++ % MAXB, a = Math.random() * Math.PI * 2, s = 0.004 + Math.random() * 0.012;
    bPos.set([nx, ny, 0], i * 3); bCol.set([c.r, c.g, c.b], i * 3);
    bVel[i * 2] = (Math.cos(a) * s) / (innerWidth / innerHeight); bVel[i * 2 + 1] = Math.sin(a) * s;
    bLife[i] = 0.7 + Math.random() * 0.3;
  }
  if (!motionOn) draw(performance.now());
}

/* mood transitions: ease uniforms toward the target palette */
let target = MOODS.dashboard;
export function setMood(id) {
  target = MOODS[id] || MOODS.dashboard;
  document.documentElement.dataset.mood = id;
}
/** Glide the sky and particles toward a custom palette (the Gallery uses the colors of the art on the wall). */
export function setPalette(p) {
  target = { ...target, ...p };
  settle();
}
function tint(hex, hour) { // dashboard sky follows the clock: lighter mornings, deep nights
  const c = col(hex);
  if (hour >= 6 && hour < 11) c.lerp(col("#2a3a66"), 0.35);
  else if (hour >= 11 && hour < 17) c.lerp(col("#1f2f55"), 0.25);
  else if (hour >= 22 || hour < 5) c.multiplyScalar(0.75);
  return c;
}
function stepMood(k) {
  const h = new Date().getHours(), dash = document.documentElement.dataset.mood === "dashboard";
  skyU.uTop.value.lerp(dash ? tint(target.top, h) : col(target.top), k);
  skyU.uBot.value.lerp(dash ? tint(target.bot, h) : col(target.bot), k);
  skyU.uGlow.value.lerp(col(target.glow), k);
  fieldU.uA.value.lerp(col(target.a), k); fieldU.uB.value.lerp(col(target.b), k); fieldU.uC.value.lerp(col(target.c), k);
}

addEventListener("pointermove", (e) => fieldU.uMouse.value.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
addEventListener("pointerleave", () => fieldU.uMouse.value.set(9, 9));
function resize() {
  if (!renderer) return;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  skyU.uAspect.value = fieldU.uAspect.value = innerWidth / innerHeight;
  fieldU.uScale.value = burstU.uScale.value = dpr * Math.min(1.4, Math.max(0.8, innerHeight / 900));
}
addEventListener("resize", resize);
resize();

let last = performance.now();
function draw(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  skyU.uTime.value = fieldU.uTime.value = now / 1000;
  stepMood(1 - Math.pow(0.02, dt)); // ~1.2 s glide between moods
  let live = false;
  for (let i = 0; i < MAXB; i++) {
    if (bLife[i] <= 0) continue;
    live = true;
    bPos[i * 3] += bVel[i * 2]; bPos[i * 3 + 1] += bVel[i * 2 + 1];
    bVel[i * 2] *= 0.94; bVel[i * 2 + 1] = bVel[i * 2 + 1] * 0.94 - 0.00012;
    bLife[i] -= dt * 0.9;
  }
  if (live) { burstGeo.attributes.position.needsUpdate = burstGeo.attributes.life.needsUpdate = burstGeo.attributes.color.needsUpdate = true; }
  renderer.render(scene, camera);
}
function loop(now) {
  if (motionOn && !document.hidden) draw(now);
  requestAnimationFrame(loop);
}
if (renderer) {
  stepMood(1); draw(performance.now());
  requestAnimationFrame(loop);
}

export function setMotion(on) {
  motionOn = on;
  try { localStorage.setItem("hub.motion", on ? "on" : "off"); } catch {}
  if (!on && renderer) { stepMood(1); draw(performance.now()); }
}
export const motionEnabled = () => motionOn;
// a static redraw after a mood change when motion is off
export function settle() { if (!motionOn && renderer) { stepMood(1); draw(performance.now()); } }
