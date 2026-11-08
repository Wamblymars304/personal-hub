// Analytics — "telemetry". One headline (the productivity score for the chosen period and what it is made
// of), then the supporting views: 30-day daily-score trend + insights, focus by category, busiest weekdays,
// burndown, the 66-day habit internalization tracker and a long "identity over time" strip.
// Score = tasks 20% + pomodoros 40% + habits & streaks 40% (weights rescale when a part has nothing to
// measure). Writes only productivityTargets { pomoTarget, habitTarget, streakTarget, pomoDaily }.
import { db, commit, today, iso, parseDate, normDate, formatDuration, currentStreak } from "../store.js";
import { esc, plural } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";
import { progressOf, STATUS_COLOR } from "./projects.js";
import { STATUS, trendSvg, barsSvg, meter, heatTable } from "./analytics-charts.js";

const INTERNALIZE = 66;
const ACTIVE = ["Planning", "In Progress", "On Hold"];
const PRIO = { High: 0, Medium: 1, Low: 2 };
const PERIODS = [["day", "Today"], ["week", "This week"], ["month", "This month"]];
const ui = { period: "week", win: 30, table: false, span: "year", anim: false };

// ── dates ──
const shift = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d); };
const daysIn = (a, b) => { const out = []; for (let d = a; d <= b; d = shift(d, 1)) out.push(d); return out; };
const monday = (s) => shift(s, -((parseDate(s).getDay() + 6) % 7));
const fmt = (s, o = { month: "short", day: "numeric" }) => parseDate(s).toLocaleDateString("en-US", o);
const ago = (s) => { const n = Math.round((parseDate(today()) - parseDate(s)) / 864e5); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
const dur = (m) => formatDuration(Math.round(m)) || "0m";
const num = (v) => (Math.round(v * 10) / 10).toString();

/** [start, end, elapsedDays, totalDaysInPeriod, label] for the chosen period (to date). */
function range(p = ui.period) {
  const t = today(), d = parseDate(t);
  if (p === "day") return [t, t, 1, 1];
  if (p === "week") { const s = monday(t); return [s, t, daysIn(s, t).length, 7]; }
  return [t.slice(0, 8) + "01", t, d.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()];
}
/** The same number of days at the same point of the previous period (a like-for-like comparison). */
function prevRange(p = ui.period) {
  const [s, , n] = range(p);
  if (p === "day") return [shift(s, -1), shift(s, -1), 1];
  if (p === "week") return [shift(s, -7), shift(s, -7 + n - 1), n];
  const d = parseDate(s); d.setMonth(d.getMonth() - 1); const ps = iso(d);
  const last = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), pe = shift(ps, n - 1) < last ? shift(ps, n - 1) : last;
  return [ps, pe, daysIn(ps, pe).length];
}

// ── one pass over the data per render ──
function buildIndex() {
  const tasks = new Map(), pomo = new Map(), checks = new Map();
  for (const t of db.schedule || []) { const d = normDate(t.date); if (!d) continue; const v = tasks.get(d) || { n: 0, done: 0 }; v.n++; if (t.done) v.done++; tasks.set(d, v); }
  for (const s of db.pomodoroSessions || []) { if (s.completed === false) continue; const d = normDate(s.date); if (!d) continue; const v = pomo.get(d) || { n: 0, min: 0 }; v.n++; v.min += +s.duration || 0; pomo.set(d, v); }
  const tracked = [...(db.habits || []).map((h) => ({ h, kind: "habit" })), ...(db.streaks || []).map((h) => ({ h, kind: "streak" }))];
  for (const x of tracked) {
    x.dates = [...new Set((x.h.activeDates || []).map(normDate).filter(Boolean))].sort();
    for (const d of x.dates) { const v = checks.get(d) || { habit: 0, streak: 0 }; v[x.kind]++; checks.set(d, v); }
  }
  return { tasks, pomo, checks, tracked };
}

function stats(ix, a, b) {
  const st = { tasksPlanned: 0, tasksDone: 0, pomoCount: 0, pomoMinutes: 0, habitChecks: 0, streakChecks: 0 };
  for (const d of daysIn(a, b)) {
    const t = ix.tasks.get(d), p = ix.pomo.get(d), c = ix.checks.get(d);
    if (t) { st.tasksPlanned += t.n; st.tasksDone += t.done; }
    if (p) { st.pomoCount += p.n; st.pomoMinutes += p.min; }
    if (c) { st.habitChecks += c.habit; st.streakChecks += c.streak; }
  }
  const touched = (kind) => ix.tracked.filter((x) => x.kind === kind && x.dates.some((d) => d >= a && d <= b)).length;
  st.habitsActive = touched("habit"); st.streaksActive = touched("streak");
  st.habitsTotal = (db.habits || []).length; st.streaksTotal = (db.streaks || []).length;
  st.active = st.tasksPlanned + st.pomoCount + st.habitChecks + st.streakChecks > 0;
  return st;
}

