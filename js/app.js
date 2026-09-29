import {
  listBooks,
  getBook,
  saveBook,
  deleteBook,
  updateBookProgress,
  createId,
  progressPercent,
  listWords,
  getWord,
  saveWordOccurrence,
  deleteWord,
} from "./db.js";
import { processPdf } from "./pdf.js";
import { processEpub } from "./epub.js";
import { RsvpPlayer } from "./reader.js";

/** @typedef {import('./db.js').Book} Book */

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const views = {
  library: $("view-library"),
  import: $("view-import"),
  reader: $("view-reader"),
  wordbook: $("view-wordbook"),
};

const els = {
  bookList: $("book-list"),
  libraryEmpty: $("library-empty"),
  wordList: $("word-list"),
  wordEmpty: $("word-empty"),
  btnWordbook: $("btn-wordbook"),
  btnWordbookBack: $("btn-wordbook-back"),
  btnSaveWord: /** @type {HTMLButtonElement} */ ($("btn-save-word")),
  storageUsage: $("storage-usage"),
  storageNote: $("storage-note"),
  storageTrack: $("storage-track"),
  storageFill: $("storage-fill"),
  btnStorageRefresh: $("btn-storage-refresh"),
  btnAddBook: $("btn-add-book"),
  btnImportBack: $("btn-import-back"),
  bookInput: /** @type {HTMLInputElement} */ ($("book-input")),
  importStatus: $("import-status"),
  importLabel: $("import-label"),
  importBar: $("import-bar"),
  importError: $("import-error"),
  importNamePanel: $("import-name-panel"),
  importName: /** @type {HTMLInputElement} */ ($("import-name")),
  btnSaveImport: $("btn-save-import"),
  readerTitle: $("reader-title"),
  rsvpWord: $("rsvp-word"),
  readerMeta: $("reader-meta"),
  rsvpStage: $("rsvp-stage"),
  textStage: $("text-stage"),
  textPane: $("text-pane"),
  rsvpControls: $("rsvp-controls"),
  textControls: $("text-controls"),
  btnModeToggle: $("btn-mode-toggle"),
  btnBackRsvp: $("btn-back-rsvp"),
  btnReaderBack: $("btn-reader-back"),
  btnPlay: $("btn-play"),
  btnPrev: $("btn-prev"),
  btnNext: $("btn-next"),
  btnRestart: $("btn-restart"),
  btnJump: $("btn-jump"),
  speedRange: /** @type {HTMLInputElement} */ ($("speed-range")),
  speedLabel: $("speed-label"),
  modalDelete: $("modal-delete"),
  modalRename: $("modal-rename"),
  renameInput: /** @type {HTMLInputElement} */ ($("rename-input")),
  btnRenameCancel: $("btn-rename-cancel"),
  btnRenameConfirm: $("btn-rename-confirm"),
  deleteMessage: $("delete-message"),
  btnDeleteCancel: $("btn-delete-cancel"),
  btnDeleteConfirm: $("btn-delete-confirm"),
  modalJump: $("modal-jump"),
  jumpMax: $("jump-max"),
  jumpInput: /** @type {HTMLInputElement} */ ($("jump-input")),
  btnJumpCancel: $("btn-jump-cancel"),
  btnJumpConfirm: $("btn-jump-confirm"),
};

/** @type {Book|null} */
let currentBook = null;
/** @type {'rsvp'|'text'} */
let mode = "rsvp";
let showTextAlongsideRsvp = false;
/** @type {string|null} */
let pendingDeleteId = null;
/** @type {string|null} */
let pendingRenameId = null;
let saveTimer = 0;
let importing = false;
/** @type {Book|null} */
let pendingImportBook = null;
/** @type {HTMLButtonElement[]} */
let textUnitElements = [];
/** @type {HTMLButtonElement|null} */
let currentTextElement = null;
let renderedTextBookId = null;

const player = new RsvpPlayer({
  onTick(index, unit) {
    renderRsvpUnit(unit);
    updateWordButton();
    renderMeta(index);
    if (mode === "text" || showTextAlongsideRsvp) renderTextMode();
    scheduleSave({ position: index });
  },
  onState(playing) {
    els.btnPlay.textContent = playing ? "⏸" : "▶";
    els.btnPlay.setAttribute("aria-label", playing ? "一時停止" : "再生");
  },
});

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle("active", key === name);
  }
}

