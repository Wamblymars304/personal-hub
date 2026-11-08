// Blogs & Links + Papers — the reading room. Same data and rules as blogs_tab.py:
// blogs[{id,label,url,tags,energyLevel,added,reviewAt,reviewInterval}], blogsPicked[ids] (the drawn pool),
// papers[{id,text,added}], papersPicks[ids] (currently reading), papersRead[{id,text,readAt}].
// Web-only, optional: blogsBatches[{date, ids, opened}] — each daily draw, so today's reading survives a reload
// and links you open from it count toward "reading over time".
import { db, commit, newId, today, parseTags } from "../store.js";
import { esc, fmtDate, plural, toast, empty } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";
import { shuffle, href, domainOf, hueOf, monogram, richPaper, rhythm, ICON } from "./blogs-bits.js";

const ENERGY = { any: ["Any energy", "var(--slate)"], "deep-focus": ["Deep focus", "var(--purple)"], background: ["Background", "var(--cyan)"], "palate-cleanser": ["Palate cleanser", "var(--pink)"] };
const CAP = 40;
const ui = { view: "blogs", energy: "all", q: "", pq: "", allBlogs: false, allPapers: false, showRead: false, batch: 5, paperN: 2, edit: null, editPaper: null, drew: false, picked: false };
let appRef = null;

const todayBatch = () => { const b = (db.blogsBatches || []).at(-1); return b && b.date === today() ? b : null; };
const longDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const motion = () => motionEnabled();

export default {
  id: "blogs", label: "Blogs & Links", color: "var(--purple)",
  count: () => db.blogs.length + db.papers.length,
  render(root, app, focus) {
    appRef = app;
    if (focus) { // arriving from search: open the right view and make sure the row is rendered
      const isPaper = db.papers.some((p) => p.id === focus) || db.papersRead.some((p) => p.id === focus);
      ui.view = isPaper ? "papers" : "blogs"; ui.edit = ui.editPaper = null;
      if (isPaper) { ui.allPapers = true; ui.showRead = true; ui.pq = ""; } else { ui.allBlogs = true; ui.energy = "all"; ui.q = ""; }
    }
    const withUrl = db.blogs.filter((b) => b.url).length;
    root.innerHTML = `<div class="page-h bl-head"><h1>Blogs &amp; Links</h1>
        <span class="sub">${plural(db.blogs.length, "link")} · ${plural(db.papers.length, "paper")} waiting · ${db.papersRead.length} read</span><span class="sp"></span>
        <div class="seg bl-seg" role="tablist"><button role="tab" aria-selected="${ui.view === "blogs"}" class="${ui.view === "blogs" ? "on" : ""}" data-act="view" data-v="blogs">Links<span class="n">${db.blogs.length}</span></button>
        <button role="tab" aria-selected="${ui.view === "papers"}" class="${ui.view === "papers" ? "on" : ""}" data-act="view" data-v="papers">Papers<span class="n">${db.papers.length}</span></button></div></div>
      ${ui.view === "blogs" ? blogsView(withUrl) : papersView()}`;
    wire(root, app);
    if (!motion()) { ui.drew = ui.picked = false; return; }
    if (app.entering) animate(root.querySelectorAll(".bl-in"), { opacity: [0, 1], translateY: [18, 0], delay: stagger(55), duration: 560, ease: "outBack(1.3)" });
    if (ui.drew) animate(root.querySelectorAll(".bl-slip"), { opacity: [0, 1], translateY: [-26, 0], rotate: [-4, 0], scale: [0.86, 1], delay: stagger(70), duration: 480, ease: "outBack(2.2)" });
    if (ui.picked) animate(root.querySelectorAll(".bl-sheet"), { opacity: [0, 1], translateX: [24, 0], delay: stagger(70), duration: 440, ease: "outBack(2)" });
    ui.drew = ui.picked = false;
  },
};

