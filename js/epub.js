import { normalizeText, segmentForRsvp } from "./segment.js";

/**
 * @param {File} file
 * @param {(progress: { stage: string, ratio: number }) => void} [onProgress]
 * @returns {Promise<{ title: string, units: string[], charCount: number }>}
 */
export async function processEpub(file, onProgress = () => {}) {
  onProgress({ stage: "EPUBを読み込み中…", ratio: 0.05 });
  const archive = new ZipArchive(await file.arrayBuffer());
  const container = parseXml(await archive.readText("META-INF/container.xml"));
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUBの書誌情報（container.xml）を読み取れません。");

  const opf = parseXml(await archive.readText(opfPath));
  const manifest = new Map();
  for (const item of opf.querySelectorAll("manifest item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, resolvePath(opfPath, href));
  }

  const title = opf.querySelector("metadata title")?.textContent?.trim() || file.name.replace(/\.epub$/i, "");
  const chapters = [];
  const spineItems = [...opf.querySelectorAll("spine itemref")];
  for (let i = 0; i < spineItems.length; i++) {
    const path = manifest.get(spineItems[i].getAttribute("idref"));
    if (!path) continue;
    const html = await archive.readText(path);
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, nav, header, footer, noscript, svg").forEach((el) => el.remove());
    chapters.push(doc.body?.textContent || doc.documentElement.textContent || "");
    onProgress({ stage: `本文を抽出中（${i + 1}/${spineItems.length}）…`, ratio: 0.1 + (0.7 * (i + 1)) / spineItems.length });
  }

  onProgress({ stage: "文章を整形・分割中…", ratio: 0.85 });
  const units = segmentForRsvp(normalizeText(chapters.join("\n")));
  if (!units.length) throw new Error("本文を抽出できませんでした。本文が画像のみ、または未対応のEPUBの可能性があります。");
  onProgress({ stage: "保存準備中…", ratio: 0.95 });
  return { title: title || "無題の本", units, charCount: units.reduce((n, unit) => n + unit.length, 0) };
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("EPUBのXML情報を読み取れません。");
  return doc;
}

function resolvePath(baseFile, href) {
  const base = new URL(baseFile, "https://epub.invalid/");
  return decodeURIComponent(new URL(href, base).pathname.slice(1));
}

class ZipArchive {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.entries = new Map();
    let eocd = -1;
    const start = Math.max(0, this.bytes.length - 65557);
    for (let i = this.bytes.length - 22; i >= start; i--) {
      if (this.view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("EPUBのZIP構造を読み取れません。");
    const count = this.view.getUint16(eocd + 10, true);
    let offset = this.view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (this.view.getUint32(offset, true) !== 0x02014b50) throw new Error("EPUB内のファイル一覧が壊れています。");
      const flags = this.view.getUint16(offset + 8, true);
      const method = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const size = this.view.getUint32(offset + 24, true);
      const nameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localOffset = this.view.getUint32(offset + 42, true);
      const name = decoder.decode(this.bytes.subarray(offset + 46, offset + 46 + nameLength));
      this.entries.set(name, { flags, method, compressedSize, size, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
  }

  async readText(path) {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`EPUB内に ${path} が見つかりません。`);
    if (entry.flags & 1) throw new Error("暗号化されたEPUBには対応していません。");
    const offset = entry.localOffset;
    const nameLength = this.view.getUint16(offset + 26, true);
    const extraLength = this.view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const compressed = this.bytes.slice(start, start + entry.compressedSize);
    let data;
    if (entry.method === 0) data = compressed;
    else if (entry.method === 8 && typeof DecompressionStream !== "undefined") {
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        throw new Error("EPUBの圧縮本文を展開できません。このブラウザが必要な圧縮方式に対応しているか確認してください。");
      }
    } else throw new Error("このEPUBの圧縮方式には対応していません。");
    if (data.length !== entry.size) throw new Error("EPUB内のファイルを正しく展開できませんでした。");
    return new TextDecoder("utf-8").decode(data);
  }
}
