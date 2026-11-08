// Media — the look of each thing on the list. Books and Manga have real covers; everything else gets a
// typographic poster drawn from its title: each category has its own poster language (TV = a glowing
// broadcast screen, Movie = a one-sheet with a sun and a billing block, Documentary = an archival print,
// Videogame = a cartridge, Podcast = rings on air, Article = a broadsheet), hued by category and nudged
// by a hash of the item's id so no two look alike and a rename keeps its colours.
import { esc, fmtDate } from "../ui.js";
import { formatDuration } from "../store.js";
import { statusOf } from "./media-ops.js";

// hue = oklch hue; w = rough glyph width (em) of the title face, used to size titles so words never split
export const CAT = {
  "TV Show": { key: "tv", hue: 40, spread: 50, color: "var(--orange)", plural: "TV shows", verb: "Watched", w: 0.66 },
  Movie: { key: "film", hue: 345, spread: 50, color: "var(--pink)", plural: "Movies", verb: "Watched", w: 0.44 },
  Documentary: { key: "doc", hue: 80, spread: 22, color: "var(--amber)", plural: "Documentaries", verb: "Watched", w: 0.6 },
  Manga: { key: "manga", hue: 25, color: "var(--red)", plural: "Manga", verb: "Read", w: 0.44 },
  Book: { key: "book", hue: 295, color: "var(--purple)", plural: "Books", verb: "Read", w: 0.44 },
  Podcast: { key: "pod", hue: 215, color: "var(--cyan)", plural: "Podcasts", verb: "Listened", w: 0.6 },
  Article: { key: "art", hue: 195, color: "var(--cyan)", plural: "Articles", verb: "Read", w: 0.46 },
  Videogame: { key: "game", hue: 158, color: "var(--green)", plural: "Videogames", verb: "Played", w: 0.66 },
};
export const catOf = (c) => CAT[c] || { key: "other", hue: 270, color: "var(--slate)", plural: c || "Other", verb: "Done", w: 0.6 };
export const COVERED = (m) => !!m.cover;

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Title size in container units (cqw of the poster's width) so the longest word always fits a line */
function titleSize(title, w) {
  const len = title.length, lw = Math.max(1, ...title.split(/\s+/).map((x) => x.length));
  const byLen = len <= 6 ? 21 : len <= 12 ? 16 : len <= 22 ? 12.5 : len <= 40 ? 10 : 8;
  return Math.max(6.5, Math.min(byLen, 80 / (lw * w))).toFixed(1);
}

const pad = (n) => String(n).padStart(2, "0");
/** The typographic poster (fills its .md-art box). */
export function poster(m) {
  const c = catOf(m.category), h = hash(m.id || m.title || "");
  const title = m.title || "Untitled";
  const hue = c.hue + Math.round(((h % 997) / 996 - 0.5) * 2 * (c.spread || 28)), v = (h >>> 5) % 4;
  const x = 18 + ((h >>> 9) % 64), y = 14 + ((h >>> 14) % 40);
  const run = m.timeEstimate ? formatDuration(m.timeEstimate) : "";
  const added = (m.added_date || "").slice(0, 10).split("-").reverse().join(".");
  const [top, foot] = {
    tv: [`<span>TV · series</span><span>ch ${pad(2 + (h % 70))}</span>`, `<i class="bars"></i>`],
    film: [`<span>a film</span>`, `<i class="bill"></i>`],
    doc: [`<span>documentary</span><span>${run ? esc(m.timeEstimate + " min") : ""}</span>`, `<span>archive · ${esc(added)}</span>`],
    game: [`<span>1P</span><span>${pad((h >>> 3) % 99)}</span>`, `<span>press start</span>`],
    pod: [`<span>ep. ${pad(1 + (h % 98))}</span><span>●  on air</span>`, `<span>${esc(run)}</span>`],
    art: [`<span>the article</span><span>n° ${(h % 900) + 100}</span>`, `<i class="cols"></i>`],
    book: [`<span></span>`, `<span>${esc(m.author || "")}</span>`],
    manga: [`<span>${esc(m.jp || "")}</span>`, `<span>${esc(m.author || "")}</span>`],
    other: [`<span>${esc(m.category || "")}</span>`, `<span>${esc(run)}</span>`],
  }[c.key];
  return `<span class="pst pst-${c.key} v${v}${title === title.toLowerCase() ? " lc" : ""}" style="--h:${hue};--x:${x}%;--y:${y}%;--fs:${titleSize(title, c.w)}" aria-hidden="true">
    <i class="pst-motif"></i><span class="pst-top">${top}</span><span class="pst-title">${esc(title)}</span><span class="pst-foot">${foot}</span></span>`;
}

/** Cover image or poster, plus the stamps and ribbons that sit on it */
export function art(m, { qpos = 0, lazy = true } = {}) {
  const s = statusOf(m), book = m.category === "Book", c = catOf(m.category);
  return (m.cover ? `<img src="${esc(m.cover)}" alt="" ${lazy ? 'loading="lazy"' : ""} decoding="async" />` : poster(m))
    + (m.dnf ? `<span class="mc-rib dnf">DNF</span>` : book && s === "currently-reading" ? `<span class="mc-rib now">reading</span>` : book && m.done ? `<span class="mc-rib read">read</span>` : "")
    + (m.done && !book ? `<span class="md-stamp">${c.verb}</span>` : "")
    + (qpos ? `<span class="md-qb">up next${qpos > 1 ? " · " + qpos : ""}</span>` : "");
}

const IC = {
  check: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  queue: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.2a1.4 1.4 0 0 0 0 5.6V12h12v-1.2a1.4 1.4 0 0 1 0-5.6V4H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4M6 8h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  queued: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.2a1.4 1.4 0 0 0 0 5.6V12h12v-1.2a1.4 1.4 0 0 1 0-5.6V4H2z" fill="currentColor"/></svg>`,
  x: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};
export const icon = (k) => IC[k];

/** One thing on the list: art (opens the card), hover tools, a caption. data-row lets search flash it. */
export function tile(m, qpos = 0, { row = true } = {}) {
  const c = catOf(m.category), book = m.category === "Book", covered = !!m.cover;
  const doneLbl = book ? (m.done && !m.dnf ? "Mark not read" : "Mark read") : m.done ? `Mark not ${c.verb.toLowerCase()}` : `Mark ${c.verb.toLowerCase()}`;
  const meta = m.done && m.completedAt && !m.dnf ? `${c.verb.toLowerCase()} ${fmtDate(m.completedAt)}` : [formatDuration(m.timeEstimate), m.added_date ? `added ${fmtDate(m.added_date)}` : ""].filter(Boolean).join(" · ");
  const cap = covered || book
    ? `<b${m.title === m.title.toLowerCase() ? ' class="lc"' : ""}>${esc(m.title)}</b><small>${m.rating ? `<i class="mc-stars">${esc(stars(m.rating))}</i> ` : ""}${esc(m.author || m.jp || "")}</small>`
    : `<small>${esc(meta)}</small>`;
  return `<div class="md-tile${m.done && !(book && !m.dnf) ? " done" : ""}${covered ? " cov" : " pos"}" ${row ? `data-row="${m.id}"` : ""} style="--c:${c.color}">
    <button class="md-art" data-act="card" data-id="${m.id}" aria-label="${esc(m.title)} — open">${art(m, { qpos })}</button>
    <span class="md-tools">
      <button class="md-t-done${m.done && !m.dnf ? " on" : ""}" data-act="done" data-id="${m.id}" title="${doneLbl}" aria-label="${doneLbl}">${IC.check}</button>
      <button class="md-t-q${qpos ? " on" : ""}" data-act="queue" data-id="${m.id}" title="${qpos ? "Take off Up next" : "Add to Up next"}" aria-label="${qpos ? "Take off Up next" : "Add to Up next"}">${qpos ? IC.queued : IC.queue}</button>
      <button class="md-t-del" data-act="del" data-id="${m.id}" title="Delete" aria-label="Delete ${esc(m.title)}">${IC.x}</button>
    </span>
    <span class="md-cap">${cap}</span></div>`;
}
export const stars = (r) => (r ? "★".repeat(Math.floor(r)) + (r % 1 ? "½" : "") : "");