async function refreshLibrary() {
  const books = await listBooks();
  els.bookList.innerHTML = "";
  els.libraryEmpty.hidden = books.length > 0;
  await refreshStorageUsage();

  for (const book of books) {
    const pct = progressPercent(book);
    const card = document.createElement("div");
    card.className = "book-card-wrap";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "book-card";
    openBtn.innerHTML = `
      <span class="title"></span>
      <span class="meta"></span>
      <span class="progress-track"><span class="progress-fill" style="width:${pct}%"></span></span>
    `;
    openBtn.querySelector(".title").textContent = book.title;
    openBtn.querySelector(".meta").textContent =
      pct === 0 && book.position === 0
        ? `未読 · ${book.units.length.toLocaleString()}単位`
        : `${pct}% 読了 · ${book.units.length.toLocaleString()}単位`;

    openBtn.addEventListener("click", () => openBook(book.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn delete-btn";
    delBtn.setAttribute("aria-label", `${book.title}を削除`);
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteModal(book);
    });

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "icon-btn rename-btn";
    renameBtn.setAttribute("aria-label", `${book.title}の名前を変更`);
    renameBtn.textContent = "✎";
    renameBtn.addEventListener("click", () => openRenameModal(book));

    card.append(openBtn, renameBtn, delBtn);
    els.bookList.append(card);
  }
}

