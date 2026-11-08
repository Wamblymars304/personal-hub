// Schedule — "flight plan". Same data and rules as schedule_tab.py: Monday-first month calendar with workload
// colours (editable thresholds, yellow stays above green), week totals and the 40 h capacity warning, a month
// summary (tasks, planned time, bills due), drag tasks between days, drag queued media onto a day (→ a task with
// mediaId; finishing it finishes the media), recurring bills on their due dates, a day panel, a task editor and
// an overdue list. Rebuilt with a week view laid out by startTime, a 14-day agenda, and full keyboard control.
// Task: { id, date "YYYY-MM-DD", title, timeEstimate (min), startTime "HH:MM" | "", done, mediaId? }
import { db, commit, newId, today, iso, parseDate, formatDuration, logMediaConsumed, recurringOccurrences } from "../store.js";
import { esc, fmtDate, relDay, plural, money, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";

const CAPACITY = 2400; // 40 h a week
const HOUR = 40;       // px per hour in the week view
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEWS = [["month", "Month", "m"], ["week", "Week", "w"], ["agenda", "Agenda", "a"]];
const AGENDA_DAYS = 14;

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const t0 = today(), n0 = new Date();
const ui = {
  view: VIEWS.some(([v]) => v === store.get("hub.schedule.view")) ? store.get("hub.schedule.view") : "month",
  y: n0.getFullYear(), m: n0.getMonth(), wk: null, ag: t0, sel: t0, task: null,
  settings: false, showOverdue: true, prefill: "", anim: true, refocus: null, pop: null,
};
let appRef = null;

/* ---------- small helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const addDays = (ds, n) => { const d = parseDate(ds); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (ds) => { const d = parseDate(ds); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const sum = (list) => list.reduce((a, t) => a + (+t.timeEstimate || 0), 0);
const find = (id) => db.schedule.find((t) => t.id === id);
const settings = () => ({ greenMax: 240, yellowMax: 480, ...db.scheduleSettings });
const loadCls = (min, s) => (!min ? "" : min <= s.greenMax ? "lo" : min <= s.yellowMax ? "mid" : "hi");
const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const dayName = (ds, opts) => parseDate(ds).toLocaleDateString("en-US", opts);
const shortDay = (ds) => `${dayName(ds, { weekday: "short" })} ${dayName(ds, { month: "short", day: "numeric" })}`;
// "930" / "9:30" / "9" / "9pm" → "09:30" / "09:00" / "21:00"; anything else is kept as typed
function normTime(s) {
  s = String(s || "").trim();
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(s);
  if (!m) return s;
  let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : s;
}
// timed tasks first (by start), then the rest in their saved order
const byTime = (list) => list.map((t, i) => [toMin(t.startTime), i, t]).sort((a, b) => (a[0] ?? 1e4) - (b[0] ?? 1e4) || a[1] - b[1]).map((x) => x[2]);

function setSel(ds, { follow = true } = {}) {
  ui.sel = ds;
  if (!follow) return;
  const d = parseDate(ds);
  ui.y = d.getFullYear(); ui.m = d.getMonth();
  ui.wk = mondayOf(ds);
  if (ds < ui.ag || ds >= addDays(ui.ag, AGENDA_DAYS)) ui.ag = ds;
}

/* ---------- the visible range for each view ---------- */
function range() {
  if (ui.view === "week") { const s = ui.wk || mondayOf(ui.sel); return { start: s, end: addDays(s, 6), label: `Week of ${fmtDate(s)}` }; }
  if (ui.view === "agenda") return { start: ui.ag, end: addDays(ui.ag, AGENDA_DAYS - 1), label: `${fmtDate(ui.ag)} → ${fmtDate(addDays(ui.ag, AGENDA_DAYS - 1))}` };
  const first = new Date(ui.y, ui.m, 1), last = new Date(ui.y, ui.m + 1, 0);
  return { start: iso(first), end: iso(last), label: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
}

export default {
  id: "schedule", label: "Schedule", color: "var(--cyan)",
  count: () => db.schedule.filter((t) => t.date === today() && !t.done).length || null,
  render(root, app, focus) {
    appRef = app;
    if (focus) { const t = find(focus); if (t && parseDate(t.date)) { setSel(t.date); ui.task = t.id; ui.anim = true; } }
    if (!parseDate(ui.sel)) ui.sel = today();
    if (!ui.wk) ui.wk = mondayOf(ui.sel);
    if (ui.task && !find(ui.task)) ui.task = null;

    const s = settings(), td = today(), r = range();
    const byDate = {};
    for (const t of db.schedule) (byDate[t.date] ||= []).push(t);
    // bills for the whole grid the view can show (month view shows neighbouring days too)
    const gridStart = ui.view === "month" ? mondayOf(r.start) : r.start;
    const gridEnd = ui.view === "month" ? addDays(mondayOf(r.end), 6) : r.end;
    const bills = {};
    for (const b of db.recurringExpenses || []) for (const d of recurringOccurrences(b, gridStart, gridEnd)) (bills[d] ||= []).push(b);

    // summary of the visible range
    const inRange = db.schedule.filter((t) => t.date >= r.start && t.date <= r.end);
    let billN = 0, billSum = 0;
    for (const [d, bs] of Object.entries(bills)) if (d >= r.start && d <= r.end) { billN += bs.length; billSum += bs.reduce((a, b) => a + (+b.price || 0), 0); }
    const weeks = [];
    for (let w = mondayOf(r.start); w <= r.end; w = addDays(w, 7)) { let min = 0; for (let i = 0; i < 7; i++) min += sum(byDate[addDays(w, i)] || []); weeks.push({ w, min }); }
    const peak = weeks.reduce((a, b) => (b.min > a.min ? b : a), { w: null, min: 0 });
    const overdue = db.schedule.filter((t) => !t.done && t.date && t.date < td).sort((a, b) => a.date.localeCompare(b.date));
    const queue = (db.mediaQueue || []).map((id) => db.media.find((m) => m.id === id)).filter(Boolean);
    const ctx = { s, td, byDate, bills, weeks };

    root.innerHTML = `<div id="sc-root" class="sc">
      <div class="page-h"><h1>Schedule</h1><span class="sub sc-range">${esc(r.label)}</span><span class="sp"></span>
        <div class="seg sc-views" role="tablist" aria-label="Calendar view">${VIEWS.map(([v, l, k]) => `<button role="tab" aria-selected="${ui.view === v}" class="${ui.view === v ? "on" : ""}" data-act="view" data-v="${v}" title="${l} view (${k.toUpperCase()})">${l}</button>`).join("")}</div>
        <div class="sc-nav"><button class="icon-btn" data-act="prev" title="Previous ([)" aria-label="Previous">‹</button><button class="icon-btn" data-act="today" title="Today (T)">Today</button><button class="icon-btn" data-act="next" title="Next (])" aria-label="Next">›</button></div></div>

      <div class="sc-readouts">
        <div class="sc-ro"><span>tasks</span><b class="num">${inRange.length}</b><em>${inRange.filter((t) => t.done).length} done</em></div>
        <div class="sc-ro"><span>planned</span><b class="num">${formatDuration(sum(inRange)) || "0m"}</b><em>${ui.view === "month" ? "this month" : ui.view === "week" ? "this week" : `next ${AGENDA_DAYS} days`}</em></div>
        <div class="sc-ro bills"><span>bills due</span><b class="num">${money(billSum)}</b><em>${plural(billN, "bill")}</em></div>
        <div class="sc-ro cap${peak.min > CAPACITY ? " over" : ""}"><span>${weeks.length > 1 ? "peak week" : "this week"}</span><b class="num">${formatDuration(peak.min) || "0m"}</b>
          <i class="sc-capbar" style="--v:${Math.min(1, peak.min / CAPACITY).toFixed(3)}"></i><em>of 40h capacity</em></div>
        <button class="sc-ro legend" data-act="settings" aria-expanded="${ui.settings}" title="Edit the workload colours">
          <span>workload</span><span class="sc-key"><i class="lo"></i>≤ ${formatDuration(s.greenMax) || "0m"}<i class="mid"></i>≤ ${formatDuration(s.yellowMax)}<i class="hi"></i>more</span><em>${ui.settings ? "close" : "edit"}</em></button>
      </div>
      ${peak.min > CAPACITY ? `<div class="sc-warn" role="status"><b>Over capacity</b> the week of ${fmtDate(peak.w)} is planned at ${formatDuration(peak.min)} — more than 40 h.</div>` : ""}
      ${ui.settings ? `<form class="sc-thresh" id="sc-thresh"><span class="sc-k">day colours</span>
          <label><i class="lo"></i>green up to <input class="in" type="number" step="0.5" min="0" name="g" value="${s.greenMax / 60}" aria-label="Green up to (hours)" /> h</label>
          <label><i class="mid"></i>amber up to <input class="in" type="number" step="0.5" min="0" name="y" value="${s.yellowMax / 60}" aria-label="Amber up to (hours)" /> h</label>
          <span class="tag"><i class="hi"></i>red above · amber always stays above green</span><button class="btn sm">Apply</button></form>` : ""}
      ${queue.length ? `<div class="sc-queue"><span class="sc-k">media queue</span><span class="tag">drag onto a day · or press Enter to put it on ${esc(fmtDate(ui.sel))}</span>
          ${queue.map((m) => `<span class="sc-q" draggable="true" data-media="${esc(m.id)}" tabindex="0" role="button" aria-label="Schedule ${esc(m.title)} on ${esc(fmtDate(ui.sel))}"><i class="sc-qd"></i>${esc(m.title)}${m.timeEstimate ? `<em>${formatDuration(+m.timeEstimate)}</em>` : ""}<button class="x" data-act="unqueue" data-id="${esc(m.id)}" title="Remove from queue" aria-label="Remove ${esc(m.title)} from queue">×</button></span>`).join("")}</div>` : ""}

      <div class="sc-wrap">
        <div class="sc-main card">${ui.view === "week" ? weekView(ctx, r) : ui.view === "agenda" ? agendaView(ctx, r) : monthView(ctx, r)}
          <p class="sc-hint" aria-hidden="true"><span><kbd>← ↑ ↓ →</kbd> move</span><span><kbd>Enter</kbd> add</span><span><kbd>[</kbd> <kbd>]</kbd> page</span><span><kbd>T</kbd> today</span><span><kbd>M</kbd> <kbd>W</kbd> <kbd>A</kbd> views</span><span><kbd>N</kbd> new task</span><span><kbd>Alt ← →</kbd> move the open task</span><span><kbd>Esc</kbd> close</span></p></div>
        <div class="sc-side">${ui.task ? editor() : dayPanel(ctx)}${overdueCard(overdue, td)}</div>
      </div></div>`;

    wire(root, app);
    after(root, app);
  },
};

/* ---------- month ---------- */
function monthView({ s, td, byDate, bills, weeks }, r) {
  let cells = "", wi = 0;
  const start = mondayOf(r.start), end = addDays(mondayOf(r.end), 6);
  for (let ds = start, i = 0; ds <= end; ds = addDays(ds, 1), i++) {
    const tasks = byTime(byDate[ds] || []), min = sum(tasks), out = ds < r.start || ds > r.end, bs = bills[ds] || [];
    const shown = tasks.slice(0, 4), more = tasks.length - shown.length;
    cells += `<div class="sc-day ${loadCls(min, s)}${ds === td ? " today" : ""}${ds === ui.sel ? " sel" : ""}${out ? " out" : ""}" data-day="${ds}" tabindex="${ds === ui.sel ? 0 : -1}"
        aria-label="${esc(dayName(ds, { weekday: "long", month: "long", day: "numeric" }))}, ${tasks.length ? `${plural(tasks.length, "task")}, ${formatDuration(min) || "no time"}` : "nothing planned"}${bs.length ? `, ${plural(bs.length, "bill")} due` : ""}">
        <div class="sc-dn"><b>${+ds.slice(8)}</b>${min ? `<em>${formatDuration(min)}</em>` : ""}</div>
        ${min ? `<i class="sc-load" style="--v:${Math.min(1, min / Math.max(1, s.yellowMax * 1.25)).toFixed(3)}"></i>` : ""}
        <div class="sc-items">${bs.map((b) => `<span class="sc-bill" title="${esc(b.name)} — ${money(b.price)}"><span>${esc(b.name)}</span><em>${money(b.price)}</em></span>`).join("")}
          ${shown.map((t) => taskChip(t)).join("")}${more > 0 ? `<span class="sc-more">+${more} more</span>` : ""}</div></div>`;
    if (i % 7 === 6) { const w = weeks[wi++] || { min: 0 }; cells += `<div class="sc-wkt${w.min > CAPACITY ? " over" : ""}" title="Week total${w.min > CAPACITY ? " — over the 40 h capacity" : ""}"><b class="num">${formatDuration(w.min) || "—"}</b>${w.min ? `<i style="--v:${Math.min(1, w.min / CAPACITY).toFixed(3)}"></i>` : ""}</div>`; }
  }
  return `<div class="sc-month" aria-label="${esc(r.label)}"><div class="sc-mh" aria-hidden="true">${DOW.map((d) => `<span>${d}</span>`).join("")}<span>week</span></div><div class="sc-mg">${cells}</div></div>`;
}
const taskChip = (t) => `<span class="sc-task${t.done ? " done" : ""}${t.id === ui.task ? " on" : ""}${t.mediaId ? " media" : ""}" draggable="true" data-task="${esc(t.id)}" data-row="${esc(t.id)}" title="${esc(t.title)}${t.timeEstimate ? ` · ${formatDuration(+t.timeEstimate)}` : ""}">${t.startTime ? `<b>${esc(t.startTime)}</b>` : ""}<span>${esc(t.title)}</span></span>`;

/* ---------- week: a time-of-day layout driven by startTime ---------- */
function weekView({ s, td, byDate, bills }, r) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.start, i));
  let h0 = 7, h1 = 23;
  for (const d of days) for (const t of byDate[d] || []) { const m = toMin(t.startTime); if (m != null) { h0 = Math.min(h0, Math.floor(m / 60)); h1 = Math.max(h1, Math.min(24, Math.ceil((m + Math.max(30, +t.timeEstimate || 0)) / 60))); } }
  const now = new Date(), hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i), nowMin = now.getHours() * 60 + now.getMinutes();
  const head = days.map((d) => { const min = sum(byDate[d] || []); return `<button class="sc-wh ${loadCls(min, s)}${d === td ? " today" : ""}${d === ui.sel ? " sel" : ""}" data-act="pickday" data-day="${d}" tabindex="${d === ui.sel ? 0 : -1}" aria-label="${esc(dayName(d, { weekday: "long", month: "long", day: "numeric" }))}, ${formatDuration(min) || "nothing"} planned">
      <span>${dayName(d, { weekday: "short" })}</span><b class="num">${+d.slice(8)}</b><em>${formatDuration(min)}</em><i class="sc-load" style="--v:${Math.min(1, min / Math.max(1, s.yellowMax * 1.25)).toFixed(3)}"></i></button>`; }).join("");
  const any = days.map((d) => { const loose = (byDate[d] || []).filter((t) => toMin(t.startTime) == null);
    return `<div class="sc-any${d === ui.sel ? " sel" : ""}" data-day="${d}" data-slot="any">${(bills[d] || []).map((b) => `<span class="sc-bill" title="${esc(b.name)} — ${money(b.price)}"><span>${esc(b.name)}</span><em>${money(b.price)}</em></span>`).join("")}${loose.map(taskChip).join("")}</div>`; }).join("");
  const cols = days.map((d) => {
    const timed = (byDate[d] || []).map((t) => ({ t, a: toMin(t.startTime) })).filter((x) => x.a != null).sort((x, y) => x.a - y.a);
    // overlapping tasks share the column side by side
    let cluster = [], end = -1;
    const flush = () => { const lanes = []; for (const x of cluster) { let l = lanes.findIndex((e) => e <= x.a); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = x.b; x.lane = l; } cluster.forEach((x) => (x.n = lanes.length)); cluster = []; };
    for (const x of timed) { x.b = x.a + Math.max(20, +x.t.timeEstimate || 30); if (x.a >= end) flush(); cluster.push(x); end = Math.max(end, x.b); }
    flush();
    return `<div class="sc-col${d === td ? " today" : ""}${d === ui.sel ? " sel" : ""}" data-day="${d}" data-slot="time" data-h0="${h0}">
      ${timed.map(({ t, a, b, lane, n }) => `<button class="sc-blk${((b - a) / 60) * HOUR < 36 ? " short" : ""}${t.done ? " done" : ""}${t.mediaId ? " media" : ""}${t.id === ui.task ? " on" : ""}" draggable="true" data-task="${esc(t.id)}" data-row="${esc(t.id)}" tabindex="-1"
          style="top:${((a - h0 * 60) / 60) * HOUR}px;height:${Math.max(18, ((b - a) / 60) * HOUR - 2)}px;left:calc(${(lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)" title="${esc(t.title)}">
          <b>${esc(t.startTime)}${+t.timeEstimate ? `–${hhmm(Math.min(a + +t.timeEstimate, 24 * 60 - 1))}` : ""}</b><span>${esc(t.title)}</span></button>`).join("")}
      ${d === td && nowMin >= h0 * 60 && nowMin < h1 * 60 ? `<i class="sc-now" style="top:${((nowMin - h0 * 60) / 60) * HOUR}px"></i>` : ""}</div>`;
  }).join("");
  return `<div class="sc-week" style="--hour:${HOUR}px">
    <div class="sc-wrow sc-whead"><span class="sc-gut"></span>${head}</div>
    <div class="sc-wrow sc-anyrow"><span class="sc-gut">any<br>time</span>${any}</div>
    <div class="sc-wbody" id="sc-wbody"><div class="sc-wrow" style="height:${hours.length * HOUR}px"><div class="sc-gut sc-hours">${hours.map((h) => `<span style="top:${(h - h0) * HOUR}px">${pad(h)}:00</span>`).join("")}</div>${cols}</div></div></div>`;
}

