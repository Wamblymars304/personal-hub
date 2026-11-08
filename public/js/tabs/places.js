// Places — where you want to go, on a world map. Markers are colored by kind (liminal, cities, food,
// books…); click one for its photo, what your note said, a Wikipedia summary and links. Places from your
// travel notes come from tools/import_places.py; add more by searching (OpenStreetMap), or pin the vague
// ones by clicking the map. Item: { id, name, area, country, lat, lon, cat, said, noteId, noteTitle,
// wiki: { title, extract, url, thumb? }, image, status: "want" | "been", mine, added }.
// "Suggested for you" (written by a script, or by Claude, from your notes): hub.json "placeIdeas" [{ id, name, cat, why, lat, lon, wiki, dismissed }]
// shown as hollow markers, and "doIdeas" [{ id, text, why, dismissed }] — keep one (it joins your places and/or bucket
// list) or say "not for me".
import { db, commit, newId, today } from "../store.js";
import { esc, plural, toast, empty } from "../ui.js";
import * as L from "../../vendor/leaflet/leaflet-src.esm.js";

const CATS = {
  liminal: { label: "Liminal", color: "#b9a6ff" }, city: { label: "Cities", color: "#ff7a9a" }, food: { label: "Food", color: "#ffb347" },
  books: { label: "Books", color: "#7fd8e6" }, landmark: { label: "Landmarks", color: "#ffd36e" }, nature: { label: "Nature", color: "#8ff0c8" },
  pilgrimage: { label: "Pilgrimage", color: "#e8e4ff" }, science: { label: "Science & space", color: "#8fb4ff" }, other: { label: "Other", color: "#9aa3ad" },
};
const ui = { cat: "all", status: "all", sel: null, pinning: null, view: null, results: [], ideas: false, idea: null };
const ideas = () => (db.placeIdeas || []).filter((i) => !i.dismissed);
const todo = () => (db.doIdeas || []).filter((i) => !i.dismissed);
let map = null, layer = null, appRef = null;

if (!document.querySelector('link[href$="leaflet.css"]')) document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="vendor/leaflet/leaflet.css" />');

