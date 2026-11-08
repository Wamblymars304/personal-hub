// Music — your Spotify playlists as a listening room. Each genre you love is a room: what it is, when it entered
// your life, the artists who define it for you, how it sounds, and which Atmospheres it belongs with.
// "Taste over time" shows when each room grew. Songs play in the corner dock (player.js) and keep going across tabs.
// The library comes from tools/import_music.py (data/music.json); only the room ↔ atmosphere links live in hub.json.
import { esc, plural, section } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";
import { lib, loadMusic, syncRemovals, cover, by, month, shuffle, atmoLinks, toggleLink } from "../music-lib.js";
import { playQueue, onPlayer, now } from "../player.js";
import { mapsBody, panel, layoutMap, findGenre, markSelection, genreQueue, emotionQueue } from "./music-maps.js";
import { tasteBody } from "./music-taste.js";
import { listenBody, listenAct, listenNote, listenAfter, listenOwn } from "./music-listen.js";

const VIEWS = [["rooms", "Rooms"], ["map", "Map"], ["taste", "Taste"], ["listen", "Listen"]];
let repaint = () => {};
const saved = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const ui = { room: null, pl: null, q: "", artist: "", all: false, genre: "", emotion: "", view: saved("hub.music.view", "rooms"), lens: saved("hub.music.lens", "sound") };
const FEATURES = [["energy", "Energy"], ["valence", "Mood · sad → bright"], ["dance", "Danceability"], ["acoustic", "Acoustic"], ["instr", "Instrumental"]];
const lists = {};   // the track lists on screen, so a ▶ on any row can queue the rest of its list
let tried = false, atmoPaths = null, atmoList = null, libAvg = null;
loadMusic().then(() => { tried = true; });

