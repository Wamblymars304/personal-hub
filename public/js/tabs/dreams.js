// Dreams — a dream journal. A quick box at the top to write one down right after waking; below, every
// dream grouped by month, newest first. Click a dream to read it in full, edit it, tag it or move it.
// The Samsung Notes "Dreams" folder is imported here by tools/import_samsung_notes.py.
// Item: { id, title, text, date, added_date, tags, image, images?, video?, source, sid } — images/video live in data/dream-media/
import { db, commit, newId, today, parseTags, parseDate } from "../store.js";
import { esc, fmtDate, chip, empty, plural, linkify, toast } from "../ui.js";

const ui = { q: "", tag: "", open: new Set(), editing: null, view: "journal", star: "" };
const paras = (t) => (t || "").split(/\n{2,}/).map((p) => `<p>${linkify(p).replace(/\n/g, "<br>")}</p>`).join("");
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

export default {
  id: "dreams", label: "Dreams", color: "var(--purple)",
  count: () => db.dreams?.length || null,
  render(root, app, focus) {
    db.dreams ||= [];
    if (focus) { ui.open.add(focus); ui.q = ""; ui.tag = ""; }
    const all = db.dreams, q = ui.q.trim().toLowerCase();
    const list = all.filter((d) => (!ui.tag || (d.tags || []).includes(ui.tag)) && (!q || `${d.title}\n${d.text}\n${(d.tags || []).join(" ")}`.toLowerCase().includes(q)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.added_date || "").localeCompare(a.added_date || ""));
    const tags = [...new Set(all.flatMap((d) => d.tags || []))].sort();
    const month = today().slice(0, 7), first = all.map((d) => d.date).filter(Boolean).sort()[0];
    const groups = [];
    for (const d of list) { const k = (d.date || "").slice(0, 7); (groups.at(-1)?.k === k ? groups.at(-1).items : (groups.push({ k, items: [] }), groups.at(-1).items)).push(d); }

    const head = `<div class="page-h"><h1>Dreams</h1><span class="sub">${plural(all.length, "dream")}${first ? ` · since ${fmtDate(first)}` : ""} · ${all.filter((d) => (d.date || "").startsWith(month)).length} this month</span><span class="sp"></span>
        <div class="seg"><button class="${ui.view === "journal" ? "on" : ""}" data-act="view" data-v="journal">Journal</button><button class="${ui.view === "atlas" ? "on" : ""}" data-act="view" data-v="atlas">Atlas</button></div></div>`;
    if (ui.view === "atlas") { root.innerHTML = head + atlasView(all); return wire(root, app); }
    root.innerHTML = `${head}
      <form class="card dream-compose" id="dadd">
        <textarea class="in" name="text" rows="3" placeholder="What did you dream? Write it before it fades…" required></textarea>
        <div class="toolbar" style="margin:0"><input class="in grow" name="title" placeholder="Title (optional)" autocomplete="off" />
          <input class="in" type="date" name="date" value="${today()}" /><input class="in grow" name="tags" placeholder="tags: lucid, flying, recurring…" autocomplete="off" />
          <button class="btn">Keep it</button></div></form>
      <div class="toolbar"><div class="chips">${tags.length ? chip("All", !ui.tag, 'data-act="tag" data-t=""') + tags.map((t) => chip(`#${esc(t)}`, ui.tag === t, `data-act="tag" data-t="${esc(t)}"`)).join("") : ""}</div>
        <span class="grow"></span><input class="in find" id="dq" placeholder="Search dreams…" value="${esc(ui.q)}" /></div>
      ${groups.map((g) => `<section class="dream-month"><h3>${g.k ? MONTH.format(parseDate(g.k + "-01")) : "Undated"}<span>${plural(g.items.length, "dream")}</span></h3>
          ${g.items.map(dreamCard).join("")}</section>`).join("")
        || empty(all.length ? "No dream matches." : "No dreams yet. Write one down the next time you wake up from one.")}`;
    wire(root, app);
  },
};

/* ---------- Dream atlas: who, where and what keeps coming back ---------- */
// Each entry: label → words that count as it (lowercase, matched as whole words). Tags you add become themes too.
const LEXICON = {
  people: {
    "Family": ["mom", "mother", "dad", "father", "mamá", "mama", "papá", "papa", "family", "brother", "sister", "grandma", "grandmother", "grandpa", "abuela", "abuelo", "cousin", "aunt", "uncle", "tía", "tío"],
    "Friends": ["friend", "friends", "classmate", "classmates"],
    "A girl": ["girl", "girls", "woman", "women", "lady"],
    "Strangers & crowds": ["stranger", "strangers", "crowd", "group", "everyone", "bunch of people"],
    "Aliens & creatures": ["alien", "aliens", "creature", "creatures", "monster", "monsters"],
    "Mascots & clowns": ["mascot", "mascots", "clown", "clowns"],
    "Younger me": ["young self", "younger", "as a kid", "child", "kid"],
  },
  places: {
    "Stores & malls": ["store", "stores", "shop", "shops", "supercenter", "walmart", "costco", "mall", "market", "supermarket"],
    "Home": ["home", "house", "backyard", "bedroom", "kitchen", "my room"],
    "School": ["school", "classroom", "university", "college"],
    "Hotel": ["hotel", "hotels"], "Station": ["station", "train", "subway", "bus"],
    "Town & streets": ["town", "city", "street", "streets", "barrio", "neighborhood"],
    "Water": ["ocean", "sea", "beach", "lake", "river", "pool", "water"],
    "Earth & sky": ["earth", "space", "planet", "sky", "stars"],
  },
  themes: {
    "Running & chases": ["running", "run", "ran", "chased", "chasing", "escape", "escaped", "escaping", "fleeing"],
    "Abduction": ["abducted", "abduction", "kidnapped", "taken away"],
    "Trapped": ["trapped", "stuck", "locked", "time limit", "couldn't leave"],
    "Sickness": ["virus", "sick", "disease", "infection", "infected"],
    "Fear": ["horrifying", "scared", "fear", "terrified", "horror", "creepy", "nightmare", "afraid"],
    "Flying & falling": ["flying", "fly", "floating", "falling", "fell"],
    "Another world": ["plane of existence", "dimension", "portal", "another world", "other world"],
    "Faces": ["face", "faces"], "Transformation": ["transformed", "turned into", "mutated", "remodeled"],
    "Time": ["years ago", "time limit", "future", "past"],
  },
};
const GROUP_COLOR = { people: "var(--pink)", places: "var(--cyan)", themes: "var(--purple)" };
const rx = (w) => new RegExp(`(^|[^\\p{L}'])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "iu");

function atlasData(dreams) {
  const nodes = [];
  for (const [group, entries] of Object.entries(LEXICON))
    for (const [label, words] of Object.entries(entries)) {
      const tests = words.map(rx);
      const ids = dreams.filter((d) => tests.some((t) => t.test(`${d.title} ${d.text}`))).map((d) => d.id);
      if (ids.length) nodes.push({ key: `${group}:${label}`, label, group, ids });
    }
  for (const t of new Set(dreams.flatMap((d) => d.tags || []))) {
    const ids = dreams.filter((d) => (d.tags || []).includes(t)).map((d) => d.id);
    if (!nodes.some((n) => n.label.toLowerCase() === t.toLowerCase())) nodes.push({ key: `tag:${t}`, label: `#${t}`, group: "themes", ids });
  }
  const links = [];
  nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => { const w = a.ids.filter((id) => b.ids.includes(id)).length; if (w) links.push({ a, b, w }); }));
  layout(nodes, links);
  return { nodes, links };
}

// a small deterministic force layout: everything repels, shared dreams pull together, groups drift to their own side
function layout(nodes, links, W = 900, H = 520) {
  const side = { people: [-0.28, -0.05], places: [0.28, -0.05], themes: [0, 0.3] };
  nodes.forEach((n, i) => { const [sx, sy] = side[n.group]; const a = i * 2.399; n.x = W / 2 + sx * W + Math.cos(a) * 60; n.y = H / 2 + sy * H + Math.sin(a) * 60; n.vx = n.vy = 0; n.r = 5 + Math.sqrt(n.ids.length) * 5; });
  for (let it = 0; it < 360; it++) {
    const k = 1 - it / 360;
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01;
      const f = 4200 / d2; a.vx += (dx / Math.sqrt(d2)) * f; a.vy += (dy / Math.sqrt(d2)) * f;
    }
    for (const { a, b, w } of links) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 140) * 0.005 * Math.min(3, w);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      const [sx, sy] = side[n.group];
      n.vx += (W / 2 + sx * W - n.x) * 0.004; n.vy += (H / 2 + sy * H - n.y) * 0.004;
      n.x += Math.max(-12, Math.min(12, n.vx * k)); n.y += Math.max(-12, Math.min(12, n.vy * k)); n.vx *= 0.5; n.vy *= 0.5;
      n.x = Math.max(70, Math.min(W - 160, n.x)); n.y = Math.max(30, Math.min(H - 30, n.y));
    }
  }
  // labels sit to the right of each star: push apart anything whose label boxes would overlap
  const box = (n) => ({ x0: n.x - n.r, x1: n.x + n.r + 12 + n.label.length * 6.6 + 14, y0: n.y - Math.max(n.r, 9), y1: n.y + Math.max(n.r, 9) });
  for (let it = 0; it < 200; it++) {
    let moved = false;
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      const A = box(a), B = box(b), ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ox <= 0 || oy <= 0) continue;
      const push = Math.min(oy + 2, 6) / 2, dir = a.y < b.y || (a.y === b.y && a.x < b.x) ? -1 : 1;
      a.y = Math.max(20, Math.min(H - 20, a.y + dir * push)); b.y = Math.max(20, Math.min(H - 20, b.y - dir * push)); moved = true;
    }
    if (!moved) break;
  }
}

