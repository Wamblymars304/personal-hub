// Hobbies — the garden. Same data and rules as hobbies_tab.py (habits with a 66-day autopilot tracker,
// streaks, interests). Every habit and streak is a plant: it grows a little for every day you log it,
// flowers while a run is going (full bloom at 66 days) and goes thirsty, then dormant, when you stop.
// Any day can be logged or un-logged (the strips and the year grid), not just today.
import { db, commit, newId, today, iso, parseDate, parseTags, currentStreak } from "../store.js";
import { esc, plural, toast, fmtDate } from "../ui.js";
import { stagger } from "../../vendor/anime.esm.min.js";
import { animateAny as animate } from "../motion.js";
import { motionEnabled, pulse } from "../background.js";

const INTERNALIZE_DAYS = 66;
const DOPA = { Low: "var(--cyan)", Medium: "var(--amber)", High: "var(--pink)" };
const ui = { dopa: "Medium", track: true, subject: "all", edit: null, bump: null };
const still = () => !motionEnabled();

/* ---------- small helpers ---------- */
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayKey = (s) => { const d = parseDate(s); return d ? iso(d) : null; };
const between = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function stats(x, t) {
  const set = new Set((x.activeDates || []).map(dayKey).filter(Boolean));
  const sorted = [...set].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) { run = prev && between(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const last = sorted[sorted.length - 1] || null;
  // a run that ended yesterday is still alive until today is over
  let pend = 0;
  if (!set.has(t)) for (let d = addDays(parseDate(t), -1); set.has(iso(d)); d = addDays(d, -1)) pend++;
  return { set, total: set.size, best, pend, cur: currentStreak(x.activeDates), last, first: sorted[0] || null, since: last ? between(last, t) : Infinity, on: set.has(t) };
}
const stateOf = (s) => (s.total === 0 ? "seed" : s.on ? "lit" : s.since <= 2 ? "fresh" : s.since <= 13 ? "thirsty" : "dormant");
const STATE_TXT = { seed: "a seed", lit: "watered today", fresh: "growing", thirsty: "thirsty", dormant: "dormant" };

// toggle one day; a new date is inserted in order without reordering the dates already there
function toggleDay(x, d) {
  const arr = (x.activeDates ||= []);
  if (arr.some((e) => dayKey(e) === d)) { x.activeDates = arr.filter((e) => dayKey(e) !== d); return false; }
  const i = arr.findIndex((e) => (dayKey(e) || "") > d);
  i < 0 ? arr.push(d) : arr.splice(i, 0, d);
  return true;
}

/* ---------- the garden bed: one plant per habit / streak ---------- */
const W_SLOT = 128, H = 252, BASE = 192;
function bezier(p, t) { const u = 1 - t; return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); }
function tangent(p, t) { const u = 1 - t; return [0, 1].map((k) => 3 * u * u * (p[1][k] - p[0][k]) + 6 * u * t * (p[2][k] - p[1][k]) + 3 * t * t * (p[3][k] - p[2][k])); }
const leaf = (s) => `M0 0Q${(s * 0.5).toFixed(1)} ${(-s * 0.42).toFixed(1)} ${s.toFixed(1)} 0Q${(s * 0.5).toFixed(1)} ${(s * 0.42).toFixed(1)} 0 0Z`;

