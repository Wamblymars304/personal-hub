// Music — Listen: hear every song in the library, a random batch a day, shortest songs first, and score each one.
// After a song: a 0–10 score in quarter steps (tap a number, nudge ±¼) of how much it moved you, plus three quick signals that find the songs that truly
// land — chills (frisson, the body's own verdict), a few feeling words, and a one-line note. "Don't rank" is for
// background pieces: no score, out of the queue and the rankings, kept in the library and in a playable "Background
// pieces" list (stored in musicJourney.skipped); "Remove" takes a song out of the
// library entirely (and out of every later import) — both can be undone below.
// Saved in hub.json "musicJourney": { started, perDay, days: { date: [ids] }, rated: { id: { s, c, f[], n, d } },
// skipped: { id: date } } (s = score, u = last re-rated); removals in "musicRemoved" (music-lib.js). "Your ratings"
// reopens any scored song to change it.
import { db, commit, today } from "../store.js";
import { esc, plural, toast } from "../ui.js";
import { lib, cover, by, shuffle, removeTrack, restoreTrack, removedTracks } from "../music-lib.js";
import { playQueue, onPlayer, now, step } from "../player.js";

const TIERS = [[0, 120, "under 2 minutes"], [120, 180, "2–3 minutes"], [180, 240, "3–4 minutes"], [240, 300, "4–5 minutes"],
  [300, 420, "5–7 minutes"], [420, 600, "7–10 minutes"], [600, Infinity, "over 10 minutes"]];
// feelings in families (loosely after the Geneva Emotional Music Scale, plus the places music puts you); your own words join "yours"
const FEEL_GROUPS = [
  ["wonder", ["ethereal", "awe", "transcendent", "dreamy", "otherworldly", "cosmic", "spiritual", "magical"]],
  ["longing", ["nostalgic", "bittersweet", "wistful", "yearning", "homesick", "anemoia", "sentimental", "regretful"]],
  ["sorrow", ["melancholic", "lonely", "grieving", "heartbroken", "desolate", "empty", "numb", "vulnerable"]],
  ["calm", ["comforting", "peaceful", "tender", "warm", "safe", "intimate", "hopeful", "healing"]],
  ["energy", ["euphoric", "joyful", "playful", "energizing", "triumphant", "free", "epic", "confident"]],
  ["shadow", ["eerie", "haunting", "unsettling", "dread", "tense", "chaotic", "aggressive", "uncanny"]],
  ["release", ["cathartic", "overwhelming", "liberating", "defiant", "raw", "visceral", "intense", "explosive"]],
  ["place", ["liminal", "surreal", "late night", "dusk", "rainy", "underwater", "empty city", "lost in time"]],
];
// what each feeling means — shown when you hover it
const DESC = {
  ethereal: "light and weightless, as if it isn't quite of this world", awe: "something vast makes you feel small, in a good way",
  transcendent: "lifts you out of yourself and out of the moment", dreamy: "soft focus, half-asleep, drifting",
  otherworldly: "sounds like it comes from another place, or another planet", cosmic: "space-sized: stars, distance, infinity",
  spiritual: "feels sacred, like prayer or ritual", magical: "enchanted, a little impossible",
  nostalgic: "pulls you back to a time you actually lived", bittersweet: "happy and sad at the same time",
  wistful: "a soft, quiet wish for something out of reach", yearning: "an ache for something or someone",
  homesick: "missing a place, or the feeling of home", anemoia: "nostalgia for a time you never lived",
  sentimental: "tugs at old attachments and soft spots", regretful: "carries the weight of something you'd undo",
  melancholic: "a beautiful, lingering sadness", lonely: "makes you feel alone — or keeps you company in it",
  grieving: "sounds like loss", heartbroken: "raw heartache", desolate: "empty landscapes, nobody left",
  empty: "hollow, drained of feeling", numb: "far away from your own feelings", vulnerable: "exposed, unguarded, fragile",
  comforting: "like a blanket: it holds you", peaceful: "still and untroubled", tender: "gentle, affectionate, delicate",
  warm: "golden, close and kind", safe: "nothing bad can happen while it plays", intimate: "close and private, just for you",
  hopeful: "looks toward something better", healing: "mends something in you, a little",
  euphoric: "a rush of overwhelming joy", joyful: "plain, uncomplicated happiness", playful: "mischievous, light, fun",
  energizing: "makes you want to move; wakes up your body and your focus", triumphant: "victory: rising, winning",
  free: "open roads, nothing holding you back", epic: "huge, cinematic, larger than life", confident: "walk-a-little-taller music",
  eerie: "quietly strange; something's off", haunting: "stays with you long after it ends", unsettling: "leaves you uneasy",
  dread: "the feeling that something bad is coming", tense: "tight and suspended, waiting to break",
  chaotic: "overload: everything happening at once", aggressive: "forceful and hostile, ready to fight", uncanny: "familiar, but wrong",
  cathartic: "lets something out; you feel lighter after", overwhelming: "more feeling than you can hold",
  liberating: "breaking free of something", defiant: "standing your ground, refusing to give in", raw: "unpolished, honest, exposed",
  visceral: "felt in the body, not just heard", intense: "maximum feeling, no room to breathe", explosive: "builds and builds, then bursts",
  liminal: "an in-between place: empty, transitional, slightly wrong", surreal: "dream logic in waking life",
  "late night": "3 a.m., the city asleep and you still awake", dusk: "the sun going down, the day ending",
  rainy: "grey windows and wet streets", underwater: "muffled, slow, submerged", "empty city": "streets with nobody in them",
  "lost in time": "could be any decade, or none",
};
const tip = (f) => `${f}: ${DESC[f] || "a feeling of your own"}`;
const FEELINGS = FEEL_GROUPS.flatMap(([, l]) => l);
const yours = () => (J().feelings ||= []);   // words you added yourself
const SIZES = [10, 20, 50, 100];   // quick picks; any number can be typed
const ui = { gone: false, q: "", sort: "recent", open: "", cap: 20, feel: "", rk: "song", mk: "all", doneOpen: false, removed: false, bgCap: 50, last: "", lastOpen: false };

