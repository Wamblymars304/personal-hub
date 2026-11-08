// Secret masking for reminder text. API keys / tokens render as a chip (••••••• + last 4) with
// click-to-reveal and copy. The raw value lives only in this module's vault until revealed —
// never in a title attribute, href or data attribute.
import { esc } from "../ui.js";

const PREFIXED = "sk-ant-[A-Za-z0-9_\\-]{8,}|sk-[A-Za-z0-9_\\-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AIza[0-9A-Za-z_\\-]{20,}|xox[bapr]-[A-Za-z0-9\\-]{8,}";
const GENERIC = "[A-Za-z0-9_\\-]{32,}";
const TOKENS = new RegExp(`(https?:\\/\\/[^\\s<>"']+)|(${PREFIXED})|(${GENERIC})`, "g");
const ANY = new RegExp(`${PREFIXED}|${GENERIC}`, "g");
const IS_PREFIXED = new RegExp(`^(?:${PREFIXED})$`);

// a long unbroken run only counts as a secret when it mixes letters and digits (not a long-slug-of-words)
const looksSecret = (s) => /[0-9]/.test(s) && /[A-Za-z]/.test(s);
const isSecret = (s) => IS_PREFIXED.test(s) || looksSecret(s);
const hasSecret = (s) => (String(s || "").match(ANY) || []).some(isSecret);

const vault = new Map();
let seq = 0;
export const resetVault = () => { vault.clear(); seq = 0; };
export const secretValue = (sid) => vault.get(sid);
export const mask = (s) => "•••••••" + s.slice(-4);

function chip(raw, kind) {
  const sid = "s" + ++seq;
  vault.set(sid, raw);
  return `<span class="rm-secret" data-sid="${sid}"><span class="rm-sec-k">${kind}</span><code class="rm-sec-v">${esc(mask(raw))}</code>`
    + `<button type="button" class="rm-sec-b" data-act="sec-show" data-sid="${sid}" aria-label="Reveal ${kind}">show</button>`
    + `<button type="button" class="rm-sec-b" data-act="sec-copy" data-sid="${sid}" aria-label="Copy ${kind}">copy</button></span>`;
}

/** Escaped HTML with links and masked secrets. */
export function richText(text) {
  const t = String(text || "");
  let out = "", last = 0;
  for (const m of t.matchAll(TOKENS)) {
    out += esc(t.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      let url = m[1], trail = "";
      const tm = url.match(/[.,;:!?)]+$/); if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
      out += (hasSecret(url) ? chip(url, "link with key") : `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\/(www\.)?/, ""))}</a>`) + esc(trail);
    } else if (m[2] || looksSecret(m[3])) out += chip(m[0], "key");
    else out += esc(m[0]);
  }
  return out + esc(t.slice(last));
}

/** Plain text with secrets masked — for confirm() dialogs and anything that can't hold a chip. */
export const maskPlain = (text) => String(text || "").replace(ANY, (s) => (isSecret(s) ? mask(s) : s));