/* ---------- agenda: the next two weeks as a list ---------- */
function agendaView({ s, td, byDate, bills }, r) {
  let out = "", empties = [];
  const flushEmpty = () => { if (!empties.length) return; out += `<div class="sc-ag-empty">${shortDay(empties[0])}${empties.length > 1 ? ` – ${shortDay(empties.at(-1))}` : ""} · clear skies</div>`; empties = []; };
  for (let i = 0; i < AGENDA_DAYS; i++) {
    const d = addDays(r.start, i), tasks = byTime(byDate[d] || []), bs = bills[d] || [], min = sum(tasks);
    if (!tasks.length && !bs.length && d !== td && d !== ui.sel) { empties.push(d); continue; }
    flushEmpty();
    out += `<section class="sc-ag-day ${loadCls(min, s)}${d === td ? " today" : ""}${d === ui.sel ? " sel" : ""}" data-day="${d}">
      <button class="sc-ag-h" data-act="pickday" data-day="${d}" tabindex="${d === ui.sel ? 0 : -1}"><b>${dayName(d, { weekday: "long" })}</b><span>${dayName(d, { month: "short", day: "numeric" })}</span><em>${relDay(d)}</em><i class="sp"></i><span class="num">${formatDuration(min) || ""}</span></button>
      ${bs.map((b) => `<div class="sc-ag-row bill"><span class="sc-ag-t">due</span><span class="sc-ag-n">${esc(b.name)}</span><span class="num">${money(b.price)}</span></div>`).join("")}
      ${tasks.map((t) => `<div class="sc-ag-row${t.done ? " done" : ""}${t.mediaId ? " media" : ""}" data-row="${esc(t.id)}" draggable="true" data-task="${esc(t.id)}"><span class="sc-ag-t num">${esc(t.startTime) || "any"}</span>
          <button class="check${t.done ? " on" : ""}" data-act="done" data-id="${esc(t.id)}" aria-label="${t.done ? "Mark not done" : "Mark done"}: ${esc(t.title)}">✓</button>
          <button class="sc-ag-n linkish-plain" data-act="open" data-id="${esc(t.id)}">${esc(t.title)}</button><span class="num">${formatDuration(+t.timeEstimate)}</span></div>`).join("")}
      ${!tasks.length && !bs.length ? `<div class="sc-ag-row none">nothing planned — press <kbd>N</kbd> to add</div>` : ""}</section>`;
  }
  flushEmpty();
  return `<div class="sc-agenda">${out}</div>`;
}

