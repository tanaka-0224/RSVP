/**
 * 日本語文章をRSVP表示単位に分割する。
 * 形態素解析なし。文字種境界・助詞・句読点・長さ制限で文節風に区切る。
 */

const MAX_UNIT = 8;
const MIN_UNIT = 2;

/** 長いもの優先で末尾マッチ */
const PARTICLES = [
  "について", "として", "による", "に対して",
  "から", "まで", "より", "ほど", "だけ", "など", "なり",
  "って", "ても", "でも", "ては", "には", "とは", "では", "ので", "のに",
  "して", "れて", "めて", "いて",
  "は", "が", "を", "に", "へ", "と", "で", "や", "も", "の", "か", "ね", "よ", "な", "て",
];

/** 助詞に見せかけて途中で切ってはいけない語尾 */
const AUX_TAILS = ["です", "ます", "でした", "ました", "である", "だった", "だった。", "です。", "ます。"];

/** @param {string} ch */
function charKind(ch) {
  if (/[。．！？!?….]/.test(ch)) return "stop";
  if (/[、，,；;：:]/.test(ch)) return "comma";
  if (/[\s\u3000]/.test(ch)) return "space";
  if (/[「『（(\[【〈《]/.test(ch)) return "open";
  if (/[」』）)\]】〉》]/.test(ch)) return "close";
  if (/[ぁ-ゖ]/.test(ch)) return "hira";
  if (/[ァ-ヺー]/.test(ch)) return "kata";
  if (/[一-龯々〆ヵヶ]/.test(ch)) return "kanji";
  if (/[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/.test(ch)) return "alnum";
  return "other";
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeText(raw) {
  let text = raw.replace(/\r\n?/g, "\n");
  text = text.replace(/([ぁ-んァ-ン一-龯A-Za-z])-\n([ぁ-んァ-ン一-龯A-Za-z])/g, "$1$2");
  text = text.replace(/([ぁ-んァ-ン一-龯々〆ヵヶー])\n+([ぁ-んァ-ン一-龯々〆ヵヶー])/g, "$1$2");
  text = text.replace(/([A-Za-z0-9])\n+([A-Za-z0-9])/g, "$1 $2");
  text = text.replace(/\n+/g, " ");
  text = text.replace(/[ \t\u3000]+/g, " ");
  text = text.replace(/\s+\d{1,3}\s+/g, " ");
  return text.trim();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function segmentForRsvp(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  /** @type {string[]} */
  const tokens = [];
  let i = 0;

  while (i < normalized.length) {
    if (charKind(normalized[i]) === "space") {
      i += 1;
      continue;
    }
    const { unit, next } = takeChunk(normalized, i);
    if (unit) tokens.push(unit);
    i = Math.max(next, i + 1);
  }

  return mergeTiny(tokens);
}

/**
 * @param {string} text
 * @param {number} start
 */
function takeChunk(text, start) {
  const kind0 = charKind(text[start]);

  // 英数字ブロック
  if (kind0 === "alnum") {
    let end = start + 1;
    while (end < text.length && charKind(text[end]) === "alnum") end += 1;
    end = attachParticle(text, end);
    end = attachPunct(text, end);
    return { unit: text.slice(start, end), next: end };
  }

  let end = start;
  let script = kind0 === "open" ? null : kind0;

  while (end < text.length) {
    const ch = text[end];
    const k = charKind(ch);

    if (k === "space") break;

    // 新しい開き括弧は次の単位へ
    if (k === "open" && end > start) break;

    // 英数字への切り替わりは別単位（助詞だけ先に付ける処理は alnum 側）
    if (k === "alnum" && end > start) break;

    // 句読点・閉じは含めて終了
    if (k === "stop" || k === "comma" || k === "close") {
      end += 1;
      end = attachPunct(text, end);
      break;
    }

    // カタカナ↔漢字 などの大きな切り替わり（ひらがなは助詞になり得るので緩め）
    if (
      script &&
      end > start &&
      ((script === "kata" && k === "kanji") ||
        (script === "kanji" && k === "kata") ||
        (script === "hira" && (k === "kanji" || k === "kata") && end - start >= MIN_UNIT))
    ) {
      // ひらがな→漢字は助詞終わりなら切る
      if (script === "hira") {
        if (particleEnd(text.slice(start, end)) && !breaksAux(text, start, end)) {
          break;
        }
      } else {
        break;
      }
    }

    if (!script && k !== "open") script = k;
    if (k === "kanji" || k === "kata" || k === "hira") script = k;

    end += 1;
    const slice = text.slice(start, end);

    // 長すぎる場合は助詞境界で戻す
    if (slice.length > MAX_UNIT) {
      const cut = bestCut(text, start, start + MAX_UNIT);
      return { unit: text.slice(start, cut), next: cut };
    }

    // 助詞終わり + 次が実語なら切る
    if (slice.length >= MIN_UNIT && particleEnd(slice) && !breaksAux(text, start, end)) {
      const peek = text[end];
      const pk = peek ? charKind(peek) : null;
      if (!peek || pk === "stop" || pk === "comma" || pk === "close") {
        end = attachPunct(text, end);
        break;
      }
      if (pk === "kanji" || pk === "kata" || pk === "alnum" || pk === "open") {
        break;
      }
      // 次もひらがな：長い助詞（でも・には等）の途中なら続行
      if (pk === "hira" && slice.length >= 3) {
        if (extendsLongerParticle(slice, text[end])) {
          // keep going
        } else if (!startsAuxContinuation(text, end)) {
          break;
        }
      }
    }
  }

  if (end <= start) end = Math.min(text.length, start + 1);
  return { unit: text.slice(start, end), next: end };
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} maxEnd
 */
function bestCut(text, start, maxEnd) {
  for (let i = maxEnd; i > start + 1; i--) {
    const slice = text.slice(start, i);
    if (particleEnd(slice) && !breaksAux(text, start, i)) return i;
  }
  for (let i = maxEnd; i > start + 1; i--) {
    if (charKind(text[i - 1]) !== charKind(text[i])) return i;
  }
  return maxEnd;
}

/**
 * 助詞で切ると「です」「ます」を壊す場合
 * @param {string} text
 * @param {number} start
 * @param {number} end
 */
function breaksAux(text, start, end) {
  const rest = text.slice(end, end + 4);
  const before = text.slice(Math.max(start, end - 2), end);
  // 「で|す」「ま|す」を防ぐ
  if (before.endsWith("で") && rest.startsWith("す")) return true;
  if (before.endsWith("ま") && rest.startsWith("す")) return true;
  if (before.endsWith("でし") && rest.startsWith("た")) return true;
  if (before.endsWith("まし") && rest.startsWith("た")) return true;
  // 切った結果が AUX の途中
  for (const aux of AUX_TAILS) {
    const combined = text.slice(end - 1, end - 1 + aux.length);
    if (aux.startsWith(before.slice(-1)) && aux.length > 1) {
      // soft check
    }
    if (text.slice(end - 2, end + aux.length - 2).startsWith(aux) && end < start + aux.length) {
      return true;
    }
  }
  return false;
}

/** @param {string} text @param {number} pos */
function startsAuxContinuation(text, pos) {
  const rest = text.slice(pos, pos + 3);
  return /^(す|した|して|れる|られる)/.test(rest);
}

/** @param {string} slice */
function particleEnd(slice) {
  for (const p of PARTICLES) {
    if (slice.endsWith(p)) return true;
  }
  return false;
}

/** 「で」+「も」→「でも」のように長い助詞へ伸びるなら true */
function extendsLongerParticle(slice, nextCh) {
  if (!nextCh) return false;
  const extended = slice + nextCh;
  const short = matchedParticle(slice);
  const longer = matchedParticle(extended);
  return Boolean(longer && (!short || longer.length > short.length));
}

/** @param {string} slice */
function matchedParticle(slice) {
  for (const p of PARTICLES) {
    if (slice.endsWith(p)) return p;
  }
  return null;
}

/** @param {string} text @param {number} pos */
function attachParticle(text, pos) {
  for (const p of PARTICLES) {
    if (text.startsWith(p, pos) && p.length <= 2) {
      return pos + p.length;
    }
  }
  return pos;
}

/** @param {string} text @param {number} pos */
function attachPunct(text, pos) {
  while (pos < text.length) {
    const k = charKind(text[pos]);
    if (k === "stop" || k === "comma" || k === "close") {
      pos += 1;
      continue;
    }
    break;
  }
  return pos;
}

/**
 * @param {string[]} units
 * @returns {string[]}
 */
function mergeTiny(units) {
  /** @type {string[]} */
  const out = [];
  for (const u of units) {
    if (!u) continue;
    if (!out.length) {
      out.push(u);
      continue;
    }
    const prev = out[out.length - 1];
    if (/^[。．！？!?、，,…]+$/.test(u)) {
      out[out.length - 1] = prev + u;
    } else if (u.length === 1 && charKind(u) === "hira" && prev.length < MAX_UNIT) {
      // 孤立した「す。」などを前に結合
      out[out.length - 1] = prev + u;
    } else if (/^(す。|す|た。|た)$/.test(u) && /[でま]$/.test(prev)) {
      out[out.length - 1] = prev + u;
    } else {
      out.push(u);
    }
  }
  return out;
}