async function refreshWordbook() {
  const words = await listWords();
  els.wordList.replaceChildren();
  els.wordEmpty.hidden = words.length > 0;
  for (const word of words) {
    const row = document.createElement("article");
    row.className = "word-card";
    const info = document.createElement("div");
    const term = document.createElement("strong");
    term.textContent = word.term;
    const detail = document.createElement("p");
    const books = [...new Set(word.occurrences.map((item) => item.bookTitle))];
    detail.textContent = `${word.occurrences.length}回 · ${books.join("、")}`;
    info.append(term, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-btn";
    remove.textContent = "削除";
    remove.addEventListener("click", async () => {
      await deleteWord(word.term);
      await refreshWordbook();
      if (currentBook) updateWordButton();
    });
    row.append(info, remove);
    els.wordList.append(row);
  }
}

async function updateWordButton() {
  const term = getWordRange()
    .filter(({ unit }) => !isPunctuation(unit))
    .map(({ unit }) => unit)
    .join("");
  const saved = term ? await getWord(term) : undefined;
  els.btnSaveWord.textContent = saved
    ? "登録済み"
    : "前後をまとめて登録";
  els.btnSaveWord.disabled = !term;
}

function isPunctuation(unit) {
  return /^[。．！？!?、，,…]+$/.test(unit);
}

function getWordRange() {
  const start = Math.max(0, player.index - 1);
  const end = Math.min(player.units.length - 1, player.index + 1);
  return player.units.slice(start, end + 1).map((unit, offset) => ({ unit, index: start + offset }));
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshStorageUsage() {
  if (!navigator.storage?.estimate) {
    els.storageUsage.textContent = "このブラウザでは使用量を取得できません。";
    els.storageNote.textContent = "Safari 17以降など、Storage APIに対応したブラウザで確認できます。";
    els.storageTrack.hidden = true;
    return;
  }

  els.storageUsage.textContent = "確認中…";
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number") throw new Error("Storage usage unavailable");
    const percent = typeof quota === "number" && quota > 0
      ? Math.min(100, Math.round((usage / quota) * 100))
      : null;
    els.storageUsage.textContent = percent === null
      ? `使用中 ${formatBytes(usage)}（上限の目安は取得できません）`
      : `使用中 ${formatBytes(usage)} / 上限の目安 ${formatBytes(quota)}（${percent}%）`;
    els.storageFill.style.width = `${percent ?? 0}%`;
    els.storageTrack.setAttribute("aria-valuenow", String(percent ?? 0));
    els.storageTrack.hidden = percent === null;
    els.storageNote.textContent = "ブラウザが返す概算です。本のデータに加え、オフライン用ファイルなど、このサイトの保存データ全体を含みます。実際の上限や空き容量とは異なる場合があります。";
  } catch (err) {
    console.warn("Storage estimate failed", err);
    els.storageUsage.textContent = "使用量を取得できませんでした。";
    els.storageNote.textContent = "時間をおいて「更新」を押してください。";
    els.storageTrack.hidden = true;
  }
}

/**
 * @param {string} id
 */
async function openBook(id) {
  const book = await getBook(id);
  if (!book) {
    await refreshLibrary();
    return;
  }

  currentBook = book;
  mode = "rsvp";
  showTextAlongsideRsvp = false;
  views.reader.classList.add("mode-rsvp");
  views.reader.classList.remove("mode-text");
  applyModeUi();

  els.readerTitle.textContent = book.title;
  els.speedRange.value = String(book.cpm || 400);
  updateSpeedLabel(book.cpm || 400);

  player.load(book.units, book.position || 0, book.cpm || 400);
  showView("reader");
}

function applyModeUi() {
  const isRsvp = mode === "rsvp";
  const reader = views.reader;

  reader.classList.toggle("mode-rsvp", isRsvp);
  reader.classList.toggle("mode-text", !isRsvp);
  reader.classList.toggle("mode-rsvp-text", isRsvp && showTextAlongsideRsvp);

  els.rsvpStage.hidden = !isRsvp;
  els.rsvpControls.hidden = !isRsvp;
  els.textStage.hidden = isRsvp && !showTextAlongsideRsvp;
  els.textControls.hidden = isRsvp || showTextAlongsideRsvp;
  els.btnModeToggle.textContent = isRsvp ? "通常表示" : "RSVP";

  if (!isRsvp) {
    player.pause();
    renderTextMode(true);
  } else {
    if (showTextAlongsideRsvp) renderTextMode(true);
    player.emit();
  }
}

function renderRsvpUnit(unit) {
  els.rsvpWord.textContent = unit || "—";
  els.rsvpWord.classList.toggle("is-punct", /^[。．！？!?、，,…]+$/.test(unit));
}

/**
 * @param {number} index
 */
function renderMeta(index) {
  if (!currentBook) return;
  const total = currentBook.units.length;
  const pct = total ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 0;
  els.readerMeta.textContent = `${(index + 1).toLocaleString()} / ${total.toLocaleString()} · ${pct}%`;
}

function renderTextMode(scrollToCurrent = false) {
  if (!currentBook) return;
  const units = currentBook.units;

  if (renderedTextBookId !== currentBook.id) {
    const frag = document.createDocumentFragment();
    textUnitElements = [];
    for (let i = 0; i < units.length; i++) {
      const span = document.createElement("button");
      span.type = "button";
      span.className = "text-unit";
      span.dataset.index = String(i);
      span.textContent = units[i];
      textUnitElements.push(span);
      frag.append(span);
      // 日本語は基本スペース不要。英数字の後だけスペース
      if (i < units.length - 1 && /[A-Za-z0-9]$/.test(units[i]) && /^[A-Za-z0-9]/.test(units[i + 1])) {
        frag.append(document.createTextNode(" "));
      }
    }
    els.textPane.replaceChildren(frag);
    renderedTextBookId = currentBook.id;
    currentTextElement = null;
  }

  const currentEl = textUnitElements[player.index] || null;
  if (currentTextElement !== currentEl) {
    currentTextElement?.classList.remove("current");
    currentEl?.classList.add("current");
    currentTextElement = currentEl;
  }

  if (scrollToCurrent && currentEl) {
    // 表示に切り替えた時だけ現在位置へ移動し、その後は全文を自由にスクロールできる。
    const pane = els.textPane;
    const paneRect = pane.getBoundingClientRect();
    const elRect = currentEl.getBoundingClientRect();
    const offset =
      elRect.top - paneRect.top - paneRect.height / 2 + elRect.height / 2 + pane.scrollTop;
    pane.scrollTop = Math.max(0, offset);
  }
}

/**
 * @param {{ position?: number, cpm?: number }} patch
 */
function scheduleSave(patch) {
  if (!currentBook) return;
  if (typeof patch.position === "number") currentBook.position = patch.position;
  if (typeof patch.cpm === "number") currentBook.cpm = patch.cpm;

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    if (!currentBook) return;
    await updateBookProgress(currentBook.id, {
      position: currentBook.position,
      cpm: currentBook.cpm,
    });
  }, 400);
}

/**
 * @param {number} cpm
 */
function updateSpeedLabel(cpm) {
  els.speedLabel.textContent = `${cpm} CPM`;
}

/**
 * @param {Book} book
 */