/* ───────────── Links ───────────── */
function blogsView(withUrl) {
  const counts = db.blogs.reduce((m, b) => ((m[b.energyLevel || "any"] = (m[b.energyLevel || "any"] || 0) + 1), m), {});
  return `
    <section class="card bl-today bl-in" id="bl-today">${todayHTML()}</section>
    <div class="bl-cols">
      <section class="card bl-lib bl-in">
        <header class="bl-lib-h"><div><span class="bl-k">the shelf</span><h3 class="bl-h">Every link you kept</h3>
            <p class="bl-s">${plural(db.blogs.length, "link")} · ${withUrl} with an address · ${db.blogsPicked.length} drawn this cycle</p></div>
          <input class="in bl-find" id="bq" type="search" placeholder="Search name, tags, URL…" value="${esc(ui.q)}" aria-label="Search links" autocomplete="off" /></header>
        <div class="chips bl-energy" id="bl-energy">${energyChips(counts)}</div>
        <div id="bl-list" class="bl-list">${blogList()}</div>
      </section>
      <aside class="stack bl-side">
        <section class="card bl-in"><header class="card-h"><div><span class="bl-k">new arrival</span><h3>Shelve a link</h3><p class="sub">It joins the pool for future draws.</p></div></header>
          <form class="card-b bl-form" id="addBlog">
            <input class="in" name="label" placeholder="Blog name or title" autocomplete="off" required aria-label="Name" />
            <input class="in" name="url" placeholder="https://…" autocomplete="off" aria-label="Address" />
            <div class="bl-form-2"><input class="in" name="tags" placeholder="tags, comma separated" aria-label="Tags" />
              <select class="in" name="energy" aria-label="Energy">${energyOpts("any")}</select></div>
            <button class="btn">Add to the shelf</button>
          </form></section>
        ${rhythmCard(false)}
      </aside>
    </div>`;
}