/* ---------- side: one day, or one task ---------- */
function dayPanel({ s, td, byDate, bills }) {
  const d = ui.sel, tasks = byTime(byDate[d] || []), min = sum(tasks), bs = bills[d] || [];
  const done = tasks.filter((t) => t.done).length;
  return `<section class="card sc-panel ${loadCls(min, s)}"><header class="sc-ph"><span class="sc-k">${d === td ? "today" : esc(relDay(d))}</span>
      <h2>${dayName(d, { weekday: "long" })}</h2><p>${dayName(d, { month: "long", day: "numeric", year: "numeric" })}</p>
      <div class="sc-pstats"><span><b class="num">${tasks.length}</b> ${tasks.length === 1 ? "task" : "tasks"}</span><span><b class="num">${formatDuration(min) || "0m"}</b> planned</span>${tasks.length ? `<span><b class="num">${done}</b> done</span>` : ""}</div></header>
    <div class="sc-pb">
      ${bs.map((b) => `<div class="row sc-billrow"><span class="sc-due">due</span><span class="t">${esc(b.name)}</span><span class="m num">${money(b.price)}</span></div>`).join("")}
      ${tasks.map((t) => `<div class="row${t.done ? " done" : ""}${t.mediaId ? " media" : ""}" data-row="${esc(t.id)}"><button class="check${t.done ? " on" : ""}" data-act="done" data-id="${esc(t.id)}" aria-label="${t.done ? "Mark not done" : "Mark done"}: ${esc(t.title)}">✓</button>
          <button class="t sc-open" data-act="open" data-id="${esc(t.id)}" title="Edit">${esc(t.title)}</button><span class="m num">${[esc(t.startTime), formatDuration(+t.timeEstimate)].filter(Boolean).join(" · ")}</span></div>`).join("")}
      ${!tasks.length && !bs.length ? `<p class="sc-clear">Nothing planned. Clear skies.</p>` : ""}
      <form id="sc-add" class="sc-add" autocomplete="off"><input class="in" name="title" placeholder="Add a task to ${esc(dayName(d, { weekday: "long" }))}…" required aria-label="New task title" />
        <div class="sc-add-r"><input class="in sc-time" name="start" placeholder="HH:MM" value="${esc(ui.prefill)}" aria-label="Start time (HH:MM)" />
          <input class="in sc-mins" type="number" min="0" step="5" name="min" placeholder="min" aria-label="Minutes" />
          <span class="sc-quick">${[15, 30, 60, 120].map((m) => `<button type="button" class="chip" data-act="qmin" data-m="${m}">${m < 60 ? m + "m" : m / 60 + "h"}</button>`).join("")}</span>
          <button class="btn">Add</button></div></form>
    </div></section>`;
}
function editor() {
  const t = find(ui.task), m = t.mediaId && db.media.find((x) => x.id === t.mediaId);
  return `<section class="card sc-panel sc-edit"><header class="sc-ph"><span class="sc-k">task · ${esc(fmtDate(t.date))} · ${esc(relDay(t.date))}</span>
      <button class="x sc-close" data-act="closetask" aria-label="Close (Esc)" title="Close (Esc)">×</button></header>
    <form class="sc-pb sc-form" id="sc-task">
      <textarea class="in sc-title" name="title" rows="2" aria-label="Title">${esc(t.title)}</textarea>
      <div class="sc-fields"><label><span>start</span><input class="in" name="start" placeholder="HH:MM" value="${esc(t.startTime || "")}" /></label>
        <label><span>minutes</span><input class="in" type="number" min="0" step="5" name="min" value="${+t.timeEstimate || 0}" /></label>
        <label class="wide"><span>date</span><input class="in" type="date" name="date" value="${esc(t.date)}" /></label></div>
      ${m ? `<p class="sc-link"><i class="sc-qd"></i>Linked to “${esc(m.title)}” — finishing this task marks it done in Media.</p>` : ""}
      <div class="sc-acts"><button class="btn">Save</button><button type="button" class="btn ${t.done ? "ghost" : "green"}" data-act="done" data-id="${esc(t.id)}">${t.done ? "Mark not done" : "✓ Done"}</button>
        <span class="grow"></span><button type="button" class="btn ghost sm sc-del" data-act="del" data-id="${esc(t.id)}">Delete</button></div>
    </form></section>`;
}
function overdueCard(overdue, td) {
  if (!overdue.length) return "";
  return `<section class="card sc-ovd"><header class="card-h"><div><h3>Overdue</h3><p class="sub">${plural(overdue.length, "unfinished task")} from earlier days</p></div>
      <div class="card-r"><button class="btn ghost sm" data-act="ovd" aria-expanded="${ui.showOverdue}">${ui.showOverdue ? "Hide" : "Show"}</button></div></header>
    ${ui.showOverdue ? `<div class="card-b">${overdue.map((t) => `<div class="row" data-row="${esc(t.id)}"><button class="check" data-act="done" data-id="${esc(t.id)}" aria-label="Mark done: ${esc(t.title)}">✓</button>
        <button class="t sc-open" data-act="open" data-id="${esc(t.id)}">${esc(t.title)}</button><span class="m sc-late num" title="${esc(fmtDate(t.date))}">${Math.round((parseDate(td) - parseDate(t.date)) / 864e5)}d</span>
        <button class="icon-btn" data-act="totoday" data-id="${esc(t.id)}" title="Move to today">→ today</button></div>`).join("")}</div>` : ""}</section>`;
}

