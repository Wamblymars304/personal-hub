"""Import Spotify playlists (Exportify CSVs) into the hub's Music room.

    py -3 -I tools/import_music.py <folder or csv files...> [--hub path/to/hub.json] [--no-net]

Every CSV is one playlist (named after its file). Tracks are de-duplicated across playlists and sorted into
genre "rooms" (ROOMS below) by Spotify's artist genre tags, by playlist, or by artist. The result goes to
data/music.json next to hub.json — a separate file, so 3,000+ songs don't ride along on every hub save.
Then (unless --no-net) album art comes from Spotify's public oEmbed endpoint (no login needed), one track per
album, saved to data/music-covers/; lookups are cached in data/music-cache.json so a re-run only fetches new albums.
Re-runnable: export your playlists again and run it on the new folder.
"""
import csv, glob, io, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding="utf-8")
argv = sys.argv[1:]
HUB = argv[argv.index("--hub") + 1] if "--hub" in argv else os.path.join(os.path.dirname(__file__), "..", "data", "hub.json")
srcs = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--hub")]
NET = "--no-net" not in argv
DATA = os.path.dirname(os.path.abspath(HUB))
OUT, COVERS, CACHE = os.path.join(DATA, "music.json"), os.path.join(DATA, "music-covers"), os.path.join(DATA, "music-cache.json")
UA = {"User-Agent": "PersonalHub/1.0 (personal music library; local app)"}

