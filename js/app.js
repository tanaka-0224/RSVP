import {
  listBooks,
  getBook,
  saveBook,
  deleteBook,
  updateBookProgress,
  createId,
  progressPercent,
} from "./db.js";
import { processPdf } from "./pdf.js";
import { RsvpPlayer } from "./reader.js";

/** @typedef {import('./db.js').Book} Book */

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const views = {
  library: $("view-library"),
  import: $("view-import"),
  reader: $("view-reader"),
};

const els = {
  bookList: $("book-list"),
  libraryEmpty: $("library-empty"),
  btnAddBook: $("btn-add-book"),
  btnImportBack: $("btn-import-back"),
  pdfInput: /** @type {HTMLInputElement} */ ($("pdf-input")),
  importStatus: $("import-status"),
  importLabel: $("import-label"),
  importBar: $("import-bar"),
  importError: $("import-error"),
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
let saveTimer = 0;
let importing = false;

const player = new RsvpPlayer({
  onTick(index, unit) {
    renderRsvpUnit(unit);
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

    card.append(openBtn, delBtn);
    els.bookList.append(card);
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
    renderTextMode();
  } else {
    if (showTextAlongsideRsvp) renderTextMode();
    else els.textPane.replaceChildren();
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

function renderTextMode() {
  if (!currentBook) return;
  const units = currentBook.units;
  const center = player.index;
  const radius = 80;
  const start = Math.max(0, center - radius);
  const end = Math.min(units.length, center + radius + 1);

  const frag = document.createDocumentFragment();
  if (start > 0) {
    const lead = document.createElement("span");
    lead.className = "text-ellipsis";
    lead.textContent = "… ";
    frag.append(lead);
  }

  for (let i = start; i < end; i++) {
    const span = document.createElement("button");
    span.type = "button";
    span.className = "text-unit" + (i === center ? " current" : "");
    span.dataset.index = String(i);
    span.textContent = units[i];
    frag.append(span);
    // 日本語は基本スペース不要。英数字の後だけスペース
    if (i < end - 1 && /[A-Za-z0-9]$/.test(units[i]) && /^[A-Za-z0-9]/.test(units[i + 1])) {
      frag.append(document.createTextNode(" "));
    }
  }

  if (end < units.length) {
    const trail = document.createElement("span");
    trail.className = "text-ellipsis";
    trail.textContent = " …";
    frag.append(trail);
  }

  els.textPane.replaceChildren(frag);

  // ページ全体は動かさず、テキスト枠内だけ現在位置へスクロール
  const currentEl = els.textPane.querySelector(".text-unit.current");
  if (currentEl instanceof HTMLElement) {
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

async function handlePdfFile(file) {
  if (!file || importing) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showImportError("PDFファイルを選択してください。");
    return;
  }

  importing = true;
  els.importError.hidden = true;
  els.importStatus.classList.add("visible");
  setImportProgress("開始…", 0.02);

  try {
    const result = await processPdf(file, ({ stage, ratio }) => {
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

    await saveBook(book);
    setImportProgress("完了", 1);
    els.pdfInput.value = "";
    importing = false;
    await openBook(book.id);
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
  els.btnAddBook.addEventListener("click", () => {
    els.importError.hidden = true;
    els.importStatus.classList.remove("visible");
    showView("import");
  });

  els.btnImportBack.addEventListener("click", async () => {
    if (importing) return;
    showView("library");
    await refreshLibrary();
  });

  els.pdfInput.addEventListener("change", () => {
    const file = els.pdfInput.files?.[0];
    if (file) handlePdfFile(file);
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
