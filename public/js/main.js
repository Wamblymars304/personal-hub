// App shell: sidebar tabs (grouped), search, wisdom strips, backups.
import { load, db, onChange, pickSurfaceEntry, importBackup, today } from "./store.js";
import { $, $$, esc, toast, flash } from "./ui.js";
import { setMood, setMotion, motionEnabled, settle } from "./background.js";
import { reveal } from "./motion.js";
import dashboard from "./tabs/dashboard.js";
import media from "./tabs/media.js";
import blogs from "./tabs/blogs.js";
import reminders from "./tabs/reminders.js";
import hobbies from "./tabs/hobbies.js";
import schedule from "./tabs/schedule.js";
import projects from "./tabs/projects.js";
import pomodoro from "./tabs/pomodoro.js";
import analytics from "./tabs/analytics.js";
import finance from "./tabs/finance.js";
import wisdom from "./tabs/wisdom.js";
import gallery from "./tabs/gallery.js";
import notes from "./tabs/notes.js";
import dreams from "./tabs/dreams.js";
import diary from "./tabs/diary.js";
import review from "./tabs/review.js";
import places from "./tabs/places.js";
import atmospheres from "./tabs/atmospheres.js";
import music from "./tabs/music.js";
import challenge from "./tabs/challenge.js";
import bucket from "./tabs/bucket.js";
import skills from "./tabs/skills.js";
import { lib as musicLib } from "./music-lib.js";

const GROUPS = [
  ["", [dashboard, review]],
  ["Content", [gallery, atmospheres, music, blogs, media, challenge]],
  ["Plan", [schedule, reminders, projects]],
  ["Habits & focus", [skills, hobbies, pomodoro, analytics]],
  ["Life", [finance]],
  ["Mind", [wisdom, diary, dreams, notes, places, bucket]],
];
const TABS = Object.fromEntries(GROUPS.flatMap(([, t]) => t).map((t) => [t.id, t]));
let current = location.hash.slice(1) || localStorage.getItem("hub.tab") || "dashboard";

export function go(id, focusId) {
  if (!TABS[id]) id = "dashboard";
  current = id;
  try { localStorage.setItem("hub.tab", id); } catch {}
  renderNav();
  setMood(id); settle();
  $("#view").onclick = null;
  TABS[id].render($("#view"), { go, refresh, entering: true }, focusId);
  scrollTo(0, 0);
  reveal($("#view"));
  if (focusId) flash(focusId);
}
export const refresh = () => { renderNav(); TABS[current].render($("#view"), { go, refresh }); };

function renderNav() {
  $("#nav").innerHTML = GROUPS.map(([name, tabs]) =>
    (name ? `<div class="nav-group">${name}</div>` : "") + tabs.map((t) => {
      const n = t.count ? t.count() : null;
      return `<button class="nav-item${t.id === current ? " on" : ""}" data-tab="${t.id}" style="--c:${t.color}"><span class="dot"></span>${esc(t.label)}${n != null ? `<span class="n${typeof n === "string" ? " live" : ""}">${n}</span>` : ""}</button>`;
    }).join("")).join("");
  $$("[data-tab]").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
}

