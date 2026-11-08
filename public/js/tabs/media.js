// Media — now showing. Same data and rules as media_tab.py (add, randomize into the queue, mark done → logs to
// mediaConsumed), rebuilt as a cinema front page: a "now showing" marquee for Up next with the reel (the
// randomizer) and your latest ticket stubs, then one rail per category — covers for Books and Manga,
// typographic posters for everything else (media-posters.js). A category opens as a full wall; Books keep
// Shelf / Year in reading / Map (reading.js). Every item opens a card where it can be rated and edited.
// Typing in the finder only redraws #md-body; lists are capped with "show more".
import { db, commit, newId, today, formatDuration, parseDate } from "../store.js";
import { esc, fmtDate, chip, empty, plural, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";
import { openCard, yearView, mapView, statusOf, STATUSES } from "./reading.js";
import { CATEGORIES, toggleDone, toggleQueue, deleteItem, roll, rollPool } from "./media-ops.js";
import { catOf, tile, art, poster, icon } from "./media-posters.js";

const ui = { cat: "All", q: "", showDone: false, closed: new Set(), randCat: "All Categories", randN: 1, lastCat: "TV Show",
  bookView: "shelf", bookStatus: "all", bookSort: "added", sort: "added", mapScope: "read", mapSel: "", limit: 0 };
const RAIL = 16, SMALL = 5, FOUND = 14, PAGE = 72, BOOK_PAGE = 120;

const addedOf = (m) => m.storygraphAdded || m.added_date || "";
const BOOK_SORTS = { added: ["Recently added", (a, b) => addedOf(b).localeCompare(addedOf(a))],
  rating: ["Your rating", (a, b) => (b.rating || 0) - (a.rating || 0)], title: ["Title", (a, b) => a.title.localeCompare(b.title)], year: ["Year published", (a, b) => (b.year || 0) - (a.year || 0)] };
const SORTS = { added: ["Recently added", (a, b) => (b.added_date || "").localeCompare(a.added_date || "")], title: ["Title A–Z", (a, b) => a.title.localeCompare(b.title)],
  short: ["Shortest first", (a, b) => (+a.timeEstimate || 1e9) - (+b.timeEstimate || 1e9)], long: ["Longest first", (a, b) => (+b.timeEstimate || 0) - (+a.timeEstimate || 0)] };
const BOOK_RANK = { "currently-reading": 0, "to-read": 1, read: 2, "did-not-finish": 3 };

/* ---------- derived data, computed once per render ---------- */
let ctx = null;
function context() {
  const rev = [...db.media].reverse();   // newest first, so stable sorts keep same-day additions newest-first
  const byCat = new Map(), byId = new Map();
  for (const m of rev) { byId.set(m.id, m); (byCat.get(m.category) || byCat.set(m.category, []).get(m.category)).push(m); }
  const cats = [...CATEGORIES.filter((c) => byCat.has(c)), ...[...byCat.keys()].filter((c) => !CATEGORIES.includes(c))];
  const queue = db.mediaQueue.map((id) => byId.get(id)).filter(Boolean);
  return { byCat, byId, cats, queue, qpos: new Map(db.mediaQueue.map((id, i) => [id, i + 1])) };
}
const hayCache = new WeakMap();   // lower-cased search text per item (never stored on the item itself)
const hay = (m) => { let h = hayCache.get(m); if (!h || h.t !== m.title) hayCache.set(m, (h = { t: m.title, s: `${m.title} ${m.author || ""} ${m.jp || ""}`.toLowerCase() })); return h.s; };
const words = () => ui.q.toLowerCase().split(/\s+/).filter(Boolean);
const hit = (m, w) => !w.length || w.every((x) => hay(m).includes(x));
const shown = (m) => ui.showDone || !m.done;
const inCat = (c) => ctx.byCat.get(c) || [];
/** Minutes still to watch — only when at least a third of the unfinished items have a runtime, so it means something */
function runtime(list) {
  const open = list.filter((m) => !m.done), timed = open.filter((m) => +m.timeEstimate > 0);
  return timed.length * 3 >= open.length ? timed.reduce((s, m) => s + +m.timeEstimate, 0) : 0;
}
const hours = (min) => (min >= 120 ? `${Math.round(min / 60)}h` : formatDuration(min));
const lower = (t) => !!t && t === t.toLowerCase();
const T = (m) => tile(m, ctx.qpos.get(m.id) || 0);

/** The list a category page shows (also used to make sure a searched-for item is on the first page) */
function viewList(w = words()) {
  if (ui.cat === "Book") return inCat("Book").filter((m) => (ui.bookStatus === "all" || statusOf(m) === ui.bookStatus) && hit(m, w)).sort(BOOK_SORTS[ui.bookSort][1]);
  return inCat(ui.cat).filter((m) => shown(m) && hit(m, w)).sort((SORTS[ui.sort] || SORTS.added)[1]);
}
function curated(cat, list) {
  if (cat === "Book") return [...list].sort((a, b) => (BOOK_RANK[statusOf(a)] ?? 1) - (BOOK_RANK[statusOf(b)] ?? 1) || addedOf(b).localeCompare(addedOf(a)));
  return [...list].sort((a, b) => !!a.done - !!b.done || (b.added_date || "").localeCompare(a.added_date || ""));
}

/* ---------- now showing: Up next, the reel, the stubs ---------- */
const ticket = (m) => `<button class="md-tk" data-act="card" data-id="${m.id}" style="--c:${catOf(m.category).color}" title="${esc(m.title)}">
  <span class="md-art mini">${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" />` : poster(m)}</span>
  <span class="md-tk-t"><b class="${lower(m.title) ? "lc" : ""}" data-spin>${esc(m.title)}</b><small>${esc(m.category)}${m.timeEstimate ? " · " + formatDuration(m.timeEstimate) : ""}</small></span></button>`;

function reel(compact) {
  const open = (c) => inCat(c).filter((m) => !m.done).length;
  return `${compact ? "" : `<div class="md-reel-h"><h3>Roll the reel</h3><p class="sub">Random picks replace Up next. The Schedule can drag them onto days.</p></div>`}
    <div class="md-reel-row"><select class="in" id="rcat" aria-label="Pick from"><option>All Categories</option>${CATEGORIES.map((c) => `<option value="${c}"${c === ui.randCat ? " selected" : ""}>${c} (${open(c)})</option>`).join("")}</select>
      ${compact ? "" : `</div><div class="md-reel-row">`}<label class="tag md-howmany">pick <input class="in md-n" type="number" id="rn" min="1" max="20" value="${ui.randN}" aria-label="How many to pick" /></label>
      <button class="btn md-roll" data-act="rand">Roll</button>
      ${compact && ctx.queue.length ? `<button class="btn ghost sm" data-act="clearq" title="Empty Up next">Clear</button>` : ""}</div>`;
}

function stubs() {
  const list = [...db.mediaConsumed].sort((a, b) => (b.consumedAt || "").localeCompare(a.consumedAt || "")).slice(0, 4);
  const y0 = new Date().getFullYear();
  return `<div class="md-stubs"><div class="md-stubs-h"><span class="md-k">recently consumed</span><span class="tag">${db.mediaConsumed.length} all time</span></div>
    ${list.map((c) => {
      const d = parseDate(c.consumedAt), live = ctx.byId.has(c.id);
      const inner = `<span class="md-sd"><small>${d ? d.toLocaleDateString("en-US", { month: "short" }) : ""}</small><b>${d ? d.getDate() : "–"}</b></span>
        <span class="md-st"><b>${esc(c.title)}</b><small>${esc(c.category)}${d && d.getFullYear() !== y0 ? ` · ${d.getFullYear()}` : ""}</small></span>`;
      return live ? `<button class="md-stub" data-act="card" data-id="${c.id}" style="--c:${catOf(c.category).color}">${inner}</button>` : `<div class="md-stub" style="--c:${catOf(c.category).color}">${inner}</div>`;
    }).join("") || empty("Nothing finished yet.")}</div>`;
}

function hero() {
  const [f, ...rest] = ctx.queue, c = f && catOf(f.category);
  const feature = f ? `<div class="md-feature">
      <button class="md-art md-feature-art" data-act="card" data-id="${f.id}" aria-label="${esc(f.title)} — open">${art(f, { lazy: false })}</button>
      <div class="md-fi">
        <span class="md-k">${esc(f.category)}${f.timeEstimate ? " · " + formatDuration(f.timeEstimate) : ""}${statusOf(f) === "currently-reading" ? " · reading now" : ""}</span>
        <h2 class="md-ft${lower(f.title) ? " lc" : ""}" data-spin>${esc(f.title)}</h2>
        <p class="md-fm">${esc([f.author, f.year].filter(Boolean).join(" · ") || (f.added_date ? `on your list since ${fmtDate(f.added_date, { year: true })}` : ""))}</p>
        <div class="md-fa"><button class="btn" data-act="done" data-id="${f.id}">${icon("check")} Finished</button><button class="btn ghost" data-act="unq" data-id="${f.id}">Not tonight</button><button class="btn ghost" data-act="card" data-id="${f.id}">Details</button></div>
      </div></div>`
    : `<div class="md-dark"><i class="md-beam" aria-hidden="true"></i><p class="md-dark-t">The screen is dark.</p><p class="tag">Roll the reel to pick something, or press the ticket on anything below to queue it.</p></div>`;
  return `<section class="card md-hero" id="md-hero"${ui.q.trim() ? " hidden" : ""}>
    <div class="md-screen" style="--c:${c ? c.color : "var(--accent)"}"><i class="md-bulbs" aria-hidden="true"></i>
      <div class="md-sh"><span class="md-k">now showing</span><span class="tag">${ctx.queue.length ? `${plural(ctx.queue.length, "thing")} on Up next` : "Up next is empty"}</span>
        ${ctx.queue.length ? `<span class="sp"></span><button class="linkish md-clear" data-act="clearq">clear the queue</button>` : ""}</div>
      ${feature}
      ${rest.length ? `<div class="md-then"><span class="md-k">then</span>${rest.map(ticket).join("")}</div>` : ""}
    </div>
    <aside class="md-reel">${reel(false)}${stubs()}</aside></section>`;
}
function strip() {
  const q = ctx.queue;
  return `<div class="card md-strip" id="md-strip"><span class="md-k">now showing</span>
    <div class="md-strip-q">${q.length ? q.map(ticket).join("") : `<span class="tag">Up next is empty.</span>`}</div>
    <span class="sp"></span>${reel(true)}</div>`;
}

/* ---------- the body: front page, search results, a category wall, the book views ---------- */
function rail(key, list) {
  const misc = key === "misc", c = misc ? null : catOf(key), closed = ui.closed.has(key);
  const waiting = list.filter((m) => !m.done).length, mins = runtime(list);
  const reading = key === "Book" ? list.filter((m) => statusOf(m) === "currently-reading").length : 0;
  const sub = misc ? [...new Set(list.map((m) => m.category))].join(" · ")
    : [`${waiting} waiting`, ui.showDone && list.length > waiting ? `${list.length - waiting} finished` : "", reading ? `${reading} reading now` : "", mins ? `≈ ${hours(mins)} of runtime` : ""].filter(Boolean).join(" · ");
  return `<section class="card md-sec" style="--c:${c ? c.color : "var(--accent)"}">
    <header class="md-rh"><button class="md-fold${closed ? " closed" : ""}" data-act="fold" data-cat="${esc(key)}" aria-expanded="${!closed}"><span class="car">▾</span><h3>${esc(misc ? "Odds & ends" : c.plural)}</h3></button>
      <span class="md-rs">${esc(sub)}</span><span class="sp"></span>
      ${closed || list.length < 7 ? "" : `<button class="md-nb" data-act="rail" data-k="${esc(key)}" data-d="-1" aria-label="Scroll back">‹</button><button class="md-nb" data-act="rail" data-k="${esc(key)}" data-d="1" aria-label="Scroll on">›</button>`}
      ${misc ? "" : `<button class="btn ghost sm" data-act="cat" data-cat="${esc(key)}">See all ${list.length} →</button>`}</header>
    ${closed ? "" : `<div class="md-rail" data-rail="${esc(key)}">${list.slice(0, RAIL).map(T).join("")}${list.length > RAIL ? `<button class="md-seeall" data-act="cat" data-cat="${esc(key)}"><b>+${list.length - RAIL}</b>more ${esc(c.plural.toLowerCase())}<br>→</button>` : ""}</div>`}</section>`;
}
function front() {
  const secs = [], misc = [];
  for (const c of ctx.cats) {
    const list = curated(c, inCat(c).filter(shown));
    if (!list.length) continue;
    if (list.length < SMALL && c !== "Book" && c !== "Manga") misc.push(...list); else secs.push(rail(c, list));
  }
  if (misc.length) secs.push(rail("misc", misc));
  return secs.join("") || empty("Nothing here yet — add a title above.");
}
const doneHint = (n) => (n && !ui.showDone ? `<p class="md-hint">${plural(n, "finished title")} also ${n === 1 ? "matches" : "match"} — <button class="linkish" data-act="showdone">show done</button></p>` : "");
function results(w) {
  const groups = ctx.cats.map((c) => [c, inCat(c).filter((m) => shown(m) && hit(m, w))]).filter(([, l]) => l.length);
  const n = groups.reduce((s, [, l]) => s + l.length, 0), hidden = ui.showDone ? 0 : db.media.filter((m) => m.done && hit(m, w)).length;
  if (!n) return empty(`Nothing matches “${esc(ui.q.trim())}”.`) + doneHint(hidden);
  const starts = (m) => (m.title.toLowerCase().startsWith(w[0]) ? 0 : 1);
  return `<p class="md-found">${n} ${n === 1 ? "match" : "matches"} for “${esc(ui.q.trim())}”</p>${doneHint(hidden)}` + groups.map(([c, l]) => {
    const k = catOf(c);
    return `<section class="card md-sec" style="--c:${k.color}"><header class="md-rh"><h3>${esc(k.plural)}</h3><span class="md-rs">${l.length}</span><span class="sp"></span>
      ${l.length > FOUND ? `<button class="btn ghost sm" data-act="cat" data-cat="${esc(c)}">See all ${l.length} →</button>` : ""}</header>
      <div class="md-grid">${[...l].sort((a, b) => starts(a) - starts(b)).slice(0, FOUND).map(T).join("")}</div></section>`;
  }).join("");
}
function wall(list, page) {
  const lim = Math.max(ui.limit, page);
  return `<div class="md-grid">${list.slice(0, lim).map(T).join("")}</div>`
    + (list.length > lim ? `<button class="more md-morebtn" data-act="more" data-p="${page}">Show ${Math.min(page, list.length - lim)} more · ${list.length - lim} left</button>` : "");
}
function catView(w) {
  const all = inCat(ui.cat), c = catOf(ui.cat), list = viewList(w);
  const waiting = all.filter((m) => !m.done).length, fin = all.length - waiting, mins = runtime(all);
  const hidden = w.length && !ui.showDone ? all.filter((m) => m.done && hit(m, w)).length : 0;
  return `<section class="card md-sec md-wall" style="--c:${c.color}"><header class="md-ch"><h2>${esc(c.plural)}</h2>
      <p>${[`${waiting} waiting`, fin ? `${fin} ${c.verb.toLowerCase()}` : "", mins ? `≈ ${hours(mins)} of runtime` : "", w.length ? `${list.length} shown` : ""].filter(Boolean).join(" · ")}</p></header>
    ${list.length ? wall(list, PAGE) : empty(w.length ? `Nothing in ${esc(c.plural)} matches “${esc(ui.q.trim())}”.` : ui.showDone ? "Nothing here yet — add a title above." : `Nothing waiting — everything here is ${c.verb.toLowerCase()}.`)}${doneHint(hidden)}</section>`;
}
function shelf(w) {
  const all = inCat("Book"), list = viewList(w), n = (s) => all.filter((m) => statusOf(m) === s).length;
  return `<section class="card md-sec md-wall" style="--c:${catOf("Book").color}"><header class="md-ch"><h2>${ui.bookStatus === "all" ? "Books" : esc(STATUSES[ui.bookStatus])}</h2>
      <p>${all.length} on the shelf · ${n("read")} read · ${n("currently-reading")} reading now${w.length ? ` · ${list.length} shown` : ""}</p></header>
    ${list.length ? wall(list, BOOK_PAGE) : empty(w.length ? `No book matches “${esc(ui.q.trim())}”.` : "No books here.")}</section>`;
}
function body() {
  const w = words();
  if (ui.cat === "All") return w.length ? results(w) : front();
  if (ui.cat === "Book") return ui.bookView === "year" ? yearView(inCat("Book")) : ui.bookView === "map" ? mapView(inCat("Book"), ui) : shelf(w);
  return catView(w);
}
function paintBody(root) {
  const b = root.querySelector("#md-body");
  if (!b) return;
  b.innerHTML = body();
  const h = root.querySelector("#md-hero");
  if (h) h.hidden = !!ui.q.trim();
}

/* ---------- motion ---------- */
const pop = (el, from = 1.18) => el && motionEnabled() && animate(el, { scale: [from, 1], duration: 420, ease: "outBack(2.4)" });
function enter(root) {
  if (!motionEnabled()) return;
  const tiles = root.querySelectorAll(".md-rail > *:nth-child(-n+9), .md-grid > *:nth-child(-n+28)");
  if (tiles.length) animate(tiles, { opacity: [0, 1], translateY: [18, 0], scale: [0.9, 1], delay: stagger(16, { start: 160 }), duration: 560, ease: "outBack(1.6)" });
  const fa = root.querySelector(".md-feature-art");
  if (fa) animate(fa, { scale: [0.7, 1], rotate: [-9, -2], opacity: [0, 1], duration: 700, delay: 120, ease: "outBack(2)" });
}
/** The reel spins: titles and the feature poster flicker through random picks, then land with a bounce. */
function spin(root, pool) {
  if (!motionEnabled() || pool.length < 2) return;
  const box = root.querySelector("#md-hero .md-screen, #md-strip");
  box?.classList.remove("rolled"); void box?.offsetWidth; box?.classList.add("rolled");
  const rnd = () => pool[(Math.random() * pool.length) | 0];
  const fa = root.querySelector(".md-feature-art"), finalArt = fa?.innerHTML;
  const els = [...root.querySelectorAll("[data-spin]")], finals = els.map((el) => el.textContent);
  let n = 0;
  const end = 9 + els.length * 2;
  const t = setInterval(() => {
    n++;
    els.forEach((el, i) => { if (n < 7 + i * 2) el.textContent = rnd().title; else if (el.textContent !== finals[i]) { el.textContent = finals[i]; pop(el.closest(".md-tk") || el, 1.25); } });
    if (fa) { if (n < 9) fa.innerHTML = poster(rnd()); else if (n === 9) { fa.innerHTML = finalArt; pop(fa, 1.3); } }
    if (n >= end) clearInterval(t);
  }, 60);
}

/* ---------- the tab ---------- */
function render(root, app, focus) {
  ctx = context();
  const f = focus && ctx.byId.get(focus);
  if (f) {   // search: open the item's own wall, with it on the first page
    Object.assign(ui, { cat: f.category, q: "", limit: 0 });
    if (f.category === "Book") Object.assign(ui, { bookView: "shelf", bookStatus: "all" });
    else if (f.done) ui.showDone = true;
    const i = viewList([]).indexOf(f), page = f.category === "Book" ? BOOK_PAGE : PAGE;
    if (i >= page) ui.limit = Math.ceil((i + 1) / page) * page;
  }
  if (ui.cat !== "All" && !ctx.byCat.has(ui.cat)) ui.cat = "All";
  const bookMode = ui.cat === "Book";
  const scroll = {};
  root.querySelectorAll("[data-rail]").forEach((r) => (scroll[r.dataset.rail] = r.scrollLeft));
  const waiting = db.media.filter((m) => !m.done).length;

  root.innerHTML = `<div class="md-page${motionEnabled() ? "" : " md-still"}">
    <div class="page-h"><h1>Media</h1><span class="sub">${plural(waiting, "thing")} waiting · ${db.mediaConsumed.length} consumed all time</span><span class="sp"></span>
      <input class="in md-find" id="mq" type="search" placeholder="Find a title or author…" value="${esc(ui.q)}" autocomplete="off" aria-label="Find a title or author" /></div>

    <form class="addbar md-add" id="add">
      <input class="in grow" name="title" placeholder="Add a title…" autocomplete="off" required aria-label="Title" />
      <select class="in" name="category" aria-label="Category">${CATEGORIES.map((c) => `<option${c === ui.lastCat ? " selected" : ""}>${c}</option>`).join("")}</select>
      <label class="tag">min <input class="in md-n" type="number" name="minutes" min="0" step="5" value="0" aria-label="Minutes" /></label>
      <button class="btn">Add</button>
    </form>

    <div class="toolbar md-nav">
      <div class="chips">${chip(`All <span class="tag">${db.media.filter(shown).length}</span>`, ui.cat === "All", 'data-act="cat" data-cat="All"')}
        ${ctx.cats.map((c) => chip(`<i class="dot" style="--dot:${catOf(c).color}"></i>${esc(c)} <span class="tag">${inCat(c).filter(shown).length}</span>`, ui.cat === c, `data-act="cat" data-cat="${esc(c)}"`)).join("")}</div>
      <span class="grow"></span>
      ${bookMode ? "" : chip(ui.showDone ? "Hide done" : "Show done", ui.showDone, 'data-act="showdone"')}
      ${!bookMode && ui.cat !== "All" ? `<select class="in" id="msort" aria-label="Sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${ui.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select>` : ""}
    </div>
    ${bookMode ? `<div class="toolbar book-bar md-bookbar"><div class="seg">${[["shelf", "Shelf"], ["year", "Year in reading"], ["map", "Map"]].map(([v, l]) => `<button class="${ui.bookView === v ? "on" : ""}" data-act="bookview" data-v="${v}">${l}</button>`).join("")}</div>
      ${ui.bookView === "shelf" ? `<div class="chips">${[["all", "All"], ...Object.entries(STATUSES)].map(([k, l]) => chip(`${l} <span class="tag">${inCat("Book").filter((m) => k === "all" || statusOf(m) === k).length}</span>`, ui.bookStatus === k, `data-act="bookstatus" data-s="${k}"`)).join("")}</div>
        <span class="grow"></span><select class="in" id="bsort" aria-label="Sort books">${Object.entries(BOOK_SORTS).map(([k, [l]]) => `<option value="${k}"${ui.bookSort === k ? " selected" : ""}>${l}</option>`).join("")}</select>` : ""}</div>` : ""}

    ${ui.cat === "All" ? hero() : strip()}
    <div id="md-body">${body()}</div></div>`;

  root.querySelectorAll("[data-rail]").forEach((r) => { if (scroll[r.dataset.rail]) r.scrollLeft = scroll[r.dataset.rail]; });
  if (app.entering) enter(root);

  const redraw = () => render(root, app);
  root.querySelector("#add").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), title = String(fd.get("title") || "").trim();
    if (!title) return;
    ui.lastCat = fd.get("category");
    const m = { id: newId(), title, category: ui.lastCat, added_date: today(), timeEstimate: +fd.get("minutes") || 0, done: false, completedAt: "" };
    db.media.push(m);
    commit(); app.refresh();
    root.querySelector("#add [name=title]")?.focus();
    toast(`Added to ${ui.lastCat}`);
    const t = root.querySelector(`[data-row="${m.id}"]`);
    if (t) { t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1800); }
  };
  root.querySelector("#mq").oninput = (e) => { ui.q = e.target.value; ui.limit = 0; paintBody(root); };
  root.querySelector("#bsort")?.addEventListener("change", (e) => { ui.bookSort = e.target.value; ui.limit = 0; paintBody(root); });
  root.querySelector("#msort")?.addEventListener("change", (e) => { ui.sort = e.target.value; ui.limit = 0; paintBody(root); });
  root.querySelector("#rcat").onchange = (e) => (ui.randCat = e.target.value);
  root.querySelector("#rn").onchange = (e) => (ui.randN = Math.max(1, Math.min(20, +e.target.value || 1)));
  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.dataset.id, m = id && ctx.byId.get(id);
    switch (b.dataset.act) {
      case "card": if (m) openCard(m, app); return;
      case "bookview": ui.bookView = b.dataset.v; ui.limit = 0; return redraw();
      case "bookstatus": ui.bookStatus = b.dataset.s; ui.limit = 0; return redraw();
      case "mapscope": ui.mapScope = b.dataset.s; ui.mapSel = ""; return paintBody(root);
      case "mapsel": ui.mapSel = ui.mapSel === b.dataset.k ? "" : b.dataset.k; return paintBody(root);
      case "cat": Object.assign(ui, { cat: b.dataset.cat, limit: 0 }); redraw(); return scrollTo({ top: 0 });
      case "fold": ui.closed.has(b.dataset.cat) ? ui.closed.delete(b.dataset.cat) : ui.closed.add(b.dataset.cat); return redraw();
      case "showdone": ui.showDone = !ui.showDone; return redraw();
      case "more": ui.limit = Math.max(ui.limit, +b.dataset.p) + +b.dataset.p; return paintBody(root);
      case "rail": { const r = root.querySelector(`[data-rail="${CSS.escape(b.dataset.k)}"]`); return r?.scrollBy({ left: +b.dataset.d * r.clientWidth * 0.8, behavior: motionEnabled() ? "smooth" : "auto" }); }
      case "done": {
        if (!m) return;
        const fin = toggleDone(m);
        commit(); app.refresh();
        if (fin) { toast(`Finished “${m.title}”`); pop(root.querySelector(`[data-row="${m.id}"] .md-stamp, [data-row="${m.id}"] .mc-rib`), 2.2); }
        return;
      }
      case "queue": case "unq":
        if (!m) return;
        if (b.dataset.act === "unq") db.mediaQueue = db.mediaQueue.filter((q) => q !== m.id); else toggleQueue(m);
        commit(); app.refresh();
        toast(db.mediaQueue.includes(m.id) ? `“${m.title}” is on Up next` : "Taken off Up next");
        if (db.mediaQueue.includes(m.id)) pop(root.querySelector(`[data-row="${m.id}"] .md-qb`), 1.8);
        return;
      case "del":
        if (!m || !confirm(`Delete “${m.title}”?`)) return;
        deleteItem(m); commit(); return app.refresh();
      case "rand": {
        const pool = rollPool(ui.randCat), picks = roll(ui.randCat, ui.randN);
        if (!picks.length) return toast("Nothing unfinished to pick from");
        commit(); app.refresh(); spin(root, pool);
        return toast(`Picked ${plural(picks.length, "thing")} for Up next`);
      }
      case "clearq": db.mediaQueue = []; commit(); return app.refresh();
    }
  };
}

export default {
  id: "media", label: "Media", color: "var(--pink)",
  count: () => db.media.filter((m) => !m.done).length,
  render,
};
