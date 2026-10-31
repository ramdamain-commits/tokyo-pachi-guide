// 日付の補完。年なしの日付（月/日）に年を補い、基準日は日本時間で求める。
// 日付の生成は new Date(y, m-1, d) 形式で行い、new Date("YYYY-MM-DD")（UTC解釈）は使わない。

const pad = (n) => String(n).padStart(2, "0");

/** Date（ローカル）を YYYY-MM-DD にする */
function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD を [y, m, d] にする */
function parts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`日付の形式が不正: ${dateStr}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * 日本時間の今日（YYYY-MM-DD）。実行環境の TZ に頼らない。
 * @param {Date} [now]
 * @returns {string}
 */
export function jstToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

/**
 * 日付に n 日を足す（負なら引く）。
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} n
 * @returns {string}
 */
export function addDaysStr(dateStr, n) {
  const [y, m, d] = parts(dateStr);
  return fmt(new Date(y, m - 1, d + n));
}

/**
 * 月（YYYY-MM）を返す。
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string}
 */
export function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * 年なしの月日に年を補う。
 * - future: 基準日の60日前以降で最も近い日（予定一覧向け。基準日より少し前の日も今年として扱う）
 * - past: 基準日以前で最も近い日（実績表向け）
 * 存在しない日付（平年の 2/29 等）の年は候補から外す。
 * @param {number} month 1〜12
 * @param {number} day
 * @param {string} refDate 基準日 YYYY-MM-DD
 * @param {"future" | "past"} direction
 * @returns {string} YYYY-MM-DD
 */
export function inferYear(month, day, refDate, direction) {
  const [refY] = parts(refDate);
  const lowerBound = addDaysStr(refDate, -60);
  const candidates = [];
  for (let y = refY - 2; y <= refY + 2; y++) {
    const d = new Date(y, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) continue; // 存在しない日付
    candidates.push(fmt(d));
  }
  // YYYY-MM-DD は文字列比較で日付順になる
  if (direction === "future") {
    const ok = candidates.filter((c) => c >= lowerBound).sort();
    if (ok.length) return ok[0];
  } else if (direction === "past") {
    const ok = candidates.filter((c) => c <= refDate).sort();
    if (ok.length) return ok[ok.length - 1];
  } else {
    throw new Error(`direction が不正: ${direction}`);
  }
  throw new Error(`年を補えない: ${month}/${day} 基準 ${refDate}`);
}
