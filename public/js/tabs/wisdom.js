// Wisdom — same data and rules as wisdom_tab.py: Entries / Timeline / DNA views, filters, core flag,
// related entries, and the add form (title, content, type, category, tags, source, importance, why).
import { db, commit, newId, today, parseTags } from "../store.js";
import { esc, fmtDate, chip, empty, plural, toast } from "../ui.js";

const CATEGORIES = ["Philosophy", "Psychology", "Productivity", "Finance", "Economics", "Physics", "Health", "Relationships", "Other"];
const TYPES = ["Inspiration", "Operating Principle", "Anti-Principle"];
export const TYPE_COLOR = { Inspiration: "var(--cyan)", "Operating Principle": "var(--purple)", "Anti-Principle": "var(--orange)" };
const SOURCE_TYPES = ["Author", "Book", "Article", "Website", "Podcast", "Lecture", "Personal Experience", "Other"];
const SORTS = ["Newest", "Oldest", "Importance ↓", "Core First"];
const ui = { view: "entries", type: "All", cat: "All", core: false, q: "", sort: "Newest", open: new Set(), adding: false };
const dots = (n) => `<span class="dots" title="importance ${n}/5">${"●".repeat(n)}<i>${"●".repeat(5 - n)}</i></span>`;

function filtered() {
  const q = ui.q.toLowerCase();
  const list = db.wisdom.filter((e) => (ui.type === "All" || e.type === ui.type) && (ui.cat === "All" || e.category === ui.cat) && (!ui.core || e.isCore) &&
    (!q || [e.title, e.content, e.source, ...(e.tags || [])].some((s) => (s || "").toLowerCase().includes(q))));
  const imp = (e) => e.importanceScore ?? 3;
  const s = { Newest: (a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""), Oldest: (a, b) => (a.dateAdded || "").localeCompare(b.dateAdded || ""),
    "Importance ↓": (a, b) => imp(b) - imp(a), "Core First": (a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0) || imp(b) - imp(a) };
  return list.sort(s[ui.sort]);
}

