// Nudges — Windows notifications that pull you away from the screen: go outside, and write.
// The server checks once a minute. When a nudge is due (its own interval, only inside your hours) it
// asks Windows how long since your last mouse/keyboard input. If you've been idle a while you're not at
// the computer, so it doesn't nag; otherwise a toast pops up over whatever you're doing and stays until
// you dismiss it. Settings live in hub.json → "nudges" (edited in the Reminders tab).
// No dependencies: the toast and the idle check are one PowerShell call using built-in Windows APIs.
import { execFile } from "node:child_process";

export const KINDS = {
  outside: {
    defaults: { enabled: true, everyMinutes: 90 }, button: "I'll go now",
    messages: [
      ["Go touch grass", "You've been on the computer a while. Ten minutes outside, no phone needed."],
      ["Forest air", "In Qing Li's study, a forest walk raised the immune cells that fight viruses, and they stayed up for 30 days. Find some trees."],
      ["Look far away", "Your eyes have been focused at arm's length for a long time. Go out and look at something far off."],
      ["Move", "Stand up, stretch, walk around the block. The screen will still be here."],
      ["Daylight", "Get some daylight while it's out. It helps you sleep tonight."],
      ["One walk a month", "One forest walk a month may keep the effect going all year. When's the next one?"],
    ],
  },
  write: {
    defaults: { enabled: true, everyMinutes: 240 }, button: "I'll write now",
    messages: [
      ["Write something", "One opinionated, technical paragraph today. You don't need talent, just the habit."],
      ["Wide open", "Almost nobody writes seriously and consistently, so there's no competition. Write a page."],
      ["Again", "Write once, then again, then again, until it's just a normal part of your day."],
      ["What do you think?", "Pick something you have a strong opinion on and explain it to a smart friend. 20 minutes."],
      ["Think on paper", "Writing makes your thinking sharper. Open a blank page and start with one sentence."],
    ],
  },
  review: {   // once a week, Sunday evening; clicking opens the Weekly review page
    defaults: { enabled: true, at: "19:00" }, button: "Open my week", weekly: true, url: `http://localhost:${process.env.PORT || 4400}/#review`,
    messages: [["Your week in review", "See what you focused on, wrote, dreamt and spent this week, next to the weeks before."]],
  },
};
export const NUDGE_DEFAULTS = { from: "09:00", to: "22:00", ...Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { ...v.defaults, log: [] }])) };
const AWAY_MS = 8 * 60 * 1000;   // idle this long = you're not at the computer

