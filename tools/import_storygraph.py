"""Import a StoryGraph export into Media → Book, with covers and subjects from Open Library.

    py -3 -I tools/import_storygraph.py <export.csv> [path/to/hub.json] [--no-net]

Status → hub: read = finished (on its last read date, logged as consumed), to-read = waiting,
currently-reading = in "Up next", did-not-finish = done but marked DNF (not logged as consumed).
Everything StoryGraph knows is kept: authors, ISBN, format, dates, read count, stars, review, moods, pace,
character questions, content warnings, tags, owned.
Then (unless --no-net) each book is looked up on Open Library (search API: by ISBN, else title + author)
for its cover, subjects, page count and first-publish year; covers go to <hub.json folder>/book-covers/,
lookups are cached in <hub.json folder>/book-cache.json so a re-run only fetches what's new.
Re-runnable: books already in the hub (same ISBN, else same title) are updated, never duplicated, and your
own edits to fields StoryGraph doesn't have are left alone.
"""
import csv, html, io, json, os, re, secrets, string, sys, time, urllib.parse, urllib.request
from datetime import date

args = [a for a in sys.argv[1:] if not a.startswith("--")]
CSV, HUB = args[0], args[1] if len(args) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "hub.json")
NET = "--no-net" not in sys.argv
DATA = os.path.dirname(os.path.abspath(HUB))
COVERS, CACHE = os.path.join(DATA, "book-covers"), os.path.join(DATA, "book-cache.json")
UA = {"User-Agent": "PersonalHub/1.0 (personal reading log; local app)"}
ALNUM = string.ascii_letters + string.digits
sys.stdout.reconfigure(encoding="utf-8")

iso = lambda s: (lambda m: f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}" if m else "")(re.match(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", s or ""))
key = lambda t: re.sub(r"[^a-z0-9]", "", (t or "").lower())
split = lambda s: [x.strip() for x in (s or "").split(",") if x.strip()]
# StoryGraph reviews come as HTML: keep the words and paragraph breaks only
def plain(s):
    s = re.sub(r"(?i)<br\s*/?>|</(div|p)>", "\n", s or "")
    s = html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", s).strip()

rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
db = json.load(open(HUB, encoding="utf-8"))
books = [m for m in db["media"] if m.get("category") == "Book"]
by_isbn = {m["isbn"]: m for m in books if m.get("isbn")}
by_title = {key(m.get("title")): m for m in books}
logged = {c["id"] for c in db.get("mediaConsumed", [])}
added = updated = 0

for r in rows:
    title = (r["Title"] or "").strip()
    if not title: continue
    isbn = re.sub(r"[^0-9Xx]", "", r.get("ISBN/UID") or "")
    status = r.get("Read Status") or "to-read"
    last = iso(r.get("Last Date Read")) or (iso((r.get("Dates Read") or "").split("-")[-1]) if r.get("Dates Read") else "")
    fields = {
        "author": r.get("Authors", "").strip(), "contributors": r.get("Contributors", "").strip(), "isbn": isbn if len(isbn) in (10, 13) else "",
        "format": r.get("Format", ""), "status": status, "storygraphAdded": iso(r.get("Date Added")), "datesRead": r.get("Dates Read", ""),
        "readCount": int(r.get("Read Count") or 0), "rating": float(r["Star Rating"]) if r.get("Star Rating") else None,
        "review": plain(r.get("Review")), "moods": split(r.get("Moods")), "pace": r.get("Pace", ""),
        "plotOrCharacter": r.get("Character- or Plot-Driven?", ""), "contentWarnings": r.get("Content Warnings", ""),
        "tags": split(r.get("Tags")), "owned": (r.get("Owned?") or "").lower() == "yes", "source": "storygraph",
    }
    m = (fields["isbn"] and by_isbn.get(fields["isbn"])) or by_title.get(key(title))
    if not m:
        m = {"id": "".join(secrets.choice(ALNUM) for _ in range(10)), "title": title, "category": "Book",
             "added_date": fields["storygraphAdded"] or date.today().isoformat(), "timeEstimate": 0, "done": False, "completedAt": ""}
        db["media"].append(m); by_title[key(title)] = m; added += 1
    else: updated += 1
    m.update(fields)
    if status in ("read", "did-not-finish"):
        m["done"] = True; m["completedAt"] = last or m.get("completedAt") or fields["storygraphAdded"]
        m["dnf"] = status == "did-not-finish"
        if status == "read" and m["id"] not in logged:   # the hub's "consumed" log (feeds On this day, Weekly review)
            db.setdefault("mediaConsumed", []).append({"id": m["id"], "title": title, "category": "Book", "consumedAt": m["completedAt"]}); logged.add(m["id"])
    else:
        m["done"] = False; m["dnf"] = False
        if status == "currently-reading" and m["id"] not in db.setdefault("mediaQueue", []): db["mediaQueue"].append(m["id"])

