import * as pdfjs from "../vendor/pdf.min.mjs";
import { normalizeText, segmentForRsvp } from "./segment.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;

/**
 * @param {File} file
 * @param {(progress: { stage: string, ratio: number }) => void} [onProgress]
 * @returns {Promise<{ title: string, units: string[], charCount: number }>}
 */
export async function processPdf(file, onProgress = () => {}) {
  onProgress({ stage: "PDFを読み込み中…", ratio: 0.05 });

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = doc.numPages;

  /** @type {string[]} */
  const pageTexts = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = extractPageText(content);
    pageTexts.push(pageText);
    onProgress({
      stage: `テキスト抽出中（${i}/${pageCount}）…`,
      ratio: 0.1 + (0.7 * i) / pageCount,
    });
  }

  onProgress({ stage: "文章を整形・分割中…", ratio: 0.85 });

  const raw = pageTexts.join("\n");
  const cleaned = cleanExtractedText(raw);
  const units = segmentForRsvp(cleaned);

  if (!units.length) {
    throw new Error("テキストを抽出できませんでした。画像スキャンPDFや保護されたPDFの可能性があります。");
  }

  const title = deriveTitle(file.name, cleaned);
  onProgress({ stage: "保存準備中…", ratio: 0.95 });

  return {
    title,
    units,
    charCount: units.reduce((n, u) => n + u.length, 0),
  };
}

/** @param {{ items: Array<{ str?: string, transform?: number[] }> }} content */
function extractPageText(content) {
  /** @type {string[]} */
  const lines = [];
  let line = "";
  let lastY = null;

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const str = item.str;
    if (!str) continue;

    const y = item.transform?.[5];
    if (lastY != null && y != null && Math.abs(lastY - y) > 4) {
      lines.push(line);
      line = str;
    } else {
      line += str;
    }
    if (y != null) lastY = y;
  }
  if (line) lines.push(line);

  return lines.join("\n");
}

/**
 * @param {string} raw
 */
function cleanExtractedText(raw) {
  let text = raw;

  // ページ番号だけの行を除去
  text = text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^\d{1,4}$/.test(t)) return false;
      if (/^-?\s*\d{1,4}\s*-?$/.test(t)) return false;
      return true;
    })
    .join("\n");

  return normalizeText(text);
}

/**
 * @param {string} fileName
 * @param {string} text
 */
function deriveTitle(fileName, text) {
  const fromFile = fileName.replace(/\.pdf$/i, "").trim();
  if (fromFile && fromFile !== "document") return fromFile;

  const snippet = text.slice(0, 40).replace(/\s+/g, " ").trim();
  return snippet || "無題の本";
}