function energyChips(counts) {
  const c = (k, l, n) => `<button class="chip${ui.energy === k ? " on" : ""}" data-act="energy" data-e="${k}"${k !== "all" ? ` style="--dot:${ENERGY[k][1]}"` : ""}>${k !== "all" ? '<i class="dot"></i>' : ""}${l}<span class="bl-cn">${n}</span></button>`;
  return c("all", "All", db.blogs.length) + Object.entries(ENERGY).slice(1).map(([k, [l]]) => c(k, l, counts[k] || 0)).join("");
}
const energyOpts = (sel) => Object.entries(ENERGY).map(([k, [l]]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");

function todayHTML() {
  const b = todayBatch(), total = db.blogs.length;
  const ids = new Set(db.blogs.map((x) => x.id));
  const drawn = db.blogsPicked.filter((id) => ids.has(id)).length, left = total - drawn;
  const items = b ? b.ids.map((id) => db.blogs.find((x) => x.id === id)).filter(Boolean) : [];
  const opened = new Set(b?.opened || []);
  const nOpen = items.filter((x) => opened.has(x.id)).length;
  const title = !b ? "Nothing drawn yet today" : !items.length ? "Today's draw left the shelf" : nOpen === items.length ? "All read. The room is quiet." : `${items.length === 1 ? "One link" : `${["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][items.length] || items.length} links`} drawn for today`;
  return `<div class="bl-today-h">
      <div><span class="bl-k">today's reading · ${esc(longDate())}</span><h2>${title}</h2>
        <p class="bl-s">${b && items.length ? `${nOpen} of ${items.length} read · ` : ""}${drawn} drawn · ${left} left in the pool${left === 0 ? " — the next draw starts a fresh cycle" : ""}</p>
        <div class="bl-pool" role="img" aria-label="${drawn} of ${total} drawn this cycle"><i style="--v:${total ? (drawn / total).toFixed(3) : 0}"></i></div></div>
      <div class="bl-draw"><label class="bl-k" for="batchN">draw</label><input class="in" type="number" id="batchN" min="1" max="50" value="${ui.batch}" />
        <button class="btn" data-act="batch">${b ? "Draw again" : "Draw today's reading"}</button></div></div>
    ${items.length ? `<div class="bl-slips">${items.map((x) => slip(x, opened.has(x.id))).join("")}</div>`
      : `<p class="bl-invite">${b ? "Draw again to pick a fresh set." : `A few links, chosen at random from the ${left || total} you haven't drawn yet. Read one, or all of them.`}</p>`}`;
}

function slip(x, read) {
  const d = domainOf(x.url);
  return `<article class="bl-slip${read ? " read" : ""}" data-row="t-${x.id}" style="--h:${hueOf(x.label, x.url)}">
    ${monogram(x.label, x.url, "lg")}
    <div class="bl-slip-t">${x.url ? `<a href="${esc(href(x.url))}" target="_blank" rel="noopener" data-open="${x.id}">${esc(x.label)}</a>` : `<b>${esc(x.label)}</b>`}
      <small>${esc(d || "no address yet")}</small>
      ${(x.tags || []).length ? `<span class="bl-tags">${x.tags.slice(0, 3).map((t) => `<span>#${esc(t)}</span>`).join("")}</span>` : ""}</div>
    <button class="bl-tick${read ? " on" : ""}" data-act="opened" data-id="${x.id}" aria-pressed="${read}" title="${read ? "Read — click to undo" : "Mark as read"}">${ICON.check}<span>${read ? "read" : "mark read"}</span></button>
  </article>`;
}

function blogList() {
  const q = ui.q.trim().toLowerCase();
  const picked = new Set(db.blogsPicked);
  const list = db.blogs.filter((b) => (ui.energy === "all" || b.energyLevel === ui.energy) &&
    (!q || `${b.label} ${(b.tags || []).join(" ")} ${b.url}`.toLowerCase().includes(q))).reverse();
  if (!list.length) return empty(q ? `Nothing on the shelf matches “${esc(ui.q)}”.` : "No links here yet.");
  const open = ui.allBlogs || !!q, shown = open ? list : list.slice(0, CAP);
  return shown.map((b) => (ui.edit === b.id ? blogEdit(b) : blogRow(b, picked.has(b.id)))).join("") +
    (list.length > CAP && !q ? `<button class="more" data-act="toggle-cap" data-key="blogs">${open ? "Show less" : `Show all ${list.length}`}</button>` : "");
}

function blogRow(b, picked) {
  const [elabel, ecolor] = ENERGY[b.energyLevel] || ENERGY.any, d = domainOf(b.url);
  return `<div class="bl-row" data-row="${b.id}">
    ${monogram(b.label, b.url)}
    <div class="bl-t">${b.url ? `<a href="${esc(href(b.url))}" target="_blank" rel="noopener">${esc(b.label)}</a>` : `<b>${esc(b.label)}</b>`}<small>${esc(d || "no address")}</small></div>
    ${(b.tags || []).length ? `<span class="bl-tags">${b.tags.slice(0, 4).map((t) => `<span>#${esc(t)}</span>`).join("")}</span>` : ""}
    ${b.energyLevel && b.energyLevel !== "any" ? `<span class="badge" style="--c:${ecolor}">${elabel}</span>` : ""}
    ${picked ? `<span class="bl-drawn" title="Already drawn this cycle">drawn</span>` : ""}
    <span class="bl-d">${fmtDate(b.added)}</span>
    <span class="acts"><button class="bl-ic" data-act="edit-blog" data-id="${b.id}" aria-label="Edit ${esc(b.label)}">${ICON.edit}</button><button class="x" data-act="del-blog" data-id="${b.id}" aria-label="Delete ${esc(b.label)}">×</button></span></div>`;
}

function blogEdit(b) {
  return `<form class="bl-row bl-edit" data-row="${b.id}" data-edit="blog" data-id="${b.id}">
    ${monogram(b.label, b.url)}
    <div class="bl-edit-f">
      <input class="in" name="label" value="${esc(b.label)}" required aria-label="Name" />
      <input class="in" name="url" value="${esc(b.url)}" placeholder="https://…" aria-label="Address" />
      <input class="in" name="tags" value="${esc((b.tags || []).join(", "))}" placeholder="tags" aria-label="Tags" />
      <select class="in" name="energy" aria-label="Energy">${energyOpts(b.energyLevel || "any")}</select>
    </div>
    <div class="bl-edit-a"><button class="btn sm">Save</button><button type="button" class="btn ghost sm" data-act="cancel-edit">Cancel</button></div>
  </form>`;
}

/* ───────────── Papers ───────────── */
function papersView() {
  const byId = new Map(db.papers.map((p) => [p.id, p]));
  const reading = db.papersPicks.map((id) => byId.get(id)).filter(Boolean);
  return `
    <form class="addbar bl-in bl-padd" id="addPaper">
      <span class="bl-k">add to the stack</span>
      <input class="in grow" name="text" placeholder="Paste a paper reference, title, DOI or link…" autocomplete="off" required aria-label="Paper reference" />
      <button class="btn">Add to library</button>
      <button class="btn ghost" type="button" data-act="import">Import .txt</button>
      <input type="file" id="paperFile" accept=".txt,text/plain" hidden />
    </form>
    <div class="bl-cols bl-cols-p">
      <section class="card bl-lib bl-in">
        <header class="bl-lib-h"><div><span class="bl-k">the stack</span><h3 class="bl-h">Papers waiting to be read</h3>
            <p class="bl-s" id="pl-sub">${plural(db.papers.length, "paper")} in the library</p></div>
          <input class="in bl-find" id="pq" type="search" placeholder="Search papers…" value="${esc(ui.pq)}" aria-label="Search papers" autocomplete="off" /></header>
        <div id="pl-list" class="bl-list">${paperList()}</div>
      </section>
      <aside class="stack bl-side">
        <section class="card bl-desk bl-in"><header class="card-h"><div><span class="bl-k">on the desk</span><h3>Currently reading</h3>
            <p class="sub">${reading.length ? plural(reading.length, "paper") : "Nothing yet — draw a few at random"}</p></div></header>
          <div class="card-b">
            ${reading.map((p) => `<div class="bl-sheet" data-row="r-${p.id}">
                <button class="bl-tick" data-act="read" data-id="${p.id}" title="Mark read">${ICON.check}<span>read</span></button>
                <p>${richPaper(p.text)}</p>
                <button class="x" data-act="unpick" data-id="${p.id}" aria-label="Take off the desk" title="Take off the desk">×</button></div>`).join("")}
            <div class="bl-draw sm"><label class="bl-k" for="paperN">draw</label><input class="in" type="number" id="paperN" min="1" max="50" value="${ui.paperN}" />
              <button class="btn grow" data-act="pick-papers">Pick at random</button>${reading.length ? `<button class="btn ghost" data-act="clear-picks">Clear</button>` : ""}</div>
          </div></section>
        ${rhythmCard(true)}
      </aside>
    </div>`;
}

function paperList() {
  const q = ui.pq.trim().toLowerCase(), picks = new Set(db.papersPicks);
  const lib = db.papers.filter((p) => !q || p.text.toLowerCase().includes(q));
  if (!lib.length) return empty(q ? `No papers match “${esc(ui.pq)}”.` : "The library is empty.");
  const open = ui.allPapers || !!q, shown = open ? lib : lib.slice(0, CAP);
  return shown.map((p) => (ui.editPaper === p.id ? `<form class="bl-prow bl-edit" data-row="${p.id}" data-edit="paper" data-id="${p.id}">
        <textarea class="in" name="text" rows="3" required aria-label="Paper text">${esc(p.text)}</textarea>
        <div class="bl-edit-a"><button class="btn sm">Save</button><button type="button" class="btn ghost sm" data-act="cancel-edit">Cancel</button></div></form>`
    : `<div class="bl-prow${picks.has(p.id) ? " on" : ""}" data-row="${p.id}">
        <p class="bl-pt">${richPaper(p.text)}</p>
        ${picks.has(p.id) ? `<span class="bl-reading">on the desk</span>` : ""}
        <span class="bl-d">${fmtDate(p.added)}</span>
        <span class="acts">${picks.has(p.id) ? "" : `<button class="bl-ic" data-act="pick-one" data-id="${p.id}" aria-label="Put on the desk" title="Put on the desk">${ICON.plus}</button>`}
          <button class="bl-ic" data-act="edit-paper" data-id="${p.id}" aria-label="Edit paper" title="Edit">${ICON.edit}</button>
          <button class="x" data-act="del-paper" data-id="${p.id}" aria-label="Delete paper" title="Delete">×</button></span></div>`)).join("") +
    (lib.length > CAP && !q ? `<button class="more" data-act="toggle-cap" data-key="papers">${open ? "Show less" : `Show all ${lib.length}`}</button>` : "");
}

function rhythmCard(withLog) {
  const r = rhythm(db), opened = (db.blogsBatches || []).reduce((n, b) => n + (b.opened || []).length, 0);
  const log = [...db.papersRead].reverse(), shown = ui.showRead ? log : log.slice(0, 5);
  return `<section class="card bl-in bl-rhythm"><header class="card-h"><div><span class="bl-k">reading over time</span><h3>Shelved vs. read</h3>
      <p class="sub">${r.shelved} shelved · ${db.papersRead.length} papers read · ${plural(opened, "link")} read from your draws</p></div></header>
    <div class="card-b">${r.html}<div class="bl-legend"><span class="bl-up">shelved</span><span class="bl-dn">read</span></div>
    ${withLog ? `<div class="bl-log"><div class="bl-k">read log · ${db.papersRead.length}</div>
      ${shown.map((p) => `<div class="bl-rrow" data-row="${p.id}"><p>${richPaper(p.text)}</p><span class="bl-d">${fmtDate(p.readAt)}</span></div>`).join("") || empty("Nothing read yet — the desk is waiting.")}
      ${log.length > 5 ? `<button class="more" data-act="show-read">${ui.showRead ? "Show less" : `Show all ${log.length}`}</button>` : ""}</div>` : ""}
    </div></section>`;
}

/* ───────────── events ───────────── */
function outro(el, done) {
  if (!el || !motion()) return done();
  animate(el, { scale: [1, 1.04, 0.92], opacity: [1, 1, 0], duration: 300, ease: "inQuad", onComplete: done });
}

function wire(root, app) {
  const rerender = () => app.refresh();
  const list = () => { const el = root.querySelector("#bl-list"); if (el) el.innerHTML = blogList(); const pl = root.querySelector("#pl-list"); if (pl) pl.innerHTML = paperList(); };
  const focusEdit = () => requestAnimationFrame(() => { const i = root.querySelector("[data-edit] [name=label], [data-edit] [name=text]"); i?.focus(); i?.select?.(); });

  root.oninput = (e) => {
    if (e.target.id === "bq") { ui.q = e.target.value; root.querySelector("#bl-list").innerHTML = blogList(); }
    if (e.target.id === "pq") { ui.pq = e.target.value; root.querySelector("#pl-list").innerHTML = paperList(); }
  };
  root.onchange = async (e) => {
    const t = e.target;
    if (t.id === "batchN") ui.batch = Math.min(50, Math.max(1, +t.value || 1));
    if (t.id === "paperN") ui.paperN = Math.min(50, Math.max(1, +t.value || 1));
    if (t.id === "paperFile") {
      const f = t.files[0]; if (!f) return;
      const existing = new Set(db.papers.map((p) => p.text));
      let added = 0;
      for (const line of (await f.text()).split(/\r?\n/)) {
        const s = line.trim();
        if (s && !existing.has(s)) { db.papers.push({ id: newId(), text: s, added: today() }); existing.add(s); added++; }
      }
      commit(); rerender(); toast(`Imported ${plural(added, "new paper")}`);
    }
  };
  root.onsubmit = (e) => {
    e.preventDefault();
    const form = e.target, f = new FormData(form);
    if (form.id === "addBlog") {
      const label = f.get("label").trim(); if (!label) return;
      db.blogs.push({ id: newId(), label, url: f.get("url").trim(), tags: parseTags(f.get("tags")), energyLevel: f.get("energy"), added: today(), reviewAt: null, reviewInterval: null });
      commit(); rerender(); root.querySelector("#addBlog [name=label]").focus(); toast("Shelved");
    } else if (form.id === "addPaper") {
      const text = f.get("text").trim(); if (!text) return;
      db.papers.push({ id: newId(), text, added: today() });
      commit(); rerender(); root.querySelector("#addPaper [name=text]").focus(); toast("Paper added");
    } else if (form.dataset.edit === "blog") {
      const b = db.blogs.find((x) => x.id === form.dataset.id), label = f.get("label").trim();
      if (!b || !label) return;
      Object.assign(b, { label, url: f.get("url").trim(), tags: parseTags(f.get("tags")), energyLevel: f.get("energy") });
      ui.edit = null; commit(); rerender(); toast("Saved");
      root.querySelector(`[data-row="${b.id}"] .bl-ic`)?.focus();
    } else if (form.dataset.edit === "paper") {
      const p = db.papers.find((x) => x.id === form.dataset.id), text = f.get("text").trim();
      if (!p || !text) return;
      p.text = text; ui.editPaper = null; commit(); rerender(); toast("Saved");
    }
  };
  root.onkeydown = (e) => {
    const form = e.target.closest?.("[data-edit]");
    if (!form) return;
    if (e.key === "Escape") { e.preventDefault(); ui.edit = ui.editPaper = null; list(); }
    if (e.key === "Enter" && e.target.tagName === "TEXTAREA" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  };

  root.onclick = (e) => {
    const a = e.target.closest("a[data-open]");
    if (a) { // opening a link from today's draw counts as reading it
      const b = todayBatch();
      if (b && !(b.opened ||= []).includes(a.dataset.open)) { b.opened.push(a.dataset.open); commit(); setTimeout(rerender, 120); }
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    switch (btn.dataset.act) {
      case "view": ui.view = btn.dataset.v; ui.edit = ui.editPaper = null; return rerender();
      case "energy": ui.energy = btn.dataset.e; root.querySelectorAll("#bl-energy .chip").forEach((c) => c.classList.toggle("on", c === btn)); return list();
      case "toggle-cap": btn.dataset.key === "blogs" ? (ui.allBlogs = !ui.allBlogs) : (ui.allPapers = !ui.allPapers); return list();
      case "show-read": ui.showRead = !ui.showRead; return rerender();
      case "import": return root.querySelector("#paperFile").click();
      case "edit-blog": ui.edit = id; list(); return focusEdit();
      case "edit-paper": ui.editPaper = id; list(); return focusEdit();
      case "cancel-edit": ui.edit = ui.editPaper = null; return list();
      case "opened": {
        const b = todayBatch(); if (!b) return;
        b.opened ||= [];
        b.opened = b.opened.includes(id) ? b.opened.filter((x) => x !== id) : b.opened.concat(id);
        commit(); return rerender();
      }
      case "batch": { // blogs_tab._on_pick: random from not-yet-picked; resets the pool when everything was picked
        let picked = db.blogsPicked, available = db.blogs.filter((x) => !picked.includes(x.id));
        if (!available.length) { picked = []; available = [...db.blogs]; }
        if (!available.length) return toast("Shelve a link first");
        const sel = shuffle(available).slice(0, Math.min(ui.batch, available.length));
        db.blogsPicked = picked.concat(sel.map((x) => x.id));
        (db.blogsBatches ||= []).push({ date: today(), ids: sel.map((x) => x.id), opened: [] });
        ui.drew = true;
        break;
      }
      case "del-blog": {
        const x = db.blogs.find((y) => y.id === id);
        if (!x || !confirm(`Delete “${x.label}”?`)) return;
        db.blogs = db.blogs.filter((y) => y.id !== id);
        db.blogsPicked = db.blogsPicked.filter((y) => y !== id);
        break;
      }
      case "pick-papers": {
        const avail = db.papers.filter((p) => !db.papersPicks.includes(p.id));
        if (!avail.length) return toast("No unread papers left to pick");
        const chosen = shuffle(avail).slice(0, Math.min(ui.paperN, avail.length));
        db.papersPicks = db.papersPicks.concat(chosen.map((p) => p.id));
        toast(`Added ${plural(chosen.length, "paper")} to your reading list`);
        ui.picked = true;
        break;
      }
      case "pick-one": if (!db.papersPicks.includes(id)) db.papersPicks = db.papersPicks.concat(id); toast("On the desk"); break;
      case "clear-picks": db.papersPicks = []; break;
      case "unpick": db.papersPicks = db.papersPicks.filter((p) => p !== id); break;
      case "read": { // moves the paper from the library to papersRead
        return outro(btn.closest(".bl-sheet"), () => {
          const p = db.papers.find((x) => x.id === id);
          if (p) { db.papersRead.push({ id, text: p.text, readAt: today() }); db.papers = db.papers.filter((x) => x.id !== id); toast("Marked as read"); }
          db.papersPicks = db.papersPicks.filter((x) => x !== id);
          commit(); appRef.refresh();
        });
      }
      case "del-paper": {
        const p = db.papers.find((x) => x.id === id);
        if (!p || !confirm("Delete this paper from your library?")) return;
        db.papers = db.papers.filter((x) => x.id !== id);
        db.papersPicks = db.papersPicks.filter((x) => x !== id);
        break;
      }
      default: return;
    }
    commit(); rerender();
  };
}