// Every piece is a song, an atmosphere or a study piece. Scores are the same everywhere; pieces only compete within their kind.
// A first guess comes from genre tags and sound; one click overrides it (saved in musicJourney.kind).
export const KINDS = {
  song: { name: "Song", many: "songs", ask: "how much did it move you?" },
  atmo: { name: "Atmosphere", many: "atmospheres", ask: "how deep did it take you?" },
  study: { name: "Study", many: "study pieces", ask: "how well does it hold the space?" },
};
const STUDY_TAGS = new Set(["lo-fi", "lo-fi beats", "lo-fi hip hop", "jazz beats", "chillhop", "chillstep", "study beats", "lo-fi jazz"]);
const ATMO_TAGS = new Set(["ambient", "dark ambient", "drone", "space music", "new age", "field recording", "dungeon synth", "isolationism", "ambient jazz"]);
const SCORED = new Set(["score", "animeost", "game", "classical"]);   // quiet, wordless — but music pieces
function guessKind(t) {
  if (t.g.some((g) => STUDY_TAGS.has(g)) || t.r.includes("lofi")) return "study";
  if (t.g.some((g) => ATMO_TAGS.has(g)) || t.r.includes("ambient") || t.r.includes("disturbing")) return "atmo";
  const f = t.f || {};
  if (!t.r.some((r) => SCORED.has(r)) && (f.instr ?? 0) >= 0.8 && (f.energy ?? 1) < 0.3 && (f.dance ?? 1) < 0.4) return "atmo";
  return "song";
}
export const kindOf = (t) => J().kind?.[t.id] || guessKind(t);
const STEP = 0.25;
export const fmtS = (v) => (v == null ? "—" : String(+(+v).toFixed(2)));   // 7, 7.25, 7.5
const SORTS = { recent: "Recently scored", high: "Highest first", low: "Lowest first", chills: "Chills first" };
let kit = null;

