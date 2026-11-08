// Small SVG charts replacing the Python app's QPainter widgets (bar, dual bar, line/area, donut).
import { esc } from "./ui.js";


const nice = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v); };
const short = (v, money) => (money ? "$" : "") + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : Math.round(v).toLocaleString());

/** Vertical bars. data: [{label, value, color}] */
export function bars(data, { height = 170, money = false, valueLabels = true, width: W = 520 } = {}) {
  const max = nice(Math.max(1, ...data.map((d) => d.value))), n = Math.max(1, data.length);
  const top = 18, base = height - 22, slot = W / n, bw = Math.min(46, slot * 0.6);
  return `<svg class="chart" viewBox="0 0 ${W} ${height}">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="ax"/>
    ${data.map((d, i) => { const h = ((base - top) * d.value) / max, x = slot * i + (slot - bw) / 2;
      return `<rect x="${x}" y="${base - h}" width="${bw}" height="${Math.max(h, d.value ? 2 : 0)}" rx="4" style="fill:${d.color}"><title>${esc(d.label)}: ${short(d.value, money)}</title></rect>
        ${valueLabels && d.value ? `<text x="${x + bw / 2}" y="${base - h - 5}" class="vl">${short(d.value, money)}</text>` : ""}
        <text x="${x + bw / 2}" y="${height - 6}" class="xl">${esc(d.label)}</text>`; }).join("")}</svg>`;
}

/** Grouped bars: [{label, a, b}] with two colours. */
export function dualBars(data, { height = 190, colors = ["var(--green)", "var(--orange)"], money = true, width: W = 520 } = {}) {
  const max = nice(Math.max(1, ...data.flatMap((d) => [d.a, d.b]))), n = Math.max(1, data.length);
  const top = 16, base = height - 22, slot = W / n, bw = Math.min(26, slot * 0.32);
  const grid = [0.5, 1].map((f) => `<line x1="0" x2="${W}" y1="${base - (base - top) * f}" y2="${base - (base - top) * f}" class="gr"/><text x="2" y="${base - (base - top) * f - 3}" class="yl">${short(max * f, money)}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${height}">${grid}<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="ax"/>
    ${data.map((d, i) => { const cx = slot * i + slot / 2; return [d.a, d.b].map((v, k) => { const h = ((base - top) * v) / max;
      return `<rect x="${cx - bw - 2 + k * (bw + 4)}" y="${base - h}" width="${bw}" height="${h}" rx="3" style="fill:${colors[k]}"><title>${esc(d.label)}: ${short(v, money)}</title></rect>`; }).join("")
      + `<text x="${cx}" y="${height - 6}" class="xl">${esc(d.label)}</text>`; }).join("")}</svg>`;
}

/** Line/area chart. points: [{label, value|null}] (null = gap). */
export function line(points, { height = 170, color = "var(--purple)", area = true, avg = false, money = false, ref = null, labelEvery, width: W = 520 } = {}) {
  const vals = points.map((p) => p.value).filter((v) => v != null);
  const max = nice(Math.max(1, ...vals, ref || 0)), n = points.length;
  const top = 14, base = height - 22, left = 34, x = (i) => left + (n <= 1 ? 0 : ((W - left - 6) * i) / (n - 1)), y = (v) => base - ((base - top) * v) / max;
  const every = labelEvery || Math.ceil(n / 9);
  let path = "", fill = "", seg = [];
  const flush = () => { if (seg.length) { path += "M" + seg.map(([a, b]) => `${a},${b}`).join("L"); if (area) fill += `M${seg[0][0]},${base}L` + seg.map(([a, b]) => `${a},${b}`).join("L") + `L${seg.at(-1)[0]},${base}Z`; } seg = []; };
  points.forEach((p, i) => (p.value == null ? flush() : seg.push([x(i), y(p.value)])));
  flush();
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const id = "g" + Math.random().toString(36).slice(2, 7);
  return `<svg class="chart" viewBox="0 0 ${W} ${height}">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color}" stop-opacity=".35"/><stop offset="1" style="stop-color:${color}" stop-opacity="0"/></linearGradient></defs>
    ${[0.5, 1].map((f) => `<line x1="${left}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="gr"/><text x="0" y="${y(max * f) + 4}" class="yl">${short(max * f, money)}</text>`).join("")}
    <line x1="${left}" x2="${W}" y1="${base}" y2="${base}" class="ax"/>
    ${ref != null ? `<line x1="${left}" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" class="ref"/>` : ""}
    ${area ? `<path d="${fill}" fill="url(#${id})"/>` : ""}<path d="${path}" fill="none" style="stroke:${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${avg && vals.length ? `<line x1="${left}" x2="${W}" y1="${y(mean)}" y2="${y(mean)}" class="avg"/><text x="${W - 4}" y="${y(mean) - 4}" class="yl" text-anchor="end">avg ${short(mean, money)}</text>` : ""}
    ${points.map((p, i) => (p.value != null && n <= 32 ? `<circle cx="${x(i)}" cy="${y(p.value)}" r="2.6" style="fill:${color}"><title>${esc(p.label)}: ${short(p.value, money)}</title></circle>` : "")).join("")}
    ${points.map((p, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${height - 6}" class="xl">${esc(p.label)}</text>` : "")).join("")}</svg>`;
}

/** Donut + legend. slices: [{label, value, color}] */
export function donut(slices, { size = 150, center = "", sub = "", fmt = (v) => v.toLocaleString() } = {}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  const rings = total ? slices.filter((s) => s.value > 0).map((s) => { const len = (s.value / total) * c, el = `<circle r="${r}" cx="70" cy="70" fill="none" style="stroke:${s.color}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(s.label)}: ${fmt(s.value)}</title></circle>`; off += len; return el; }).join("")
    : `<circle r="${r}" cx="70" cy="70" fill="none" stroke="var(--raise)" stroke-width="18"/>`;
  return `<div class="donut"><svg viewBox="0 0 140 140" width="${size}" height="${size}">${rings}<text x="70" y="70" class="dc">${esc(center)}</text><text x="70" y="86" class="ds">${esc(sub)}</text></svg>
    <div class="legend">${slices.map((s) => `<div><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${fmt(s.value)}</b><em>${total ? Math.round((s.value / total) * 100) : 0}%</em></div>`).join("")}</div></div>`;
}
