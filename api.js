// Thin client for the Lectern server. Errors carry user-safe messages.
async function request(url, init) {
  let res;
  try { res = await fetch(url, init); }
  catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Can't reach the Lectern server. Is it still running?");
  }
  if (!res.ok) {
    let message = `Something went wrong (error ${res.status}).`;
    try { const b = await res.json(); if (typeof b.detail === "string") message = b.detail; } catch {}
    throw new Error(message);
  }
  return res;
}
const post = (body, extra = {}) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra });

export const getVoices = async () => (await request("/api/voices")).json();
export const tts = async (text, voice, signal) => (await request("/api/tts", post({ text, voice }, { signal }))).blob();
export const cleanText = async (text) => (await (await request("/api/clean", post({ text }))).json()).text;
export async function extractFile(file) {
  const form = new FormData(); form.append("file", file);
  return (await request("/api/extract", { method: "POST", body: form })).json();
}
export const extractUrl = async (url) => (await request("/api/extract-url", post({ url }))).json();
export const exportAudio = async (chunks, voice, title) => (await request("/api/export", post({ chunks, voice, title }))).blob();
