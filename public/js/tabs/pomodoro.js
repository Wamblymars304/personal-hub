// Pomodoro — "deep water". Same data and rules as pomodoro_tab.py: the timer auto-logs a completed session,
// categories (removing one keeps its sessions), manual past-session logging, history filtered by category.
// The timer keeps running when you switch tabs and survives a reload (localStorage "hub.pomodoro":
// { cat, minutes, endAt, remaining, running }); main.js reads count() every second for the sidebar.
// Rebuilt as a porthole that drains as you focus, a one-tap category picker, today's sessions at a glance and a
// year of focus as a heatmap. Session: { id, category, duration (min), date, completed: true }
import { db, commit, newId, today, iso, parseDate, formatDuration, normDate } from "../store.js";
import { esc, fmtDate, plural, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled, pulse } from "../background.js";

const KEY = "hub.pomodoro";
const BASE_TITLE = document.title || "Personal Hub";
const PRESETS = [15, 25, 45, 60, 90];
const PALETTE = ["#7fd8e6", "#ff9f5a", "#ff8fc8", "#8ff0c8", "#b9a6ff", "#ffd36e", "#ff7a7a", "#9fb4ff"];
const ui = { filter: "All", showAll: false, splash: false, enter: true };
let t = { cat: null, minutes: 25, endAt: 0, remaining: 0, running: false };
const read = () => { try { t = { ...t, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {} };
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {} };
read();
let tick = null, appRef = null;

const left = () => (t.running ? Math.max(0, Math.round((t.endAt - Date.now()) / 1000)) : t.remaining || t.minutes * 60);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const frac = () => Math.max(0, Math.min(1, left() / Math.max(1, t.minutes * 60)));
const level = (f) => (58 + (1 - f) * 242).toFixed(1); // water surface y in the porthole: full → empty
const minsOf = (list) => list.reduce((a, x) => a + (+x.duration || 0), 0);
function colorOf(cat) {
  const i = db.pomodoroCategories.indexOf(cat);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  let h = 0; for (const ch of String(cat)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function beep() {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    o.start(); o.stop(ctx.currentTime + 1.2);
  } catch {}
}
function finish() {
  clearInterval(tick); tick = null;
  // another window of the hub may already have logged this very session
  try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); if (!s.running || s.endAt !== t.endAt) { t = { ...t, ...s }; document.title = BASE_TITLE; return; } } catch {}
  t.running = false; t.remaining = 0; persist();
  db.pomodoroSessions.push({ id: newId(), category: t.cat || db.pomodoroCategories[0] || "Focus", duration: t.minutes, date: today(), completed: true });
  commit();
  beep(); toast(`Session complete — ${t.minutes} min of ${t.cat} logged`);
  document.title = BASE_TITLE;
  ui.splash = true;
  window.__hubRefresh?.();
}
// paint the running clock wherever it is on screen; finish when it reaches zero (on any tab)
function paint() {
  const s = left(), f = frac();
  const el = document.getElementById("po-time");
  if (el) el.textContent = mmss(s);
  document.getElementById("po-ring")?.style.setProperty("stroke-dashoffset", (100 * (1 - f)).toFixed(2));
  document.getElementById("po-water")?.setAttribute("transform", `translate(0 ${level(f)})`);
  document.title = t.running ? `${mmss(s)} · ${t.cat}` : BASE_TITLE;
  if (t.running && s <= 0) finish();
}
function loop() { clearInterval(tick); tick = setInterval(paint, 250); }
if (t.running) loop(); // resume after reload
// another window started, paused or finished the timer
addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  read();
  if (t.running) loop(); else { clearInterval(tick); tick = null; document.title = BASE_TITLE; }
  if (document.getElementById("po-root")) appRef?.refresh();
});

export const timerState = () => (t.running ? mmss(left()) : null);

/* ---------- derived data ---------- */
function stats() {
  const td = today(), d0 = parseDate(td);
  const mon = new Date(d0); mon.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const weekStart = iso(mon);
  const byDay = {}, byCat = {};
  let todayList = [], weekN = 0;
  for (const x of db.pomodoroSessions) {
    const d = normDate(x.date), m = +x.duration || 0;
    byCat[x.category] = (byCat[x.category] || 0) + m;
    if (d) byDay[d] = (byDay[d] || 0) + m;
    if (d === td) todayList.push(x);
    if (d && d >= weekStart && d <= td) weekN++;
  }
  return { td, byDay, byCat, todayList, weekN, weekStart };
}
const targets = () => ({ pomoTarget: 4, ...db.productivityTargets });

