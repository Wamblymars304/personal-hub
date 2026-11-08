// Music — the Map: every genre you own as a label on one big atlas (in the spirit of Every Noise at Once).
// Two lenses over the same genres:
//   Sound    left↔right = floating ↔ bouncy (danceability), top↕bottom = electric ↕ acoustic (rank-spread).
//   Emotion  the mood wheel: left↔right = dark ↔ bright (Spotify valence), top↕bottom = intense ↕ calm (energy),
//            centred on the median genre, with eight emotions around the rim; a genre's angle is its emotion and its
//            distance from the centre is how strongly it leans (rank-spread so labels don't pile up in the middle).
// Every song and genre gets one of eight emotions (or "balanced") from where it sits on that wheel; the legend
// lights an emotion's genres and opens its panel (its genres, artists and songs, playable). Size = songs; label
// tint = dark → bright. Genres are Spotify's artist tags from the Exportify CSVs.
import { esc, plural } from "../ui.js";
import { lib, month, shuffle } from "../music-lib.js";

let G = null;
const FEAT = [["energy", "Energy"], ["valence", "Brightness"], ["dance", "Danceability"], ["acoustic", "Acoustic"]];
// the wheel, counter-clockwise from "bright" (angle 0) — each emotion owns 45°
export const EMOTIONS = [
  { id: "joyful", name: "Joyful", note: "bright and warm, unhurried — songs that smile" },
  { id: "euphoric", name: "Euphoric", note: "bright and fast — rushes, peaks, hands in the air" },
  { id: "intense", name: "Intense", note: "full force with the mood held level — drive and momentum" },
  { id: "aggressive", name: "Aggressive", note: "dark and fast — anger, tension, release" },
  { id: "melancholic", name: "Melancholic", note: "dark at a walking pace — sadness that still moves" },
  { id: "desolate", name: "Desolate", note: "dark and still — empty rooms, late nights, beautiful desolation" },
  { id: "ethereal", name: "Ethereal", note: "quiet and weightless, neither happy nor sad — floating" },
  { id: "serene", name: "Serene", note: "calm and warm — content, gentle, at peace" },
];
const BALANCED = { id: "balanced", name: "Balanced", note: "right in the middle of your library — neither pulled up, down, dark nor bright" };
const emotionById = (id) => EMOTIONS.find((e) => e.id === id) || (id === "balanced" ? BALANCED : null);

/** Where a (valence, energy) pair sits on the wheel: normalised offset from your library's median, its emotion. */
function wheel(v, en, W) {
  const u = (v - W.mv) / W.sv, w = (en - W.me) / W.se, r = Math.hypot(u, w);
  const k = r < 0.22 ? -1 : Math.round(((Math.atan2(w, u) * 180) / Math.PI + 360) % 360 / 45) % 8;
  return { u, w, r, emo: k < 0 ? "balanced" : EMOTIONS[k].id };
}