function plant(x, item, kind, s, t) {
  const r = rng(hash(item.id)), st = stateOf(s);
  const name = esc(short(item.name || "untitled", 16));
  const tip = `${item.name} — ${s.total} ${s.total === 1 ? "day" : "days"} logged${s.best ? `, best run ${s.best}` : ""}${s.last ? `, last ${fmtDate(s.last, { year: true })}` : ""}. ${s.on ? "Click to un-log today." : "Click to log today."}`;
  let art = "";
  if (st === "seed") {
    art = `<ellipse class="mound" cx="${x}" cy="${BASE + 2}" rx="20" ry="6"/><path class="stem" d="M${x} ${BASE} q1 -8 0 -14"/>
      <path class="lf" transform="translate(${x} ${BASE - 13}) rotate(-35)" d="${leaf(9)}"/><path class="lf" transform="translate(${x} ${BASE - 13}) rotate(-145)" d="${leaf(9)}"/>`;
  } else if (kind === "streaks") {
    const g = Math.min(1, Math.sqrt(s.total / 45)), h = 50 + 100 * g, lean = (r() - 0.5) * 14, cr = 14 + 20 * g;
    const top = [x + lean, BASE - h];
    art = `<path class="trunk" d="M${x} ${BASE} C${x} ${BASE - h * 0.4} ${x + lean * 0.3} ${BASE - h * 0.7} ${top[0].toFixed(1)} ${top[1].toFixed(1)}" style="stroke-width:${(3 + g * 3).toFixed(1)}"/>`;
    const blobs = [[0, -cr * 0.35, cr], [-cr * 0.7, cr * 0.15, cr * 0.72], [cr * 0.72, cr * 0.1, cr * 0.75], [cr * 0.1, cr * 0.45, cr * 0.6]];
    art += blobs.map(([dx, dy, rr]) => `<circle class="canopy" cx="${(top[0] + dx).toFixed(1)}" cy="${(top[1] + dy).toFixed(1)}" r="${rr.toFixed(1)}"/>`).join("");
    const fruit = Math.min(12, s.cur);
    for (let i = 0; i < fruit; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cr * 0.8; art += `<circle class="fruit" cx="${(top[0] + Math.cos(a) * d).toFixed(1)}" cy="${(top[1] + Math.sin(a) * d * 0.8).toFixed(1)}" r="2.6"/>`; }
  } else {
    const g = Math.min(1, Math.sqrt(s.total / 45)), h = 50 + 120 * g, lean = (r() - 0.5) * 30;
    const droop = st === "thirsty" ? 0.6 : st === "dormant" ? 1 : 0;
    const side0 = r() < 0.5 ? -1 : 1;
    const tx = x + lean + side0 * droop * 16, ty = BASE - h + droop * h * 0.12;
    const P = [[x, BASE], [x + (r() - 0.5) * 10, BASE - h * 0.45], [x + lean * 0.6 - side0 * droop * 6, BASE - h * 0.85], [tx, ty]];
    art = `<path class="stem" d="M${P[0]} C${P[1].map((v) => v.toFixed(1))} ${P[2].map((v) => v.toFixed(1))} ${P[3].map((v) => v.toFixed(1))}" style="stroke-width:${(2 + g * 1.6).toFixed(1)}"/>`;
    const n = Math.min(14, Math.max(2, Math.ceil(s.total / 1.3)));
    for (let i = 0; i < n; i++) {
      const tt = 0.12 + (i / n) * 0.78, [px, py] = bezier(P, tt), [dx, dy] = tangent(P, tt), side = i % 2 ? 1 : -1;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI + side * (58 + r() * 22) + side * droop * 38;
      const size = (9 + r() * 7) * (1 - tt * 0.35) * (0.8 + g * 0.5);
      art += `<path class="lf" transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${ang.toFixed(0)})" d="${leaf(size)}"/>`;
    }
    if (item.trackStreak) {
      const bloom = Math.min(1, s.cur / INTERNALIZE_DAYS);
      if (s.cur > 0) {
        const k = 5 + (hash(item.id) % 3), R = 7 + bloom * 14;
        if (bloom >= 1) art += `<circle class="halo" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="${(R * 1.7).toFixed(1)}"/>`;
        art += `<g class="flower" transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)})">${Array.from({ length: k }, (_, i) => `<ellipse class="petal" cx="0" cy="${(-R * 0.55).toFixed(1)}" rx="${(R * 0.33).toFixed(1)}" ry="${(R * 0.55).toFixed(1)}" transform="rotate(${((i * 360) / k).toFixed(0)})"/>`).join("")}<circle class="pistil" r="${(R * 0.3).toFixed(1)}"/></g>`;
      } else {
        art += `<g class="bud" transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${(droop * side0 * 50).toFixed(0)})"><ellipse class="bud-p" cx="0" cy="-5" rx="3.6" ry="6.5"/><path class="lf" transform="rotate(-62)" d="${leaf(7)}"/><path class="lf" transform="rotate(-118)" d="${leaf(7)}"/></g>`;
      }
    } else {
      art += `<path class="lf" transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(-70)" d="${leaf(10)}"/><path class="lf" transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(-110)" d="${leaf(10)}"/>`;
    }
  }
  const flies = s.on ? Array.from({ length: 3 }, (_, i) => `<circle class="fly" cx="${(x + (r() - 0.5) * 70).toFixed(1)}" cy="${(BASE - 30 - r() * 110).toFixed(1)}" r="${(1.4 + r()).toFixed(1)}" style="animation-delay:${(-r() * 6).toFixed(2)}s;animation-duration:${(4 + r() * 3).toFixed(1)}s"/>`).join("") : "";
  return `<g class="gd-plant st-${st}${kind === "streaks" ? " tree" : ""}" data-act="water" data-k="${kind}" data-id="${item.id}" tabindex="0" role="button" aria-label="${esc(tip)}" style="--f:${DOPA[item.dopamineLevel] || "var(--amber)"}">
    <title>${esc(tip)}</title><rect class="hit" x="${x - W_SLOT / 2 + 6}" y="20" width="${W_SLOT - 12}" height="${H - 20}" rx="12"/>
    <g class="sway" style="transform-origin:${x}px ${BASE}px">${art}</g>${flies}
    <text class="nm" x="${x}" y="${BASE + 30}">${name}</text><text class="mt" x="${x}" y="${BASE + 45}">${s.total ? `${s.total}d · ${STATE_TXT[st]}` : "plant it: log a day"}</text></g>`;
}

