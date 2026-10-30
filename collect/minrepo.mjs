// みんレポの解析。カテゴリ一覧（東京都）から店の tag 名を集め、店ページから
// 「旧イベント日」の文言と「データ一覧」の日別実績を取り出す。HTML は正規表現と文字列処理で読む。
// 日別実績そのものは保存しない（呼び出し側が計算結果だけを残す）。
import { inferYear } from "./dates.mjs";

const BASE = "https://min-repo.com";
const CATEGORY_PATH = "category/%e6%9d%b1%e4%ba%ac%e9%83%bd"; // 東京都

/**
 * カテゴリ一覧（東京都）の URL。
 * @param {number} page 1始まり
 * @returns {string}
 */
export function minrepoCategoryUrl(page) {
  return page <= 1 ? `${BASE}/${CATEGORY_PATH}/` : `${BASE}/${CATEGORY_PATH}/page/${page}/`;
}

/**
 * 店ページ（tag ページ）の URL。%表記は小文字にそろえる（みんレポの URL の形）。
 * @param {string} tag
 * @returns {string}
 */
export function minrepoTagUrl(tag) {
  return `${BASE}/tag/${encodeURIComponent(tag).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())}/`;
}

/**
 * カテゴリ一覧ページから店の tag 名と最終ページ番号を取り出す。
 * @param {string} html
 * @returns {{ tags: string[], lastPage: number | null }}
 */
export function parseMinrepoCategory(html) {
  const tags = [];
  const seen = new Set();
  for (const m of html.matchAll(/href="https:\/\/min-repo\.com\/tag\/([^"/?#]+)\/?[^"]*"/g)) {
    let name;
    try {
      name = decodeURIComponent(m[1]);
    } catch {
      continue; // 壊れた %表記は読み飛ばす
    }
    if (!seen.has(name)) {
      seen.add(name);
      tags.push(name);
    }
  }

  let lastPage = null;
  const pages = /class=['"]pages['"][^>]*>\s*\d+\s*\/\s*(\d+)\s*</.exec(html);
  if (pages) {
    lastPage = Number(pages[1]);
  } else {
    const nums = [...html.matchAll(/category\/%e6%9d%b1%e4%ba%ac%e9%83%bd\/page\/(\d+)\//g)].map((m) => Number(m[1]));
    if (nums.length) lastPage = Math.max(...nums);
  }
  return { tags, lastPage };
}

/** HTML タグを除いて空白をそろえる */
function plainText(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 「旧イベント日」の行の文言。注記（※追加・修正…）は除く。無ければ null。
 * @param {string} html
 * @returns {string | null}
 */
function extractRuleText(html) {
  const m = /<th[^>]*>\s*旧イベント日\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(html);
  if (!m) return null;
  const text = plainText(m[1].replace(/<br\s*\/?>/g, " ")).split("※")[0].trim();
  return text || null;
}

/**
 * 数値セルを数にする。カンマ区切り・符号つきの数字だけを数にし、'-'・空・その他は null（欠測を0で埋めない）。
 * @param {string} cellHtml
 * @returns {number | null}
 */
function parseNumberCell(cellHtml) {
  const s = plainText(cellHtml).replace(/,/g, "");
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/**
 * 店ページから旧イベント日の文言と日別実績を取り出す。
 * 日別実績は「データ一覧」の見出しより後の最初の表だけを読む（上下のランキング表は拾わない）。
 * 表は新しい順に並ぶので、1行目を基準日以前で最も近い年に補い、以降は前の行より新しくならないように年を決める。
 * @param {string} html
 * @param {string} refDate 基準日 YYYY-MM-DD（JST）
 * @returns {{ ruleText: string | null, days: { date: string, totalSamai: number | null, avgSamai: number | null, avgG: number | null }[] }}
 */
export function parseMinrepoStorePage(html, refDate) {
  const ruleText = extractRuleText(html);
  const days = [];

  const head = /<h2[^>]*>[^<]*データ一覧\s*<\/h2>/.exec(html);
  if (!head) return { ruleText, days };
  const rest = html.slice(head.index + head[0].length);
  const start = rest.indexOf("<table");
  if (start < 0) return { ruleText, days };
  const end = rest.indexOf("</table>", start);
  const table = rest.slice(start, end < 0 ? undefined : end);

  let prev = null; // 直前に読んだ行の日付。次の行はこれ以前になる
  for (const row of table.split(/<tr[\s>]/).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 4) continue; // 見出し行など
    const dm = /<a [^>]*>\s*(\d{1,2})\/(\d{1,2})(?:[(（][^)）]*[)）])?\s*<\/a>/.exec(cells[0]);
    if (!dm) continue;
    let date;
    try {
      date = inferYear(Number(dm[1]), Number(dm[2]), prev ?? refDate, "past");
    } catch {
      continue; // 存在しない日付など
    }
    prev = date;
    days.push({
      date,
      totalSamai: parseNumberCell(cells[1]),
      avgSamai: parseNumberCell(cells[2]),
      avgG: parseNumberCell(cells[3]),
    });
  }
  return { ruleText, days };
}