const years = () => {
  const ys = lib.tracks.map((t) => +t.added.slice(0, 4)).filter(Boolean);
  const out = []; for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push(y);
  return out;
};
const perYear = (list, ys) => ys.map((y) => list.filter((t) => t.added.startsWith(String(y))).length);
function topBy(list, keyOf, n) {
  const m = new Map();
  for (const t of list) {
    const k = keyOf(t);
    if (!k) continue;
    const e = m.get(k) || { k, n: 0, t };
    e.n++; if (t.c && !e.t.c) e.t = t;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, n);
}
function averages(list) {
  const out = {};
  for (const k of [...FEATURES.map(([k]) => k), "tempo"]) {
    const v = list.map((t) => t.f?.[k]).filter((x) => x != null);
    out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  return out;
}
const pretty = (p) => p.split("/").join(" › ");
function loadAtmos() {
  atmoPaths ||= fetch("/api/atmospheres", { cache: "no-store" }).then((r) => r.json()).then((tree) => {
    const out = [], walk = (n) => n.children.forEach((c) => { out.push(c.path); walk(c); });
    walk(tree); return (atmoList = out);
  }).catch(() => (atmoList = []));
  return atmoPaths;
}

export default {
  id: "music", label: "Music", color: "var(--cyan)",
  count: () => (lib ? lib.tracks.length : null),
  render(root, app, focus) {
    if (!lib) {
      root.innerHTML = `<div class="page-h"><h1>Music</h1><span class="sub">${tried ? "" : "tuning in…"}</span></div>${tried ? `<div class="soon-page"><h2>No music library yet</h2>Export your Spotify playlists as CSV (exportify.app), then run <code>tools\\import_music.py &lt;folder&gt;</code>.</div>` : ""}`;
      if (!tried) loadMusic().then(() => { tried = true; if (document.documentElement.dataset.mood === "music") app.refresh(); });
      return;
    }
    syncRemovals();   // songs removed in Listen stay hidden everywhere
    if (focus?.startsWith("room:")) Object.assign(ui, { room: focus.slice(5), pl: null, q: "", artist: "" });
    else if (focus?.startsWith("t:")) Object.assign(ui, { q: lib.tracks.find((t) => t.id === focus.slice(2))?.t || "", room: null, pl: null });
    libAvg ||= averages(lib.tracks);
    const artistsN = new Set(lib.tracks.flatMap((t) => t.ar)).size, ys = years();

    root.innerHTML = `<div class="page-h"><h1>Music</h1><span class="sub">${lib.tracks.length.toLocaleString()} songs · ${artistsN.toLocaleString()} artists · ${plural(lib.playlists.length, "playlist")} · since ${ys[0]}</span><span class="sp"></span>
        <input class="in mu-find" id="mq" placeholder="Find a song, artist or album…" value="${esc(ui.q)}" />
        <button class="btn" data-act="shuffle-all">Shuffle everything</button></div>
      <div id="mu-body">${body(ys)}</div>`;
    enter(root);
    const after = () => {   // the map needs real label sizes before it can place them
      if (!ui.q.trim() && !ui.room && ui.pl == null && ui.view === "map") layoutMap(root);
      if (ui.genre || ui.emotion) markSelection(root, ui);
      const f = root.querySelector("#mm-find"); if (f) f.oninput = () => findGenre(root, f.value);
      listenAfter(root);
    };
    after();

    repaint = () => { syncRemovals(); root.querySelector("#mu-body").innerHTML = body(ys); after(); };
    root.querySelector("#mq").oninput = (e) => { ui.q = e.target.value; repaint(); };
    root.onchange = (e) => { if (e.target.matches("[data-ls-note]")) listenNote(e.target); };
    root.onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("[data-ls-own]")) { e.preventDefault(); listenOwn(e.target); } };
    root.onclick = (e) => {
      if (e.target.closest("a")) return;
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const r = lib.roomById[ui.room];
      switch (b.dataset.act) {
        case "room": Object.assign(ui, { room: b.dataset.id, pl: null, q: "", artist: "", all: false }); app.refresh(); return scrollTo(0, 0);
        case "pl": Object.assign(ui, { pl: +b.dataset.i, room: null, q: "", all: false }); app.refresh(); return scrollTo(0, 0);
        case "back": Object.assign(ui, { room: null, pl: null, artist: "" }); return app.refresh();
        case "play": return playQueue(lists[b.dataset.l], +b.dataset.i, lists[b.dataset.l].label);
        case "radio": return playQueue(shuffle(lib.byRoom[r.id]), 0, r.name);
        case "radio-start": return playQueue(lists.start, 0, `${r.name} · start here`);
        case "shuffle-all": return playQueue(shuffle(lib.tracks), 0, "Everything");
        case "artist": ui.artist = ui.artist === b.dataset.a ? "" : b.dataset.a; ui.all = false; return app.refresh();
        case "link": toggleLink(r.id, b.dataset.p); return app.refresh();
        case "toggle-cap": ui.all = !ui.all; return app.refresh();
        case "to-atmo": return app.go("atmospheres");
        case "view": ui.view = b.dataset.v; try { localStorage.setItem("hub.music.view", ui.view); } catch {} return app.refresh();
        case "genre": case "emotion": {   // swap only the side panel, so the map keeps its layout
          if (b.dataset.act === "genre") ui.genre = b.dataset.g;
          else { ui.emotion = ui.emotion === b.dataset.e ? "" : b.dataset.e; ui.genre = ""; }
          const side = root.querySelector(".mm-side");
          if (side) { side.innerHTML = panel(ui, { row, lists }); side.scrollTop = 0; }
          markSelection(root, ui);
          return;
        }
        case "genre-play": return playQueue(genreQueue(ui.genre), 0, ui.genre);
        case "emotion-play": return playQueue(emotionQueue(ui.emotion), 0, `Feeling ${ui.emotion}`);
        case "find": ui.q = b.dataset.q; root.querySelector("#mq").value = ui.q; root.querySelector("#mu-body").innerHTML = body(ys); after(); return scrollTo(0, 0);
        default: if (b.dataset.act.startsWith("ls-")) return listenAct(b, { repaint, refresh: app.refresh });
          return;
        case "lens": ui.lens = b.dataset.l; try { localStorage.setItem("hub.music.lens", ui.lens); } catch {} return app.refresh();
      }
    };
    if (ui.room) loadAtmos().then(() => { const el = root.querySelector("#mu-links"); if (el) el.innerHTML = linkChips(lib.roomById[ui.room]); });
  },
};

