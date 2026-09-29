const DB_NAME = "rsvp-reader";
const DB_VERSION = 2;
const STORE = "books";
const WORD_STORE = "words";

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
      if (!db.objectStoreNames.contains(WORD_STORE)) {
        db.createObjectStore(WORD_STORE, { keyPath: "term" });
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

/** @typedef {{ term: string, occurrences: { bookId: string, bookTitle: string, index: number, addedAt: number }[] }} SavedWord */

export async function listWords() {
  const db = await openDb();
  const tx = db.transaction(WORD_STORE, "readonly");
  /** @type {SavedWord[]} */
  const words = await reqToPromise(tx.objectStore(WORD_STORE).getAll());
  return words.sort((a, b) => a.term.localeCompare(b.term, "ja"));
}

export async function getWord(term) {
  const db = await openDb();
  const tx = db.transaction(WORD_STORE, "readonly");
  return reqToPromise(tx.objectStore(WORD_STORE).get(term));
}

export async function saveWordOccurrence(term, book, index) {
  const db = await openDb();
  const tx = db.transaction(WORD_STORE, "readwrite");
  const store = tx.objectStore(WORD_STORE);
  const word = await reqToPromise(store.get(term)) || { term, occurrences: [] };
  if (!word.occurrences.some((item) => item.bookId === book.id && item.index === index)) {
    word.occurrences.push({ bookId: book.id, bookTitle: book.title, index, addedAt: Date.now() });
  }
  await reqToPromise(store.put(word));
}

export async function deleteWord(term) {
  const db = await openDb();
  const tx = db.transaction(WORD_STORE, "readwrite");
  await reqToPromise(tx.objectStore(WORD_STORE).delete(term));
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
