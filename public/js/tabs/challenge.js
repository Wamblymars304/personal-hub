// Books to read challenge — two months of reading, laid out like the Gallery: five main books, twenty short
// stories, ten more books for after. Data lives in hub.json "readingChallenge" (see docs/DATA.md; examples/hub.demo.json has one):
// { title, start, days, items[{ id, kind: book|story, group: month|next|story, title, author, year, premise, why?,
//   where?, link?, free?, cover?, pages?, mediaId?, olKey?, status: waiting|reading|done, page?, startedAt?, doneAt? }] }.
// A book that is also on your Media shelf (mediaId) moves there too: reading → currently reading, finished → read.
// "Ten for you" is the second tab: hub.json "readingPicks" { made, intro, finds[{ title, text }], items[{ id, rank, sure,
//   title, author, year, pages?, form?, premise, why, miss, where?, link?, cover?, mediaId?, status, page? }], near[{ title, author, why }] }.
import { db, commit, today, parseDate, iso } from "../store.js";
import { esc, plural, toast } from "../ui.js";
import { animate, stagger } from "../../vendor/anime.esm.min.js";
import { motionEnabled } from "../background.js";
import { setStatus } from "./media-ops.js";

const ui = { stories: "all", tab: "challenge" };
const SHELF = { waiting: "to-read", reading: "currently-reading", done: "read" };
const ch = () => db.readingChallenge;
const picks = () => db.readingPicks;
const day = (d) => parseDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const roman = ["I", "II", "III"];
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n) => WORDS[n] || String(n);
const forYou = (p) => { const w = word(p.items.length); return w.charAt(0).toUpperCase() + w.slice(1) + " for you"; };

function stats(c) {
  const start = parseDate(c.start), end = new Date(start); end.setDate(start.getDate() + c.days - 1);
  const n = Math.round((parseDate(today()) - start) / 864e5) + 1, dayN = Math.min(c.days, Math.max(1, n));
  const month = c.items.filter((i) => i.group === "month"), stories = c.items.filter((i) => i.kind === "story");
  const total = month.reduce((a, b) => a + (+b.pages || 0), 0);
  const read = month.reduce((a, b) => a + (b.status === "done" ? +b.pages || 0 : b.status === "reading" ? Math.min(+b.page || 0, +b.pages || 0) : 0), 0);
  const left = Math.max(1, c.days - dayN + 1);
  return { end: iso(end), dayN, left: c.days - dayN + 1, over: n > c.days, month, stories, total, read, perDay: Math.ceil(Math.max(0, total - read) / left),
    booksDone: month.filter((b) => b.status === "done").length, storiesDone: stories.filter((s) => s.status === "done").length };
}

export default {
  id: "challenge", label: "Reading challenge", color: "var(--amber)",
  count: () => { const c = ch(); return c ? c.items.filter((i) => i.status !== "done" && i.group !== "next").length || null : null; },
  render(root, app, focus) {
    const c = ch();
    if (!c) { root.innerHTML = `<div class="page-h"><h1>Books to read challenge</h1></div><div class="soon-page"><h2>No challenge yet</h2>Add a <code>readingChallenge</code> to hub.json (the shape is in docs/DATA.md), or ask Claude to plan one from your Media shelf.</div>`; return; }
    const p = picks(), all = [...c.items, ...(p?.items || [])];
    if (focus) {
      if (c.items.some((i) => i.id === focus)) ui.tab = "challenge"; else if (p?.items.some((i) => i.id === focus)) ui.tab = "picks";
      if (all.find((i) => i.id === focus)?.kind === "story") ui.stories = "all";
    }
    const views = p ? `<div class="mu-views ch-views" role="group" aria-label="Reading challenge views">${[["challenge", "The challenge"], ["picks", forYou(p)]].map(([k, l]) =>
      `<button class="${ui.tab === k ? "on" : ""}" data-act="view" data-v="${k}" aria-pressed="${ui.tab === k}">${l}</button>`).join("")}</div>` : "";
    const s = stats(c), next = c.items.filter((i) => i.group === "next");
    const stories = s.stories.filter((x) => ui.stories === "all" || (ui.stories === "read") === (x.status === "done"));
    const years = s.stories.map((x) => x.year);

    root.innerHTML = p && ui.tab === "picks" ? picksPage(p, views) : `<div class="page-h"><h1>${esc(c.title)}</h1><span class="sub">${day(c.start)} → ${day(s.end)} · ${s.over ? "the challenge is over" : `day ${s.dayN} of ${c.days}`}</span></div>
      ${views}<section class="ch-lede">
        <div class="ch-figs">
          <div><b>${s.booksDone}<em>/${s.month.length}</em></b><span>books finished</span></div>
          <div><b>${s.storiesDone}<em>/${s.stories.length}</em></b><span>short stories</span></div>
          <div><b>${s.read.toLocaleString()}<em>/${s.total.toLocaleString()}</em></b><span>pages read</span></div>
          <div><b>${s.booksDone === s.month.length ? "—" : s.perDay}</b><span>${s.booksDone === s.month.length ? "the five are done" : "pages a day to finish"}</span></div>
        </div>
        ${track(c, s)}
      </section>
      <h2 class="ch-h"><i>${roman[0]}.</i> The ${word(s.month.length)} <span>for these ${c.days} days · ${s.total.toLocaleString()} pages</span></h2>
      <div class="ch-five">${s.month.map((b, n) => book(b, n)).join("")}</div>
      <h2 class="ch-h"><i>${roman[1]}.</i> Twenty stories <span>${Math.min(...years)}–${Math.max(...years)} · any order, one sitting each</span>
        <span class="ch-filter">${[["all", "All"], ["unread", "Unread"], ["read", "Read"]].map(([k, l]) => `<button class="${ui.stories === k ? "on" : ""}" data-act="filter" data-f="${k}">${l}</button>`).join("")}</span></h2>
      <ol class="ch-stories">${stories.map((x) => story(x, s.stories.indexOf(x))).join("") || `<li class="ch-none">Nothing ${ui.stories === "read" ? "read" : "left"} yet.</li>`}</ol>
      <h2 class="ch-h"><i>${roman[2]}.</i> Ten more worlds <span>for afterwards</span></h2>
      <div class="ch-more">${next.map((b, n) => book(b, n, true)).join("")}</div>`;

    if (motionEnabled()) animate(root.querySelectorAll(".ch-book, .ch-story"), { opacity: [0, 1], translateY: [10, 0], delay: stagger(22), duration: 600, ease: "outQuart" });
    root.querySelectorAll("[data-page]").forEach((inp) => (inp.onchange = () => {
      const b = all.find((i) => i.id === inp.dataset.page);
      b.page = Math.max(0, Math.min(+inp.value || 0, +b.pages || 1e5));
      if (b.pages && b.page >= b.pages) return setBook(b, "done", app);
      commit(); app.refresh();
    }));
    root.onclick = (e) => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const it = all.find((i) => i.id === el.dataset.id);
      switch (el.dataset.act) {
        case "view": ui.tab = el.dataset.v; return app.refresh();
        case "filter": ui.stories = el.dataset.f; return app.refresh();
        case "st": return setBook(it, el.dataset.s, app);
        case "story": it.status = it.status === "done" ? "waiting" : "done"; it.doneAt = it.status === "done" ? today() : ""; if (it.status === "done") toast(`“${it.title}” — read`); commit(); return app.refresh();
        case "shelf": return app.go("media", it.mediaId);
      }
    };
  },
};

