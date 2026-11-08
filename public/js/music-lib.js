// The music library (data/music.json, made by tools/import_music.py from Spotify playlist exports) and how
// its genre rooms link to Atmospheres. The library is its own file, not part of hub.json; only the links you
// edit ("musicAtmos": room → atmosphere categories) are saved in hub.json. Songs you remove ("musicRemoved": ids)
// are hidden here and skipped by every later import.
import { db, commit } from "./store.js";

export let lib = null;
let loading = null, full = null, applied = "";
function index(d) {
  d.byRoom = {};
  for (const t of d.tracks) for (const r of t.r) (d.byRoom[r] ||= []).push(t);
  d.roomById = Object.fromEntries(d.rooms.map((r) => [r.id, r]));
  return d;
}
export function loadMusic() {
  // "no-cache" = revalidate: the server answers 304 when the library hasn't changed, so repeat visits are instant
  return (loading ||= fetch("/api/music", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    full = d; applied = "";
    lib = d ? index({ ...d, tracks: d.tracks }) : null;
    syncRemovals();
    return lib;
  }));
}
/** Hide removed songs. A new library object each time, so per-library caches (the genre index) rebuild. */
export function syncRemovals() {
  if (!full || !db) return;
  const gone = db.musicRemoved || [], sig = `${gone.length}:${gone.at(-1) || ""}`;
  if (sig === applied) return;
  const set = new Set(gone);
  lib = index({ ...full, tracks: full.tracks.filter((t) => !set.has(t.id)) });
  applied = sig;
}
export function removeTrack(id) {
  const list = (db.musicRemoved ||= []);
  if (!list.includes(id)) list.push(id);
  commit(); syncRemovals();
}
export function restoreTrack(id) {
  db.musicRemoved = (db.musicRemoved || []).filter((x) => x !== id);
  commit(); syncRemovals();
}
export const removedTracks = () => { const set = new Set(db.musicRemoved || []); return (full?.tracks || []).filter((t) => set.has(t.id)); };

export const cover = (t) => (t?.c ? `/music-covers/${encodeURIComponent(t.c)}` : "");
export const by = (t) => t.ar.join(", ") || "Unknown artist";
export const month = (d) => (d ? new Date(d + "T00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");
export const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Starting links between genres and aesthetics; editing any of them in Music saves your own copy.
export const DEFAULT_ATMOS = {
  vaporwave: ["retrofuture", "liminal spaces"], citypop: ["retrofuture", "the night feeling"], breakcore: ["dreamcore", "the night feeling"],
  jungle: ["retrofuture"], shoegaze: ["the night feeling", "liminal spaces/outside"], darkwave: ["the night feeling", "otherworlds"],
  electronic: ["retrofuture"], hyperpop: ["dreamcore"], outsider: ["the night feeling", "liminal spaces"], weirdcore: ["dreamcore", "liminal spaces"],
  disturbing: ["otherworlds", "liminal spaces/rooms"], phonk: ["the night feeling"], animeost: ["the night feeling"], score: ["otherworlds"],
  game: ["liminal spaces/outside"],
  synthwave: ["retrofuture", "the night feeling"], metal: ["the night feeling"], lofi: ["the night feeling", "liminal spaces/rooms"],
  oldies: ["liminal spaces", "liminal spaces/rooms"], frutiger: ["retrofuture", "dreamcore"], ambient: ["liminal spaces/outside", "dreamcore"],
};
// your saved links win; rooms you have never edited (e.g. ones added by a later import) start from the defaults
export const atmoLinks = () => ({ ...DEFAULT_ATMOS, ...(db.musicAtmos || {}) });
export function toggleLink(room, path) {
  const m = (db.musicAtmos ||= structuredClone(DEFAULT_ATMOS)), list = m[room] || DEFAULT_ATMOS[room] || [];
  m[room] = list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
  commit();
}
// a room linked to "liminal spaces" also fits "liminal spaces/rooms", and viewing "liminal spaces" shows rooms linked to its children
const related = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
export const roomsFor = (path) => (lib && path ? lib.rooms.filter((r) => (atmoLinks()[r.id] || []).some((p) => related(p, path))) : []);
export function tracksFor(rooms) {
  const seen = new Set();
  return rooms.flatMap((r) => lib.byRoom[r.id] || []).filter((t) => !seen.has(t.id) && seen.add(t.id));
}
