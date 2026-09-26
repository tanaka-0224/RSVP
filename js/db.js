const DB_NAME = "rsvp-reader";
const DB_VERSION = 1;
const STORE = "books";

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @typedef {Object} Book
 * @property {string} id
 * @property {string} title
 * @property {string[]} units
 * @property {number} position
 * @property {number} cpm
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/** @returns {Promise<Book[]>} */
export async function listBooks() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  /** @type {Book[]} */
  const books = await reqToPromise(tx.objectStore(STORE).getAll());
  return books.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * @param {string} id
 * @returns {Promise<Book|undefined>}
 */
export async function getBook(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return reqToPromise(tx.objectStore(STORE).get(id));
}

/**
 * @param {Book} book
 * @returns {Promise<void>}
 */
export async function saveBook(book) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await reqToPromise(tx.objectStore(STORE).put(book));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBook(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await reqToPromise(tx.objectStore(STORE).delete(id));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 * @param {{ position?: number, cpm?: number }} patch
 * @returns {Promise<Book|undefined>}
 */
export async function updateBookProgress(id, patch) {
  const book = await getBook(id);
  if (!book) return undefined;

  if (typeof patch.position === "number") {
    book.position = Math.max(0, Math.min(patch.position, Math.max(0, book.units.length - 1)));
  }
  if (typeof patch.cpm === "number") {
    book.cpm = patch.cpm;
  }
  book.updatedAt = Date.now();
  await saveBook(book);
  return book;
}

export function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {Book} book
 * @returns {number}
 */
export function progressPercent(book) {
  if (!book.units.length) return 0;
  if (book.position <= 0) return 0;
  return Math.min(100, Math.round(((book.position + 1) / book.units.length) * 100));
}
