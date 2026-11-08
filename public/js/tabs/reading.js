// Reading — the Books side of Media, plus the card every media item opens: cover or poster, your stars,
// status, review, moods, subjects, a link to the author's room in the Gallery, Open Library — and an
// "Edit details" form (title, category, minutes). Year in reading and the map of what you read
// (subjects from Open Library + your StoryGraph moods, sized by how many books share them). Used by media.js.
import { db, commit } from "../store.js";
import { esc, fmtDate, plural, toast, empty } from "../ui.js";
import { CATEGORIES, statusOf, setStatus, toggleDone, toggleQueue, isQueued, deleteItem, editItem } from "./media-ops.js";
import { art, catOf, poster, stars } from "./media-posters.js";
export { statusOf, setStatus, stars };

let galleryArtists = null;
fetch("/api/gallery").then((r) => r.json()).then((g) => (galleryArtists = g.map((a) => a.artist))).catch(() => (galleryArtists = []));
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();
/** Gallery rooms whose artist wrote or drew this book */
export function galleryRoomsFor(m) {
  const people = (m.author || "").split(",").map(norm).filter(Boolean);
  return (galleryArtists || []).filter((a) => people.some((p) => p === norm(a) || p.split(" ").at(-1) === norm(a).split(" ").at(-1) && p.split(" ")[0][0] === norm(a)[0]));
}
export const STATUSES = { "to-read": "To read", "currently-reading": "Reading", read: "Read", "did-not-finish": "Did not finish" };
const lower = (t) => !!t && t === t.toLowerCase();

