"""Import an Obsidian diary folder into the hub's Diary tab (hub.json "diary").

    py -3 -I tools/import_obsidian_diary.py <path/to/hub.json> <diary folder>

The date of each entry comes from the timestamp written at its top (202502252019, 2024/12/110058,
2024/12/20/11pm/15, 2025/10/02/2119 …); entries without one use the date in the file name, then the
file's modified date. A "status: #a #b" line becomes tags. Re-runnable: entries already imported
(matched by file name) are left alone, so edits made in the hub are kept; only new files are added.
The Obsidian files themselves are only read.
"""
import json, os, re, secrets, string, sys
from datetime import date, datetime

HUB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "data", "hub.json")
if len(sys.argv) < 3: sys.exit("usage: import_obsidian_diary.py <path/to/hub.json> <diary folder>")
SRC = sys.argv[2]
ALNUM = string.ascii_letters + string.digits
new_id = lambda: "".join(secrets.choice(ALNUM) for _ in range(10))

def stamp(line):
    """Parse the hand-typed timestamp at the top of an entry → (YYYY-MM-DD, HH:MM) or None."""
    s = line.strip()
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})", s)                       # 202502252019
    if not m: m = re.fullmatch(r"(\d{4})/(\d{1,2})/(\d{2})/?(\d{2})(\d{2})", s)        # 2024/12/110058, 2025/10/02/2119, 2026/04/042352
    if m:
        y, mo, d, h, mi = map(int, m.groups())
        return date(y, mo, d).isoformat(), f"{h:02d}:{mi:02d}"
    m = re.fullmatch(r"(\d{4})/(\d{1,2})/(\d{1,2})/(\d{1,2})\s*(am|pm)/(\d{2})", s, re.I)  # 2024/12/20/11pm/15
    if m:
        y, mo, d, h, ap, mi = m.groups(); h = int(h) % 12 + (12 if ap.lower() == "pm" else 0)
        return date(int(y), int(mo), int(d)).isoformat(), f"{h:02d}:{int(mi):02d}"
    return None

def parse(path):
    raw = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    lines = raw.split("\n")
    when, tags, keep = None, [], []
    for i, line in enumerate(lines):
        if when is None and i < 8 and stamp(line):
            when = stamp(line); continue
        if i < 10 and re.match(r"\s*status\s*:", line, re.I):
            tags = [t.lstrip("#") for t in re.findall(r"#[\w-]+", line)]; continue
        keep.append(line)
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(keep)).strip()
    name = os.path.splitext(os.path.basename(path))[0]
    if not when:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", name)
        d = date(*map(int, m.groups())) if m else datetime.fromtimestamp(os.path.getmtime(path)).date()
        when = (d.isoformat(), "")
    heading = next((l.lstrip("# ").strip() for l in text.split("\n") if l.startswith("#")), "")
    return {"date": when[0], "time": when[1], "title": heading, "text": text, "tags": tags, "file": os.path.basename(path)}

db = json.load(open(HUB, encoding="utf-8"))
db.setdefault("diary", [])
have = {x.get("file") for x in db["diary"]}
added = []
for f in sorted(os.listdir(SRC)):
    if not f.lower().endswith(".md") or f in have: continue
    e = parse(os.path.join(SRC, f))
    if not e["text"]: continue
    db["diary"].append({"id": new_id(), **e, "source": "obsidian", "added_date": date.today().isoformat()})
    added.append(e)
out = HUB + ".tmp"
json.dump(db, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
os.replace(out, HUB)
print(f"imported {len(added)} diary entries; {len(have & set(os.listdir(SRC)))} were already in the hub")
for e in sorted(added, key=lambda e: e["date"]): print(f"  {e['date']} {e['time'] or '--:--'}  {e['file']}  ({len(e['text'].split())} words, tags: {', '.join(e['tags']) or '-'})")
