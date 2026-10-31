// Plays a document one chunk at a time. Chunks are fetched as small WAVs, prefetched
// ahead, and two <audio> elements alternate for near-gapless playback.
// Speed = playbackRate (pitch preserved). Events: "index", "state", "progress", "error", "finished".
import { tts } from "./api.js";
const AHEAD = 4, MAX_INFLIGHT = 2;

function silentWavUrl() {
  const sr = 8000, n = 400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export class Player extends EventTarget {
  #chunks = []; #cum = [0]; #index = 0; #voice = ""; #rate = 1;
  #els = [new Audio(), new Audio()]; #active = 0;
  #activeIndex = -1; #standbyIndex = -1;
  #cache = new Map(); #inflight = 0; #run = 0;
  #playing = false; #buffering = false; #cps = 15; #unlocked = false;

  constructor() {
    super();
    for (const el of this.#els) {
      el.preload = "auto"; el.preservesPitch = true;
      el.addEventListener("ended", () => this.#onEnded(el));
      el.addEventListener("timeupdate", () => { if (el === this.#el && el.duration) this.#emit("progress", { frac: el.currentTime / el.duration }); });
      el.addEventListener("loadedmetadata", () => {
        const c = this.#chunks[Number(el.dataset.idx)];
        if (c && el.duration > 0.3) this.#cps = 0.7 * this.#cps + 0.3 * (c.text.length / el.duration);
      });
      el.addEventListener("error", () => { if (el.getAttribute("src")) this.#fail(new Error("That audio couldn't be played.")); });
    }
  }
  get #el() { return this.#els[this.#active]; }
  get #standby() { return this.#els[this.#active ^ 1]; }
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #emitState() { this.#emit("state", { playing: this.#playing, buffering: this.#buffering }); }

  get index() { return this.#index; }
  get length() { return this.#chunks.length; }
  get playing() { return this.#playing; }
  get rate() { return this.#rate; }
  get totalChars() { return this.#cum[this.#cum.length - 1]; }
  get cps() { return this.#cps; }
  charsBefore(i) { return this.#cum[Math.max(0, Math.min(i, this.#chunks.length))]; }

  unlock() {
    if (this.#unlocked) return; this.#unlocked = true;
    const url = silentWavUrl();
    for (const el of this.#els) {
      if (el.getAttribute("src")) continue;
      el.src = url;
      el.play().then(() => { el.pause(); el.removeAttribute("src"); }).catch(() => el.removeAttribute("src"));
    }
  }
  load(chunks, index = 0) {
    this.#run++; this.#halt(); this.#clearCache();
    this.#chunks = chunks; this.#cum = [0];
    for (const c of chunks) this.#cum.push(this.#cum[this.#cum.length - 1] + c.text.length);
    this.#index = Math.max(0, Math.min(index, chunks.length - 1));
    this.#playing = false; this.#buffering = false;
    this.#emit("index", { index: this.#index }); this.#emitState();
  }
  setVoice(voice) {
    if (voice === this.#voice) return;
    this.#voice = voice; this.#run++; this.#clearCache(); this.#halt();
    if (this.#playing) this.#startAt(this.#index);
  }
  setRate(rate) { this.#rate = rate; for (const el of this.#els) { el.playbackRate = rate; el.preservesPitch = true; } }
  async play() {
    if (!this.#chunks.length) return;
    this.#playing = true; this.#emitState();
    const el = this.#el;
    if (this.#activeIndex === this.#index && el.getAttribute("src") && el.paused && !el.ended) {
      try { await el.play(); } catch (err) { this.#blocked(err); }
      return;
    }
    await this.#startAt(this.#index);
  }
  pause() { this.#playing = false; this.#el.pause(); this.#emitState(); }
  toggle() { return this.#playing ? this.pause() : this.play(); }
  seek(i) {
    if (!this.#chunks.length) return;
    i = Math.max(0, Math.min(i, this.#chunks.length - 1));
    if (this.#playing) return this.#startAt(i);
    this.#run++; this.#halt(); this.#index = i; this.#emit("index", { index: i });
  }
  next() { return this.seek(this.#index + 1); }
  prev() {
    if (this.#playing && this.#activeIndex === this.#index && this.#el.currentTime > 2) return this.seek(this.#index);
    return this.seek(this.#index - 1);
  }

  #halt() { for (const el of this.#els) el.pause(); this.#activeIndex = -1; this.#standbyIndex = -1; }
  #fail(err) { this.#playing = false; this.#buffering = false; this.#halt(); this.#emitState(); this.#emit("error", { message: err.message }); }
  #blocked(err) {
    this.#playing = false; this.#buffering = false; this.#emitState();
    if (err?.name !== "NotAllowedError") this.#emit("error", { message: "Playback couldn't start." });
  }
  async #startAt(i) {
    const run = ++this.#run;
    this.#halt(); this.#index = i; this.#buffering = true;
    this.#emit("index", { index: i }); this.#emitState();
    let url;
    try { url = await this.#request(i); }
    catch (err) { if (run !== this.#run || err.name === "AbortError") return; return this.#fail(err); }
    if (run !== this.#run) return;
    const el = this.#el;
    el.dataset.idx = i; el.src = url; el.playbackRate = this.#rate;
    try { await el.play(); } catch (err) { if (run === this.#run) this.#blocked(err); return; }
    if (run !== this.#run) return;
    this.#activeIndex = i; this.#buffering = false; this.#emitState();
    this.#pump(); this.#preloadStandby(run);
  }
  async #preloadStandby(run) {
    const next = this.#index + 1;
    if (next >= this.#chunks.length) return;
    try {
      const url = await this.#request(next);
      if (run !== this.#run) return;
      const sb = this.#standby;
      sb.dataset.idx = next; sb.src = url; sb.playbackRate = this.#rate; sb.load();
      this.#standbyIndex = next;
    } catch {}
  }
  #onEnded(el) {
    if (el !== this.#el || !this.#playing) return;
    const next = this.#index + 1;
    if (next >= this.#chunks.length) {
      this.#playing = false; this.#emitState(); this.#emit("progress", { frac: 1 }); this.#emit("finished"); return;
    }
    if (this.#standbyIndex === next) {
      const run = ++this.#run;
      this.#active ^= 1; this.#index = next; this.#activeIndex = next; this.#standbyIndex = -1;
      this.#el.play().catch((err) => this.#blocked(err));
      this.#emit("index", { index: next }); this.#pump(); this.#preloadStandby(run);
    } else this.#startAt(next);
  }
  #request(i) {
    const key = `${this.#voice}|${i}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { i, url: null, controller, promise: null };
      this.#inflight++;
      entry.promise = tts(this.#chunks[i].text, this.#voice, controller.signal)
        .then((blob) => (entry.url = URL.createObjectURL(blob)))
        .catch((err) => { this.#cache.delete(key); throw err; })
        .finally(() => { this.#inflight--; this.#pump(); });
      this.#cache.set(key, entry);
    }
    return entry.promise;
  }
  #pump() {
    const last = Math.min(this.#chunks.length - 1, this.#index + AHEAD);
    for (let j = this.#index + 1; j <= last && this.#inflight < MAX_INFLIGHT; j++) this.#request(j).catch(() => {});
    for (const [key, e] of this.#cache) {
      if (e.i < this.#index - 2 || e.i > this.#index + AHEAD + 2) { e.controller.abort(); if (e.url) URL.revokeObjectURL(e.url); this.#cache.delete(key); }
    }
  }
  #clearCache() { for (const e of this.#cache.values()) { e.controller.abort(); if (e.url) URL.revokeObjectURL(e.url); } this.#cache.clear(); }
}