/* ---------- the card (every media item: books, manga, and the poster categories) ---------- */
let cardKey = null;
export function openCard(m, app, { first = true } = {}) {
  document.querySelector(".book-modal")?.remove();
  if (cardKey) removeEventListener("keydown", cardKey);
  cardKey = null;
  if (!db.media.includes(m)) return;
  const rooms = galleryRoomsFor(m), s = statusOf(m), isBook = m.category === "Book", c = catOf(m.category);
  const subjects = cleanSubjects(m.subjects || []).slice(0, 14), qpos = db.mediaQueue.indexOf(m.id) + 1;
  const cats = CATEGORIES.includes(m.category) ? CATEGORIES : [...CATEGORIES, m.category];
  const by = isBook || m.author ? [m.author, m.year, m.pages ? `${m.pages} pages` : ""]
    : [m.timeEstimate ? `${m.timeEstimate} min` : "", m.added_date ? `on your list since ${fmtDate(m.added_date, { year: true })}` : ""];
  document.body.insertAdjacentHTML("beforeend", `<div class="book-modal md-modal" role="dialog" aria-modal="true" aria-label="${esc(m.title)}"><div class="bm-card" style="--c:${c.color}">
    <button class="vx" data-bm="close" aria-label="Close">×</button>
    <div class="bm-cover"><div class="md-art bm-art">${art(m, { lazy: false, qpos })}</div>
      <div class="bm-acts"><button class="btn ghost sm${qpos ? " on" : ""}" data-bm="queue">${qpos ? "On Up next — remove" : "Add to Up next"}</button><button class="btn ghost sm bm-del" data-bm="del">Delete</button></div></div>
    <div class="bm-info">
      <span class="kicker">${esc(m.category)}${m.format ? " · " + esc(m.format) : ""}${m.jp ? " · " + esc(m.jp) : ""}</span>
      <h2 class="${lower(m.title) ? "lc" : ""}">${esc(m.title)}</h2><p class="by">${by.filter(Boolean).map(esc).join(" · ")}</p>
      <div class="bm-stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button data-bm="rate" data-n="${n}" class="${(m.rating || 0) >= n ? "on" : (m.rating || 0) >= n - 0.5 ? "half" : ""}" aria-label="${n} stars">★</button>`).join("")}
        <span class="tag">${m.rating ? m.rating + " / 5" : "not rated"}</span></div>
      <div class="bm-status">${isBook ? Object.entries(STATUSES).map(([k, l]) => `<button class="chip${s === k ? " on" : ""}" data-bm="status" data-s="${k}">${l}</button>`).join("")
        : `<button class="chip${m.done ? "" : " on"}" data-bm="done" data-v="0">Not yet</button><button class="chip${m.done ? " on" : ""}" data-bm="done" data-v="1">${c.verb}</button>`}</div>
      <dl>${[["added", fmtDate(m.storygraphAdded || m.added_date)], ["finished", m.done && !m.dnf ? fmtDate(m.completedAt) : ""], ["read", m.readCount > 1 ? `${m.readCount} times` : ""],
        ["up next", qpos ? `#${qpos} in the queue` : ""], ["pace", m.pace], ["driven by", m.plotOrCharacter], ["owned", m.owned ? "yes" : ""]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${(m.moods || []).length ? `<div class="bm-chips">${m.moods.map((x) => `<span class="mood">${esc(x)}</span>`).join("")}</div>` : ""}
      ${m.review ? `<blockquote class="bm-review">${esc(m.review).replace(/\n/g, "<br>")}</blockquote>` : ""}
      ${subjects.length ? `<div class="bm-chips subj">${subjects.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
      ${rooms.length ? `<p class="bm-gallery">In your Gallery: ${rooms.map((a) => `<a href="#" data-bm="room" data-a="${esc(a)}">${esc(a)}</a>`).join(", ")}</p>` : ""}
      ${m.olKey || m.isbn || m.source === "storygraph" ? `<p class="bm-links">${[m.olKey ? `<a href="https://openlibrary.org${esc(m.olKey)}" target="_blank" rel="noopener">Open Library</a>` : "", m.isbn ? `ISBN ${esc(m.isbn)}` : "", m.source === "storygraph" ? "from StoryGraph" : ""].filter(Boolean).join(" · ")}</p>` : ""}
      <details class="bm-edit"${!isBook && !m.cover ? " open" : ""}><summary>Edit details</summary>
        <form class="bm-form"><label class="t"><span>Title</span><input class="in" name="title" value="${esc(m.title)}" required autocomplete="off" /></label>
          <label><span>Category</span><select class="in" name="category">${cats.map((x) => `<option${x === m.category ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
          <label><span>Minutes</span><input class="in" type="number" name="minutes" min="0" step="5" value="${+m.timeEstimate || 0}" /></label>
          <button class="btn sm">Save</button></form></details>
    </div></div></div>`);
  const el = document.querySelector(".book-modal");
  const close = () => { el.remove(); removeEventListener("keydown", onKey); cardKey = null; app.refresh(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", (cardKey = onKey));
  if (first) el.querySelector(".vx").focus({ preventScroll: true });
  el.querySelector(".bm-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    editItem(m, { title: f.get("title"), category: f.get("category"), minutes: f.get("minutes") });
    commit(); toast("Saved"); openCard(m, app, { first: false });
  };
  el.onclick = (e) => {
    const b = e.target.closest("[data-bm]");
    if (!b) { if (e.target === el) close(); return; }
    e.preventDefault();
    switch (b.dataset.bm) {
      case "close": return close();
      case "rate": m.rating = m.rating === +b.dataset.n ? null : +b.dataset.n; break;
      case "status": setStatus(m, b.dataset.s); if (b.dataset.s === "read") toast(`Finished “${m.title}”`); break;
      case "done": if (!!+b.dataset.v === !!m.done) return; if (toggleDone(m)) toast(`Finished “${m.title}”`); break;
      case "queue": toast(toggleQueue(m) ? "Added to Up next" : "Taken off Up next"); break;
      case "del": if (!confirm(`Delete “${m.title}”?`)) return; deleteItem(m); commit(); return close();
      case "room": el.remove(); removeEventListener("keydown", onKey); cardKey = null; return app.go("gallery", "room:" + b.dataset.a);
      default: return;
    }
    commit(); openCard(m, app, { first: false });
  };
}

/* ---------- subjects: Open Library's tags, minus the library bookkeeping ---------- */
const NOISE = /(accessible book|protected daisy|in library|lending library|large type|internet archive|nyt:|new york times|open library|staff picks|long now|overdrive|reading level|award|bestseller|translations? into|english (language|fiction)|^fiction$|^nonfiction$|general$|^\d|juvenile|readers|textbooks|ebooks?|^books?$|^literature$|collections?|anthologies)/i;
const titleish = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase());
export function cleanSubjects(list) {
  const seen = new Set(), out = [];
  for (const raw of list) {
    const s = raw.split(/\s*[-—,(]\s*/)[0].trim();
    const k = s.toLowerCase().replace(/s$/, "");
    if (!s || s.length > 32 || NOISE.test(s) || seen.has(k)) continue;
    seen.add(k); out.push(titleish(s));
  }
  return out;
}

/* ---------- Year in reading ---------- */
export function yearView(books) {
  const read = books.filter((m) => statusOf(m) === "read" && m.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const rated = read.filter((m) => m.rating);
  const favs = books.filter((m) => (m.rating || 0) >= 4.5).sort((a, b) => b.rating - a.rating);
  const years = [...new Set(read.map((m) => m.completedAt.slice(0, 4)))];
  const moods = (list) => Object.entries(list.flatMap((m) => m.moods || []).reduce((c, x) => ((c[x] = (c[x] || 0) + 1), c), {})).sort((a, b) => b[1] - a[1]);
  const subjectsOf = (list) => Object.entries(list.flatMap((m) => cleanSubjects(m.subjects || []).slice(0, 8)).reduce((c, x) => ((c[x] = (c[x] || 0) + 1), c), {})).sort((a, b) => b[1] - a[1]);
  const pages = (list) => list.reduce((s, m) => s + (+m.pages || 0), 0);
  const avg = (list) => (list.length ? (list.reduce((s, m) => s + m.rating, 0) / list.length).toFixed(1) : "–");
  const strip = (list) => `<div class="cover-strip">${list.map((m) => `<button class="md-cs" data-act="card" data-id="${m.id}" title="${esc(m.title)}${m.rating ? " · " + m.rating + "★" : ""}">${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" />` : poster(m)}</button>`).join("")}</div>`;
  const maxYear = Math.max(1, ...years.map((y) => read.filter((m) => m.completedAt.startsWith(y)).length));
  return `<div class="ry-tiles">
      <div class="tile" style="--c:var(--purple)"><span class="lbl">Books read</span><span class="val">${read.length}</span><span class="sub">${books.filter((m) => statusOf(m) === "did-not-finish").length} not finished</span></div>
      <div class="tile" style="--c:var(--cyan)"><span class="lbl">Pages read</span><span class="val">${pages(read).toLocaleString()}</span><span class="sub">where Open Library knows the length</span></div>
      <div class="tile" style="--c:var(--amber)"><span class="lbl">Average rating</span><span class="val">${avg(rated)}<small>★</small></span><span class="sub">${plural(rated.length, "book")} rated</span></div>
      <div class="tile" style="--c:var(--green)"><span class="lbl">Still to read</span><span class="val">${books.filter((m) => statusOf(m) === "to-read").length}</span><span class="sub">${books.filter((m) => m.owned && statusOf(m) === "to-read").length} already on your shelf</span></div></div>
    ${favs.length ? `<section class="card ry-sec"><header class="panel-h"><h3>Favourites</h3><p class="sub">4½★ and up</p></header><div class="panel-b">${strip(favs)}</div></section>` : ""}
    ${years.map((y) => {
      const list = read.filter((m) => m.completedAt.startsWith(y)), ms = moods(list).slice(0, 5), ss = subjectsOf(list).slice(0, 6);
      return `<section class="card ry-sec"><header class="panel-h"><h3 class="ry-year">${y}</h3>
          <p class="sub">${plural(list.length, "book")}${pages(list) ? ` · ${pages(list).toLocaleString()} pages` : ""}${list.some((m) => m.rating) ? ` · ${avg(list.filter((m) => m.rating))}★ average` : ""}</p>
          <div class="r"><i class="ry-bar" style="width:${(list.length / maxYear) * 160}px"></i></div></header>
        <div class="panel-b">${strip(list)}${ms.length || ss.length ? `<p class="ry-tags">${ms.map(([x, n]) => `<span class="mood">${esc(x)} ${n}</span>`).join("")}${ss.map(([x, n]) => `<span>${esc(x)} ${n}</span>`).join("")}</p>` : ""}</div></section>`;
    }).join("") || empty("No finished books with dates yet.")}`;
}

/* ---------- the map: subjects and moods as a constellation ---------- */
export function mapView(books, ui) {
  const pool = ui.mapScope === "all" ? books : books.filter((m) => ["read", "currently-reading", "did-not-finish"].includes(statusOf(m)));
  const tally = new Map();
  for (const m of pool) {
    for (const s of cleanSubjects(m.subjects || []).slice(0, 10)) (tally.get("s:" + s) || tally.set("s:" + s, { key: "s:" + s, label: s, kind: "subject", ids: [] }).get("s:" + s)).ids.push(m.id);
    for (const s of m.moods || []) (tally.get("m:" + s) || tally.set("m:" + s, { key: "m:" + s, label: s, kind: "mood", ids: [] }).get("m:" + s)).ids.push(m.id);
  }
  const nodes = [...tally.values()].filter((n) => n.ids.length >= (ui.mapScope === "all" ? 6 : 2)).sort((a, b) => b.ids.length - a.ids.length).slice(0, 44);
  if (nodes.length < 3) return empty(pool.length ? "Not enough subjects yet — the Open Library lookup may still be running." : "No books here yet.");
  const links = [];
  nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => { const w = a.ids.filter((id) => b.ids.includes(id)).length; if (w >= (ui.mapScope === "all" ? 3 : 1)) links.push({ a, b, w }); }));
  const max = nodes[0].ids.length;
  layout(nodes, links);
  const sel = nodes.find((n) => n.key === ui.mapSel);
  const near = new Set(sel ? links.filter((l) => l.a === sel || l.b === sel).flatMap((l) => [l.a.key, l.b.key]) : []);
  const color = (n) => (n.kind === "mood" ? "var(--pink)" : "var(--cyan)");
  const picked = sel ? books.filter((m) => sel.ids.includes(m.id)) : [];
  return `<div class="toolbar"><div class="seg"><button class="${ui.mapScope !== "all" ? "on" : ""}" data-act="mapscope" data-s="read">What you've read</button><button class="${ui.mapScope === "all" ? "on" : ""}" data-act="mapscope" data-s="all">Everything, incl. to-read</button></div>
      <span class="tag">${plural(pool.length, "book")} · <span style="color:var(--cyan)">●</span> subjects (Open Library) · <span style="color:var(--pink)">●</span> your moods (StoryGraph)</span></div>
    <section class="card atlas book-map"><svg viewBox="0 0 900 540" role="img" aria-label="Map of the subjects and moods of your books">
      ${links.map((l) => `<line x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}" class="lk${sel && (l.a === sel || l.b === sel) ? " hot" : ""}" style="stroke-width:${0.5 + Math.min(4, l.w * 0.5)}"/>`).join("")}
      ${nodes.map((n) => `<g class="star${sel ? (n === sel ? " sel" : near.has(n.key) ? " near" : " dim") : ""}" data-act="mapsel" data-k="${esc(n.key)}" style="--c:${color(n)}">
        <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r * 2.1).toFixed(1)}" class="halo"/><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" class="core"/>
        <text x="${(n.x + n.r + 5).toFixed(1)}" y="${(n.y + 4).toFixed(1)}">${esc(n.label)}<tspan dx="4">${n.ids.length}</tspan></text></g>`).join("")}</svg></section>
    ${sel ? `<section class="card ry-sec"><header class="panel-h"><h3>${esc(sel.label)}</h3><p class="sub">${plural(sel.ids.length, "book")}</p><div class="r"><button class="btn ghost sm" data-act="mapsel" data-k="">Clear</button></div></header>
      <div class="panel-b"><div class="cover-strip wrap">${picked.map((m) => `<button class="md-cs" data-act="card" data-id="${m.id}" title="${esc(m.title)}">${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" />` : poster(m)}</button>`).join("")}</div></div></section>` : ""}`;
  function layout(ns, ls, W = 900, H = 540) {
    ns.forEach((n, i) => { const a = i * 2.399, r = 40 + i * 5.5; n.x = W / 2 + Math.cos(a) * r; n.y = H / 2 + Math.sin(a) * r * 0.62; n.vx = n.vy = 0; n.r = 4 + Math.sqrt(n.ids.length / max) * 13; });
    for (let it = 0; it < 320; it++) {
      const k = 1 - it / 320;
      for (const a of ns) for (const b of ns) { if (a === b) continue; const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01, f = 3800 / d2, d = Math.sqrt(d2); a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
      for (const { a, b, w } of ls) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 120) * 0.004 * Math.min(3, w); a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      for (const n of ns) { n.vx += (W / 2 - n.x) * 0.006; n.vy += (H / 2 - n.y) * 0.009; n.x += Math.max(-12, Math.min(12, n.vx * k)); n.y += Math.max(-12, Math.min(12, n.vy * k)); n.vx *= 0.5; n.vy *= 0.5; n.x = Math.max(30, Math.min(W - 170, n.x)); n.y = Math.max(20, Math.min(H - 20, n.y)); }
    }
    const box = (n) => ({ x0: n.x - n.r, x1: n.x + n.r + 10 + n.label.length * 6.4 + 16, y0: n.y - Math.max(n.r, 9), y1: n.y + Math.max(n.r, 9) });
    for (let it = 0; it < 220; it++) {
      let moved = false;
      for (const a of ns) for (const b of ns) {
        if (a === b) continue;
        const A = box(a), B = box(b), ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox <= 0 || oy <= 0) continue;
        const dir = a.y < b.y || (a.y === b.y && a.x < b.x) ? -1 : 1, push = Math.min(oy + 2, 6) / 2;
        a.y = Math.max(16, Math.min(H - 16, a.y + dir * push)); b.y = Math.max(16, Math.min(H - 16, b.y - dir * push)); moved = true;
      }
      if (!moved) break;
    }
  }
}