/* ---------- wisdom strips (principle on top, inspiration in the sidebar) ---------- */
const TYPE_COLOR = { Inspiration: "var(--cyan)", "Operating Principle": "var(--purple)", "Anti-Principle": "var(--orange)" };
function showPrinciple() {
  const el = $("#principle");
  if (localStorage.getItem("hub.hidePrinciple") === "1") {
    el.hidden = false;
    el.innerHTML = `<span class="t" style="color:var(--faint)">Daily principle hidden</span><button class="icon-btn" id="pShow">Show</button>`;
    $("#pShow").onclick = () => { localStorage.removeItem("hub.hidePrinciple"); showPrinciple(); };
    return;
  }
  const e = pickSurfaceEntry(["Operating Principle", "Anti-Principle"]);
  el.hidden = !e;
  if (!e) return;
  el.innerHTML = `<span class="tag" style="color:${TYPE_COLOR[e.type]};border-color:color-mix(in srgb, ${TYPE_COLOR[e.type]} 40%, transparent)">${esc(e.type)}</span>
    <span class="t" title="${esc(e.content)}"><b>${esc(e.title)}</b>${esc(e.content)}${e.source ? ` <span style="color:var(--faint)">— ${esc(e.source)}</span>` : ""}</span>
    <button class="icon-btn" id="pNext" title="Next principle">Next →</button><button class="icon-btn" id="pHide" title="Hide">Hide</button>`;
  $("#pNext").onclick = showPrinciple;
  $("#pHide").onclick = () => { localStorage.setItem("hub.hidePrinciple", "1"); showPrinciple(); };
}
function showQuote() {
  const e = pickSurfaceEntry(["Inspiration"]);
  const el = $("#quote");
  el.hidden = false;
  el.innerHTML = e
    ? `<b>Daily inspiration</b>“${esc(e.content.length > 220 ? e.content.slice(0, 218) + "…" : e.content)}”${e.source ? `<span class="src">— ${esc(e.source)}</span>` : ""}`
    : `<b>Daily inspiration</b><span style="font-style:normal">Add Inspiration entries in Wisdom to see them here.</span>`;
  el.onclick = showQuote;
  el.title = "Click for another";
}

/* ---------- search everything ---------- */
function searchIndex() {
  const out = [];
  const add = (tab, kind, color, id, title, sub) => out.push({ tab, kind, color, id, title: title || "", sub: sub || "" });
  db.blogs.forEach((b) => add("blogs", "Blog", "var(--purple)", b.id, b.label, b.url));
  db.papers.forEach((p) => add("blogs", "Paper", "var(--orange)", p.id, p.text, "library"));
  db.papersRead.forEach((p) => add("blogs", "Paper read", "var(--orange)", p.id, p.text, `read ${p.readAt}`));
  db.media.forEach((m) => add("media", m.category || "Media", "var(--pink)", m.id, m.title, m.done ? "done" : ""));
  db.reminders.forEach((r) => add("reminders", "Reminder", "var(--red)", r.id, r.title, r.completed ? "done" : r.priority));
  db.habits.forEach((h) => add("hobbies", "Habit", "var(--green)", h.id, h.name, h.desc));
  db.streaks.forEach((s) => add("hobbies", "Streak", "var(--green)", s.id, s.name, ""));
  db.hobbies.forEach((h) => add("hobbies", "Interest", "var(--green)", h.id, h.name, h.desc));
  db.projects.forEach((p) => add("projects", "Project", "var(--purple)", p.id, p.name, p.status));
  db.schedule.forEach((t) => add("schedule", "Task", "var(--cyan)", t.id, t.title, t.date));
  db.wisdom.forEach((w) => add("wisdom", w.type, "var(--amber)", w.id, w.title, w.content));
  db.purchases.forEach((p) => add("finance", "Wishlist", "var(--green)", p.id, p.name, ""));
  (db.notes || []).forEach((n) => add("notes", n.folder || "Note", "var(--cyan)", n.id, n.title, n.text));
  (db.dreams || []).forEach((d) => add("dreams", "Dream", "var(--purple)", d.id, d.title || "Untitled dream", d.text));
  (db.diary || []).forEach((e) => add("diary", "Diary", "var(--orange)", e.id, e.title || e.date, e.text));
  (db.places || []).forEach((p) => add("places", "Place", "var(--pink)", p.id, p.name, [p.area, p.country, p.said].filter(Boolean).join(" · ")));
  (db.skills || []).forEach((s) => add("skills", "Skill", "#a8c4ff", s.id, s.name, [s.cat, s.status].filter(Boolean).join(" · ")));
  (db.bucket || []).forEach((i) => add("bucket", "Bucket list", "var(--amber)", i.id, i.text, i.status === "done" ? "done" : i.note || ""));
  (db.readingChallenge?.items || []).forEach((i) => add("challenge", i.kind === "book" ? "Challenge book" : "Challenge story", "var(--amber)", i.id, i.title, `${i.author} · ${i.year}`));
  (db.readingPicks?.items || []).forEach((i) => add("challenge", "Book for you", "var(--amber)", i.id, i.title, `${i.author} · ${i.year}`));
  if (musicLib) {
    musicLib.rooms.forEach((r) => add("music", "Music room", "var(--cyan)", "room:" + r.id, r.name, r.era));
    musicLib.tracks.forEach((t) => add("music", "Song", "var(--cyan)", "t:" + t.id, t.t, t.ar.join(", ")));
  }
  return out;
}
let palItems = [], palCursor = 0;
function openPalette() { $("#palette").hidden = false; $("#palInput").value = ""; palCursor = 0; renderPalette(); $("#palInput").focus(); }
function closePalette() { $("#palette").hidden = true; }
function renderPalette() {
  const q = $("#palInput").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const all = searchIndex();
  palItems = words.length
    ? all.filter((it) => words.every((w) => `${it.title} ${it.sub} ${it.kind}`.toLowerCase().includes(w)))
        .sort((a, b) => (a.title.toLowerCase().startsWith(words[0]) ? 0 : 1) - (b.title.toLowerCase().startsWith(words[0]) ? 0 : 1)).slice(0, 60)
    : [];
  palCursor = Math.min(palCursor, Math.max(0, palItems.length - 1));
  $("#palList").innerHTML = words.length
    ? palItems.map((it, i) => `<div class="pal-item${i === palCursor ? " on" : ""}" data-i="${i}" style="--c:${it.color}"><span class="k">${esc(it.kind)}</span><span class="t">${esc(it.title)}${it.sub ? `<small>${esc(it.sub.slice(0, 60))}</small>` : ""}</span></div>`).join("") || `<div class="empty">Nothing matches “${esc(q)}”.</div>`
    : `<div class="empty">Searching ${all.length.toLocaleString()} things across every tab.</div>`;
  $$(".pal-item").forEach((el) => (el.onclick = () => pick(+el.dataset.i)));
}
function pick(i) { const it = palItems[i]; if (!it) return; closePalette(); go(it.tab, it.id); }
$("#palInput").addEventListener("input", () => { palCursor = 0; renderPalette(); });
$("#palInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { palCursor = Math.min(palCursor + 1, palItems.length - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { palCursor = Math.max(palCursor - 1, 0); renderPalette(); e.preventDefault(); }
  else if (e.key === "Enter") pick(palCursor);
  else if (e.key === "Escape") closePalette();
});
$("#palette").addEventListener("mousedown", (e) => { if (e.target.id === "palette") closePalette(); });
$("#searchBtn").onclick = openPalette;
addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); openPalette(); }
});

