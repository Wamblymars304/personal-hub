// Media — the data operations (done, queue, edit, delete, the reel). Shared by media.js and reading.js
// so the card and the shelf follow exactly the same rules. Same hub.json shapes as media_tab.py.
import { db, today, logMediaConsumed } from "../store.js";

export const CATEGORIES = ["TV Show", "Movie", "Documentary", "Manga", "Book", "Podcast", "Article", "Videogame"];
export const statusOf = (m) => m.status || (m.done ? "read" : "to-read");

/** Change a book's status, keeping done / the consumed log / the queue consistent */
export function setStatus(m, s) {
  m.status = s;
  db.mediaQueue = db.mediaQueue.filter((q) => q !== m.id);
  if (s === "read") { m.done = true; m.dnf = false; m.completedAt ||= today(); if (!db.mediaConsumed.some((c) => c.id === m.id)) logMediaConsumed(m); }
  else {
    db.mediaConsumed = db.mediaConsumed.filter((c) => c.id !== m.id);
    m.done = s === "did-not-finish"; m.dnf = s === "did-not-finish";
    if (s === "did-not-finish") m.completedAt ||= today(); else m.completedAt = "";
    if (s === "currently-reading") db.mediaQueue.unshift(m.id);
  }
}

/** Finished ↔ not finished. Books go through setStatus; everything else logs to / unlogs from mediaConsumed. */
export function toggleDone(m) {
  if (m.category === "Book") { setStatus(m, statusOf(m) === "read" ? "to-read" : "read"); return m.done; }
  if (m.done) {   // undo (the Python app had no undo; this keeps the log consistent)
    m.done = false; m.completedAt = "";
    db.mediaConsumed = db.mediaConsumed.filter((c) => c.id !== m.id);
  } else {
    m.done = true; m.completedAt = today(); logMediaConsumed(m);
    db.mediaQueue = db.mediaQueue.filter((q) => q !== m.id);
  }
  if (m.status) m.status = m.done ? "read" : "to-read";   // only items an older card gave a status
  return m.done;
}

export const isQueued = (m) => db.mediaQueue.includes(m.id);
export function toggleQueue(m) {
  db.mediaQueue = isQueued(m) ? db.mediaQueue.filter((q) => q !== m.id) : [...db.mediaQueue, m.id];
  return isQueued(m);
}

export function deleteItem(m) {
  db.media = db.media.filter((x) => x.id !== m.id);
  db.mediaQueue = db.mediaQueue.filter((q) => q !== m.id);
}

/** Edit title / category / minutes. Only fields that changed are written; the consumed log follows a rename. */
export function editItem(m, { title, category, minutes }) {
  title = (title || "").trim();
  if (title && title !== m.title) m.title = title;
  if (category && category !== m.category) m.category = category;
  minutes = Math.max(0, Math.round(+minutes || 0));
  if (minutes !== (+m.timeEstimate || 0)) m.timeEstimate = minutes;
  for (const c of db.mediaConsumed) if (c.id === m.id && (c.title !== m.title || c.category !== m.category)) { c.title = m.title; c.category = m.category; }
}

/** Fisher–Yates */
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const rollPool = (cat) => db.media.filter((x) => !x.done && (cat === "All Categories" || x.category === cat));
/** The randomizer. Every category is its own pool, so a category with hundreds of books can't crowd out one with two games: first one
 *  random item from each category (a random few of them if you asked for fewer), then each remaining pick chooses a
 *  random category and a random item in it, so a category can come up more than once. The picks replace the queue. */
export function roll(cat, n) {
  const pools = new Map();
  for (const m of rollPool(cat)) pools.has(m.category) ? pools.get(m.category).push(m) : pools.set(m.category, [m]);
  for (const pool of pools.values()) shuffle(pool);   // popping from a shuffled pool never repeats an item
  const wanted = Math.max(1, n), picks = [];
  for (const c of shuffle([...pools.keys()]).slice(0, wanted)) picks.push(pools.get(c).pop());
  while (picks.length < wanted) {
    const left = [...pools.keys()].filter((c) => pools.get(c).length);
    if (!left.length) break;   // asked for more than there is
    picks.push(pools.get(left[Math.floor(Math.random() * left.length)]).pop());
  }
  shuffle(picks);   // so the featured one isn't always the same kind of thing
  if (picks.length) db.mediaQueue = picks.map((p) => p.id);
  return picks;
}