function atlasView(all) {
  if (!all.length) return empty("Record a few dreams and the atlas draws itself.");
  const { nodes, links } = atlasData(all);
  const sel = nodes.find((n) => n.key === ui.star);
  const near = new Set(sel ? links.filter((l) => l.a === sel || l.b === sel).flatMap((l) => [l.a.key, l.b.key]) : []);
  const stars = Array.from({ length: 90 }, (_, i) => `<circle cx="${(i * 197) % 900}" cy="${(i * 113) % 520}" r="${(i % 3) * 0.4 + 0.3}" class="bgstar"/>`).join("");
  const top = [...nodes].sort((a, b) => b.ids.length - a.ids.length).slice(0, 10);
  const picked = sel ? all.filter((d) => sel.ids.includes(d.id)).sort((a, b) => (b.date || "").localeCompare(a.date || "")) : [];
  return `<div class="atlas-wrap">
    <section class="card atlas"><svg viewBox="0 0 900 520" role="img" aria-label="Constellation of recurring people, places and themes in your dreams">${stars}
      ${links.map((l) => `<line x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}" class="lk${sel && (l.a === sel || l.b === sel) ? " hot" : ""}" style="stroke-width:${0.6 + l.w * 0.7}"/>`).join("")}
      ${nodes.map((n) => `<g class="star${sel ? (n === sel ? " sel" : near.has(n.key) ? " near" : " dim") : ""}" data-act="star" data-k="${esc(n.key)}" style="--c:${GROUP_COLOR[n.group]}" tabindex="0">
        <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r * 2.2).toFixed(1)}" class="halo"/><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" class="core"/>
        <text x="${(n.x + n.r + 6).toFixed(1)}" y="${(n.y + 4).toFixed(1)}">${esc(n.label)}<tspan dx="5">${n.ids.length}</tspan></text></g>`).join("")}</svg>
      <div class="legend">${Object.entries(GROUP_COLOR).map(([g, c]) => `<span style="--c:${c}"><i></i>${g}</span>`).join("")}<span class="tag">bigger = in more dreams · lines = appear in the same dream · click a star</span></div></section>
    <section class="card atlas-side"><header class="panel-h"><h3>${sel ? esc(sel.label) : "What keeps coming back"}</h3>${sel ? `<div class="r"><button class="btn ghost sm" data-act="star" data-k="">Clear</button></div>` : ""}</header>
      <div class="panel-b">${sel ? `<p class="sub" style="margin:0 0 10px">${plural(sel.ids.length, "dream")} · ${sel.group}${near.size ? ` · often with ${[...near].filter((k) => k !== sel.key).map((k) => esc(k.split(":")[1])).slice(0, 4).join(", ")}` : ""}</p>
          ${picked.map((d) => `<button class="otd-item" data-act="read" data-id="${d.id}" style="--c:var(--purple)"><span class="k">${fmtDate(d.date)}</span><span class="t">${esc(d.title || "Untitled dream")}<small>${esc(d.text.replace(/\s+/g, " ").slice(0, 130))}</small></span></button>`).join("")}`
        : top.map((n) => `<button class="rec" data-act="star" data-k="${esc(n.key)}" style="--c:${GROUP_COLOR[n.group]}"><span>${esc(n.label)}</span><i style="width:${(n.ids.length / top[0].ids.length) * 100}%"></i><b>${n.ids.length}</b></button>`).join("")}</div></section>
  </div>`;
}

function dreamCard(d) {
  const open = ui.open.has(d.id), dt = parseDate(d.date);
  if (ui.editing === d.id) return `<article class="card dream open"><form class="dream-edit" data-id="${d.id}">
      <div class="toolbar" style="margin:0"><input class="in grow" name="title" value="${esc(d.title)}" placeholder="Title" />
        <input class="in" type="date" name="date" value="${esc(d.date)}" /><input class="in grow" name="tags" value="${esc((d.tags || []).join(", "))}" placeholder="tags" /></div>
      <textarea class="in" name="text" rows="10">${esc(d.text)}</textarea>
      <div class="toolbar" style="margin:0"><button class="btn">Save</button><button type="button" class="btn ghost" data-act="cancel">Cancel</button></div></form></article>`;
  return `<article class="card dream${open ? " open" : ""}" data-row="${d.id}">
    <div class="dd" data-act="toggle" data-id="${d.id}"><b>${dt ? dt.getDate() : "?"}</b><span>${dt ? WEEKDAY.format(dt) : ""}</span></div>
    <div class="dbody" data-act="toggle" data-id="${d.id}">
      <h4>${esc(d.title || "Untitled dream")}</h4>
      ${d.image ? `<img class="note-img" src="${esc(d.image)}" alt="Picture from this dream" />` : ""}
      ${(d.images || []).length ? `<div class="dream-pics">${d.images.map((u) => `<img src="${esc(u)}" alt="Picture from this dream" loading="lazy" />`).join("")}</div>` : ""}
      ${d.video ? `<video class="dream-video" src="${esc(d.video)}" muted loop autoplay playsinline${open ? " controls" : ""} aria-label="Clip for this dream"></video>` : ""}
      <div class="dtext">${paras(d.text)}</div>
      ${(d.tags || []).length ? `<div class="dtags">${d.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(" ")}</div>` : ""}
    </div>
    ${open ? `<div class="dacts"><button class="btn ghost sm" data-act="edit" data-id="${d.id}">Edit</button><button class="btn ghost sm" data-act="tonote" data-id="${d.id}">Move to Notes</button>
      <button class="btn ghost sm" style="color:var(--red)" data-act="del" data-id="${d.id}">Delete</button></div>` : ""}
  </article>`;
}

function wire(root, app) {
  const q = root.querySelector("#dq");
  if (q) q.oninput = () => { ui.q = q.value; const pos = q.selectionStart; app.refresh(); const nq = document.querySelector("#dq"); nq.focus(); nq.setSelectionRange(pos, pos); };
  if (root.querySelector("#dadd")) root.querySelector("#dadd").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target), text = f.get("text").trim();
    if (!text) return;
    const d = { id: newId(), title: f.get("title").trim(), text, date: f.get("date") || today(), added_date: today(), tags: parseTags(f.get("tags")), image: "", source: "hub" };
    db.dreams.push(d); ui.open.add(d.id); commit(); app.refresh(); toast("Dream kept");
  };
  root.querySelectorAll(".dream-edit").forEach((form) => (form.onsubmit = (e) => {
    e.preventDefault();
    const d = db.dreams.find((x) => x.id === form.dataset.id), f = new FormData(form);
    Object.assign(d, { title: f.get("title").trim(), date: f.get("date") || d.date, tags: parseTags(f.get("tags")), text: f.get("text") });
    ui.editing = null; commit(); app.refresh(); toast("Saved");
  }));
  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || e.target.closest("a")) return;
    const d = db.dreams.find((x) => x.id === b.dataset.id);
    switch (b.dataset.act) {
      case "toggle": ui.open.has(d.id) ? ui.open.delete(d.id) : ui.open.add(d.id); return app.refresh();
      case "tag": ui.tag = b.dataset.t; return app.refresh();
      case "view": ui.view = b.dataset.v; return app.refresh();
      case "star": ui.star = ui.star === b.dataset.k ? "" : b.dataset.k; return app.refresh();
      case "read": ui.view = "journal"; ui.open.add(b.dataset.id); app.refresh(); return document.querySelector(`[data-row="${b.dataset.id}"]`)?.scrollIntoView({ block: "center" });
      case "edit": ui.editing = d.id; return app.refresh();
      case "cancel": ui.editing = null; return app.refresh();
      case "del": if (!confirm(`Delete “${d.title || "this dream"}”?`)) return; db.dreams = db.dreams.filter((x) => x !== d); break;
      case "tonote": {
        db.notes ||= [];
        db.notes.push({ id: d.id, title: d.title || "Untitled", text: d.text, folder: "Unsorted", created: d.date || today(), modified: today(), image: d.image || "", pinned: false, source: d.source, sid: d.sid });
        db.dreams = db.dreams.filter((x) => x !== d);
        commit(); app.refresh(); return toast("Moved to Notes");
      }
      default: return;
    }
    commit(); app.refresh();
  };
}
