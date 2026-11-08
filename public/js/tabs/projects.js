// Projects — the workshop. Same data and rules as projects_tab.py (milestones, production assets,
// iteration notes, version history, collaborators), shown as a board you can drag cards across
// (columns = status) or as a list; one project opens in a side drawer where everything is edited.
import { db, commit, newId, today, daysFromToday, normDate } from "../store.js";
import { esc, fmtDate, relDay, toast, PRIORITY } from "../ui.js";
import { stagger } from "../../vendor/anime.esm.min.js";
import { animateAny as animate } from "../motion.js";
import { motionEnabled, pulse } from "../background.js";

export const STATUSES = ["Planning", "In Progress", "On Hold", "Completed", "Cancelled"];
const CATEGORIES = ["Creative", "Technical", "Personal", "Research", "Business", "Other"];
const ASSET_TYPES = ["Script", "Asset", "Render", "Footage", "Design", "Doc", "Other"];
export const STATUS_COLOR = { Planning: "var(--cyan)", "In Progress": "var(--purple)", "On Hold": "var(--orange)", Completed: "var(--green)", Cancelled: "var(--slate)" };
const CAT_COLOR = { Creative: "var(--pink)", Technical: "var(--cyan)", Personal: "var(--purple)", Research: "var(--amber)", Business: "var(--green)", Other: "var(--slate)" };
const ACTIVE = ["Planning", "In Progress", "On Hold"];
const PRIOS = ["High", "Medium", "Low"];
const PRANK = { High: 0, Medium: 1, Low: 2 };
const FILTERS = ["Active", ...STATUSES, "All"];

// progress comes from milestones when there are any, otherwise the manual percentage
export const progressOf = (p) => { const ms = p.milestones || []; return ms.length ? Math.round((ms.filter((m) => m.completed).length / ms.length) * 100) : +p.progressPct || 0; };

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const ui = { filter: "Active", sort: "Priority", view: store.get("hub.projects.view") === "list" ? "list" : "board", sel: null, adding: false, opening: false, shown: new Map(), suppressClick: false, scroll: 0 };
let appRef = null;

const SORTS = {
  Priority: (a, b) => (PRANK[a.priority] ?? 2) - (PRANK[b.priority] ?? 2),
  Deadline: (a, b) => (normDate(a.targetDate) || "9999").localeCompare(normDate(b.targetDate) || "9999"),
  Newest: (a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""),
  "A–Z": (a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()),
};