def save_hub():
    out = HUB + ".tmp"
    json.dump(db, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False); os.replace(out, HUB)
save_hub()
print(f"{added} books added, {updated} updated ({len(rows)} in the export)")
if not NET: sys.exit()

# ---------- Open Library: cover, subjects, pages, year ----------
from PIL import Image
os.makedirs(COVERS, exist_ok=True)
cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
def get(url, raw=False):
    for a in range(4):
        time.sleep(0.35)
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
            return b if raw else json.loads(b)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(5 * (a + 1))
        except Exception: time.sleep(3)
    return None
FIELDS = "key,title,cover_i,subject,number_of_pages_median,first_publish_year"
todo = [m for m in db["media"] if m.get("category") == "Book" and m.get("source") == "storygraph"]

def lookup(m):
    """One book: Open Library search (by ISBN, else title + author) and its cover. Runs in a small thread pool."""
    ck = m.get("isbn") or key(m["title"] + m.get("author", ""))
    c = cache.get(ck)
    if c is None:
        doc = None
        if m.get("isbn"):
            r = get("https://openlibrary.org/search.json?" + urllib.parse.urlencode({"isbn": m["isbn"], "fields": FIELDS, "limit": 1}))
            doc = r["docs"][0] if r and r.get("docs") else None
        if not doc:
            q = {"title": m["title"], "fields": FIELDS, "limit": 1}
            if m.get("author"): q["author"] = m["author"].split(",")[0]
            r = get("https://openlibrary.org/search.json?" + urllib.parse.urlencode(q))
            doc = r["docs"][0] if r and r.get("docs") else None
        c = {"olKey": (doc or {}).get("key", ""), "coverId": (doc or {}).get("cover_i"), "subjects": ((doc or {}).get("subject") or [])[:25],
             "pages": (doc or {}).get("number_of_pages_median"), "year": (doc or {}).get("first_publish_year")}
    out = {"olKey": c["olKey"], "subjects": c["subjects"], "pages": c["pages"], "year": c["year"]}
    if c.get("coverId"):
        path = os.path.join(COVERS, f"{c['coverId']}.webp")
        if not os.path.exists(path):
            data = get(f"https://covers.openlibrary.org/b/id/{c['coverId']}-L.jpg", raw=True)
            if data:
                try:
                    im = Image.open(io.BytesIO(data)).convert("RGB"); im.thumbnail((420, 640)); im.save(path, "WEBP", quality=84)
                except Exception: pass
        if os.path.exists(path): out["cover"] = f"/book-covers/{c['coverId']}.webp"
    return m["id"], ck, c, out

def merge_save(results):
    """Write lookups into the CURRENT hub.json (so edits made in the hub meanwhile are kept), plus the cache."""
    global db
    cur = json.load(open(HUB, encoding="utf-8"))
    for x in cur["media"]:
        r = results.get(x["id"])
        if r: x.update({k: v for k, v in r.items() if v is not None and (k != "cover" or not x.get("cover"))})
    db = cur; save_hub()
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

from concurrent.futures import ThreadPoolExecutor, as_completed
results, done = {}, 0
with ThreadPoolExecutor(max_workers=4) as pool:
    for fut in as_completed([pool.submit(lookup, m) for m in todo]):
        try: mid, ck, c, out = fut.result()
        except Exception as e: print("  lookup failed:", e); continue
        cache[ck] = c; results[mid] = out; done += 1
        if done % 100 == 0 or done == len(todo):
            merge_save(results)
            print(f"  {done}/{len(todo)} looked up · covers: {sum(1 for r in results.values() if r.get('cover'))}", flush=True)
print("done: covers", sum(1 for r in results.values() if r.get("cover")), "of", len(todo), "· with subjects", sum(1 for r in results.values() if r.get("subjects")))
