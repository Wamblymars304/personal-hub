// Diary — your Obsidian diary logs (tools/import_obsidian_diary.py) plus entries written here.
// Entries by year on the left, the entry on the right in a reading layout (light Markdown).
// Item: { id, date, time, title, text, tags, file, source }
import { db, commit, newId, today, parseTags, parseDate } from "../store.js";
import { esc, fmtDate, chip, empty, plural, linkify, toast } from "../ui.js";

const ui = { sel: null, q: "", editing: false };
const LONG = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const words = (t) => (t ? t.trim().split(/\s+/).length : 0);

/** Just enough Markdown for diary entries: headings, emphasis, lists, quotes, Obsidian [[links]] and #tags. */
export function md(text) {
  const inline = (s) => linkify(s)
    .replace(/!\[\[([^\]]+)\]\]/g, '<span class="tag">[$1]</span>')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => `<u>${b || a}</u>`)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,!?])/g, "$1<i>$2</i>")
    .replace(/(^|\s)#([\p{L}\d_-]+)/gu, '$1<span class="tag">#$2</span>');
  const out = [];
  let list = null;
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
      const tag = /^\s*\d+\./.test(lines[0]) ? "ol" : "ul";
      out.push(`<${tag}>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`).join("")}</${tag}>`);
    } else if (/^#{1,6}\s/.test(lines[0]) && lines.length === 1) {
      out.push(`<h3>${inline(lines[0].replace(/^#+\s*/, ""))}</h3>`);
    } else if (lines.every((l) => l.startsWith(">"))) {
      out.push(`<blockquote>${lines.map((l) => inline(l.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`);
    } else if (/^(-{3,}|\*{3,})$/.test(block.trim())) {
      out.push("<hr>");
    } else out.push(`<p>${lines.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}

export default {
  id: "diary", label: "Diary", color: "var(--orange)",
  count: () => db.diary?.length || null,
  render(root, app, focus) {
    db.diary ||= [];
    if (focus) { ui.sel = focus; ui.q = ""; ui.editing = false; }
    const q = ui.q.trim().toLowerCase();
    const all = [...db.diary].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const list = all.filter((e) => !q || `${e.title}\n${e.text}\n${(e.tags || []).join(" ")}`.toLowerCase().includes(q));
    if (!list.some((e) => e.id === ui.sel)) { ui.sel = list[0]?.id || null; ui.editing = false; }
    const e = db.diary.find((x) => x.id === ui.sel);
    const years = [...new Set(list.map((x) => x.date.slice(0, 4)))];
    const total = all.reduce((s, x) => s + words(x.text), 0);

    root.innerHTML = `<div class="page-h"><h1>Diary</h1><span class="sub">${plural(all.length, "entry")} · ${total.toLocaleString()} words${all.length ? ` · since ${fmtDate(all.at(-1).date)}` : ""}</span><span class="sp"></span>
        <button class="btn" data-act="new">+ Write today</button></div>
      <div class="toolbar"><span class="grow"></span><input class="in find" id="yq" placeholder="Search the diary…" value="${esc(ui.q)}" /></div>
      <div class="notes-wrap">
        <section class="card note-list">${years.map((y) => `<div class="year-h">${y}</div>${list.filter((x) => x.date.startsWith(y)).map((x) => `
            <button class="note-item${x.id === ui.sel ? " on" : ""}" data-act="open" data-id="${x.id}">
              <b>${esc(x.title || fmtDate(x.date))}</b><small>${esc(x.text.replace(/[#*>\-]/g, "").replace(/\s+/g, " ").slice(0, 90))}</small>
              <span class="m">${fmtDate(x.date)}${x.time ? " · " + x.time : ""} · ${words(x.text)} words</span></button>`).join("")}`).join("")
          || empty(all.length ? "Nothing matches." : "No entries yet.")}</section>
        <section class="card reader diary-reader">${e ? (ui.editing ? editor(e) : reader(e)) : empty("Pick an entry.")}</section>
      </div>`;
    wire(root, app);
  },
};

function reader(e) {
  const d = parseDate(e.date);
  return `<header class="reader-h"><div><span class="kicker">${d ? LONG.format(d) : esc(e.date)}${e.time ? ` · ${e.time}` : ""}</span>
      <h2>${esc(e.title || "Dear diary")}</h2>
      <span class="tag">${words(e.text)} words${(e.tags || []).length ? " · " + e.tags.map((t) => "#" + esc(t)).join(" ") : ""}${e.source === "obsidian" ? " · from Obsidian" : ""}</span></div>
      <div class="reader-acts"><button class="btn ghost sm" data-act="edit">Edit</button><button class="btn ghost sm" style="color:var(--red)" data-act="del">Delete</button></div></header>
    <div class="note-body diary-body">${md(e.text)}</div>`;
}
function editor(e) {
  return `<form id="yedit" class="note-edit">
    <div class="toolbar" style="margin:0"><input class="in grow" name="title" value="${esc(e.title)}" placeholder="Title (optional)" />
      <input class="in" type="date" name="date" value="${esc(e.date)}" /><input class="in grow" name="tags" value="${esc((e.tags || []).join(", "))}" placeholder="tags" /></div>
    <textarea class="in" name="text" placeholder="Dear diary…">${esc(e.text)}</textarea>
    <div class="toolbar" style="margin:0"><button class="btn">Save</button><button type="button" class="btn ghost" data-act="cancel">Cancel</button></div></form>`;
}

function wire(root, app) {
  const q = root.querySelector("#yq");
  q.oninput = () => { ui.q = q.value; const pos = q.selectionStart; app.refresh(); const n = document.querySelector("#yq"); n.focus(); n.setSelectionRange(pos, pos); };
  const form = root.querySelector("#yedit");
  if (form) {
    form.querySelector("textarea").focus();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const e = db.diary.find((x) => x.id === ui.sel), f = new FormData(form);
      Object.assign(e, { title: f.get("title").trim(), date: f.get("date") || e.date, tags: parseTags(f.get("tags")), text: f.get("text") });
      ui.editing = false; commit(); app.refresh(); toast("Saved");
    };
  }
  root.onclick = (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const e = db.diary.find((x) => x.id === ui.sel);
    switch (b.dataset.act) {
      case "open": ui.sel = b.dataset.id; ui.editing = false; return app.refresh();
      case "new": {
        const now = new Date(), x = { id: newId(), date: today(), time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, title: "", text: "", tags: [], source: "hub" };
        db.diary.push(x); ui.sel = x.id; ui.q = ""; ui.editing = true; commit(); return app.refresh();
      }
      case "edit": ui.editing = true; return app.refresh();
      case "cancel": ui.editing = false; if (e && !e.text.trim()) db.diary = db.diary.filter((x) => x !== e); return app.refresh();
      case "del": if (!confirm("Delete this diary entry?")) return; db.diary = db.diary.filter((x) => x !== e); commit(); return app.refresh();
    }
  };
}