/** Targets. pomoDaily (pomodoros per day) drives every period; older data without it falls back to pomoTarget as a weekly figure. */
function targets() {
  const t = { pomoTarget: 4, habitTarget: 0, streakTarget: 0, ...(db.productivityTargets || {}) };
  const daily = +t.pomoDaily > 0 ? +t.pomoDaily : Math.max(1, +t.pomoTarget || 4) / 7;
  return { ...t, daily };
}

/** Score for `days` days. A part with nothing to measure (no tasks scheduled, no habits registered) is left out and the weights rescale. */
function score(st, days) {
  const tg = targets();
  const H = tg.habitTarget || st.habitsTotal, S = tg.streakTarget || st.streaksTotal;
  const focusGoal = tg.daily * days, checkGoal = (H + S) * days;
  const parts = [
    { key: "tasks", label: "Tasks", w: 20, on: st.tasksPlanned > 0, ratio: st.tasksPlanned ? st.tasksDone / st.tasksPlanned : 0,
      big: `${st.tasksDone}/${st.tasksPlanned}`, unit: "tasks done", off: "nothing scheduled — not counted" },
    { key: "focus", label: "Focus", w: 40, on: true, ratio: Math.min(1, st.pomoCount / focusGoal),
      big: `${st.pomoCount}/${num(focusGoal)}`, unit: `pomodoros · ${num(tg.daily)}/day`, off: "" },
    { key: "habits", label: "Habits & streaks", w: 40, on: H + S > 0, ratio: Math.min(1, (st.habitChecks + st.streakChecks) / Math.max(1, checkGoal)),
      big: `${st.habitChecks + st.streakChecks}/${checkGoal}`, unit: `check-ins · ${H + S}/day`, off: "nothing registered — not counted" },
  ];
  const W = parts.reduce((a, p) => a + (p.on ? p.w : 0), 0);
  parts.forEach((p) => { p.weight = p.on ? (p.w / W) * 100 : 0; p.pts = p.weight * p.ratio; });
  return { value: parts.reduce((a, p) => a + p.pts, 0), parts, H, S };
}

function dayScore(ix, d) {
  const t = ix.tasks.get(d) || { n: 0, done: 0 }, p = ix.pomo.get(d) || { n: 0, min: 0 }, c = ix.checks.get(d) || { habit: 0, streak: 0 };
  if (!t.n && !p.n && !c.habit && !c.streak) return { value: null, tip: `no activity\n${fmt(d, { weekday: "short", month: "short", day: "numeric" })}` };
  const st = { tasksPlanned: t.n, tasksDone: t.done, pomoCount: p.n, habitChecks: c.habit, streakChecks: c.streak, habitsTotal: (db.habits || []).length, streaksTotal: (db.streaks || []).length };
  const v = score(st, 1).value;
  return { value: v, st, tip: `${Math.round(v)} / 100\n${fmt(d, { weekday: "short", month: "short", day: "numeric" })}\n${t.n ? `${t.done}/${t.n} tasks` : "no tasks"} · ${plural(p.n, "pomodoro")} · ${plural(c.habit + c.streak, "check-in")}` };
}

const band = (v) => (v >= 70 ? ["good", "on track"] : v >= 40 ? ["warning", "partial"] : ["critical", "low"]);
const flag = (kind, text) => `<span class="an-flag" style="--c:${STATUS[kind]}"><i></i>${esc(text)}</span>`;

