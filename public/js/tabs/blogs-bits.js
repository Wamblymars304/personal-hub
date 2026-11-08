// Blogs & Links helpers: shuffling, the monogram tiles that stand in for favicons, rich paper text,
// and the "reading over time" strip. Nothing here touches the network (no favicon services).
import { esc, host } from "../ui.js";
import { parseDate, iso, today } from "../store.js";

/** Fisher–Yates (the old sort(() => Math.random() - .5) was biased). */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const href = (u) => (/^https?:\/\//i.test(u) ? u : "https://" + u);
export const domainOf = (u) => (host(href(u || "")) || "").toLowerCase();

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const hueOf = (label, url) => hash(domainOf(url) || String(label || "").toLowerCase()) % 360;

/** A two-letter tile, hued from the link's domain (or its name when there's no link). */
export function monogram(label, url, cls = "") {
  const words = String(label || domainOf(url) || "?").replace(/[^\p{L}\p{N}\s]|\p{Lm}/gu, " ").trim().split(/\s+/).filter(Boolean);
  const w0 = words[0] || "?", latin = /^[\p{Script=Latin}\p{N}]/u.test(w0);   // CJK etc.: one character reads better than two
  const m = !latin ? [...w0][0] : words.length > 1 ? (w0[0] + words[1][0]).toUpperCase() : w0[0].toUpperCase() + (w0[1] || "").toLowerCase();
  return `<span class="bl-mono ${cls}" style="--h:${hueOf(label, url)}" aria-hidden="true">${esc(m)}</span>`;
}

/** Paper text: URLs, arXiv ids and DOIs become links; a leading list number becomes a quiet index. */
const TOK = /(https?:\/\/[^\s<>"']+)|\barXiv:\s?(\d{4}\.\d{4,5}(?:v\d+)?)|\b(10\.\d{4,9}\/[^\s<>"']+)/gi;
export function richPaper(text) {
  const t = String(text || "");
  const lead = t.match(/^(\d{1,4})[.)]?\s+(?=\S)/);
  const body = lead ? t.slice(lead[0].length) : t;
  let out = "", last = 0;
  for (const m of body.matchAll(TOK)) {
    let raw = m[0], trail = "";
    const tm = raw.match(/[.,;:!?]+$/) || (raw.endsWith(")") && !raw.includes("(") ? [")"] : null);
    if (tm) { trail = tm[0]; raw = raw.slice(0, -trail.length); }
    const url = m[1] ? raw : m[2] ? `https://arxiv.org/abs/${m[2]}` : `https://doi.org/${raw}`;
    const shown = m[1] ? raw.replace(/^https?:\/\/(www\.)?/i, "") : raw;
    out += esc(body.slice(last, m.index)) + `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(shown)}</a>` + esc(trail);
    last = m.index + m[0].length;
  }
  out += esc(body.slice(last));
  return (lead ? `<i class="bl-n">${esc(lead[1])}</i>` : "") + out;
}

/* ---------- reading over time: what you shelved (up) vs what you read (down), per week ---------- */
const monday = (s) => { const d = parseDate(s); if (!d) return null; d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export function rhythm(db) {
  const shelved = new Map(), read = new Map();
  const bump = (m, s, n = 1) => { const w = monday(s); if (w) m.set(w, (m.get(w) || 0) + n); };
  db.blogs.forEach((b) => bump(shelved, b.added));
  db.papers.forEach((p) => bump(shelved, p.added));
  db.papersRead.forEach((p) => bump(read, p.readAt));
  (db.blogsBatches || []).forEach((b) => (b.opened || []).length && bump(read, b.date, b.opened.length));
  const now = parseDate(monday(today()));
  const keys = [...shelved.keys(), ...read.keys()].sort();
  const start = new Date(now); start.setDate(start.getDate() - 7 * 25);                 // at least half a year
  const first = keys.length ? parseDate(keys[0]) : start;
  const from = new Date(Math.max(Math.min(first, start), now - 7 * 51 * 864e5));        // at most a year
  const weeks = [];
  for (const d = parseDate(monday(iso(from))); d <= now; d.setDate(d.getDate() + 7)) weeks.push(iso(d));
  const maxS = Math.max(1, ...weeks.map((w) => shelved.get(w) || 0)), maxR = Math.max(1, ...weeks.map((w) => read.get(w) || 0));
  let prevMonth = "";
  const cols = weeks.map((w) => {
    const s = shelved.get(w) || 0, r = read.get(w) || 0, d = parseDate(w), mon = d.toLocaleDateString("en-US", { month: "short" });
    const label = mon !== prevMonth ? (prevMonth = mon) : "";
    const tip = `week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${s} shelved · ${r} read`;
    return `<div class="bl-wk${w === iso(now) ? " now" : ""}" data-tip="${esc(tip)}">
      <i class="bl-up" style="--v:${s ? Math.max(0.06, Math.sqrt(s / maxS)).toFixed(3) : 0}"></i><i class="bl-dn" style="--v:${r ? Math.max(0.12, Math.sqrt(r / maxR)).toFixed(3) : 0}"></i>
      ${label ? `<em>${esc(label)}</em>` : ""}<span>${esc(tip)}</span></div>`;
  }).join("");
  const totS = [...shelved.values()].reduce((a, b) => a + b, 0), totR = [...read.values()].reduce((a, b) => a + b, 0);
  return { html: `<div class="bl-rh" role="img" aria-label="Shelved versus read, per week">${cols}</div>`, shelved: totS, read: totR };
}

export const ICON = {
  edit: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5L6 12.5H3.5V10z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  out: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
