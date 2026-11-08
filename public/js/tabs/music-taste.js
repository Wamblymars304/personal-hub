// Music — Taste: what the library says about you, computed live from data/music.json (every number is unique songs,
// never double-counted across playlists). When you collect (adds per month, the hours you add music in), when it
// was made, who you return to, how it sounds (tempo, key, major/minor, length, energy…), how underground it is,
// your true favourites (songs living in the most playlists), your eras, and the dated snapshots each import saves.
import { esc, plural } from "../ui.js";
import { lib, cover, by, month } from "../music-lib.js";

const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const hour12 = (h) => `${h % 12 || 12} ${h < 12 ? "a.m." : "p.m."}`;

/** Column chart: one accent hue, hover tooltip per bar, optional highlighted bar and sparse axis labels. */
function columns(items, { height = 120, hi = -1, every = 1, label = (x) => x.label } = {}) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return `<div class="tv-cols" style="--h:${height}px">${items.map((x, i) => `<span class="${i === hi ? "hi" : ""}" data-tip="${esc(x.tip)}" aria-label="${esc(x.tip)}"><b style="height:${x.n ? Math.max(2, (x.n / max) * 100) : 0}%"></b></span>`).join("")}</div>
    <div class="tv-axis">${items.map((x, i) => `<i>${i % every === 0 ? esc(label(x)) : ""}</i>`).join("")}</div>`;
}
function hist(vals, bins, lo, hi, fmt) {
  const w = (hi - lo) / bins, c = Array(bins).fill(0);
  for (const v of vals) if (v != null) c[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  return c.map((n, i) => ({ n, label: fmt(lo + i * w), tip: `${fmt(lo + i * w)}–${fmt(lo + (i + 1) * w)} · ${plural(n, "song")}` }));
}

export function tasteBody({ row, lists }) {
  const T = lib.tracks, N = T.length, F = T.filter((t) => t.f && t.f.energy != null);
  const artists = new Map(); for (const t of T) for (const a of t.ar) artists.set(a, (artists.get(a) || 0) + 1);
  const hours = Math.round(T.reduce((s, t) => s + (t.ms || 0), 0) / 3.6e6);
  const genres = new Set(T.flatMap((t) => t.g));
  const first = T.find((t) => t.added)?.added || "";

  /* when you collect: per month, and the week × hour grid in your local time */
  const months = new Map();
  for (const t of T) if (t.added) months.set(t.added.slice(0, 7), (months.get(t.added.slice(0, 7)) || 0) + 1);
  const mk = [];
  if (first) for (let d = new Date(first.slice(0, 7) + "-01T00:00"), end = new Date(); d <= end; d.setMonth(d.getMonth() + 1)) mk.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  const mItems = mk.map((k) => ({ n: months.get(k) || 0, k, label: k.slice(0, 4), tip: `${month(k + "-01")} · ${plural(months.get(k) || 0, "song")} added` }));
  const busiest = mItems.reduce((a, b) => (b.n > a.n ? b : a), mItems[0] || { n: 0 });
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let timed = 0;
  for (const t of T) if (t.at && t.at.length > 10) { const d = new Date(t.at); if (!isNaN(d)) { grid[(d.getDay() + 6) % 7][d.getHours()]++; timed++; } }
  const gmax = Math.max(1, ...grid.flat());
  let top = [0, 0]; grid.forEach((r, i) => r.forEach((n, h) => { if (n > grid[top[0]][top[1]]) top = [i, h]; }));
  const night = grid.reduce((s, r) => s + r.slice(0, 5).reduce((a, b) => a + b, 0) + r[23], 0);

  /* when it was made */
  const ys = T.map((t) => +t.y).filter((y) => y > 1900);
  const y0 = Math.min(...ys), y1 = Math.max(...ys), yc = new Map(); for (const y of ys) yc.set(y, (yc.get(y) || 0) + 1);
  const yItems = []; for (let y = y0; y <= y1; y++) yItems.push({ n: yc.get(y) || 0, label: String(y), tip: `${y} · ${plural(yc.get(y) || 0, "song")}` });
  const dec = new Map(); for (const y of ys) dec.set(Math.floor(y / 10) * 10, (dec.get(Math.floor(y / 10) * 10) || 0) + 1);
  const decTop = [...dec.entries()].sort((a, b) => b[1] - a[1])[0];

  /* who */
  const firstArtist = new Map(); for (const t of T) if (t.ar[0]) (firstArtist.get(t.ar[0]) || firstArtist.set(t.ar[0], []).get(t.ar[0])).push(t);
  const topA = [...firstArtist.entries()].sort((a, b) => b[1].length - a[1].length);
  const top10 = topA.slice(0, 10).reduce((s, [, l]) => s + l.length, 0);
  const once = [...artists.values()].filter((n) => n === 1).length;

  /* how it sounds */
  const bpm = median(F.map((t) => t.f.tempo)), minor = F.filter((t) => t.f.mode === 0).length, withMode = F.filter((t) => t.f.mode != null).length;
  const keyC = Array(12).fill(0); for (const t of F) if (t.f.key >= 0 && t.f.key < 12) keyC[t.f.key]++;
  const keyTop = keyC.indexOf(Math.max(...keyC));
  const lens = T.map((t) => (t.ms || 0) / 60000).filter((m) => m > 0);
  const longest = [...T].sort((a, b) => (b.ms || 0) - (a.ms || 0))[0], shortest = [...T].filter((t) => t.ms > 0).sort((a, b) => a.ms - b.ms)[0];
  const instr = F.filter((t) => t.f.instr > 0.5).length;

  /* how underground */
  // Spotify exports 0 for regional re-releases of even famous songs, so 0 means "unknown" here, not "obscure"
  const P = T.filter((t) => t.pop > 0), deep = P.filter((t) => t.pop < 15).length, zeros = T.filter((t) => t.pop === 0).length;
  const popA = topA.filter(([, l]) => l.filter((t) => t.pop > 0).length >= 5).map(([a, l]) => [a, median(l.filter((t) => t.pop > 0).map((t) => t.pop))]);
  const obscure = [...popA].sort((a, b) => a[1] - b[1]).slice(0, 6), famous = [...popA].sort((a, b) => b[1] - a[1]).slice(0, 6);

  /* true favourites: the songs you put in the most playlists */
  lists.fav = Object.assign([...T].filter((t) => t.pl.length >= 3).sort((a, b) => b.pl.length - a.pl.length || (b.pop ?? 0) - (a.pop ?? 0)).slice(0, 12), { label: "True favourites" });

  /* eras: what you added most each year */
  const eras = new Map();
  for (const t of T) if (t.added) { const y = t.added.slice(0, 4), m = eras.get(y) || eras.set(y, { n: 0, g: new Map() }).get(y); m.n++; for (const g of new Set(t.g)) m.g.set(g, (m.g.get(g) || 0) + 1); }

  const hist_ = lib.history || [];
  return `<div class="tv">
    <section class="tv-lede">
      <div><b>${N.toLocaleString()}</b><span>songs, none counted twice</span></div>
      <div><b>${artists.size.toLocaleString()}</b><span>artists</span></div>
      <div><b>${hours.toLocaleString()}</b><span>hours of music</span></div>
      <div><b>${genres.size}</b><span>genres</span></div>
      <div><b>${lib.playlists.length}</b><span>playlists</span></div>
      <div><b>${first.slice(0, 4)}</b><span>collecting since</span></div>
    </section>

    <h2 class="tv-h"><i>I.</i> When you collect</h2>
    <div class="tv-two">
      <section class="tv-card wide"><h3>Songs added each month</h3><p>Your busiest month was <b>${busiest.k ? month(busiest.k + "-01") : "—"}</b>, with ${plural(busiest.n, "song")}.</p>
        ${columns(mItems, { hi: mItems.indexOf(busiest), label: (x) => (x.k.endsWith("-01") && +x.k.slice(0, 4) % 2 === 0 ? x.k.slice(0, 4) : "") })}</section>
      <section class="tv-card"><h3>The hours you add music</h3><p>${timed ? `Most often on <b>${DAYS[top[0]]}s around ${hour12(top[1])}</b>; ${pct(night, timed)}% of your adds happen between 11 p.m. and 5 a.m.` : "No add times in the exports."}</p>
        <div class="tv-week">${grid.map((r, i) => `<span class="tv-day">${DAYS[i]}</span>${r.map((n, h) => `<i style="--v:${n ? (0.12 + 0.88 * Math.sqrt(n / gmax)).toFixed(3) : 0}" data-tip="${DAYS[i]} ${hour12(h)} · ${plural(n, "song")}"></i>`).join("")}`).join("")}
          <span></span>${Array.from({ length: 24 }, (_, h) => `<em>${h % 6 === 0 ? hour12(h).replace(" ", "") : ""}</em>`).join("")}</div>
        <p class="tv-foot">Your local time · brighter = more songs added</p></section>
    </div>

    <h2 class="tv-h"><i>II.</i> When it was made</h2>
    <section class="tv-card wide"><p>Your music spans <b>${y0}–${y1}</b>. Half of it was released before <b>${median(ys)}</b>; the decade you collect most is the <b>${decTop ? `${decTop[0]}s` : "—"}</b> (${pct(decTop?.[1] || 0, ys.length)}%).</p>
      ${columns(yItems, { every: 10, label: (x) => (+x.label % 10 === 0 ? x.label : "") })}
      <div class="tv-chips">${[...dec.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `<span>${d}s <em>${pct(n, ys.length)}%</em></span>`).join("")}</div></section>

    <h2 class="tv-h"><i>III.</i> Who you return to</h2>
    <div class="tv-two">
      <section class="tv-card wide"><h3>Most-collected artists</h3>
        <div class="tv-artists">${topA.slice(0, 15).map(([a, l]) => { const c = l.find((t) => t.c); return `<button data-act="find" data-q="${esc(a)}" title="Find ${esc(a)}"><span class="tv-cv">${c ? `<img src="${cover(c)}" alt="" loading="lazy" />` : ""}</span><b>${esc(a)}</b><i><u style="width:${((l.length / topA[0][1].length) * 100).toFixed(1)}%"></u></i><em>${l.length}</em></button>`; }).join("")}</div></section>
      <section class="tv-card"><h3>Deep dives or a wide net?</h3>
        <div class="tv-stat"><b>${pct(top10, N)}%</b><span>of your songs come from your top 10 artists</span></div>
        <div class="tv-stat"><b>${pct(once, artists.size)}%</b><span>of your artists appear on just one song</span></div>
        <div class="tv-stat"><b>${(N / artists.size).toFixed(1)}</b><span>songs per artist on average</span></div></section>
    </div>

    <h2 class="tv-h"><i>IV.</i> How it sounds</h2>
    <div class="tv-grid">
      <section class="tv-card"><h3>Tempo</h3><p>Half your songs run faster than <b>${bpm ? Math.round(bpm) : "—"} BPM</b>.</p>${columns(hist(F.map((t) => t.f.tempo), 14, 60, 200, (v) => `${Math.round(v)}`), { every: 2 })}</section>
      <section class="tv-card"><h3>Major or minor</h3><p><b>${pct(minor, withMode)}%</b> of your songs are in a minor key${withMode ? ` — ${minor > withMode / 2 ? "more than" : "less than"} half` : ""}.</p>
        <div class="tv-split"><span style="width:${pct(minor, withMode)}%">minor ${pct(minor, withMode)}%</span><span>major ${100 - pct(minor, withMode)}%</span></div>
        <p class="tv-foot">Most common key: <b>${KEYS[keyTop]}</b></p>${columns(keyC.map((n, i) => ({ n, label: KEYS[i], tip: `${KEYS[i]} · ${plural(n, "song")}` })), { hi: keyTop, height: 70 })}</section>
      <section class="tv-card"><h3>Song length</h3><p>Longest: <b>${esc(longest?.t || "")}</b> (${Math.round((longest?.ms || 0) / 60000)} min). Shortest: <b>${esc(shortest?.t || "")}</b> (${Math.round((shortest?.ms || 0) / 1000)} s).</p>${columns(hist(lens, 12, 0, 12, (v) => `${Math.round(v)}m`), { every: 2 })}</section>
      ${[["energy", "Energy", "calm", "intense"], ["valence", "Brightness", "dark", "bright"], ["acoustic", "Acoustic", "electric", "acoustic"], ["dance", "Danceability", "still", "danceable"]].map(([k, l, a, b]) =>
        `<section class="tv-card"><h3>${l}</h3><p>Median <b>${Math.round((median(F.map((t) => t.f[k])) || 0) * 100)}</b> out of 100${k === "acoustic" ? ` · <b>${pct(instr, F.length)}%</b> of songs have no vocals` : ""}.</p>${columns(hist(F.map((t) => t.f[k]), 10, 0, 1, (v) => `${Math.round(v * 100)}`), { height: 70, every: 5 })}<div class="tv-ends"><span>${a}</span><span>${b}</span></div></section>`).join("")}
    </div>

    <h2 class="tv-h"><i>V.</i> How underground</h2>
    <div class="tv-two">
      <section class="tv-card wide"><h3>Spotify popularity of your songs</h3><p><b>${pct(deep, P.length)}%</b> are deep cuts (popularity under 15 of 100); half sit below <b>${median(P.map((t) => t.pop)) ?? "—"}</b>.</p>${columns(hist(P.map((t) => t.pop), 20, 0, 100, (v) => `${Math.round(v)}`), { every: 4 })}<div class="tv-ends"><span>nobody's heard of it</span><span>everyone has</span></div>
        <p class="tv-foot">${plural(zeros, "song")} Spotify lists at 0 are left out — that's usually a regional re-release, not obscurity.</p></section>
      <section class="tv-card"><h3>Your most obscure artists</h3><div class="tv-list">${obscure.map(([a, p]) => `<button data-act="find" data-q="${esc(a)}"><b>${esc(a)}</b><em>${p}</em></button>`).join("")}</div>
        <h3 class="tv-mt">And the most famous</h3><div class="tv-list">${famous.map(([a, p]) => `<button data-act="find" data-q="${esc(a)}"><b>${esc(a)}</b><em>${p}</em></button>`).join("")}</div><p class="tv-foot">median popularity, artists with five songs or more</p></section>
    </div>

    <h2 class="tv-h"><i>VI.</i> True favourites</h2>
    <section class="tv-card wide"><p>The songs you put in the most playlists — the ones you keep coming back to.</p>
      <div class="tv-favs">${lists.fav.map((t, i) => `<div class="tv-fav"><span class="tv-pl">${t.pl.length}</span>${row(t, i, "fav")}</div>`).join("") || `<p class="tv-foot">No song is in three playlists yet.</p>`}</div></section>

    <h2 class="tv-h"><i>VII.</i> Your eras</h2>
    <section class="tv-card wide"><p>What you collected most, year by year.</p>
      <div class="tv-eras">${[...eras.entries()].sort().map(([y, m]) => `<div><b>${y}</b><em>${plural(m.n, "song")}</em><span>${[...m.g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => esc(g)).join(" · ") || "—"}</span></div>`).join("")}</div></section>

    <h2 class="tv-h"><i>VIII.</i> Your library over time</h2>
    <section class="tv-card wide"><p>A snapshot is saved every time you import — so you can watch your taste move.</p>
      <div class="tv-hist"><div class="tv-hrow head"><span>imported</span><span>songs</span><span>artists</span><span>hours</span><span>top genres</span></div>
      ${[...hist_].reverse().map((h) => `<div class="tv-hrow"><span>${esc(h.date)}</span><span>${h.songs.toLocaleString()}</span><span>${h.artists.toLocaleString()}</span><span>${h.hours}</span><span>${esc((h.topGenres || []).slice(0, 5).join(" · "))}</span></div>`).join("")}</div></section>
  </div>`;
}
