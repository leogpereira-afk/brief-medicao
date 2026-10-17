/* Rascunhos locais por usuário. Nunca contém credenciais nem substitui o servidor. */
const LAYOUT_DRAFTS = (() => {
  let db;
  async function open() {
    if (db) return db;
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('impresilk-layout-drafts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Armazenamento ocupado'));
    });
    return db;
  }
  async function read(key) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const r = d.transaction('drafts').objectStore('drafts').get(key);
      r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
    });
  }
  async function write(key, value) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  return { read, write };
})();