const J = () => {
  const j = (db.musicJourney ||= {});
  j.started ||= today(); j.perDay ||= 10; j.days ||= {}; j.rated ||= {}; j.skipped ||= {};
  return j;
};
const secs = (t) => (t.ms ? t.ms / 1000 : 240);
const tierOf = (t) => TIERS.findIndex(([a, b]) => secs(t) >= a && secs(t) < b);
const fmtLen = (t) => { const s = Math.round(secs(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const open = () => { const j = J(); return lib.tracks.filter((t) => !j.rated[t.id] && !j.skipped[t.id]); };

/** n random songs from the shortest stretch that still has unheard songs, topped up from the next stretches. */
function draw(n, exclude = new Set()) {
  const pool = open().filter((t) => !exclude.has(t.id)), out = [];
  for (let k = 0; k < TIERS.length && out.length < n; k++) out.push(...shuffle(pool.filter((t) => tierOf(t) === k)).slice(0, n - out.length));
  return out.map((t) => t.id);
}
function todayBatch() {
  const j = J(), d = today();
  if (!j.days[d]) { j.days[d] = draw(j.perDay); commit(); }
  const byId = new Map(lib.tracks.map((t) => [t.id, t]));
  return j.days[d].map((id) => byId.get(id)).filter(Boolean);   // removed songs drop out
}
function streak() {
  const days = new Set(Object.values(J().rated).map((r) => r.d));
  let n = 0;
  for (let d = new Date(today() + "T00:00"); ; d.setDate(d.getDate() - 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (days.has(k)) n++; else if (n || k !== today()) break;
  }
  return n;
}
function eta(left, per) {
  const days = Math.ceil(left / per);
  if (days < 45) return plural(days, "day");
  const m = Math.round(days / 30.4);
  return m < 18 ? plural(m, "month") : `${(days / 365).toFixed(1)} years`;
}

/* ---------- the view ---------- */
export function listenBody(k) {
  kit = k;
  const j = J(), batch = todayBatch(), total = lib.tracks.length;
  const skipped = lib.tracks.filter((t) => j.skipped[t.id]).length;
  const heard = lib.tracks.filter((t) => j.rated[t.id]).length, goal = total - skipped, left = goal - heard;
  const pool = open(), tierNow = TIERS.findIndex((_, i) => pool.some((t) => tierOf(t) === i));
  const inTier = tierNow < 0 ? 0 : pool.filter((t) => tierOf(t) === tierNow).length;
  const isDone = (t) => j.rated[t.id] || j.skipped[t.id];
  const showing = batch.filter((t) => !isDone(t)), heardToday = batch.filter(isDone);
  const waiting = batch.filter((t) => !isDone(t)).length, done = batch.length - waiting;
  k.lists.batch = Object.assign(showing, { label: "Today's listening" });
  k.lists.today = Object.assign(heardToday, { label: "Heard today" });
  k.lists.last = Object.assign(batch.filter((t) => t.id === ui.last), { label: "Today's listening" });
  let shownAt = 0;   // a song you just scored shrinks to one line where its card was, until you score the next
  const cards = batch.map((t) => (!isDone(t) ? card(t, shownAt++, "batch") : t.id === ui.last ? lastLine(t) : "")).join("");

  return `<section class="ls-top">
      <div class="ls-prog"><b>${heard.toLocaleString()}<em>/${goal.toLocaleString()}</em></b><span>songs heard and scored</span>
        <i class="ls-bar"><u style="width:${goal ? ((heard / goal) * 100).toFixed(2) : 0}%"></u></i>
        <p>${tierNow < 0 ? "You've heard everything. Every single song." : `Now listening through songs <b>${TIERS[tierNow][2]}</b> · ${plural(inTier, "song")} left in this stretch.`}
          At ${j.perDay} a day you'll finish in about <b>${eta(Math.max(left, 0), j.perDay)}</b>.${streak() ? ` <b>${plural(streak(), "day")}</b> in a row.` : ""}</p>
        <div class="ls-kinds">${Object.entries(KINDS).map(([k, K]) => { const all = lib.tracks.filter((t) => !j.skipped[t.id] && kindOf(t) === k); const h = all.filter((t) => j.rated[t.id]).length;
          return `<span><b>${h.toLocaleString()}</b>/${all.length.toLocaleString()} ${K.many}</span>`; }).join("")}${skipped ? `<span><b>${skipped.toLocaleString()}</b> background, not ranked</span>` : ""}</div></div>
      <div class="ls-size"><span>songs a batch</span>${SIZES.map((n) => `<button class="${j.perDay === n ? "on" : ""}" data-act="ls-size" data-n="${n}">${n}</button>`).join("")}
        <input class="in" id="ls-perday" type="number" min="1" max="2000" step="1" value="${j.perDay}" aria-label="Songs per batch — any number" title="Any number you like" /></div>
    </section>
    <div class="ls-wrap">
      <section class="ls-main">
        <header class="ls-h"><div><h3>Today's listening</h3><p>${plural(done, "song")} heard today · ${waiting} waiting · shortest songs first</p></div>
          <div class="ls-hbtns">${waiting ? `<button class="btn ghost" data-act="ls-playall">▶ Play the ${waiting} waiting</button>` : ""}
            ${pool.length ? `<button class="btn" data-act="ls-more">Next batch · ${j.perDay}</button>` : ""}</div></header>
        ${cards}${showing.length ? "" : `<div class="ls-clear"><b>Batch done.</b> ${plural(done, "song")} heard today. ${pool.length ? `<button class="btn" data-act="ls-more">Next batch · ${j.perDay}</button>` : "That was everything."}</div>`}
        ${heardToday.length ? `<div class="ls-done"><button class="ls-link" data-act="ls-doneopen">${ui.doneOpen ? "Hide" : "Show"} heard today (${heardToday.length})</button>
          ${ui.doneOpen ? heardToday.map((t, i) => (t.id === ui.open ? card(t, i, "today", true) : compactRow(t, i, "today"))).join("") : ""}</div>` : ""}
        <p class="ls-keys">While a song plays: <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd> = 10 · <kbd>[</kbd> <kbd>]</kbd> −¼ / +¼ · <kbd>C</kbd> chills · <kbd>B</kbd> don't rank · <kbd>N</kbd> next song</p>
        <section class="ls-mine"><header class="ls-h"><div><h3>Your ratings</h3><p>${plural(heard, "song")} scored · reopen any of them to change your score</p></div>
          <div class="ls-tools"><select class="in" id="ls-mk"><option value="all">Every kind</option>${Object.entries(KINDS).map(([k, K]) => `<option value="${k}"${ui.mk === k ? " selected" : ""}>${K.many[0].toUpperCase() + K.many.slice(1)}</option>`).join("")}</select>
            <input class="in" id="ls-q" placeholder="Find a scored song…" value="${esc(ui.q)}" autocomplete="off" />
            <select class="in" id="ls-sort">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}"${ui.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div></header>
          <div id="ls-mine-list">${mineList()}</div></section>
      </section>
      <aside class="ls-side">${results(j)}</aside>
    </div>`;
}

/** Every scored song, filtered and sorted; the one you reopened shows as a full card. */
function mineList() {
  const j = J(), byId = new Map(lib.tracks.map((t) => [t.id, t])), words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = Object.entries(j.rated).map(([id, r]) => [byId.get(id), r]).filter(([t]) => t && (ui.mk === "all" || kindOf(t) === ui.mk) && (!words.length || words.every((w) => `${t.t} ${t.ar.join(" ")}`.toLowerCase().includes(w))));
  const by_ = { recent: (a, b) => (b[1].u || b[1].d || "").localeCompare(a[1].u || a[1].d || ""), high: (a, b) => b[1].s - a[1].s, low: (a, b) => a[1].s - b[1].s,
    chills: (a, b) => (b[1].c ? 1 : 0) - (a[1].c ? 1 : 0) || b[1].s - a[1].s }[ui.sort];
  list.sort(by_);
  let shown = list.slice(0, ui.cap);
  const opened = ui.open && list.find(([t]) => t.id === ui.open);
  if (opened && !shown.includes(opened)) shown = [opened, ...shown];   // a song reopened from "Most compelling" is always on screen
  kit.lists.mine = Object.assign(shown.map(([t]) => t), { label: "Your ratings" });
  if (!list.length) return `<p class="ls-empty">${words.length ? "No scored song matches that." : "Songs you score will gather here."}</p>`;
  return shown.map(([t], i) => (t.id === ui.open ? card(t, i, "mine", true) : compactRow(t, i, "mine"))).join("")
    + (list.length > shown.length ? `<button class="more" data-act="ls-cap">Show ${Math.min(40, list.length - shown.length)} more of ${list.length}</button>` : "");
}

/** What's left of the song you just scored: chills, feelings and a note are still one click away. */
function lastLine(t) {
  const j = J(), r = j.rated[t.id];
  if (j.skipped[t.id]) return `<div class="ls-last" data-id="${t.id}"><span>Not ranked <b>${esc(t.t)}</b></span><i>in Background pieces</i><button class="ls-link" data-act="ls-unskip" data-id="${t.id}">rank it after all</button></div>`;
  if (!r) return "";
  if (ui.lastOpen) return card(t, 0, "last", true);
  return `<div class="ls-last" data-id="${t.id}"><span>Scored <b>${esc(t.t)}</b></span><i>${fmtS(r.s)}${r.c ? " · chills" : ""}${r.f?.length ? ` · ${esc(r.f.join(", "))}` : ""}</i><button class="ls-link" data-act="ls-lastopen">add chills, feelings, a note</button></div>`;
}

function compactRow(t, i, l) {
  const j = J(), r = j.rated[t.id];
  return `<div class="ls-row" data-row="t:${t.id}">${art(t, i, l)}${meta(t, lib.roomById[t.r[0]])}
    ${r ? `<span class="ls-chip">${fmtS(r.s)}<i>${r.c ? "chills · " : ""}${KINDS[kindOf(t)].name.toLowerCase()}</i></span><button class="ls-link" data-act="ls-open" data-id="${t.id}">re-rate</button>`
      : `<span class="ls-tag">background · not ranked</span><button class="ls-link" data-act="ls-unskip" data-id="${t.id}">rank it after all</button>`}</div>`;
}

function card(t, i, l = "batch", reopened = false) {
  const j = J(), r = j.rated[t.id], room = lib.roomById[t.r[0]];
  const playing = now()?.id === t.id;
  return `<article class="ls-card${r ? " rated" : ""}${playing ? " now" : ""}${reopened ? " reopened" : ""}" data-row="t:${t.id}" data-id="${t.id}">
    <div class="ls-head">${art(t, i, l)}${meta(t, room)}
      <div class="ls-acts">${kindSwitch(t)}${reopened ? `<button class="ls-link" data-act="ls-open" data-id="">done</button>` : ""}<button class="ls-link" data-act="ls-skip" data-id="${t.id}" title="A background piece, not meant to be ranked: no score, out of the queue, still in your library and in Background pieces">don't rank</button>
        <button class="ls-link danger" data-act="ls-remove" data-id="${t.id}" title="Added by accident: take it out of the library">remove</button></div></div>
    <div class="ls-score" role="group" aria-label="${KINDS[kindOf(t)].ask}"><span>${KINDS[kindOf(t)].ask}</span>
      ${Array.from({ length: 11 }, (_, k) => `<button class="${r && Math.floor(r.s) === k ? "on" : ""}${r && k > 0 && r.s >= k ? " fill" : ""}" data-act="ls-score" data-id="${t.id}" data-s="${k}" aria-pressed="${!!r && Math.floor(r.s) === k}">${k}</button>`).join("")}
      <span class="ls-fine"><button data-act="ls-nudge" data-id="${t.id}" data-d="-${STEP}" ${r ? "" : "disabled"} title="−0.25" aria-label="Lower by a quarter">−¼</button><b>${r ? fmtS(r.s) : "—"}</b><button data-act="ls-nudge" data-id="${t.id}" data-d="${STEP}" ${r ? "" : "disabled"} title="+0.25" aria-label="Raise by a quarter">+¼</button></span></div>
    ${r ? `<div class="ls-more">
      <button class="ls-chills${r.c ? " on" : ""}" data-act="ls-chills" data-id="${t.id}" aria-pressed="${!!r.c}" title="Did it give you chills?">chills</button>
      ${ui.feel === t.id ? palette(t, r) : `<div class="ls-feel">${(r.f || []).map((f) => `<button class="on" data-act="ls-feel" data-id="${t.id}" data-f="${esc(f)}" data-tip="${esc(tip(f))} · click to remove">${esc(f)}</button>`).join("")}
        <button class="ls-link" data-act="ls-feelopen" data-id="${t.id}">${(r.f || []).length ? "edit feelings" : "+ feelings"}</button></div>`}
      <input class="in ls-note" data-ls-note="${t.id}" placeholder="where did it take you? (optional)" value="${esc(r.n || "")}" maxlength="200" /></div>` : ""}
  </article>`;
}
function kindSwitch(t) {
  const k = kindOf(t), set = !!J().kind?.[t.id];
  return `<div class="ls-kind" role="group" aria-label="What kind of piece is this?" title="${set ? "Set by you" : "A first guess from its genres and sound — click to change"}">${Object.entries(KINDS).map(([id, K]) =>
    `<button class="${k === id ? "on" : ""}" data-act="ls-kind" data-id="${t.id}" data-k="${id}" aria-pressed="${k === id}">${K.name}</button>`).join("")}</div>`;
}
function palette(t, r) {
  const on = new Set(r.f || []), own = yours();
  const chip = (f) => `<button class="${on.has(f) ? "on" : ""}" data-act="ls-feel" data-id="${t.id}" data-f="${esc(f)}" data-tip="${esc(tip(f))}" aria-description="${esc(DESC[f] || "")}">${esc(f)}</button>`;
  return `<div class="ls-palette">${[...FEEL_GROUPS, ...(own.length ? [["yours", own]] : [])].map(([g, l]) => `<div class="ls-fam"><span>${g}</span><div>${l.map(chip).join("")}</div></div>`).join("")}
    <div class="ls-fam"><span>add</span><div><input class="in ls-own" data-ls-own="${t.id}" placeholder="a feeling of your own… (Enter)" maxlength="30" />
      <button class="ls-link" data-act="ls-feelopen" data-id="">done</button></div></div></div>`;
}
const art = (t, i, l = "batch") => `<button class="ls-art" data-act="ls-play" data-l="${l}" data-i="${i}" title="Play">${t.c ? `<img src="${cover(t)}" alt="" loading="lazy" />` : ""}<i>▶</i></button>`;
const meta = (t, room) => `<div class="ls-meta"><b>${esc(t.t)}</b><em>${esc(by(t))}</em><span>${fmtLen(t)}${room ? ` · ${esc(room.name)}` : ""}${t.y ? ` · ${t.y}` : ""}</span></div>`;

/* ---------- what moves you ---------- */
function results(j) {
  const byId = new Map(lib.tracks.map((t) => [t.id, t]));
  const every = Object.entries(j.rated).map(([id, r]) => [byId.get(id), r]).filter(([t]) => t);
  const K = KINDS[ui.rk], rated = every.filter(([t]) => kindOf(t) === ui.rk);
  const tabs = `<div class="ls-rk" role="tablist">${Object.entries(KINDS).map(([k, k_]) => `<button role="tab" class="${ui.rk === k ? "on" : ""}" aria-selected="${ui.rk === k}" data-act="ls-rk" data-k="${k}">${k_.many}<em>${every.filter(([t]) => kindOf(t) === k).length}</em></button>`).join("")}</div>`;
  if (!rated.length) return `${tabs}<div class="ls-card ls-res"><h3>Your ${K.many}</h3><p>Score your first ${K.many} and this fills in: the most compelling ones, the rooms and feelings that land hardest, and how your scores spread.</p></div>${backgroundCard(j)}`;
  const best = [...rated].sort((a, b) => b[1].s - a[1].s || (b[1].c ? 1 : 0) - (a[1].c ? 1 : 0)).slice(0, 10);
  kit.lists.best = Object.assign(best.map(([t]) => t), { label: `Most compelling ${K.many}` });
  const dist = Array(11).fill(0); for (const [, r] of rated) dist[Math.min(10, Math.max(0, Math.floor(r.s)))]++;
  const dmax = Math.max(1, ...dist), chills = rated.filter(([, r]) => r.c).length;
  const avg = (list) => list.reduce((a, [, r]) => a + r.s, 0) / list.length;
  const rooms = lib.rooms.map((rm) => [rm, rated.filter(([t]) => t.r.includes(rm.id))]).filter(([, l]) => l.length >= 3).map(([rm, l]) => [rm.name, avg(l), l.length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const feels = [...new Set(rated.flatMap(([, r]) => r.f || []))].map((f) => [f, rated.filter(([, r]) => (r.f || []).includes(f))]).filter(([, l]) => l.length).map(([f, l]) => [f, l.length, avg(l)]).sort((a, b) => b[1] - a[1]);
  return `${tabs}<div class="ls-card ls-res"><h3>Your ${K.many}</h3>
      <p>${rated.length.toLocaleString()} ${rated.length === 1 ? K.name.toLowerCase() : K.many} scored · average <b>${avg(rated).toFixed(1)}</b> · <b>${chills}</b> gave you chills</p>
      <div class="ls-dist">${dist.map((n, i) => `<span data-tip="${i === 10 ? "10" : `${i}–${i}.75`}: ${plural(n, "song")}"><b style="height:${(n / dmax) * 100}%"></b><em>${i}</em></span>`).join("")}</div></div>
    <div class="ls-card ls-res"><h3>Most compelling ${K.many}</h3>
      ${best.map(([t, r], i) => `<div class="ls-best"><span class="ls-s">${fmtS(r.s)}${r.c ? "<i>chills</i>" : ""}</span>${kit.row(t, i, "best")}<button class="ls-link" data-act="ls-open" data-id="${t.id}" title="Change this score">re-rate</button></div>`).join("")}</div>
    ${rooms.length ? `<div class="ls-card ls-res"><h3>Rooms</h3><p>Average score of your ${K.many} in each room, three or more scored.</p>
      ${rooms.map(([n, a, c]) => `<div class="ls-bar2"><span>${esc(n)}</span><i><u style="width:${a * 10}%"></u></i><em>${a.toFixed(1)} · ${c}</em></div>`).join("")}</div>` : ""}
    ${feels.length ? `<div class="ls-card ls-res"><h3>Feelings</h3><p>How often you felt each one in your ${K.many}, and how high those score.</p>
      ${feels.slice(0, 16).map(([f, n, a]) => `<div class="ls-bar2" data-tip="${esc(tip(f))}"><span>${esc(f)}</span><i><u style="width:${a * 10}%"></u></i><em>${a.toFixed(1)} · ${n}</em></div>`).join("")}</div>` : ""}
    ${backgroundCard(j)}`;
}

/** Pieces you chose not to rank: playable as a set, and any can be ranked after all. Removed songs sit below. */
function backgroundCard(j) {
  const bg = lib.tracks.filter((t) => j.skipped[t.id]).sort((x, y) => (j.skipped[y.id] || "").localeCompare(j.skipped[x.id] || "")), gone = removedTracks();
  if (!bg.length && !gone.length) return "";
  kit.lists.bg = Object.assign(bg, { label: "Background pieces" });
  const shown = ui.gone ? bg.slice(0, ui.bgCap) : [];
  return `<div class="ls-card ls-res">${bg.length ? `<h3>Background pieces</h3><p>${plural(bg.length, "piece")} you heard and chose not to rank. No score, not in the rankings, still in your library.</p>
      <div class="ls-bg-acts"><button class="btn ghost sm" data-act="ls-playbg">▶ Play them</button><button class="ls-link" data-act="ls-gone">${ui.gone ? "hide" : "show"} list</button></div>` : ""}
      ${shown.length ? `<div class="ls-gone">${shown.map((t) => `<div><span>${esc(t.t)} <em>${esc(by(t))}</em></span><button class="ls-link" data-act="ls-unskip" data-id="${t.id}">rank it</button></div>`).join("")}
        ${bg.length > shown.length ? `<button class="more" data-act="ls-bgmore">Show more of ${bg.length}</button>` : ""}</div>` : ""}
      ${gone.length ? `<button class="ls-link ls-removed-t" data-act="ls-showgone">${ui.removed ? "hide" : "show"} removed (${gone.length})</button>
        ${ui.removed ? `<div class="ls-gone">${gone.map((t) => `<div><span>${esc(t.t)} <em>${esc(by(t))}</em></span><button class="ls-link" data-act="ls-restore" data-id="${t.id}">restore</button></div>`).join("")}</div>` : ""}` : ""}</div>`;
}

/* ---------- actions ---------- */
export function listenAct(b, { repaint, refresh = repaint }) {
  const j = J(), id = b.dataset.id;
  switch (b.dataset.act) {
    case "ls-size": j.perDay = +b.dataset.n; commit(); break;
    case "ls-play": { const l = kit.lists[b.dataset.l || "batch"]; return playQueue(l, +b.dataset.i, l.label); }
    case "ls-playall": { const q = kit.lists.batch.filter((t) => !j.rated[t.id] && !j.skipped[t.id]); return q.length && playQueue(q, 0, "Today's listening"); }
    case "ls-score": {
      const r = (j.rated[id] ||= { d: today() }), was = r.s;
      r.s = +b.dataset.s; r.d ||= today();
      if (was == null) { ui.last = id; ui.lastOpen = false; ui.feel = ""; } else ui.feel = id;   // first score: off to Your ratings
      if (was != null && was !== r.s) r.u = today();
      commit(); break;
    }
    case "ls-nudge": {
      const r = j.rated[id]; if (!r) return;
      r.s = Math.min(10, Math.max(0, Math.round((r.s + +b.dataset.d) / STEP) * STEP)); r.u = today();
      commit(); break;
    }
    case "ls-open": {
      ui.open = id || ""; ui.lastOpen = false; repaint();
      if (id) requestAnimationFrame(() => document.querySelector(`.ls-mine [data-row="t:${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    case "ls-lastopen": ui.lastOpen = true; ui.feel = ui.last; break;
    case "ls-cap": ui.cap += 40; break;
    case "ls-chills": { const r = j.rated[id]; if (r) { r.c = !r.c || undefined; commit(); } break; }
    case "ls-feel": { const r = j.rated[id]; if (r) { const f = b.dataset.f; r.f = (r.f || []).includes(f) ? r.f.filter((x) => x !== f) : [...(r.f || []), f]; commit(); } break; }
    case "ls-skip": {
      const was = j.rated[id];
      if (was && !confirm(`Stop ranking this piece? Your score of ${fmtS(was.s)}${was.f?.length || was.n ? ", feelings and note" : ""} will be cleared.`)) return;
      j.skipped[id] = today(); delete j.rated[id]; if (ui.feel === id) ui.feel = ""; if (ui.open === id) ui.open = "";
      ui.last = id; ui.lastOpen = false;
      commit(); toast("Not ranked — it's in your Background pieces"); break;
    }
    case "ls-unskip": {   // back to today's list, ready to score
      const d = today(); delete j.skipped[id]; if (ui.last === id) ui.last = "";
      if (!(j.days[d] || []).includes(id)) j.days[d] = [...(j.days[d] || []), id];
      commit(); toast("Back in today's listening"); break;
    }
    case "ls-playbg": return kit.lists.bg?.length && playQueue(shuffle(kit.lists.bg), 0, "Background pieces");
    case "ls-bgmore": ui.bgCap += 100; break;
    case "ls-showgone": ui.removed = !ui.removed; break;
    case "ls-remove": {
      const t = lib.tracks.find((x) => x.id === id);
      if (!t || !confirm(`Remove “${t.t}” by ${by(t)} from your library? Later imports will leave it out too. You can restore it from the Background pieces card.`)) return;
      removeTrack(id); toast("Removed from your library"); return refresh();   // the song count in the header changes too
    }
    case "ls-restore": restoreTrack(id); toast("Restored to your library"); return refresh();
    case "ls-kind": {
      const t = lib.tracks.find((x) => x.id === id), k = b.dataset.k, m = (j.kind ||= {});
      if (t && guessKind(t) === k) delete m[id]; else m[id] = k;   // only keep overrides
      commit(); break;
    }
    case "ls-rk": ui.rk = b.dataset.k; break;
    case "ls-feelopen": ui.feel = id || ""; break;
    case "ls-more": {   // what you've heard folds away; anything still waiting carries over
      const d = today(); ui.last = ""; ui.lastOpen = false; ui.feel = ""; ui.open = "";
      j.days[d] = [...(j.days[d] || []), ...draw(j.perDay, new Set(j.days[d]))]; commit();
      repaint(); return requestAnimationFrame(() => document.querySelector(".ls-main .ls-h")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
    case "ls-doneopen": ui.doneOpen = !ui.doneOpen; break;
    case "ls-gone": ui.gone = !ui.gone; break;
    default: return;
  }
  repaint();
}
export function listenAfter(root) {
  const q = root.querySelector("#ls-q"), so = root.querySelector("#ls-sort"), box = root.querySelector("#ls-mine-list");
  if (!q || !box) return;
  q.oninput = () => { ui.q = q.value; ui.cap = 20; box.innerHTML = mineList(); };
  const pd = root.querySelector("#ls-perday");
  if (pd) pd.onchange = () => { const n = Math.round(+pd.value); if (n >= 1) { J().perDay = Math.min(2000, n); commit(); kit.repaint(); } };
  const mk = root.querySelector("#ls-mk"); if (mk) mk.onchange = () => { ui.mk = mk.value; ui.cap = 20; box.innerHTML = mineList(); };
  so.onchange = () => { ui.sort = so.value; ui.cap = 20; box.innerHTML = mineList(); };
}
/** Enter in "a feeling of your own": tag this song with it and keep the word for every song after. */
export function listenOwn(input) {
  const f = input.value.trim().toLowerCase().replace(/\s+/g, " ");
  const r = J().rated[input.dataset.lsOwn];
  if (!f || !r) return;
  if (!FEELINGS.includes(f) && !yours().includes(f)) yours().push(f);
  if (!(r.f || []).includes(f)) r.f = [...(r.f || []), f];
  commit(); kit.repaint();
  requestAnimationFrame(() => document.querySelector(`[data-ls-own="${input.dataset.lsOwn}"]`)?.focus());
}
export function listenNote(input) {
  const r = J().rated[input.dataset.lsNote];
  if (r) { r.n = input.value.trim() || undefined; commit(); }
}

// highlight the song that's playing, and let the keyboard score it
onPlayer((t) => document.querySelectorAll(".ls-card").forEach((el) => el.classList.toggle("now", !!t && el.dataset.id === t.id)));
addEventListener("keydown", (e) => {
  if (!kit || !document.querySelector(".ls-wrap") || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = now(), j = J();
  if (!t || !((j.days[today()] || []).includes(t.id) || j.rated[t.id])) return;
  const fake = (act, extra = {}) => listenAct({ dataset: { act, id: t.id, ...extra } }, { repaint: kit.repaint });
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); fake("ls-score", { s: e.key === "0" ? "10" : e.key }); toast(`“${t.t}” · ${e.key === "0" ? 10 : e.key}`); }
  else if ((e.key === "[" || e.key === "-" || e.key === "]" || e.key === "=" || e.key === "+") && j.rated[t.id]) {
    e.preventDefault(); const d = e.key === "[" || e.key === "-" ? -STEP : STEP; fake("ls-nudge", { d: String(d) }); toast(`“${t.t}” · ${fmtS(J().rated[t.id].s)}`);
  }
  else if (e.key.toLowerCase() === "c" && j.rated[t.id]) fake("ls-chills");
  else if (e.key.toLowerCase() === "b" && !j.skipped[t.id]) fake("ls-skip");
  else if (e.key.toLowerCase() === "n") step(1);
});
