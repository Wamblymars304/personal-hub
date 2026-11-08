# Personal Hub: notes for Claude

A local, single-user dashboard for one person's life: what they watch and read, the music they keep, skills they're
learning, habits, focus time, money, notes, dreams, a diary and places they want to go. The goal is to **see your
identity over time**, so most tabs keep dates and show change, not just lists.

Everything runs on the owner's computer. One small Node server (no dependencies) serves a plain ES-module front end
and stores everything in **one JSON file**, `data/hub.json`. There is no build step, no framework, no database and
no account.

## Run it

```bash
npm start          # http://localhost:4400, data in data/hub.json (created empty on first run)
npm run demo       # http://localhost:4401, a made-up person's hub (examples/hub.demo.json, copied fresh each run)
```

Node 18+. Python 3.9+ only for the optional importers in `tools/`.

| Env var | Effect |
|---|---|
| `PORT` | Port (default 4400; demo 4401). |
| `HUB_DATA=path/to/hub.json` | Use that file instead of `data/hub.json`. Backups and media folders go next to it, and nudges are off. **Use this for every test.** |
| `HUB_SEED=path/to/hub.json` | On first run only (no `data/hub.json` yet), start from a copy of this file. |
| `ATMOSPHERES=path` | Read the Atmospheres tab from another folder. |
| `NUDGES=off` | No desktop notifications. They're Windows-only anyway (PowerShell toasts). |

## Folder map

```
server.js            the whole backend: static files, /api/data (read/write hub.json), media folders, backups
nudges.js            Windows toast reminders ("go outside", "write", Sunday review), settings in hub.json "nudges"
public/
  index.html         shell: sidebar, search palette, toast, tab root
  app.css            base styles, tokens (colors, fonts), layout
  living.css         per-tab "mood" styles: [data-mood="<tab id>"] …
  tabs/*.css         larger tabs keep their own stylesheet (linked in index.html)
  js/main.js         app shell: the GROUPS tab registry, sidebar, search (Ctrl K), wisdom strip, backups
  js/store.js        data layer: load, DEFAULTS, commit() (debounced save), date/money helpers
  js/ui.js           small view helpers: esc(), toast(), plural(), empty(), $/$$ …
  js/background.js   three.js particle sky; MOODS gives each tab its colors; motionEnabled()
  js/motion.js       anime.js helpers (reveal, countUp, rings, animateAny); all respect the Motion switch
  js/charts.js       small SVG charts (bar, line/area, donut) shared by Finance/Analytics
  js/timeline.js     every dated thing in the hub as one list (On this day, Weekly review)
  js/music-lib.js    loads data/music.json, genre rooms, room ↔ atmosphere links
  js/player.js       Spotify embed dock that keeps playing across tabs
  js/ambient.js      Web Audio soundscapes + recordings in public/ambience/ (credits.json)
  js/tabs/*.js       one module per tab (plus helper modules, see the catalog)
  vendor/            anime.js 4.5, Leaflet 1.9.4, three.js r160: vendored ES modules, no npm install needed
  ambience/          freely licensed field recordings (see THIRD_PARTY.md)
tools/               optional Python importers + tools/cdp-shot.mjs (headless screenshot/test harness)
scripts/demo.mjs     npm run demo
examples/            hub.demo.json, the demo data (fictional)
docs/DATA.md         every hub.json key and the shape of its items
images/              your art for the Gallery: images/<artist>/<files>   (git-ignored)
atmospheres/         your Atmospheres wall: atmospheres/<aesthetic>/<sub-mood>/<images, videos>   (git-ignored)
data/                hub.json, backups/, music.json, covers and media folders   (git-ignored, never commit)
```

## How it fits together

