// Ambient — the sound under Drift. Two kinds: soundscapes generated live with Web Audio (no files,
// never loop audibly), and real field recordings in public/ambience/ (free licenses, credits.json),
// looped by crossfading two copies so the seam can't be heard.
// play("rain") fades a sound in; stop() fades it out. Each builder returns { stop } for its timers.
let ctx = null, master = null, current = null;

export const AMBIENTS = {
  off: "Silence", rain: "Rain on glass", hum: "Fluorescent hum", night: "Night crickets",
  mall: "Empty mall", pool: "Pool rooms", wind: "Wind",
};
export const RECORDINGS = {};   // key → { label, file, title, author, license, source }
export const ready = fetch("ambience/credits.json").then((r) => r.json()).then((list) => {
  for (const r of list) { RECORDINGS[r.key] = r; AMBIENTS[r.key] = r.label; }
}).catch(() => {});

/** Pick a sound from a folder name: "3am", "night drives" → crickets, "malls" → empty mall … */
export function guess(name = "") {
  const n = name.toLowerCase(), rec = (k, fallback) => (RECORDINGS[k] ? k : fallback);
  if (/rain|storm|wet/.test(n)) return rec("rec-rain", "rain");
  if (/pool|water|bath/.test(n)) return rec("rec-pool", "pool");
  if (/night|3am|midnight|drive|suburb|gas station|konbini/.test(n)) return rec("rec-night", "night");
  if (/mall|store|shop|dream|weird|nostalg|arcade/.test(n)) return "mall";
  if (/office|hall|backroom|liminal|school|hospital|corridor|room/.test(n)) return "hum";
  return "wind";
}
export const credit = (kind) => { const r = RECORDINGS[kind]; return r ? `${r.title} — ${r.author} (${r.license})` : ""; };

export function play(kind, volume = 0.6) {
  stop();
  if (!kind || kind === "off" || !(BUILD[kind] || RECORDINGS[kind])) return;
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);
  master.connect(ctx.destination);
  current = { gain: master, parts: RECORDINGS[kind] ? recording(ctx, master, RECORDINGS[kind].file) : BUILD[kind](ctx, master) };
}

/** A field recording that loops forever: when one copy nears its end the other fades in over it. */
function recording(ac, out, file, overlap = 4) {
  const decks = [0, 1].map(() => {
    const el = new Audio(file); el.preload = "auto";
    const g = ac.createGain(); g.gain.value = 0;
    ac.createMediaElementSource(el).connect(g).connect(out);
    return { el, g };
  });
  let live = 0, stopped = false;
  const start = (d) => {
    if (stopped) return;
    d.el.currentTime = 0; d.el.play().catch(() => {});
    d.g.gain.cancelScheduledValues(ac.currentTime); d.g.gain.setValueAtTime(0, ac.currentTime); d.g.gain.linearRampToValueAtTime(1, ac.currentTime + overlap);
  };
  const tick = setInterval(() => {
    const d = decks[live], left = d.el.duration - d.el.currentTime;
    if (!stopped && d.el.duration && left < overlap + 0.3) {
      d.g.gain.setValueAtTime(d.g.gain.value, ac.currentTime); d.g.gain.linearRampToValueAtTime(0, ac.currentTime + overlap);
      setTimeout(() => d.el.pause(), (overlap + 0.5) * 1000);
      live = 1 - live; start(decks[live]);
    }
  }, 250);
  start(decks[0]);
  return { stop: () => { stopped = true; clearInterval(tick); decks.forEach((d) => d.el.pause()); } };
}
export function setVolume(v) { if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.3); }
export function stop() {
  if (!current) return;
  const { gain, parts } = current;
  current = null;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  setTimeout(() => { parts.stop?.(); gain.disconnect(); }, 3000);
}