function longestRun(dates) {
  let best = 0, run = 0, prev = "";
  for (const d of dates) { run = prev && shift(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

function insights(ix, trend30) {
  const out = [];
  // most focused category (all time)
  const cat = {};
  let all = 0;
  for (const s of db.pomodoroSessions || []) if (s.completed !== false) { const m = +s.duration || 0; cat[s.category || "Uncategorised"] = (cat[s.category || "Uncategorised"] || 0) + m; all += m; }
  const best = Object.entries(cat).sort((a, b) => b[1] - a[1])[0];
  out.push(best ? { k: "Most focused · all time", v: best[0], s: `${dur(best[1])} · ${Math.round((best[1] / all) * 100)}% of all focus time` }
    : { k: "Most focused · all time", v: "—", s: "no focus sessions logged yet", muted: true });
  // needs attention: lowest current streak; ties → the one logged least recently
  const t = today();
  const tracked = ix.tracked.filter((x) => x.kind === "streak" || x.h.trackStreak).map((x) => ({ name: x.h.name, cur: currentStreak(x.dates), last: x.dates.filter((d) => d <= t).at(-1) || "" }));
  if (tracked.length) {
    tracked.sort((a, b) => a.cur - b.cur || a.last.localeCompare(b.last));
    const w = tracked[0], same = tracked.filter((x) => x.cur === w.cur).length - 1;
    out.push({ k: "Needs attention", v: w.name, s: `streak ${plural(w.cur, "day")} · ${w.last ? `last logged ${ago(w.last)}` : "never logged"}${same > 0 ? ` · ${same} more at ${w.cur}` : ""}`, flag: ["warning", "attention"] });
  } else out.push({ k: "Needs attention", v: "—", s: "no habits with the 66-day tracker, no streaks", muted: true });
  // schedule load: the whole of this week (Mon–Sun, incl. tasks still ahead) vs the whole of last week
  const m = monday(t), count = (a, b) => daysIn(a, b).reduce((n, d) => n + (ix.tasks.get(d)?.n || 0), 0);
  const thisT = count(m, shift(m, 6)), lastT = count(shift(m, -7), shift(m, -1));
  if (lastT) {
    const dl = thisT - lastT;
    out.push({ k: `${dl > 0 ? "↑" : dl < 0 ? "↓" : "→"} Schedule load`, v: dl > 0 ? "Busier than last week" : dl < 0 ? "Lighter than last week" : "Same as last week",
      s: `${plural(thisT, "task")} this week (Mon–Sun) · ${lastT} last week`, flag: dl > 6 ? ["warning", "heavy"] : null });
  } else out.push({ k: "Schedule load", v: "—", s: `nothing was scheduled last week to compare · ${plural(thisT, "task")} this week`, muted: true });
  // 30-day trend: second half vs first half, active days only
  const scored = trend30.map((p, i) => [i, p.value]).filter(([, v]) => v != null);
  const a = scored.filter(([i]) => i < 15).map(([, v]) => v), b = scored.filter(([i]) => i >= 15).map(([, v]) => v);
  if (scored.length >= 6 && a.length && b.length) {
    const avg = (l) => l.reduce((x, y) => x + y, 0) / l.length, o = avg(a), n = avg(b), d = n - o;
    out.push({ k: `${d > 3 ? "↑" : d < -3 ? "↓" : "→"} 30-day trend`, v: d > 3 ? "Improving" : d < -3 ? "Declining" : "Stable", s: `avg ${n.toFixed(0)} over the last 15 days · was ${o.toFixed(0)}`,
      flag: d > 3 ? ["good", "up"] : d < -3 ? ["critical", "down"] : null });
  } else out.push({ k: "30-day trend", v: "—", s: `needs 6 active days in the last 30, split across both halves · ${scored.length} so far`, muted: true });
  return out;
}

function identity(span) {
  const t = today(), now = parseDate(t);
  const sources = [
    { label: "Books finished", unit: "books", get: () => (db.mediaConsumed || []).filter((m) => /book/i.test(m.category || "")).map((m) => [m.consumedAt, 1]) },
    { label: "Focus", unit: "hours", get: () => (db.pomodoroSessions || []).filter((s) => s.completed !== false).map((s) => [s.date, (+s.duration || 0) / 60]), hours: true },
    { label: "Habit check-ins", unit: "check-ins", get: () => [...(db.habits || []), ...(db.streaks || [])].flatMap((h) => [...new Set(h.activeDates || [])].map((d) => [d, 1])) },
    { label: "Tasks done", unit: "tasks", get: () => (db.schedule || []).filter((x) => x.done).map((x) => [x.date, 1]) },
    { label: "Diary entries", unit: "entries", get: () => (db.diary || []).map((x) => [x.date, 1]) },
    { label: "Dreams logged", unit: "dreams", get: () => (db.dreams || []).map((x) => [x.date, 1]) },
  ].map((s) => ({ ...s, pts: s.get().map(([d, v]) => [normDate(d), v]).filter(([d]) => d && d <= t) })).filter((s) => s.pts.length);
  let cols, key;
  if (span === "year") {
    const y0 = Math.min(now.getFullYear(), ...sources.flatMap((s) => s.pts.map(([d]) => +d.slice(0, 4))));
    cols = Array.from({ length: now.getFullYear() - y0 + 1 }, (_, i) => { const y = String(y0 + i); return { k: y, label: y, long: y === t.slice(0, 4) ? `${y} so far` : y }; });
    key = (d) => d.slice(0, 4);
  } else {
    cols = Array.from({ length: 24 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 23 + i, 1), k = iso(d).slice(0, 7);
      return { k, label: d.getMonth() === 0 ? `’${String(d.getFullYear()).slice(2)}` : d.toLocaleDateString("en-US", { month: "narrow" }), long: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) }; });
    key = (d) => d.slice(0, 7);
  }
  const at = new Map(cols.map((c, i) => [c.k, i]));
  const rows = sources.map((s) => {
    const values = cols.map(() => 0);
    for (const [d, v] of s.pts) { const i = at.get(key(d)); if (i != null) values[i] += v; }
    return { label: s.label, unit: s.unit, values, fmt: s.hours ? (v) => (v ? (v < 10 ? v.toFixed(1) : String(Math.round(v))) : "0") : (v) => String(v) };
  });
  return { cols, rows };
}

export default {
  id: "analytics", label: "Analytics", color: "var(--slate)",
  count: () => null,
  render(root, app) {
    const ix = buildIndex(), tg = targets(), t = today();
    const [start, end, nDays, nTotal] = range(), st = stats(ix, start, end), sc = score(st, nDays);
    const [ps, pe, pn] = prevRange(), pst = stats(ix, ps, pe), psc = score(pst, pn);
    const [bandKind, bandText] = band(sc.value);
    const perName = { day: "today", week: "this week", month: "this month" }[ui.period];
    const prevName = { day: "yesterday", week: "the same days last week", month: "the same days last month" }[ui.period];
    const prevShort = { day: "yesterday", week: "last week", month: "last month" }[ui.period];

    // headline extras
    const delta = Math.round(sc.value) - Math.round(psc.value);
    const deltaTxt = pst.active ? `${delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} ${Math.abs(delta)} pts vs ${prevName}` : `nothing logged ${prevShort} to compare`;
    const gap = sc.parts.filter((p) => p.on).map((p) => ({ ...p, lost: p.weight - p.pts })).sort((a, b) => b.lost - a.lost)[0];
    const off = sc.parts.filter((p) => !p.on);
    const lastActive = [...ix.tasks.keys(), ...ix.pomo.keys(), ...ix.checks.keys()].filter((d) => d <= t).sort().at(-1);

    // trend
    const trendPts = (n) => daysIn(shift(t, -(n - 1)), t).map((d) => ({ date: d, ...dayScore(ix, d) }));
    const trend = trendPts(ui.win), trend30 = ui.win === 30 ? trend : trendPts(30);
    const activeDays = trend.filter((p) => p.value != null);
    const ins = insights(ix, trend30);

    // focus by category, this period (single series → one colour; ranked)
    const catMin = {}, catN = {};
    for (const s of db.pomodoroSessions || []) {
      const d = normDate(s.date);
      if (s.completed === false || !d || d < start || d > end) continue;
      const c = s.category || "Uncategorised"; catMin[c] = (catMin[c] || 0) + (+s.duration || 0); catN[c] = (catN[c] || 0) + 1;
    }
    const cats = Object.entries(catMin).sort((a, b) => b[1] - a[1]), catTotal = cats.reduce((a, [, m]) => a + m, 0);
    const lastPomo = [...ix.pomo.keys()].filter((d) => d <= t).sort().at(-1);
    const allCat = {}, allN = {};
    for (const s of db.pomodoroSessions || []) if (s.completed !== false) { const c = s.category || "Uncategorised"; allCat[c] = (allCat[c] || 0) + (+s.duration || 0); allN[c] = (allN[c] || 0) + 1; }
    const allList = Object.entries(allCat).sort((a, b) => b[1] - a[1]), allTotal = allList.reduce((a, [, m]) => a + m, 0);
    const catList = (list, n, total) => `<div class="an-cats">${list.map(([c, m]) => `<div class="an-cat" tabindex="0" data-tip="${esc(`${dur(m)} · ${Math.round((m / total) * 100)}%\n${c} · ${plural(n[c], "session")}`)}">
        <span class="an-cn">${esc(c)}</span><span class="an-cv">${dur(m)} <em>${Math.round((m / total) * 100)}%</em></span>${meter(m / list[0][1])}</div>`).join("")}</div>`;

    // busiest weekdays (every scheduled task, all time)
    const wk = Array.from({ length: 7 }, () => ({ n: 0, done: 0 }));
    for (const [d, v] of ix.tasks) { const w = wk[(parseDate(d).getDay() + 6) % 7]; w.n += v.n; w.done += v.done; }
    const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], WDL = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
    const wkTop = Math.max(...wk.map((w) => w.n)), busiest = WD.filter((_, i) => wkTop && wk[i].n === wkTop);

    // burndown
    const projects = db.projects || [];
    const active = projects.filter((p) => ACTIVE.includes(p.status)).sort((a, b) => (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2) || String(a.name).localeCompare(String(b.name)));
    const doneTasks = (db.schedule || []).filter((x) => x.done).length, nTasks = (db.schedule || []).length;
    const doneRem = (db.reminders || []).filter((r) => r.completed).length, nRem = (db.reminders || []).length;

    // 66-day tracker
    const habits = ix.tracked.filter((x) => x.kind === "habit" && x.h.trackStreak).map((x) => {
      const s = currentStreak(x.dates);
      return { x, s, best: longestRun(x.dates), last: x.dates.filter((d) => d <= t).at(-1), set: new Set(x.dates), pct: Math.min(100, Math.round((s / INTERNALIZE) * 100)) };
    }).sort((a, b) => b.pct - a.pct || b.best - a.best);
    const last30 = daysIn(shift(t, -29), t);

    const idn = identity(ui.span);
    const seg = (act, list, cur) => `<div class="seg an-seg" role="group">${list.map(([k, l]) => `<button class="${String(cur) === String(k) ? "on" : ""}" data-act="${act}" data-v="${k}" aria-pressed="${String(cur) === String(k)}">${l}</button>`).join("")}</div>`;
    const rangeTxt = start === end ? fmt(start, { weekday: "long", month: "short", day: "numeric" }) : `${fmt(start, { weekday: "short", month: "short", day: "numeric" })} → ${fmt(end, { weekday: "short", month: "short", day: "numeric" })}`;

    root.innerHTML = `<div class="an">
      <div class="page-h an-head"><h1>Analytics</h1><span class="an-range">${esc(rangeTxt)}${ui.period !== "day" ? ` · day ${nDays} of ${nTotal}` : ""}</span><span class="sp"></span>${seg("period", PERIODS, ui.period)}</div>

      <section class="card an-hero" aria-label="Productivity score">
        <div class="an-score-blk">
          <p class="an-k">productivity score · ${esc(perName)}</p>
          <div class="an-score"><b data-score="${sc.value.toFixed(1)}">${Math.round(sc.value)}</b><span>/100</span></div>
          <div class="an-verdict">${flag(bandKind, bandText)}<span class="an-delta${pst.active ? (delta > 0 ? " up" : delta < 0 ? " down" : "") : " muted"}">${esc(deltaTxt)}</span></div>
          <p class="an-gap">${gap && gap.lost > 0.5 ? `Biggest gap: <b>${esc(gap.label.toLowerCase())}</b> — ${esc(gap.big)} ${esc(gap.unit.split(" · ")[0])}, ${num(gap.lost)} pts left on the table.` : `Every measured part is at its target.`}</p>
        </div>
        <div class="an-comp">
          <p class="an-k">what the score is made of <span>· target band ≥ 70</span></p>
          <div class="an-stack">${sc.parts.filter((p) => p.on).map((p) => `<div class="an-part" style="flex:${p.weight}" data-tip="${esc(`${num(p.pts)} of ${num(p.weight)} pts\n${p.label} · ${p.big} ${p.unit}`)}" tabindex="0">
              <span class="an-bar"><i style="width:${(p.ratio * 100).toFixed(1)}%"></i></span>
              <span class="an-pl">${esc(p.label)} <em>${Math.round(p.weight)}%</em></span>
              <b>${esc(p.big)}</b><small>${esc(p.unit)}</small><small class="an-pts">${num(p.pts)} / ${num(p.weight)} pts</small></div>`).join("")}</div>
          ${off.length ? `<p class="an-note">${off.map((p) => `${esc(p.label)}: ${esc(p.off)}`).join(" · ")} — weights rescaled from 20 / 40 / 40.</p>` : `<p class="an-note">each bar fills toward its target · ≥ 70 on track · 40–69 partial · below 40 low</p>`}
        </div>
        <div class="an-readout">
          <dl>
            <div><dt>tasks</dt><dd>${st.tasksDone}/${st.tasksPlanned}</dd></div>
            <div><dt>focus</dt><dd>${dur(st.pomoMinutes)}</dd></div>
            <div><dt>sessions</dt><dd>${st.pomoCount}</dd></div>
            <div><dt>habits</dt><dd>${st.habitsActive}/${sc.H}</dd></div>
            <div><dt>streaks</dt><dd>${st.streaksActive}/${sc.S}</dd></div>
            <div><dt>check-ins</dt><dd>${st.habitChecks + st.streakChecks}</dd></div>
          </dl>
          <form class="an-targets" id="an-targets" onsubmit="return false">
            <span class="an-k">targets</span>
            <label>focus <input class="in" type="number" min="0.5" step="0.5" name="pomoDaily" value="${num(tg.daily)}" aria-label="Pomodoros per day" /> <em>pomodoros / day</em></label>
            <label title="0 = all ${(db.habits || []).length} registered">habits <input class="in" type="number" min="0" step="1" name="habitTarget" value="${+tg.habitTarget || 0}" aria-label="Habits per day, 0 means all" /> <em>/ day</em></label>
            <label title="0 = all ${(db.streaks || []).length} registered">streaks <input class="in" type="number" min="0" step="1" name="streakTarget" value="${+tg.streakTarget || 0}" aria-label="Streaks per day, 0 means all" /> <em>/ day</em></label>
            <span class="an-hint">0 = all (${plural((db.habits || []).length, "habit")} · ${plural((db.streaks || []).length, "streak")})</span>
          </form>
        </div>
      </section>

      <div class="an-grid">
        <section class="card an-c8"><header class="card-h"><div><h3>Daily score · last ${ui.win} days</h3>
            <p class="sub">${activeDays.length ? `${activeDays.length} active ${activeDays.length === 1 ? "day" : "days"} of ${ui.win} · gaps (ticks on the baseline) are days with nothing logged` : `nothing logged in the last ${ui.win} days${lastActive ? ` · last activity ${esc(fmt(lastActive, { month: "short", day: "numeric", year: "numeric" }))} (${ago(lastActive)})` : ""}`}</p></div>
          <div class="card-r">${seg("win", [[30, "30d"], [90, "90d"]], ui.win)}<button class="an-tbtn${ui.table ? " on" : ""}" data-act="table" aria-pressed="${ui.table}">table</button></div></header>
          <div class="card-b">${ui.table
            ? (activeDays.length ? `<div class="an-tablewrap"><table class="an-table"><thead><tr><th>day</th><th>score</th><th>tasks</th><th>pomodoros</th><th>check-ins</th></tr></thead><tbody>${activeDays.slice().reverse().map((p) => `<tr><td>${esc(fmt(p.date, { weekday: "short", month: "short", day: "numeric" }))}</td><td><b>${Math.round(p.value)}</b></td><td>${p.st.tasksPlanned ? `${p.st.tasksDone}/${p.st.tasksPlanned}` : "—"}</td><td>${p.st.pomoCount}</td><td>${p.st.habitChecks + p.st.streakChecks}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No active days in this window.</div>`)
            : `<div class="an-trendwrap">${trendSvg(trend)}${activeDays.length ? "" : `<div class="an-over"><b>No activity in this window.</b>${ui.win === 30 ? `<button class="an-tbtn" data-act="win" data-v="90">widen to 90 days</button>` : ""}</div>`}</div>`}</div></section>

        <section class="card an-c4 an-ins"><header class="card-h"><div><h3>Insights</h3><p class="sub">what the numbers are saying</p></div></header>
          <div class="card-b">${ins.map((i) => `<div class="an-insight${i.muted ? " muted" : ""}"><span class="an-k">${esc(i.k)}</span><b>${esc(i.v)}</b>${i.flag ? flag(i.flag[0], i.flag[1]) : ""}<small>${esc(i.s)}</small></div>`).join("")}</div></section>

        <section class="card an-c4"><header class="card-h"><div><h3>Focus by category</h3><p class="sub">${catTotal ? `${dur(catTotal)} in ${plural(st.pomoCount, "session")} ${esc(perName)}` : `focus minutes ${esc(perName)}`}</p></div></header>
          <div class="card-b">${cats.length ? catList(cats, catN, catTotal)
            : `<div class="an-empty"><b>No focus sessions ${esc(perName)}.</b><span>${lastPomo ? `Last session ${esc(fmt(lastPomo, { month: "short", day: "numeric" }))} — ${ago(lastPomo)}.` : "Start one in Pomodoro."}</span></div>
              ${allList.length ? `<p class="an-k an-subk">all time instead · ${dur(allTotal)}</p>${catList(allList, allN, allTotal)}` : ""}`}</div></section>

        <section class="card an-c4"><header class="card-h"><div><h3>Busiest weekdays</h3><p class="sub">${nTasks ? `all ${plural(nTasks, "scheduled task")}, all time${busiest.length ? ` · peak ${busiest.join(" & ")}` : ""}` : "scheduled tasks by weekday"}</p></div></header>
          <div class="card-b">${nTasks ? barsSvg(wk.map((w, i) => ({ label: WD[i], value: w.n, tip: `${plural(w.n, "task")}\n${WDL[i]} · ${w.done} done` })), { H: 236 }) : `<div class="an-empty"><b>Nothing scheduled yet.</b></div>`}</div></section>

        <section class="card an-c4"><header class="card-h"><div><h3>Burndown</h3><p class="sub">${active.length} active · ${projects.filter((p) => p.status === "Completed").length} completed · ${projects.filter((p) => p.status === "Cancelled").length} cancelled</p></div></header>
          <div class="card-b an-burn">${active.map((p) => { const pr = progressOf(p); return `<button class="an-proj" data-act="proj" data-id="${esc(p.id)}" data-tip="${esc(`${pr}% done\n${p.name} · ${p.status} · ${p.priority || "no"} priority`)}">
              <span class="an-pn">${esc(p.name)}</span><span class="an-pm"><i style="background:${STATUS_COLOR[p.status]}"></i>${esc(p.status)} · ${esc(p.priority || "—")}</span>${meter(pr / 100, STATUS_COLOR[p.status])}<b>${pr}%</b></button>`; }).join("") || `<div class="an-empty"><b>No active projects.</b></div>`}
            <div class="an-burn-all">
              ${nTasks ? `<div class="an-proj static" data-tip="${esc(`${Math.round((doneTasks / nTasks) * 100)}% done\n${doneTasks} of ${nTasks} tasks`)}"><span class="an-pn">All tasks</span><span class="an-pm">${nTasks - doneTasks} left of ${nTasks}</span>${meter(doneTasks / nTasks)}<b>${Math.round((doneTasks / nTasks) * 100)}%</b></div>` : ""}
              ${nRem ? `<div class="an-proj static" data-tip="${esc(`${Math.round((doneRem / nRem) * 100)}% done\n${doneRem} of ${nRem} reminders`)}"><span class="an-pn">Reminders</span><span class="an-pm">${nRem - doneRem} open of ${nRem}</span>${meter(doneRem / nRem)}<b>${Math.round((doneRem / nRem) * 100)}%</b></div>` : ""}
            </div></div></section>
      </div>

      <section class="card an-habits"><header class="card-h"><div><h3>Habit internalization</h3><p class="sub">${INTERNALIZE} days in a row and a habit runs on autopilot · habits with the 66-day tracker on · cells = last 30 days</p></div></header>
        <div class="card-b">${habits.length ? `<div class="an-hrows">${habits.map(({ x, s, best, last, set, pct }) => `<div class="an-hrow" data-row="${esc(x.h.id)}">
            <button class="an-hn" data-act="habit" data-id="${esc(x.h.id)}"><b>${esc(x.h.name)}</b><small>${last ? `best run ${plural(best, "day")} · last ${esc(ago(last))}` : "never logged"}</small></button>
            <span class="an-streak"><b>${s}</b><small>day streak</small></span>
            <span class="an-days" aria-label="${set.size ? `${last30.filter((d) => set.has(d)).length} of the last 30 days logged` : "not logged in the last 30 days"}">${last30.map((d) => `<i class="${set.has(d) ? "on" : ""}" data-tip="${set.has(d) ? "logged" : "not logged"}\n${esc(fmt(d, { weekday: "short", month: "short", day: "numeric" }))}"></i>`).join("")}</span>
            <span class="an-prog">${meter(pct / 100, pct >= 100 ? STATUS.good : "var(--accent)")}<small>${pct >= 100 ? "autopilot" : `${s}/${INTERNALIZE} · ${INTERNALIZE - s} to go`}</small></span>
            <b class="an-pct">${pct}%</b></div>`).join("")}</div>`
          : `<div class="an-empty"><b>No habits on the 66-day tracker.</b><span>Turn on “66-day tracker” for a habit in Hobbies to follow it here.</span></div>`}</div></section>

      ${idn.rows.length ? `<section class="card an-id"><header class="card-h"><div><h3>Identity over time</h3><p class="sub">what you did, ${ui.span === "year" ? "year by year" : "month by month"} · brightness is scaled within each row · hover a cell for the count</p></div>
          <div class="card-r">${seg("span", [["year", "years"], ["month", "24 months"]], ui.span)}</div></header>
        <div class="card-b"><div class="an-heatwrap">${heatTable(idn.cols, idn.rows)}</div></div></section>` : ""}
      <div class="an-tip" role="tooltip" hidden></div>
    </div>`;

    wire(root, app);
    if ((app.entering || ui.anim) && motionEnabled()) intro(root, sc.value);
    ui.anim = false;
  },
};

// ── interaction ──
function wire(root, app) {
  const tipEl = root.querySelector(".an-tip");
  const place = (x, y) => {
    const r = tipEl.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    tipEl.style.left = `${Math.min(vw - r.width - 8, Math.max(8, x + 14))}px`;
    tipEl.style.top = `${y + 18 + r.height > vh ? y - r.height - 12 : y + 18}px`;
  };
  const show = (text, x, y) => { tipEl.textContent = text; tipEl.hidden = false; place(x, y); };
  const hide = () => { tipEl.hidden = true; root.querySelectorAll(".an-trend.hover").forEach((s) => s.classList.remove("hover")); };
  const cross = (svg, i) => {
    const hit = svg.querySelector(`.hit[data-i="${i}"]`); if (!hit) return null;
    const cx = hit.dataset.cx, xh = svg.querySelector(".xh"), xd = svg.querySelector(".xd");
    xh.setAttribute("x1", cx); xh.setAttribute("x2", cx);
    if (hit.dataset.cy) { xd.setAttribute("cx", cx); xd.setAttribute("cy", hit.dataset.cy); xd.style.display = ""; } else xd.style.display = "none";
    svg.classList.add("hover"); svg.dataset.cur = i;
    return hit;
  };
  root.onpointermove = (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el || !root.contains(el)) return hide();
    if (el.classList.contains("hit") && el.dataset.i != null) cross(el.ownerSVGElement, el.dataset.i);
    show(el.dataset.tip, e.clientX, e.clientY);
  };
  root.onpointerleave = hide;
  root.onfocusin = (e) => {
    const el = e.target;
    if (el.classList?.contains("an-trend")) { const n = +el.dataset.n; const hit = cross(el, el.dataset.cur ?? n - 1); if (hit) { const r = hit.getBoundingClientRect(); show(hit.dataset.tip, r.left + r.width / 2, r.top + 20); } return; }
    if (el.dataset?.tip) { const r = el.getBoundingClientRect(); show(el.dataset.tip, r.left + Math.min(r.width / 2, 120), r.bottom - 8); }
  };
  root.onfocusout = hide;
  root.onkeydown = (e) => {
    const svg = e.target.classList?.contains("an-trend") ? e.target : null;
    if (!svg || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = +svg.dataset.n, cur = +(svg.dataset.cur ?? n - 1);
    const i = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowLeft" ? -1 : 1)));
    const hit = cross(svg, i); if (hit) { const r = hit.getBoundingClientRect(); show(hit.dataset.tip, r.left + r.width / 2, r.top + 20); }
  };
  root.onclick = (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "period") { ui.period = b.dataset.v; ui.anim = true; app.refresh(); }
    else if (a === "win") { ui.win = +b.dataset.v; app.refresh(); }
    else if (a === "table") { ui.table = !ui.table; app.refresh(); }
    else if (a === "span") { ui.span = b.dataset.v; app.refresh(); }
    else if (a === "proj") app.go("projects", b.dataset.id);
    else if (a === "habit") app.go("hobbies", b.dataset.id);
  };
  root.querySelectorAll("#an-targets input").forEach((el) => (el.onchange = () => {
    const t = { ...(db.productivityTargets || {}) };
    if (el.name === "pomoDaily") {
      const v = Math.max(0.5, Math.round((+el.value || 0) * 2) / 2);
      t.pomoDaily = v; t.pomoTarget = Math.max(1, Math.round(v * 7));   // keep the old key meaningful: a week's worth
    } else t[el.name] = Math.max(0, Math.floor(+el.value || 0));
    db.productivityTargets = t; commit(); app.refresh();
  }));
}

// ── motion: snappy, overshoot then settle; off when Motion is off ──
function intro(root, value) {
  const go = (sel, opts) => { const els = root.querySelectorAll(sel); if (els.length) animate(els, opts); };
  const b = root.querySelector(".an-score b");
  if (b) { const o = { v: 0 }; animate(o, { v: value, duration: 900, ease: "outExpo", onUpdate: () => (b.textContent = Math.round(o.v)) }); }
  go(".an-bar i, .an-meter i", { scaleX: [0, 1], duration: 620, delay: stagger(22, { start: 120 }), ease: "outBack(1.8)" });
  go(".an-bars .b", { scaleY: [0, 1], duration: 560, delay: stagger(40, { start: 200 }), ease: "outBack(2)" });
  const ln = root.querySelector(".an-trend .ln");
  if (ln) animate(ln, { strokeDashoffset: [1, 0], duration: 900, delay: 150, ease: "outQuart" });
  go(".an-trend .dot", { scale: [0, 1], duration: 380, delay: stagger(14, { start: 300 }), ease: "outBack(2.4)" });
}
