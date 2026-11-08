// Timeline — every dated thing in the hub as one list of moments, so you can see yourself over time.
// Used by On this day (Dashboard) and the weekly Review.
import { db, parseDate, iso, today, formatDuration } from "./store.js";
import { money } from "./ui.js";

export const KIND = {
  diary: { label: "Diary", color: "var(--orange)" }, dream: { label: "Dream", color: "var(--purple)" }, note: { label: "Note", color: "var(--cyan)" },
  finished: { label: "Finished", color: "var(--pink)" }, wisdom: { label: "Wisdom", color: "var(--amber)" }, read: { label: "Read", color: "var(--amber)" },
  spent: { label: "Spent", color: "var(--red)" }, earned: { label: "Earned", color: "var(--green)" }, focus: { label: "Focus", color: "var(--purple)" },
  task: { label: "Done", color: "var(--cyan)" }, habit: { label: "Habits", color: "var(--green)" }, outside: { label: "Outside", color: "var(--green)" },
  wrote: { label: "Wrote", color: "var(--orange)" },
};
const ORDER = ["diary", "dream", "note", "wisdom", "finished", "read", "outside", "wrote", "focus", "habit", "task", "spent", "earned"];
const firstLine = (t) => (t || "").split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean)?.slice(0, 70) || "";

/** Every dated thing: { date, kind, tab, id, title, text?, amount?, minutes? } */
export function events() {
  const out = [];
  const add = (date, kind, tab, id, title, extra = {}) => { if (/^\d{4}-\d{2}-\d{2}/.test(date || "")) out.push({ date: date.slice(0, 10), kind, tab, id, title: title || "", ...extra }); };
  (db.diary || []).forEach((e) => add(e.date, "diary", "diary", e.id, e.title || firstLine(e.text), { text: e.text }));
  (db.dreams || []).forEach((d) => add(d.date, "dream", "dreams", d.id, d.title || firstLine(d.text), { text: d.text }));
  (db.notes || []).forEach((n) => add(n.created, "note", "notes", n.id, n.title, { text: n.text }));
  db.mediaConsumed.forEach((m) => add(m.consumedAt, "finished", "media", m.id, m.title, { sub: m.category }));
  db.wisdom.forEach((w) => add(w.dateAdded, "wisdom", "wisdom", w.id, w.title, { text: w.content }));
  db.papersRead.forEach((p) => add(p.readAt, "read", "blogs", p.id, p.text));
  db.oneTimeExpenses.forEach((x) => add(x.date, "spent", "finance", x.id, x.name, { amount: +x.amount || 0 }));
  db.income.forEach((x) => add(x.date, "earned", "finance", x.id, x.name, { amount: +x.amount || 0 }));
  db.pomodoroSessions.forEach((s) => add(s.date, "focus", "pomodoro", s.id, s.category, { minutes: +s.duration || 0 }));
  db.schedule.forEach((t) => t.done && add(t.date, "task", "schedule", t.id, t.title));
  [...db.habits, ...db.streaks].forEach((h) => (h.activeDates || []).forEach((d) => add(d, "habit", "hobbies", h.id, h.name)));
  (db.nudges?.outside?.log || []).forEach((d) => add(d, "outside", "reminders", null, "Went outside"));
  (db.nudges?.write?.log || []).forEach((d) => add(d, "wrote", "reminders", null, "Wrote"));
  return out;
}

/** Many small things on one day read better as one line: focus minutes, habit check-ins, purchases. */
function summarize(list) {
  const keep = [], byDay = {};
  for (const e of list) {
    if (!["focus", "habit", "spent", "task"].includes(e.kind)) { keep.push(e); continue; }
    const g = (byDay[e.date + e.kind] ||= { ...e, n: 0, minutes: 0, amount: 0, names: [] });
    g.n++; g.minutes += e.minutes || 0; g.amount += e.amount || 0; if (!g.names.includes(e.title)) g.names.push(e.title);
  }
  for (const g of Object.values(byDay)) {
    const names = g.names.filter(Boolean).slice(0, 3).join(", ");
    g.title = g.kind === "focus" ? `Focused ${formatDuration(g.minutes) || g.minutes + "m"}${names ? ` on ${names}` : ""}`
      : g.kind === "habit" ? `Kept ${g.n === 1 ? names : `${g.n} habits: ${names}`}`
      : g.kind === "spent" ? `Spent ${money(g.amount)}${names ? ` · ${names}` : ""}`
      : `Finished ${g.n === 1 ? names : `${g.n} tasks: ${names}`}`;
    g.id = g.n === 1 ? g.id : null;
    keep.push(g);
  }
  return keep.sort((a, b) => Math.abs(a.off) - Math.abs(b.off) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** Past years around today's date: [{ year, ago, items: [... { off: days from the same date }] }] */
export function onThisDay(ref = today(), window = 3, perYear = 5) {
  const [y, m, d] = ref.split("-").map(Number), all = events();
  const years = [...new Set(all.map((e) => +e.date.slice(0, 4)))].filter((yy) => yy < y).sort((a, b) => b - a);
  return years.map((yy) => {
    const center = new Date(yy, m - 1, d);
    const near = all.filter((e) => e.date.startsWith(yy + "-")).map((e) => ({ ...e, off: Math.round((parseDate(e.date) - center) / 864e5) })).filter((e) => Math.abs(e.off) <= window);
    return { year: yy, ago: y - yy, date: iso(center), items: summarize(near).slice(0, perYear) };
  }).filter((g) => g.items.length);
}

/* ---------- weeks (Monday → Sunday) ---------- */
export function weekStart(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
export const addDays = (dateStr, n) => { const d = parseDate(dateStr); d.setDate(d.getDate() + n); return iso(d); };

/** The numbers for one week. */
export function weekStats(start, all = events()) {
  const end = addDays(start, 6), w = all.filter((e) => e.date >= start && e.date <= end);
  const days = (kinds) => new Set(w.filter((e) => kinds.includes(e.kind)).map((e) => e.date)).size;
  return {
    start, end, events: w,
    spent: w.filter((e) => e.kind === "spent").reduce((s, e) => s + e.amount, 0),
    earned: w.filter((e) => e.kind === "earned").reduce((s, e) => s + e.amount, 0),
    focus: w.filter((e) => e.kind === "focus").reduce((s, e) => s + e.minutes, 0),
    habits: w.filter((e) => e.kind === "habit").length,
    finished: w.filter((e) => e.kind === "finished").length,
    outside: days(["outside"]),
    wrote: days(["wrote", "diary", "note"]),
    dreams: w.filter((e) => e.kind === "dream").length,
    tasks: w.filter((e) => e.kind === "task").length,
  };
}
