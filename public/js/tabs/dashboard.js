// Dashboard — every panel and number from dashboard_tab.py, rebuilt as a living page:
// greeting + live clock, an orbit of today's progress, glowing stat tiles with 14-day sparklines,
// habit rings you tap to log (with a burst of light), project arcs, and motion on arrival.
import { db, commit, today, iso, currentStreak, parseDate, daysFromToday, formatDuration, monthly, logMediaConsumed } from "../store.js";
import { esc, fmtDate, relDay, money, chip, empty, plural, PRIORITY } from "../ui.js";
import { countUp, drawRings, drawLines, pop } from "../motion.js";
import { pulse } from "../background.js";
import { onThisDay, KIND } from "../timeline.js";

const INTERNALIZE_DAYS = 66, FOCUS_GOAL = 120; // minutes of focus that fill today's ring
const ui = { focus: "week", month: null, flash: null };
const PRANK = { High: 0, Medium: 1, Low: 2 };
const STATUS_COLOR = { Planning: "var(--cyan)", "In Progress": "var(--purple)", "On Hold": "var(--orange)", Completed: "var(--green)", Cancelled: "var(--slate)" };
const HABIT_COLORS = ["var(--green)", "var(--cyan)", "var(--purple)", "var(--pink)", "var(--amber)", "var(--orange)"];
const FMT = { int: (v) => Math.round(v).toLocaleString(), dur: (v) => formatDuration(Math.round(v)) || "0m", money: (v) => money(v) };

// last N days as ISO strings, oldest first
const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = parseDate(today()); d.setDate(d.getDate() - (n - 1 - i)); return iso(d); });

// a ring segment on a circle: pathLength 100 so dashoffset = 100 - percent
const ring = (cx, cy, r, pct, cls, extra = "") =>
  `<circle class="trk" cx="${cx}" cy="${cy}" r="${r}" ${extra}/><circle class="arc ${cls}" cx="${cx}" cy="${cy}" r="${r}" pathLength="100" stroke-dasharray="100" data-ring="${pct}" style="stroke-dashoffset:${100 - pct}" transform="rotate(-90 ${cx} ${cy})" ${extra}/>`;

