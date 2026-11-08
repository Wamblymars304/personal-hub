// Chart helpers for the Analytics tab only (charts.js stays shared with Finance and untouched).
// Every mark that carries a value also carries a plain-text `data-tip` (shown with textContent by
// analytics.js) — tooltips enhance, they never gate: values are also in labels, legends or a table view.
import { esc } from "../ui.js";
import { parseDate } from "../store.js";

// Status palette (fixed meaning, always shipped with a text label): good / warning / critical.
export const STATUS = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" };

const nice = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v); };
const tip = (t) => ` data-tip="${esc(t)}"`;
const short = (s) => parseDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Daily score line, 0–100. pts: [{date, value|null, tip}] — null = no activity (a gap, ticked at the baseline).
 *  Hover/arrow keys move a crosshair that snaps to the nearest day (wired in analytics.js). */
export function trendSvg(pts, { W = 780, H = 272, ref = 70 } = {}) {
  const L = 30, R = 58, T = 12, B = 26, n = pts.length;
  const x = (i) => L + (n <= 1 ? 0 : ((W - L - R) * i) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / 100);
  const base = y(0), step = n > 1 ? x(1) - x(0) : W - L - R;
  let d = "", seg = [];
  const flush = () => { if (seg.length > 1) d += "M" + seg.join("L"); seg = []; };
  pts.forEach((p, i) => (p.value == null ? flush() : seg.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)));
  flush();
  const every = n <= 31 ? 7 : 14, r = n > 45 ? 3 : 4;
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v ? "gr" : "ax"}"/><text x="${L - 8}" y="${y(v) + 3.5}" class="yl">${v}</text>`).join("");
  const xl = pts.map((p, i) => ((n - 1 - i) % every === 0 ? `<text x="${x(i)}" y="${H - 6}" class="xl">${i === n - 1 ? "today" : short(p.date)}</text>` : "")).join("");
  const gaps = pts.map((p, i) => (p.value == null ? `<line x1="${x(i)}" x2="${x(i)}" y1="${base}" y2="${base - 4}" class="gap"/>` : "")).join("");
  const dots = pts.map((p, i) => (p.value != null ? `<circle cx="${x(i)}" cy="${y(p.value)}" r="${r}" class="dot"/>` : "")).join("");
  const hits = pts.map((p, i) => `<rect x="${(x(i) - step / 2).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${base - T}" class="hit" data-i="${i}" data-cx="${x(i).toFixed(1)}"${p.value != null ? ` data-cy="${y(p.value).toFixed(1)}"` : ""}${tip(p.tip)}/>`).join("");
  return `<svg class="an-chart an-trend" viewBox="0 0 ${W} ${H}" tabindex="0" role="img" data-n="${n}"
      aria-label="Daily productivity score for the last ${n} days. Use the left and right arrow keys to read each day.">
    ${grid}
    <line x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}" class="ref"/><text x="${W - R + 6}" y="${y(ref) + 3.5}" class="rl">${ref} target</text>
    ${gaps}<path d="${d}" class="ln" pathLength="1"/>${dots}${xl}
    <line class="xh" x1="0" x2="0" y1="${T}" y2="${base}"/><circle class="xd" r="5.5" cx="-20" cy="-20"/>
    <g class="hits">${hits}</g></svg>`;
}

/** Vertical bars, one series, one colour; the extreme(s) are emphasised and direct-labelled. data: [{label, value, tip}] */
export function barsSvg(data, { W = 360, H = 176 } = {}) {
  const top = Math.max(0, ...data.map((d) => d.value)), max = nice(Math.max(1, top));
  const L = 26, T = 18, B = 24, base = H - B, n = data.length, slot = (W - L) / n, bw = Math.min(28, slot * 0.52);
  const y = (v) => base - ((base - T) * v) / max;
  const grid = [max / 2, max].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="gr"/><text x="${L - 6}" y="${y(v) + 3.5}" class="yl">${Math.round(v * 10) / 10}</text>`).join("");
  const bars = data.map((d, i) => {
    const h = base - y(d.value), x0 = L + slot * i + (slot - bw) / 2, rr = Math.min(4, h, bw / 2), hi = top > 0 && d.value === top;
    const path = h > 0 ? `M${x0},${base}V${base - h + rr}Q${x0},${base - h} ${x0 + rr},${base - h}H${x0 + bw - rr}Q${x0 + bw},${base - h} ${x0 + bw},${base - h + rr}V${base}Z` : "";
    return `<g class="bar${hi ? " hi" : ""}" tabindex="0" role="img" aria-label="${esc(d.tip)}"${tip(d.tip)}>
      <rect x="${L + slot * i}" y="${T - 14}" width="${slot}" height="${base - T + 14}" class="hit"/>
      ${path ? `<path d="${path}" class="b" style="transform-origin:${x0 + bw / 2}px ${base}px"/>` : ""}
      ${hi ? `<text x="${x0 + bw / 2}" y="${base - h - 6}" class="vl">${d.value}</text>` : ""}
      <text x="${x0 + bw / 2}" y="${H - 7}" class="xl">${esc(d.label)}</text></g>`;
  }).join("");
  return `<svg class="an-chart an-bars" viewBox="0 0 ${W} ${H}">${grid}<line x1="${L}" x2="${W}" y1="${base}" y2="${base}" class="ax"/>${bars}</svg>`;
}

/** A thin horizontal meter. v in 0..1; c = fill colour; ticks = extra marks at fractions (e.g. a target). */
export const meter = (v, c = "var(--accent)", ticks = []) =>
  `<span class="an-meter" style="--c:${c}"><i style="width:${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%"></i>${ticks.map((t) => `<u style="left:${t * 100}%"></u>`).join("")}</span>`;

/** Heat table: rows = signals, columns = time buckets; brightness is scaled within each row. */
export function heatTable(cols, rows) {
  return `<table class="an-heat"><thead><tr><th></th>${cols.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("")}<th scope="col" class="tot">total</th></tr></thead><tbody>
    ${rows.map((r) => {
      const max = Math.max(0, ...r.values);
      return `<tr><th scope="row"><b>${esc(r.label)}</b><em>${esc(r.unit)}</em></th>${r.values.map((v, i) => {
        const k = max ? (v ? 0.18 + 0.82 * (v / max) : 0) : 0, txt = `${r.fmt(v)} ${r.unit}\n${cols[i].long}`;
        return `<td style="--v:${k.toFixed(3)}"${tip(txt)}><span>${esc(r.fmt(v))}</span></td>`;
      }).join("")}<td class="tot">${esc(r.fmt(r.values.reduce((a, b) => a + b, 0)))}</td></tr>`;
    }).join("")}</tbody></table>`;
}
