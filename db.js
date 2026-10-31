// Library lives in this browser (IndexedDB). Metadata and text are separate stores.
let opened = null;
function open() {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("lectern", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("docs", { keyPath: "id" }); req.result.createObjectStore("texts", { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}
async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = work(...stores.map((s) => tx.objectStore(s)));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function listDocs() { return (await run(["docs"], "readonly", (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function getDoc(id) {
  const [meta, body] = await Promise.all([run(["docs"], "readonly", (s) => s.get(id)), run(["texts"], "readonly", (s) => s.get(id))]);
  return meta && body ? { ...meta, text: body.text } : null;
}
export const putDoc = (meta, text) => run(["docs", "texts"], "readwrite", (d, t) => { d.put(meta); t.put({ id: meta.id, text }); });
export async function updateMeta(id, patch) {
  const meta = await run(["docs"], "readonly", (s) => s.get(id));
  if (!meta) return null;
  const next = { ...meta, ...patch };
  await run(["docs"], "readwrite", (s) => s.put(next));
  return next;
}
export const deleteDoc = (id) => run(["docs", "texts"], "readwrite", (d, t) => { d.delete(id); t.delete(id); });