function enter(root) {
  const els = root.querySelectorAll(".mu-room, .mu-hero, #mu-body > .card");
  if (!motionEnabled() || !els.length) return;
  animate(els, { opacity: [0, 1], translateY: [14, 0], delay: stagger(30), duration: 650, ease: "outQuart" });
}
function body(ys) {
  if (ui.q.trim()) {
    const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = lib.tracks.filter((t) => { const s = `${t.t} ${t.ar.join(" ")} ${t.al}`.toLowerCase(); return words.every((w) => s.includes(w)); });
    lists.results = Object.assign(hits.slice(0, 120), { label: `“${ui.q.trim()}”` });
    return section(`${plural(hits.length, "song")} match`, hits.length ? lists.results.map((t, i) => row(t, i, "results")).join("") : `<div class="empty">Nothing in your playlists matches that.</div>`,
      { sub: hits.length > 120 ? "showing the first 120" : "", cls: "mu-list" });
  }
  if (ui.room && lib.roomById[ui.room]) return roomView(lib.roomById[ui.room], ys);
  if (ui.pl != null && lib.playlists[ui.pl]) return playlistView(ui.pl);
  const tabs = `<div class="mu-views" role="tablist">${VIEWS.map(([k, l]) => `<button role="tab" class="${ui.view === k ? "on" : ""}" aria-selected="${ui.view === k}" data-act="view" data-v="${k}">${l}</button>`).join("")}</div>`;
  return tabs + (ui.view === "map" ? mapsBody(ui, { row, lists }) : ui.view === "taste" ? tasteBody({ row, lists }) : ui.view === "listen" ? listenBody({ row, lists, repaint: () => repaint() }) : overview(ys));
}

