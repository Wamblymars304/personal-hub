// Notes — everything imported from Samsung Notes (tools/import_samsung_notes.py) plus notes written here.
// List on the left (folder filter, search), the note on the right to read; Edit turns it into fields.
// A note that turns out to be a dream can be moved to the Dreams tab.
// Item: { id, title, text, folder, created, modified, image, pinned, source, sid }
import { db, commit, newId, today } from "../store.js";
import { esc, fmtDate, chip, empty, plural, linkify, toast } from "../ui.js";

const ui = { folder: "All", q: "", sel: null, editing: false };
const snippet = (t) => (t || "").replace(/\s+/g, " ").slice(0, 90);
const paras = (t) => (t || "").split(/\n{2,}/).map((p) => `<p>${linkify(p).replace(/\n/g, "<br>")}</p>`).join("");

function visible() {
  const q = ui.q.trim().toLowerCase();
  return db.notes.filter((n) => (ui.folder === "All" || n.folder === ui.folder) && (!q || `${n.title}\n${n.text}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.modified || b.created || "").localeCompare(a.modified || a.created || ""));
}

export default {
  id: "notes", label: "Notes", color: "var(--cyan)",
  count: () => db.notes.length || null,
  render(root, app, focus) {
    db.notes ||= [];
    if (focus) { ui.sel = focus; ui.folder = "All"; ui.q = ""; ui.editing = false; }
    const folders = [...new Set(db.notes.map((n) => n.folder || "Unsorted"))].sort((a, b) => (a === "Unsorted") - (b === "Unsorted") || a.localeCompare(b));
    if (ui.folder !== "All" && !folders.includes(ui.folder)) ui.folder = "All";
    const list = visible();
    if (!list.some((n) => n.id === ui.sel)) { ui.sel = list[0]?.id || null; ui.editing = false; }
    const n = db.notes.find((x) => x.id === ui.sel);
    const words = db.notes.reduce((s, x) => s + (x.text ? x.text.split(/\s+/).length : 0), 0);

    root.innerHTML = `<div class="page-h"><h1>Notes</h1><span class="sub">${plural(db.notes.length, "note")} · ${words.toLocaleString()} words</span><span class="sp"></span>
        <button class="btn" data-act="new">+ New note</button></div>
      <div class="toolbar"><div class="chips">${chip(`All <span class="tag">${db.notes.length}</span>`, ui.folder === "All", 'data-act="folder" data-f="All"')}
        ${folders.map((f) => chip(`${esc(f)} <span class="tag">${db.notes.filter((x) => (x.folder || "Unsorted") === f).length}</span>`, ui.folder === f, `data-act="folder" data-f="${esc(f)}"`)).join("")}</div>
        <span class="grow"></span><input class="in find" id="nq" placeholder="Search notes…" value="${esc(ui.q)}" /></div>
      <div class="notes-wrap">
        <section class="card note-list">${list.map((x) => `<button class="note-item${x.id === ui.sel ? " on" : ""}" data-act="open" data-id="${x.id}">
            <b>${x.pinned ? '<span class="pin">●</span> ' : ""}${esc(x.title || "Untitled")}</b>
            <small>${x.image && !x.text ? "picture" : esc(snippet(x.text))}</small>
            <span class="m">${esc(x.folder || "Unsorted")} · ${fmtDate(x.modified || x.created)}</span></button>`).join("")
          || empty(db.notes.length ? "Nothing matches." : "No notes yet. Run tools/import_samsung_notes.py to bring in Samsung Notes, or write one.")}</section>
        <section class="card reader">${n ? (ui.editing ? editor(n, folders) : reader(n)) : empty("Pick a note on the left.")}</section>
      </div>`;
    wire(root, app);
  },
};

function reader(n) {
  return `<header class="reader-h"><div><span class="kicker">${esc(n.folder || "Unsorted")}${n.source === "samsung" ? " · from Samsung Notes" : ""}</span>
      <h2>${esc(n.title || "Untitled")}</h2>
      <span class="tag">written ${fmtDate(n.created)}${n.modified && n.modified !== n.created ? ` · edited ${fmtDate(n.modified)}` : ""} · ${plural(n.text ? n.text.split(/\s+/).length : 0, "word")}</span></div>
      <div class="reader-acts"><button class="btn ghost sm" data-act="pin">${n.pinned ? "Unpin" : "Pin"}</button><button class="btn ghost sm" data-act="edit">Edit</button>
        <button class="btn ghost sm" data-act="todream">Move to Dreams</button><button class="btn ghost sm" style="color:var(--red)" data-act="del">Delete</button></div></header>
    ${n.image ? `<img class="note-img" src="${esc(n.image)}" alt="Picture from this note" />` : ""}
    <div class="note-body">${paras(n.text) || (n.image ? "" : '<p class="tag">Empty note.</p>')}</div>`;
}
function editor(n, folders) {
  return `<form id="nedit" class="note-edit">
    <div class="toolbar" style="margin:0"><input class="in grow" name="title" value="${esc(n.title)}" placeholder="Title" autocomplete="off" />
      <input class="in" name="folder" list="nfolders" value="${esc(n.folder || "Unsorted")}" style="width:170px" /><datalist id="nfolders">${folders.map((f) => `<option>${esc(f)}</option>`).join("")}</datalist></div>
    <textarea class="in" name="text" placeholder="Write…">${esc(n.text)}</textarea>
    <div class="toolbar" style="margin:0"><button class="btn">Save</button><button type="button" class="btn ghost" data-act="cancel">Cancel</button></div></form>`;
}

function wire(root, app) {
  const q = root.querySelector("#nq");
  q.oninput = () => { ui.q = q.value; const pos = q.selectionStart; app.refresh(); const nq = document.querySelector("#nq"); nq.focus(); nq.setSelectionRange(pos, pos); };
  const form = root.querySelector("#nedit");
  if (form) {
    const ta = form.querySelector("textarea");
    ta.focus();
    form.onsubmit = (e) => {
      e.preventDefault();
      const n = db.notes.find((x) => x.id === ui.sel), f = new FormData(form);
      Object.assign(n, { title: f.get("title").trim() || "Untitled", folder: f.get("folder").trim() || "Unsorted", text: f.get("text"), modified: today() });
      ui.editing = false; commit(); app.refresh(); toast("Saved");
    };
  }
  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const n = db.notes.find((x) => x.id === ui.sel);
    switch (b.dataset.act) {
      case "folder": ui.folder = b.dataset.f; return app.refresh();
      case "open": ui.sel = b.dataset.id; ui.editing = false; app.refresh(); return root.querySelector(".reader")?.scrollTo(0, 0);
      case "new": {
        const x = { id: newId(), title: "", text: "", folder: ui.folder === "All" ? "Unsorted" : ui.folder, created: today(), modified: today(), image: "", pinned: false, source: "hub" };
        db.notes.push(x); ui.sel = x.id; ui.q = ""; ui.editing = true; commit(); return app.refresh();
      }
      case "edit": ui.editing = true; return app.refresh();
      case "cancel": ui.editing = false; if (n && !n.title && !n.text) db.notes = db.notes.filter((x) => x !== n); return app.refresh();
      case "pin": n.pinned = !n.pinned; break;
      case "del": if (!confirm(`Delete “${n.title || "Untitled"}”?`)) return; db.notes = db.notes.filter((x) => x !== n); break;
      case "todream": {
        db.dreams ||= [];
        db.dreams.push({ id: n.id, title: n.title, text: n.text, image: n.image || "", date: n.created || today(), added_date: today(), tags: [], source: n.source, sid: n.sid });
        db.notes = db.notes.filter((x) => x !== n);
        commit(); app.refresh(); return toast("Moved to Dreams");
      }
      default: return;
    }
    commit(); app.refresh();
  };
}
