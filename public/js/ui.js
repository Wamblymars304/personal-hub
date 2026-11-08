// Small view helpers shared by every tab.
import { parseDate, today, daysFromToday } from "./store.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const COLORS = { purple: "var(--purple)", cyan: "var(--cyan)", orange: "var(--orange)", pink: "var(--pink)", green: "var(--green)", red: "var(--red)", amber: "var(--amber)", slate: "var(--slate)" };
export const PRIORITY = { High: COLORS.red, Medium: COLORS.orange, Low: COLORS.green, high: COLORS.red, medium: COLORS.orange, low: COLORS.green };

export function fmtDate(s, opts = {}) {
  const d = parseDate(s);
  if (!d) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear && !opts.year ? {} : { year: "numeric" }) });
}
export function relDay(s) {
  const n = daysFromToday(s);
  if (n == null) return "";
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n < 0 ? `${-n}d overdue` : `in ${n}d`;
}
export const money = (n) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const plural = (n, w) => `${n} ${n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w + "s"}`;
export const host = (u) => ((u || "").match(/https?:\/\/(?:www\.)?([^\/\s)]+)/) || [, ""])[1];
export const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

export const badge = (text, color) => `<span class="badge" style="--c:${color}">${esc(text)}</span>`;
export const chip = (text, on, attrs = "") => `<button class="chip${on ? " on" : ""}" ${attrs}>${text}</button>`;
export const empty = (text) => `<div class="empty">${text}</div>`;

export function section(title, body, { right = "", sub = "", cls = "" } = {}) {
  return `<section class="card ${cls}"><header class="card-h"><div><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="card-r">${right}</div></header><div class="card-b">${body}</div></section>`;
}

// "Show all N" toggle for long lists
export function capped(list, n, open, render, key) {
  const shown = open ? list : list.slice(0, n);
  return shown.map(render).join("") + (list.length > n
    ? `<button class="more" data-act="toggle-cap" data-key="${key}">${open ? "Show less" : `Show all ${list.length}`}</button>` : "");
}

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

export function flash(id) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1800);
  });
}

export const isToday = (s) => s === today();