const opts = (list, sel) => list.map((x) => `<option${x === sel ? " selected" : ""}>${x}</option>`).join("");
const href = (u) => (/^(https?:|file:)/i.test(u) ? u : /^[a-z]:\\/i.test(u) ? "file:///" + u.replace(/\\/g, "/") : "https://" + u);
const where = (u) => { if (!u) return ""; if (/^[a-z]:\\|^file:/i.test(u)) return u.split(/[\\/]/).filter(Boolean).pop(); return (u.match(/^(?:https?:\/\/)?(?:www\.)?([^\/\s?#]+)/i) || [, u])[1]; };
const isLate = (p) => { const d = daysFromToday(p.targetDate); return d != null && d < 0 && ACTIVE.includes(p.status); };
const find = (id) => db.projects.find((p) => p.id === id);
const still = () => !motionEnabled();
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const PEOPLE_COLORS = ["var(--cyan)", "var(--pink)", "var(--amber)", "var(--green)", "var(--purple)", "var(--orange)"];

/* little drawn things */
const priBars = (pr) => { const n = { High: 3, Medium: 2, Low: 1 }[pr] || 0; return `<span class="wk-pri" style="--pc:${PRIORITY[pr] || "var(--slate)"}" title="${esc(pr || "No")} priority" aria-label="${esc(pr || "No")} priority"><i class="${n >= 1 ? "on" : ""}"></i><i class="${n >= 2 ? "on" : ""}"></i><i class="${n >= 3 ? "on" : ""}"></i></span>`; };
const ring = (p, pct, size = 40) => `<svg class="wk-ring" viewBox="0 0 44 44" width="${size}" height="${size}" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="18"/><circle class="arc" cx="22" cy="22" r="18" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - pct}" transform="rotate(-90 22 22)" data-pid="${p.id}" data-ring="${pct}"/><text x="22" y="25.5" data-pid="${p.id}" data-num="${pct}">${pct}</text></svg>`;
function dial(p, pct) {
  const ticks = Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2 - Math.PI / 2, r1 = i % 4 ? 66 : 62, r2 = 70;
    return `<line x1="${(75 + Math.cos(a) * r1).toFixed(1)}" y1="${(75 + Math.sin(a) * r1).toFixed(1)}" x2="${(75 + Math.cos(a) * r2).toFixed(1)}" y2="${(75 + Math.sin(a) * r2).toFixed(1)}"${i / 40 * 100 < pct ? ' class="lit"' : ""}/>`; }).join("");
  const ms = p.milestones || [];
  return `<svg class="wk-dial" viewBox="0 0 150 150" aria-label="${pct}% done">${ticks}<circle class="trk" cx="75" cy="75" r="52"/>
    <circle class="arc" cx="75" cy="75" r="52" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - pct}" transform="rotate(-90 75 75)" data-pid="${p.id}" data-ring="${pct}"/>
    <text class="n" x="75" y="80"><tspan data-pid="${p.id}" data-num="${pct}">${pct}</tspan><tspan class="u" dx="2" dy="-12">%</tspan></text>
    <text class="s" x="75" y="98">${ms.length ? `${ms.filter((m) => m.completed).length} / ${ms.length} STEPS` : "BY HAND"}</text></svg>`;
}

export default {
  id: "projects", label: "Projects", color: "var(--purple)",
  count: () => db.projects.filter((p) => ACTIVE.includes(p.status)).length,
  render(root, app, focus) {
    appRef = app;
    if (app.entering) ui.shown.clear();
    if (focus && find(focus)) { ui.filter = "All"; ui.sel = focus; ui.opening = true; }
    if (ui.sel && !find(ui.sel)) ui.sel = null;
    ui.scroll = root.querySelector(".wk-drawer-b")?.scrollTop || 0;
    const counts = Object.fromEntries(FILTERS.map((f) => [f, db.projects.filter((p) => inFilter(p, f)).length]));
    root.innerHTML = `<div class="wkshop${still() ? " wk-still" : ""}">
      <div class="page-h"><h1>Projects</h1><span class="sub">${db.projects.length} on the books · ${counts.Active} on the bench</span><span class="sp"></span>
        <div class="seg wk-view" role="group" aria-label="View">${["board", "list"].map((v) => `<button class="${ui.view === v ? "on" : ""}" data-act="view" data-v="${v}" aria-pressed="${ui.view === v}">${v === "board" ? "Board" : "List"}</button>`).join("")}</div>
        <button class="btn" data-act="adding" aria-expanded="${ui.adding}">${ui.adding ? "Close" : "+ New project"}</button></div>
      ${readout()}
      ${ui.adding ? addForm() : ""}
      <div class="toolbar wk-tools"><div class="chips">${FILTERS.map((f) => `<button class="chip${ui.filter === f ? " on" : ""}" data-act="filter" data-f="${f}"${STATUS_COLOR[f] ? ` style="--dot:${STATUS_COLOR[f]}"` : ""}>${STATUS_COLOR[f] ? '<i class="dot"></i>' : ""}${f}<em>${counts[f]}</em></button>`).join("")}</div>
        <span class="grow"></span><span class="wk-lbl">sort</span><div class="chips">${Object.keys(SORTS).map((s) => `<button class="chip${ui.sort === s ? " on" : ""}" data-act="sort" data-s="${s}">${s}</button>`).join("")}</div></div>
      <div id="wk-main"></div>
      <div id="wk-dock"></div></div>`;
    paintMain(root);
    paintDock(root);
    wire(root, app);
    if (app.entering && !still()) {
      animate(root.querySelectorAll(".wk-readout > div"), { opacity: [0, 1], translateY: [10, 0], delay: stagger(40, { start: 60 }), duration: 520, ease: "outBack(1.6)" });
      animate(root.querySelectorAll(".wk-card, .wk-row"), { opacity: [0, 1], translateY: [18, 0], scale: [0.96, 1], delay: stagger(35, { start: 140 }), duration: 560, ease: "outBack(1.7)" });
    }
    if (ui.adding) root.querySelector("#wk-new [name=name]")?.focus();
  },
};

function inFilter(p, f) { return f === "All" || (f === "Active" ? ACTIVE.includes(p.status) : p.status === f); }

function readout() {
  const act = db.projects.filter((p) => ACTIVE.includes(p.status));
  const late = act.filter(isLate);
  const next = act.map((p) => ({ p, d: daysFromToday(p.targetDate) })).filter((x) => x.d != null && x.d >= 0).sort((a, b) => a.d - b.d)[0];
  const avg = act.length ? Math.round(act.reduce((s, p) => s + progressOf(p), 0) / act.length) : 0;
  const msAll = db.projects.reduce((n, p) => n + (p.milestones || []).length, 0), msDone = db.projects.reduce((n, p) => n + (p.milestones || []).filter((m) => m.completed).length, 0);
  const cell = (k, v, s, cls = "") => `<div class="${cls}"><span class="k">${k}</span><b class="v">${v}</b><span class="s">${s}</span></div>`;
  return `<div class="wk-readout">
    ${cell("on the bench", act.length, `${act.filter((p) => p.status === "In Progress").length} in progress · ${act.filter((p) => p.status === "On Hold").length} on hold`)}
    ${cell("avg progress", `${avg}<small>%</small>`, "across active work")}
    ${cell("overdue", late.length, late.length ? esc(late.map((p) => p.name).join(", ")) : "nothing slipping", late.length ? "hot" : "")}
    ${cell("next deadline", next ? esc(relDay(next.p.targetDate)) : "—", next ? esc(next.p.name) : "no dates set")}
    ${cell("shipped", db.projects.filter((p) => p.status === "Completed").length, `${msDone}/${msAll} milestones done`)}
  </div>`;
}

function addForm() {
  return `<form class="wk-new" id="wk-new" autocomplete="off">
    <span class="wk-lbl">new project</span>
    <input class="in wk-new-name" name="name" placeholder="What are you building?" required />
    <div class="wk-new-row">
      <label><span class="wk-lbl">status</span><select class="in" name="status">${opts(STATUSES, "Planning")}</select></label>
      <label><span class="wk-lbl">area</span><select class="in" name="category">${opts(CATEGORIES, "Creative")}</select></label>
      <label><span class="wk-lbl">priority</span><select class="in" name="priority">${opts(PRIOS, "Medium")}</select></label>
      <label><span class="wk-lbl">target</span><input class="in" type="date" name="target" /></label>
    </div>
    <input class="in" name="description" placeholder="One line on what it is (optional)" />
    <div class="wk-new-acts"><button class="btn">Add project</button><button type="button" class="btn ghost" data-act="adding">Cancel</button></div>
  </form>`;
}

/* ---------- board + list ---------- */
function paintMain(root) {
  const main = root.querySelector("#wk-main");
  if (!main) return;
  const list = db.projects.filter((p) => inFilter(p, ui.filter)).sort(SORTS[ui.sort]);
  if (ui.view === "board") {
    const cols = ui.filter === "All" ? STATUSES : ui.filter === "Active" ? ACTIVE : [ui.filter];
    main.innerHTML = `<div class="wk-board" style="--n:${cols.length}">${cols.map((s) => {
      const here = list.filter((p) => p.status === s);
      return `<section class="wk-col" data-col="${s}" style="--c:${STATUS_COLOR[s]}" aria-label="${s}">
        <header class="wk-col-h"><i></i>${s}<em>${here.length}</em></header>
        <div class="wk-drop">${here.map(card).join("") || `<div class="wk-empty">drop a card here</div>`}</div></section>`;
    }).join("")}</div>
    <p class="wk-hint">Drag a card to another column to change its status · <kbd>Shift</kbd> + <kbd>←</kbd>/<kbd>→</kbd> on a focused card does the same</p>`;
  } else {
    main.innerHTML = list.length ? `<div class="wk-list">${list.map(row).join("")}</div>`
      : `<div class="wk-list"><div class="wk-empty big">${db.projects.length ? "No projects match this filter." : "Nothing on the bench yet — add a project."}</div></div>`;
  }
  liven(root.querySelector("#wk-main"));
}

function card(p) {
  const pct = progressOf(p), ms = p.milestones || [], late = isLate(p);
  return `<article class="wk-card${late ? " late" : ""}${ui.sel === p.id ? " sel" : ""}" data-row="${p.id}" data-id="${p.id}" data-s="${esc(p.status)}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${esc(p.status)}, ${pct}%" style="--c:${STATUS_COLOR[p.status] || "var(--purple)"}">
    <div class="wk-meta"><span style="color:${CAT_COLOR[p.category] || "var(--slate)"}">${esc(p.category || "Other")}</span>${priBars(p.priority)}</div>
    <b class="wk-name">${esc(p.name)}</b>
    ${p.description ? `<small class="wk-desc">${esc(p.description)}</small>` : ""}
    <div class="wk-meter" title="${ms.length ? `${ms.filter((m) => m.completed).length}/${ms.length} milestones` : "set by hand"}"><i style="width:${pct}%" data-pid="${p.id}" data-bar="${pct}"></i></div>
    <div class="wk-foot"><span><b data-pid="${p.id}" data-num="${pct}">${pct}</b>%${ms.length ? ` · ${ms.filter((m) => m.completed).length}/${ms.length}` : ""}</span>
      ${p.targetDate ? `<span class="due${late ? " late" : ""}" title="${esc(fmtDate(p.targetDate, { year: true }) || p.targetDate)}">${esc(relDay(p.targetDate) || p.targetDate)}</span>` : ""}</div>
  </article>`;
}

function row(p) {
  const pct = progressOf(p), late = isLate(p);
  return `<button class="wk-row${late ? " late" : ""}${ui.sel === p.id ? " sel" : ""}" data-row="${p.id}" data-act="open" data-id="${p.id}" style="--c:${STATUS_COLOR[p.status] || "var(--purple)"}">
    ${ring(p, pct)}
    <span class="t"><b>${esc(p.name)}</b>${p.description ? `<small>${esc(p.description)}</small>` : ""}</span>
    <span class="wk-cat" style="color:${CAT_COLOR[p.category] || "var(--slate)"}">${esc(p.category || "")}</span>
    ${priBars(p.priority)}
    <span class="due${late ? " late" : ""}">${p.targetDate ? esc(relDay(p.targetDate) || p.targetDate) : ""}</span>
    <span class="wk-st"><i></i>${esc(p.status)}</span>
  </button>`;
}

/* ---------- drawer ---------- */
function paintDock(root) {
  const dock = root.querySelector("#wk-dock");
  if (!dock) return;
  const p = ui.sel && find(ui.sel);
  if (!p) { dock.innerHTML = ""; return; }
  dock.innerHTML = `<div class="wk-scrim" data-act="close"></div>${drawer(p)}`;
  const body = dock.querySelector(".wk-drawer-b");
  if (body) body.scrollTop = ui.scroll;
  liven(dock);
  if (ui.opening && !still()) {
    animate(dock.querySelector(".wk-drawer"), { translateX: [60, -6, 0], opacity: [0, 1, 1], duration: 420, ease: "outQuart" });
    animate(dock.querySelector(".wk-scrim"), { opacity: [0, 1], duration: 250 });
    animate(dock.querySelectorAll(".wk-sec"), { opacity: [0, 1], translateY: [12, 0], delay: stagger(40, { start: 120 }), duration: 420, ease: "outBack(1.5)" });
  }
  ui.opening = false;
}

const sec = (title, n, body, form, cls = "") => `<section class="wk-sec ${cls}"><h4>${title}${n ? `<em>${n}</em>` : ""}</h4>${body}${form}</section>`;
const del = (kind, pid, x, label = "Delete") => `<button class="wk-x" data-act="del-${kind}" data-id="${pid}" data-x="${x}" title="${label}" aria-label="${label}">×</button>`;

function drawer(p) {
  const id = p.id, pct = progressOf(p), ms = p.milestones || [], assets = p.assetLinks || [], notes = p.iterationNotes || [], vers = p.versionHistory || [], people = p.collaborators || [];
  const late = isLate(p);
  return `<aside class="wk-drawer" role="dialog" aria-label="${esc(p.name)}" style="--c:${STATUS_COLOR[p.status] || "var(--purple)"}">
    <div class="wk-drawer-h">
      <div class="wk-kick"><i></i>${esc(p.status)} · ${esc(p.category || "Other")} · started ${esc(fmtDate(p.createdDate, { year: true }) || "—")}<button class="wk-close" data-act="close" aria-label="Close" title="Close (Esc)">×</button></div>
      <input class="wk-title" data-f="name" data-id="${id}" value="${esc(p.name)}" aria-label="Project name" autocomplete="off" />
    </div>
    <div class="wk-drawer-b">
      <div class="wk-seg wk-status" role="group" aria-label="Status">${STATUSES.map((s) => `<button class="${p.status === s ? "on" : ""}" style="--c:${STATUS_COLOR[s]}" data-act="status" data-id="${id}" data-s="${s}" aria-pressed="${p.status === s}">${s}</button>`).join("")}</div>
      <div class="wk-hero">
        ${dial(p, pct)}
        <div class="wk-ctl">
          <div class="wk-fields">
            <label><span class="wk-lbl">priority</span><span class="wk-seg sm" role="group">${PRIOS.map((x) => `<button class="${p.priority === x ? "on" : ""}" style="--c:${PRIORITY[x]}" data-act="prio" data-id="${id}" data-p="${x}" aria-pressed="${p.priority === x}">${x}</button>`).join("")}</span></label>
            <label><span class="wk-lbl">area</span><select class="in" data-f="category" data-id="${id}">${opts(CATEGORIES, p.category)}</select></label>
            <label><span class="wk-lbl">target ${late ? `<b class="late">· ${esc(relDay(p.targetDate))}</b>` : p.targetDate ? `· ${esc(relDay(p.targetDate))}` : ""}</span><input class="in${late ? " late" : ""}" type="date" data-f="targetDate" data-id="${id}" value="${normDate(p.targetDate)}" /></label>
            ${ms.length ? `<label><span class="wk-lbl">progress</span><span class="wk-auto">from milestones</span></label>`
              : `<label><span class="wk-lbl">progress · by hand</span><input class="wk-range" type="range" min="0" max="100" step="5" data-f="progressPct" data-id="${id}" value="${+p.progressPct || 0}" aria-label="Progress percent" /></label>`}
          </div>
        </div>
      </div>
      <textarea class="in wk-descin" data-f="description" data-id="${id}" rows="2" placeholder="What is it, why does it matter?">${esc(p.description || "")}</textarea>

      ${sec("Milestones", ms.length ? `${ms.filter((m) => m.completed).length}/${ms.length}` : "",
        ms.length ? `<ol class="wk-ms">${ms.map((m) => { const d = daysFromToday(m.targetDate), ml = !m.completed && d != null && d < 0;
          return `<li class="${m.completed ? "done" : ""}"><button class="wk-node" data-act="ms" data-id="${id}" data-x="${m.id}" aria-pressed="${!!m.completed}" title="${m.completed ? "Mark not done" : "Mark done"}"><svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.6 9.6 3.6"/></svg></button>
            <span class="t">${esc(m.title)}</span>${m.targetDate ? `<span class="d${ml ? " late" : ""}" title="${esc(relDay(m.targetDate))}">${esc(fmtDate(m.targetDate) || m.targetDate)}</span>` : "<span></span>"}${del("ms", id, m.id)}</li>`; }).join("")}</ol>`
          : `<p class="wk-none">Break it into steps — progress then fills itself in.</p>`,
        `<form class="wk-subadd" data-add="ms" data-id="${id}" autocomplete="off"><input class="in grow" name="a" placeholder="Next milestone" required /><input class="in" type="date" name="b" aria-label="Milestone date" /><button class="btn sm">Add</button></form>`, "ms")}

      ${sec("Production assets", assets.length,
        assets.length ? `<div class="wk-assets">${assets.map((a) => `<div class="wk-asset"><span class="ty">${esc(a.assetType || "Other")}</span>${a.url ? `<a href="${esc(href(a.url))}" target="_blank" rel="noopener" title="${esc(a.url)}">${esc(a.label || a.url)}</a>` : `<b>${esc(a.label)}</b>`}<small>${esc(where(a.url))}</small>${del("asset", id, a.id)}</div>`).join("")}</div>` : `<p class="wk-none">Scripts, renders, footage, design files — links or Windows paths.</p>`,
        `<form class="wk-subadd" data-add="asset" data-id="${id}" autocomplete="off"><input class="in grow" name="a" placeholder="Label" required /><input class="in grow" name="b" placeholder="URL or C:\\path\\to\\file" /><select class="in" name="c" aria-label="Asset type">${opts(ASSET_TYPES, "Asset")}</select><button class="btn sm">Add</button></form>`)}

      ${sec("Iteration notes", notes.length,
        notes.length ? `<ol class="wk-log">${[...notes].reverse().map((n) => `<li><span class="d">${esc(fmtDate(n.date) || n.date || "")}</span><p>${esc(n.text)}</p>${del("note", id, n.id)}</li>`).join("")}</ol>` : `<p class="wk-none">What changed, what you learned — dated automatically.</p>`,
        `<form class="wk-subadd" data-add="note" data-id="${id}" autocomplete="off"><input class="in grow" name="a" placeholder="What changed, what you learned…" required /><button class="btn sm">Log</button></form>`)}

      ${sec("Version history", vers.length,
        vers.length ? `<ol class="wk-vers">${[...vers].reverse().map((v, i) => `<li class="${i === 0 ? "cur" : ""}"><span class="v">${esc(v.version)}</span><p>${esc(v.notes || "")}</p><span class="d">${esc(fmtDate(v.date) || v.date || "")}</span>${del("ver", id, v.id)}</li>`).join("")}</ol>` : `<p class="wk-none">Cut a version when something ships.</p>`,
        `<form class="wk-subadd" data-add="ver" data-id="${id}" autocomplete="off"><input class="in" name="a" placeholder="v1.0" style="width:84px" required /><input class="in grow" name="b" placeholder="What's in it" /><button class="btn sm">Add</button></form>`)}

      ${sec("Collaborators", people.length,
        people.length ? `<div class="wk-people">${people.map((c) => `<span class="wk-person" style="--pc:${PEOPLE_COLORS[hue(c.name) % PEOPLE_COLORS.length]}"><i>${esc((c.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</i><span><b>${esc(c.name)}</b>${c.role ? `<small>${esc(c.role)}</small>` : ""}</span>${del("person", id, c.id, "Remove")}</span>`).join("")}</div>` : `<p class="wk-none">Just you so far.</p>`,
        `<form class="wk-subadd" data-add="person" data-id="${id}" autocomplete="off"><input class="in grow" name="a" placeholder="Name" required /><input class="in grow" name="b" placeholder="Role (editor, director…)" /><button class="btn sm">Add</button></form>`)}

      <div class="wk-end"><button class="btn ghost sm wk-danger" data-act="del-project" data-id="${id}">Delete project</button></div>
    </div>
  </aside>`;
}

/* ---------- progress that moves: every bar, ring and number tweens from what it showed last ---------- */
function liven(scope) {
  if (!scope) return;
  const els = scope.querySelectorAll("[data-pid]");
  const go = !still();
  const next = new Map();
  els.forEach((el) => {
    const id = el.dataset.pid, to = +(el.dataset.bar ?? el.dataset.ring ?? el.dataset.num);
    const from = ui.shown.has(id) ? ui.shown.get(id) : appRef?.entering ? 0 : to;
    next.set(id, to);
    if (!go || from === to) return;
    const ease = to > from ? "outBack(2.2)" : "outQuart";
    if ("bar" in el.dataset) animate(el, { width: [`${from}%`, `${to}%`], duration: 700, delay: 80, ease });
    else if ("ring" in el.dataset) animate(el, { strokeDashoffset: [100 - from, 100 - to], duration: 800, delay: 80, ease });
    else { const o = { v: from }; el.textContent = from; animate(o, { v: to, duration: 700, delay: 80, ease: "outQuart", onUpdate: () => (el.textContent = Math.round(o.v)) }); }
  });
  next.forEach((v, k) => ui.shown.set(k, v));
}

/* ---------- events ---------- */
function setStatus(p, s, from) {
  if (!p || p.status === s) return false;
  p.status = s; commit();
  if (s === "Completed" && from) pulse(from.x, from.y, "var(--green)", 60);
  toast(`${p.name} → ${s}`);
  return true;
}

function wire(root, app) {
  root.onsubmit = (e) => {
    const form = e.target;
    e.preventDefault();
    const f = new FormData(form);
    if (form.id === "wk-new") {
      const name = (f.get("name") || "").trim();
      if (!name) return;
      const p = { id: newId(), name, description: (f.get("description") || "").trim(), status: f.get("status"), category: f.get("category"), priority: f.get("priority"),
        targetDate: f.get("target") || "", createdDate: today(), progressPct: 0, milestones: [], assetLinks: [], iterationNotes: [], versionHistory: [], collaborators: [] };
      db.projects.push(p); ui.adding = false; ui.sel = p.id; ui.opening = true;
      if (!inFilter(p, ui.filter)) ui.filter = "All";
      commit(); app.refresh(); toast("Project added");
      return;
    }
    if (!form.classList.contains("wk-subadd")) return;
    const p = find(form.dataset.id), a = (f.get("a") || "").trim(), b = (f.get("b") || "").trim();
    if (!p || !a) return;
    const add = { ms: () => (p.milestones ||= []).push({ id: newId(), title: a, targetDate: b, completed: false }),
      asset: () => (p.assetLinks ||= []).push({ id: newId(), label: a, url: b, assetType: f.get("c") }),
      note: () => (p.iterationNotes ||= []).push({ id: newId(), date: today(), text: a }),
      ver: () => (p.versionHistory ||= []).push({ id: newId(), version: a, date: today(), notes: b }),
      person: () => (p.collaborators ||= []).push({ id: newId(), name: a, role: b }) };
    add[form.dataset.add]?.();
    commit(); repaint(root);
    root.querySelector(`.wk-subadd[data-add="${form.dataset.add}"] input`)?.focus();
  };

  root.oninput = (e) => {
    const el = e.target;
    if (el.dataset.f !== "progressPct") return;
    const v = +el.value || 0;
    root.querySelectorAll(`#wk-dock [data-pid="${el.dataset.id}"]`).forEach((x) => { if ("ring" in x.dataset) x.style.strokeDashoffset = 100 - v; else if ("num" in x.dataset) x.textContent = v; });
    root.querySelectorAll("#wk-dock .wk-dial line").forEach((ln, i) => ln.classList.toggle("lit", (i / 40) * 100 < v));
  };

  root.onchange = (e) => {
    const el = e.target, k = el.dataset.f;
    if (!k) return;
    const p = find(el.dataset.id);
    if (!p) return;
    if (k === "name") { const v = el.value.trim(); if (!v) { el.value = p.name; return; } p.name = v; commit(); paintMain(root); return; }
    if (k === "description") { p.description = el.value; commit(); paintMain(root); return; }
    if (k === "progressPct") { p.progressPct = Math.max(0, Math.min(100, +el.value || 0)); ui.shown.set(p.id, p.progressPct); commit(); app.refresh(); return; }
    p[k] = el.value; commit(); app.refresh();
  };

  root.onkeydown = (e) => {
    const c = e.target.closest?.(".wk-card");
    if (!c) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(root, c.dataset.id); return; }
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const p = find(c.dataset.id), i = STATUSES.indexOf(p.status), j = Math.max(0, Math.min(STATUSES.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
      const r = c.getBoundingClientRect();
      if (setStatus(p, STATUSES[j], { x: r.left + r.width / 2, y: r.top + r.height / 2 })) {
        if (!inFilter(p, ui.filter)) ui.filter = "All";
        app.refresh();
        const n = root.querySelector(`.wk-card[data-id="${p.id}"]`); n?.focus(); land(n);
      }
    }
  };

  root.onclick = (e) => {
    if (ui.suppressClick) { ui.suppressClick = false; return; }
    if (e.target.closest("a")) return;
    const b = e.target.closest("[data-act], .wk-card");
    if (!b) return;
    if (!b.dataset.act) return open(root, b.dataset.id);
    const p = b.dataset.id && find(b.dataset.id), x = b.dataset.x;
    const drop = (key) => (p[key] = (p[key] || []).filter((y) => y.id !== x));
    switch (b.dataset.act) {
      case "view": ui.view = b.dataset.v; store.set("hub.projects.view", ui.view); paintMain(root); root.querySelectorAll("[data-act=view]").forEach((v) => { v.classList.toggle("on", v === b); v.setAttribute("aria-pressed", v === b); }); return;
      case "adding": ui.adding = !ui.adding; return app.refresh();
      case "filter": ui.filter = b.dataset.f; return app.refresh();
      case "sort": ui.sort = b.dataset.s; root.querySelectorAll("[data-act=sort]").forEach((v) => v.classList.toggle("on", v === b)); return paintMain(root);
      case "open": return open(root, b.dataset.id);
      case "close": return close(root);
      case "status": { const r = b.getBoundingClientRect(); if (setStatus(p, b.dataset.s, { x: r.left + r.width / 2, y: r.top })) app.refresh(); return; }
      case "prio": p.priority = b.dataset.p; commit(); return repaint(root);
      case "ms": {
        const m = (p.milestones || []).find((y) => y.id === x);
        if (!m) return;
        const before = progressOf(p);
        m.completed = !m.completed; commit(); repaint(root);
        const dialEl = root.querySelector(".wk-dial");
        if (!still()) {
          animate(root.querySelector(`.wk-node[data-x="${x}"]`), { scale: [0.6, 1.25, 1], duration: 420, ease: "outQuart" });
          if (dialEl) animate(dialEl, { scale: [1, 1.06, 0.98, 1], duration: 520, ease: "outQuart" });
        }
        if (progressOf(p) === 100 && before < 100 && dialEl) { const r = dialEl.getBoundingClientRect(); pulse(r.left + r.width / 2, r.top + r.height / 2, "var(--green)", 70); toast("All milestones done"); }
        return;
      }
      case "del-ms": drop("milestones"); break;
      case "del-asset": drop("assetLinks"); break;
      case "del-note": drop("iterationNotes"); break;
      case "del-ver": drop("versionHistory"); break;
      case "del-person": drop("collaborators"); break;
      case "del-project":
        if (!confirm(`Delete project “${p.name}” and everything in it?`)) return;
        db.projects = db.projects.filter((y) => y !== p); ui.sel = null; commit(); toast("Project deleted"); return app.refresh();
      default: return;
    }
    commit(); repaint(root);
  };

  root.onpointerdown = (e) => {
    const c = e.target.closest(".wk-card");
    if (!c || e.button !== 0 || ui.view !== "board") return;
    drag(root, app, c, e);
  };
}

function repaint(root) { ui.scroll = root.querySelector(".wk-drawer-b")?.scrollTop || 0; paintMain(root); paintDock(root); }

function open(root, id) {
  if (!find(id)) return;
  ui.sel = id; ui.opening = true; ui.scroll = 0;
  root.querySelectorAll(".wk-card.sel, .wk-row.sel").forEach((x) => x.classList.remove("sel"));
  root.querySelectorAll(`[data-row="${id}"]`).forEach((x) => x.classList.add("sel"));
  paintDock(root);
  root.querySelector(".wk-title")?.focus({ preventScroll: true });
}
function close(root) {
  const id = ui.sel;
  if (!id) return;
  ui.sel = null;
  const done = () => { paintDock(root); root.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); root.querySelector(`[data-row="${id}"]`)?.focus({ preventScroll: true }); };
  const dr = root.querySelector(".wk-drawer");
  if (!dr || still()) return done();
  animate(root.querySelector(".wk-scrim"), { opacity: [1, 0], duration: 180 });
  animate(dr, { translateX: [0, -8, 70], opacity: [1, 1, 0], duration: 260, ease: "inQuad", onComplete: done });
}

// Esc closes the drawer (one listener for the life of the page)
addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !ui.sel) return;
  const root = document.querySelector(".wkshop")?.parentElement;
  if (root && root.querySelector(".wk-drawer")) { e.preventDefault(); close(root); }
});