/* ---------- behaviour ---------- */
function toggleDone(t) {
  t.done = !t.done;
  if (t.done && t.mediaId) { // like schedule_tab: finishing a media task finishes the media
    const m = db.media.find((x) => x.id === t.mediaId);
    if (m && !m.done) { m.done = true; m.completedAt = today(); logMediaConsumed(m); }
    db.mediaQueue = db.mediaQueue.filter((q) => q !== t.mediaId);
  }
}
function scheduleMedia(id, date, startTime = "") {
  const m = db.media.find((x) => x.id === id);
  if (!m) return false;
  db.schedule.push({ id: newId(), date, title: m.title, timeEstimate: +m.timeEstimate || 0, startTime, done: false, mediaId: m.id });
  db.mediaQueue = db.mediaQueue.filter((q) => q !== m.id);
  toast(`“${m.title}” scheduled for ${fmtDate(date)}`);
  return true;
}
function go(view) { ui.view = view; store.set("hub.schedule.view", view); setSel(ui.sel); ui.anim = true; ui.refocus = "day"; appRef.refresh(); }
function page(dir) {
  if (ui.view === "month") { const d = new Date(ui.y, ui.m + dir, 1); ui.y = d.getFullYear(); ui.m = d.getMonth(); const last = new Date(ui.y, ui.m + 1, 0).getDate(); ui.sel = iso(new Date(ui.y, ui.m, Math.min(+ui.sel.slice(8), last))); ui.wk = mondayOf(ui.sel); }
  else if (ui.view === "week") { ui.wk = addDays(ui.wk, 7 * dir); ui.sel = addDays(ui.sel, 7 * dir); }
  else { ui.ag = addDays(ui.ag, AGENDA_DAYS * dir); ui.sel = ui.ag; }
  ui.task = null; ui.anim = true; appRef.refresh();
}
function moveSel(n) {
  const d = addDays(ui.sel, n), r = range();
  const visible = ui.view === "month" ? d >= mondayOf(r.start) && d <= addDays(mondayOf(r.end), 6) : d >= r.start && d <= r.end;
  const leaves = ui.view === "month" ? d.slice(0, 7) !== ui.sel.slice(0, 7) && !visible : !visible;
  ui.task = null; ui.prefill = "";
  setSel(d, { follow: ui.view !== "agenda" || leaves });
  if (ui.view === "month" && !leaves) { ui.y = +r.start.slice(0, 4); ui.m = +r.start.slice(5, 7) - 1; } // stay on this month while the neighbour days are on screen
  ui.anim = leaves; ui.refocus = "day"; appRef.refresh();
}

