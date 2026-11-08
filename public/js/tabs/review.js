// Review — your week on one page, and how it sits against the twelve weeks before it, so you can see
// who you've been lately. The hub sends a notification on Sunday evening that opens this page.
import { db, today, parseDate, formatDuration } from "../store.js";
import { esc, money, empty, plural } from "../ui.js";
import { events, weekStats, weekStart, addDays, KIND } from "../timeline.js";
import { spark } from "./dashboard.js";
import { drawLines } from "../motion.js";

const ui = { week: null };
const WEEKS = 12;
const SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const METRICS = [
  { k: "focus", label: "Focus", color: "var(--purple)", fmt: (v) => formatDuration(Math.round(v)) || "0m", tab: "pomodoro" },
  { k: "habits", label: "Habit check-ins", color: "var(--green)", tab: "hobbies" },
  { k: "wrote", label: "Days you wrote", color: "var(--orange)", tab: "diary" },
  { k: "outside", label: "Days outside", color: "var(--green)", tab: "reminders" },
  { k: "dreams", label: "Dreams recorded", color: "var(--purple)", tab: "dreams" },
  { k: "finished", label: "Media finished", color: "var(--pink)", tab: "media" },
  { k: "tasks", label: "Tasks done", color: "var(--cyan)", tab: "schedule" },
  { k: "spent", label: "Spent", color: "var(--red)", fmt: (v) => money(v), tab: "finance", lessIsBetter: true },
];
const fmt = (m, v) => (m.fmt ? m.fmt(v) : String(v));

function sentence(s) {
  const bits = [];
  if (s.focus) bits.push(`focused ${formatDuration(Math.round(s.focus))}`);
  if (s.habits) bits.push(`kept ${plural(s.habits, "habit check-in")}`);
  if (s.wrote) bits.push(`wrote on ${plural(s.wrote, "day")}`);
  if (s.outside) bits.push(`went outside on ${plural(s.outside, "day")}`);
  if (s.dreams) bits.push(`recorded ${plural(s.dreams, "dream")}`);
  if (s.finished) bits.push(`finished ${s.finished} ${s.finished === 1 ? "thing" : "things"} to watch or read`);
  if (s.spent) bits.push(`spent ${money(s.spent)}`);
  if (!bits.length) return "A quiet week — nothing logged. That's information too.";
  const last = bits.pop();
  return `You ${bits.length ? bits.join(", ") + " and " + last : last}.`;
}

export default {
  id: "review", label: "Weekly review", color: "var(--cyan)",
  render(root, app) {
    const thisWeek = weekStart(today());
    const all = events();
    // early in a week with nothing logged yet, open on last week instead of an empty page
    if (!ui.week) ui.week = weekStats(thisWeek, all).events.length ? thisWeek : addDays(thisWeek, -7);
    const start = ui.week;
    const series = Array.from({ length: WEEKS }, (_, i) => weekStats(addDays(start, -7 * (WEEKS - 1 - i)), all));
    const cur = series.at(-1), prev = series.at(-2);
    const end = addDays(start, 6), live = start === thisWeek;
    const moments = cur.events.filter((e) => ["diary", "dream", "note", "wisdom"].includes(e.kind)).sort((a, b) => a.date.localeCompare(b.date));
    const spends = cur.events.filter((e) => e.kind === "spent").sort((a, b) => b.amount - a.amount).slice(0, 6);
    const finished = cur.events.filter((e) => e.kind === "finished");
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const habits = [...db.habits, ...db.streaks];
    const delta = (m) => {
      const a = cur[m.k], b = prev[m.k];
      if (a === b) return `<span class="dl">same as last week</span>`;
      const up = a > b, good = m.lessIsBetter ? !up : up;
      const diff = m.k === "spent" ? money(Math.abs(a - b)) : m.k === "focus" ? formatDuration(Math.round(Math.abs(a - b))) : Math.abs(a - b);
      return `<span class="dl ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${diff} vs last week</span>`;
    };

    root.innerHTML = `<div class="page-h"><h1>Weekly review</h1><span class="sub">${SHORT.format(parseDate(start))} – ${SHORT.format(parseDate(end))}, ${end.slice(0, 4)}${live ? " · this week so far" : ""}</span><span class="sp"></span>
        <button class="icon-btn" data-act="wk" data-d="-7">‹ Earlier</button>${live ? "" : `<button class="icon-btn" data-act="wk" data-d="0">This week</button><button class="icon-btn" data-act="wk" data-d="7">Later ›</button>`}</div>
      <section class="card review-hero"><p>${sentence(cur)}</p></section>
      <div class="review-tiles">${METRICS.map((m) => `<button class="tile" style="--c:${m.color}" data-go="${m.tab}"><span class="lbl">${m.label}</span>
          <span class="val">${fmt(m, cur[m.k])}</span>${delta(m)}${spark(series.map((s) => s[m.k]), "bars")}<span class="wk">last ${WEEKS} weeks</span></button>`).join("")}</div>
      <div class="review-grid">
        <section class="card"><header class="panel-h"><h3>Moments</h3><p class="sub">what you wrote, dreamt and saved</p></header><div class="panel-b">
          ${moments.map((e) => `<button class="otd-item" data-go="${e.tab}" data-focus="${esc(e.id)}" style="--c:${KIND[e.kind].color}"><span class="k">${KIND[e.kind].label}</span>
            <span class="t">${esc(e.title)}${e.text ? `<small>${esc(e.text.replace(/[#*>]/g, "").replace(/\s+/g, " ").slice(0, 140))}</small>` : ""}</span><span class="m">${DAY.format(parseDate(e.date))}</span></button>`).join("") || empty("Nothing written this week.")}</div></section>
        <section class="card"><header class="panel-h"><h3>Habits</h3><p class="sub">${plural(cur.habits, "check-in")}</p></header><div class="panel-b">
          ${habits.length ? `<div class="hgrid"><span></span>${days.map((d) => `<span class="hd">${DAY.format(parseDate(d)).slice(0, 2)}</span>`).join("")}
            ${habits.map((h) => `<span class="hn">${esc(h.name)}</span>${days.map((d) => `<i class="${(h.activeDates || []).includes(d) ? "on" : d > today() ? "fut" : ""}"></i>`).join("")}`).join("")}</div>` : empty("No habits yet.")}</div></section>
        <section class="card"><header class="panel-h"><h3>Biggest spends</h3><p class="sub">${money(cur.spent)} out${cur.earned ? ` · ${money(cur.earned)} in` : ""}</p></header><div class="panel-b">
          ${spends.map((e) => `<div class="row"><span class="t">${esc(e.title)}</span><span class="m">${DAY.format(parseDate(e.date))}</span><b>${money(e.amount)}</b></div>`).join("") || empty("No spending logged.")}</div></section>
        <section class="card"><header class="panel-h"><h3>Finished</h3><p class="sub">watched, read, played</p></header><div class="panel-b">
          ${finished.map((e) => `<div class="row"><span class="t">${esc(e.title)}<small>${esc(e.sub || "")}</small></span><span class="m">${DAY.format(parseDate(e.date))}</span></div>`).join("") || empty("Nothing finished this week.")}</div></section>
      </div>`;
    drawLines(root);
    root.onclick = (e) => {
      const g = e.target.closest("[data-go]");
      if (g) return app.go(g.dataset.go, g.dataset.focus);
      const b = e.target.closest("[data-act=wk]");
      if (!b) return;
      ui.week = +b.dataset.d === 0 ? thisWeek : addDays(start, +b.dataset.d);
      if (ui.week > thisWeek) ui.week = thisWeek;
      app.refresh();
    };
  },
};