function bed(items, t) {
  if (!items.length) return `<div class="gd-bare">The bed is empty — add a habit below and a seed goes in.</div>`;
  const W = Math.max(980, items.length * W_SLOT), slot = W / items.length, r = rng(7);
  const tufts = Array.from({ length: Math.round(W / 26) }, () => { const x = r() * W, h = 4 + r() * 7; return `M${x.toFixed(0)} ${BASE + 3}l-2 -${h.toFixed(0)}M${x.toFixed(0)} ${BASE + 3}l2.5 -${(h * 0.8).toFixed(0)}`; }).join("");
  const lit = items.filter((x) => x.s.on).length;
  const ambient = Array.from({ length: 8 + lit * 3 }, () => `<circle class="fly amb" cx="${(r() * W).toFixed(0)}" cy="${(30 + r() * (BASE - 60)).toFixed(0)}" r="${(1 + r() * 1.2).toFixed(1)}" style="animation-delay:${(-r() * 8).toFixed(2)}s;animation-duration:${(6 + r() * 5).toFixed(1)}s"/>`).join("");
  return `<svg class="gd-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" role="group" aria-label="Your garden">
    <defs><linearGradient id="gdSoil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a1c" stop-opacity=".9"/><stop offset="1" stop-color="#0b1408" stop-opacity="0"/></linearGradient>
      <radialGradient id="gdHalo"><stop offset="0" stop-color="#c8ff6a" stop-opacity=".45"/><stop offset="1" stop-color="#c8ff6a" stop-opacity="0"/></radialGradient></defs>
    ${ambient}
    <path class="soil" d="M0 ${BASE} Q${W * 0.25} ${BASE - 6} ${W * 0.5} ${BASE} T${W} ${BASE} V${H} H0Z" fill="url(#gdSoil)"/>
    <path class="horizon" d="M0 ${BASE} Q${W * 0.25} ${BASE - 6} ${W * 0.5} ${BASE} T${W} ${BASE}"/>
    <path class="tuft" d="${tufts}"/>
    ${items.map((x, i) => plant(slot * (i + 0.5), x.item, x.kind, x.s, t)).join("")}
  </svg>`;
}

/* ---------- the 14-day strip (every day is a button) ---------- */
function strip(item, kind, s, t) {
  const T = parseDate(t);
  let h = "";
  for (let i = 13; i >= 0; i--) {
    const d = iso(addDays(T, -i)), on = s.set.has(d), dd = addDays(T, -i);
    h += `<button class="gd-day${on ? " on" : ""}${i === 0 ? " today" : ""}" data-act="day" data-k="${kind}" data-id="${item.id}" data-d="${d}" aria-pressed="${on}" title="${dd.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${on ? " · logged" : ""}"><i></i><span>${DOW[dd.getDay()]}</span></button>`;
  }
  return `<div class="gd-strip" role="group" aria-label="Last 14 days of ${esc(item.name)}">${h}</div>`;
}

