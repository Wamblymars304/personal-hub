// Data layer: same hub.json shape and rules as the PySide6 app's data_manager.py.

export const DEFAULTS = {
  version: "2.0", blogs: [], blogsPicked: [], media: [], mediaQueue: [], mediaConsumed: [], schedule: [], hobbies: [],
  notes: [], projects: [], pomodoroCategories: ["Study", "Music", "Code", "Art", "Writing"], pomodoroSessions: [],
  habits: [], streaks: [], papers: [], papersPicks: [], papersRead: [], scheduleSettings: { greenMax: 240, yellowMax: 480 },
  recurringExpenses: [], purchases: [], budgets: [], savingsGoal: { target: 0 }, debts: [], reminders: [], income: [],
  incomeGoal: { monthly: 0 }, assets: [], oneTimeExpenses: [], recurringIncome: [],
  productivityTargets: { pomoTarget: 4, habitTarget: 0, streakTarget: 0 }, wisdom: [],
  dietSettings: { calorieTarget: 2000, proteinTarget: 120, carbsTarget: 220, fatTarget: 65, waterTarget: 8, weightGoal: 0, planNotes: "" },
  dietLog: [], dietFoods: [], dietWater: {}, dietWeights: [],
  dreams: [], diary: [], notes: [], places: [],   // web-only (the Python app has no dream journal)
};

export let db = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

let rev = "";   // revision of hub.json this page is based on (see server.js)
export async function load() {
  const res = await fetch("/api/data", { cache: "no-store" });
  rev = res.headers.get("X-Rev") || "";
  db = await res.json();
  for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in db)) db[k] = structuredClone(v);
  backfillMediaConsumed();
  return db;
}

// One-time migration the Python app also does: seed the consumed log from done media.
function backfillMediaConsumed() {
  const logged = new Set(db.mediaConsumed.map((e) => e.id));
  let changed = false;
  for (const m of db.media) {
    if (m.done && m.completedAt && !logged.has(m.id)) {
      db.mediaConsumed.push({ id: m.id, title: m.title || "", category: m.category || "", consumedAt: m.completedAt });
      changed = true;
    }
  }
  if (changed) commit();
}

// Every change gets a number; a save covers everything up to the number it sent. "quiet" changes
// (gallery view counts) still save, but losing one on close isn't worth a "Leave site?" warning.
let timer = null, inflight = null, changeNo = 0, savedNo = 0, mattersNo = 0;
export function commit(quiet = false) {
  changeNo++;
  if (!quiet) mattersNo = changeNo;
  listeners.forEach((fn) => fn("saving"));
  clearTimeout(timer);
  timer = setTimeout(flush, 350);
}
async function flush() {
  await inflight;   // one save at a time, so each carries the revision the previous one produced
  inflight = (async () => {
    const sending = changeNo;
    try {
      const res = await fetch("/api/data", { method: "PUT", body: JSON.stringify(db), headers: { "X-Rev": rev } });
      if (res.status === 409) {   // hub.json changed underneath this page: take the newer data instead
        savedNo = changeNo;
        await load();
        return listeners.forEach((fn) => fn("conflict"));
      }
      if (!res.ok) throw new Error(await res.text());
      rev = res.headers.get("X-Rev") || rev;
      savedNo = Math.max(savedNo, sending);
      if (savedNo >= changeNo) listeners.forEach((fn) => fn("saved"));
    } catch (e) {
      listeners.forEach((fn) => fn("error"));
    }
  })();
  return inflight;
}
addEventListener("beforeunload", (e) => {
  if (savedNo >= changeNo) return;
  clearTimeout(timer); flush();               // try to get it out the door anyway
  if (savedNo < mattersNo) e.preventDefault(); // only warn about changes you made yourself
});

/* ---------- helpers matching data_manager.py ---------- */
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALNUM[b % 62]).join("");
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => iso(new Date());
export const parseTags = (t) => (t || "").trim().split(/[,\s]+/).map((p) => p.replace(/^#/, "").trim()).filter(Boolean);
export function parseDate(s) {
  // user-entered dates may be non-zero-padded (2026-9-11)
  const m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
export const normDate = (s) => { const d = parseDate(s); return d ? iso(d) : ""; };
export const daysFromToday = (s) => { const d = parseDate(s); return d ? Math.round((d - parseDate(today())) / 864e5) : null; };
export function formatDuration(min) {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}
export function currentStreak(dates) {
  // same as hobbies_tab._current_streak: counts back from TODAY, 0 if today isn't logged
  const set = new Set(dates || []);
  let n = 0, d = parseDate(today());
  while (set.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const monthly = (price, freq) => (+price || 0) * ({ weekly: 52 / 12, monthly: 1, yearly: 1 / 12 }[freq] ?? 1);

/** data_manager.recurring_occurrences: due dates (as "YYYY-MM-DD") of a bill {frequency, dueDate}
 *  within [start, end], anchored on dueDate. Day-of-month is clamped (Jan 31 → Feb 28/29). */
export function recurringOccurrences(bill, start, end) {
  const anchor = parseDate(bill.dueDate), s = parseDate(start), e = parseDate(end);
  if (!anchor || !s || !e || s > e) return [];
  const out = [], freq = bill.frequency || "monthly";
  const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
  if (freq === "weekly") {
    const d = new Date(anchor);
    if (d > e) return [];
    while (d < s) d.setDate(d.getDate() + 7);
    for (; d <= e; d.setDate(d.getDate() + 7)) out.push(iso(d));
  } else if (freq === "yearly") {
    for (let y = Math.max(s.getFullYear(), anchor.getFullYear()); y <= e.getFullYear(); y++) {
      const d = new Date(y, anchor.getMonth(), Math.min(anchor.getDate(), lastDay(y, anchor.getMonth())));
      if (d >= anchor && d >= s && d <= e) out.push(iso(d));
    }
  } else {
    for (let y = s.getFullYear(), m = s.getMonth(); y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth()); m === 11 ? (y++, (m = 0)) : m++) {
      const d = new Date(y, m, Math.min(anchor.getDate(), lastDay(y, m)));
      if (d >= anchor && d >= s && d <= e) out.push(iso(d));
    }
  }
  return out;
}

export function logMediaConsumed(item) {
  if (db.mediaConsumed.some((e) => e.id === item.id)) return;
  db.mediaConsumed.push({ id: item.id, title: item.title || "", category: item.category || "", consumedAt: item.completedAt || today() });
}

// wisdom_tab.pick_surface_entry: weighted by importance (x2 if core), avoids same-day repeats
export function pickSurfaceEntry(types) {
  let entries = db.wisdom.filter((e) => !types || types.includes(e.type));
  if (!entries.length) return null;
  const t = today();
  let cands = entries.filter((e) => (e.lastSeenDate || "") !== t);
  if (!cands.length) cands = entries;
  const w = cands.map((e) => (e.importanceScore ?? 3) * (e.isCore ? 2 : 1));
  const total = w.reduce((a, b) => a + b, 0);
  let chosen = cands[0];
  if (total > 0) { let r = Math.random() * total; for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { chosen = cands[i]; break; } } }
  chosen.lastSeenDate = t;
  chosen.viewCount = (chosen.viewCount || 0) + 1;
  commit();
  return chosen;
}

export function importBackup(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.media)) throw new Error("not a hub backup");
  for (const k of Object.keys(data)) db[k] = data[k];   // every key, so web-only data (music links, nudges, blog draws…) comes back too
  commit();
}