/* ---------- building blocks ---------- */
function noise(ac, seconds = 4, kind = "white") {
  const buf = ac.createBuffer(2, ac.sampleRate * seconds, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      d[i] = kind === "brown" ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
    }
  }
  const src = ac.createBufferSource();
  src.buffer = buf; src.loop = true; src.start();
  return src;
}
function filter(ac, type, freq, q = 0.7) { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
function gain(ac, v) { const g = ac.createGain(); g.gain.value = v; return g; }
function chain(...nodes) { nodes.reduce((a, b) => (a.connect(b), b)); return nodes.at(-1); }
function reverb(ac, seconds = 4, decay = 3) {   // a synthetic hall: noise with an exponential tail
  const len = ac.sampleRate * seconds, buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  const c = ac.createConvolver(); c.buffer = buf; return c;
}
function lfo(ac, rate, depth, target) { const o = ac.createOscillator(), g = gain(ac, depth); o.frequency.value = rate; o.connect(g).connect(target); o.start(); return o; }
const every = (min, max, fn) => { let t; const go = () => { fn(); t = setTimeout(go, min + Math.random() * (max - min)); }; t = setTimeout(go, Math.random() * min); return () => clearTimeout(t); };

/* ---------- the soundscapes ---------- */
const BUILD = {
  rain(ac, out) {
    chain(noise(ac), filter(ac, "highpass", 500), filter(ac, "lowpass", 5200), gain(ac, 0.22), out);
    chain(noise(ac, 4, "brown"), filter(ac, "lowpass", 600), gain(ac, 0.25), out);
    const drops = every(40, 260, () => {   // individual drops tapping the glass
      const t = ac.currentTime, s = noise(ac, 0.05), g = gain(ac, 0), p = ac.createStereoPanner();
      p.pan.value = Math.random() * 2 - 1;
      chain(s, filter(ac, "bandpass", 2500 + Math.random() * 3500, 3), g, p, out);
      g.gain.setValueAtTime(0.08 * Math.random(), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.stop(t + 0.08);
    });
    return { stop: drops };
  },
  hum(ac, out) {
    const bus = gain(ac, 1); bus.connect(out);
    [[60, 0.09], [120, 0.06], [180, 0.025], [240, 0.012]].forEach(([f, v]) => { const o = ac.createOscillator(); o.frequency.value = f; chain(o, gain(ac, v), bus); o.start(); });
    const buzz = ac.createOscillator(); buzz.type = "sawtooth"; buzz.frequency.value = 120;
    chain(buzz, filter(ac, "bandpass", 3200, 6), gain(ac, 0.012), bus); buzz.start();
    chain(noise(ac, 4, "brown"), filter(ac, "lowpass", 250), gain(ac, 0.12), out);   // the building's air handling
    const flicker = every(4000, 14000, () => {   // the tube stutters now and then
      const t = ac.currentTime;
      for (let i = 0; i < 3 + Math.random() * 4; i++) { bus.gain.setValueAtTime(0.3, t + i * 0.07); bus.gain.setValueAtTime(1, t + i * 0.07 + 0.035); }
    });
    return { stop: flicker };
  },
  night(ac, out) {
    chain(noise(ac, 4, "brown"), filter(ac, "lowpass", 380), gain(ac, 0.14), out);   // far-off traffic and air
    const crickets = Array.from({ length: 4 }, (_, k) => {
      const pan = ac.createStereoPanner(); pan.pan.value = -0.8 + k * 0.55; pan.connect(out);
      const pitch = 4200 + Math.random() * 900, level = 0.025 + Math.random() * 0.02;
      return every(500 + k * 230, 1400 + k * 300, () => {
        const t = ac.currentTime, o = ac.createOscillator(), g = gain(ac, 0);
        o.frequency.value = pitch; chain(o, g, pan); o.start(t);
        for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(level, t + i * 0.055); g.gain.setValueAtTime(0, t + i * 0.055 + 0.03); }
        o.stop(t + 0.2);
      });
    });
    return { stop: () => crickets.forEach((c) => c()) };
  },
  mall(ac, out) {
    const hall = reverb(ac, 5, 2.5), wet = gain(ac, 0.5); hall.connect(wet).connect(out);
    chain(noise(ac, 4, "brown"), filter(ac, "lowpass", 220), gain(ac, 0.18), out);   // HVAC
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];   // a soft pentatonic, like music from another floor
    const notes = every(1800, 5200, () => {
      const t = ac.currentTime, o = ac.createOscillator(), g = gain(ac, 0);
      o.type = "triangle"; o.frequency.value = scale[Math.floor(Math.random() * scale.length)] / (Math.random() < 0.5 ? 2 : 1);
      chain(o, filter(ac, "lowpass", 1400), g, hall);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      o.start(t); o.stop(t + 2.6);
    });
    return { stop: notes };
  },
  pool(ac, out) {
    const room = reverb(ac, 4, 2), wet = gain(ac, 0.7); room.connect(wet).connect(out);
    chain(noise(ac, 4, "brown"), filter(ac, "lowpass", 300), gain(ac, 0.1), out);
    const ripple = filter(ac, "bandpass", 700, 0.8); chain(noise(ac), ripple, gain(ac, 0.015), room);
    lfo(ac, 0.07, 300, ripple.frequency);   // slow lapping water
    const drips = every(900, 3800, () => {
      const t = ac.currentTime, o = ac.createOscillator(), g = gain(ac, 0);
      o.frequency.setValueAtTime(1400 + Math.random() * 800, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.09);
      chain(o, g, room); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.start(t); o.stop(t + 0.15);
    });
    return { stop: drips };
  },
  wind(ac, out) {
    const band = filter(ac, "bandpass", 500, 0.9);
    chain(noise(ac, 6, "brown"), band, gain(ac, 0.5), out);
    lfo(ac, 0.05, 260, band.frequency);
    const gust = gain(ac, 0.6); chain(noise(ac), filter(ac, "highpass", 1800), filter(ac, "lowpass", 4000), gust, out);
    lfo(ac, 0.11, 0.55, gust.gain);
    return {};
  },
};