# The rooms. A track joins a room when one of its artist's Spotify tags is in `tags`, it sits in one of `playlists`
# (a CSV file name, without .csv), or its first artist is in `artists`. Tags do most of the work; add playlists=[...]
# or artists=[...] to a room to pull in what the tags miss. Edit, add or remove rooms freely; ids are what the hub stores.
ROOMS = [
    dict(id="vaporwave", name="Vaporwave", era="2010–2013 · internet underground",
         blurb="Mall muzak, smooth jazz and '80s ads, slowed and looped until they sound like a memory of a future that never came. Born on Bandcamp and Tumblr, it still haunts every empty food court.",
         tags=["vaporwave", "plunderphonics"]),
    dict(id="citypop", name="Japanese city pop", era="1977–1989 · Tokyo's bubble years",
         blurb="Glossy, jazzy pop made for night drives through a booming Tokyo — funk bass, bright horns, the sea at the edge of the city. Rediscovered online in the 2010s, and the raw material of much of vaporwave.",
         tags=["city pop", "shibuya-kei", "kayōkyoku"]),
    dict(id="breakcore", name="Breakcore", era="late '90s rave · 2020s revival",
         blurb="Amen breaks chopped at impossible speed under something tender — a sample, a piano, a sad anime line. The 2020s wave turned the chaos inward: loud, lonely and very online.",
         tags=["breakcore", "speedcore", "gabber"]),
    dict(id="jungle", name="Jungle & PS1 jungle", era="1992–1997 UK · console-era revival",
         blurb="Rolling breakbeats and deep sub-bass from London pirate radio — and its echo in the PlayStation-era jungle of game menus and memory cards, all sparkle and low-poly melancholy.",
         tags=["jungle", "drum and bass", "liquid funk", "breakbeat"]),
    dict(id="shoegaze", name="Shoegaze & dream pop", era="1988–1993 UK · 2020s revival",
         blurb="Guitars washed into a wall of fog, voices buried like they're singing from the next room. Named for players staring at their effects pedals; reborn as the sound of falling asleep online.",
         tags=["shoegaze", "dream pop", "slowcore", "blackgaze"]),
    dict(id="darkwave", name="Darkwave & cold wave", era="early 1980s · post-Soviet revival",
         blurb="Cold drum machines, dry synths and a baritone voice in an empty hall. Post-punk's night side, carried into the 2010s by bands singing in Russian from concrete apartment blocks.",
         tags=["darkwave", "cold wave", "post-punk", "gothic rock", "witch house"]),
    dict(id="electronic", name="Electronic & indietronica", era="2000s–2010s",
         blurb="Indie songwriting run through synthesizers and laptops — big hazy hooks, glitchy textures, synthwave neon. The bright, wide-screen end of electronic music.",
         tags=["indietronica", "electroclash", "synthpop", "idm", "glitch", "electronica", "electronic", "new rave", "alternative dance", "big beat", "downtempo", "trip hop"]),
    dict(id="synthwave", name="Synthwave & chillwave", era="2008– · neon retro-futures",
         blurb="The 1980s as remembered by people who weren't there: gated drums, warm analog pads, chrome sunsets and empty highways — music for driving through a city that only exists at night.",
         tags=["synthwave", "chillwave", "outrun", "darksynth", "retrowave"]),   # art pop is too broad a tag (it pulls in Lady Gaga)
    dict(id="hyperpop", name="Hyperpop & dariacore", era="2019– · the internet",
         blurb="Pop pushed past its limits: pitched-up voices, bitcrushed drops, mashups that flip a chorus into a joke and back into a feeling. Dariacore is its most chaotic mashup corner.",
         tags=["hyperpop", "nightcore", "jersey club", "digicore"]),
    dict(id="metal", name="Alt-metal, post-hardcore & emo", era="1990s–2010s · the heavy years",
         blurb="Drop-tuned riffs, screamed choruses and a lot of feeling: nu metal and post-grunge radio, metalcore breakdowns, djent precision and the confessional ache of midwest emo.",
         tags=["post-grunge", "alternative metal", "metalcore", "nu metal", "post-hardcore", "rap metal", "midwest emo", "emo", "melodic hardcore", "djent", "screamo", "progressive metal", "metal", "deathcore", "doom metal", "grunge", "pop punk", "hardcore"]),
    dict(id="lofi", name="Lo-fi & sad beats", era="2013– · the study-stream era",
         blurb="Dusty jazz samples, vinyl crackle and a beat that never gets louder — the soundtrack of late-night homework, rainy windows and an anime girl studying forever.",
         tags=["lo-fi", "lo-fi beats", "lo-fi hip hop", "chillstep", "chillhop", "jazz rap"]),
    dict(id="oldies", name="'50s & golden oldies", era="1940s–1960s · the radio age",
         blurb="Doo-wop harmonies, rockabilly twang and big-band swing — songs that now sound like they're playing from another room of an empty hotel.",
         tags=["doo-wop", "rock and roll", "rockabilly", "swing music", "big band", "adult standards", "vocal jazz", "motown", "jazz"]),
    dict(id="frutiger", name="Frutiger Aero", era="2004–2013 · glossy optimism",
         blurb="Bubbles, aquariums, glass skyscrapers and green fields: the clean blue-sky future that tech ads promised, as music. Soft synths, bright pads, a future that felt like vacation.",
         playlists=[]   # no Spotify tag for this one: put your playlist's file name here
         ),
    dict(id="ambient", name="Ambient & ethereal", era="1978– · music as a place",
         blurb="Music to be inside of rather than listen to: early-morning drones, field recordings of rain and footsteps, slow piano in a big empty room.",
         tags=["ambient", "space music", "new age", "field recording"]),
    dict(id="outsider", name="Outsider & lo-fi house", era="2014– · DIY bedrooms",
         blurb="House music recorded through a cassette deck and a closed door — muffled kicks, dusty samples, a party you hear from the street at 3 a.m.",
         tags=["lo-fi house", "outsider house"]),
    dict(id="weirdcore", name="Weirdcore & dreamcore", era="2020s · the internet",
         blurb="Music for liminal spaces: warped lullabies, empty-pool reverb, backrooms hum. Comfort that is slightly wrong — the soundtrack to the Atmospheres tab."),
    dict(id="disturbing", name="Dark ambient & the disturbing", era="1980s– · the deep end",
         blurb="Drones, static and distant machinery. Not songs so much as places you'd rather not be alone in — and can't stop listening to.",
         tags=["dark ambient", "drone"]),
    dict(id="phonk", name="Phonk", era="'90s Memphis tapes · 2020s drift",
         blurb="Memphis rap tapes chopped into cowbell-heavy loops for drifting cars and gym edits — distorted, menacing, impossible to sit still to.",
         tags=["phonk", "drift phonk", "brazilian phonk", "cloud rap"]),
    dict(id="jrock", name="Anime songs & J-rock", era="2000s–2010s · openings and endings",
         blurb="Ninety-second openings that hit like a whole season: soaring J-rock, J-pop, Vocaloid and math-rock guitars. The songs that came with the shows.",
         tags=["j-rock", "j-pop", "vocaloid", "visual kei", "japanese indie", "j-r&b", "math rock"]),
    dict(id="animeost", name="Anime scores", era="2000s–2020s",
         blurb="The music under the scenes rather than over the credits — Ushio, Yokoyama and company writing piano, strings and strange textures for the quiet moments.",
         tags=["anime score"]),
    dict(id="score", name="Film & TV scores", era="2000s–2010s",
         blurb="Zimmer's swelling brass and Mac Quayle's paranoid synths: scores that made the story feel bigger, or made it feel like someone was watching.",
         tags=["soundtrack", "orchestral soundtrack"]),
    dict(id="game", name="Game music", era="2009– · Minecraft and beyond",
         blurb="Soft piano drifting over blocky sunsets, chiptune hearts — the music of worlds you lived in for hours at a time.",
         tags=["japanese vgm"]),
    dict(id="classical", name="Classical", era="1700s–1900s",
         blurb="The old masters — Bach, Chopin, Liszt, Satie and friends.",
         tags=["classical", "classical piano", "opera", "concerto", "baroque", "ballet", "impressionism", "chamber music", "early music", "neoclassical", "minimalism", "romanticism"]),
]

