// Reminders — don't forget. Same data and rules as reminders_tab.py:
// reminders[{id,title,description,priority: High|Medium|Low,completed,createdDate}].
// Priority is heat: High burns at the top ("now"), Medium smoulders ("soon"), Low is cooled ash ("someday").
import { db, commit, newId, today, daysFromToday } from "../store.js";
import { esc, fmtDate, plural, toast } from "../ui.js";
import { stagger } from "../../vendor/anime.esm.min.js";
import { animateAny as animate } from "../motion.js";
import { motionEnabled } from "../background.js";
import { richText, maskPlain, resetVault, secretValue, mask } from "./reminders-secrets.js";

const RANK = { High: 0, Medium: 1, Low: 2 };
const SORTS = { Priority: (a, b) => RANK[a.priority] - RANK[b.priority] || (b.createdDate || "").localeCompare(a.createdDate || ""),
  "A–Z": (a, b) => a.title.localeCompare(b.title), "Newest first": (a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""),
  "Oldest first": (a, b) => (a.createdDate || "").localeCompare(b.createdDate || "") };
const LANES = { High: { name: "Now", sub: "burning", heat: "#ff5a3c" }, Medium: { name: "Soon", sub: "smouldering", heat: "#ffaa3c" }, Low: { name: "Someday", sub: "cooling", heat: "#9aa9cc" } };
const heat = (p) => (LANES[p] || LANES.Low).heat;
const ui = { sort: "Priority", showDone: false, priority: "High", edit: null };