const PS_APP = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
const xml = (s) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
const psq = (s) => s.replace(/'/g, "''");

/** Show a toast unless you've been idle for awayMs. Resolves "shown", "away" or "failed". */
function toast(title, body, button, awayMs = 0, url = "") {
  // with a url, clicking the toast (or its button) opens that page in the browser
  const open = url ? ` launch="${xml(url)}" activationType="protocol"` : "";
  const actions = url ? `<action content="${xml(button)}" arguments="${xml(url)}" activationType="protocol"/><action content="Later" arguments="dismiss" activationType="system"/>`
    : `<action content="${xml(button)}" arguments="dismiss" activationType="system"/>`;
  const toastXml = `<toast scenario="reminder"${open}><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text>
    <text placement="attribution">Personal Hub</text></binding></visual>
    <actions>${actions}</actions></toast>`;
  const script = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class HubIdle { [StructLayout(LayoutKind.Sequential)] struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
  public static uint Ms() { var l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return (uint)Environment.TickCount - l.dwTime; } }
'@
if (${awayMs} -gt 0 -and [HubIdle]::Ms() -ge ${awayMs}) { 'away'; exit }
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('${psq(toastXml)}')
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${PS_APP}').Show([Windows.UI.Notifications.ToastNotification]::new($x))
'shown'`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((done) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    { windowsHide: true, timeout: 30000 }, (err, out) => done(err ? "failed" : String(out).trim().split(/\s+/).pop() || "failed")));
}

const minutes = (hhmm) => { const [h, m] = String(hhmm || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
function inHours(s, d = new Date()) {
  const now = d.getHours() * 60 + d.getMinutes(), a = minutes(s.from), b = minutes(s.to);
  return a <= b ? now >= a && now < b : now >= a || now < b;   // also handles windows past midnight
}
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** readSettings() → the "nudges" object from hub.json (or undefined). */
export function startNudges(readSettings) {
  const settings = () => {
    const raw = readSettings() || {};
    return { ...NUDGE_DEFAULTS, ...raw, ...Object.fromEntries(Object.keys(KINDS).map((k) => [k, { ...NUDGE_DEFAULTS[k], ...(raw[k] || {}) }])) };
  };
  const clock = Object.fromEntries(Object.keys(KINDS).map((k) => [k, { lastAt: Date.now(), next: Math.floor(Math.random() * 6), result: "" }]));
  const every = (k, s) => Math.max(15, +s[k].everyMinutes || KINDS[k].defaults.everyMinutes) * 60000;
  const show = (k) => { const c = clock[k], m = KINDS[k].messages[c.next++ % KINDS[k].messages.length]; return [m[0], m[1], KINDS[k].button]; };
  // weekly nudges: due on Sunday once the clock passes their time, once per Sunday
  const nextSunday = (at) => { const d = new Date(), [h, m] = String(at || "19:00").split(":").map(Number); d.setHours(h || 0, m || 0, 0, 0); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); if (d < new Date() && clock.review.sent === localDay()) d.setDate(d.getDate() + 7); return d.getTime(); };
  const weeklyDue = (k, cfg) => { const now = new Date(); return now.getDay() === 0 && now.getHours() * 60 + now.getMinutes() >= minutes(cfg.at) && clock[k].sent !== localDay() && Date.now() >= (clock[k].retryAt || 0); };

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const s = settings();
    if (!inHours(s)) return;
    for (const k of Object.keys(KINDS)) {
      const c = clock[k], cfg = s[k];
      if (KINDS[k].weekly) {
        if (!cfg.enabled || !weeklyDue(k, cfg)) continue;
        busy = true;
        c.result = await toast(...show(k), AWAY_MS, KINDS[k].url);
        busy = false;
        if (c.result === "away") c.retryAt = Date.now() + 10 * 60000; else c.sent = localDay();   // away: ask again once you're back
        console.log(`nudge ${k} ${new Date().toLocaleTimeString()}: ${c.result}`);
        break;
      }
      if (!cfg.enabled || Date.now() - c.lastAt < every(k, s)) continue;
      if (k === "write" && (cfg.log || []).includes(localDay())) { c.lastAt = Date.now(); continue; }   // already wrote today
      busy = true;
      c.result = await toast(...show(k), AWAY_MS);
      busy = false;
      // away from the computer: a break already happened, so the outside clock restarts;
      // writing waits and asks again 10 minutes after you're back
      c.lastAt = c.result === "away" && k === "write" ? Date.now() - every(k, s) + 10 * 60000 : Date.now();
      console.log(`nudge ${k} ${new Date().toLocaleTimeString()}: ${c.result}`);
      break;   // at most one notification per minute
    }
  }, 60000);

  return {
    status: () => { const s = settings(); return { from: s.from, to: s.to, inHours: inHours(s),
      ...Object.fromEntries(Object.keys(KINDS).map((k) => [k, { ...s[k], nextAt: KINDS[k].weekly ? nextSunday(s[k].at) : clock[k].lastAt + every(k, s), lastResult: clock[k].result }])) }; },
    test: (k) => { const kind = KINDS[k] ? k : "outside"; return toast(...show(kind), 0, KINDS[kind].url || ""); },
    done: (k) => { if (clock[k]) clock[k].lastAt = Date.now(); },   // went outside / wrote: start that clock over
  };
}