**Server** (`server.js`):
- `GET /api/data` returns hub.json with an `X-Rev` header (the file's modified time).
- `PUT /api/data` saves it, but only if the request's `X-Rev` still matches. Otherwise it returns **409** and the page
  reloads. A stale tab, a script or a hand edit can never be overwritten silently.
- Every save is atomic (temp file + rename) and keeps one dated backup per day in `data/backups/` (last 30).
- Other routes:
  - `/api/gallery`: the artist folders in `images/`.
  - `/api/atmospheres` and `POST /api/atmospheres/folder`: the folder tree; the POST adds a category.
  - `/api/music`: `music.json` next to hub.json.
  - `/api/nudge*`: notification status and test.
- Media prefixes serve folders, images only (plus video for `/atmo/` and `/dream-media/`), and refuse anything outside
  their folder:
  - `/gallery-img/` from `images/`, and `/atmo/` from `atmospheres/`.
  - `/note-media/`, `/place-media/`, `/book-covers/`, `/manga-covers/`, `/music-covers/` and `/dream-media/` from the
    folders of the same name next to hub.json.
- Everything else is a static file from `public/`, served with no-cache, so a code edit shows up on refresh.

**Data layer** (`public/js/store.js`):
- `load()` fetches hub.json into the shared, mutable `db` object and fills in any missing key from `DEFAULTS`.
- Tabs change `db` directly, then call `commit()`, which saves 350 ms after the last change.
- `onChange` listeners re-render.
- Helpers: `newId()` (10 random chars), `today()` and `iso()` (local `YYYY-MM-DD`), `parseDate`, `formatDuration`,
  `currentStreak`, `recurringOccurrences`, `logMediaConsumed`, `monthly`.

**Tabs:**
- `main.js` imports every tab module and lists it in `GROUPS` (sidebar sections).
- A tab module default-exports `{ id, label, color, count(), render(root, app, focus) }`:
  - `count()` is the sidebar badge (`null` hides it).
  - `render` fills `root` with an HTML string.
  - `app` is `{ go(id, focusId), refresh(), entering }`.
  - `focus` is an item id to scroll to and flash (search results use it).
- Conventions:
  - Event handling is delegated: elements carry `data-act="…"` and `data-id`, and one listener on `root` switches on
    `el.dataset.act`.
  - Rows carry `data-row="<id>"` so search can flash them.
  - **All user text goes through `esc()`** before it goes into HTML.
  - UI-only state (open panels, filters) lives in a module-level `ui` object, not in hub.json.

**Look:**
- Each tab id is also a mood. `background.js` `MOODS[id]` colors the sky, `living.css` `[data-mood="id"]` restyles the
  page (headings, kicker text via `.page-h::before`), and larger tabs have `public/tabs/<id>.css`.
- Fonts are Inter, Space Grotesk, JetBrains Mono and Instrument Serif, from Google Fonts.
- Animation goes through anime.js and must check `motionEnabled()`. Use `animateAny` from motion.js when the target is
  a `querySelectorAll` list that may be empty.

## Tab catalog

| Tab (id) | Files | hub.json keys it writes | Notes |
|---|---|---|---|
| Dashboard (`dashboard`) | dashboard.js | habits / streaks (tap a ring) | Reads everything: today's tasks, focus, habits, money, On this day. |
| Weekly review (`review`) | review.js, ../timeline.js | none | This week against the 12 before; the Sunday nudge opens it. |
| Gallery (`gallery`) | gallery.js | `gallery` {seen, favorites} | A 3D hall (three.js) of `images/<artist>/`. |
| Atmospheres (`atmospheres`) | atmospheres.js, ../ambient.js | `atmoLinks`, `atmoSounds` | Folder-based mood wall + fullscreen Drift with sound. |
| Music (`music`) | music.js, music-listen.js, music-maps.js, music-taste.js, ../music-lib.js, ../player.js | `musicAtmos`, `musicJourney`, `musicRemoved` | Library is `data/music.json` from `tools/import_music.py`. Without it the tab says how to import. |
| Blogs & Links (`blogs`) | blogs.js, blogs-bits.js | `blogs`, `blogsPicked`, `blogsBatches`, `papers`, `papersPicks`, `papersRead` | A daily draw of links + papers to read. |
| Media (`media`) | media.js, media-ops.js, media-posters.js, reading.js | `media`, `mediaQueue`, `mediaConsumed` | 8 categories; the randomizer (`roll`) draws one per category first. Books have shelf/year/map views. |
| Reading challenge (`challenge`) | challenge.js | `readingChallenge`, `readingPicks` | A timed reading plan + a ranked "for you" list. Usually written by Claude, see below. |
| Schedule (`schedule`) | schedule.js | `schedule`, `scheduleSettings` | Month/week/agenda; drag queued media onto a day. |
| Reminders (`reminders`) | reminders.js, reminders-secrets.js | `reminders`, `nudges` | Also where nudge settings are edited. Secret-looking strings are masked. |
| Projects (`projects`) | projects.js | `projects` | Board by status + side drawer. |
| Skills (`skills`) | skills.js | `skills`, `skillsMeta` | Practice log with target hours, plus formal courses (units, syllabus, bibliography). |
| Hobbies (`hobbies`) | hobbies.js | `hobbies`, `habits`, `streaks` | Habits as plants; a 66-day habit-forming tracker. |
| Pomodoro (`pomodoro`) | pomodoro.js | `pomodoroSessions`, `pomodoroCategories` | Timer survives reloads (localStorage). |
| Analytics (`analytics`) | analytics.js, analytics-charts.js | `productivityTargets` | Productivity score and trends. |
| Finance (`finance`) | finance.js | `assets`, `income`, `oneTimeExpenses`, `recurringExpenses`, `recurringIncome`, `purchases`, `budgets`, `debts`, `savingsGoal`, `incomeGoal` | Expenses draw down an asset; deleting refunds it. |
| Wisdom (`wisdom`) | wisdom.js | `wisdom` | Principles and quotes; also fills the sidebar "Daily inspiration". |
| Diary (`diary`) | diary.js | `diary` | Light Markdown. Importer: `tools/import_obsidian_diary.py`. |
| Dreams (`dreams`) | dreams.js | `dreams` | Journal + "dream atlas" (recurring people/places/themes from `LEXICON`). |
| Notes (`notes`) | notes.js | `notes` | Importer: `tools/import_samsung_notes.py`. |
| Places (`places`) | places.js | `places`, `placeIdeas`, `doIdeas` | Leaflet map; Wikipedia summaries and OpenStreetMap search. |
| Bucket list (`bucket`) | bucket.js | `bucket` | Items can link to a place or a skill. |

`docs/DATA.md` has the full shape of every key. The `diet*` keys are kept for compatibility, but no tab uses them.

## Adding a tab

1. Create `public/js/tabs/<id>.js` that default-exports `{ id, label, color, count, render }`. Copy the skeleton of a
   small tab such as `bucket.js` (header comment describing the data, a module-level `ui`, `render` writes HTML, one
   delegated click handler).
2. Import it in `public/js/main.js` and add it to a group in `GROUPS`.
3. Give it a mood: add an entry to `MOODS` in `background.js`, and a `[data-mood="<id>"]` block in `living.css`, or a
   new `public/tabs/<id>.css` linked from `index.html`.
4. Add its key to `DEFAULTS` in `store.js` if it should always exist, and document it in `docs/DATA.md`.
5. If its items should be searchable, add them to the search index in `main.js`. Dated items can also be added to
   `timeline.js`.
6. Test on a copy of the data (below).

## Changing data from outside the page

- **While the server runs**, go through the API, so the revision check protects the owner's edits:
  1. `GET /api/data` and read `X-Rev`.
  2. Change the JSON.
  3. `PUT /api/data` with the same `X-Rev` header.
  4. A 409 means the file changed meanwhile: fetch it again and redo the change.
- Keep every key you didn't touch, and give new items `id`s like the app does (10 alphanumerics).
- With the server stopped, edit `data/hub.json` directly. It must stay valid JSON (the server refuses anything else on
  save, but does not repair a broken file).
- Dates are local `YYYY-MM-DD` strings; times are `HH:MM`.

Personal content is meant to be generated this way. For example:
- a `readingChallenge` or ranked `readingPicks` from the owner's Media shelf and notes;
- `placeIdeas` / `doIdeas` from their notes;
- a formal course in `skills` (units, milestones with `unit`/`type`, grouped resources).

## Testing

Never test against the owner's real `data/hub.json`. Use one of these:

```bash
PORT=4432 HUB_DATA=/tmp/hub-test/hub.json node server.js     # fresh empty hub (or copy a real one there first)
npm run demo                                                 # the fictional demo data
```

The harness is `tools/cdp-shot.mjs`. It drives headless Edge/Chrome over the DevTools protocol, runs steps, saves
screenshots and prints every console error and warning:

```bash
node tools/cdp-shot.mjs http://127.0.0.1:4432/ /abs/out/dir steps.json      # BROWSER=/path/to/chrome if not Windows Edge
```

- Steps: `[{ "eval": "js" }, { "wait": ms }, { "shot": "name" }, { "click": [x, y] }, { "key": "ArrowRight" }]`.
- Start with an eval that waits for `.nav-item`.
- Switch tabs with `document.querySelector('[data-tab=media]').click()`.
- `VW`/`VH` set the viewport size; try 390×844 for phone layout.

Before calling a change done:
1. Visit every tab you touched on both empty and demo data.
2. Check the harness prints "no console errors".
3. Look at the screenshots.
4. Check that nothing overflows sideways.

## Importers (`tools/`)

All are re-runnable and never duplicate items. Pass the hub.json path; with the server running, prefer a copy or
stop the server first.

| Script | Input → keys |
|---|---|
| `import_storygraph.py <export.csv> [hub.json] [--no-net]` | StoryGraph CSV → `media` (Books), with Open Library covers/subjects into `book-covers/`. |
| `import_music.py <folder or CSVs> [--hub hub.json] [--no-net]` | Exportify playlist CSVs → `data/music.json` (genre rooms defined in `ROOMS` at the top: edit them), covers into `music-covers/`. |
| `import_samsung_notes.py [hub.json]` | Samsung Notes (Windows app) → `notes`, the "Dreams" folder → `dreams`. |
| `import_obsidian_diary.py <hub.json> <folder>` | Obsidian (Markdown) diary files → `diary`. |
| `import_places.py [hub.json]` | The `PLACES` list at the top of the script → `places`, with Wikipedia summaries and photos. Fill the list in first. |

The tools send an honest User-Agent and pause between requests. Keep it that way: don't add scraping, spoofed
browsers or ways around rate limits.

## Rules for working on this project

- **Never commit personal data.** `data/`, `images/`, `atmospheres/` and `music folders/` are git-ignored; keep them
  that way, and don't paste real hub.json content into code, comments or examples.
- **No dependencies and no build step.** Write plain ES modules and plain CSS. If a library is truly needed, vendor a
  pinned ES-module build into `public/vendor/` and note its license in THIRD_PARTY.md.
- **Escape user text** (`esc()`) everywhere it enters HTML.
- **The network is opt-in and visible.** The app only contacts:
  - Google Fonts;
  - map tiles (Esri / OpenStreetMap), Nominatim search and Wikipedia (Places);
  - Open Library (book covers and details);
  - the Spotify embed (Music player).
  Don't add analytics, trackers or third-party icon services.
- Match the existing style: the header comment of each module says what it does and the shape of its data; comments
  explain *why*. Comments that mention `*_tab.py` or "the Python app" refer to the PySide6 desktop app this was ported
  from. The hub.json format stayed compatible with it.
- Keep motion optional (`motionEnabled()`), layouts usable at phone width, and every number readable without hover.