/* ---------- the year grid ---------- */
function yearGrid(subjects, t) {
  const T = parseDate(t), dow = (T.getDay() + 6) % 7, start = addDays(T, -(52 * 7 + dow));
  const one = ui.subject !== "all" ? subjects.find((x) => x.item.id === ui.subject) : null;
  const total = subjects.length || 1;
  const cells = [], months = [];
  let lastMonth = -1, logged = 0, max = 0;
  const counts = [];
  for (let i = 0; i < 53 * 7; i++) {
    const d = addDays(start, i), k = iso(d), fut = d > T;
    const n = fut ? 0 : one ? (one.s.set.has(k) ? 1 : 0) : subjects.reduce((a, x) => a + (x.s.set.has(k) ? 1 : 0), 0);
    counts.push(n); if (n) logged++; max = Math.max(max, n);
    if (i % 7 === 0 && d.getMonth() !== lastMonth) { lastMonth = d.getMonth(); const w = Math.floor(i / 7); if (!months.length || w - months[months.length - 1][0] >= 3) months.push([w, d.toLocaleDateString("en-US", { month: "short" })]); else months[months.length - 1] = [w, d.toLocaleDateString("en-US", { month: "short" })]; }
  }
  for (let i = 0; i < counts.length; i++) {
    const d = addDays(start, i), k = iso(d), fut = d > T, n = counts[i];
    const lvl = one ? (n ? 4 : 0) : n ? Math.max(1, Math.ceil((n / Math.max(max, 1)) * 4)) : 0;
    const tip = `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · ${one ? (n ? "logged" : "not logged") : `${n} of ${total}`}`;
    cells.push(fut ? `<i class="fut"></i>` : one ? `<button class="l${lvl}${k === t ? " today" : ""}" data-act="day" data-k="${one.kind}" data-id="${one.item.id}" data-d="${k}" aria-pressed="${!!n}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"></button>`
      : `<i class="l${lvl}${k === t ? " today" : ""}" data-tip="${esc(tip)}"></i>`);
  }
  const chips = [`<button class="chip${!one ? " on" : ""}" data-act="subject" data-s="all">Everything</button>`, ...subjects.map((x) => `<button class="chip${one === x ? " on" : ""}" data-act="subject" data-s="${x.item.id}">${esc(short(x.item.name, 22))}</button>`)].join("");
  let side;
  if (one) {
    side = `<dl class="gd-dl"><div><dt>days logged</dt><dd>${one.s.total}</dd></div><div><dt>run now</dt><dd>${one.s.cur}</dd></div><div><dt>best run</dt><dd>${one.s.best}</dd></div>
      <div><dt>since</dt><dd>${one.s.first ? esc(fmtDate(one.s.first, { year: true })) : "—"}</dd></div></dl><p class="gd-note">Click any square to log or un-log that day.</p>`;
  } else {
    const byMonth = {};
    subjects.forEach((x) => x.s.set.forEach((d) => (byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1)));
    const top = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    const all = subjects.reduce((a, x) => a + x.s.total, 0);
    side = `<dl class="gd-dl"><div><dt>tended days</dt><dd>${logged}</dd></div><div><dt>check-ins</dt><dd>${all}</dd></div><div><dt>most in a day</dt><dd>${max}</dd></div>
      <div><dt>busiest month</dt><dd>${top ? esc(new Date(top[0] + "-15").toLocaleDateString("en-US", { month: "short", year: "numeric" })) : "—"}</dd></div></dl><p class="gd-note">Pick one habit to edit its history day by day.</p>`;
  }
  return `<div class="chips gd-subjects">${chips}</div>
    <div class="gd-year-wrap"><div class="gd-year-scroll"><div class="gd-months">${months.map(([w, m]) => `<span style="grid-column:${w + 1}">${m}</span>`).join("")}</div>
      <div class="gd-year-body"><div class="gd-dows"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
      <div class="gd-year${one ? " one" : ""}">${cells.join("")}</div></div>
      <div class="gd-legend"><span>less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>more</span></div></div>
      <aside class="gd-side">${side}</aside></div>`;
}

