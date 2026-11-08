# hub.json reference

Everything the hub knows lives in one JSON object, `data/hub.json`. Missing keys are filled from `DEFAULTS` in
`public/js/store.js` when the page loads, so an empty `{}` is a valid hub. Unknown keys are kept as they are.
`examples/hub.demo.json` has a filled-in example of nearly every key.

Conventions:
- `id`: 10 random letters/digits (`newId()`). References between items use these ids.
- Dates are local `"YYYY-MM-DD"` strings; times are `"HH:MM"`; an empty string means "none".
- Durations are minutes; money is a plain number in your own currency.
- `?` marks an optional field.

Some data is **not** in hub.json and lives in files next to it:
- `music.json` is the music library made by `tools/import_music.py`.
- `backups/` holds one copy per day, the last 30.
- `book-covers/`, `manga-covers/`, `music-covers/`, `note-media/`, `place-media/` and `dream-media/` hold images and
  video.

## Content

### media: the Media shelf
`media: [{ id, title, category, added_date, done, completedAt, timeEstimate, author?, year?, status?, rating?, review?, cover?, pages?, subjects?, moods?, … }]`
- `category`: `"TV Show" | "Movie" | "Documentary" | "Manga" | "Book" | "Podcast" | "Article" | "Videogame"`.
- `timeEstimate` is in minutes, and `completedAt` is the date it was finished, or `""`.
- Books also have `status`: `"to-read" | "currently-reading" | "read" | "did-not-finish"` (plus `dnf: true` for the
  last). The StoryGraph importer adds:
  - `isbn`, `format`, `datesRead`, `readCount`, `review`, `moods[]`, `pace`, `tags[]`, `owned`;
  - from Open Library, `olKey`, `subjects[]`, `pages` and `year`.
- `cover` is a path such as `/book-covers/<file>`.

`mediaQueue: [mediaId]` is "Up next", in order. The randomizer replaces it.

`mediaConsumed: [{ id, title, category, consumedAt }]` is the log of finished things (the id is the media id).

### readingChallenge: a timed reading plan
`{ title, start, days, items: [{ id, kind, group, order, title, author, year, premise, why?, pages?, mediaId?, status, page?, startedAt?, doneAt?, cover?, olKey?, where?, link?, free? }] }`
- `kind`: `"book" | "story"`.
- `group`: `"month"` (the main books), `"story"`, or `"next"` (for after).
- `status`: `"waiting" | "reading" | "done"`, and `page` is the current page.
- `mediaId` links the item to a Media book, so starting or finishing it here moves that book on the shelf too.

### readingPicks: a ranked "for you" list
`{ made, intro, finds: [{ title, text }], items: [{ id, rank, sure, title, author, year, pages?, form?, premise, why, miss, where?, link?, cover?, mediaId?, status, page? }], near: [{ title, author, why }] }`
- `sure` is free text such as "very likely".
- `why` is why it fits, and `miss` is where it could miss.
- `finds` are observations about your taste, shown above the list.

### blogs, papers: Blogs & Links
- `blogs: [{ id, label, url, tags: [], energyLevel, added, reviewAt, reviewInterval }]`, where `energyLevel` is
  `"any" | "deep-focus" | "background" | "palate-cleanser"`.
- `blogsPicked: [blogId]` is today's drawn pool, and `blogsBatches?: [{ date, ids, opened }]` is the history of draws.
- `papers: [{ id, text, added }]`.
- `papersPicks: [paperId]` is what you're currently reading.
- `papersRead: [{ id, text, readAt }]`.

### gallery
`{ seen: { "<image url>": count }, favorites: ["<image url>"] }`. The art itself is the files in `images/<artist>/`.

### atmoLinks, atmoSounds: Atmospheres
- `atmoLinks: { "<category path>": ["artist/file", …] }` puts Gallery works into an Atmospheres category without
  copying them.
- `atmoSounds: { "<category path>": "<ambient key>" }` is the soundscape for a category.
- The categories are the folders in `atmospheres/`, for example `"liminal spaces/rooms"`.

### musicAtmos, musicJourney, musicRemoved: Music
- `musicAtmos: { "<room id>": ["<atmosphere category>", …] }` holds the genre room ↔ Atmospheres links you edited.
  Defaults are in `music-lib.js`.
- `musicJourney: { started, perDay, days: { "<date>": [trackId] }, rated: { "<trackId>": { s, c, f: [], n, d, u? } }, skipped: { "<trackId>": date } }`
  - `days` is the daily listening batches.
  - In each rating, `s` is a 0–10 score, `c` means chills, `f` is feeling words, `n` is a note and `d` is the date.
  - `skipped` holds the "don't rank" background pieces.
- `musicRemoved: [trackId]` lists songs taken out of the library, which later imports skip too.

## Plan

### schedule
- `schedule: [{ id, date, title, timeEstimate, startTime, done, mediaId? }]`. `mediaId` makes the task "watch/read
  this"; finishing the task finishes the media.
- `scheduleSettings: { greenMax, yellowMax }` are the daily workload thresholds in minutes.

### reminders
`reminders: [{ id, title, description, priority: "High" | "Medium" | "Low", completed, createdDate }]`

### nudges: Windows notifications (edited in Reminders)
`{ from: "09:00", to: "22:00", outside: { enabled, everyMinutes, log }, write: { enabled, everyMinutes, log }, review: { enabled, at } }`