/* ---------- backups (same JSON as the Python app's Save/Load backup) ---------- */
$("#exportBtn").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: "application/json" }));
  a.download = `hub-backup-${today()}.json`;
  a.click();
  toast("Backup downloaded");
};
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!confirm(`Replace your current data with “${f.name}”? A dated copy of the current data is kept in data/backups.`)) return;
  try { importBackup(await f.text()); refresh(); toast("Backup loaded"); } catch { toast("That file isn't a valid hub backup"); }
  e.target.value = "";
};

/* ---------- motion switch (per-device preference) ---------- */
const motionLabel = () => ($("#motionBtn").textContent = `Motion: ${motionEnabled() ? "on" : "off"}`);
$("#motionBtn").onclick = () => { setMotion(!motionEnabled()); motionLabel(); toast(motionEnabled() ? "Motion on" : "Motion off — everything stays still"); };
motionLabel();

/* soft light that follows the cursor across glass panels */
addEventListener("pointermove", (e) => {
  const el = e.target.closest?.(".card, .kpi, .tile, .addbar");
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}, { passive: true });

// keep the running Pomodoro countdown visible in the sidebar on every tab
setInterval(() => { const n = document.querySelector('[data-tab="pomodoro"] .n'), v = pomodoro.count(); if (v) { if (n) n.textContent = v; else renderNav(); } else if (n) renderNav(); }, 1000);

onChange((s) => {
  if (s === "conflict") { refresh(); toast("Your data changed outside this page — loaded the newest version. Redo your last change if it's missing."); s = "saved"; }
  const el = $("#saveState");
  el.className = s === "error" ? "error" : "";
  el.textContent = s === "saving" ? "saving…" : s === "saved" ? "all changes saved" : "couldn't save — is the server running?";
});

await load();
$("#saveState").textContent = "all changes saved";
showPrinciple();
showQuote();
go(current);