/* Nudges — settings for the Windows notifications the hub server sends (see nudges.js) */
const KINDS = {
  outside: { label: "Step outside", done: "I went outside", every: [30, 45, 60, 90, 120, 180], def: 90 },
  write: { label: "Write", done: "I wrote today", every: [60, 120, 180, 240, 360, 480], def: 240 },
  review: { label: "Weekly review", weekly: true },   // Sunday evening; clicking it opens the Weekly review page
};
function nudges() {
  const n = (db.nudges ||= {});
  n.from ||= "09:00"; n.to ||= "22:00";
  for (const [k, v] of Object.entries(KINDS)) n[k] = v.weekly ? { enabled: true, at: "19:00", ...(n[k] || {}) } : { enabled: true, everyMinutes: v.def, log: [], ...(n[k] || {}) };
  return n;
}
const span = (m) => (m < 60 ? `${m} min` : `${m / 60} h`);
function nudgeLog(k) {
  if (KINDS[k].weekly) return "opens your week on Sunday evenings";
  const log = nudges()[k].log, month = today().slice(0, 7), n = log.filter((d) => d.startsWith(month)).length;
  if (k === "write") return log.includes(today()) ? "wrote today ✓ — no more writing nudges today" : n ? `wrote on ${plural(n, "day")} this month` : "nothing written this month yet";
  return n ? `outside ${plural(n, "time")} this month · last ${fmtDate(log.at(-1))}` : "no time outside logged this month yet";
}
function nudgeCard() {
  const n = nudges();
  return `<section class="card rm-nudges rm-in"><header class="card-h"><div><span class="rm-k">nudges</span><h3>Taps on the shoulder</h3>
      <p class="sub">Windows notifications that pop up over whatever you're doing and stay until you dismiss them. Skipped while you're away from the computer.</p></div></header>
    <div class="card-b">${Object.entries(KINDS).map(([k, v]) => `<div class="rm-nk${n[k].enabled ? " on" : ""}">
        <div class="rm-nk-top">
          <button class="rm-sw${n[k].enabled ? " on" : ""}" data-act="n-on" data-k="${k}" aria-pressed="${!!n[k].enabled}" aria-label="${v.label} nudges ${n[k].enabled ? "on" : "off"}"><i></i><span>${n[k].enabled ? "On" : "Off"}</span></button>
          <b>${v.label}</b><span class="sp"></span>
          ${v.weekly ? `<span class="rm-k dim">sun</span><input class="in" type="time" data-nat="${k}" value="${esc(n[k].at)}" aria-label="${v.label}: Sundays at" />` : `<select class="in" data-nk="${k}" aria-label="${v.label}: every">${v.every.map((m) => `<option value="${m}"${+n[k].everyMinutes === m ? " selected" : ""}>every ${span(m)}</option>`).join("")}</select>`}
        </div>
        <p class="rm-ns" id="ns-${k}">${nudgeLog(k)}</p>
        <div class="rm-nk-acts"><button class="btn ghost sm" data-act="n-test" data-k="${k}">Test</button>
          ${v.done ? `<button class="btn sm rm-done-b" data-act="n-done" data-k="${k}">${v.done}</button>` : `<button class="btn sm rm-done-b" data-go-review>Open review</button>`}</div></div>`).join("")}
      <div class="rm-quiet"><span class="rm-k dim rm-q-l">quiet hours · only nudge between</span><input class="in" type="time" id="nFrom" value="${esc(n.from)}" aria-label="Nudges start" />
        <span class="rm-k dim">and</span><input class="in" type="time" id="nTo" value="${esc(n.to)}" aria-label="Nudges end" /></div></div></section>`;
}
async function nudgeStatus(root) {
  try {
    const s = await (await fetch("/api/nudge", { cache: "no-store" })).json();
    for (const k of Object.keys(KINDS)) {
      const el = root.querySelector(`#ns-${k}`);
      if (!el?.isConnected) continue;
      const when = s.off || !s[k] ? "notifications are off on this server" : !s[k].enabled ? "off"
        : KINDS[k].weekly ? `next on ${new Date(s[k].nextAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : !s.inHours ? `quiet until ${s.from}` : `next nudge around ${new Date(s[k].nextAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      el.textContent = `${nudgeLog(k)} · ${when}`;
    }
  } catch {}
}

/* ---------- reminder cards ---------- */
const CHECK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PEN = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5L6 12.5H3.5V10z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

function age(r) {
  const d = daysFromToday(r.createdDate);
  if (d == null) return "";
  return d >= 0 ? "new today" : d === -1 ? "since yesterday" : `waiting ${-d} days`;
}
function item(r) {
  if (ui.edit === r.id) return editItem(r);
  const d = -(daysFromToday(r.createdDate) ?? 0), glow = r.completed ? 0 : Math.min(1, Math.max(0, d) / 120);
  return `<article class="rm-item p-${esc((r.priority || "Low").toLowerCase())}${r.completed ? " done" : ""}" data-row="${r.id}" style="--c:${heat(r.priority)};--age:${glow.toFixed(2)}">
    <button class="rm-check${r.completed ? " on" : ""}" data-act="toggle" data-id="${r.id}" aria-pressed="${!!r.completed}" aria-label="${r.completed ? "Mark not done" : "Mark done"}">${CHECK}</button>
    <div class="rm-body">
      <h4 class="rm-title">${richText(r.title)}</h4>
      ${r.description ? `<div class="rm-desc">${richText(r.description)}</div>` : ""}
      <div class="rm-meta">${ui.sort !== "Priority" || r.completed ? `<span class="rm-pr">${esc(r.priority)}</span>` : ""}<span>${r.completed ? "done" : esc(age(r))}</span><span>added ${fmtDate(r.createdDate, { year: true })}</span></div>
    </div>
    <span class="rm-acts"><button class="rm-ic" data-act="edit" data-id="${r.id}" aria-label="Edit reminder">${PEN}</button><button class="x" data-act="del" data-id="${r.id}" aria-label="Delete reminder">×</button></span>
  </article>`;
}
const prioRadios = (name, sel) => `<div class="rm-heat" role="radiogroup" aria-label="Priority">${Object.keys(LANES).map((p) =>
  `<label style="--c:${heat(p)}"><input type="radio" name="${name}" value="${p}"${sel === p ? " checked" : ""} /><span>${p}</span></label>`).join("")}</div>`;
function editItem(r) {
  return `<form class="rm-item rm-edit" data-row="${r.id}" data-edit="${r.id}" style="--c:${heat(r.priority)}">
    <div class="rm-body">
      <input class="in" name="title" value="${esc(r.title)}" required aria-label="Title" />
      <textarea class="in" name="description" rows="3" placeholder="Description or link (optional)" aria-label="Description">${esc(r.description || "")}</textarea>
      <div class="rm-edit-a">${prioRadios("priority", r.priority)}<span class="sp"></span><button type="button" class="btn ghost sm" data-act="cancel">Cancel</button><button class="btn sm">Save</button></div>
    </div></form>`;
}

function lanes(pending) {
  if (ui.sort !== "Priority")
    return `<section class="rm-lane flat"><header class="rm-lane-h"><b>Everything pending</b><span class="rm-k dim">sorted ${esc(ui.sort.toLowerCase())}</span></header>${pending.map(item).join("") || `<p class="rm-empty">Nothing pending. Nice.</p>`}</section>`;
  return Object.entries(LANES).map(([p, l]) => {
    const rs = pending.filter((r) => (r.priority in LANES ? r.priority : "Low") === p);
    return `<section class="rm-lane l-${p.toLowerCase()}" style="--c:${l.heat}">
      <header class="rm-lane-h"><b>${l.name}</b><span class="rm-k">${p} · ${l.sub}</span><span class="rm-n">${rs.length}</span></header>
      ${rs.map(item).join("") || `<p class="rm-empty">${p === "High" ? "Nothing burning. Breathe." : "Empty."}</p>`}</section>`;
  }).join("");
}

export default {
  id: "reminders", label: "Reminders", color: "var(--red)",
  count: () => db.reminders.filter((r) => !r.completed).length,
  render(root, app, focus) {
    if (focus) { ui.edit = null; if (db.reminders.find((r) => r.id === focus)?.completed) ui.showDone = true; }
    resetVault();
    const pending = db.reminders.filter((r) => !r.completed).sort(SORTS[ui.sort]);
    const done = db.reminders.filter((r) => r.completed).sort(SORTS[ui.sort]);
    const by = (p) => pending.filter((r) => r.priority === p).length;
    const oldest = pending.filter((r) => r.priority === "High").map((r) => -(daysFromToday(r.createdDate) ?? 0)).reduce((a, b) => Math.max(a, b), 0);

    root.innerHTML = `<div class="page-h rm-headline"><h1>Reminders</h1><span class="sub">${pending.length} pending · ${done.length} done</span><span class="sp"></span>
        <div class="rm-gauge" aria-label="Pending by priority">${Object.entries(LANES).map(([p, l]) => `<span style="--c:${l.heat}"><b>${by(p)}</b>${l.name.toLowerCase()}</span>`).join("")}
          ${oldest > 0 ? `<span class="rm-old"><b>${oldest}d</b>oldest burning</span>` : ""}</div></div>
      <form class="addbar rm-add rm-in" id="add">
        <input class="in grow" name="title" placeholder="Remind me to…" autocomplete="off" required aria-label="Reminder" />
        <input class="in grow" name="description" placeholder="Description or link (optional)" autocomplete="off" aria-label="Description" />
        ${prioRadios("newprio", ui.priority)}
        <button class="btn">Add</button>
      </form>
      <div class="rm-cols">
        <div class="rm-main rm-in">
          <div class="rm-tools"><span class="rm-k dim">sort</span><div class="chips">${Object.keys(SORTS).map((s) => `<button class="chip${ui.sort === s ? " on" : ""}" data-act="sort" data-s="${s}">${s}</button>`).join("")}</div>
            <span class="sp"></span><button class="chip${ui.showDone ? " on" : ""}" data-act="showdone">${ui.showDone ? "Hide done" : `Show done (${done.length})`}</button></div>
          ${lanes(pending)}
          ${ui.showDone && done.length ? `<section class="rm-lane l-done"><header class="rm-lane-h"><b>Done</b><span class="rm-k dim">ashes</span><span class="rm-n">${done.length}</span></header>${done.map(item).join("")}</section>` : ""}
        </div>
        <aside class="rm-side">${nudgeCard()}</aside>
      </div>`;

    if (app.entering && motionEnabled()) {
      animate(root.querySelectorAll(".rm-in"), { opacity: [0, 1], translateY: [14, 0], delay: stagger(60), duration: 480, ease: "outBack(1.4)" });
      animate(root.querySelectorAll(".rm-item"), { opacity: [0, 1], translateX: [-14, 0], delay: stagger(28, { start: 120 }), duration: 420, ease: "outBack(1.8)" });
    }

    const add = root.querySelector("#add");
    add.onchange = (e) => { if (e.target.name === "newprio") ui.priority = e.target.value; };
    add.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const title = f.get("title").trim(); if (!title) return;
      db.reminders.push({ id: newId(), title, description: f.get("description").trim(), priority: ui.priority, completed: false, createdDate: today() });
      commit(); app.refresh(); root.querySelector("#add [name=title]").focus(); toast("Reminder added");
    };
    root.onsubmit = (e) => {   // inline edit
      const form = e.target.closest("[data-edit]");
      if (!form) return;
      e.preventDefault();
      const r = db.reminders.find((x) => x.id === form.dataset.edit), f = new FormData(form), title = f.get("title").trim();
      if (!r || !title) return;
      Object.assign(r, { title, description: f.get("description").trim(), priority: f.get("priority") || r.priority });
      ui.edit = null; commit(); app.refresh(); toast("Saved");
    };
    root.onkeydown = (e) => {
      const form = e.target.closest?.("[data-edit]");
      if (!form) return;
      if (e.key === "Escape") { e.preventDefault(); ui.edit = null; app.refresh(); }
      if (e.key === "Enter" && e.target.tagName === "TEXTAREA" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
    };

    nudgeStatus(root);
    const setN = (fn) => { fn(nudges()); commit(); setTimeout(() => nudgeStatus(root), 900); };
    root.querySelectorAll("[data-nat]").forEach((inp) => (inp.onchange = () => inp.value && setN((n) => (n[inp.dataset.nat].at = inp.value))));
    root.querySelectorAll("[data-nk]").forEach((sel) => (sel.onchange = () => setN((n) => (n[sel.dataset.nk].everyMinutes = +sel.value))));
    root.querySelector("#nFrom").onchange = (e) => e.target.value && setN((n) => (n.from = e.target.value));
    root.querySelector("#nTo").onchange = (e) => e.target.value && setN((n) => (n.to = e.target.value));
    root.onclick = async (e) => {
      if (e.target.closest("[data-go-review]")) return app.go("review");
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const k = b.dataset.k;
      // (the old `nudges()[k].enabled = !nudges()[k].enabled` wrote to an object the second nudges() call had already replaced)
      if (b.dataset.act === "n-on") { const n = nudges(); n[k].enabled = !n[k].enabled; commit(); return app.refresh(); }
      if (b.dataset.act === "n-test") {
        b.disabled = true;
        const r = await fetch(`/api/nudge/test?kind=${k}`, { method: "POST" }).then((x) => x.json()).catch(() => ({}));
        b.disabled = false;
        return toast(r.result === "shown" ? "Sent — look at the bottom-right of your screen" : r.off ? "Notifications are off on this server" : "Windows didn't show it — check Focus assist / Do not disturb");
      }
      if (b.dataset.act === "n-done") {
        const log = nudges()[k].log;
        if (!(k === "write" && log.includes(today()))) log.push(today());
        commit();
        fetch(`/api/nudge/done?kind=${k}`, { method: "POST" }).catch(() => {});
        toast(k === "write" ? "Logged. No more writing nudges today." : "Nice. The clock starts over.");
        return app.refresh();
      }
      if (b.dataset.act === "sec-show") {
        const chip = b.closest(".rm-secret"), v = chip.querySelector(".rm-sec-v"), raw = secretValue(b.dataset.sid);
        if (raw == null) return;
        const show = !chip.classList.contains("open");
        chip.classList.toggle("open", show); v.textContent = show ? raw : mask(raw); b.textContent = show ? "hide" : "show";
        clearTimeout(chip._t);
        if (show) chip._t = setTimeout(() => { if (chip.isConnected) { chip.classList.remove("open"); v.textContent = mask(raw); b.textContent = "show"; } }, 30000);
        return;
      }
      if (b.dataset.act === "sec-copy") {
        const raw = secretValue(b.dataset.sid);
        if (raw == null) return;
        try { await navigator.clipboard.writeText(raw); } catch {
          const ta = Object.assign(document.createElement("textarea"), { value: raw }); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
        }
        b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1400);
        return toast("Copied to the clipboard");
      }
      const r = db.reminders.find((x) => x.id === b.dataset.id);
      switch (b.dataset.act) {
        case "toggle": {
          const row = b.closest(".rm-item");
          r.completed = !r.completed; commit();
          if (!motionEnabled() || !row) return app.refresh();
          animate(b, { scale: [0.6, 1.3, 1], duration: 320, ease: "outBack(3)" });
          return animate(row, { opacity: [1, 0.25], translateX: [0, r.completed ? 18 : -18], duration: 260, delay: 140, ease: "inQuad", onComplete: () => app.refresh() });
        }
        case "del": if (!r || !confirm(`Delete “${maskPlain(r.title)}”?`)) return; db.reminders = db.reminders.filter((x) => x !== r); break;
        case "edit": ui.edit = b.dataset.id; app.refresh(); return requestAnimationFrame(() => root.querySelector("[data-edit] [name=title]")?.focus());
        case "cancel": ui.edit = null; return app.refresh();
        case "sort": ui.sort = b.dataset.s; return app.refresh();
        case "showdone": ui.showDone = !ui.showDone; return app.refresh();
        default: return;
      }
      commit(); app.refresh();
    };
  },
};
