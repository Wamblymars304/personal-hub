// Bucket list — the things you want to become, learn, see, meet, make and do before you're done. Places on it
// link to the Places map; things you can practise link to Skills. Suggestions live in Places → "Suggested for you".
// Item: { id, text, kind: become|learn|go|meet|make|do, status: dream|planned|done, doneAt?, note?, placeId?, skill?,
// noteId?, noteTitle?, added } in hub.json "bucket".
import { db, commit, newId, today, parseDate } from "../store.js";
import { esc, plural, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";

const KINDS = [["become", "Become"], ["learn", "Learn"], ["go", "Go"], ["meet", "Meet"], ["make", "Make"], ["do", "Do"]];
const STATUS = { dream: "someday", planned: "planned", done: "done" };
const NEXT = { dream: "planned", planned: "done", done: "dream" };
const ui = { status: "all", q: "", edit: "" };
const items = () => (db.bucket ||= []);
const placeOf = (i) => i.placeId && (db.places || []).find((p) => p.id === i.placeId);
const when = (d) => (d ? parseDate(d).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");

export default {
  id: "bucket", label: "Bucket list", color: "var(--amber)",
  count: () => items().filter((i) => i.status !== "done").length || null,
  render(root, app, focus) {
    if (focus) { ui.status = "all"; ui.q = ""; }
    const all = items(), done = all.filter((i) => i.status === "done").length, planned = all.filter((i) => i.status === "planned").length;
    const mapped = all.filter((i) => placeOf(i)?.lat != null).length;
    root.innerHTML = `<div class="page-h"><h1>Bucket list</h1><span class="sub">${plural(all.length, "thing")} · ${done} done</span></div>
      <section class="bk-lede">
        <div><b>${all.length - done}</b><span>still to do</span></div><div><b>${planned}</b><span>planned</span></div>
        <div><b>${done}</b><span>done</span></div><div><b>${mapped}</b><span>on your map</span></div>
        <i class="bk-bar"><u style="width:${all.length ? (done / all.length) * 100 : 0}%"></u></i>
      </section>
      <div class="bk-tools">
        <div class="bk-filter">${[["all", "Everything"], ["dream", "Someday"], ["planned", "Planned"], ["done", "Done"]].map(([k, l]) => `<button class="${ui.status === k ? "on" : ""}" data-act="status" data-s="${k}">${l}</button>`).join("")}</div>
        <input class="in" id="bk-q" placeholder="Find…" value="${esc(ui.q)}" autocomplete="off" />
        <button class="btn ghost" data-act="ideas" title="Places and things to do picked for you">Suggestions for you →</button></div>
      <form class="bk-add" id="bk-add"><input class="in" name="text" placeholder="Something you want to do before you're done…" autocomplete="off" maxlength="160" required />
        <select class="in" name="kind">${KINDS.map(([k, l]) => `<option value="${k}"${k === "do" ? " selected" : ""}>${l}</option>`).join("")}</select><button class="btn">Add</button></form>
      <div id="bk-list">${list()}</div>`;
    if (motionEnabled()) { const els = root.querySelectorAll(".bk-sec"); if (els.length) animate(els, { opacity: [0, 1], translateY: [10, 0], delay: stagger(40), duration: 600, ease: "outQuart" }); }

    const box = root.querySelector("#bk-list");
    root.querySelector("#bk-q").oninput = (e) => { ui.q = e.target.value; box.innerHTML = list(); };
    root.querySelector("#bk-add").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target), text = f.get("text").trim();
      if (!text) return;
      items().push({ id: newId(), text, kind: f.get("kind"), status: "dream", placeId: "", skill: "", noteId: "", noteTitle: "", added: today() });
      commit(); toast("Added to your bucket list"); app.refresh();
    };
    root.onchange = (e) => {
      const el = e.target.closest("[data-note]");
      if (el) { const i = items().find((x) => x.id === el.dataset.note); if (i) { i.note = el.value.trim() || undefined; commit(); } }
    };
    root.onkeydown = (e) => {
      const el = e.target.closest("[data-text]");
      if (!el || !(e.key === "Enter" || e.key === "Escape")) return;
      e.preventDefault();
      const i = items().find((x) => x.id === el.dataset.text);
      if (e.key === "Enter" && i && el.value.trim()) { i.text = el.value.trim(); commit(); }
      ui.edit = ""; box.innerHTML = list();
    };
    root.onclick = (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const i = items().find((x) => x.id === b.dataset.id);
      switch (b.dataset.act) {
        case "status": ui.status = b.dataset.s; return app.refresh();
        case "cycle": i.status = NEXT[i.status] || "planned"; i.doneAt = i.status === "done" ? today() : undefined; commit(); if (i.status === "done") toast(`Done: ${i.text}`); return app.refresh();
        case "edit": ui.edit = ui.edit === i.id ? "" : i.id; box.innerHTML = list(); return box.querySelector(`[data-text="${i.id}"]`)?.focus();
        case "kind": i.kind = b.dataset.k; commit(); box.innerHTML = list(); return;
        case "del": if (!confirm(`Delete “${i.text}” from your bucket list?`)) return; db.bucket = items().filter((x) => x !== i); commit(); toast("Deleted from your bucket list"); return app.refresh();
        case "map": return app.go("places", i.placeId);
        case "skill": return app.go("skills");
        case "ideas": return app.go("places", "ideas");
      }
    };
    if (focus) requestAnimationFrame(() => document.querySelector(`[data-row="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" }));
  },
};

function list() {
  const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
  const pick = items().filter((i) => (ui.status === "all" || i.status === ui.status) && (!words.length || words.every((w) => `${i.text} ${i.note || ""} ${placeOf(i)?.country || ""}`.toLowerCase().includes(w))));
  return KINDS.map(([k, label]) => {
    const l = pick.filter((i) => i.kind === k);
    if (!l.length) return "";
    const done = l.filter((i) => i.status === "done").length;
    return `<section class="bk-sec"><h2>${label}<span>${l.length}${done ? ` · ${done} done` : ""}</span></h2>${l.map(row).join("")}</section>`;
  }).join("") || `<p class="bk-empty">${items().length ? "Nothing matches." : "Your bucket list is empty — add the first thing above."}</p>`;
}
function row(i) {
  const p = placeOf(i), editing = ui.edit === i.id;
  return `<article class="bk-item ${i.status}" data-row="${i.id}">
    <button class="bk-dot" data-act="cycle" data-id="${i.id}" title="${STATUS[i.status]} — click for ${STATUS[NEXT[i.status]]}" aria-label="Status: ${STATUS[i.status]}"></button>
    <div class="bk-body">
      ${editing ? `<input class="in bk-text" data-text="${i.id}" value="${esc(i.text)}" maxlength="160" aria-label="Edit (Enter to save, Esc to cancel)" />`
        : `<button class="bk-t" data-act="edit" data-id="${i.id}" title="Edit">${esc(i.text)}</button>`}
      <p class="bk-meta"><span class="bk-st">${STATUS[i.status]}${i.status === "done" && i.doneAt ? ` · ${when(i.doneAt)}` : ""}</span>
        ${p ? `<button class="bk-link" data-act="map" data-id="${i.id}">${p.lat != null ? "on the map" : "in Places, not pinned yet"}${p.country ? ` · ${esc(p.country)}` : ""} ↗</button>` : ""}
        ${i.skill ? `<button class="bk-link" data-act="skill" data-id="${i.id}">practise it in Skills →</button>` : ""}
        ${i.noteTitle ? `<span class="bk-src">from your note “${esc(i.noteTitle)}”</span>` : ""}</p>
      ${editing ? `<div class="bk-edit"><div class="bk-kinds">${KINDS.map(([k, l]) => `<button class="${i.kind === k ? "on" : ""}" data-act="kind" data-id="${i.id}" data-k="${k}">${l}</button>`).join("")}</div>
        <textarea class="in" rows="2" data-note="${i.id}" placeholder="A note — when, with who, what it would mean…">${esc(i.note || "")}</textarea>
        <div class="bk-edit-acts"><button class="bk-link" data-act="edit" data-id="${i.id}">done</button></div></div>`
        : i.note ? `<p class="bk-note">${esc(i.note)}</p>` : ""}
    </div>
    <button class="bk-link danger bk-del" data-act="del" data-id="${i.id}" aria-label="Delete ${esc(i.text)}">delete</button></article>`;
}
