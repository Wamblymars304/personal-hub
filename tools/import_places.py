"""Add the places from your travel notes to the Places tab (hub.json "places").

    py -3 -I tools/import_places.py [path/to/hub.json]

Each place: where it is (located by hand from the note), which note it came from, and — when Wikipedia
has a page — a short summary and a photo, saved to <hub.json folder>/place-media/. Re-runnable: a place
already in the hub (same name) is left alone. Entries too vague to place go in with no location, so the
Places tab can list them under "needs a location".
"""
import json, os, re, secrets, string, sys, time, urllib.error, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
from datetime import date

HUB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "hub.json")
MEDIA = os.path.join(os.path.dirname(os.path.abspath(HUB)), "place-media")
UA = {"User-Agent": "PersonalHub/1.0 (personal, non-commercial; local app)"}
ALNUM = string.ascii_letters + string.digits
new_id = lambda: "".join(secrets.choice(ALNUM) for _ in range(10))

# Fill these in from your own notes (or ask Claude to). The categories are the CATS keys in public/js/tabs/places.js.
NOTE = "Places to visit"   # title of the note in the Notes tab these came from ("" for none); links each place back to it
PLACES = [
    # (name, area, country, lat, lon, category, wikipedia title or "", what your note said, note title)
    ("Fushimi Inari Taisha", "Kyoto", "Japan", 34.9671, 135.7727, "landmark", "Fushimi Inari-taisha", "walk the gates at dawn", NOTE),
    ("Lake Bled", "Bled", "Slovenia", 46.3635, 14.0938, "nature", "Lake Bled", "row out to the island", NOTE),
    ("Shakespeare and Company", "Paris", "France", 48.8526, 2.3471, "books", "Shakespeare and Company (bookstore)", "read upstairs", NOTE),
]
UNPLACED = [
    # (name, what your note said, note title): too vague to locate; pin them later by clicking the map
    ("A night train through snow", "sleep on a night train somewhere cold", NOTE),
]

def get(url, timeout=30):
    """Polite fetch: a pause between requests, and backing off when Wikipedia says slow down (429)."""
    for attempt in range(5):
        time.sleep(1.2)
        try: return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4: raise
            time.sleep(6 * (attempt + 1))

def wiki(title):
    """Wikipedia summary + a ~900px photo saved locally (None when there's no page)."""
    if not title: return None
    try:
        url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"), safe="")
        s = json.loads(get(url, 20))
    except Exception as e:
        print("  no wikipedia page for", title, "-", e); return None
    out = {"title": s.get("title", title), "extract": s.get("extract", ""), "url": s.get("content_urls", {}).get("desktop", {}).get("page", "")}
    thumb = (s.get("thumbnail") or {}).get("source") or (s.get("originalimage") or {}).get("source")
    if thumb:
        big = re.sub(r"/(\d+)px-", "/960px-", thumb)
        name = re.sub(r"[^A-Za-z0-9_-]", "_", out["title"])[:60] + os.path.splitext(urllib.parse.urlparse(thumb).path)[1].lower()
        try:
            os.makedirs(MEDIA, exist_ok=True)
            for src in (big, thumb):
                try:
                    data = get(src); break
                except Exception: data = None
            if data:
                open(os.path.join(MEDIA, name), "wb").write(data); out["image"] = "/place-media/" + name
        except Exception as e: print("  photo failed for", title, "-", e)
    return out

db = json.load(open(HUB, encoding="utf-8"))
db.setdefault("places", [])
notes = {n["title"]: n["id"] for n in db.get("notes", [])}
have = {p["name"].lower() for p in db["places"]}
added = 0
for name, area, country, lat, lon, cat, wtitle, said, note in PLACES:
    if name.lower() in have: continue
    w = wiki(wtitle)
    db["places"].append({"id": new_id(), "name": name, "area": area, "country": country, "lat": lat, "lon": lon, "cat": cat,
        "said": said, "noteId": notes.get(note, ""), "noteTitle": note, "wiki": w and {k: v for k, v in w.items() if k != "image"},
        "image": (w or {}).get("image", ""), "status": "want", "added": date.today().isoformat()})
    added += 1; print("placed", name, "· photo" if (w or {}).get("image") else "")
for name, said, note in UNPLACED:
    if name.lower() in have: continue
    db["places"].append({"id": new_id(), "name": name, "area": "", "country": "", "lat": None, "lon": None, "cat": "other", "said": said,
        "noteId": notes.get(note, ""), "noteTitle": note, "wiki": None, "image": "", "status": "want", "added": date.today().isoformat()})
    added += 1
out = HUB + ".tmp"
json.dump(db, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
os.replace(out, HUB)
print(f"added {added} places ({len(PLACES)} on the map, {len(UNPLACED)} need a location)")