/* ---------- the overview: taste over time, the rooms, the playlists ---------- */
function overview(ys) {
  const rooms = lib.rooms.filter((r) => lib.byRoom[r.id]?.length);
  return section("Taste over time", heat(rooms, ys), { sub: "Songs added to your playlists each year, per room — brighter means more. Rooms are listed in the order they entered your life.", cls: "mu-heat-card" })
    + `<div class="mu-rooms">${rooms.map((r) => card(r, ys)).join("")}</div>`
    + section("Playlists", `<div class="mu-pls">${lib.playlists.map((p, i) => `<button class="mu-pl" data-act="pl" data-i="${i}"><b>${esc(p.name)}</b><em>${plural(p.count, "song")}</em><span>${month(p.first)}${p.last.slice(0, 7) !== p.first.slice(0, 7) ? ` – ${month(p.last)}` : ""}</span></button>`).join("")}</div>`,
      { sub: `Imported ${lib.imported} from Spotify (Exportify CSVs)` });
}
function heat(rooms, ys) {
  const rows = rooms.map((r) => ({ r, list: lib.byRoom[r.id] })).map((x) => ({ ...x, first: x.list.find((t) => t.added)?.added || "", counts: perYear(x.list, ys) }))
    .sort((a, b) => (a.first || "9").localeCompare(b.first || "9"));
  const max = Math.max(1, ...rows.flatMap((x) => x.counts));
  return `<div class="mu-heat-wrap"><table class="mu-heat"><thead><tr><th></th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${rows.map((x) => `<tr>
      <th><button data-act="room" data-id="${x.r.id}">${esc(x.r.name)}</button><em>${month(x.first)}</em></th>
      ${x.counts.map((n, j) => `<td style="--v:${n ? (0.14 + 0.86 * Math.sqrt(n / max)).toFixed(3) : 0}" data-tip="${esc(x.r.name)} · ${ys[j]} · ${plural(n, "song")}"><span>${n}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function spark(counts) {
  const max = Math.max(1, ...counts), w = 100 / Math.max(1, counts.length - 1);
  const pts = counts.map((n, i) => `${(i * w).toFixed(1)},${(22 - (n / max) * 20).toFixed(1)}`).join(" ");
  return `<svg class="mu-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,24 ${pts} 100,24" /><polyline points="${pts}" /></svg>`;
}
function mosaic(list, n, cls) {
  const cs = topBy(list.filter((t) => t.c), (t) => t.c, n);
  return `<span class="${cls}">${cs.map((c) => `<img src="${cover(c.t)}" alt="" loading="lazy" />`).join("")}${"<i></i>".repeat(Math.max(0, n - cs.length))}</span>`;
}
function card(r, ys) {
  const list = lib.byRoom[r.id], arts = topBy(list, (t) => t.ar[0], 3).map((a) => a.k);
  return `<button class="mu-room" data-act="room" data-id="${r.id}">${mosaic(list, 4, "mu-mos")}
    <span class="mu-rb">${r.note ? `<i class="mu-note">from your genres note</i>` : ""}<b>${esc(r.name)}</b><em>${esc(r.era)}</em>
      <span class="mu-meta">${plural(list.length, "song")} · since ${month(list.find((t) => t.added)?.added)}</span>${spark(perYear(list, ys))}
      <span class="mu-arts">${esc(arts.join(" · "))}</span></span></button>`;
}

/* ---------- one room ---------- */
function roomView(r, ys) {
  const list = lib.byRoom[r.id], first = list.find((t) => t.added) || list[0];
  const arts = topBy(list, (t) => t.ar[0], 8), avg = averages(list);
  lists.first = Object.assign([first], { label: r.name });
  lists.start = Object.assign([...list].sort((a, b) => (b.pop ?? -1) - (a.pop ?? -1)).slice(0, 6), { label: `${r.name} · start here` });
  lists.room = Object.assign((ui.artist ? list.filter((t) => t.ar[0] === ui.artist) : list).slice().reverse(), { label: ui.artist ? `${r.name} · ${ui.artist}` : r.name });
  const shown = ui.all ? lists.room : lists.room.slice(0, 60);
  return `<div class="toolbar"><button class="btn ghost sm" data-act="back">← All rooms</button></div>
    <section class="card mu-hero">${mosaic(list, 12, "mu-wall")}<div class="mu-copy">
      ${r.note ? `<i class="mu-note">from your genres note</i>` : ""}<span class="mu-era">${esc(r.era)}</span><h2>${esc(r.name)}</h2><p>${esc(r.blurb)}</p>
      <div class="mu-facts"><span><b>${list.length}</b>songs</span><span><b>${new Set(list.flatMap((t) => t.ar)).size}</b>artists</span><span><b>${month(first.added)}</b>first added</span></div>
      <p class="mu-began">It started with <button class="linkish" data-act="play" data-l="first" data-i="0">${esc(first.t)}</button> by ${esc(by(first))}.</p>
      <div class="mu-actions"><button class="btn" data-act="radio">▶ Play this room</button><button class="btn ghost" data-act="radio-start">Start here</button></div></div></section>
    <div class="mu-two">
      ${section("Start here", lists.start.map((t, i) => row(t, i, "start")).join(""), { sub: "The best-known songs of this room in your library", cls: "mu-list" })}
      ${section("How it sounds", signature(avg), { sub: "Spotify's audio analysis, averaged · the tick is your whole library" })}
    </div>
    ${section("Defining artists", `<div class="mu-artists">${arts.map((a) => `<button class="mu-artist${ui.artist === a.k ? " on" : ""}" data-act="artist" data-a="${esc(a.k)}">${a.t.c ? `<img src="${cover(a.t)}" alt="" loading="lazy" />` : "<i></i>"}<b>${esc(a.k)}</b><em>${plural(a.n, "song")}</em></button>`).join("")}</div>`,
      { sub: "Who this room is, for you · click one to see only their songs" })}
    ${section("Fits these atmospheres", `<div class="mu-links" id="mu-links">${atmoList ? linkChips(r) : `<span class="tag">loading…</span>`}</div>`,
      { sub: "Drift mode can play this room over the art in these categories", right: `<button class="btn ghost sm" data-act="to-atmo">Open Atmospheres</button>` })}
    ${section(ui.artist ? `Songs by ${esc(ui.artist)}` : "Every song", shown.map((t, i) => row(t, i, "room")).join("")
      + (lists.room.length > 60 ? `<button class="more" data-act="toggle-cap">${ui.all ? "Show less" : `Show all ${lists.room.length}`}</button>` : ""),
      { sub: "Newest first", cls: "mu-list", right: ui.artist ? `<button class="btn ghost sm" data-act="artist" data-a="${esc(ui.artist)}">Show everyone</button>` : "" })}`;
}
function linkChips(r) {
  const mine = atmoLinks()[r.id] || [];
  return (atmoList || []).map((p) => `<button class="chip${mine.includes(p) ? " on" : ""}" data-act="link" data-p="${esc(p)}">${esc(pretty(p))}</button>`).join("")
    || `<span class="tag">No Atmospheres categories yet.</span>`;
}
function signature(avg) {
  const bars = FEATURES.map(([k, label]) => avg[k] == null ? "" : `<div class="mu-sig"><span>${label}</span>
      <i style="--v:${avg[k].toFixed(3)}"><u style="--a:${(libAvg[k] ?? 0).toFixed(3)}"></u></i><em>${Math.round(avg[k] * 100)}</em></div>`).join("");
  return bars ? bars + (avg.tempo ? `<p class="mu-tempo"><b>${Math.round(avg.tempo)}</b> BPM on average <span>· your library ${Math.round(libAvg.tempo)}</span></p>` : "")
    : `<div class="empty">Spotify has no audio analysis for these songs.</div>`;
}
function row(t, i, l) {
  return `<div class="mu-row${now()?.id === t.id ? " on" : ""}" data-row="t:${t.id}" data-act="play" data-l="${l}" data-i="${i}" role="button" tabindex="0">
    <span class="mu-cv">${t.c ? `<img src="${cover(t)}" alt="" loading="lazy" />` : ""}<i>▶</i></span>
    <span class="mu-tt"><b>${esc(t.t)}</b><em>${esc(by(t))}</em></span>
    <span class="mu-al">${esc(t.al)}${t.y ? ` · ${t.y}` : ""}</span><span class="mu-ad">${month(t.added)}</span>
    <a class="mu-sp" href="https://open.spotify.com/track/${t.id}" target="_blank" rel="noopener" title="Open in Spotify">↗</a></div>`;
}

/* ---------- one playlist ---------- */
function playlistView(i) {
  const p = lib.playlists[i];
  lists.pl = Object.assign(lib.tracks.filter((t) => t.pl.includes(i)).reverse(), { label: p.name });
  const shown = ui.all ? lists.pl : lists.pl.slice(0, 80);
  return `<div class="toolbar"><button class="btn ghost sm" data-act="back">← All rooms</button></div>`
    + section(esc(p.name), shown.map((t, j) => row(t, j, "pl")).join("") + (lists.pl.length > 80 ? `<button class="more" data-act="toggle-cap">${ui.all ? "Show less" : `Show all ${lists.pl.length}`}</button>` : ""),
      { sub: `${plural(lists.pl.length, "song")} · ${month(p.first)} – ${month(p.last)} · newest first`, cls: "mu-list" });
}

// keep the ▶ highlight on whatever the dock is playing
onPlayer((t) => {
  document.querySelectorAll(".mu-row.on").forEach((el) => el.classList.remove("on"));
  if (t) document.querySelectorAll(`.mu-row[data-row="t:${t.id}"]`).forEach((el) => el.classList.add("on"));
});