function setBook(b, st, app) {
  if (b.status === st) return;
  b.status = st;
  if (st === "reading") b.startedAt ||= today();
  b.doneAt = st === "done" ? today() : "";
  if (st === "done" && b.pages) b.page = b.pages;
  const m = b.mediaId && db.media.find((x) => x.id === b.mediaId);
  if (m) setStatus(m, SHELF[st]);   // keep the Media shelf (and its finished log) in step
  if (st === "done") toast(`Finished “${b.title}”${m ? " — marked read on your shelf too" : ""}`);
  commit(); app.refresh();
}

/** The challenge as a row of days: today marked, finished books and stories as dots on the day they were done. */
function track(c, s) {
  const done = c.items.filter((i) => i.doneAt && i.group !== "next");
  const start = parseDate(c.start);
  let cells = "";
  for (let n = 0; n < c.days; n++) {
    const d = new Date(start); d.setDate(start.getDate() + n);
    const ds = iso(d), here = done.filter((i) => i.doneAt === ds);
    const tip = here.length ? here.map((i) => i.title).join(", ") : day(ds);
    cells += `<i class="${n + 1 < s.dayN ? "past" : n + 1 === s.dayN && !s.over ? "now" : ""}" title="${esc(tip)}">${here.map((i) => `<b class="${i.kind}"></b>`).join("")}</i>`;
  }
  return `<div class="ch-track" aria-label="Day ${s.dayN} of ${c.days}">${cells}</div>
    <div class="ch-key"><span><b class="book"></b>book finished</span><span><b class="story"></b>story read</span><span><i class="now"></i>today</span></div>`;
}

function book(b, n, small) {
  const pct = b.pages ? Math.round(((b.status === "done" ? b.pages : +b.page || 0) / b.pages) * 100) : 0;
  return `<article class="ch-book${small ? " small" : ""} ${b.status}" data-row="${b.id}">
    <figure>${b.cover ? `<img src="${esc(b.cover)}" alt="${esc(b.title)} cover" loading="lazy" />` : `<span class="ch-blank">${esc(b.title)}</span>`}
      ${small ? "" : `<span class="ch-num">${String(n + 1).padStart(2, "0")}</span>`}${b.status === "done" ? `<span class="ch-stamp">Finished ${day(b.doneAt)}</span>` : ""}
      ${b.status === "reading" && b.pages ? `<span class="ch-bar"><span style="width:${pct}%"></span></span>` : ""}</figure>
    <div class="ch-label">
      <h3>${esc(b.title)}</h3>
      <p class="ch-meta">${esc(b.author)} · ${b.year}${b.pages ? ` · ${b.pages} pp` : ""}${b.mediaId ? ` · <button class="ch-link" data-act="shelf" data-id="${b.id}">on your shelf</button>` : ""}</p>
      <p class="ch-premise">${esc(b.premise)}</p>
      ${b.why && !small ? `<p class="ch-why">${esc(b.why)}</p>` : ""}
      <div class="ch-status" role="group" aria-label="Status of ${esc(b.title)}">${[["waiting", "Not started"], ["reading", "Reading"], ["done", "Finished"]].map(([k, l]) =>
        `<button class="${b.status === k ? "on" : ""}" data-act="st" data-s="${k}" data-id="${b.id}" aria-pressed="${b.status === k}">${l}</button>`).join("")}</div>
      ${b.status === "reading" ? `<label class="ch-page">page <input class="in" type="number" min="0" max="${b.pages || ""}" data-page="${b.id}" value="${+b.page || 0}" />${b.pages ? ` of ${b.pages} · ${pct}%` : ""}</label>` : ""}
    </div></article>`;
}