function wire(root, app) {
  const td = today();
  root.querySelector("#sc-add")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target), title = f.get("title").trim();
    if (!title) return;
    db.schedule.push({ id: newId(), date: ui.sel, title, timeEstimate: Math.max(0, +f.get("min") || 0), startTime: normTime(f.get("start")), done: false });
    ui.prefill = ""; ui.refocus = "add"; commit(); app.refresh();
  });
  root.querySelector("#sc-task")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = find(ui.task), f = new FormData(e.target);
    Object.assign(t, { title: f.get("title").trim() || t.title, startTime: normTime(f.get("start")), timeEstimate: Math.max(0, +f.get("min") || 0) });
    if (f.get("date") && parseDate(f.get("date")) && f.get("date") !== t.date) { t.date = f.get("date"); setSel(t.date); ui.anim = true; }
    commit(); app.refresh(); toast("Task saved");
  });
  root.querySelector("#sc-task .sc-title")?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); } });
  root.querySelector("#sc-thresh")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const g = Math.max(0, Math.round((+f.get("g") || 0) * 60));
    let y = Math.max(0, Math.round((+f.get("y") || 0) * 60));
    if (y <= g) { y = g + 30; toast("Amber has to stay above green — nudged it up"); } // yellow must stay above green
    db.scheduleSettings = { greenMax: g, yellowMax: y };
    ui.settings = false; commit(); app.refresh();
  });

  /* drag & drop: tasks between days (and times, in the week view), queued media onto a day */
  root.ondragstart = (e) => {
    const tk = e.target.closest?.("[data-task]"), md = e.target.closest?.("[data-media]");
    if (tk) { e.dataTransfer.setData("text/plain", tk.dataset.task); e.dataTransfer.effectAllowed = "move"; tk.classList.add("dragging"); }
    else if (md) e.dataTransfer.setData("text/plain", "media:" + md.dataset.media);
  };
  root.ondragend = () => root.querySelectorAll(".dragging, .drop").forEach((el) => el.classList.remove("dragging", "drop"));
  const target = (e) => e.target.closest?.("[data-day]");
  let hot = null;
  root.ondragover = (e) => {
    const el = target(e);
    if (!el) return;
    e.preventDefault();
    if (hot !== el) { hot?.classList.remove("drop"); hot = el; el.classList.add("drop"); }
    if (el.dataset.slot === "time") el.dataset.at = slotTime(el, e);
  };
  root.ondragleave = (e) => { const el = target(e); if (el && !el.contains(e.relatedTarget)) { el.classList.remove("drop"); if (hot === el) hot = null; } };
  root.ondrop = (e) => {
    const el = target(e);
    if (!el) return;
    e.preventDefault(); el.classList.remove("drop"); hot = null;
    const v = e.dataTransfer.getData("text/plain"), d = el.dataset.day;
    const time = el.dataset.slot === "time" ? slotTime(el, e) : el.dataset.slot === "any" ? "" : null; // null = keep the time
    if (v.startsWith("media:")) { if (!scheduleMedia(v.slice(6), d, time || "")) return; }
    else {
      const t = find(v);
      if (!t || (t.date === d && (time === null || time === t.startTime))) return;
      t.date = d; if (time !== null) t.startTime = time;
    }
    setSel(d, { follow: ui.view === "week" }); commit(); app.refresh();
  };

  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) {
      const tk = e.target.closest("[data-task]");
      if (tk) { const t = find(tk.dataset.task); ui.task = t.id; setSel(t.date, { follow: false }); return app.refresh(); }
      const col = e.target.closest(".sc-col");
      if (col) { ui.task = null; ui.prefill = slotTime(col, e, 30); setSel(col.dataset.day, { follow: false }); ui.refocus = "add"; return app.refresh(); }
      const day = e.target.closest("[data-day]");
      if (day && !e.target.closest("form")) { ui.task = null; ui.prefill = ""; setSel(day.dataset.day, { follow: false }); ui.refocus = "add"; app.refresh(); }
      return;
    }
    const t = b.dataset.id && find(b.dataset.id);
    switch (b.dataset.act) {
      case "view": return go(b.dataset.v);
      case "prev": return page(-1);
      case "next": return page(1);
      case "today": ui.ag = td; setSel(td); ui.task = null; ui.anim = true; ui.refocus = "day"; return app.refresh();
      case "settings": ui.settings = !ui.settings; app.refresh(); return ui.settings && root.querySelector("#sc-thresh [name=g]")?.focus();
      case "ovd": ui.showOverdue = !ui.showOverdue; return app.refresh();
      case "pickday": ui.task = null; ui.prefill = ""; setSel(b.dataset.day, { follow: false }); ui.refocus = "add"; return app.refresh();
      case "open": ui.task = t.id; setSel(t.date, { follow: ui.view !== "agenda" }); ui.refocus = "editor"; return app.refresh();
      case "closetask": ui.task = null; ui.refocus = "day"; return app.refresh();
      case "qmin": { const inp = root.querySelector("#sc-add [name=min]"); if (inp) { inp.value = b.dataset.m; root.querySelector("#sc-add [name=title]").focus(); } return; }
      case "done": toggleDone(t); ui.pop = t.id; break;
      case "totoday": t.date = td; toast("Moved to today"); break;
      case "del": if (!confirm(`Delete “${t.title}”?`)) return; db.schedule = db.schedule.filter((x) => x !== t); ui.task = null; break;
      case "unqueue": e.stopPropagation(); db.mediaQueue = db.mediaQueue.filter((q) => q !== b.dataset.id); break;
      default: return;
    }
    commit(); app.refresh();
  };
}
// the HH:MM under the pointer in a week-view column, snapped to `step` minutes
function slotTime(col, e, step = 15) {
  const y = e.clientY - col.getBoundingClientRect().top, h0 = +col.dataset.h0 || 0;
  const min = Math.max(0, Math.min(24 * 60 - step, h0 * 60 + Math.floor(((y / HOUR) * 60) / step) * step));
  return hhmm(min);
}