export default {
  id: "wisdom", label: "Wisdom", color: "var(--amber)",
  count: () => db.wisdom.length,
  render(root, app, focus) {
    if (focus) { ui.view = "entries"; ui.type = ui.cat = "All"; ui.core = false; ui.q = ""; ui.open.add(focus); }
    const cats = [...new Set([...CATEGORIES, ...db.wisdom.map((e) => e.category).filter(Boolean)])];
    root.innerHTML = `<div class="page-h"><h1>Wisdom</h1><span class="sub">${plural(db.wisdom.length, "entry")} · ${db.wisdom.filter((e) => e.isCore).length} core</span>
        <div class="seg">${["entries", "timeline", "dna"].map((v) => `<button class="${ui.view === v ? "on" : ""}" data-act="view" data-v="${v}">${v === "dna" ? "DNA" : v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
        <span class="sp"></span><button class="btn" data-act="adding">${ui.adding ? "Close" : "+ New entry"}</button></div>
      ${ui.adding ? form(cats) : ""}
      ${ui.view === "entries" ? entriesView(cats) : ui.view === "timeline" ? timelineView() : dnaView()}`;
    wire(root, app);
  },
};

function form(cats) {
  return `<form class="card" id="add" style="margin-bottom:16px"><div class="card-b" style="padding:14px 16px;display:grid;gap:8px">
    <div class="toolbar" style="margin:0"><input class="in grow" name="title" placeholder="Title" autocomplete="off" />
      <select class="in" name="type">${TYPES.map((t) => `<option>${t}</option>`).join("")}</select>
      <input class="in" name="category" list="wcats" placeholder="Category" value="Philosophy" style="width:150px" /><datalist id="wcats">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></div>
    <textarea class="in" name="content" rows="3" placeholder="The idea, quote or principle…"></textarea>
    <div class="toolbar" style="margin:0"><input class="in grow" name="source" placeholder="Source (who / what)" /><select class="in" name="sourceType">${SOURCE_TYPES.map((t) => `<option>${t}</option>`).join("")}</select>
      <input class="in grow" name="tags" placeholder="tags, comma separated" />
      <label class="tag">importance <input class="in" type="number" name="imp" min="1" max="5" value="3" /></label><label class="tag"><input type="checkbox" name="core" /> core</label></div>
    <textarea class="in" name="why" rows="2" placeholder="Why you saved it (optional)"></textarea>
    <div><button class="btn">Add entry</button></div></div></form>`;
}

function entryCard(e) {
  const open = ui.open.has(e.id), c = TYPE_COLOR[e.type] || "var(--purple)";
  const related = (e.relatedIds || []).map((id) => db.wisdom.find((x) => x.id === id)).filter(Boolean);
  return `<section class="card wis" data-row="${e.id}" style="--c:${c}">
    <header class="proj-h" data-act="toggle" data-id="${e.id}"><span class="bar-l"></span>
      <div class="t" style="flex:1;min-width:0"><b>${e.isCore ? '<span style="color:var(--amber)">★</span> ' : ""}${esc(e.title || "(untitled)")}</b><small style="${open ? "white-space:normal" : ""}">${esc(e.content)}</small></div>
      <span class="badge" style="--c:${c}">${esc(e.type)}</span>${e.category ? `<span class="tag">${esc(e.category)}</span>` : ""}${dots(e.importanceScore ?? 3)}
      <span class="m">${fmtDate(e.dateAdded)}</span></header>
    ${open ? `<div class="proj-b" style="display:grid;gap:10px">
      ${e.source ? `<div class="tag">— ${esc(e.source)}${e.sourceType ? ` (${esc(e.sourceType)})` : ""}</div>` : ""}
      ${e.whySaved ? `<div><span class="tag">Why saved</span><div>${esc(e.whySaved)}</div></div>` : ""}
      ${(e.tags || []).length ? `<div>${e.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(" ")}</div>` : ""}
      <div class="toolbar" style="margin:0"><span class="tag">Related</span>${related.map((r) => `<span class="badge" style="--c:${TYPE_COLOR[r.type]}">${esc(r.title || r.content.slice(0, 30))} <button class="x" style="padding:0 2px;font-size:12px" data-act="unrelate" data-id="${e.id}" data-x="${r.id}">×</button></span>`).join("")}
        <select class="in" data-relate="${e.id}"><option value="">+ link an entry…</option>${db.wisdom.filter((x) => x.id !== e.id && !(e.relatedIds || []).includes(x.id)).map((x) => `<option value="${x.id}">${esc((x.title || x.content).slice(0, 50))}</option>`).join("")}</select></div>
      <div class="toolbar" style="margin:0"><span class="tag">seen ${e.viewCount || 0}× ${e.lastSeenDate ? `· last ${fmtDate(e.lastSeenDate)}` : ""}</span><span class="grow"></span>
        <button class="btn ghost sm" data-act="core" data-id="${e.id}">${e.isCore ? "Unmark core" : "★ Mark core"}</button><button class="btn ghost sm" style="color:var(--red)" data-act="del" data-id="${e.id}">Delete</button></div>
    </div>` : ""}</section>`;
}

function entriesView(cats) {
  const list = filtered();
  return `<div class="toolbar"><div class="chips">${["All", ...TYPES].map((t) => chip(t, ui.type === t, `data-act="type" data-t="${t}"`)).join("")}</div>
      <select class="in" id="wcat"><option>All</option>${cats.map((c) => `<option${ui.cat === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
      ${chip("★ Core only", ui.core, 'data-act="coreonly"')}<span class="grow"></span>
      <select class="in" id="wsort">${SORTS.map((s) => `<option${ui.sort === s ? " selected" : ""}>${s}</option>`).join("")}</select>
      <input class="in find" id="wq" placeholder="Search wisdom…" value="${esc(ui.q)}" /></div>
    <div class="stack" style="gap:8px">${list.map(entryCard).join("") || empty(db.wisdom.length ? "Nothing matches these filters." : "No entries yet — add your first principle or quote.")}</div>`;
}

function timelineView() {
  const byYear = {};
  [...db.wisdom].sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || "")).forEach((e) => ((byYear[(e.dateAdded || "????").slice(0, 4)] ||= []).push(e)));
  return Object.entries(byYear).map(([y, list]) => `<section class="card flush" style="margin-bottom:12px"><header class="card-h"><div><h3>${y}</h3><p class="sub">${plural(list.length, "entry")}</p></div></header><div class="card-b" style="padding:0 12px 10px">
    ${list.map((e) => `<div class="row" data-row="${e.id}"><span class="bar-l" style="--c:${TYPE_COLOR[e.type]}"></span><span class="t">${e.isCore ? "★ " : ""}${esc(e.title || e.content)}<small>${esc(e.content)}</small></span><span class="m">${fmtDate(e.dateAdded)}</span></div>`).join("")}</div></section>`).join("") || empty("No entries yet.");
}

function dnaView() {
  const all = db.wisdom, total = all.length;
  if (!total) return empty("No wisdom entries yet.");
  const count = (fn) => { const m = {}; all.forEach((e) => [].concat(fn(e)).forEach((k) => k && (m[k] = (m[k] || 0) + 1))); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const bars = (rows, color, max = total) => rows.map(([k, n]) => `<div class="hbar" style="--c:${typeof color === "function" ? color(k) : color}"><span>${esc(k)}</span><span class="tr"><span class="fi" style="display:block;width:${(n / max) * 100}%"></span></span><span class="p">${n}</span></div>`).join("");
  const tags = count((e) => e.tags || []).slice(0, 10);
  const top = [...all].sort((a, b) => (b.importanceScore ?? 3) - (a.importanceScore ?? 3)).slice(0, 5);
  return `<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi" style="--c:var(--amber)"><b>${total}</b><span>Total entries</span></div>
      <div class="kpi" style="--c:var(--amber)"><b>${all.filter((e) => e.isCore).length}</b><span>Core entries</span></div>
      <div class="kpi" style="--c:var(--amber)"><b>${(all.reduce((a, e) => a + (e.importanceScore ?? 3), 0) / total).toFixed(1)} / 5</b><span>Avg importance</span></div></div>
    <div class="grid g2">
      <section class="card"><header class="card-h"><h3>By type</h3></header><div class="card-b">${bars(count((e) => e.type), (k) => TYPE_COLOR[k] || "var(--purple)")}</div></section>
      <section class="card"><header class="card-h"><h3>By category</h3></header><div class="card-b">${bars(count((e) => e.category || "Other"), "var(--cyan)")}</div></section>
      <section class="card"><header class="card-h"><h3>By source type</h3></header><div class="card-b">${bars(count((e) => e.sourceType || "Other"), "var(--green)")}</div></section>
      <section class="card"><header class="card-h"><h3>Top tags</h3></header><div class="card-b">${tags.length ? bars(tags.map(([k, n]) => ["#" + k, n]), "var(--pink)", tags[0][1]) : empty("No tags yet.")}</div></section>
      <section class="card" style="grid-column:1/-1"><header class="card-h"><h3>Most important</h3></header><div class="card-b">${top.map((e) => `<div class="row"><span class="bar-l" style="--c:${TYPE_COLOR[e.type]}"></span><span class="t">${e.isCore ? "★ " : ""}${esc(e.title || e.content)}<small>${esc(e.content)}</small></span>${dots(e.importanceScore ?? 3)}</div>`).join("")}</div></section>
    </div>`;
}

function wire(root, app) {
  const find = (id) => db.wisdom.find((e) => e.id === id);
  root.querySelector("#add")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target), title = f.get("title").trim(), content = f.get("content").trim();
    if (!title && !content) return toast("Add a title or some content");
    db.wisdom.push({ id: newId(), title, content, type: f.get("type"), category: f.get("category").trim(), tags: parseTags(f.get("tags")), source: f.get("source").trim(),
      sourceType: f.get("sourceType"), dateAdded: today(), importanceScore: Math.max(1, Math.min(5, +f.get("imp") || 3)), whySaved: f.get("why").trim(),
      isCore: !!f.get("core"), relatedIds: [], viewCount: 0, lastSeenDate: "" });
    ui.adding = false; commit(); app.refresh(); toast("Entry added");
  });
  root.querySelector("#wcat")?.addEventListener("change", (e) => { ui.cat = e.target.value; app.refresh(); });
  root.querySelector("#wsort")?.addEventListener("change", (e) => { ui.sort = e.target.value; app.refresh(); });
  root.querySelector("#wq")?.addEventListener("input", (e) => { ui.q = e.target.value; app.refresh(); const i = root.querySelector("#wq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  root.querySelectorAll("[data-relate]").forEach((s) => (s.onchange = () => {
    const e = find(s.dataset.relate);
    if (s.value && !(e.relatedIds ||= []).includes(s.value)) { e.relatedIds.push(s.value); commit(); app.refresh(); }
  }));
  root.onclick = (ev) => {
    if (ev.target.closest("select, input, textarea")) return;
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const e = b.dataset.id && find(b.dataset.id);
    switch (b.dataset.act) {
      case "view": ui.view = b.dataset.v; return app.refresh();
      case "adding": ui.adding = !ui.adding; app.refresh(); return root.querySelector("#add [name=title]")?.focus();
      case "type": ui.type = b.dataset.t; return app.refresh();
      case "coreonly": ui.core = !ui.core; return app.refresh();
      case "toggle": ui.open.has(e.id) ? ui.open.delete(e.id) : ui.open.add(e.id); return app.refresh();
      case "core": e.isCore = !e.isCore; break;
      case "unrelate": e.relatedIds = (e.relatedIds || []).filter((r) => r !== b.dataset.x); break;
      case "del":
        if (!confirm("Delete this entry?")) return;
        db.wisdom = db.wisdom.filter((x) => x !== e);
        db.wisdom.forEach((x) => (x.relatedIds = (x.relatedIds || []).filter((r) => r !== e.id)));
        break;
      default: return;
    }
    commit(); app.refresh();
  };
}