/** Genre + emotion index for the loaded library. */
export function genres() {
  if (G && G.lib === lib) return G;
  const feat = lib.tracks.filter((t) => t.f && t.f.valence != null && t.f.energy != null);
  const med = (k) => { const s = feat.map((t) => t.f[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0.5; };
  const spread = (k, m) => { const s = feat.map((t) => Math.abs(t.f[k] - m)).sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)] || 0.3; };
  const W = { mv: med("valence"), me: med("energy") }; W.sv = spread("valence", W.mv); W.se = spread("energy", W.me);
  const songEmo = new Map();
  for (const t of feat) songEmo.set(t.id, wheel(t.f.valence, t.f.energy, W));

  const by_ = new Map(), artistG = new Map();
  for (const t of lib.tracks) {
    const a = t.ar[0];
    for (const g of new Set(t.g)) {
      let e = by_.get(g);
      if (!e) by_.set(g, (e = { name: g, tracks: [], artists: new Map(), sum: { energy: 0, valence: 0, dance: 0, acoustic: 0 }, nf: 0, first: "", rooms: new Map() }));
      e.tracks.push(t);
      e.artists.set(a, (e.artists.get(a) || 0) + 1);
      if (t.f && t.f.dance != null) { e.nf++; for (const k in e.sum) e.sum[k] += t.f[k] ?? 0; }
      if (t.added && (!e.first || t.added < e.first)) e.first = t.added;
      for (const r of t.r) e.rooms.set(r, (e.rooms.get(r) || 0) + 1);
      if (a) (artistG.get(a) || artistG.set(a, new Set()).get(a)).add(g);
    }
  }
  for (const e of by_.values()) e.avg = e.nf ? Object.fromEntries(Object.entries(e.sum).map(([k, v]) => [k, v / e.nf])) : null;
  // genres average their songs out, so they get their own centre: the median genre (songs keep the library's)
  const gl = [...by_.values()].filter((e) => e.avg && e.tracks.length >= 3);
  const gmed = (k) => { const s = gl.map((e) => e.avg[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0.5; };
  const gspread = (k, m) => { const s = gl.map((e) => Math.abs(e.avg[k] - m)).sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)] || 0.2; };
  const GW = { mv: gmed("valence"), me: gmed("energy") }; GW.sv = gspread("valence", GW.mv); GW.se = gspread("energy", GW.me);
  for (const e of by_.values()) if (e.avg) e.wheel = wheel(e.avg.valence, e.avg.energy, GW);
  const co = new Map();   // genre → Map(genre → artists carrying both): "leads to"
  for (const gs of artistG.values()) {
    const arr = [...gs];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++)
      for (const [x, y] of [[arr[i], arr[j]], [arr[j], arr[i]]]) { const m = co.get(x) || co.set(x, new Map()).get(x); m.set(y, (m.get(y) || 0) + 1); }
  }
  G = { lib, W, songEmo, list: [...by_.values()].sort((a, b) => b.tracks.length - a.tracks.length), by: by_, co };
  return G;
}
const near = (g, n = 8) => [...(genres().co.get(g) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const topArtists = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// label tint: diverging dark → bright (two hues, neutral middle)
const TINT = [[143, 180, 255], [217, 211, 232], [255, 179, 138]];
function tint(v) {
  if (v == null) return "rgb(160,154,180)";
  const t = Math.max(0, Math.min(1, v)), [a, b, u] = t < 0.5 ? [TINT[0], TINT[1], t / 0.5] : [TINT[1], TINT[2], (t - 0.5) / 0.5];
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * u)).join(",")})`;
}

/* ---------- the map ---------- */
export function mapsBody(ui, kit) {
  const G_ = genres(), lens = ui.lens === "emotion" ? "emotion" : "sound";
  const list = G_.list.filter((e) => e.tracks.length >= 3 && e.avg);
  const max = list[0]?.tracks.length || 1, counts = new Map();
  for (const e of list) counts.set(e.wheel.emo, (counts.get(e.wheel.emo) || 0) + 1);
  let pos;
  if (lens === "sound") {
    const rank = (k) => { const s = [...list].sort((a, b) => a.avg[k] - b.avg[k]); return new Map(s.map((e, i) => [e.name, i / Math.max(1, s.length - 1)])); };
    const rx = rank("dance"), ry = rank("acoustic");
    pos = (e) => [rx.get(e.name), ry.get(e.name)];
  } else {
    // angle = the genre's emotion; distance = how strongly it leans, as a rank so the disc fills evenly
    const lean = [...list].filter((e) => e.wheel.emo !== "balanced").sort((a, b) => a.wheel.r - b.wheel.r), still = list.filter((e) => e.wheel.emo === "balanced");
    const rad = new Map([...lean.map((e, i) => [e.name, 0.3 + 0.62 * (i / Math.max(1, lean.length - 1))]), ...still.map((e, i) => [e.name, 0.04 + 0.2 * (i / Math.max(1, still.length - 1))])]);
    pos = (e) => { const a = Math.atan2(e.wheel.w, e.wheel.u), r = rad.get(e.name); return [0.5 + (Math.cos(a) * r) / 2, 0.5 + (Math.sin(a) * r) / 2]; };   // y up = more energy
  }
  const legend = [...EMOTIONS, BALANCED].map((m) => `<button class="mm-emo${ui.emotion === m.id ? " on" : ""}" data-act="emotion" data-e="${m.id}" title="${esc(m.note)}">${m.name}<em>${counts.get(m.id) || 0}</em></button>`).join("");
  const rim = lens === "emotion" ? EMOTIONS.map((m, k) => {
    const a = (k * 45 * Math.PI) / 180;
    return `<span class="mm-rim" data-act="emotion" data-e="${m.id}" style="left:${(50 + Math.cos(a) * 41).toFixed(1)}%;top:${(50 - Math.sin(a) * 46).toFixed(1)}%">${m.name}</span>`;
  }).join("") + `<svg class="mm-wheel" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="50" rx="12" ry="12" /><ellipse cx="50" cy="50" rx="46" ry="46" />${EMOTIONS.map((_, k) => {
    const a = ((k * 45 + 22.5) * Math.PI) / 180; return `<line x1="${50 + Math.cos(a) * 12}" y1="${50 - Math.sin(a) * 12}" x2="${50 + Math.cos(a) * 46}" y2="${50 - Math.sin(a) * 46}" />`; }).join("")}</svg>`
    : `<span class="mm-axis l">floating · atmospheric</span><span class="mm-axis r">bouncy · rhythmic</span><span class="mm-axis t">electric · synthetic</span><span class="mm-axis b">acoustic · organic</span>`;
  const main = `<div class="mm-head">
      <div class="mm-lens" role="tablist">${[["sound", "Sound"], ["emotion", "Emotion"]].map(([k, l]) => `<button role="tab" class="${lens === k ? "on" : ""}" aria-selected="${lens === k}" data-act="lens" data-l="${k}">${l}</button>`).join("")}</div>
      <p>${lens === "sound" ? `Every genre with three songs or more — ${list.length} of them — placed by how its songs sound.` : `The same ${list.length} genres on the mood wheel: dark ↔ bright across, calm ↕ intense up and down, centred on the middle of your own library.`}
        Bigger means more songs. Click a genre or an emotion.</p>
      <input class="in mm-find" id="mm-find" placeholder="Find a genre…" autocomplete="off" /></div>
    <div class="mm-legend">${legend}<span class="mm-tint"><i style="background:${tint(0.1)}"></i>dark<i style="background:${tint(0.5)}"></i><i style="background:${tint(0.9)}"></i>bright</span></div>
    <div class="mm-map" id="mm-map"><div class="mm-plane ${lens}">${rim}
      ${list.map((e) => { const [x, y] = pos(e); return `<button class="mm-g" data-act="genre" data-g="${esc(e.name)}" data-emo="${e.wheel.emo}" data-x="${x.toFixed(4)}" data-y="${y.toFixed(4)}"
        style="font-size:${(9.5 + 19 * Math.sqrt(e.tracks.length / max)).toFixed(1)}px;color:${tint(e.avg.valence)}"
        title="${esc(e.name)} · ${emotionById(e.wheel.emo).name.toLowerCase()} · ${plural(e.tracks.length, "song")} · ${esc(topArtists(e.artists, 3).map(([a]) => a).join(", "))}">${esc(e.name)}</button>`; }).join("")}
    </div></div>`;
  return `<div class="mm-wrap"><div class="mm-main">${main}</div><aside class="mm-side card">${panel(ui, kit)}</aside></div>`;
}

/** Place the map's labels: their positions, then nudge overlapping labels apart (runs once the HTML is in the page). */
export function layoutMap(root) {
  const map = root.querySelector("#mm-map");
  if (!map) return;
  const plane = map.querySelector(".mm-plane"), W = Math.max(map.clientWidth - 2, 760), H = 820, pad = 40;
  plane.style.width = W + "px"; plane.style.height = H + "px";
  const box = [...plane.querySelectorAll(".mm-g")].map((el) => ({ el, w: el.offsetWidth + 6, h: el.offsetHeight, x: pad + +el.dataset.x * (W - 2 * pad), y: pad + (1 - +el.dataset.y) * (H - 2 * pad) }));
  for (let it = 0; it < 140; it++) {
    let moved = false;
    for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
      const a = box[i], b = box[j], dx = b.x - a.x, dy = b.y - a.y;
      const ox = (a.w + b.w) / 2 - Math.abs(dx), oy = (a.h + b.h) / 2 - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        moved = true;
        if (ox * 0.6 < oy) { const s = (ox / 2 + 0.5) * (dx < 0 ? -1 : 1); a.x -= s * 0.6; b.x += s * 0.6; }
        else { const s = (oy / 2 + 0.5) * (dy < 0 ? -1 : 1); a.y -= s; b.y += s; }
      }
    }
    for (const b of box) { b.x = Math.max(b.w / 2 + 24, Math.min(W - b.w / 2 - 24, b.x)); b.y = Math.max(24, Math.min(H - 24, b.y)); }   // whole labels stay inside the frame
    if (!moved) break;
  }
  for (const b of box) { b.el.style.left = `${b.x - b.w / 2}px`; b.el.style.top = `${b.y - b.h / 2}px`; }
  plane.classList.add("placed");
}
export function findGenre(root, q) {
  const words = q.toLowerCase().trim();
  root.querySelectorAll(".mm-g").forEach((el) => el.classList.toggle("hit", !!words && el.dataset.g.includes(words)));
  root.querySelector(".mm-plane")?.classList.toggle("searching", !!words);
  const first = words && root.querySelector(".mm-g.hit");
  if (first) first.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
/** Light up the selected genre and its neighbours, or every genre of the selected emotion. */
export function markSelection(root, ui) {
  const g = ui.genre, ns = new Set(g ? near(g, 12).map(([x]) => x) : []);
  root.querySelectorAll(".mm-g").forEach((el) => {
    el.classList.toggle("sel", el.dataset.g === g);
    el.classList.toggle("near", ns.has(el.dataset.g) || (!g && !!ui.emotion && el.dataset.emo === ui.emotion));
  });
  root.querySelectorAll(".mm-emo, .mm-rim").forEach((el) => el.classList.toggle("on", el.dataset.e === ui.emotion));
  root.querySelector(".mm-plane")?.classList.toggle("focused", !!(g || ui.emotion));
}

/* ---------- the side panel: an emotion, a genre, or the start page ---------- */
export function panel(ui, { row, lists }) {
  const G_ = genres();
  if (ui.genre && G_.by.get(ui.genre)) return genrePanel(G_.by.get(ui.genre), { row, lists });
  if (ui.emotion && emotionById(ui.emotion)) return emotionPanel(emotionById(ui.emotion), { row, lists });
  const songs = new Map();
  for (const w of G_.songEmo.values()) songs.set(w.emo, (songs.get(w.emo) || 0) + 1);
  const total = G_.songEmo.size || 1;
  return `<div class="mp-empty"><span class="mp-k">your emotional spectrum</span><h3>How your music feels</h3>
    <p>Every song placed on the mood wheel from its brightness and energy. Click an emotion to light it on the map and hear it.</p>
    <div class="mp-spectrum">${[...EMOTIONS, BALANCED].map((m) => { const n = songs.get(m.id) || 0; return `<button data-act="emotion" data-e="${m.id}"><span>${m.name}</span><i><b style="width:${Math.min(100, (n / total) * 100 * 2.2).toFixed(1)}%"></b></i><em>${Math.round((n / total) * 100)}%</em></button>`; }).join("")}</div>
    <span class="mp-k">your biggest genres</span><div class="mp-chips">${G_.list.slice(0, 12).map((x) => `<button class="mm-chip" data-act="genre" data-g="${esc(x.name)}">${esc(x.name)} <em>${x.tracks.length}</em></button>`).join("")}</div></div>`;
}
function emotionPanel(m, { row, lists }) {
  const G_ = genres();
  const songs = lib.tracks.filter((t) => G_.songEmo.get(t.id)?.emo === m.id).sort((a, b) => G_.songEmo.get(b.id).r - G_.songEmo.get(a.id).r);
  const gs = G_.list.filter((e) => e.wheel?.emo === m.id && e.tracks.length >= 3).slice(0, 14);
  const artists = new Map(); for (const t of songs) artists.set(t.ar[0], (artists.get(t.ar[0]) || 0) + 1);
  lists.emotion = Object.assign(songs.slice(0, 16), { label: m.name });
  return `<span class="mp-k">emotion</span><h3>${m.name}</h3><p class="mp-note">${esc(m.note)}</p>
    <p class="mp-sub">${plural(songs.length, "song")} · ${plural(gs.length, "genre")} on the map</p>
    <div class="mp-acts"><button class="btn sm" data-act="emotion-play">▶ Play ${m.name.toLowerCase()}</button><button class="btn ghost sm" data-act="emotion" data-e="">Close</button></div>
    ${gs.length ? `<span class="mp-k">genres that feel this way</span><div class="mp-chips">${gs.map((e) => `<button class="mm-chip" data-act="genre" data-g="${esc(e.name)}">${esc(e.name)}</button>`).join("")}</div>` : ""}
    <span class="mp-k">who makes it, for you</span><div class="mp-artists">${topArtists(artists, 6).map(([a, n]) => `<span><b>${esc(a)}</b><em>${n}</em></span>`).join("")}</div>
    <span class="mp-k">the clearest examples</span><div class="mp-songs">${lists.emotion.map((t, i) => row(t, i, "emotion")).join("")}</div>`;
}
function genrePanel(e, { row, lists }) {
  lists.genre = Object.assign([...e.tracks].sort((a, b) => (b.pop ?? -1) - (a.pop ?? -1)).slice(0, 14), { label: e.name });
  const rooms = [...e.rooms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => lib.roomById[id]).filter(Boolean);
  const emo = e.wheel && emotionById(e.wheel.emo);
  return `<span class="mp-k">genre</span><h3>${esc(e.name)}</h3>
    <p class="mp-sub">${plural(e.tracks.length, "song")} · ${plural(e.artists.size, "artist")}${e.first ? ` · since ${month(e.first)}` : ""}</p>
    ${emo ? `<p class="mp-note">Feels <button class="mp-emolink" data-act="emotion" data-e="${emo.id}">${emo.name.toLowerCase()}</button> — ${esc(emo.note)}</p>` : ""}
    <div class="mp-acts"><button class="btn sm" data-act="genre-play">▶ Play ${esc(e.name)}</button><button class="btn ghost sm" data-act="genre" data-g="">Close</button></div>
    ${e.avg ? `<div class="mp-feat">${FEAT.map(([k, l]) => `<div><span>${l}</span><i><b style="width:${(e.avg[k] * 100).toFixed(0)}%"></b></i><em>${Math.round(e.avg[k] * 100)}</em></div>`).join("")}</div>` : ""}
    ${rooms.length ? `<span class="mp-k">lives in</span><div class="mp-chips">${rooms.map((r) => `<button class="mm-chip" data-act="room" data-id="${r.id}">${esc(r.name)}</button>`).join("")}</div>` : ""}
    ${near(e.name).length ? `<span class="mp-k">leads to</span><div class="mp-chips">${near(e.name).map(([g, w]) => `<button class="mm-chip" data-act="genre" data-g="${esc(g)}" title="${plural(w, "shared artist")}">${esc(g)}</button>`).join("")}</div>` : ""}
    <span class="mp-k">who makes it, for you</span><div class="mp-artists">${topArtists(e.artists, 6).map(([a, n]) => `<span><b>${esc(a)}</b><em>${n}</em></span>`).join("")}</div>
    <span class="mp-k">songs</span><div class="mp-songs">${lists.genre.map((t, i) => row(t, i, "genre")).join("")}</div>`;
}
export const genreQueue = (g) => { const e = genres().by.get(g); return e ? shuffle(e.tracks) : []; };
export const emotionQueue = (id) => { const G_ = genres(); return shuffle(lib.tracks.filter((t) => G_.songEmo.get(t.id)?.emo === id)); };