/* ---------- interest seed packets ---------- */
const PACKET = ["#c8ff6a", "#8ff0c8", "#ffd36e", "#ff8fc8", "#7fd8e6", "#b9a6ff", "#ffb347"];
function glyph(h) {
  const r = rng(hash(h.id + h.name)), c = PACKET[hash(h.name) % PACKET.length], k = 4 + Math.floor(r() * 5), R = 11 + r() * 5, kind = Math.floor(r() * 3);
  const petals = Array.from({ length: k }, (_, i) => kind === 0 ? `<ellipse cx="0" cy="${(-R * 0.55).toFixed(1)}" rx="${(R * 0.3).toFixed(1)}" ry="${(R * 0.55).toFixed(1)}" transform="rotate(${(i * 360) / k})"/>`
    : kind === 1 ? `<circle cx="0" cy="${(-R * 0.6).toFixed(1)}" r="${(R * 0.34).toFixed(1)}" transform="rotate(${(i * 360) / k})"/>`
    : `<path d="M0 0L${(R * 0.22).toFixed(1)} ${(-R * 0.6).toFixed(1)}L0 ${(-R).toFixed(1)}L${(-R * 0.22).toFixed(1)} ${(-R * 0.6).toFixed(1)}Z" transform="rotate(${(i * 360) / k})"/>`).join("");
  return `<svg class="gd-glyph" viewBox="-30 -30 60 60" style="--g:${c}" aria-hidden="true"><path class="gs" d="M0 4 Q${(r() * 8 - 4).toFixed(1)} 16 0 30"/><path class="gl" d="M0 20 Q8 14 13 18 Q7 23 0 20Z"/><g class="gp">${petals}</g><circle class="gc" r="${(R * 0.24).toFixed(1)}"/></svg>`;
}
function packet(h) {
  if (ui.edit === h.id) {
    return `<form class="gd-packet editing" data-row="${h.id}" data-form="hobby" data-id="${h.id}" autocomplete="off">
      <input class="in" name="name" value="${esc(h.name)}" required aria-label="Name" />
      <input class="in" name="tags" value="${esc((h.tags || []).join(" "))}" placeholder="tags" aria-label="Tags" />
      <input class="in" name="desc" value="${esc(h.desc || "")}" placeholder="a line about it" aria-label="Description" />
      <div class="gd-fa"><button class="btn sm">Save</button><button type="button" class="btn ghost sm" data-act="cancel">Cancel</button></div></form>`;
  }
  return `<article class="gd-packet" data-row="${h.id}">
    ${glyph(h)}
    <b>${esc(h.name)}</b>
    ${h.desc ? `<p>${esc(h.desc)}</p>` : ""}
    ${(h.tags || []).length ? `<div class="gd-tags">${h.tags.map((x) => `<span>#${esc(x)}</span>`).join("")}</div>` : ""}
    <small>planted ${esc(fmtDate(h.added, { year: true }) || "—")}</small>
    <div class="gd-pk-acts"><button class="gd-ic" data-act="edit" data-id="${h.id}" title="Edit" aria-label="Edit ${esc(h.name)}">${PENCIL}</button><button class="gd-ic del" data-act="del-hobby" data-id="${h.id}" title="Delete" aria-label="Delete ${esc(h.name)}">×</button></div>
  </article>`;
}
const PENCIL = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5L5.6 12.9 2.6 13.4l.5-3z"/></svg>`;
const DROP = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5C10 2.5 4.5 9 4.5 12.3a5.5 5.5 0 0 0 11 0C15.5 9 10 2.5 10 2.5z"/></svg>`;