def num(v, cast=float):
    try: return cast(v)
    except (TypeError, ValueError): return None

files = []
for s in srcs or [os.path.join(os.path.dirname(__file__), "..", "music folders")]:
    files += sorted(glob.glob(os.path.join(s, "*.csv"))) + sorted(glob.glob(os.path.join(s, "*", "*.csv"))) if os.path.isdir(s) else [s]
seen_stems = set()   # the same playlist exported twice (e.g. in "already used" and again at the top): the first one listed wins
real_date = lambda d: d if d and d >= "2000" else ""   # Spotify-made playlists ("Your Top Songs") export 1970-01-01
SAME = [r"\s*[\(\[](feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]", r"\s+[-–—]\s+(feat\.?|ft\.?|featuring)\s.*$",
        r"\s*[\(\[][^\)\]]*\bre-?master(ed)?\b[^\)\]]*[\)\]]", r"\s+[-–—]\s+[^-–—]*\bre-?master(ed)?\b.*$",
        r"\s+[-–—]\s+(radio edit|single version|album version|mono|stereo|mono version|stereo version|explicit( version)?|clean( version)?)\s*$",
        r"\s*[\(\[](radio edit|single version|album version|mono|stereo|explicit|clean)[\)\]]"]
def song_key(r):   # remasters, "feat." credits and radio/mono/explicit cuts are the same song; live, remix and covers are not
    t = (r["Track Name"] or "").lower()
    for pat in SAME: t = re.sub(pat, "", t, flags=re.I)
    return (re.sub(r"\W+", "", t) or (r["Track Name"] or "").lower(), (r["Artist Name(s)"] or "").split(";")[0].strip().lower())
try: removed = set(json.load(open(HUB, encoding="utf-8")).get("musicRemoved", []))   # songs you removed in the hub stay out
except Exception: removed = set()
same_song = {}   # (title, first artist) -> track id: one song released under two ids is kept once
tracks, playlists = {}, []
for f in files:
    rows = list(csv.DictReader(open(f, encoding="utf-8-sig")))
    if not rows or "Track URI" not in rows[0]: continue        # not an Exportify playlist
    stem = os.path.splitext(os.path.basename(f))[0]
    if stem in seen_stems: continue
    seen_stems.add(stem)
    pi = len(playlists)
    added = sorted(real_date(r["Added At"][:10]) for r in rows if real_date((r.get("Added At") or "")[:10]))
    playlists.append({"file": stem, "name": re.sub(r"\s+", " ", re.sub(r"[_]+", " ", stem)).strip(), "count": len(rows),
                      "first": added[0] if added else "", "last": added[-1] if added else ""})
    for r in rows:
        uri = r["Track URI"]
        if not uri.startswith("spotify:track:"): continue
        sid = uri.split(":")[-1]
        if sid in removed: continue
        sid = tracks.get(sid) and sid or same_song.get(song_key(r), sid)
        if sid in removed: continue
        same_song.setdefault(song_key(r), sid)
        t = tracks.get(sid)
        if not t:
            t = tracks[sid] = {
                "id": sid, "t": r["Track Name"], "ar": [a.strip() for a in r["Artist Name(s)"].split(";") if a.strip()], "al": r["Album Name"],
                "y": (r.get("Release Date") or "")[:4], "pop": num(r.get("Popularity"), int), "ms": num(r.get("Duration (ms)"), int),
                "g": [g.strip() for g in (r.get("Genres") or "").split(",") if g.strip()],
                "added": real_date((r.get("Added At") or "")[:10]), "at": (r.get("Added At") or "") if real_date((r.get("Added At") or "")[:10]) else "", "pl": [],
                "f": {k: num(r.get(c)) for k, c in [("energy", "Energy"), ("valence", "Valence"), ("dance", "Danceability"),
                      ("acoustic", "Acousticness"), ("instr", "Instrumentalness"), ("tempo", "Tempo"), ("key", "Key"), ("mode", "Mode")]},
            }
            if all(v is None for v in t["f"].values()): del t["f"]
        if pi not in t["pl"]: t["pl"].append(pi)
        if not t["g"] and r.get("Genres"): t["g"] = [g.strip() for g in r["Genres"].split(",") if g.strip()]
        a = real_date((r.get("Added At") or "")[:10])
        if a and (not t["added"] or a < t["added"]): t["added"], t["at"] = a, r.get("Added At") or ""    # the first time it entered your library

