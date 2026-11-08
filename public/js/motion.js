// Motion helpers built on anime.js. Everything checks the Motion switch, so turning it off
// leaves every number, ring and panel in its final state with no animation.
import { animate, stagger } from "../vendor/anime.esm.min.js";
import { motionEnabled } from "./background.js";

/** animate(), except a selector list that matched nothing is skipped (anime.js warns on empty targets, e.g. a fresh hub) */
export const animateAny = (targets, params) => (targets instanceof NodeList && !targets.length ? null : animate(targets, params));

const on = () => motionEnabled();

/** Panels float up into place one after another when you open a tab. */
export function reveal(root) {
  if (!on()) return;
  const items = root.querySelectorAll(".page-h, .addbar, .tiles > *, .card, .kpi, .toolbar, .cal, .queue");
  if (!items.length) return;
  animate(items, { opacity: [0, 1], translateY: [22, 0], scale: [0.985, 1], delay: stagger(45, { start: 40 }), duration: 850, ease: "outExpo" });
}

/** Numbers count up from zero. el.dataset.count = target; fmt turns a number into text. */
export function countUp(root, fmt) {
  root.querySelectorAll("[data-count]").forEach((el, i) => {
    const to = +el.dataset.count, f = fmt[el.dataset.fmt || "int"] || fmt.int;
    if (!on() || !to) { el.textContent = f(to); return; }
    const o = { v: 0 };
    el.textContent = f(0);
    animate(o, { v: to, duration: 1400, delay: 120 + i * 60, ease: "outExpo", onUpdate: () => (el.textContent = f(o.v)) });
  });
}

/** Rings and arcs draw themselves in. Each [data-ring] is an SVG path/circle with pathLength=100 and data-ring = percent. */
export function drawRings(root, only) {
  root.querySelectorAll(only || "[data-ring]").forEach((el, i) => {
    const pct = Math.max(0, Math.min(100, +el.dataset.ring || 0));
    const end = 100 - pct;
    if (!on()) { el.style.strokeDashoffset = end; return; }
    el.style.strokeDashoffset = 100;
    animate(el, { strokeDashoffset: [100, end], duration: 1500, delay: 200 + i * 70, ease: "outQuart" });
  });
}

/** Sparklines trace from left to right. */
export function drawLines(root) {
  root.querySelectorAll("path[data-draw]").forEach((el, i) => {
    if (!on()) { el.style.strokeDashoffset = 0; return; }
    animate(el, { strokeDashoffset: [1, 0], duration: 1600, delay: 300 + i * 80, ease: "inOutQuad" });
  });
  root.querySelectorAll("[data-grow]").forEach((el, i) => {
    if (!on()) return;
    animate(el, { scaleY: [0, 1], duration: 900, delay: 300 + i * 25, ease: "outBack(1.4)" });
  });
}

/** A little celebratory bounce. */
export function pop(el) {
  if (!el || !on()) return;
  animate(el, { scale: [1, 1.12, 1], duration: 650, ease: "outElastic(1, .5)" });
}