function openDeleteModal(book) {
  pendingDeleteId = book.id;
  els.deleteMessage.textContent = `「${book.title}」を削除します。この操作は取り消せません。`;
  els.modalDelete.classList.add("open");
}

function closeDeleteModal() {
  pendingDeleteId = null;
  els.modalDelete.classList.remove("open");
}

/** @param {Book} book */
function openRenameModal(book) {
  pendingRenameId = book.id;
  els.renameInput.value = book.title;
  els.modalRename.classList.add("open");
  els.renameInput.focus();
  els.renameInput.select();
}

function closeRenameModal() {
  pendingRenameId = null;
  els.modalRename.classList.remove("open");
}

function openJumpModal() {
  if (!currentBook) return;
  player.pause();
  els.jumpMax.textContent = String(currentBook.units.length);
  els.jumpInput.max = String(currentBook.units.length);
  els.jumpInput.value = String(player.index + 1);
  els.modalJump.classList.add("open");
  els.jumpInput.focus();
  els.jumpInput.select();
}

function closeJumpModal() {
  els.modalJump.classList.remove("open");
}

async function handleBookFile(file) {
  if (!file || importing) return;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isEpub = /\.epub$/i.test(file.name) || file.type === "application/epub+zip";
  if (!isPdf && !isEpub) {
    showImportError("PDFまたはEPUBファイルを選択してください。");
    return;
  }

  importing = true;
  els.importError.hidden = true;
  els.importNamePanel.hidden = true;
  pendingImportBook = null;
  els.importStatus.classList.add("visible");
  setImportProgress("開始…", 0.02);

  try {
    const result = await (isPdf ? processPdf : processEpub)(file, ({ stage, ratio }) => {
      setImportProgress(stage, ratio);
    });
    const now = Date.now();
    /** @type {Book} */
    const book = {
      id: createId(),
      title: result.title,
      units: result.units,
      position: 0,
      cpm: 400,
      createdAt: now,
      updatedAt: now,
    };
    pendingImportBook = book;
    els.importName.value = result.title;
    els.importNamePanel.hidden = false;
    setImportProgress("完了", 1);
    els.bookInput.value = "";
    importing = false;
  } catch (err) {
    console.error(err);
    importing = false;
    showImportError(err instanceof Error ? err.message : "取り込みに失敗しました。");
    setImportProgress("失敗", 0);
  }
}

/**
 * @param {string} label
 * @param {number} ratio
 */
function setImportProgress(label, ratio) {
  els.importLabel.textContent = label;
  els.importBar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

/**
 * @param {string} message
 */
function showImportError(message) {
  els.importError.hidden = false;
  els.importError.textContent = message;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("SW registration failed", err);
    });
  });
}

