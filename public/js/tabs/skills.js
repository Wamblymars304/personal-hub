// Skills — "the practice room". Learn things instead of scrolling: each skill gets a target (the first 20 hours is
// enough to get past the awkward start of almost anything), a timeframe, milestones, links and logged practice.
// "Instead of scrolling" is the button for the moment you'd reach for your phone: it picks the active skill that's
// furthest behind schedule (or the one you choose), starts a short session timer and counts it as a scroll replaced.
//
// Saved in hub.json (web-only keys, the Python app doesn't know them):
//   skills: [{ id, name, why, cat, targetHours (default 20), start, end ("YYYY-MM-DD", end optional = open-ended),
//             status: "active" | "paused" | "done", created, doneAt?, noteId? (the note it came from), from? (suggestion key),
//             resources: [{ id, label, url }], milestones: [{ id, text, done, doneAt }],
//             sessions: [{ id, date, min, note, scroll? (true = an "instead of scrolling" session) }] }]
//   skillsMeta: { scrollsReplaced: [{ date, skillId, min }] }   (kept when a skill is deleted: the scroll was still replaced)
// A skill can also be a formal course: track ("study" | "language" | "practice"), level, units: [{ id, title, goal, hours }],
// with milestones adding { unit, type, url? } and resources adding { group } (no url = a book to find).
// The running timer lives in localStorage "hub.skillTimer": { skillId, startAt, acc (ms), running, scroll, target (min), note, rang }
// so it keeps going across tab switches and reloads; count() shows it in the sidebar, refreshed every second below.
import { db, commit, newId, today, iso, parseDate, normDate } from "../store.js";
import { esc, fmtDate, plural, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled, pulse } from "../background.js";

const KEY = "hub.skillTimer";
const DEFAULT_HOURS = 20;
const SCROLL_MINS = [10, 12, 15];
const QUICK_MINS = [15, 30, 60];
const PLAY = `<svg class="sk-pg" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" /></svg>`;
const CHEV = `<svg class="sk-cv" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>`;
const TRASH = `<svg class="sk-cv" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3.5h8M4.7 3.5V2h2.6v1.5M3 3.5l.6 6.5h4.8L9 3.5" /></svg>`;
const TRACKS = [["study", "Study"], ["language", "Languages"], ["practice", "Practice"]];
const BIB = ["Core texts", "Primary sources", "Scholarship", "Free online", "Tools"];
const VERB = { read: /^Read\s+/, listen: /^Listen to\s+/, watch: /^Watch\s+/, write: /^Write\s+/ };
/** An item's text without the verb its type tag already says: READ · "Hopkins, Dada and Surrealism…" */
const bare = (m) => { const t = VERB[m.type] ? m.text.replace(VERB[m.type], "") : m.text; return t.charAt(0).toUpperCase() + t.slice(1); };
const CATS = ["Study", "Code", "Music", "Art", "Language", "Performance", "Life", "Body"];
const DAY = 864e5;
// One-click ideas for a first skill (note = title of a note to link it to, if you have one with that name)
const SUGGEST = [
  { k: "drawing", name: "Drawing", cat: "Art", note: "", why: "Fifteen minutes a day of drawing from life." },
  { k: "piano", name: "Piano", cat: "Music", note: "", why: "Learn one piece you love, start to finish." },
  { k: "python", name: "Python", cat: "Code", note: "", why: "Automate one small chore of your own." },
  { k: "language", name: "A new language", cat: "Language", note: "", why: "A little every day beats a lot on Sundays." },
  { k: "writing", name: "Writing", cat: "Study", note: "", why: "One page a day, no editing." },
];
const ui = { show: "active", open: "", adding: false, edit: "", editSess: "", pick: "", scrollMin: 12, allSess: {}, undo: null, addRes: "", unit: {}, bib: {} };
let appRef = null, rootRef = null, last = null, undoT = null;

