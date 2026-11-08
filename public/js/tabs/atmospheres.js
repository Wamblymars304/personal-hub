// Atmospheres — liminal spaces, the night feeling, dreamcore… Folders in atmospheres/ are the tree
// (aesthetic → sub-mood); images and videos inside them are the wall. Gallery art can also live in a
// category without being moved or copied: hub.json "atmoLinks" maps a category to Gallery works
// ("artist/file"), so a painting from the Gallery can show up here with that category's sound.
// Drift mode: fullscreen, slow crossfades and drifting zoom, videos play through, with a soundscape
// (generated or recorded) that follows the category of what's on screen — or, with ♫ on, the music from your
// Music rooms linked to that category (music-lib.js), played in the corner dock.
import { db, commit } from "../store.js";
import { esc, plural, toast } from "../ui.js";
import { stagger } from "../../vendor/anime.esm.min.js";
import { animateAny as animate } from "../motion.js";
import { motionEnabled } from "../background.js";
import { AMBIENTS, guess, play, stop, setVolume, credit, ready } from "../ambient.js";
import { lib, loadMusic, roomsFor, tracksFor, cover, by, shuffle as mix } from "../music-lib.js";
import { playQueue, queueNext, onPlayer, pause } from "../player.js";

const ui = { path: "", every: 10, picking: false };
let tree = null, gallery = [], loading = null, drift = null, strip = [];
const prefs = (() => { try { return JSON.parse(localStorage.getItem("hub.atmo") || "{}"); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem("hub.atmo", JSON.stringify(prefs)); } catch {} };
const titleCase = (s) => s.replace(/(^|[\s(-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase()).replace(/ (A|An|Of|In|On|To|At|And|The|Or|For)(?= )/g, (m) => m.toLowerCase());

function load(force) {
  if (force) loading = null;
  loading ||= Promise.all([
    fetch("/api/atmospheres", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ name: "Atmospheres", path: "", files: [], children: [] })),
    fetch("/api/gallery", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
    ready,
    loadMusic(),
  ]).then(([t, g]) => {
    tree = t;
    gallery = g.flatMap((a) => a.works.map((w) => ({ key: `${a.artist}/${w.file}`, url: w.url, artist: titleCase(a.artist), title: w.file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") })));
  });
  return loading;
}
const links = () => (db.atmoLinks ||= {});
const sounds = () => (db.atmoSounds ||= {});
const find = (n, p) => (n.path === p ? n : n.children.map((c) => find(c, p)).find(Boolean));
const pretty = (p) => p.split("/").filter(Boolean).join(" › ") || "Everything";
const under = (key, path) => !path || key === path || key.startsWith(path + "/");
/** Gallery works linked into this category and the ones below it. */
function linked(path) {
  const byKey = new Map(gallery.map((w) => [w.key, w]));
  return Object.entries(links()).filter(([cat]) => under(cat, path)).flatMap(([cat, keys]) =>
    keys.map((k) => byKey.get(k)).filter(Boolean).map((w) => ({ kind: "image", url: w.url, folder: cat, linked: w.key, artist: w.artist, title: w.title })));
}
const files = (n) => [...n.files.map((f) => ({ ...f, folder: n.path })), ...n.children.flatMap(files)];
const everything = (n) => { const seen = new Set(); return [...files(n), ...linked(n.path)].filter((f) => !seen.has(f.url) && seen.add(f.url)); };   // a work linked twice shows once
/** The sound of a category: its own choice, else its parent's, else a guess from its name. */
function soundFor(path) {
  for (let p = path; p; p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") if (sounds()[p]) return sounds()[p];
  return prefs[path] || guess(path);
}

export default {
  id: "atmospheres", label: "Atmospheres", color: "var(--purple)",
  count: () => (tree ? everything(tree).length || null : null),
  render(root, app) {
    if (!tree) {
      root.innerHTML = `<div class="page-h"><h1>Atmospheres</h1><span class="sub">opening…</span></div>`;
      load().then(() => { if (document.documentElement.dataset.mood === "atmospheres") app.refresh(); });
      return;
    }
    const node = find(tree, ui.path) || tree, items = everything(node), total = everything(tree).length;
    const sound = node.path ? soundFor(node.path) : "follow";
    const branch = (n, depth) => n.children.map((c) => `<button class="atmo-node${c.path === ui.path ? " on" : ""}" style="--d:${depth}" data-act="open" data-p="${esc(c.path)}">${esc(c.name)}<em>${everything(c).length}</em></button>${branch(c, depth + 1)}`).join("");
    const mine = new Set(links()[node.path] || []);

    root.innerHTML = `<div class="page-h"><h1>Atmospheres</h1><span class="sub">${plural(total, "piece")} · ${plural(tree.children.length, "aesthetic")}</span><span class="sp"></span>
        <button class="icon-btn" data-act="reload" title="Look for new files">Refresh</button>
        <label class="atmo-sound">sound <select class="in" id="asound">${node.path ? "" : `<option value="follow" selected>Follows each picture</option>`}${Object.entries(AMBIENTS).map(([k, l]) => `<option value="${k}"${k === sound ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn drift-btn" data-act="drift"${items.length ? "" : " disabled"}>Drift${node.path ? " · " + esc(node.name) : ""}</button></div>
      <div class="atmo-wrap">
        <nav class="card atmo-tree"><button class="atmo-node${!ui.path ? " on" : ""}" style="--d:0" data-act="open" data-p="">Everything<em>${total}</em></button>${branch(tree, 0)}
          <button class="atmo-add" data-act="newcat">+ New category${node.path ? ` in ${esc(node.name)}` : ""}</button>
          <p class="tag atmo-help">Your own images and videos go in<br><code>app\\atmospheres\\${esc(node.path.replace(/\//g, "\\"))}</code><br>then press Refresh.</p></nav>
        <section class="atmo-main">
          ${node.path ? `<div class="toolbar"><button class="btn ghost sm" data-act="pick">${ui.picking ? "Done choosing" : "+ Art from the Gallery"}</button><span class="tag">${mine.size ? `${plural(mine.size, "Gallery work")} linked here — they stay in the Gallery too` : "Gallery works linked here stay in the Gallery too"}</span></div>` : ""}
          ${node.path ? musicStrip(node.path) : ""}
          ${ui.picking && node.path ? picker(mine) : ""}
          ${items.length ? `<div class="masonry atmo-wall">${items.map((f, i) => tile(f, i, node)).join("")}</div>`
            : `<div class="soon-page atmo-empty"><h2>Nothing here yet</h2>${node.path ? "Add art from the Gallery above, or drop" : "Drop"} images or videos into <code>app\\atmospheres\\${esc(node.path.replace(/\//g, "\\"))}</code> and press Refresh.</div>`}</section>
      </div>`;

    if (motionEnabled()) animate(root.querySelectorAll(".atmo-tile"), { opacity: [0, 1], translateY: [12, 0], delay: stagger(14), duration: 700, ease: "outQuart" });
    root.querySelectorAll(".atmo-tile video").forEach((v) => { v.parentElement.onmouseenter = () => v.play().catch(() => {}); v.parentElement.onmouseleave = () => v.pause(); });
    root.querySelector("#asound").onchange = (e) => { if (node.path) { sounds()[node.path] = e.target.value; commit(); toast(`${node.name}: ${AMBIENTS[e.target.value]}`); } };
    root.onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      switch (b.dataset.act) {
        case "open": ui.path = b.dataset.p; ui.picking = false; return app.refresh();
        case "reload": return load(true).then(() => app.refresh());
        case "pick": ui.picking = !ui.picking; return app.refresh();
        case "link": {
          const list = (links()[node.path] ||= []), k = b.dataset.k;
          links()[node.path] = list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
          if (!links()[node.path].length) delete links()[node.path];
          commit(); return app.refresh();
        }
        case "unlink": {
          e.stopPropagation();
          const cat = b.dataset.cat;
          links()[cat] = (links()[cat] || []).filter((x) => x !== b.dataset.k);
          if (!links()[cat].length) delete links()[cat];
          commit(); toast("Removed from this atmosphere (still in the Gallery)"); return app.refresh();
        }
        case "newcat": {
          const name = prompt(`New category${node.path ? ` inside “${node.name}”` : ""}:`)?.trim().replace(/[\\/:*?"<>|]/g, "");
          if (!name) return;
          const path = node.path ? `${node.path}/${name}` : name;
          const r = await fetch("/api/atmospheres/folder", { method: "POST", body: JSON.stringify({ path }) });
          if (!r.ok) return toast("Couldn't make that folder");
          ui.path = path; return load(true).then(() => app.refresh());
        }
        case "music-room": return app.go("music", "room:" + b.dataset.id);
        case "music-play": { const rooms = roomsFor(node.path); return playQueue(mix(tracksFor(rooms)), 0, rooms.map((r) => r.name).join(" · ")); }
        case "music-track": return playQueue(strip, +b.dataset.i, `${node.name} · music that fits`);
        case "drift": return startDrift(items, null, node);
        case "drift-at": return startDrift(items, +b.dataset.i, node);
      }
    };
  },
};

function tile(f, i, node) {
  const label = f.linked ? `${esc(f.artist)}<em>${esc(pretty(f.folder))}</em>` : esc(pretty(f.folder));
  const media = f.kind === "video" ? `<video src="${esc(f.url)}" muted loop playsinline preload="metadata"></video>` : `<img src="${esc(f.url)}" alt="" loading="lazy" />`;
  return `<button class="tile-art atmo-tile${f.linked ? " linked" : ""}" data-act="drift-at" data-i="${i}">${media}<span>${label}</span>
    ${f.linked ? `<i class="from" title="Linked from the Gallery">Gallery</i><i class="unlink" data-act="unlink" data-cat="${esc(f.folder)}" data-k="${esc(f.linked)}" title="Remove from this atmosphere">×</i>` : ""}</button>`;
}
/** The genres linked to this category (set in Music) and a row of their records. */
function musicStrip(path) {
  if (!lib) return "";
  const rooms = roomsFor(path);
  if (!rooms.length) return `<div class="atmo-music"><span class="am-h">♫ Music that fits</span><span class="tag">Nothing linked yet — open a room in Music and pick this category under “Fits these atmospheres”.</span></div>`;
  // each room's defining records (its most-collected albums), taken in turn so every linked room shows
  const perRoom = rooms.map((r) => { const n = new Map(); for (const t of lib.byRoom[r.id] || []) if (t.c) n.set(t.c, [t, (n.get(t.c)?.[1] || 0) + 1]); return [...n.values()].sort((a, b) => b[1] - a[1]).map(([t]) => t); });
  const seen = new Set();
  strip = [];
  for (let i = 0; strip.length < 12 && perRoom.some((l) => l[i]); i++) for (const l of perRoom) if (l[i] && !seen.has(l[i].c) && seen.add(l[i].c) && strip.length < 12) strip.push(l[i]);
  return `<div class="atmo-music"><div class="am-top"><span class="am-h">♫ Music that fits</span>${rooms.map((r) => `<button class="chip" data-act="music-room" data-id="${r.id}" title="Open this room in Music">${esc(r.name)}</button>`).join("")}
      <span class="sp"></span><button class="btn ghost sm" data-act="music-play">▶ Play</button></div>
    <div class="am-covers">${strip.map((t, i) => `<button data-act="music-track" data-i="${i}" title="${esc(t.t)} — ${esc(by(t))}"><img src="${cover(t)}" alt="" loading="lazy" /></button>`).join("")}</div></div>`;
}
function picker(mine) {
  const byArtist = gallery.reduce((m, w) => ((m[w.artist] ||= []).push(w), m), {});
  return `<section class="card atmo-picker">${Object.entries(byArtist).map(([a, ws]) => `<div class="pick-h">${esc(a)}<span>${ws.filter((w) => mine.has(w.key)).length} of ${ws.length}</span></div>
    <div class="pick-grid">${ws.map((w) => `<button class="pick${mine.has(w.key) ? " on" : ""}" data-act="link" data-k="${esc(w.key)}" title="${esc(w.title)}"><img src="${esc(w.url)}" alt="" loading="lazy" /></button>`).join("")}</div>`).join("")}</section>`;
}

/* ---------- Drift: fullscreen, crossfading, with sound ---------- */
function shuffle(list, first) {
  const rest = list.filter((_, i) => i !== first).sort(() => Math.random() - 0.5);
  return first == null ? rest : [list[first], ...rest];
}
function startDrift(items, at, node) {
  if (!items.length) return;
  const order = shuffle(items, at);
  const sound = node.path ? soundFor(node.path) : soundFor(order[0].folder);
  document.body.insertAdjacentHTML("beforeend", `<div class="drift" tabindex="-1">
      <div class="layer a"></div><div class="layer b"></div><div class="grain"></div>
      <div class="drift-cap"><span class="where"></span><span class="who"></span><span class="snd"></span></div>
      <div class="drift-ui"><button data-d="prev" aria-label="Previous">‹</button><button data-d="pause" aria-label="Pause">❚❚</button><button data-d="next" aria-label="Next">›</button>
        <button data-d="music" class="dm" title="Music that fits this atmosphere, instead of ambient sound">♫</button>
        <select data-d="sound"><option value="follow"${node.path ? "" : " selected"}>Sound follows the picture</option>${Object.entries(AMBIENTS).map(([k, l]) => `<option value="${k}"${node.path && k === sound ? " selected" : ""}>${l}</option>`).join("")}</select>
        <input data-d="vol" type="range" min="0" max="1" step="0.05" value="${prefs.volume ?? 0.6}" aria-label="Volume" />
        <select data-d="every">${[6, 10, 16, 30].map((s) => `<option value="${s}"${ui.every === s ? " selected" : ""}>${s}s</option>`).join("")}</select>
        <button data-d="exit" aria-label="Leave drift">Leave</button></div></div>`);
  const el = document.body.lastElementChild;
  drift = { el, order, i: -1, timer: 0, paused: false, front: el.querySelector(".layer.a"), back: el.querySelector(".layer.b"), idle: 0, node, follow: !node.path, sound: null, music: false, rooms: "" };
  document.documentElement.requestFullscreen?.().catch(() => {});   // the whole page, so the music dock stays visible over Drift
  el.focus();
  drift.offPlayer = onPlayer((t) => { if (drift?.music) drift.el.querySelector(".snd").textContent = t ? `♫ ${t.t} — ${by(t)}` : ""; });
  if (!(prefs.music && startMusic(order[0]?.folder))) setSound(sound);
  wake(); show(1);

  el.addEventListener("mousemove", wake);
  el.addEventListener("click", (e) => {
    const d = e.target.closest("[data-d]")?.dataset.d;
    if (d === "prev") show(-1); else if (d === "next") show(1); else if (d === "pause") togglePause(); else if (d === "exit") endDrift();
    else if (d === "music") { prefs.music = !drift.music; savePrefs(); if (drift.music) stopMusic(); else startMusic(drift.order[drift.i]?.folder); }
  });
  el.addEventListener("change", (e) => {
    const d = e.target.dataset.d;
    if (d === "sound") {
      if (drift.music) { prefs.music = false; savePrefs(); stopMusic(false); }
      drift.follow = e.target.value === "follow";
      setSound(drift.follow ? soundFor(drift.order[drift.i]?.folder || "") : e.target.value);
      if (!drift.follow && node.path) { sounds()[node.path] = e.target.value; commit(); }
    }
    if (d === "every") { ui.every = +e.target.value; schedule(); }
  });
  el.addEventListener("input", (e) => { if (e.target.dataset.d === "vol") { prefs.volume = +e.target.value; setVolume(prefs.volume); savePrefs(); } });
  document.addEventListener("fullscreenchange", onFs);
}
/** ♫ mode: play the Music rooms linked to this atmosphere instead of the ambient sound. */
function startMusic(folder) {
  const rooms = roomsFor(drift.node.path || folder || ""), pool = tracksFor(rooms);
  if (!pool.length) { toast("No music linked to this atmosphere yet — link genres from a room in Music"); return false; }
  stop(); drift.sound = "music"; drift.music = true; drift.rooms = rooms.map((r) => r.id).join();
  drift.el.querySelector(".dm").classList.add("on"); drift.el.classList.add("music");
  playQueue(mix(pool), 0, rooms.map((r) => r.name).join(" · "));
  return true;
}
function stopMusic(restore = true) {
  pause(); drift.music = false; drift.rooms = ""; drift.sound = null;
  drift.el.querySelector(".dm").classList.remove("on"); drift.el.classList.remove("music");
  drift.el.querySelector(".snd").textContent = "";
  if (restore) setSound(drift.follow ? soundFor(drift.order[drift.i]?.folder || "") : soundFor(drift.node.path));
}
function setSound(kind) {
  if (!drift || drift.sound === kind) return;
  drift.sound = kind;
  play(kind, prefs.volume ?? 0.6);
  const c = credit(kind);
  drift.el.querySelector(".snd").textContent = kind === "off" ? "" : `♪ ${AMBIENTS[kind] || ""}${c ? ` · ${c}` : ""}`;
}
function onFs() { if (!document.fullscreenElement && drift) endDrift(); }
function wake() {
  if (!drift) return;
  drift.el.classList.add("awake");
  clearTimeout(drift.idle);
  drift.idle = setTimeout(() => drift?.el.classList.remove("awake"), 2600);
}
function togglePause() {
  drift.paused = !drift.paused;
  drift.el.querySelector('[data-d="pause"]').textContent = drift.paused ? "▶" : "❚❚";
  drift.front.querySelector("video")?.[drift.paused ? "pause" : "play"]?.();
  drift.el.classList.toggle("paused", drift.paused);
  schedule();
}
function schedule(ms) {
  clearTimeout(drift.timer);
  if (!drift.paused) drift.timer = setTimeout(() => show(1), ms ?? ui.every * 1000);
}
function show(step) {
  const d = drift;
  d.i = (d.i + step + d.order.length) % d.order.length;
  const f = d.order[d.i], layer = d.back;
  // images sit whole on a blurred, enlarged copy of themselves, so nothing is cropped and there are no black bars
  layer.innerHTML = f.kind === "video" ? `<video class="fg" src="${esc(f.url)}" muted playsinline autoplay></video>` : `<img class="bg" src="${esc(f.url)}" alt="" /><img class="fg" src="${esc(f.url)}" alt="" />`;
  layer.style.setProperty("--dur", `${ui.every + 4}s`);
  const media = layer.querySelector(".fg"), still = !motionEnabled();
  const reveal = () => {
    if (drift !== d) return;
    layer.classList.remove("in"); void layer.offsetWidth;   // restart the slow drifting zoom
    layer.style.setProperty("--zx", `${(Math.random() - 0.5) * 4}%`); layer.style.setProperty("--zy", `${(Math.random() - 0.5) * 4}%`);
    layer.classList.add("in", "on"); d.front.classList.remove("on");
    d.front.querySelector("video")?.pause();
    [d.front, d.back] = [d.back, d.front];
    d.el.querySelector(".where").textContent = pretty(f.folder);
    d.el.querySelector(".who").textContent = f.linked ? `${f.artist} — ${f.title}` : "";
    d.el.classList.toggle("still", still);
    if (d.music && !d.node.path) {   // a new aesthetic brings its own music, from the next song on
      const rooms = roomsFor(f.folder), key = rooms.map((r) => r.id).join();
      if (rooms.length && key !== d.rooms) { d.rooms = key; queueNext(mix(tracksFor(rooms)), rooms.map((r) => r.name).join(" · ")); }
    } else if (d.follow && !d.music) setSound(soundFor(f.folder));   // a new aesthetic brings its own sound
    if (f.kind === "video") {
      media.loop = false;
      media.onended = () => show(1);
      schedule(Math.max(ui.every * 1000, (media.duration || 0) * 1000 + 500));   // let a clip play through
    } else schedule();
  };
  if (f.kind === "video") { media.onloadeddata = reveal; media.onerror = () => show(1); }
  else if (media.complete) reveal(); else { media.onload = reveal; media.onerror = () => show(1); }
}
function endDrift() {
  if (!drift) return;
  const d = drift; drift = null;
  clearTimeout(d.timer); clearTimeout(d.idle);
  stop(); d.offPlayer?.();
  if (d.music) pause();
  document.removeEventListener("fullscreenchange", onFs);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  d.el.classList.add("leaving");
  setTimeout(() => d.el.remove(), 700);
}
addEventListener("keydown", (e) => {
  if (!drift) return;
  if (e.key === "Escape") endDrift(); else if (e.key === "ArrowRight") show(1); else if (e.key === "ArrowLeft") show(-1);
  else if (e.key === " ") { e.preventDefault(); togglePause(); } else return;
  wake();
});