function bindEvents() {
  els.btnStorageRefresh.addEventListener("click", refreshStorageUsage);
  els.btnWordbook.addEventListener("click", async () => {
    await refreshWordbook();
    showView("wordbook");
  });
  els.btnWordbookBack.addEventListener("click", () => showView("library"));
  els.btnSaveWord.addEventListener("click", async () => {
    if (!currentBook) return;
    const term = getWordRange()
      .filter(({ unit }) => !isPunctuation(unit))
      .map(({ unit }) => unit)
      .join("");
    if (!term) return;
    await saveWordOccurrence(term, currentBook, player.index);
    await updateWordButton();
  });
  els.btnAddBook.addEventListener("click", () => {
    els.importError.hidden = true;
    els.importStatus.classList.remove("visible");
    els.importNamePanel.hidden = true;
    pendingImportBook = null;
    showView("import");
  });

  els.btnSaveImport.addEventListener("click", async () => {
    if (!pendingImportBook) return;
    const title = els.importName.value.trim();
    if (!title) {
      els.importName.focus();
      els.importName.setCustomValidity("本の名前を入力してください。");
      els.importName.reportValidity();
      return;
    }
    els.importName.setCustomValidity("");
    pendingImportBook.title = title;
    await saveBook(pendingImportBook);
    const id = pendingImportBook.id;
    pendingImportBook = null;
    els.importNamePanel.hidden = true;
    await openBook(id);
  });

  els.importName.addEventListener("input", () => els.importName.setCustomValidity(""));

  els.btnImportBack.addEventListener("click", async () => {
    if (importing) return;
    pendingImportBook = null;
    els.importNamePanel.hidden = true;
    showView("library");
    await refreshLibrary();
  });

  els.bookInput.addEventListener("change", () => {
    const file = els.bookInput.files?.[0];
    if (file) handleBookFile(file);
  });

  els.btnReaderBack.addEventListener("click", async () => {
    player.pause();
    if (currentBook) {
      await updateBookProgress(currentBook.id, {
        position: player.index,
        cpm: currentBook.cpm,
      });
    }
    currentBook = null;
    showView("library");
    await refreshLibrary();
  });

  els.btnPlay.addEventListener("click", () => player.toggle());
  els.btnPrev.addEventListener("click", () => player.prev());
  els.btnNext.addEventListener("click", () => player.next());
  els.btnRestart.addEventListener("click", () => player.restart());
  els.btnJump.addEventListener("click", openJumpModal);

  els.speedRange.addEventListener("input", () => {
    const cpm = Number(els.speedRange.value);
    updateSpeedLabel(cpm);
    player.setCpm(cpm);
    if (currentBook) {
      currentBook.cpm = cpm;
      scheduleSave({ cpm });
    }
  });

  els.btnModeToggle.addEventListener("click", () => {
    if (mode === "rsvp") {
      mode = "text";
      showTextAlongsideRsvp = false;
    } else {
      mode = "rsvp";
    }
    applyModeUi();
  });

  els.btnBackRsvp.addEventListener("click", () => {
    mode = "rsvp";
    showTextAlongsideRsvp = true;
    applyModeUi();
  });

  els.textPane.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const unitBtn = target.closest(".text-unit");
    if (!unitBtn || !(unitBtn instanceof HTMLElement)) return;
    const idx = Number(unitBtn.dataset.index);
    if (Number.isFinite(idx)) {
      player.jump(idx);
      mode = "rsvp";
      showTextAlongsideRsvp = false;
      applyModeUi();
    }
  });

  els.btnDeleteCancel.addEventListener("click", closeDeleteModal);
  els.modalDelete.addEventListener("click", (e) => {
    if (e.target === els.modalDelete) closeDeleteModal();
  });
  els.btnRenameCancel.addEventListener("click", closeRenameModal);
  els.modalRename.addEventListener("click", (e) => {
    if (e.target === els.modalRename) closeRenameModal();
  });
  els.btnRenameConfirm.addEventListener("click", async () => {
    if (!pendingRenameId) return;
    const title = els.renameInput.value.trim();
    if (!title) {
      els.renameInput.focus();
      els.renameInput.setCustomValidity("本の名前を入力してください。");
      els.renameInput.reportValidity();
      return;
    }
    const book = await getBook(pendingRenameId);
    if (book) {
      book.title = title;
      book.updatedAt = Date.now();
      await saveBook(book);
      if (currentBook?.id === book.id) {
        currentBook.title = title;
        els.readerTitle.textContent = title;
      }
    }
    closeRenameModal();
    await refreshLibrary();
  });
  els.renameInput.addEventListener("input", () => els.renameInput.setCustomValidity(""));
  els.btnDeleteConfirm.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    closeDeleteModal();
    await deleteBook(id);
    if (currentBook?.id === id) {
      player.pause();
      currentBook = null;
      showView("library");
    }
    await refreshLibrary();
  });

  els.btnJumpCancel.addEventListener("click", closeJumpModal);
  els.modalJump.addEventListener("click", (e) => {
    if (e.target === els.modalJump) closeJumpModal();
  });
  els.btnJumpConfirm.addEventListener("click", () => {
    const n = Number(els.jumpInput.value);
    if (!Number.isFinite(n) || !currentBook) return;
    player.jump(Math.round(n) - 1);
    closeJumpModal();
  });
  els.jumpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.btnJumpConfirm.click();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentBook) {
      updateBookProgress(currentBook.id, {
        position: player.index,
        cpm: currentBook.cpm,
      });
    }
  });

  window.addEventListener("keydown", (e) => {
    if (!views.reader.classList.contains("active") || mode !== "rsvp") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      player.toggle();
    } else if (e.code === "ArrowLeft") {
      player.prev();
    } else if (e.code === "ArrowRight") {
      player.next();
    }
  });
}

async function init() {
  bindEvents();
  registerServiceWorker();
  await refreshLibrary();
}

init().catch((err) => {
  console.error(err);
});