/* ---------- rows ---------- */
function habitRow(h, s, t) {
  if (ui.edit === h.id) {
    return `<form class="gd-row editing" data-row="${h.id}" data-form="habit" data-id="${h.id}" autocomplete="off">
      <input class="in grow" name="name" value="${esc(h.name)}" required aria-label="Habit name" />
      <input class="in grow" name="desc" value="${esc(h.desc || "")}" placeholder="Why / details" aria-label="Why" />
      <select class="in" name="dopa" aria-label="Dopamine level">${Object.keys(DOPA).map((d) => `<option${h.dopamineLevel === d ? " selected" : ""}>${d}</option>`).join("")}</select>
      <label class="gd-tog"><input type="checkbox" name="track"${h.trackStreak ? " checked" : ""} /> 66-day tracker</label>
      <button class="btn sm">Save</button><button type="button" class="btn ghost sm" data-act="cancel">Cancel</button></form>`;
  }
  const pct = Math.min(100, Math.round((s.cur / INTERNALIZE_DAYS) * 100));
  return `<div class="gd-row${s.on ? " on" : ""}" data-row="${h.id}" style="--f:${DOPA[h.dopamineLevel] || "var(--slate)"}">
    <button class="gd-water${s.on ? " on" : ""}" data-act="log" data-k="habits" data-id="${h.id}" aria-pressed="${s.on}" title="${s.on ? "Logged today — click to undo" : "Log today"}">${DROP}</button>
    <span class="gd-name"><b>${esc(h.name)}</b>${h.desc ? `<small>${esc(h.desc)}</small>` : `<small class="none">${STATE_TXT[stateOf(s)]}</small>`}</span>
    <span class="gd-dopa">${h.dopamineLevel ? `<i></i>${esc(h.dopamineLevel)}` : ""}</span>
    ${strip(h, "habits", s, t)}
    ${s.pend ? `<span class="gd-run pend" title="Log today to keep this ${s.pend}-day run going"><b>${s.pend}</b><small>day run</small><em>log today</em></span>` : `<span class="gd-run"><b>${s.cur}</b><small>day run</small><em>best ${s.best}</em></span>`}
    ${h.trackStreak ? `<span class="gd-auto" title="${s.cur} of ${INTERNALIZE_DAYS} days in a row to autopilot"><span class="bar"><i style="width:${pct}%"></i><u style="left:${(21 / 66) * 100}%"></u><u style="left:${(40 / 66) * 100}%"></u></span>
      <small>${s.cur >= INTERNALIZE_DAYS ? "on autopilot" : s.cur ? `${s.cur} of ${INTERNALIZE_DAYS} days · ${INTERNALIZE_DAYS - s.cur} to go` : `0 of ${INTERNALIZE_DAYS} days to autopilot`}</small></span>` : `<span class="gd-auto off"><small>no 66-day tracker</small></span>`}
    <span class="gd-acts"><button class="gd-ic" data-act="edit" data-id="${h.id}" title="Edit" aria-label="Edit ${esc(h.name)}">${PENCIL}</button><button class="gd-ic del" data-act="del-habit" data-id="${h.id}" title="Delete" aria-label="Delete ${esc(h.name)}">×</button></span>
  </div>`;
}
function streakRow(x, s, t) {
  if (ui.edit === x.id) {
    return `<form class="gd-srow editing" data-row="${x.id}" data-form="streak" data-id="${x.id}" autocomplete="off"><input class="in grow" name="name" value="${esc(x.name)}" required aria-label="Streak name" />
      <button class="btn sm">Save</button><button type="button" class="btn ghost sm" data-act="cancel">Cancel</button></form>`;
  }
  return `<div class="gd-srow${s.on ? " on" : ""}" data-row="${x.id}">
    <button class="gd-water${s.on ? " on" : ""}" data-act="log" data-k="streaks" data-id="${x.id}" aria-pressed="${s.on}" title="${s.on ? "Logged today — click to undo" : "Log today"}">${DROP}</button>
      <span class="gd-name"><b>${esc(x.name)}</b><small>${s.total} days in all · best ${s.best}</small></span>
      <span class="gd-big${s.pend ? " pend" : ""}" title="${s.pend ? `Log today to keep this ${s.pend}-day run going` : ""}"><b>${s.pend || s.cur}</b><small>${(s.pend || s.cur) === 1 ? "day" : "days"}${s.pend ? "<br>log today" : ""}</small></span>
      ${strip(x, "streaks", s, t)}
      <span class="gd-acts"><button class="gd-ic" data-act="edit" data-id="${x.id}" title="Rename" aria-label="Rename ${esc(x.name)}">${PENCIL}</button><button class="gd-ic del" data-act="del-streak" data-id="${x.id}" title="Delete" aria-label="Delete ${esc(x.name)}">×</button></span>
  </div>`;
}

