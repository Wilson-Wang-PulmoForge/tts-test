// Draws the document and moves the highlight. No audio logic here.
let spans = [], current = -1;
export function renderReader(root, chunks) {
  root.textContent = ""; spans = new Array(chunks.length); current = -1;
  const frag = document.createDocumentFragment();
  let p = null, last = -1;
  for (const c of chunks) {
    if (c.para !== last) { p = document.createElement("p"); frag.appendChild(p); last = c.para; }
    else p.appendChild(document.createTextNode(" "));
    const s = document.createElement("span");
    s.className = "s"; s.dataset.i = c.i; s.textContent = c.text;
    p.appendChild(s); spans[c.i] = s;
  }
  root.appendChild(frag);
}
export function chunkIndexFromEvent(e) { const s = e.target.closest?.(".s"); return s ? Number(s.dataset.i) : -1; }
export function highlight(i, { scroller, follow, instant = false }) {
  if (current >= 0 && spans[current]) { spans[current].removeAttribute("aria-current"); spans[current].parentElement.classList.remove("live"); }
  current = i;
  const el = spans[i];
  if (!el) return;
  el.setAttribute("aria-current", "true"); el.parentElement.classList.add("live");
  if (!follow) return;
  const box = scroller.getBoundingClientRect(), r = el.getBoundingClientRect();
  const margin = Math.min(120, box.height * 0.2);
  if (instant || r.top < box.top + margin || r.bottom > box.bottom - margin) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: instant || reduce ? "auto" : "smooth" });
  }
}
