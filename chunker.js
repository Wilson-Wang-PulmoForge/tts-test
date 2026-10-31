// Splits text into speakable chunks: [{ i, para, text }].
const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|No|Inc|Ltd|Co|e\.g|i\.e)|\b[A-Z])\.["')\]]*$/;

function splitLong(s, max) {
  const out = [];
  while (s.length > max) {
    let cut = Math.max(s.lastIndexOf(", ", max), s.lastIndexOf("; ", max), s.lastIndexOf(": ", max));
    if (cut < max * 0.4) cut = s.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(s.slice(0, cut + 1).trim());
    s = s.slice(cut + 1).trim();
  }
  if (s) out.push(s);
  return out;
}

export function chunkText(text, { maxChars = 300, minChars = 40 } = {}) {
  const chunks = [];
  let para = -1;
  for (const raw of text.split(/\n\s*\n/)) {
    const p = raw.replace(/\s+/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(p)) continue;
    para++;
    const sents = [];
    for (const s of p.split(/(?<=[.!?]["'”’)\]]*)\s+/)) {
      if (sents.length && ABBR.test(sents[sents.length - 1])) sents[sents.length - 1] += " " + s;
      else sents.push(s);
    }
    const merged = [];
    let buf = "";
    for (const s of sents) {
      buf = buf ? buf + " " + s : s;
      if (buf.length >= minChars) { merged.push(buf); buf = ""; }
    }
    if (buf) merged.length ? (merged[merged.length - 1] += " " + buf) : merged.push(buf);
    for (const m of merged) for (const piece of splitLong(m, maxChars)) {
      if (/[\p{L}\p{N}]/u.test(piece)) chunks.push({ i: chunks.length, para, text: piece });
    }
  }
  return chunks;
}
