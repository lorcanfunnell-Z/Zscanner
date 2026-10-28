// Tiny shared helper (admin only): the "open an IndexedDB database, then run a transaction" boilerplate that was
// hand-written three times, identically, in collect.js, reference.js and debuglog.js. Each of those still owns its
// own save/read logic (add vs put, how memory-only fallback data merges with stored rows, what shape it returns) —
// only this low-level open-and-transact plumbing was actually duplicated, so only this part moved.
window.ZIdbStore = {
  // dbName/storeName/storeOptions: same arguments createObjectStore would take (e.g. {autoIncrement:true} or
  // {keyPath:"n"}). Returns tx(mode, fn): opens the store (once, lazily) and runs fn(objectStore) inside a
  // transaction, resolving with fn's own return value once the transaction completes.
  openStore(dbName, storeName, storeOptions) {
    const dbp = new Promise((res, rej) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(storeName, storeOptions);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return async (mode, fn) => {
      const db = await dbp;
      return new Promise((res, rej) => {
        const t = db.transaction(storeName, mode);
        const q = fn(t.objectStore(storeName));
        t.oncomplete = () => res(q && q.result);
        t.onerror = () => rej(t.error);
      });
    };
  }
};