for room in ROOMS:
    room.setdefault("tags", []); room.setdefault("playlists", []); room.setdefault("artists", [])
pl_index = {p["file"]: i for i, p in enumerate(playlists)}
for t in tracks.values():
    t["r"] = [room["id"] for room in ROOMS if set(t["g"]) & set(room["tags"])
              or any(pl_index.get(p) in t["pl"] for p in room["playlists"]) or (t["ar"][:1] and t["ar"][0] in room["artists"])]

# ---------- album art via Spotify oEmbed (public, no login) ----------
album_of = lambda t: f"{(t['ar'] or [''])[0]}|{t['al']}".lower()
covers = {}
if NET:
    from PIL import Image
    os.makedirs(COVERS, exist_ok=True)
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    def get(url, raw=False):
        for a in range(4):
            time.sleep(0.25)
            try:
                b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
                return b if raw else json.loads(b)
            except urllib.error.HTTPError as e:
                if e.code in (400, 404): return None
                time.sleep(4 * (a + 1))
            except Exception: time.sleep(3)
        return None
    def fetch(key, sid):
        if key in cache: return key, cache[key]
        meta = get("https://open.spotify.com/oembed?" + urllib.parse.urlencode({"url": f"https://open.spotify.com/track/{sid}"}))
        thumb = (meta or {}).get("thumbnail_url", "")
        name = ""
        if thumb:
            name = re.sub(r"[^A-Za-z0-9]", "", thumb.rsplit("/", 1)[-1])[-32:] + ".webp"
            path = os.path.join(COVERS, name)
            if not os.path.exists(path):
                data = get(thumb, raw=True)
                try:
                    im = Image.open(io.BytesIO(data)).convert("RGB"); im.thumbnail((300, 300)); im.save(path, "WEBP", quality=82)
                except Exception: name = ""
        return key, name if meta is not None else None     # None = try again next run
    first = {}
    for t in sorted(tracks.values(), key=lambda t: -len(t["r"])):   # tracks in rooms first, so the rooms fill in early
        first.setdefault(album_of(t), t["id"])
    todo = list(first.items())
    print(f"album art: {len(todo)} albums, {sum(1 for k, _ in todo if k in cache)} cached", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for fut in as_completed([pool.submit(fetch, k, sid) for k, sid in todo]):
            try: k, name = fut.result()
            except Exception as e: print("  failed:", e); continue
            if name is not None: cache[k] = name
            done += 1
            if done % 200 == 0:
                json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
                print(f"  {done}/{len(todo)} · with art {sum(1 for v in cache.values() if v)}", flush=True)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    covers = cache
elif os.path.exists(CACHE):
    covers = json.load(open(CACHE, encoding="utf-8"))
for t in tracks.values():
    c = covers.get(album_of(t))
    if c: t["c"] = c

for i, p in enumerate(playlists): p["count"] = sum(1 for t in tracks.values() if i in t["pl"])   # unique songs, no repeats
history = []
if os.path.exists(OUT):
    try: history = json.load(open(OUT, encoding="utf-8")).get("history", [])
    except Exception: pass
gcount = Counter(g for t in tracks.values() for g in set(t["g"])); acount = Counter(t["ar"][0] for t in tracks.values() if t["ar"])
snap = {"date": time.strftime("%Y-%m-%d"), "songs": len(tracks), "artists": len({a for t in tracks.values() for a in t["ar"]}), "playlists": len(playlists),
        "hours": round(sum(t["ms"] or 0 for t in tracks.values()) / 3.6e6), "genres": len(gcount),
        "topGenres": [g for g, _ in gcount.most_common(8)], "topArtists": [a for a, _ in acount.most_common(8)]}
history = [h for h in history if h.get("date") != snap["date"]] + [snap]
out = {"imported": time.strftime("%Y-%m-%d"), "history": history, "playlists": playlists,
       "rooms": [{k: v for k, v in r.items()} for r in ROOMS],
       "tracks": sorted(tracks.values(), key=lambda t: t["added"] or "9999")}
tmp = OUT + ".tmp"
json.dump(out, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":")); os.replace(tmp, OUT)
counts = Counter(r for t in tracks.values() for r in t["r"])
print(f"{len(tracks)} songs from {len(playlists)} playlists · {sum(1 for t in tracks.values() if t['r'])} in a room · with art {sum(1 for t in tracks.values() if t.get('c'))}")
print("  " + " · ".join(f"{r['name']} {counts[r['id']]}" for r in ROOMS))