### projects
`projects: [{ id, name, description, status, category, priority, targetDate, createdDate, progressPct, milestones: [{ id, title, targetDate, completed }], assetLinks: [], iterationNotes: [], versionHistory: [], collaborators: [] }]`
- `status`: `"Planning" | "In Progress" | "On Hold" | "Completed" | "Cancelled"`.
- `category`: `"Creative" | "Technical" | "Personal" | "Research" | "Business" | "Other"`.
- `priority`: `"High" | "Medium" | "Low"`.

## Habits & focus

### skills
Each skill:

```
skills: [{ id, name, why, cat, targetHours, start, end, status, created, doneAt?, noteId?, from?,
           resources: [{ id, label, url, group? }],
           milestones: [{ id, text, done, doneAt?, unit?, type?, url? }],
           sessions: [{ id, date, min, note, scroll? }],
           track?, level?, units?: [{ id, title, goal, hours }] }]
```

- `status`: `"active" | "paused" | "done"`.
- `end` is optional (open-ended).
- `noteId` links the note the skill came from.
- A **course** adds:
  - `track`: `"study" | "language" | "practice"`, plus `level` and `units`;
  - on each milestone, `unit` (a unit id) and `type`: `"read" | "listen" | "watch" | "write"`;
  - on each resource, `group` (a bibliography heading). A resource without a `url` is a book to find.
- `sessions[].scroll` is true for an "instead of scrolling" session.

`skillsMeta: { scrollsReplaced: [{ date, skillId, min }] }`

### hobbies, habits, streaks
- `hobbies: [{ id, name, desc, tags: [], added }]` are interests.
- `habits: [{ id, name, desc, dopamineLevel: "Low" | "Medium" | "High", activeDates: [date], trackStreak }]`.
- `streaks: [{ id, name, activeDates: [date] }]`.

### pomodoro
- `pomodoroSessions: [{ id, category, duration, date, completed }]`
- `pomodoroCategories: ["Study", "Music", "Code", "Art", "Writing"]`

### productivityTargets: Analytics
`{ pomoTarget, habitTarget, streakTarget, pomoDaily? }`

## Life

### Finance
- `assets: [{ id, name, assetType: "Bank Account" | "Cash" | …, amount, notes }]`.
- `income: [{ id, name, amount, date, notes, incomeType }]`, where `incomeType` is the asset type it was paid into.
- `oneTimeExpenses: [{ id, name, amount, date, notes, category, assetId, deducted }]`. `deducted` is how much was taken
  from that asset; deleting the expense refunds it.
- `recurringExpenses: [{ id, name, price, frequency: "weekly" | "monthly" | "yearly", dueDate, notes }]`.
- `recurringIncome: [{ id, name, amount, frequency, … }]`.
- `purchases: [{ id, name, price, category, targetMonth: "YYYY-MM", purchased, purchasedDate, notes, priority }]` is
  the wishlist.
- `budgets: [{ category, monthlyLimit }]`.
- `debts: [{ id, name, amount, dueDate, notes, paid, paidDate }]`.
- `savingsGoal: { target }` and `incomeGoal: { monthly }`.

`dietSettings`, `dietLog`, `dietFoods`, `dietWater` and `dietWeights` are kept for compatibility. No tab uses them.

## Mind

### wisdom
`wisdom: [{ id, title, content, type, category, tags: [], source, sourceType, dateAdded, importanceScore, whySaved, isCore, relatedIds: [], viewCount, lastSeenDate }]`
- `type`: `"Inspiration" | "Operating Principle" | "Anti-Principle"`.
- `category`: `"Philosophy" | "Psychology" | "Productivity" | "Finance" | "Economics" | "Physics" | "Health" | "Relationships" | "Other"`.
- `importanceScore` runs from 1 to 5.

### diary
`diary: [{ id, date, time, title, text, tags: [], file, source, added_date }]`. `text` is light Markdown, and `file` is
the source file name when imported.

### dreams
`dreams: [{ id, title, text, date, added_date, tags: [], image, images?: [], video?, source, sid }]`. The media files
live in `dream-media/` next to hub.json.

### notes
`notes: [{ id, title, text, folder, created, modified, image, pinned, source, sid }]`. `sid` is the source app's id;
importers use it to skip notes they already added.

### places
`places: [{ id, name, area, country, lat, lon, cat, said, noteId, noteTitle, wiki: { title, extract, url, thumb? } | null, image, status: "want" | "been", mine?, added }]`
- `cat` is a key of `CATS` in `places.js`: `liminal`, `city`, `food`, `books`, `landmark`, `nature`, `pilgrimage`,
  `science` or `other`.
- `lat` and `lon` are `null` for a place that still needs a location.
- `said` is what your note said about it.

`placeIdeas: [{ id, name, cat, why, lat, lon, wiki, dismissed, added, kept? }]` and
`doIdeas: [{ id, text, why, dismissed, added, kept? }]` are suggestions. Keeping one adds it to places or the bucket
list.

### bucket
`bucket: [{ id, text, kind, status, doneAt?, note?, placeId?, skill?, noteId?, noteTitle?, added }]`
- `kind`: `"become" | "learn" | "go" | "meet" | "make" | "do"`.
- `status`: `"dream" | "planned" | "done"`.
- `placeId` links a place; `skill` is a skill id.

## Kept in the browser, not in hub.json

These are `localStorage` keys, so they're per browser:
- `hub.tab`: the last tab.
- `hub.motion`: the Motion switch.
- `hub.hidePrinciple`: the hidden wisdom strip.
- `hub.player.mode`: the music player mode.
- `hub.pomodoro`: the running pomodoro timer.
- `hub.skillTimer`: the running skill timer.
- Atmospheres display preferences.