/** The second tab: ten ranked books, each with why it fits and where it could miss. */
function picksPage(p, views) {
  return `<div class="page-h ch-foryou"><h1>${forYou(p)}</h1><span class="sub">chosen ${day(p.made)} · ranked by how likely you are to love them</span></div>
    ${views}
    <p class="ch-intro">${esc(p.intro)}</p>
    <div class="ch-finds">${p.finds.map((f) => `<div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join("")}</div>
    <ol class="ch-picks">${p.items.map(pick).join("")}</ol>
    <h2 class="ch-h">Just missed <span>and why they aren't in the ten</span></h2>
    <ul class="ch-near">${p.near.map((n) => `<li><h3>${esc(n.title)}</h3><p class="ch-meta">${esc(n.author)}</p><p class="ch-premise">${esc(n.why)}</p></li>`).join("")}</ul>`;
}

function pick(b) {
  const pct = b.pages ? Math.round(((b.status === "done" ? b.pages : +b.page || 0) / b.pages) * 100) : 0;
  return `<li class="ch-book ch-pick ${b.status}" data-row="${b.id}">
    <span class="ch-rank">${b.rank}</span>
    <figure>${b.cover ? `<img src="${esc(b.cover)}" alt="${esc(b.title)} cover" loading="lazy" />` : `<span class="ch-blank">${esc(b.title)}</span>`}
      ${b.status === "done" && b.doneAt ? `<span class="ch-stamp">Finished ${day(b.doneAt)}</span>` : ""}
      ${b.status === "reading" && b.pages ? `<span class="ch-bar"><span style="width:${pct}%"></span></span>` : ""}</figure>
    <div class="ch-label">
      <span class="ch-sure">${esc(b.sure)}</span>
      <h3>${esc(b.title)}</h3>
      <p class="ch-meta">${esc(b.author)} · ${b.year}${b.pages ? ` · ${b.pages} pp` : ""}${b.form ? ` · ${esc(b.form)}` : ""}${b.mediaId ? ` · <button class="ch-link" data-act="shelf" data-id="${b.id}">on your shelf</button>` : ""}</p>
      <p class="ch-premise">${esc(b.premise)}</p>
      <div class="ch-cols"><div><h4>Why you</h4><p>${esc(b.why)}</p></div><div><h4>Where it could miss</h4><p>${esc(b.miss)}</p></div></div>
      ${b.where ? `<p class="ch-where">${esc(b.where)}${b.link ? ` <a href="${esc(b.link)}" target="_blank" rel="noopener">Borrow it ↗</a>` : ""}</p>` : ""}
      <div class="ch-status" role="group" aria-label="Status of ${esc(b.title)}">${[["waiting", "Not started"], ["reading", "Reading"], ["done", "Finished"]].map(([k, l]) =>
        `<button class="${b.status === k ? "on" : ""}" data-act="st" data-s="${k}" data-id="${b.id}" aria-pressed="${b.status === k}">${l}</button>`).join("")}</div>
      ${b.status === "reading" && b.pages ? `<label class="ch-page">page <input class="in" type="number" min="0" max="${b.pages}" data-page="${b.id}" value="${+b.page || 0}" /> of ${b.pages} · ${pct}%</label>` : ""}
    </div></li>`;
}

function story(x, n) {
  const done = x.status === "done";
  return `<li class="ch-story${done ? " done" : ""}" data-row="${x.id}">
    <span class="ch-n">${String(n + 1).padStart(2, "0")}</span>
    <div><h3>${esc(x.title)}</h3><p class="ch-meta">${esc(x.author)} · ${x.year} · ${esc(x.where)}</p><p class="ch-premise">${esc(x.premise)}</p></div>
    <div class="ch-acts"><a href="${esc(x.link)}" target="_blank" rel="noopener" title="${x.free ? "A free, legal copy" : "Where it was published and collected (ISFDB)"}">${x.free ? "read free" : "find it"} ↗</a>
      <button class="ch-check${done ? " on" : ""}" data-act="story" data-id="${x.id}" aria-pressed="${done}" title="${done ? `Read ${day(x.doneAt)} — click to undo` : "Mark as read"}">${done ? "✓" : ""}</button></div></li>`;
}