/* ---------- render ---------- */
export default {
  id: "hobbies", label: "Hobbies", color: "var(--green)",
  count: () => db.habits.length + db.streaks.length,
  render(root, app, focus) {
    const t = today();
    if (focus) { if ([...db.habits, ...db.streaks].some((x) => x.id === focus)) ui.subject = focus; }
    const H_ = db.habits.map((item) => ({ item, kind: "habits", s: stats(item, t) }));
    const S_ = db.streaks.map((item) => ({ item, kind: "streaks", s: stats(item, t) }));
    if (ui.subject !== "all" && ![...H_, ...S_].some((x) => x.item.id === ui.subject)) ui.subject = "all";
    const streaks = [...S_].sort((a, b) => b.s.cur - a.s.cur || b.s.total - a.s.total);
    const tended = H_.filter((x) => x.s.on).length, alive = S_.filter((x) => x.s.cur > 0).length;
    const bloomers = H_.filter((x) => x.item.trackStreak && x.s.cur > 0).length;
    const dateLine = parseDate(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    root.innerHTML = `<div class="gd${still() ? " gd-still" : ""}">
      <div class="page-h"><h1>Hobbies</h1><span class="sub"><b>${tended}</b> of ${db.habits.length} habits tended today · ${plural(alive, "streak")} going · ${plural(db.hobbies.length, "interest")}</span></div>

      <section class="card gd-bed">
        <header class="gd-bed-h"><div><span class="gd-k">${esc(dateLine)}</span>
          <p>Every day you log something, its plant grows. A run makes it flower — full bloom at ${INTERNALIZE_DAYS} days, when the habit is on autopilot. Click a plant to water it today.</p></div>
          <div class="gd-key"><span><i class="k-lit"></i>watered today</span><span><i class="k-fresh"></i>growing</span><span><i class="k-thirsty"></i>thirsty</span><span><i class="k-dormant"></i>dormant</span>${bloomers ? `<span><i class="k-bloom"></i>${bloomers} in flower</span>` : ""}</div></header>
        ${bed([...H_, ...S_], t)}
      </section>

      <section class="card gd-card">
        <header class="gd-h"><div><h3>Habits</h3><p>Water today with the drop · click any day in the strip to log or un-log it</p></div><span class="gd-count">${tended}/${db.habits.length}</span></header>
        <form class="gd-add" id="gdAddHabit" autocomplete="off">
          <input class="in grow" name="name" placeholder="A habit to grow…" required aria-label="New habit" />
          <input class="in grow" name="desc" placeholder="Why it matters (optional)" aria-label="Why" />
          <div class="gd-seg" role="group" aria-label="Dopamine level">${Object.keys(DOPA).map((d) => `<button type="button" class="${ui.dopa === d ? "on" : ""}" style="--f:${DOPA[d]}" data-act="dopa" data-d="${d}" aria-pressed="${ui.dopa === d}">${d}</button>`).join("")}</div>
          <label class="gd-tog"><input type="checkbox" name="track" ${ui.track ? "checked" : ""}/> 66-day tracker</label>
          <button class="btn">Plant</button>
        </form>
        <div class="gd-rows">${H_.map((x) => habitRow(x.item, x.s, t)).join("") || `<div class="gd-empty">No habits yet — plant one above.</div>`}</div>
      </section>

      <section class="card gd-card">
        <header class="gd-h"><div><h3>Streaks</h3><p>Things you're keeping going, longest first</p></div>
        <form class="gd-add gd-add-r" id="gdAddStreak" autocomplete="off"><input class="in grow" name="name" placeholder="A new streak…" required aria-label="New streak" /><button class="btn">Start</button></form></header>
        <div class="gd-srows">${streaks.map((x) => streakRow(x.item, x.s, t)).join("") || `<div class="gd-empty">No streaks yet.</div>`}</div>
      </section>
      <section class="card gd-card">
        <header class="gd-h"><div><h3>The long view</h3><p>A year of tending, one square per day</p></div></header>
        <div class="gd-long">${yearGrid([...H_, ...S_], t)}</div>
      </section>

      <section class="card gd-card">
        <header class="gd-h"><div><h3>Interests</h3><p>Seed packets — what you're drawn to</p></div><span class="gd-count">${db.hobbies.length}</span></header>
        <div class="gd-packets">${db.hobbies.map(packet).join("")}
          <form class="gd-packet new" id="gdAddHobby" autocomplete="off"><span class="gd-k">new seed</span><input class="in" name="name" placeholder="An interest…" required aria-label="New interest" /><input class="in" name="tags" placeholder="tags, space separated" aria-label="Tags" /><button class="btn sm">Plant it</button></form>
        </div>
      </section>
      </div>`;

    wire(root, app, t);
    animateIn(root, app);
  },
};

function animateIn(root, app) {
  if (still()) { ui.bump = null; return; }
  if (app.entering) {
    animate(root.querySelectorAll(".gd-plant .sway"), { scaleY: [0, 1.08, 1], scaleX: [0.6, 1], delay: stagger(70, { start: 250 }), duration: 800, ease: "outQuart" });
    animate(root.querySelectorAll(".gd-packet"), { opacity: [0, 1], translateY: [14, 0], rotate: [() => (Math.random() - 0.5) * 8, 0], delay: stagger(30, { start: 300 }), duration: 520, ease: "outBack(1.8)" });
  }
  const b = ui.bump; ui.bump = null;
  if (!b) return;
  if (b.plant) {
    const g = root.querySelector(`.gd-plant[data-id="${b.id}"] .sway`);
    if (g) animate(g, b.on ? { scaleY: [0.82, 1.14, 0.96, 1], scaleX: [1.12, 0.92, 1.02, 1], duration: 620, ease: "outQuad" } : { rotate: [0, -4, 3, -1, 0], duration: 500, ease: "outQuad" });
  }
  if (b.day) { const c = root.querySelector(`${b.grid ? ".gd-year" : ".gd-strip"} [data-act="day"][data-id="${b.id}"][data-d="${b.day}"]`); if (c) animate(c, { scale: [0.5, 1.35, 1], duration: 420, ease: "outQuart" }); }
  if (b.water) { const w = root.querySelector(`.gd-water[data-id="${b.id}"]`); if (w) animate(w, { scale: [0.7, 1.25, 1], rotate: [0, -12, 0], duration: 460, ease: "outQuart" }); }
}

function wire(root, app, t) {
  const listOf = (k) => (k === "streaks" ? db.streaks : db.habits);
  const plantPos = (id) => { const el = root.querySelector(`.gd-plant[data-id="${id}"] .sway`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(40, r.height / 3) }; };
  const water = (k, id, origin) => {
    const x = listOf(k).find((y) => y.id === id);
    if (!x) return;
    const on = toggleDay(x, t);
    commit();
    ui.bump = { id, plant: true, water: true, on };
    if (on) { const p = origin || plantPos(id); if (p) pulse(p.x, p.y, "#c8ff6a", 46); }
    app.refresh();
  };

  root.onsubmit = (e) => {
    e.preventDefault();
    const form = e.target, f = new FormData(form), name = (f.get("name") || "").trim();
    if (!name) return;
    if (form.id === "gdAddHabit") { db.habits.push({ id: newId(), name, desc: (f.get("desc") || "").trim(), dopamineLevel: ui.dopa, activeDates: [], trackStreak: !!f.get("track") }); ui.track = !!f.get("track"); toast("Planted — log a day to make it sprout"); }
    else if (form.id === "gdAddStreak") { db.streaks.push({ id: newId(), name, activeDates: [] }); toast("Streak started"); }
    else if (form.id === "gdAddHobby") { db.hobbies.push({ id: newId(), name, desc: "", tags: parseTags(f.get("tags")), added: today() }); toast("Interest planted"); }
    else if (form.dataset.form === "habit") { const h = db.habits.find((y) => y.id === form.dataset.id); if (h) Object.assign(h, { name, desc: (f.get("desc") || "").trim(), dopamineLevel: f.get("dopa"), trackStreak: !!f.get("track") }); ui.edit = null; }
    else if (form.dataset.form === "streak") { const s = db.streaks.find((y) => y.id === form.dataset.id); if (s) s.name = name; ui.edit = null; }
    else if (form.dataset.form === "hobby") { const h = db.hobbies.find((y) => y.id === form.dataset.id); if (h) Object.assign(h, { name, tags: parseTags(f.get("tags")), desc: (f.get("desc") || "").trim() }); ui.edit = null; }
    else return;
    commit(); app.refresh();
    if (form.id) root.querySelector(`#${form.id} input`)?.focus();
  };

  root.onkeydown = (e) => {
    if (e.key === "Escape" && ui.edit) { ui.edit = null; app.refresh(); return; }
    const g = e.target.closest?.(".gd-plant");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); water(g.dataset.k, g.dataset.id); root.querySelector(`.gd-plant[data-id="${g.dataset.id}"]`)?.focus(); }
  };

  root.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const del = (key, label) => { const x = db[key].find((y) => y.id === id); if (!x || !confirm(`Delete ${label} “${x.name}”?`)) return false; db[key] = db[key].filter((y) => y !== x); return true; };
    switch (b.dataset.act) {
      case "water": return water(b.dataset.k, id, { x: e.clientX, y: e.clientY });
      case "log": { const r = b.getBoundingClientRect(); return water(b.dataset.k, id, { x: r.left + r.width / 2, y: r.top + r.height / 2 }); }
      case "day": {
        const x = listOf(b.dataset.k).find((y) => y.id === id), d = b.dataset.d;
        if (!x || !d || d > t) return;
        const on = toggleDay(x, d);
        commit();
        ui.bump = { id, day: d, plant: d === t, on, grid: !!b.closest(".gd-year") };
        return app.refresh();
      }
      case "subject": ui.subject = b.dataset.s; return app.refresh();
      case "dopa": ui.dopa = b.dataset.d; root.querySelectorAll("[data-act=dopa]").forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", c === b); }); return;
      case "edit": ui.edit = id; app.refresh(); return root.querySelector(`[data-form][data-id="${id}"] input`)?.focus();
      case "cancel": ui.edit = null; return app.refresh();
      case "del-habit": if (!del("habits", "habit")) return; break;
      case "del-streak": if (!del("streaks", "streak")) return; break;
      case "del-hobby": if (!del("hobbies", "interest")) return; break;
      default: return;
    }
    commit(); app.refresh();
  };
}