const places = () => (db.places ||= []);
const shown = () => places().filter((p) => p.lat != null && (ui.cat === "all" || p.cat === ui.cat) && (ui.status === "all" || p.status === ui.status));
const color = (p) => (CATS[p.cat] || CATS.other).color;
const gmaps = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat != null ? `${p.lat},${p.lon}` : p.name)}`;

export default {
  id: "places", label: "Places", color: "var(--pink)",
  count: () => places().filter((p) => p.status !== "been").length || null,
  render(root, app, focus) {
    appRef = app;
    if (focus === "ideas") { ui.ideas = true; ui.sel = null; ui.idea = null; }
    else if (focus) { ui.sel = focus; ui.ideas = false; }
    const all = places(), pinned = all.filter((p) => p.lat != null), countries = new Set(pinned.map((p) => p.country).filter(Boolean));
    const cats = Object.keys(CATS).filter((c) => all.some((p) => p.cat === c));
    root.innerHTML = `<div class="page-h"><h1>Places</h1><span class="sub">${plural(pinned.length, "place")} in ${plural(countries.size, "country")}${all.some((p) => p.status === "been") ? ` · ${all.filter((p) => p.status === "been").length} visited` : ""}</span><span class="sp"></span>
        <form class="place-search" id="psearch"><input class="in" name="q" placeholder="Add a place: search a city, landmark, address…" autocomplete="off" /><button class="btn">Find</button></form></div>
      <div class="toolbar"><div class="chips">${[["all", "All"], ...cats.map((c) => [c, CATS[c].label])].map(([c, l]) => `<button class="chip${ui.cat === c ? " on" : ""}" data-act="cat" data-c="${c}"${c !== "all" ? ` style="--dot:${CATS[c].color}"` : ""}>${c !== "all" ? '<i class="dot"></i>' : ""}${l}</button>`).join("")}</div>
        <span class="grow"></span>${ideas().length + todo().length ? `<button class="chip ideas-chip${ui.ideas ? " on" : ""}" data-act="ideas">Suggested for you · ${ideas().length + todo().length}</button>` : ""}<div class="seg">${[["all", "All"], ["want", "Want to go"], ["been", "Been there"]].map(([s, l]) => `<button class="${ui.status === s ? "on" : ""}" data-act="status" data-s="${s}">${l}</button>`).join("")}</div></div>
      <div class="places-wrap"><div class="card map-card"><div id="pmap"></div>${ui.pinning ? `<div class="pin-hint">Click the map where “${esc(all.find((p) => p.id === ui.pinning)?.name)}” is · <button data-act="unpin">cancel</button></div>` : ""}</div>
        <aside class="card place-panel" id="ppanel"></aside></div>`;
    makeMap(root);
    panel();
    wire(root, app);
  },
};

function makeMap(root) {
  map?.remove();
  map = L.map(root.querySelector("#pmap"), { worldCopyJump: true, zoomControl: true, attributionControl: true, minZoom: 2 });
  // Esri's dark-gray canvas (free, no key) with its label layer on top
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors" }).addTo(map);
  L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, opacity: 0.8 }).addTo(map);
  layer = L.layerGroup().addTo(map);
  drawMarkers();
  const sel = places().find((p) => p.id === ui.sel && p.lat != null);
  if (ui.view) map.setView(ui.view.center, ui.view.zoom);
  else if (sel) map.setView([sel.lat, sel.lon], 11);
  else { const pts = shown(); pts.length ? map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.2), { maxZoom: 5 }) : map.setView([25, 10], 2); }
  map.on("moveend", () => (ui.view = { center: map.getCenter(), zoom: map.getZoom() }));
  map.on("click", (e) => {
    if (!ui.pinning) return;
    const p = places().find((x) => x.id === ui.pinning);
    Object.assign(p, { lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) });
    ui.pinning = null; ui.sel = p.id; commit(); toast(`Pinned ${p.name}`);
    reverse(p).then(() => { commit(); panel(); });
    appRef.refresh();
  });
  setTimeout(() => map?.invalidateSize(), 50);
}
function drawMarkers() {
  layer.clearLayers();
  for (const p of shown()) {
    const icon = L.divIcon({ className: "", html: `<span class="pmark${p.id === ui.sel ? " sel" : ""}${p.status === "been" ? " been" : ""}" style="--c:${color(p)}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    L.marker([p.lat, p.lon], { icon, title: p.name, riseOnHover: true }).on("click", () => select(p.id, false)).addTo(layer);
  }
  if (ui.ideas) for (const i of ideas()) {   // suggestions: hollow rings, so they never look like your own places
    const icon = L.divIcon({ className: "", html: `<span class="pmark idea${i.id === ui.idea ? " sel" : ""}" style="--c:${(CATS[i.cat] || CATS.other).color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    L.marker([i.lat, i.lon], { icon, title: `Suggested: ${i.name}`, riseOnHover: true }).on("click", () => pickIdea(i.id, false)).addTo(layer);
  }
}
function pickIdea(id, fly = true) {
  ui.idea = id; ui.sel = null; drawMarkers(); panel();
  const i = ideas().find((x) => x.id === id);
  if (fly && i) map.flyTo([i.lat, i.lon], Math.max(map.getZoom(), 6), { duration: 1.2 });
}
function select(id, fly = true) {
  ui.sel = id; drawMarkers(); panel();
  const p = places().find((x) => x.id === id);
  if (fly && p?.lat != null) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 11), { duration: 1.2 });
}

/* ---------- the side panel: one place, or the list ---------- */
function panel() {
  const el = document.querySelector("#ppanel");
  if (!el) return;
  if (ui.ideas && !ui.sel) return ideasPanel(el);
  const p = places().find((x) => x.id === ui.sel);
  if (p) {
    const c = CATS[p.cat] || CATS.other, img = p.image || p.wiki?.thumb;
    el.innerHTML = `<button class="icon-btn back" data-act="close">← all places</button>
      ${img ? `<img class="place-img" src="${esc(img)}" alt="${esc(p.name)}" />` : ""}
      <span class="kicker" style="--c:${c.color}"><i class="dot"></i><select id="pcat" aria-label="Kind of place">${Object.entries(CATS).map(([k, v]) => `<option value="${k}"${k === p.cat ? " selected" : ""}>${v.label}</option>`).join("")}</select>${p.status === "been" ? " · been there" : ""}</span>
      <h2>${esc(p.name)}</h2><p class="where">${esc([p.area, p.country].filter(Boolean).join(" · ") || "no location yet")}</p>
      ${p.said ? `<blockquote>“${esc(p.said)}”${p.noteTitle ? `<cite>from your note <a href="#" data-act="note" data-id="${esc(p.noteId)}">${esc(p.noteTitle)}</a></cite>` : ""}</blockquote>` : ""}
      ${p.wiki?.extract ? `<p class="extract">${esc(p.wiki.extract)}</p>` : ""}
      <textarea class="in" id="pmine" rows="3" placeholder="Your own notes — when, why, with who…">${esc(p.mine || "")}</textarea>
      <div class="place-acts">
        <button class="btn ${p.status === "been" ? "" : "ghost"} sm" data-act="been">${p.status === "been" ? "✓ Been there" : "Mark as visited"}</button>
        ${p.lat == null ? `<button class="btn sm" data-act="pin" data-id="${p.id}">Pin on map</button>` : `<a class="btn ghost sm" href="${gmaps(p)}" target="_blank" rel="noopener">Google Maps</a>`}
        ${p.wiki?.url ? `<a class="btn ghost sm" href="${esc(p.wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ""}
        <button class="btn ghost sm" style="color:var(--red)" data-act="del">Remove</button></div>`;
    el.querySelector("#pmine").onchange = (e) => { p.mine = e.target.value; commit(); };
    el.querySelector("#pcat").onchange = (e) => { p.cat = e.target.value; commit(); drawMarkers(); panel(); };
    return;
  }
  if (ui.results.length) {
    el.innerHTML = `<button class="icon-btn back" data-act="clear">← all places</button><h3>Pick the right one</h3>${ui.results.map((r, i) => `<button class="place-row" data-act="add" data-i="${i}"><b>${esc(r.name || r.display_name.split(",")[0])}</b><small>${esc(r.display_name)}</small></button>`).join("")}`;
    return;
  }
  const list = shown().sort((a, b) => (a.country || "").localeCompare(b.country || "") || a.name.localeCompare(b.name));
  const byCountry = list.reduce((m, p) => ((m[p.country || "—"] ||= []).push(p), m), {});
  const loose = places().filter((p) => p.lat == null);
  el.innerHTML = `${Object.entries(byCountry).map(([country, ps]) => `<div class="country-h">${esc(country)}<span>${ps.length}</span></div>${ps.map((p) => `
      <button class="place-row" data-act="pick" data-id="${p.id}" style="--c:${color(p)}"><i class="dot"></i><b>${esc(p.name)}</b><small>${esc(p.area)}</small>${p.status === "been" ? '<em>✓</em>' : ""}</button>`).join("")}`).join("") || empty("Nothing matches these filters.")}
    ${loose.length ? `<div class="country-h">Needs a location<span>${loose.length}</span></div>${loose.map((p) => `<button class="place-row loose" data-act="pick" data-id="${p.id}"><i class="dot"></i><b>${esc(p.name)}</b><small>${esc(p.said)}</small></button>`).join("")}` : ""}`;
}

/* ---------- suggested for you ---------- */
function ideasPanel(el) {
  const i = ideas().find((x) => x.id === ui.idea);
  if (i) {
    const c = CATS[i.cat] || CATS.other, img = i.wiki?.thumb ? i.wiki.thumb.replace(/\/\d+px-/, "/960px-") : "";
    el.innerHTML = `<button class="icon-btn back" data-act="idea-back">← suggestions</button>
      ${img ? `<img class="place-img" src="${esc(img)}" alt="${esc(i.name)}" />` : ""}
      <span class="kicker" style="--c:${c.color}"><i class="dot"></i>suggested · ${esc(c.label)}</span>
      <h2>${esc(i.name)}</h2><p class="idea-why">${esc(i.why)}</p>
      ${i.wiki?.extract ? `<p class="extract">${esc(i.wiki.extract)}</p>` : ""}
      <div class="place-acts"><button class="btn sm" data-act="idea-keep" data-id="${i.id}">Add to my places</button>
        <button class="btn ghost sm" data-act="idea-bucket" data-id="${i.id}">Add to bucket list</button>
        ${i.wiki?.url ? `<a class="btn ghost sm" href="${esc(i.wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ""}
        <button class="btn ghost sm" data-act="idea-no" data-id="${i.id}">Not for me</button></div>`;
    return;
  }
  el.innerHTML = `<button class="icon-btn back" data-act="ideas">← your places</button>
    <h3 class="ideas-h">Suggested for you</h3><p class="ideas-sub">Picked from your bucket list, your music, your notes and your hobbies. Hollow rings on the map.</p>
    <div class="country-h">Places<span>${ideas().length}</span></div>
    ${ideas().map((x) => `<button class="place-row" data-act="idea" data-id="${x.id}" style="--c:${(CATS[x.cat] || CATS.other).color}"><i class="dot hollow"></i><b>${esc(x.name)}</b><small>${esc(x.why)}</small></button>`).join("") || empty("No place suggestions left.")}
    <div class="country-h">Things to do<span>${todo().length}</span></div>
    ${todo().map((x) => `<div class="todo-idea"><b>${esc(x.text)}</b><small>${esc(x.why)}</small>
      <span><button class="bk-link" data-act="do-bucket" data-id="${x.id}">add to bucket list</button><button class="bk-link" data-act="do-no" data-id="${x.id}">not for me</button></span></div>`).join("") || empty("No suggestions left.")}`;
}
function keepIdea(i, bucket) {
  let p = places().find((x) => x.name === i.name);
  if (!p) {
    p = { id: newId(), name: i.name, area: "", country: "", lat: i.lat, lon: i.lon, cat: i.cat, said: i.why, noteId: "", noteTitle: "", wiki: i.wiki || null, image: "", status: "want", added: today() };
    places().push(p);
    reverse(p).then(() => commit());   // fill in area + country
  }
  if (bucket && !(db.bucket ||= []).some((b) => b.placeId === p.id)) db.bucket.push({ id: newId(), text: i.name, kind: "go", status: "dream", placeId: p.id, skill: "", noteId: "", noteTitle: "", note: i.why, added: today() });
  i.dismissed = true; i.kept = today();
  return p;
}

/* ---------- OpenStreetMap search + Wikipedia, for places you add here ---------- */
async function search(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } });
  return r.ok ? r.json() : [];
}
async function reverse(p) {
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lon}&zoom=10`, { headers: { "Accept-Language": "en" } })).json();
    const a = r.address || {};
    p.area ||= [a.city || a.town || a.village || a.county, a.state].filter(Boolean).join(", ");
    p.country ||= a.country || "";
  } catch {}
}
async function wikiFor(title) {
  try {
    const s = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`)).json();
    if (!s.extract || s.type === "disambiguation") return null;
    return { title: s.title, extract: s.extract, url: s.content_urls?.desktop?.page || "", thumb: (s.thumbnail?.source || "").replace(/\/\d+px-/, "/960px-") };
  } catch { return null; }
}

function wire(root, app) {
  root.querySelector("#psearch").onsubmit = async (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (!q) return;
    ui.sel = null; ui.results = await search(q).catch(() => []);
    if (!ui.results.length) toast("Nothing found — try adding the city or country");
    panel();
  };
  root.onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.tagName === "A" && b.dataset.act !== "note") return;
    e.preventDefault();
    const p = places().find((x) => x.id === ui.sel);
    switch (b.dataset.act) {
      case "cat": ui.cat = b.dataset.c; return app.refresh();
      case "ideas": ui.ideas = !ui.ideas; ui.idea = null; ui.sel = null; return app.refresh();
      case "idea": return pickIdea(b.dataset.id);
      case "idea-back": ui.idea = null; drawMarkers(); return panel();
      case "idea-keep": case "idea-bucket": {
        const i = ideas().find((x) => x.id === b.dataset.id);
        const np = keepIdea(i, b.dataset.act === "idea-bucket");
        commit(); toast(b.dataset.act === "idea-bucket" ? `${i.name} is on your bucket list and your map` : `${i.name} added to your places`);
        ui.idea = null; ui.ideas = false; ui.sel = np.id; return app.refresh();
      }
      case "idea-no": { const i = ideas().find((x) => x.id === b.dataset.id); i.dismissed = true; commit(); ui.idea = null; drawMarkers(); return panel(); }
      case "do-bucket": case "do-no": {
        const i = todo().find((x) => x.id === b.dataset.id);
        if (b.dataset.act === "do-bucket") { (db.bucket ||= []).push({ id: newId(), text: i.text, kind: "do", status: "dream", placeId: "", skill: "", noteId: "", noteTitle: "", note: i.why, added: today() }); i.kept = today(); toast("Added to your bucket list"); }
        i.dismissed = true; commit(); return panel();
      }
      case "status": ui.status = b.dataset.s; return app.refresh();
      case "pick": return select(b.dataset.id);
      case "close": case "clear": ui.sel = null; ui.results = []; drawMarkers(); return panel();
      case "note": return app.go("notes", b.dataset.id);
      case "been": p.status = p.status === "been" ? "want" : "been"; commit(); drawMarkers(); return panel();
      case "del": if (!confirm(`Remove ${p.name} from your places?`)) return; db.places = places().filter((x) => x !== p); ui.sel = null; commit(); return app.refresh();
      case "pin": ui.pinning = b.dataset.id; return app.refresh();
      case "unpin": ui.pinning = null; return app.refresh();
      case "add": {
        const r = ui.results[+b.dataset.i], a = r.address || {}, name = r.name || r.display_name.split(",")[0];
        const np = { id: newId(), name, area: [a.city || a.town || a.village || a.county, a.state].filter(Boolean).join(", "), country: a.country || "", lat: +(+r.lat).toFixed(5), lon: +(+r.lon).toFixed(5),
          cat: "other", said: "", noteId: "", noteTitle: "", wiki: null, image: "", status: "want", added: today() };
        places().push(np); ui.results = []; ui.sel = np.id; ui.view = null; commit(); app.refresh();
        np.wiki = await wikiFor(name); commit(); return panel();
      }
    }
  };
}