/* ---------- data ---------- */
const skills = () => {
  const list = (db.skills ||= []);
  for (const s of list) { s.sessions ||= []; s.milestones ||= []; s.resources ||= []; s.status ||= "active"; }
  return list;
};
const scrolls = () => ((db.skillsMeta ||= {}).scrollsReplaced ||= []);
const byId = (id) => skills().find((s) => s.id === id);
const pad = (n) => String(n).padStart(2, "0");
const diff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);   // days from a to b
const addDays = (d, n) => { const x = parseDate(d); x.setDate(x.getDate() + n); return iso(x); };
const mondayOf = (d) => { const x = parseDate(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
const hrs = (min) => { const h = min / 60; return h >= 100 ? String(Math.round(h)) : String(+h.toFixed(1)); };
const hm = (min) => (min < 60 ? `${Math.round(min)} min` : `${hrs(min)} h`);
const noteByTitle = (t) => (db.notes || []).find((n) => (n.title || "").trim() === t) || (db.notes || []).find((n) => (n.title || "").startsWith(t));
const trackOf = (s) => s.track || (s.units?.length ? "study" : /^languages?$/i.test(s.cat || "") ? "language" : "practice");
/** A course's items grouped by unit, in syllabus order; anything without a unit goes last. */
const unitsOf = (s) => {
  const ids = new Set(s.units.map((u) => u.id)), group = (u, items) => ({ u, items, done: items.filter((m) => m.done).length });
  const out = s.units.map((u) => group(u, s.milestones.filter((m) => m.unit === u.id)));
  const rest = s.milestones.filter((m) => !ids.has(m.unit));
  return rest.length ? [...out, group({ id: "_", title: "Other", goal: "", hours: 0 }, rest)] : out;
};
const safeUrl = (u) => { u = String(u || "").trim(); return !u ? "" : /^https?:\/\//i.test(u) ? u : "https://" + u.replace(/^\/+/, ""); };

/** Everything a skill card shows, computed once per render. */
function stat(s, td) {
  const byDay = new Map();
  let total = 0, lastDay = "";
  for (const x of s.sessions) {
    const d = normDate(x.date), m = Math.max(0, +x.min || 0);
    total += m;
    if (d) { byDay.set(d, (byDay.get(d) || 0) + m); if (d > lastDay) lastDay = d; }
  }
  const target = (+s.targetHours > 0 ? +s.targetHours : DEFAULT_HOURS) * 60;
  const start = normDate(s.start) || normDate(s.created) || td, end = normDate(s.end);
  const gone = Math.max(0, diff(start, td)), span = end ? Math.max(1, diff(start, end)) : 0;
  const daysLeft = end ? diff(td, end) : null;
  const expected = end ? target * Math.min(1, gone / span) : null;   // minutes a straight line to the target would have by now
  const left = Math.max(0, target - total);
  const win = Math.max(7, Math.min(28, gone + 1));   // recent pace: the last 4 weeks (or since you started)
  let recent = 0;
  for (const [d, m] of byDay) { const k = diff(d, td); if (k >= 0 && k < win) recent += m; }
  const rate = recent / win;   // minutes a day
  const proj = left > 0 && rate > 0 ? addDays(td, Math.ceil(left / rate)) : null;
  const needWeek = end && left > 0 && daysLeft >= 0 ? (left / Math.max(1, daysLeft)) * 7 : null;
  let pace;
  if (s.status === "done") pace = ["done", "complete"];
  else if (left <= 0) pace = ["done", "target reached"];
  else if (s.status === "paused") pace = ["paused", "paused"];
  else if (!end) pace = ["open", "open-ended"];
  else if (daysLeft < 0) pace = ["behind", "past its date"];
  else { const slack = Math.max(30, target * 0.05); pace = total >= expected + slack ? ["ahead", "ahead"] : total >= expected - slack ? ["ok", "on track"] : ["behind", "behind"]; }
  const mon = mondayOf(td), weeks = [];
  for (let k = 7; k >= 0; k--) {
    const ws = addDays(mon, -7 * k); let m = 0;
    for (let i = 0; i < 7; i++) m += byDay.get(addDays(ws, i)) || 0;
    weeks.push([ws, m]);
  }
  // how far behind, in hours (open-ended skills: a week without practice counts as an hour behind)
  const urgency = end ? (expected - total) / 60 : diff(lastDay || start, td) / 7;
  return { total, target, left, start, end, daysLeft, expected, proj, needWeek, pace, lastDay, weeks, urgency, byDay };
}

/** The active skill furthest behind schedule — what "Instead of scrolling" suggests. */
function mostBehind(st) {
  const act = skills().filter((s) => s.status === "active" && st.get(s.id).left > 0);
  if (!act.length) return null;
  return act.reduce((a, b) => { const A = st.get(a.id), B = st.get(b.id); return B.urgency > A.urgency + 1e-9 || (Math.abs(B.urgency - A.urgency) < 1e-9 && (B.lastDay || "") < (A.lastDay || "")) ? b : a; });
}

/* ---------- the timer (keeps running across tabs and reloads) ---------- */
let tm = null, tick = null;
const readT = () => { try { tm = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { tm = null; } };
const saveT = () => { try { tm ? localStorage.setItem(KEY, JSON.stringify(tm)) : localStorage.removeItem(KEY); } catch {} };
const elapsed = () => (!tm ? 0 : (tm.acc || 0) + (tm.running ? Date.now() - tm.startAt : 0));
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600); return `${h ? h + ":" : ""}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
export const timerState = () => (tm ? clock(elapsed()) : null);
readT();

function beep() {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 660; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
    o.start(); o.stop(ctx.currentTime + 1);
  } catch {}
}
function paintClock() {
  if (!tm || !db) return;
  const ms = elapsed(), txt = clock(ms);
  document.querySelectorAll("[data-clock]").forEach((el) => (el.textContent = txt));
  const bar = document.getElementById("sk-clock-bar");
  if (bar && tm.target) bar.style.width = `${Math.min(100, (ms / (tm.target * 6e4)) * 100).toFixed(2)}%`;
  const n = document.querySelector('[data-tab="skills"] .n');
  if (n) n.textContent = txt;
  if (tm.running && tm.target && !tm.rang && ms >= tm.target * 6e4) {
    tm.rang = true; saveT(); beep();
    toast(`${tm.target} minutes of ${byId(tm.skillId)?.name || "practice"}. Keep going, or stop and log it.`);
    document.getElementById("sk-timer")?.classList.add("rang");
  }
}
function loop() { clearInterval(tick); tick = tm && tm.running ? setInterval(paintClock, 1000) : null; paintClock(); }
loop();
addEventListener("storage", (e) => {   // another window started, paused or stopped it
  if (e.key !== KEY) return;
  readT(); loop();
  if (document.getElementById("sk-root")) appRef?.refresh();
});

function startTimer(id, { scroll = false, target = 0 } = {}) {
  if (tm) {
    const cur = byId(tm.skillId);
    if (!confirm(`A ${cur?.name || "practice"} timer is running (${clock(elapsed())}). Stop and log it first?`)) return false;
    stopTimer(true, false);
  }
  tm = { skillId: id, startAt: Date.now(), acc: 0, running: true, scroll, target, note: "" };
  saveT(); loop();
  return true;
}
function stopTimer(log = true, quiet = false) {
  if (!tm) return;
  const ms = elapsed(), s = byId(tm.skillId), min = Math.round(ms / 6e4), { scroll, note } = tm;
  tm = null; saveT(); loop();
  if (!log) return toast("Timer discarded");
  if (!s) return toast("That skill is gone, so nothing was logged");
  if (min < 1) return toast("Under a minute: not logged");
  s.sessions.push({ id: newId(), date: today(), min, note: (note || "").trim(), ...(scroll ? { scroll: true } : {}) });
  if (scroll) scrolls().push({ date: today(), skillId: s.id, min });
  commit();
  if (!quiet) toast(scroll ? `${min} min of ${s.name} instead of scrolling. Logged.` : `${min} min of ${s.name} logged`);
}

/* ---------- the view ---------- */
const tab = {
  id: "skills", label: "Skills", color: "#a8c4ff",
  count: () => timerState() || skills().filter((s) => s.status === "active").length || null,
  render(root, app, focus) {
    appRef = app; rootRef = root;
    if (focus && byId(focus)) { const s = byId(focus); ui.open = s.id; ui.show = s.status === "active" ? "active" : "all"; ui.edit = ""; }
    const td = today(), list = skills(), st = new Map(list.map((s) => [s.id, stat(s, td)]));
    last = { td, st };
    const totalMin = [...st.values()].reduce((a, x) => a + x.total, 0), active = list.filter((s) => s.status === "active").length;
    const counts = { active, paused: list.filter((s) => s.status === "paused").length, done: list.filter((s) => s.status === "done").length, all: list.length };
    if (ui.show !== "all" && !counts[ui.show] && list.length) ui.show = "all";
    const shown = list.filter((s) => ui.show === "all" || s.status === ui.show)
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : b.status === "active" ? 1 : a.status === "paused" ? -1 : 1) || st.get(b.id).urgency - st.get(a.id).urgency);
    const adding = ui.adding || !list.length;

    root.innerHTML = `<div id="sk-root" class="sk">
      <div class="page-h sk-head"><h1>Skills</h1><span class="sp"></span>
        ${list.length ? `<button class="btn${adding ? " ghost" : ""}" data-act="add" aria-expanded="${adding}">${adding ? "Close" : "Add a skill"}</button>` : ""}</div>
      <div class="sk-top">
        <section class="card sk-scroll${tm ? " live" : ""}" id="sk-scroll">${scrollCard()}</section>
        <section class="card sk-over">${overview(td, st)}</section>
      </div>
      ${adding ? `<section class="card sk-add" id="sk-add">${form(null)}${suggestions()}</section>` : ""}
      ${list.length ? `<section class="sk-list">
        ${counts.paused || counts.done ? `<div class="sk-seg" role="tablist" aria-label="Show">${[["active", "in practice"], ["paused", "paused"], ["done", "complete"], ["all", "all"]]
          .map(([k, l]) => `<button role="tab" aria-selected="${ui.show === k}" class="${ui.show === k ? "on" : ""}" data-act="show" data-k="${k}"${counts[k] ? "" : " disabled"}>${l}<em>${counts[k]}</em></button>`).join("")}</div>` : ""}
        <div class="sk-cols" aria-hidden="true"><span></span><span>skill</span><span>last 4 weeks</span><span>milestones</span><span>start or log minutes</span></div>
        <div class="sk-board">${board(shown, st, td)}</div></section>` : ""}
      <div class="sk-tip" id="sk-tip" role="tooltip" hidden></div>
    </div>`;
    wire(root);
    if (app.entering && motionEnabled()) {
      const go = (sel, o) => { const els = root.querySelectorAll(sel); if (els.length) animate(els, o); };
      go(".sk-top > .card, .sk-row", { opacity: [0, 1], translateY: [12, 0], delay: stagger(40), duration: 480, ease: "outBack(1.4)" });
      go(".sk-sp b", { scaleY: [0, 1], duration: 420, delay: stagger(5, { start: 160 }), ease: "outBack(1.8)" });
      go(".sk-hc i", { scale: [0, 1], duration: 340, delay: stagger(3, { start: 120 }), ease: "outBack(2.2)" });
      root.querySelectorAll(".sk-ring .v").forEach((el, i) => el.animate([{ strokeDashoffset: +el.dataset.c }, { strokeDashoffset: +el.dataset.o }], { duration: 760, delay: 120 + i * 60, easing: "cubic-bezier(.2, .9, .3, 1.15)", fill: "backwards" }));
    }
    paintClock();
  },
};
export default tab;

/* "Instead of scrolling" — or, while a timer runs, the timer itself */
function scrollCard() {
  const { st } = last;
  if (tm) {
    const s = byId(tm.skillId), x = s && st.get(s.id);
    return `<div class="sk-timer${tm.rang ? " rang" : ""}" id="sk-timer">
      <span class="sk-k">${tm.running ? "practising" : "on hold"}${tm.scroll ? " · instead of scrolling" : ""}</span>
      <h2>${esc(s?.name || "a skill")}</h2>
      <div class="sk-clock"><b data-clock>${clock(elapsed())}</b>${tm.target ? `<em>of ${tm.target}:00</em>` : `<em>${x ? `${hm(x.total)} before this` : ""}</em>`}</div>
      ${tm.target ? `<i class="sk-bar sk-tbar"><u id="sk-clock-bar" style="width:${Math.min(100, (elapsed() / (tm.target * 6e4)) * 100).toFixed(2)}%"></u></i>` : ""}
      <input class="in sk-tnote" id="sk-tnote" maxlength="200" placeholder="note (optional)" aria-label="Note saved with this session" value="${esc(tm.note || "")}" />
      <div class="sk-tbtns"><button class="btn" data-act="t-stop">Stop &amp; log</button>
        <button class="btn ghost" data-act="t-pause">${tm.running ? "Pause" : "Resume"}</button>
        <button class="sk-link" data-act="t-discard">discard</button></div>
    </div>`;
  }
  const act = skills().filter((s) => s.status === "active" && st.get(s.id).left > 0);
  if (!act.length) return `<h2>Instead of scrolling,</h2>
    <p class="sk-instead">${skills().length ? "every skill is paused or finished." : "add something you want to learn."}</p>
    ${skills().length ? "" : `<button class="btn" data-act="add-open">See the ideas</button>`}`;
  const pick = (ui.pick && act.find((s) => s.id === ui.pick)) || mostBehind(st);
  return `<h2>Instead of scrolling,</h2>
    <select class="in sk-sel" id="sk-pick" aria-label="Which skill" title="Starts on the skill furthest behind">${act.map((s) => `<option value="${s.id}"${s.id === pick.id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
    <div class="sk-pick">
      <div class="sk-mins" role="group" aria-label="Minutes">${SCROLL_MINS.map((m) => `<button class="${ui.scrollMin === m ? "on" : ""}" data-act="smin" data-m="${m}" aria-pressed="${ui.scrollMin === m}">${m}</button>`).join("")}</div>
      <span class="sk-of">min</span>
      <button class="btn sk-go" data-act="scroll" data-id="${pick.id}">${PLAY}Start</button>
    </div>`;
}

/* this week, the streak, scrolls replaced, and a quiet 12-week heatmap */
function overview(td, st) {
  const wk = mondayOf(td), all = new Map();
  for (const s of skills()) for (const [d, m] of st.get(s.id).byDay) {
    const e = all.get(d) || all.set(d, { m: 0, per: [] }).get(d);
    e.m += m; e.per.push([s.name, m]);
  }
  let weekMin = 0, days = 0;
  for (const [d, e] of all) if (d >= wk && d <= td) { weekMin += e.m; days++; }
  let streak = 0;
  for (let d = all.has(td) ? td : addDays(td, -1); all.has(d); d = addDays(d, -1)) streak++;
  const lastWk = addDays(wk, -7); let lastMin = 0;
  for (const [d, e] of all) if (d >= lastWk && d < wk) lastMin += e.m;
  const first = addDays(wk, -7 * 11), cols = [];
  let tot12 = 0;
  for (let c = 0; c < 12; c++) {
    const ws = addDays(first, 7 * c), mon = parseDate(ws), prev = parseDate(addDays(ws, -7));
    const label = c === 0 || mon.getMonth() !== prev.getMonth() ? mon.toLocaleDateString("en-US", { month: "short" }) : "";
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d > td) { cells.push(`<i class="fut"></i>`); continue; }
      const e = all.get(d), m = e?.m || 0; tot12 += m;
      const lv = !m ? 0 : m < 15 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4;
      const tip = `${fmtDate(d)}${d === td ? " · today" : ""} · ${m ? hm(m) : "no practice"}${e ? " · " + e.per.sort((a, b) => b[1] - a[1]).map(([n, mm]) => `${n} ${hm(mm)}`).join(", ") : ""}`;
      cells.push(`<i class="l${lv}${d === td ? " td" : ""}" data-tip="${esc(tip)}"></i>`);
    }
    cols.push(`<div class="sk-hc"><span>${label}</span>${cells.join("")}</div>`);
  }
  const fig = (v, unit, label, tip) => `<div class="sk-fig" data-tip="${esc(tip)}"><b>${v}${unit ? `<small>${unit}</small>` : ""}</b><span>${label}</span></div>`;
  const wh = weekMin < 60 ? [Math.round(weekMin), "min"] : [hrs(weekMin), "h"];
  return `<div class="sk-figs">
      ${fig(wh[0], wh[1], "this week", `${plural(days, "day")} practised${lastMin ? ` · ${hm(lastMin)} last week` : ""}`)}
      ${fig(streak, "", "day streak", "Any skill counts")}
      ${fig(scrolls().filter((r) => (r.date || "") >= wk).length, "", "scrolls replaced", `This week · ${scrolls().length} all time`)}
    </div>
    <div class="sk-heat" aria-label="Practice over the last 12 weeks: ${hm(tot12)}">${cols.join("")}</div>`;
}

/* add / edit form */
function form(s) {
  const td = today(), v = s || { name: "", why: "", cat: "", targetHours: DEFAULT_HOURS, start: td, end: addDays(td, 56) };
  const cats = [...new Set([...CATS, ...skills().map((x) => x.cat).filter(Boolean)])];
  return `<form class="sk-form" data-form="${s ? "edit" : "add"}"${s ? ` data-id="${s.id}"` : ""}>
    <div class="sk-fields">
      <label class="sk-f wn"><span>name</span><input class="in" name="name" required maxlength="80" value="${esc(v.name)}" placeholder="Piano, Python, Japanese…" /></label>
      <label class="sk-f"><span>category</span><input class="in" name="cat" list="sk-cats-${s ? s.id : "new"}" maxlength="30" value="${esc(v.cat || "")}" placeholder="optional" />
        <datalist id="sk-cats-${s ? s.id : "new"}">${cats.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist></label>
      <label class="sk-f wh"><span>hours</span><input class="in" type="number" name="hours" min="0.5" max="10000" step="0.5" value="${+v.targetHours || DEFAULT_HOURS}" /></label>
      ${s ? `<label class="sk-f"><span>start</span><input class="in" type="date" name="start" value="${esc(normDate(v.start) || td)}" /></label>` : ""}
      <label class="sk-f"><span>finish by</span><input class="in" type="date" name="end" value="${esc(normDate(v.end))}" /></label>
      <div class="sk-f wk"><span>or in</span><div class="sk-wks">${[[4, "4w"], [8, "8w"], [12, "12w"], [0, "none"]].map(([w, l]) => `<button type="button" class="${!s && w === 8 ? "on" : ""}" data-act="wks" data-w="${w}">${l}</button>`).join("")}</div></div>
      <label class="sk-f wa"><span>why it matters</span><input class="in" name="why" maxlength="240" value="${esc(v.why || "")}" placeholder="optional" /></label>
    </div>
    <div class="sk-fbtns"><button class="btn" type="submit">${s ? "Save" : "Add skill"}</button>
      ${s ? `<button class="btn ghost" type="button" data-act="edit" data-id="">Cancel</button>` : ""}</div>
  </form>`;
}
function suggestions() {
  const have = new Set(skills().flatMap((s) => [s.name.trim().toLowerCase(), s.from]));
  const list = SUGGEST.filter((x) => !have.has(x.k) && !have.has(x.name.toLowerCase()));
  if (!list.length) return "";
  return `<div class="sk-sug"><span class="sk-k">ideas</span><div class="sk-sugs">${list.map((x) => `<button class="sk-sg" data-act="suggest" data-k="${x.k}" data-tip="${esc(`${x.why} Adds ${DEFAULT_HOURS} hours over 8 weeks.`)}">${esc(x.name)}</button>`).join("")}</div></div>`;
}

/* how far along: the arc is hours done, the tick is where a steady pace would be today */
function ring(s, x) {
  const R = 34, C = 2 * Math.PI * R, pct = Math.min(1, x.total / x.target), off = C * (1 - pct);
  const exp = x.expected != null && s.status === "active" && x.left > 0 ? Math.min(1, x.expected / x.target) : null;
  const a = exp != null ? exp * 2 * Math.PI : 0, pt = (r) => `x1="${(40 + r * Math.cos(a)).toFixed(2)}" y1="${(40 + r * Math.sin(a)).toFixed(2)}"`;
  const tick = exp != null && exp >= 0.03 ? `<line class="m" ${pt(29)} x2="${(40 + 39 * Math.cos(a)).toFixed(2)}" y2="${(40 + 39 * Math.sin(a)).toFixed(2)}" />` : "";   // too early to mean anything before 3%
  const done = x.total > 0 && x.total < 60 ? `${Math.round(x.total)}m` : hrs(x.total);
  const tip = `${hm(x.total)} of ${hrs(x.target)} h · ${Math.floor(pct * 100)}%${exp != null && exp >= 0.03 ? ` · the tick is where a steady pace would be today` : ""}`;
  return `<div class="sk-ring ${x.pace[0]}" data-tip="${esc(tip)}" role="img" aria-label="${esc(tip)}">
    <svg viewBox="0 0 80 80" aria-hidden="true"><circle class="t" cx="40" cy="40" r="${R}" />${pct > 0 ? `<circle class="v" cx="40" cy="40" r="${R}" stroke-dasharray="${C.toFixed(2)}" style="stroke-dashoffset:${off.toFixed(2)}" data-c="${C.toFixed(2)}" data-o="${off.toFixed(2)}" />` : ""}${tick}</svg>
    <div><b>${done}</b><em>of ${hrs(x.target)} h</em></div></div>`;
}

/* the last four weeks, one bar a day: the rhythm of practice at a glance */
function spark(s, x, td) {
  const first = addDays(mondayOf(td), -21), days = Array.from({ length: 28 }, (_, i) => addDays(first, i));
  const max = Math.max(30, ...days.map((d) => x.byDay.get(d) || 0));
  const bars = days.map((d, i) => {
    const m = x.byDay.get(d) || 0, fut = d > td;
    return `<i class="${fut ? "fut" : ""}${d === td ? " td" : ""}${i && i % 7 === 0 ? " wk" : ""}"${fut ? "" : ` data-tip="${esc(`${fmtDate(d)}${d === td ? " · today" : ""} · ${m ? hm(m) : "no practice"}`)}"`}>${m ? `<b style="height:${Math.max(16, (m / max) * 100).toFixed(0)}%"></b>` : ""}</i>`;
  }).join("");
  const week = x.weeks[7][1], aim = s.status === "active" ? x.needWeek : 0;
  return `<div class="sk-prac"><div class="sk-sp" role="img" aria-label="${esc(`${hm(week)} this week`)}">${bars}</div>
    <p class="sk-wkc"><b>${week ? hm(week) : "0"}</b>${aim ? ` / ${hm(aim)}` : ""} this week</p></div>`;
}

function board(shown, st, td) {
  if (!shown.length) return `<p class="sk-empty">Nothing here.</p>`;
  const groups = TRACKS.map(([k, l]) => [l, shown.filter((s) => trackOf(s) === k)]).filter(([, g]) => g.length);
  return groups.map(([l, g]) => `${groups.length > 1 ? `<h2 class="sk-gh">${l}<em>${g.length}</em></h2>` : ""}${g.map((s) => row(s, st.get(s.id), td)).join("")}`).join("");
}

/* one skill, one row */
function row(s, x, td) {
  const open = ui.open === s.id, live = tm?.skillId === s.id;
  const past = x.end && x.daysLeft < 0;
  const when = x.end ? (past ? `ended ${fmtDate(x.end)}` : `${plural(x.daysLeft, "day")} left`) : "no deadline";
  const flag = x.pace[0] === "ok" || x.pace[0] === "open" || (past && s.status === "active" && x.left > 0) ? "" : `<span class="sk-pace ${x.pace[0]}">${x.pace[1]}</span>`;
  const un = s.units?.length ? unitsOf(s) : null;
  const ms = s.milestones, msDone = ms.filter((m) => m.done).length, nxt = (un ? un.flatMap((g) => g.items) : ms).find((m) => !m.done);
  const undo = ui.undo?.skill === s.id ? `<button class="sk-link sk-undo" data-act="undo">undo</button>` : "";
  let acts = "";
  if (live) acts = `<span class="sk-livec"><i></i><b data-clock>${clock(elapsed())}</b></span><button class="btn sm" data-act="t-stop">Stop &amp; log</button>`;
  else if (s.status === "active") acts = `<button class="sk-play" data-act="timer" data-id="${s.id}" aria-label="Start a timer for ${esc(s.name)}" data-tip="Start a timer">${PLAY}</button>
      <div class="sk-quick" role="group" aria-label="Log minutes for ${esc(s.name)}">${QUICK_MINS.map((m) => `<button data-act="quick" data-id="${s.id}" data-m="${m}" aria-label="Log ${m} minutes" data-tip="Log ${m} minutes today">+${m}</button>`).join("")}</div>${undo}`;
  else if (s.status === "paused") acts = `<button class="btn ghost sm" data-act="status" data-id="${s.id}" data-v="active">Resume</button>`;
  return `<article class="sk-row ${s.status}${open ? " open" : ""}${live ? " live" : ""}" data-row="${s.id}">
    <div class="sk-rowm">
      ${ring(s, x)}
      <div class="sk-who"><h3><button class="sk-name" data-act="open" data-id="${s.id}" aria-expanded="${open}">${esc(s.name)}</button></h3>
        <p class="sk-meta">${[s.cat, un && plural(s.units.length, "unit"), when].filter(Boolean).map(esc).join(" · ")}${flag}</p></div>
      ${spark(s, x, td)}
      <div class="sk-msq">${ms.length ? `${un ? `<div class="sk-segs" role="img" aria-label="${msDone} of ${ms.length} items done across ${un.length} units">${un.map((g, i) => `<i data-tip="${esc(`${i + 1}. ${g.u.title} · ${g.done}/${g.items.length}`)}"><u style="width:${g.items.length ? ((g.done / g.items.length) * 100).toFixed(0) : 0}%"></u></i>`).join("")}<em>${msDone}/${ms.length}</em></div>`
          : `<div class="sk-dots" role="img" aria-label="${msDone} of ${ms.length} milestones done">${ms.map((m) => `<i class="${m.done ? "on" : ""}" data-tip="${esc(m.text)}"></i>`).join("")}<em>${msDone}/${ms.length}</em></div>`}
        ${nxt ? `<div class="sk-next"><button class="sk-check" role="checkbox" aria-checked="false" data-act="ms" data-id="${s.id}" data-m="${nxt.id}" aria-label="Mark done: ${esc(nxt.text)}"></button><span data-tip="${esc(nxt.text)}">${esc(nxt.text)}</span></div>` : `<p class="sk-alld">all done</p>`}`
        : `<button class="sk-link" data-act="open-ms" data-id="${s.id}">+ milestones</button>`}</div>
      <div class="sk-acts">${acts}<button class="sk-chev sk-del" data-act="del" data-id="${s.id}" aria-label="Delete ${esc(s.name)}" data-tip="Delete this skill">${TRASH}</button><button class="sk-chev sk-open" data-act="open" data-id="${s.id}" aria-expanded="${open}" aria-label="${open ? "Close" : "Open"} details for ${esc(s.name)}" data-tip="${open ? "Close" : "Details"}">${CHEV}</button></div>
    </div>
    ${open ? details(s, x, td) : ""}
  </article>`;
}

/* start to finish on one line, with a marker where your current pace lands */
function timeline(s, x, td) {
  if (!x.end || s.status !== "active" || x.left <= 0) return "";
  const span = Math.max(1, diff(x.start, x.end)), now = Math.min(1, Math.max(0, diff(x.start, td) / span));
  const near = x.proj && diff(td, x.proj) <= 730 ? x.proj : null, p = near ? diff(x.start, near) / span : null;
  const pd = near ? fmtDate(near, { year: parseDate(near).getFullYear() !== parseDate(td).getFullYear() }) : "";
  return `<div class="sk-tlw"><div class="sk-tl"><span>${fmtDate(x.start)}</span><i><u style="width:${(now * 100).toFixed(1)}%"></u>${p != null && p <= 1 ? `<b style="left:${(p * 100).toFixed(1)}%" data-tip="${esc(`At your pace: ${pd}`)}"></b>` : ""}</i><span>${fmtDate(x.end)}</span></div>
    <p class="sk-tlc">${x.needWeek ? `needs <b>${hm(x.needWeek)}</b> a week` : `<b>${hm(x.left)}</b> to go`}${near ? ` · on pace for <b>${pd}</b>` : ""}</p></div>`;
}

/* logging, the 8-week chart and the session list: the same for every skill */
function practice(s, x, td) {
  const sess = [...s.sessions].sort((a, b) => (normDate(b.date) || "").localeCompare(normDate(a.date) || "")), cap = ui.allSess[s.id] ? sess.length : 5;
  const wmax = Math.max(60, ...x.weeks.map(([, m]) => m), x.needWeek || 0), hasWeeks = x.weeks.some(([, m]) => m);
  return `<section class="sk-col sk-sess"><h4>Practice<em>${hm(x.total)}</em></h4>
    ${hasWeeks ? `<div class="sk-wk" aria-label="Last 8 weeks">${x.weeks.map(([ws, m], i) => `<span data-tip="${esc(`week of ${fmtDate(ws)} · ${m ? hm(m) : "no practice"}`)}"><i><b style="height:${m ? Math.max(6, (m / wmax) * 100).toFixed(1) : 0}%"></b></i><em>${i === 7 ? "now" : i === 0 ? "8w" : ""}</em></span>`).join("")}
      ${x.needWeek && s.status === "active" ? `<s style="--y:${Math.min(1, x.needWeek / wmax).toFixed(3)}"></s>` : ""}</div>` : ""}
    <form class="sk-log" data-form="log" data-id="${s.id}"><input class="in" type="number" name="min" min="1" max="1440" placeholder="min" aria-label="Minutes practised" required />
      <input class="in" type="date" name="date" value="${esc(td)}" max="${esc(td)}" aria-label="Date" /><input class="in" name="note" maxlength="200" placeholder="note" aria-label="Note (optional)" /><button class="btn ghost sm" type="submit">Log</button></form>
    ${sess.length ? `<ul>${sess.slice(0, cap).map((e) => ui.editSess === e.id
      ? `<li class="ed"><form class="sk-inl" data-form="sess" data-id="${s.id}" data-sess="${e.id}"><input class="in" type="date" name="date" value="${esc(normDate(e.date))}" required /><input class="in" type="number" name="min" min="1" max="1440" value="${+e.min || 0}" required /><input class="in" name="note" maxlength="200" value="${esc(e.note || "")}" placeholder="note" /><button class="btn sm" type="submit">Save</button><button class="sk-link" type="button" data-act="sess-edit" data-sess="">cancel</button></form></li>`
      : `<li><span class="d">${fmtDate(e.date)}</span><b>${hm(+e.min || 0)}</b><span class="n">${e.scroll ? `<i>scroll replaced</i>` : ""}${esc(e.note || "")}</span>
        <button class="sk-link" data-act="sess-edit" data-sess="${e.id}" aria-label="Edit session">edit</button><button class="sk-x" data-act="sess-del" data-id="${s.id}" data-sess="${e.id}" aria-label="Delete session">×</button></li>`).join("")}</ul>
      ${sess.length > 5 ? `<button class="sk-link sk-all" data-act="sess-all" data-id="${s.id}">${ui.allSess[s.id] ? "show fewer" : `show all ${sess.length}`}</button>` : ""}` : ""}</section>`;
}

const addLink = (s) => (ui.addRes === s.id
  ? `<form class="sk-inl" data-form="res" data-id="${s.id}"><input class="in" name="label" maxlength="160" placeholder="label" aria-label="Link label" /><input class="in" name="url" maxlength="500" placeholder="link" aria-label="Link address" required /><button class="btn ghost sm" type="submit">Add</button></form>`
  : `<button class="sk-link" data-act="res-open" data-id="${s.id}">+ link</button>`);
const noteLink = (s) => { const note = s.noteId && (db.notes || []).find((n) => n.id === s.noteId); return note ? `<p class="sk-from"><button class="sk-link" data-act="note" data-id="${note.id}">“${esc((note.title || "").slice(0, 40))}” note</button></p>` : ""; };
const manage = (s) => `<footer class="sk-manage">
    <button class="sk-link" data-act="edit" data-id="${s.id}">edit</button>
    ${s.status === "done" ? `<button class="sk-link" data-act="status" data-id="${s.id}" data-v="active">reopen</button>`
      : `<button class="sk-link" data-act="status" data-id="${s.id}" data-v="${s.status === "paused" ? "active" : "paused"}">${s.status === "paused" ? "resume" : "pause"}</button>
         <button class="sk-link" data-act="status" data-id="${s.id}" data-v="done">mark complete</button>`}
    <span class="sp"></span><button class="sk-link danger" data-act="del" data-id="${s.id}">delete</button></footer>`;

function details(s, x, td) {
  if (ui.edit === s.id) return `<div class="sk-det sk-det-f">${form(s)}</div>`;
  if (s.units?.length) return courseDetails(s, x, td);
  const tl = timeline(s, x, td);
  return `<div class="sk-det">
    ${s.why || tl ? `<div class="sk-dh">${s.why ? `<p class="sk-why">${esc(s.why)}</p>` : ""}${tl}</div>` : ""}
    <div class="sk-dc">
      <section class="sk-col"><h4>Milestones<em>${s.milestones.filter((m) => m.done).length}/${s.milestones.length}</em></h4>
        <ul class="sk-ms">${s.milestones.map((m) => `<li class="${m.done ? "on" : ""}"><button class="sk-check" role="checkbox" aria-checked="${!!m.done}" data-act="ms" data-id="${s.id}" data-m="${m.id}" aria-label="${esc(m.text)}"></button>
          <span>${esc(m.text)}</span><button class="sk-x" data-act="ms-del" data-id="${s.id}" data-m="${m.id}" aria-label="Remove milestone">×</button></li>`).join("")}</ul>
        <form class="sk-inl" data-form="ms" data-id="${s.id}"><input class="in" name="text" maxlength="140" placeholder="add a milestone, then Enter" aria-label="Add a milestone" required /></form></section>
      ${practice(s, x, td)}
      <section class="sk-col sk-resc"><h4>Links<em>${s.resources.length || ""}</em></h4>
        <ul class="sk-res">${s.resources.map((r) => `<li><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener" title="${esc(safeUrl(r.url))}">${esc(r.label || r.url)}</a>
          <button class="sk-x" data-act="res-del" data-id="${s.id}" data-r="${r.id}" aria-label="Remove link">×</button></li>`).join("")}</ul>
        ${addLink(s)}${noteLink(s)}</section>
    </div>
    ${manage(s)}
  </div>`;
}

/* a formal course: the syllabus unit by unit, then logging and the bibliography beside it */
function courseDetails(s, x, td) {
  const un = unitsOf(s), first = un.find((g) => g.done < g.items.length)?.u.id ?? "";
  const openU = s.id in ui.unit ? ui.unit[s.id] : first, tl = timeline(s, x, td);
  const done = s.milestones.filter((m) => m.done).length;
  const units = un.map((g, i) => {
    const on = g.u.id === openU, pct = g.items.length ? (g.done / g.items.length) * 100 : 0;
    const items = g.items.map((m) => `<li class="${m.done ? "on" : ""}"><button class="sk-check" role="checkbox" aria-checked="${!!m.done}" data-act="ms" data-id="${s.id}" data-m="${m.id}" aria-label="${esc(m.text)}"></button>
      <span class="sk-ty">${esc(m.type || "")}</span><span class="t">${esc(bare(m))}${m.url ? ` <a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener" aria-label="Open source" title="${esc(safeUrl(m.url))}">↗</a>` : ""}</span>
      <button class="sk-x" data-act="ms-del" data-id="${s.id}" data-m="${m.id}" aria-label="Remove item">×</button></li>`).join("");
    return `<article class="sk-unit${on ? " on" : ""}${g.items.length && g.done === g.items.length ? " complete" : ""}">
      <button class="sk-uh" data-act="unit" data-id="${s.id}" data-u="${esc(g.u.id)}" aria-expanded="${on}"><span class="sk-un">${i + 1}</span><b>${esc(g.u.title)}</b>
        <i class="sk-ubar"><u style="width:${pct.toFixed(0)}%"></u></i><em>${g.done}/${g.items.length}</em><em class="h">${g.u.hours ? `${g.u.hours} h` : ""}</em>${CHEV}</button>
      ${on ? `<div class="sk-ubody">${g.u.goal ? `<p class="sk-goal">${esc(g.u.goal)}</p>` : ""}<ul class="sk-items">${items}</ul>
        <form class="sk-inl" data-form="ms" data-id="${s.id}" data-unit="${esc(g.u.id)}"><input class="in" name="text" maxlength="160" placeholder="add an item, then Enter" aria-label="Add an item to this unit" required /></form></div>` : ""}
    </article>`;
  }).join("");
  return `<div class="sk-det">
    <div class="sk-dh">${s.why ? `<p class="sk-why">${esc(s.why)}</p>` : ""}${tl}</div>
    <p class="sk-lvl">${[plural(s.units.length, "unit"), `${hrs(x.target)} h`, s.level].filter(Boolean).map(esc).join(" · ")}</p>
    <div class="sk-cw">
      <section class="sk-col sk-syll"><h4>Syllabus<em>${done}/${s.milestones.length}</em></h4>${units}</section>
      <div class="sk-side">${practice(s, x, td)}${bibliography(s)}</div>
    </div>
    ${manage(s)}
  </div>`;
}

function bibliography(s) {
  const gs = new Map();
  for (const r of s.resources) { const g = r.group || "Links"; gs.get(g) ? gs.get(g).push(r) : gs.set(g, [r]); }
  const rank = (g) => { const i = BIB.indexOf(g); return i < 0 ? BIB.length : i; };
  const names = [...gs.keys()].sort((a, b) => rank(a) - rank(b));
  return `<section class="sk-col sk-bib"><h4>Bibliography<em>${s.resources.length}</em></h4>
    ${names.map((g, i) => {
      const k = `${s.id}:${g}`, on = k in ui.bib ? ui.bib[k] : i === 0;
      return `<div class="sk-bg"><button class="sk-bgh" data-act="bibg" data-id="${s.id}" data-g="${esc(g)}" aria-expanded="${on}">${esc(g)}<em>${gs.get(g).length}</em>${CHEV}</button>
        ${on ? `<ul class="sk-bl">${gs.get(g).map((r) => `<li>${r.url ? `<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener" title="${esc(safeUrl(r.url))}">${esc(r.label || r.url)} <span>↗</span></a>` : `<span>${esc(r.label)}</span>`}
          <button class="sk-x" data-act="res-del" data-id="${s.id}" data-r="${r.id}" aria-label="Remove from the bibliography">×</button></li>`).join("")}</ul>` : ""}</div>`;
    }).join("")}
    ${addLink(s)}${noteLink(s)}</section>`;
}

/* ---------- interaction ---------- */
function repaint() { if (appRef && rootRef) tab.render(rootRef, { ...appRef, entering: false }); }

function addSkill(v, from) {
  const td = today(), s = { id: newId(), name: v.name, why: v.why || "", cat: v.cat || "", targetHours: v.hours || DEFAULT_HOURS, start: v.start || td, end: v.end || "",
    status: "active", created: td, resources: [], milestones: [], sessions: [] };
  if (from) { s.from = from.k; const n = from.note && noteByTitle(from.note); if (n) s.noteId = n.id; }
  skills().push(s); commit();
  return s;
}
function readForm(f) {
  const g = (n) => (f.elements[n]?.value || "").trim();
  const start = normDate(g("start")) || today();
  const end = normDate(g("end"));
  return { name: g("name"), why: g("why"), cat: g("cat"), hours: Math.max(0.5, +g("hours") || DEFAULT_HOURS), start, end };
}

function onSubmit(e) {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const s = byId(f.dataset.id), kind = f.dataset.form, g = (n) => (f.elements[n]?.value || "").trim();
  if (kind === "add") {
    const v = readForm(f);
    if (!v.name) return;
    if (v.end && v.end < v.start) return toast("“Finish by” is before the start date");
    const n = addSkill(v); ui.open = ""; ui.adding = false; ui.show = "active";
    toast(`${n.name} added`); repaint(); return requestAnimationFrame(() => flashRow(n.id));
  }
  if (!s) return;
  if (kind === "edit") {
    const v = readForm(f);
    if (!v.name) return;
    if (v.end && v.end < v.start) return toast("“Finish by” is before the start date");
    Object.assign(s, { name: v.name, why: v.why, cat: v.cat, targetHours: v.hours, start: v.start, end: v.end });
    ui.edit = ""; commit(); toast("Saved");
  } else if (kind === "log") {
    const min = Math.round(+g("min"));
    if (!(min > 0)) return;
    s.sessions.push({ id: newId(), date: normDate(g("date")) || today(), min: Math.min(1440, min), note: g("note") });
    commit(); burst(f); toast(`${hm(min)} of ${s.name} logged`);
  } else if (kind === "ms") {
    if (!g("text")) return;
    const u = f.dataset.unit && f.dataset.unit !== "_" ? { unit: f.dataset.unit, type: "read" } : {};
    s.milestones.push({ id: newId(), text: g("text"), done: false, doneAt: "", ...u }); commit();
    repaint(); return refocus(`form[data-form="ms"][data-id="${s.id}"] input`);
  } else if (kind === "res") {
    const url = safeUrl(g("url"));
    if (!url) return;
    s.resources.push({ id: newId(), label: g("label") || url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""), url }); commit();
    repaint(); return refocus(`form[data-form="res"][data-id="${s.id}"] input`);
  } else if (kind === "sess") {
    const e2 = s.sessions.find((x) => x.id === f.dataset.sess), min = Math.round(+g("min")), d = normDate(g("date"));
    if (!e2 || !(min > 0) || !d) return;
    Object.assign(e2, { date: d, min: Math.min(1440, min), note: g("note") }); ui.editSess = ""; commit();
  }
  repaint();
}

function onClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b || !rootRef.contains(b)) return;
  const id = b.dataset.id, s = byId(id);
  switch (b.dataset.act) {
    case "add": ui.adding = !ui.adding; repaint(); if (ui.adding) { document.getElementById("sk-add")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); refocus("#sk-add input[name=name]", true); } return;
    case "add-open": ui.adding = true; repaint(); document.getElementById("sk-add")?.scrollIntoView({ block: "start", behavior: "smooth" }); return refocus("#sk-add .sk-sg", true);
    case "show": ui.show = b.dataset.k; break;
    case "open": ui.open = ui.open === id ? "" : id; ui.edit = ""; ui.editSess = ""; repaint(); if (ui.open) requestAnimationFrame(() => document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })); return;
    case "suggest": {
      const x = SUGGEST.find((y) => y.k === b.dataset.k);
      if (!x) return;
      const n = addSkill({ name: x.name, why: x.why, cat: x.cat, hours: DEFAULT_HOURS, start: today(), end: addDays(today(), 56) }, x);
      ui.show = "active"; ui.adding = true; toast(`${n.name} added: ${DEFAULT_HOURS} hours by ${fmtDate(n.end)}`);
      if (motionEnabled()) { const r = b.getBoundingClientRect(); pulse(r.left + r.width / 2, r.top + r.height / 2, "#a8c4ff", 26); }
      break;
    }
    case "unit": ui.unit[id] = b.getAttribute("aria-expanded") === "true" ? "" : b.dataset.u; break;
    case "bibg": ui.bib[`${id}:${b.dataset.g}`] = b.getAttribute("aria-expanded") !== "true"; break;
    case "open-ms": ui.open = id; ui.edit = ""; repaint(); return refocus(`form[data-form="ms"][data-id="${id}"] input`);
    case "quick": {
      if (!s) return;
      const min = +b.dataset.m, e2 = { id: newId(), date: today(), min, note: "" };
      s.sessions.push(e2); commit(); burst(b); toast(`${hm(min)} of ${s.name} logged`);
      ui.undo = { skill: s.id, sess: e2.id };
      clearTimeout(undoT);
      undoT = setTimeout(() => { ui.undo = null; document.querySelectorAll('[data-act="undo"]').forEach((x) => x.remove()); }, 8000);
      break;
    }
    case "undo": {
      const u = ui.undo, sk = u && byId(u.skill);
      if (sk) { sk.sessions = sk.sessions.filter((y) => y.id !== u.sess); commit(); toast("Undone"); }
      ui.undo = null; clearTimeout(undoT);
      break;
    }
    case "res-open": ui.addRes = id; repaint(); return refocus(`form[data-form="res"][data-id="${id}"] input[name=url]`);
    case "wks": {
      const f = b.closest("form"), w = +b.dataset.w, from = normDate(f.elements.start?.value) || today();
      f.elements.end.value = w ? addDays(from, w * 7) : "";
      f.querySelectorAll(".sk-wks button").forEach((x) => x.classList.toggle("on", x === b));
      return;
    }
    case "note": return appRef.go("notes", id);
    case "smin": ui.scrollMin = +b.dataset.m; return paintScroll();
    case "scroll": if (startTimer(id, { scroll: true, target: ui.scrollMin })) { appRef.refresh(); refocus("#sk-tnote"); } return;
    case "timer": if (!s) return; if (startTimer(id)) { appRef.refresh(); window.scrollTo({ top: 0, behavior: "smooth" }); } return;
    case "t-pause": if (!tm) return; if (tm.running) { tm.acc = elapsed(); tm.running = false; } else { tm.startAt = Date.now(); tm.running = true; } saveT(); loop(); return paintScroll();
    case "t-stop": { const sid = tm?.skillId; stopTimer(true); if (motionEnabled()) burst(b); appRef.refresh(); if (sid) requestAnimationFrame(() => flashRow(sid, false)); return; }
    case "t-discard": if (tm && elapsed() > 6e4 && !confirm(`Discard ${clock(elapsed())} of practice without logging it?`)) return; stopTimer(false); return appRef.refresh();
    case "ms": {
      const m = s?.milestones.find((x) => x.id === b.dataset.m);
      if (!m) return;
      m.done = !m.done; m.doneAt = m.done ? today() : ""; commit();
      if (m.done && motionEnabled()) { const r = b.getBoundingClientRect(); pulse(r.left + r.width / 2, r.top + r.height / 2, "#a8c4ff", 18); }
      break;
    }
    case "ms-del": if (!s) return; s.milestones = s.milestones.filter((x) => x.id !== b.dataset.m); commit(); break;
    case "res-del": if (!s) return; s.resources = s.resources.filter((x) => x.id !== b.dataset.r); commit(); break;
    case "sess-edit": ui.editSess = b.dataset.sess || ""; repaint(); if (ui.editSess) refocus(`form[data-sess="${CSS.escape(ui.editSess)}"] input[name=min]`); return;
    case "sess-del": {
      const x = s?.sessions.find((y) => y.id === b.dataset.sess);
      if (!x || !confirm(`Delete the ${hm(+x.min || 0)} session on ${fmtDate(x.date)}?`)) return;
      s.sessions = s.sessions.filter((y) => y.id !== x.id); commit(); toast("Session deleted"); break;
    }
    case "sess-all": ui.allSess[id] = !ui.allSess[id]; break;
    case "edit": ui.edit = id || ""; repaint(); if (ui.edit) refocus(`form[data-form="edit"] input[name=name]`); return;
    case "status": {
      if (!s) return;
      s.status = b.dataset.v;
      if (s.status === "done") { s.doneAt = today(); if (motionEnabled()) burst(b); toast(`${s.name}: complete`); } else delete s.doneAt;
      if (tm?.skillId === s.id && s.status !== "active") { stopTimer(true); }
      commit(); appRef.refresh(); return;
    }
    case "del": {
      if (!s || !confirm(`Delete “${s.name}” and its ${plural(s.sessions.length, "session")}, milestones and links? This can't be undone.`)) return;
      if (tm?.skillId === s.id) stopTimer(false);
      db.skills = skills().filter((x) => x.id !== s.id); ui.open = ""; commit(); toast(`${s.name} deleted`); appRef.refresh(); return;
    }
    default: return;
  }
  repaint();
}

function paintScroll() {
  const el = document.getElementById("sk-scroll");
  if (!el || !last) return;
  el.className = `card sk-scroll${tm ? " live" : ""}`;
  el.innerHTML = scrollCard(); paintClock();
}
function refocus(sel, noScroll) { requestAnimationFrame(() => document.querySelector(sel)?.focus({ preventScroll: !!noScroll })); }
function flashRow(id, scroll = true) {
  const el = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (!el) return;
  if (scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1800);
}
function burst(el) { if (!motionEnabled() || !el?.getBoundingClientRect) return; const r = el.getBoundingClientRect(); pulse(r.left + r.width / 2, r.top + r.height / 2, "#a8c4ff", 30); }

function wire(root) {
  root.onclick = onClick;
  root.onsubmit = onSubmit;
  root.oninput = (e) => {
    const t = e.target;
    if (t.id === "sk-tnote" && tm) { tm.note = t.value; saveT(); return; }
    if (t.name === "end" && t.form) t.form.querySelectorAll(".sk-wks button").forEach((x) => x.classList.remove("on"));
  };
  root.onchange = (e) => { if (e.target.id === "sk-pick") { ui.pick = e.target.value; paintScroll(); } };
  const tip = root.querySelector("#sk-tip");
  root.onmouseover = (e) => {
    const c = e.target.closest?.("[data-tip]");
    if (!c || !tip) return;
    tip.textContent = c.dataset.tip; tip.hidden = false;
    const r = c.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 8}px`;
  };
  root.onmouseout = (e) => { if (tip && e.target.closest?.("[data-tip]") && !e.relatedTarget?.closest?.("[data-tip]")) tip.hidden = true; };
}