/* ---------- after each render: focus, scroll, motion ---------- */
function after(root, app) {
  const wb = root.querySelector("#sc-wbody");
  if (wb) { // open the week near the first task of the day, or now
    const nowEl = wb.querySelector(".sc-now"), tops = [...wb.querySelectorAll(".sc-blk")].map((el) => parseFloat(el.style.top));
    wb.scrollTop = Math.max(0, (nowEl ? parseFloat(nowEl.style.top) : tops.length ? Math.min(...tops) : HOUR * 1.5) - HOUR * 1.5);
  }
  const want = ui.refocus; ui.refocus = null;
  if (want === "day") root.querySelector('[tabindex="0"][data-day], .sc-wh[tabindex="0"], .sc-ag-h[tabindex="0"]')?.focus({ preventScroll: true });
  else if (want === "add") root.querySelector("#sc-add [name=title]")?.focus({ preventScroll: true });
  else if (want === "editor") root.querySelector("#sc-task .sc-title")?.focus({ preventScroll: true });

  if (!motionEnabled()) { ui.anim = false; ui.pop = null; return; }
  if (ui.anim && !app.entering) {
    const cells = root.querySelectorAll(".sc-day, .sc-wkt, .sc-wh, .sc-blk, .sc-ag-day, .sc-ag-empty");
    animate(cells, { opacity: [0, 1], translateY: [10, 0], scale: [0.94, 1], delay: stagger(9), duration: 520, ease: "outBack(1.7)" });
    const p = root.querySelector(".sc-panel");
    if (p) animate(p, { opacity: [0, 1], translateX: [14, 0], duration: 480, ease: "outBack(1.5)" });
  }
  if (ui.pop) {
    root.querySelectorAll(`[data-act="done"][data-id="${CSS.escape(ui.pop)}"]`).forEach((el) => animate(el, { scale: [0.55, 1], rotate: [-12, 0], duration: 460, ease: "outBack(3)" }));
    const chip = root.querySelector(`.sc-task[data-task="${CSS.escape(ui.pop)}"], .sc-blk[data-task="${CSS.escape(ui.pop)}"]`);
    if (chip) animate(chip, { scale: [1.12, 1], duration: 380, ease: "outBack(2.5)" });
  }
  ui.anim = false; ui.pop = null;
}