export default {
  id: "pomodoro", label: "Pomodoro", color: "var(--pink)",
  count: () => timerState(),
  render(root, app, focus) {
    appRef = app;
    window.__hubRefresh = app.refresh;
    if (focus && db.pomodoroSessions.some((x) => x.id === focus)) { ui.filter = "All"; ui.showAll = true; }
    const cats = db.pomodoroCategories;
    if (!cats.includes(t.cat)) t.cat = cats[0] || null;
    const st = stats(), tg = targets(), s = left(), f = frac();
    const daily = +tg.pomoDaily > 0 ? +tg.pomoDaily : Math.max(1, Math.ceil((+tg.pomoTarget || 4) / 7));
    const state = t.running ? "running" : t.remaining ? "paused" : "ready";
    const locked = t.running || t.remaining;
    const col = t.cat ? colorOf(t.cat) : "#7fd8e6";
    const todayMin = minsOf(st.todayList);

    root.innerHTML = `<div id="po-root" class="po ${state}${motionEnabled() ? "" : " still"}" style="--cat:${col}">
      <div class="page-h"><h1>Pomodoro</h1><span class="sub">${formatDuration(todayMin) || "0m"} focused today · ${plural(db.pomodoroSessions.length, "session")} all time</span><span class="sp"></span>
        <div class="po-goals" title="Targets are set in Analytics">
          <span><em>today</em><b class="num">${st.todayList.length}<small>/${daily}</small></b></span>
          <span><em>this week</em><b class="num">${st.weekN}<small>/${Math.max(1, +tg.pomoTarget || 4)}</small></b></span></div></div>

      <section class="card po-dive">
        <div class="po-pool" aria-hidden="true">${pool(f)}
          <div class="po-read"><span class="po-state">${state === "running" ? "under" : state === "paused" ? "holding breath" : "at the surface"}</span>
            <b id="po-time" class="num">${mmss(s)}</b><em>${esc(t.cat || "no category")}</em></div></div>
        <div class="po-ctl">
          <div class="po-k">dive into</div>
          <div class="po-cats" role="radiogroup" aria-label="Category">${cats.map((c, i) => `<label class="po-cat${c === t.cat ? " on" : ""}" style="--c:${colorOf(c)}"><input type="radio" name="po-cat" value="${esc(c)}"${c === t.cat ? " checked" : ""}${t.running ? " disabled" : ""} /><i></i>${esc(c)}${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}</label>`).join("") || `<span class="tag">Add a category below to start.</span>`}</div>
          <div class="po-k">for</div>
          <div class="po-dur">${PRESETS.map((m) => `<button class="po-pre${t.minutes === m ? " on" : ""}" data-act="preset" data-m="${m}"${locked ? " disabled" : ""}>${m}<small>min</small></button>`).join("")}
            <label class="po-custom"><input class="in num" type="number" id="po-min" min="1" max="240" value="${t.minutes}"${locked ? " disabled" : ""} aria-label="Minutes" /><small>min</small></label></div>
          <div class="po-btns"><button class="btn po-go" data-act="startstop">${t.running ? "Pause" : t.remaining ? "Resume" : "Start the dive"}</button>
            <button class="btn ghost" data-act="reset"${state === "ready" ? " disabled" : ""}>Reset</button></div>
          <p class="po-keys" aria-hidden="true"><span><kbd>Space</kbd> start · pause</span><span><kbd>R</kbd> reset</span><span><kbd>1</kbd>–<kbd>9</kbd> category</span></p>
        </div>
      </section>

      <div class="po-row">
        <section class="card po-today"><header class="po-h"><div><span class="po-k">today</span><h3>${st.todayList.length ? `${plural(st.todayList.length, "dive")} · ${formatDuration(todayMin)}` : "Nothing yet today"}</h3></div>
            <span class="po-goal-n num">${Math.min(st.todayList.length, daily)}/${daily}</span></header>
          <div class="po-pebbles">${pebbles(st.todayList, daily)}</div>
          ${st.todayList.length ? `<div class="po-mix">${mix(st.todayList)}</div>` : `<p class="po-hint">Each finished session drops a pebble here. Goal: ${plural(daily, "session")} a day.</p>`}</section>
        <section class="card po-heat"><header class="po-h"><div><span class="po-k">focus over time</span><h3 id="po-heat-t">${heatTitle()}</h3></div></header>
          <div id="po-heat">${heat(st)}</div></section>
      </div>

      <div class="po-row po-row2">
        <section class="card po-hist"><header class="po-h"><div><span class="po-k">the log</span><h3>Session history</h3></div></header>
          <div class="po-filter chips">${filterChips()}</div>
          <div id="po-hist">${history(focus)}</div></section>
        <div class="po-side">
          <section class="card po-log"><header class="po-h"><div><span class="po-k">forgot the timer?</span><h3>Log a past session</h3></div></header>
            <form id="po-manual" class="po-form">
              <select class="in" name="cat" aria-label="Category">${cats.map((c) => `<option${c === t.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
              <div class="po-form-r"><input class="in num" type="number" name="dur" min="1" max="600" value="25" aria-label="Minutes" /><span class="tag">min on</span><input class="in" type="date" name="date" value="${st.td}" aria-label="Date" /></div>
              <button class="btn">Log session</button></form></section>
          <section class="card po-catcard"><header class="po-h"><div><span class="po-k">categories</span><h3>Time per category</h3></div></header>
            ${categories(st)}
            <form id="po-addcat" class="po-addcat"><input class="in" name="name" placeholder="New category…" required autocomplete="off" aria-label="New category" /><button class="btn sm">Add</button></form></section>
        </div>
      </div></div>`;

    wire(root, app);
    after(root, app);
  },
};

/* ---------- the porthole ---------- */
function wave(phase, amp, len = 80) {
  let d = `M-20 ${amp * Math.sin(phase)}`;
  for (let x = -20; x <= 660; x += 10) d += ` L${x} ${(amp * Math.sin((x / len) * Math.PI * 2 + phase)).toFixed(2)}`;
  return d + " L660 320 L-20 320 Z";
}
function pool(f) {
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2, r1 = i % 5 ? 150 : 146, r2 = 155;
    return `<line x1="${(160 + r1 * Math.sin(a)).toFixed(1)}" y1="${(160 - r1 * Math.cos(a)).toFixed(1)}" x2="${(160 + r2 * Math.sin(a)).toFixed(1)}" y2="${(160 - r2 * Math.cos(a)).toFixed(1)}"${i % 5 ? "" : ' class="maj"'} />`; }).join("");
  const bubbles = [[118, 0, 3], [150, 1.6, 2], [176, 3.1, 4], [204, .8, 2.5], [134, 2.4, 2], [190, 4.2, 3]]
    .map(([x, d, r]) => `<circle class="po-bub" cx="${x}" cy="296" r="${r}" style="animation-delay:${d}s" />`).join("");
  return `<svg viewBox="0 0 320 320">
    <defs><clipPath id="po-clip"><circle cx="160" cy="160" r="138" /></clipPath>
      <linearGradient id="po-deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f8f9b" /><stop offset=".45" stop-color="#0d4f5c" /><stop offset="1" stop-color="#03161f" /></linearGradient>
      <radialGradient id="po-glassg" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#0b2b33" /><stop offset="1" stop-color="#020b10" /></radialGradient></defs>
    <circle cx="160" cy="160" r="138" fill="url(#po-glassg)" />
    <g clip-path="url(#po-clip)">
      <g id="po-water" transform="translate(0 ${level(f)})">
        <path class="po-wave w2" d="${wave(1.3, 5)}" /><path class="po-wave w1" d="${wave(0, 7)}" fill="url(#po-deep)" /></g>
      ${bubbles}
      <ellipse class="po-shine" cx="118" cy="82" rx="58" ry="26" transform="rotate(-28 118 82)" /></g>
    <circle class="po-rim" cx="160" cy="160" r="139" />
    <g class="po-ticks">${ticks}</g>
    <circle class="po-trk" cx="160" cy="160" r="152" pathLength="100" />
    <circle id="po-ring" class="po-arc" cx="160" cy="160" r="152" pathLength="100" style="stroke-dashoffset:${(100 * (1 - f)).toFixed(2)}" /></svg>`;
}

/* ---------- today: one pebble per session, empty rings up to the daily goal ---------- */
function pebbles(list, goal) {
  const out = list.map((x, i) => { const size = Math.round(22 + Math.min(1, Math.sqrt((+x.duration || 0) / 90)) * 24);
    return `<span class="po-peb" style="--c:${colorOf(x.category)};--s:${size}px" title="${esc(x.category)} · ${formatDuration(+x.duration) || "0m"}" data-i="${i}"><b class="num">${+x.duration || 0}</b></span>`; });
  for (let i = list.length; i < goal; i++) out.push(`<span class="po-peb hole" title="Goal: ${plural(goal, "session")}"></span>`);
  return out.join("");
}
function mix(list) {
  const by = {};
  for (const x of list) by[x.category] = (by[x.category] || 0) + (+x.duration || 0);
  const total = Math.max(1, minsOf(list));
  return `<div class="po-mixbar">${Object.entries(by).map(([c, m]) => `<i style="--c:${colorOf(c)};flex:${m}" title="${esc(c)} · ${formatDuration(m)}"></i>`).join("")}</div>
    <div class="po-mixkey">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, m]) => `<span style="--c:${colorOf(c)}"><i></i>${esc(c)} <em>${Math.round((m / total) * 100)}%</em></span>`).join("")}</div>`;
}

/* ---------- a year of focus (follows the history filter) ---------- */
const heatTitle = () => (ui.filter === "All" ? "The last twelve months" : `The last twelve months of ${esc(ui.filter)}`);
function heat(st) {
  const byDay = ui.filter === "All" ? st.byDay : db.pomodoroSessions.filter((x) => x.category === ui.filter).reduce((m, x) => { const d = normDate(x.date); if (d) m[d] = (m[d] || 0) + (+x.duration || 0); return m; }, {});
  const end = parseDate(st.td), start = new Date(end);
  start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 52 * 7); // Monday, 52 weeks back
  const lvl = (m) => (!m ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4);
  let cols = "", months = "", lastM = -1, total = 0, days = 0, best = { d: null, m: 0 };
  for (let w = 0; w < 53; w++) {
    let cells = "";
    for (let k = 0; k < 7; k++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + k);
      const ds = iso(d), m = byDay[ds] || 0, future = d > end;
      if (k === 0 && d.getMonth() !== lastM && d.getDate() <= 7) { months += `<span style="grid-column:${w + 1}">${d.toLocaleDateString("en-US", { month: "short" })}</span>`; lastM = d.getMonth(); }
      if (m) { total += m; days++; if (m > best.m) best = { d: ds, m }; }
      cells += future ? `<i class="fut"></i>` : `<i class="l${lvl(m)}${ds === st.td ? " td" : ""}" title="${fmtDate(ds, { year: true })} · ${formatDuration(m) || "no focus"}"></i>`;
    }
    cols += `<div class="po-hw">${cells}</div>`;
  }
  // streak: consecutive days with focus, ending today (or yesterday if today has none yet)
  let streak = 0; const d = parseDate(st.td);
  if (!byDay[st.td]) d.setDate(d.getDate() - 1);
  while (byDay[iso(d)]) { streak++; d.setDate(d.getDate() - 1); }
  return `<div class="po-hscroll"><div class="po-hm">${months}</div><div class="po-hgrid"><div class="po-hdays"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>${cols}</div></div>
    <div class="po-hfoot"><div class="po-hstats">
      <span><b class="num">${formatDuration(total) || "0m"}</b><em>in a year</em></span>
      <span><b class="num">${days}</b><em>days in the water</em></span>
      <span><b class="num">${days ? formatDuration(Math.round(total / days)) : "—"}</b><em>per active day</em></span>
      <span><b class="num">${best.d ? formatDuration(best.m) : "—"}</b><em>${best.d ? `deepest · ${fmtDate(best.d)}` : "deepest day"}</em></span>
      <span><b class="num">${streak}</b><em>day streak</em></span></div>
      <div class="po-hkey"><em>shallow</em><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><em>deep</em></div></div>`;
}

/* ---------- history ---------- */
function filterChips() {
  const cats = db.pomodoroCategories, orphans = [...new Set(db.pomodoroSessions.map((x) => x.category))].filter((c) => c && !cats.includes(c));
  return ["All", ...cats, ...orphans].map((c) => `<button class="chip${ui.filter === c ? " on" : ""}${orphans.includes(c) ? " gone" : ""}" data-act="filter" data-c="${esc(c)}"${c !== "All" ? ` style="--c:${colorOf(c)}"` : ""}${orphans.includes(c) ? ' title="Removed category — its sessions are kept"' : ""}>${c !== "All" ? "<i></i>" : ""}${esc(c)}</button>`).join("");
}
function history(focus) {
  const list = db.pomodoroSessions.filter((x) => ui.filter === "All" || x.category === ui.filter)
    .map((x, i) => [x, i]).sort((a, b) => (b[0].date || "").localeCompare(a[0].date || "") || b[1] - a[1]).map((p) => p[0]);
  if (focus && list.findIndex((x) => x.id === focus) >= 30) ui.showAll = true;
  const shown = ui.showAll ? list : list.slice(0, 30);
  const perDay = {};
  for (const x of list) perDay[x.date] = (perDay[x.date] || 0) + (+x.duration || 0);
  let out = "", lastD = null;
  for (const x of shown) {
    if (x.date !== lastD) { lastD = x.date; const dayMin = perDay[x.date]; out += `<div class="po-dh"><span>${esc(fmtDate(x.date, { year: true }) || x.date || "no date")}</span><em class="num">${formatDuration(dayMin) || "0m"}</em></div>`; }
    out += `<div class="row po-sess" data-row="${esc(x.id)}" style="--c:${colorOf(x.category)}"><i class="po-dot"></i><span class="t">${esc(x.category)}</span><span class="m num">${formatDuration(+x.duration) || "0m"}</span>
      <span class="acts"><button class="x" data-act="del" data-id="${esc(x.id)}" title="Delete session" aria-label="Delete ${esc(x.category)} session from ${esc(fmtDate(x.date))}">×</button></span></div>`;
  }
  const total = minsOf(list);
  return `<p class="po-sum">${plural(list.length, "session")}${ui.filter === "All" ? "" : ` in ${esc(ui.filter)}`} · ${formatDuration(total) || "0m"}</p>
    ${out || `<div class="empty">No sessions yet — start the timer.</div>`}
    ${list.length > 30 ? `<button class="more" data-act="all">${ui.showAll ? "Show less" : `Show all ${list.length}`}</button>` : ""}`;
}
function categories(st) {
  const cats = db.pomodoroCategories, max = Math.max(1, ...cats.map((c) => st.byCat[c] || 0));
  const top = Object.entries(st.byCat).sort((a, b) => b[1] - a[1])[0];
  return `<div class="po-cl">${cats.map((c) => `<div class="row po-crow" style="--c:${colorOf(c)};--v:${((st.byCat[c] || 0) / max).toFixed(3)}"><i class="po-dot"></i><span class="t">${esc(c)}</span><span class="po-cbar"></span><span class="m num">${formatDuration(st.byCat[c] || 0) || "—"}</span>
      <span class="acts"><button class="x" data-act="delcat" data-c="${esc(c)}" title="Remove category (its sessions are kept)" aria-label="Remove category ${esc(c)}">×</button></span></div>`).join("") || `<div class="empty">No categories yet.</div>`}</div>
    ${top ? `<p class="po-top">Most time: <b>${esc(top[0])}</b> · ${formatDuration(top[1])}</p>` : ""}`;
}

/* ---------- behaviour ---------- */
function startStop(app) {
  if (!t.cat) return toast("Add a category first");
  if (t.running) { t.remaining = left(); t.running = false; clearInterval(tick); document.title = BASE_TITLE; }
  else { t.endAt = Date.now() + (t.remaining || t.minutes * 60) * 1000; t.running = true; loop(); ui.dive = true; }
  persist(); app.refresh();
}
function reset(app) { t.running = false; t.remaining = 0; clearInterval(tick); document.title = BASE_TITLE; persist(); app.refresh(); }
function pickCat(c, app) { if (t.running || !db.pomodoroCategories.includes(c)) return; t.cat = c; persist(); app.refresh(); document.querySelector(`.po-cat input[value="${CSS.escape(c)}"]`)?.focus(); }

function wire(root, app) {
  root.querySelector(".po-cats")?.addEventListener("change", (e) => { if (e.target.name === "po-cat") pickCat(e.target.value, app); });
  root.querySelector("#po-min")?.addEventListener("change", (e) => { t.minutes = Math.max(1, +e.target.value || 25); persist(); app.refresh(); });
  root.querySelector("#po-manual").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!f.get("cat")) return toast("Add a category first");
    db.pomodoroSessions.push({ id: newId(), category: f.get("cat"), duration: Math.max(1, +f.get("dur") || 1), date: normDate(f.get("date")) || today(), completed: true });
    commit(); app.refresh(); toast("Session logged");
  };
  root.querySelector("#po-addcat").onsubmit = (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get("name").trim();
    if (name && !db.pomodoroCategories.includes(name)) { db.pomodoroCategories.push(name); commit(); toast(`Added “${name}”`); }
    app.refresh();
    root.querySelector("#po-addcat [name=name]")?.focus();
  };
  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case "startstop": return startStop(app);
      case "reset": return reset(app);
      case "preset": t.minutes = +b.dataset.m; persist(); return app.refresh();
      case "filter": ui.filter = b.dataset.c; ui.showAll = false; return updateLists(root);
      case "all": ui.showAll = !ui.showAll; return updateLists(root);
      case "del": if (!confirm("Delete this session?")) return; db.pomodoroSessions = db.pomodoroSessions.filter((x) => x.id !== b.dataset.id); break;
      case "delcat": if (!confirm(`Remove category “${b.dataset.c}”? Its sessions are kept.`)) return; db.pomodoroCategories = db.pomodoroCategories.filter((c) => c !== b.dataset.c); break;
      default: return;
    }
    commit(); app.refresh();
  };
}
// the filter only redraws the history list and the heatmap, not the whole tab
function updateLists(root) {
  root.querySelector(".po-filter").innerHTML = filterChips();
  root.querySelector("#po-hist").innerHTML = history();
  root.querySelector("#po-heat-t").innerHTML = heatTitle();
  root.querySelector("#po-heat").innerHTML = heat(stats());
}

function after(root, app) {
  const on = motionEnabled(), entering = ui.enter || app.entering;
  ui.enter = false;
  if (on && !app.entering && ui.dive) { // anticipation, then the plunge
    animate(root.querySelector(".po-pool"), { scale: [0.94, 1], duration: 620, ease: "outBack(2.2)" });
    animate(root.querySelectorAll(".po-bub"), { opacity: [0, 1], duration: 300, delay: stagger(60) });
  }
  ui.dive = false;
  if (ui.splash) {
    ui.splash = false;
    const pool = root.querySelector(".po-pool"), pebs = root.querySelectorAll(".po-peb:not(.hole)"), peb = pebs[pebs.length - 1];
    if (on && pool) {
      const r = pool.getBoundingClientRect();
      pulse(r.left + r.width / 2, r.top + r.height / 2, "#ff9f5a", 70);
      animate(pool, { scale: [1.06, 1], duration: 700, ease: "outElastic(1, .5)" });
    }
    if (on && peb) animate(peb, { scale: [0, 1], translateY: [-30, 0], duration: 700, ease: "outBack(2.4)" });
  } else if (on && entering) {
    animate(root.querySelectorAll(".po-peb"), { scale: [0.4, 1], opacity: [0, 1], delay: stagger(40, { start: 250 }), duration: 520, ease: "outBack(2)" });
    animate(root.querySelectorAll(".po-hw"), { opacity: [0, 1], translateY: [6, 0], delay: stagger(8, { start: 200 }), duration: 420, ease: "outQuart" });
  }
}

/* ---------- keyboard (only while the Pomodoro tab is on screen) ---------- */
addEventListener("keydown", (e) => {
  if (!document.getElementById("po-root") || !appRef || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const a = document.activeElement;
  if (/INPUT|TEXTAREA|SELECT/.test(a?.tagName) && a.type !== "radio") return;
  const pal = document.getElementById("palette"); if (pal && !pal.hidden) return;
  if (e.key === " " && !/BUTTON|INPUT/.test(a?.tagName)) { e.preventDefault(); return startStop(appRef); }
  if (e.key.toLowerCase() === "r") { e.preventDefault(); if (t.running || t.remaining) reset(appRef); return; }
  if (/^[1-9]$/.test(e.key)) { const c = db.pomodoroCategories[+e.key - 1]; if (c) { e.preventDefault(); pickCat(c, appRef); } }
});