export function spark(values, kind = "line") {
  const max = Math.max(1, ...values), n = values.length;
  if (kind === "bars") {
    const w = 100 / n;
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">${values.map((v, i) => `<rect data-grow x="${i * w + w * 0.18}" y="${30 - (v / max) * 28}" width="${w * 0.64}" height="${(v / max) * 28 || 0.6}" rx="0.8" style="transform-origin:50% 100%;transform-box:fill-box"/>`).join("")}</svg>`;
  }
  const pts = values.map((v, i) => [(i / (n - 1)) * 100, 28 - (v / max) * 25]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path class="ar" d="${d}L100,30L0,30Z"/><path class="ln" d="${d}" pathLength="1" stroke-dasharray="1" data-draw style="stroke-dashoffset:0" vector-effect="non-scaling-stroke"/></svg>`;
}

// On this day: what you wrote, dreamt, watched, spent… around today's date in past years
function onThisDayCard(t) {
  const years = onThisDay(t);
  const snip = (text, title) => (text || "").replace(/[#*>]/g, "").replace(/\s+/g, " ").trim().replace(title, "").trim().slice(0, 150);
  const off = (n) => (n ? `<span class="m">${Math.abs(n)} day${Math.abs(n) > 1 ? "s" : ""} ${n > 0 ? "later" : "earlier"}</span>` : "");
  return `<section class="card otd" style="grid-column:1/-1"><header class="panel-h"><h3>On this day</h3>
      <p class="sub">${years.length ? `around ${fmtDate(t)}, in other years` : "nothing from other years around today yet"}</p><div class="r"><button class="btn ghost sm" data-go="review">Weekly review</button></div></header>
    <div class="panel-b otd-years">${years.map((g) => `<div class="otd-year"><div class="yr"><b>${g.ago === 1 ? "a year ago" : `${g.ago} years ago`}</b><span>${g.year}</span></div>
      ${g.items.map((e) => `<button class="otd-item" data-go="${e.tab}"${e.id ? ` data-focus="${esc(e.id)}"` : ""} style="--c:${KIND[e.kind].color}">
        <span class="k">${KIND[e.kind].label}</span><span class="t">${esc(e.title)}${e.text ? `<small>${esc(snip(e.text, e.title))}</small>` : ""}</span>${off(e.off)}</button>`).join("")}</div>`).join("")
      || empty("As you keep writing, dreaming and logging, this fills with your past selves.")}</div></section>`;
}

// keep the clock ticking while the Dashboard is open
setInterval(() => {
  const c = document.getElementById("dashClock");
  if (c) c.textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase();
}, 1000);

export default {
  id: "dashboard", label: "Dashboard", color: "var(--purple)",
  render(root, app) {
    const t = today(), now = new Date(), ym = t.slice(0, 7), days14 = lastDays(14);
    ui.month ||= ym;

    /* ---------- numbers (same as the Python dashboard) ---------- */
    const todays = db.schedule.filter((x) => x.date === t).sort((a, b) => (a.done - b.done) || (a.startTime || "").localeCompare(b.startTime || ""));
    const doneToday = todays.filter((x) => x.done).length;
    const overdue = db.schedule.filter((x) => !x.done && x.date && x.date < t).length;
    const focusToday = db.pomodoroSessions.filter((s) => s.date === t).reduce((a, s) => a + (+s.duration || 0), 0);
    const allHabits = [...db.habits, ...db.streaks];
    const habitsToday = allHabits.filter((h) => (h.activeDates || []).includes(t)).length;
    const pendingRem = db.reminders.filter((r) => !r.completed).sort((a, b) => PRANK[a.priority] - PRANK[b.priority]);
    const highRem = pendingRem.filter((r) => r.priority === "High").length;
    const available = db.assets.reduce((a, x) => a + (+x.amount || 0), 0);
    const spent = db.oneTimeExpenses.filter((e) => (e.date || "").startsWith(ym)).reduce((a, e) => a + (+e.amount || 0), 0);
    const earned = db.income.filter((e) => String(e.date || "").startsWith(ym)).reduce((a, e) => a + (+e.amount || 0), 0);
    const recurring = db.recurringIncome.reduce((a, r) => a + monthly(r.amount, r.frequency), 0) - db.recurringExpenses.reduce((a, r) => a + monthly(r.price, r.frequency), 0);
    const debt = db.debts.filter((d) => (+d.amount || 0) > 0.005).reduce((a, d) => a + (+d.amount || 0), 0);
    const wish = db.purchases.filter((p) => !p.purchased).reduce((a, p) => a + (+p.price || 0), 0);

    // 14-day sparklines
    const focusSeries = days14.map((d) => db.pomodoroSessions.filter((s) => s.date === d).reduce((a, s) => a + (+s.duration || 0), 0));
    const taskSeries = days14.map((d) => db.schedule.filter((x) => x.date === d && x.done).length);
    const habitSeries = days14.map((d) => allHabits.filter((h) => (h.activeDates || []).includes(d)).length);
    const spendSeries = days14.map((d) => db.oneTimeExpenses.filter((e) => e.date === d).reduce((a, e) => a + (+e.amount || 0), 0));

    // orbit: today's three rings and an overall day score
    const habitPct = allHabits.length ? Math.round((habitsToday / allHabits.length) * 100) : 0;
    const taskPct = todays.length ? Math.round((doneToday / todays.length) * 100) : 0;
    const focusPct = Math.min(100, Math.round((focusToday / FOCUS_GOAL) * 100));
    const dayScore = Math.round((habitPct + focusPct + (todays.length ? taskPct : habitPct)) / 3);

    // focus panel
    const weekStart = (() => { const d = parseDate(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
    const inFocus = (s) => ui.focus === "all" || (ui.focus === "month" ? s.date?.startsWith(ym) : parseDate(s.date) >= weekStart);
    const byCat = {};
    db.pomodoroSessions.filter(inFocus).forEach((s) => (byCat[s.category] = (byCat[s.category] || 0) + (+s.duration || 0)));
    const focusTotal = Object.values(byCat).reduce((a, b) => a + b, 0);
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const focusTarget = ui.focus === "week" ? FOCUS_GOAL * 7 : ui.focus === "month" ? FOCUS_GOAL * 30 : Math.max(focusTotal, 1);

    // media + projects + papers
    const consumed = db.mediaConsumed.filter((c) => (c.consumedAt || "").startsWith(ui.month)).sort((a, b) => b.consumedAt.localeCompare(a.consumedAt));
    const monthName = new Date(ui.month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const active = db.projects.filter((p) => ["Planning", "In Progress", "On Hold"].includes(p.status));
    const next = active.filter((p) => parseDate(p.targetDate)).sort((a, b) => parseDate(a.targetDate) - parseDate(b.targetDate))[0];
    const topProjects = [...active].sort((a, b) => PRANK[a.priority] - PRANK[b.priority] || (parseDate(a.targetDate) || 9e15) - (parseDate(b.targetDate) || 9e15)).slice(0, 5);
    const progressOf = (p) => { const ms = p.milestones || []; return ms.length ? Math.round((ms.filter((m) => m.completed).length / ms.length) * 100) : +p.progressPct || 0; };

    /* ---------- hero orbit (rings with leader-line labels) ---------- */
    const cx = 130, cy = 130;
    const rings = [["habits", 112, habitPct, "var(--green)", `${habitsToday}/${allHabits.length}`],
      ["tasks", 90, taskPct, "var(--cyan)", todays.length ? `${doneToday}/${todays.length}` : "none today"],
      ["focus", 68, focusPct, "var(--purple)", `${formatDuration(focusToday) || "0m"} / 2h`]];
    const labelY = [56, 130, 204];
    const orbit = `<svg class="orbit" viewBox="0 0 440 260">
      ${rings.map(([, r, pct, c], i) => `<g style="color:${c}">${ring(cx, cy, r, pct, "", `stroke-width="${i === 0 ? 10 : 9}"`)}</g>`).join("")}
      ${rings.map(([name, r, pct, c, v], i) => {
        const a = ((pct * 3.6 - 90) * Math.PI) / 180, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), ly = labelY[i];
        return `<g style="color:${c}"><circle class="dotp" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"/><polyline class="lead" points="${x.toFixed(1)},${y.toFixed(1)} 272,${ly} 290,${ly}"/>
          <circle cx="290" cy="${ly}" r="2.5" fill="none" stroke="currentColor"/><text x="300" y="${ly - 6}">${name}</text><text class="lv" x="300" y="${ly + 13}">${v}</text></g>`;
      }).join("")}
      <text class="core" x="${cx}" y="${cy + 10}"><tspan data-count="${dayScore}">${dayScore}</tspan>%</text><text class="core-s" x="${cx}" y="${cy + 30}">TODAY</text>
    </svg>`;

    const hour = now.getHours();
    const greet = hour < 5 ? "Still up?" : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
    const summary = `You've logged <b>${habitsToday} of ${allHabits.length}</b> habits and focused <b>${formatDuration(focusToday) || "0 minutes"}</b> today. `
      + (todays.length ? `<b>${doneToday}/${todays.length}</b> of today's tasks are done. ` : "Nothing is scheduled for today. ")
      + (pendingRem.length ? `<b>${pendingRem.length}</b> reminders are waiting${highRem ? `, ${highRem} marked high` : ""}.` : "No reminders waiting.");

    const tile = (c, lbl, valHtml, sub, extra) => `<div class="tile" style="--c:${c}"><span class="lbl">${lbl}</span><span class="val">${valHtml}</span><span class="sub">${sub}</span>${extra}</div>`;
    const prioBar = (() => { const n = pendingRem.length || 1;
      let x = 0; const parts = ["High", "Medium", "Low"].map((p) => { const k = pendingRem.filter((r) => r.priority === p).length; const w = (k / n) * 100; const s = k ? `<rect x="${x}" y="10" height="10" width="${Math.max(0, w - 1)}" rx="2" style="fill:${PRIORITY[p]}"/>` : ""; x += w; return s; });
      return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">${parts.join("")}</svg>`; })();

    /* ---------- habits as rings ---------- */
    const habitTile = (h, i, isStreak) => {
      const s = currentStreak(h.activeDates), on = (h.activeDates || []).includes(t);
      const set = new Set(h.activeDates || []);
      const pct = h.trackStreak || isStreak ? Math.min(100, Math.round((s / INTERNALIZE_DAYS) * 100)) : Math.round((days14.filter((d) => set.has(d)).length / 14) * 100);
      const c = isStreak ? "var(--orange)" : HABIT_COLORS[i % HABIT_COLORS.length];
      return `<button class="habit${on ? " on" : ""}" data-act="${isStreak ? "streak" : "habit"}" data-id="${h.id}" style="--c:${c}" title="${on ? "Logged today — tap to undo" : "Tap to log today"}">
        <svg viewBox="0 0 64 64">${ring(32, 32, 26, pct, "")}<text class="num" x="32" y="35">${s}</text><text class="unit" x="32" y="46">DAYS</text></svg>
        <span class="nm">${esc(h.name)}</span><span class="state">${on ? "✓ logged" : h.trackStreak || isStreak ? `${pct}% to autopilot` : "tap to log"}</span></button>`;
    };

    root.innerHTML = `<div class="dash">
      <section class="card dash-hero">
        <div>
          <p class="eyebrow">${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          <h1 class="greet">${greet}</h1>
          <p class="clock">it's <b id="dashClock">${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase()}</b></p>
          <p class="summary">${summary}</p>
          <div class="quick"><button class="btn" data-go="pomodoro">▶ Start focus</button><button class="btn ghost" data-go="reminders">+ Reminder</button><button class="btn ghost" data-go="finance">$ Log spending</button>${overdue ? `<button class="btn ghost" data-go="schedule">${overdue} overdue</button>` : ""}</div>
        </div>
        ${orbit}
      </section>

      <div class="tiles">
        ${tile("var(--purple)", "Focus today", `<span data-count="${focusToday}" data-fmt="dur">${formatDuration(focusToday) || "0m"}</span>`, `${formatDuration(focusSeries.reduce((a, b) => a + b, 0)) || "0m"} in 14 days`, spark(focusSeries))}
        ${tile("var(--cyan)", "Tasks today", todays.length ? `<span data-count="${doneToday}">${doneToday}</span><small>/${todays.length}</small>` : "—", overdue ? `${overdue} overdue` : "nothing overdue", spark(taskSeries, "bars"))}
        ${tile("var(--green)", "Habits today", `<span data-count="${habitsToday}">${habitsToday}</span><small>/${allHabits.length}</small>`, `${habitSeries.reduce((a, b) => a + b, 0)} check-ins in 14 days`, spark(habitSeries))}
        ${tile("var(--orange)", "Reminders", `<span data-count="${pendingRem.length}">${pendingRem.length}</span>`, `${highRem} high priority`, prioBar)}
        ${tile("var(--green)", "Available", `<span data-count="${available}" data-fmt="money">${money(available)}</span>`, `${money(spent)} spent this month`, spark(spendSeries, "bars"))}
      </div>

      ${onThisDayCard(t)}

      <section class="card s7"><header class="panel-h"><h3>Habits &amp; streaks</h3><p class="sub">${habitsToday} logged today · tap a ring to log</p></header>
        <div class="panel-b"><div class="habits">${db.habits.map((h, i) => habitTile(h, i, false)).join("")}${[...db.streaks].sort((a, b) => currentStreak(b.activeDates) - currentStreak(a.activeDates)).map((s, i) => habitTile(s, i, true)).join("")}</div>
        ${allHabits.length ? "" : empty("No habits yet — add some in Hobbies.")}</div></section>

      <section class="card s5"><header class="panel-h"><h3>Today's tasks</h3><p class="sub">${todays.length ? `${doneToday} of ${todays.length} done` : "nothing scheduled"}</p><div class="r"><button class="btn ghost sm" data-go="schedule">Schedule</button></div></header>
        <div class="panel-b">${todays.slice(0, 8).map((x) => `<div class="row${x.done ? " done" : ""}"><button class="check${x.done ? " on" : ""}" data-act="task" data-id="${x.id}">✓</button><span class="t">${esc(x.title)}</span><span class="m">${[x.startTime, formatDuration(x.timeEstimate)].filter(Boolean).join(" · ")}</span></div>`).join("")
          || empty("Nothing scheduled — enjoy the slack.")}${todays.length > 8 ? `<div class="empty">…and ${todays.length - 8} more</div>` : ""}
          ${overdue ? `<p class="sub" style="margin:10px 10px 0;color:var(--red)">${overdue} unfinished tasks from earlier days — <a href="#" data-go="schedule">review them</a></p>` : ""}</div></section>

      <section class="card s4"><header class="panel-h"><h3>Focus time</h3><div class="r">${["week", "month", "all"].map((p) => chip(p === "all" ? "All" : p[0].toUpperCase() + p.slice(1), ui.focus === p, `data-act="focus" data-p="${p}"`)).join("")}</div></header>
        <div class="panel-b"><div class="bigring"><svg viewBox="0 0 150 150"><g style="color:var(--purple)">${ring(75, 75, 62, Math.min(100, Math.round((focusTotal / focusTarget) * 100)), "")}</g>
            <text class="c1" x="75" y="78"><tspan data-count="${focusTotal}" data-fmt="dur">${formatDuration(focusTotal) || "0m"}</tspan></text><text class="c2" x="75" y="96">${ui.focus === "all" ? "ALL TIME" : `THIS ${ui.focus.toUpperCase()}`}</text></svg>
          <div>${topCat.map(([c, m]) => `<div class="hbar" style="grid-template-columns:minmax(0,1fr) 60px 46px;--c:var(--purple)"><span>${esc(c)}</span><span class="tr"><span class="fi" style="display:block;width:${(m / topCat[0][1]) * 100}%"></span></span><span class="p num">${formatDuration(m)}</span></div>`).join("") || `<p class="sub" style="color:var(--faint)">No sessions in this period.</p>`}</div></div></div></section>

      <section class="card s4"><header class="panel-h"><h3>Reminders</h3><p class="sub">${pendingRem.length} pending</p><div class="r"><button class="btn ghost sm" data-go="reminders">Open</button></div></header>
        <div class="panel-b">${pendingRem.slice(0, 5).map((r) => `<div class="row"><span class="bar-l" style="--c:${PRIORITY[r.priority]}"></span><button class="check" data-act="rem" data-id="${r.id}">✓</button><span class="t">${esc(r.title)}</span><span class="badge" style="--c:${PRIORITY[r.priority]}">${r.priority}</span></div>`).join("") || empty("All clear.")}
          ${pendingRem.length > 5 ? `<div class="empty" style="padding:8px 10px 0">…and ${pendingRem.length - 5} more</div>` : ""}</div></section>

      <section class="card s4"><header class="panel-h"><h3>Finance</h3><div class="r"><button class="btn ghost sm" data-go="finance">Open</button></div></header>
        <div class="panel-b"><div class="money" data-count="${available}" data-fmt="money">${money(available)}</div><p class="sub" style="margin:4px 0 10px;color:var(--muted)">total available</p>
          ${[["Spent this month", money(spent), "var(--orange)"], ["Income this month", money(earned), "var(--green)"], ["Recurring net / month", money(recurring), recurring < 0 ? "var(--red)" : "var(--green)"],
            ...(debt > 0 ? [["Debt owed", money(debt), "var(--red)"]] : []), ...(wish > 0 ? [["Wishlist total", money(wish), "var(--cyan)"]] : [])]
            .map(([l, v, c]) => `<div class="kv"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join("")}
          <div style="--c:var(--orange);margin-top:8px"><span class="sub" style="color:var(--faint)">spending, last 14 days</span>${spark(spendSeries, "bars")}</div></div></section>

      <section class="card s7"><header class="panel-h"><h3>Projects</h3><p class="sub">${active.length} active · ${active.filter((p) => p.priority === "High").length} high priority${next ? ` · next deadline ${relDay(next.targetDate)}` : ""}</p><div class="r"><button class="btn ghost sm" data-go="projects">Open</button></div></header>
        <div class="panel-b">${topProjects.map((p) => { const pct = progressOf(p), late = parseDate(p.targetDate) && daysFromToday(p.targetDate) < 0;
          return `<div class="proj-row" style="--c:${STATUS_COLOR[p.status]}"><svg viewBox="0 0 44 44">${ring(22, 22, 17, pct, "")}<text class="pc" x="22" y="26">${pct}</text></svg>
            <div style="min-width:0"><b>${esc(p.name)}</b><small>${esc(p.category || "")}${p.targetDate ? ` · <span style="${late ? "color:var(--red)" : ""}">${relDay(p.targetDate)}</span>` : ""}</small></div>
            <div style="display:flex;gap:6px"><span class="badge" style="--c:${PRIORITY[p.priority]}">${p.priority}</span><span class="badge" style="--c:${STATUS_COLOR[p.status]}">${p.status}</span></div></div>`; }).join("") || empty("No active projects.")}</div></section>

      <section class="card s5"><header class="panel-h"><h3>Media consumed</h3><div class="r"><button class="icon-btn" data-act="month" data-d="-1">‹</button><span class="tag" style="min-width:64px;text-align:center">${monthName.split(" ")[0].slice(0, 3)} ${ui.month.slice(0, 4)}</span><button class="icon-btn" data-act="month" data-d="1">›</button>${ui.month !== ym ? `<button class="icon-btn" data-act="month" data-d="0">Now</button>` : ""}</div></header>
        <div class="panel-b"><div class="money" style="color:var(--pink);text-shadow:0 0 26px color-mix(in srgb, var(--pink) 40%, transparent)"><span data-count="${consumed.length}">${consumed.length}</span></div><p class="sub" style="margin:4px 0 10px;color:var(--muted)">finished in ${monthName} · ${db.mediaConsumed.length} all time</p>
          ${consumed.slice(0, 6).map((c) => `<div class="row"><span class="t">${esc(c.title)}</span><span class="badge" style="--c:var(--pink)">${esc(c.category)}</span><span class="m">${fmtDate(c.consumedAt)}</span></div>`).join("") || empty("Nothing finished this month yet.")}</div></section>

      <section class="card"><header class="panel-h"><h3>Papers read</h3><p class="sub">${db.papersRead.length} read in total · ${db.papersRead.filter((p) => (p.readAt || "").startsWith(ui.month)).length} in ${monthName.split(" ")[0]} · ${db.papers.length} still in the pile</p><div class="r"><button class="btn ghost sm" data-go="blogs">Reading list</button></div></header>
        <div class="panel-b" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:0 18px">${[...db.papersRead].reverse().slice(0, 6).map((p) => `<div class="row"><span class="t" title="${esc(p.text)}">${esc(p.text)}</span><span class="m">${fmtDate(p.readAt)}</span></div>`).join("") || empty("None yet.")}</div></section>
    </div>`;

    if (app.entering) { countUp(root, FMT); drawRings(root); drawLines(root); }
    if (ui.flash) { // the tile you just ticked fills its ring again and bounces
      const el = root.querySelector(`.habit[data-id="${ui.flash}"]`);
      if (el) { pop(el); drawRings(el); }
      ui.flash = null;
    }

    root.onclick = (e) => {
      const g = e.target.closest("[data-go]");
      if (g) { e.preventDefault(); return app.go(g.dataset.go, g.dataset.focus); }
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.dataset.id;
      const burst = (color, n) => { const r = b.getBoundingClientRect(); pulse(r.left + r.width / 2, r.top + r.height / 2, color, n); };
      const toggleToday = (x) => { const was = (x.activeDates || []).includes(t); x.activeDates = was ? x.activeDates.filter((d) => d !== t) : [...(x.activeDates || []), t]; return !was; };
      switch (b.dataset.act) {
        case "focus": ui.focus = b.dataset.p; return app.refresh();
        case "month": {
          if (+b.dataset.d === 0) ui.month = ym;
          else { const d = new Date(ui.month + "-15"); d.setMonth(d.getMonth() + +b.dataset.d); ui.month = d.toISOString().slice(0, 7); }
          return app.refresh();
        }
        case "task": { // like schedule_tab: finishing a task made from a media item finishes the media too
          const x = db.schedule.find((y) => y.id === id); x.done = !x.done;
          if (x.done) burst("var(--cyan)", 30);
          const m = x.done && x.mediaId && db.media.find((y) => y.id === x.mediaId);
          if (m && !m.done) { m.done = true; m.completedAt = today(); logMediaConsumed(m); db.mediaQueue = db.mediaQueue.filter((q) => q !== m.id); }
          break;
        }
        case "rem": db.reminders.find((y) => y.id === id).completed = true; burst("var(--orange)", 30); break;
        case "habit": case "streak": {
          const x = (b.dataset.act === "habit" ? db.habits : db.streaks).find((y) => y.id === id);
          if (toggleToday(x)) { burst(getComputedStyle(b).getPropertyValue("--c").trim() || "var(--green)", 60); ui.flash = id; }
          break;
        }
        default: return;
      }
      commit(); app.refresh();
    };
  },
};