/* a card lands somewhere new: squash and settle */
function land(el, from) {
  if (!el || still()) return;
  if (from) {
    const r = el.getBoundingClientRect();
    animate(el, { translateX: [from.left - r.left, 0], translateY: [from.top - r.top, 0], rotate: [from.rot || 0, 0], duration: 460, ease: "outBack(1.8)" });
    animate(el, { scaleX: [1.06, 0.94, 1.02, 1], scaleY: [0.92, 1.06, 0.99, 1], duration: 520, delay: 300, ease: "outQuad" });
  } else animate(el, { scale: [0.9, 1.06, 1], duration: 420, ease: "outQuart" });
}

/* pointer drag across columns: the card lifts, tilts with your speed, drops with a squash */
function drag(root, app, cardEl, e0) {
  const id = cardEl.dataset.id, sx = e0.clientX, sy = e0.clientY;
  const o = { x: 0, y: 0, r: 0, s: 1 };
  let ghost = null, over = null, lastX = sx;
  const apply = () => ghost && (ghost.style.transform = `translate(${o.x}px, ${o.y}px) rotate(${o.r.toFixed(2)}deg) scale(${o.s.toFixed(3)})`);
  const colAt = (x, y) => document.elementFromPoint(x, y)?.closest?.(".wk-col");
  const move = (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!ghost) {
      if (Math.hypot(dx, dy) < 6) return;
      const rect = cardEl.getBoundingClientRect();
      ghost = cardEl.cloneNode(true);
      ghost.classList.add("wk-ghost"); ghost.classList.remove("sel"); ghost.removeAttribute("data-row"); ghost.removeAttribute("tabindex");
      Object.assign(ghost.style, { left: rect.left + "px", top: rect.top + "px", width: rect.width + "px" });
      document.body.append(ghost);
      cardEl.classList.add("wk-lifted");
      document.documentElement.classList.add("wk-dragging");
      if (!still()) animate(o, { s: [1, 1.06], duration: 240, ease: "outBack(3)", onUpdate: apply }); else o.s = 1.04;
    }
    const vx = e.clientX - lastX; lastX = e.clientX;
    o.x = dx; o.y = dy; o.r = Math.max(-9, Math.min(9, o.r * 0.7 + vx * 0.6));
    apply();
    const col = colAt(e.clientX, e.clientY);
    if (col !== over) { over?.classList.remove("over"); over = col; over?.classList.add("over"); }
  };
  const up = (e) => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    if (!ghost) return;
    ui.suppressClick = true; setTimeout(() => (ui.suppressClick = false), 0);
    over?.classList.remove("over");
    document.documentElement.classList.remove("wk-dragging");
    const p = find(id), s = over?.dataset.col, gr = ghost.getBoundingClientRect();
    if (p && s && s !== p.status) {
      setStatus(p, s, { x: e.clientX, y: e.clientY });
      ghost.remove();
      app.refresh();
      land(root.querySelector(`.wk-card[data-id="${id}"]`), { left: gr.left, top: gr.top, rot: o.r });
      return;
    }
    // dropped where it was (or outside the board): fly home
    const home = () => { ghost.remove(); cardEl.classList.remove("wk-lifted"); };
    if (still()) return home();
    animate(o, { x: 0, y: 0, r: 0, s: 1, duration: 360, ease: "outBack(1.6)", onUpdate: apply, onComplete: home });
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
}