/* ---------- keyboard (only while the Schedule tab is on screen) ---------- */
addEventListener("keydown", (e) => {
  const root = document.getElementById("sc-root");
  if (!root || !appRef || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const pal = document.getElementById("palette"); if (pal && !pal.hidden) return;
  if (e.key === "Escape") {
    if (ui.task) { e.preventDefault(); ui.task = null; ui.refocus = "day"; return appRef.refresh(); }
    if (ui.settings) { e.preventDefault(); ui.settings = false; return appRef.refresh(); }
    if (typing) document.activeElement.blur();
    return;
  }
  // a focused queued media card: Enter puts it on the selected day
  const q = document.activeElement?.closest?.(".sc-q");
  if (q && (e.key === "Enter" || e.key === " ") && !e.target.closest("button")) { e.preventDefault(); if (scheduleMedia(q.dataset.media, ui.sel)) { commit(); appRef.refresh(); } return; }
  if (typing) return;
  // Alt + ←/→ moves the open task by a day
  if (e.altKey && ui.task && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    const t = find(ui.task); t.date = addDays(t.date, e.key === "ArrowLeft" ? -1 : 1); setSel(t.date);
    commit(); return appRef.refresh();
  }
  if (e.altKey) return;
  const inCal = !!document.activeElement?.closest?.(".sc-month, .sc-week, .sc-agenda");
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: ui.view === "week" ? -1 : -7, ArrowDown: ui.view === "week" ? 1 : 7 }[e.key];
  if (step && (inCal || document.activeElement === document.body)) { e.preventDefault(); return moveSel(ui.view === "agenda" ? Math.sign(step) : step); }
  if (e.key === "Enter" && inCal && document.activeElement.matches("[data-day]")) { e.preventDefault(); ui.task = null; ui.refocus = "add"; return appRef.refresh(); }
  const k = e.key.toLowerCase();
  if (k === "t") { e.preventDefault(); ui.ag = today(); setSel(today()); ui.task = null; ui.anim = true; ui.refocus = "day"; return appRef.refresh(); }
  if (k === "[" || e.key === "PageUp") { e.preventDefault(); ui.refocus = "day"; return page(-1); }
  if (k === "]" || e.key === "PageDown") { e.preventDefault(); ui.refocus = "day"; return page(1); }
  if (k === "n") { e.preventDefault(); ui.task = null; ui.refocus = "add"; return appRef.refresh(); }
  const v = VIEWS.find(([, , key]) => key === k);
  if (v) { e.preventDefault(); return go(v[0]); }
});
