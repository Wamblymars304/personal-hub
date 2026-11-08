"""Import Samsung Notes (the Windows app) into the hub.

    py -3 -I tools/import_samsung_notes.py [path/to/hub.json]      (default: data/hub.json)

The "Dreams" folder goes to the Dreams tab (hub.json "dreams"); every other note goes to the Notes
tab (hub.json "notes"), keeping its Samsung folder. Re-runnable: a note already imported (matched by
its Samsung id) is left alone, so edits made in the hub are never overwritten; only new notes are
added. Works on a copy of Samsung Notes' database, never the original. Preview pictures of drawing /
image notes are copied to <hub.json folder>/note-media/ and served by the hub at /note-media/.
"""
import json, os, re, secrets, shutil, sqlite3, string, sys, tempfile
from datetime import date, datetime

PKG = os.path.join(os.environ["LOCALAPPDATA"], "Packages", "SAMSUNGELECTRONICSCoLtd.SamsungNotes_wyx1vj98g3asy", "LocalState")
HUB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "hub.json")
MEDIA = os.path.join(os.path.dirname(os.path.abspath(HUB)), "note-media")
ALNUM = string.ascii_letters + string.digits
new_id = lambda: "".join(secrets.choice(ALNUM) for _ in range(10))

def day(ts):
    if not ts: return ""
    return datetime.fromtimestamp(ts / 1000 if ts > 1e11 else ts).date().isoformat()

def clean(s):
    s = (s or "").replace("​", "").replace("￼", "").replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+\n", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()

def title_of(row_title, recommended, text):
    # a title you typed wins; otherwise the note's first line beats Samsung's "Text note 09/15"
    if clean(row_title): return clean(row_title)[:120]
    first = next((l.strip() for l in text.split("\n") if l.strip()), "")
    if first: return first[:60] + ("…" if len(first) > 60 else "")
    return clean(recommended)[:120] or "Untitled"

# read a copy, so Samsung Notes can keep running and its database is never touched
tmp = tempfile.mkdtemp(prefix="snotes-")
for f in os.listdir(PKG):
    if f.startswith("Storage.sqlite"): shutil.copy2(os.path.join(PKG, f), tmp)
con = sqlite3.connect(os.path.join(tmp, "Storage.sqlite"))
folders = {u: clean(n) for u, n in con.execute("select UUID, DisplayName from CategoryTreeDB where not IsDeleted")}
rows = con.execute("""select n.UUID, n.Title, n.RecommendedTitle, n.CategoryUUID, n.CreatedAt, n.LastModifiedAt, n.ThumbnailPath,
                             t.StrippedContent, coalesce(e.hasImage, 0), coalesce(e.hasStroke, 0)
                      from NoteDB n left join TextSearchDB t on t.UUID = n.UUID left join document_extra e on e.UUID = n.UUID
                      where n.DeletedStatus = 0 order by n.CreatedAt""").fetchall()
con.close()
shutil.rmtree(tmp, ignore_errors=True)

db = json.load(open(HUB, encoding="utf-8"))
db.setdefault("notes", []); db.setdefault("dreams", [])
have = {x.get("sid") for x in db["notes"] + db["dreams"] if x.get("sid")}
added = {"notes": 0, "dreams": 0}; pictures = 0
for uuid, t, rec, cat, created, modified, thumb, text, has_img, has_stroke in rows:
    if uuid in have: continue
    text = clean(text)
    folder = folders.get(cat, "")
    if folder in ("", "Folders"): folder = "Unsorted"
    image = ""
    if thumb and (has_img or has_stroke or not text) and os.path.exists(thumb):
        os.makedirs(MEDIA, exist_ok=True)
        name = re.sub(r"[^A-Za-z0-9_-]", "", uuid)[:40] + os.path.splitext(thumb)[1].lower()
        shutil.copy2(thumb, os.path.join(MEDIA, name)); image = "/note-media/" + name; pictures += 1
    base = {"id": new_id(), "title": title_of(t, rec, text), "text": text, "image": image, "source": "samsung", "sid": uuid}
    if folder.lower() == "dreams":
        db["dreams"].append({**base, "date": day(created), "added_date": date.today().isoformat(), "tags": []})
        added["dreams"] += 1
    else:
        db["notes"].append({**base, "folder": folder, "created": day(created), "modified": day(modified), "pinned": False})
        added["notes"] += 1

out = HUB + ".tmp"
json.dump(db, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
os.replace(out, HUB)
print(f"imported {added['notes']} notes and {added['dreams']} dreams ({pictures} preview pictures); {len(rows) - sum(added.values())} were already in the hub")
