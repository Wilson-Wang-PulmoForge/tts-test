import { getVoices, cleanText, extractFile, extractUrl, exportAudio } from "./api.js";
import { listDocs, getDoc, putDoc, updateMeta, deleteDoc } from "./db.js";
import { chunkText } from "./chunker.js";
import { Player } from "./player.js";
import { renderReader, chunkIndexFromEvent, highlight } from "./reader.js";

const $ = (s) => document.querySelector(s);
const player = new Player();
let doc = null, chunks = [], saveTimer = 0;
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

function toast(msg, ms = 4000) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.id); toast.id = setTimeout(() => (t.hidden = true), ms);
}
const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };

async function refreshLibrary() {
  const docs = await listDocs();
  const ul = $("#docs"); ul.textContent = "";
  for (const d of docs) {
    const li = document.createElement("li");
    if (doc?.id === d.id) li.setAttribute("aria-current", "true");
    const b = document.createElement("button");
    b.innerHTML = '<div class="t"></div><div class="m"></div>';
    b.firstChild.textContent = d.title;
    const pct = d.total ? Math.round((100 * (d.pos || 0)) / d.total) : 0;
    b.lastChild.textContent = `${Math.max(1, Math.round(d.chars / 900))} min · ${pct}% read`;
    b.onclick = () => openDoc(d.id);
    li.appendChild(b); ul.appendChild(li);
  }
}

async function openDoc(id) {
  player.pause();
  const d = await getDoc(id);
  if (!d) return;
  doc = d; chunks = chunkText(d.text);
  $("#empty").hidden = true; $("#reader").hidden = false;
  renderReader($("#reader"), chunks);
  const pos = Math.min(d.pos || 0, chunks.length - 1);
  player.load(chunks, pos);
  $("#seek").max = Math.max(0, chunks.length - 1);
  highlight(pos, { scroller: $("#scroller"), follow: true, instant: true });
  setControls(true); updateTime(); refreshLibrary();
  store.set("lectern.last", id);
}

function setControls(on) { for (const id of ["prev", "play", "next", "seek", "export", "delete"]) $("#" + id).disabled = !on; }

function updateTime(frac = 0) {
  if (!doc) { $("#time").textContent = "0:00"; return; }
  const remaining = (player.totalChars - player.charsBefore(player.index) - frac * (chunks[player.index]?.text.length || 0)) / (player.cps * player.rate);
  $("#time").textContent = "-" + fmt(remaining);
}

player.addEventListener("index", (e) => {
  const i = e.detail.index;
  highlight(i, { scroller: $("#scroller"), follow: true });
  $("#seek").value = i; updateTime();
  if (doc) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { updateMeta(doc.id, { pos: i }).then(refreshLibrary); }, 1500); }
});
player.addEventListener("state", (e) => {
  const { playing, buffering } = e.detail;
  $("#play").textContent = buffering ? "…" : playing ? "⏸" : "▶";
  $("#play").setAttribute("aria-label", playing ? "Pause" : "Play");
});
player.addEventListener("progress", (e) => updateTime(e.detail.frac));
player.addEventListener("error", (e) => toast(e.detail.message));

$("#play").onclick = () => { player.unlock(); player.toggle(); };
$("#next").onclick = () => player.next();
$("#prev").onclick = () => player.prev();
$("#seek").oninput = (e) => { player.unlock(); player.seek(Number(e.target.value)); };
$("#reader").onclick = (e) => { const i = chunkIndexFromEvent(e); if (i >= 0) { player.unlock(); player.seek(i); if (!player.playing) player.play(); } };
$("#rate").onchange = (e) => { player.setRate(Number(e.target.value)); store.set("lectern.rate", e.target.value); updateTime(); };
$("#voice").onchange = (e) => { player.setVoice(e.target.value); store.set("lectern.voice", e.target.value); };
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select,dialog")) return;
  if (e.code === "Space") { e.preventDefault(); player.unlock(); player.toggle(); }
  else if (e.code === "ArrowRight") player.next();
  else if (e.code === "ArrowLeft") player.prev();
});

$("#delete").onclick = async () => {
  if (!doc || !confirm(`Delete “${doc.title}”?`)) return;
  player.pause(); await deleteDoc(doc.id); doc = null; chunks = [];
  $("#reader").hidden = true; $("#empty").hidden = false; setControls(false); updateTime(); refreshLibrary();
};
$("#export").onclick = async () => {
  if (!doc) return;
  const btn = $("#export"); btn.disabled = true; btn.textContent = "Rendering…";
  try {
    const blob = await exportAudio(chunks.map((c) => c.text), $("#voice").value, doc.title);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = doc.title.replace(/[^\w -]/g, "") + ".wav"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) { toast(err.message); }
  btn.disabled = false; btn.textContent = "Save audio";
};

// --- add dialog ---
const dlg = $("#add");
$("#add-btn").onclick = () => { for (const id of ["a-title", "a-text", "a-file", "a-url"]) $("#" + id).value = ""; $("#a-err").hidden = true; dlg.showModal(); };
$("#a-cancel").onclick = () => dlg.close();
$("#a-ok").onclick = async () => {
  const ok = $("#a-ok"), err = $("#a-err");
  const file = $("#a-file").files[0], url = $("#a-url").value.trim(), pasted = $("#a-text").value.trim();
  if (!file && !url && !pasted) { err.textContent = "Paste some text, choose a file, or enter a link."; err.hidden = false; return; }
  ok.disabled = true; ok.textContent = "Adding…"; err.hidden = true;
  try {
    let title = $("#a-title").value.trim(), text;
    if (file) { const r = await extractFile(file); text = r.text; title ||= r.title; }
    else if (url) { const r = await extractUrl(url); text = r.text; title ||= r.title; }
    else { text = $("#a-clean").checked ? await cleanText(pasted) : pasted; title ||= text.slice(0, 40).replace(/\s+/g, " ") + "…"; }
    const n = chunkText(text).length;
    if (!n) throw new Error("There's no readable text in that.");
    const now = Date.now(), id = crypto.randomUUID();
    await putDoc({ id, title, createdAt: now, updatedAt: now, pos: 0, total: n, chars: text.length }, text);
    dlg.close(); await openDoc(id);
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  ok.disabled = false; ok.textContent = "Add";
};

// --- boot ---
(async function init() {
  setControls(false);
  $("#rate").value = store.get("lectern.rate", "1"); player.setRate(Number($("#rate").value));
  try {
    const v = await getVoices();
    const sel = $("#voice");
    for (const x of v.voices) sel.add(new Option(x.name, x.id));
    sel.value = [...sel.options].some((o) => o.value === store.get("lectern.voice", "")) ? store.get("lectern.voice") : v.default;
    player.setVoice(sel.value);
    if (v.engine === "mock") toast("Running with the mock voice. Install Kokoro for real speech (see README).", 8000);
  } catch (e) { toast(e.message); }
  await refreshLibrary();
  const last = store.get("lectern.last", ""); if (last) openDoc(last);
})();
