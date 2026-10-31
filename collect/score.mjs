// 熱さの点数。取材の強さ・店ごとの上振れ・店のにぎわい・同日の予定数から 0〜10 の点を出す。
// 欠けた要素は 0 点にせず、点数の分母からも外す。周年・「○のつく日」型の企画は加点しない。
import { matchRule } from "../match.mjs";

/** 要素ごとの点の式。順序がそのまま points / missing の並び順になる。 */
export const SCORE_PARTS = {
  mediaG: { max: 5, divisor: 150, min: 0 },
  mediaSamai: { max: 5, divisor: 25, min: -2 },
  venueG: { max: 5, divisor: 150, min: 0 },
  venueSamai: { max: 5, divisor: 25, min: -2 },
  busy: { max: 5 },
  overlap: { max: 3 },
};

const PART_NAMES = Object.keys(SCORE_PARTS);

/** 周年とみなす企画名 */
const ANNIVERSARY_RE = /周年|グランドオープン|創業|記念日/;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round1 = (x) => Math.round(x * 10) / 10;

/** 符号つきの数字（+640 / -12 / +0）。千単位は区切る。 */
function signed(n) {
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("en-US")}`;
}

/**
 * 熱さの点数を出す。
 * @param {object} input
 * @param {{basis: "title"|"media", g: {mean:number,n:number}|null, samai: {mean:number,n:number}|null} | null} input.strength
 * @param {{g: {mean:number,n:number}|null, samai: {mean:number,n:number}|null}} input.venueLift
 * @param {{pct: number|null, medianG: number|null} | null} input.busy
 * @param {number} input.overlapCount 同じ店・同じ日のほかの予定の数
 * @returns {{group: "rated"|"unrated", score: number, points: object, evidence: string[], missing: string[]}}
 */
export function scoreEvent({ strength, venueLift, busy, overlapCount }) {
  const s = strength ?? null;
  const v = venueLift ?? { g: null, samai: null };
  const b = busy ?? null;
  const media = s?.basis === "media" ? "同じ媒体" : "同じ企画";

  const points = {};
  const lines = {};
  const rawPart = (name, summary, label) => {
    const spec = SCORE_PARTS[name];
    if (!summary) return;
    points[name] = round1(clamp(summary.mean / spec.divisor, spec.min, spec.max));
    lines[name] = label(summary);
  };
  rawPart("mediaG", s?.g, (x) => `${media}の過去の開催: 通常日より平均G ${signed(x.mean)}（${x.n}回）`);
  rawPart("mediaSamai", s?.samai, (x) => `${media}の過去の開催: 通常日より差枚 ${signed(x.mean)}枚（${x.n}回）`);
  rawPart("venueG", v.g, (x) => `この店の過去のイベント日: 通常日より平均G ${signed(x.mean)}（${x.n}回）`);
  rawPart("venueSamai", v.samai, (x) => `この店の過去のイベント日: 通常日より差枚 ${signed(x.mean)}枚（${x.n}回）`);
  if (b && b.pct !== null && b.pct !== undefined) {
    points.busy = round1(SCORE_PARTS.busy.max * b.pct);
    lines.busy = `この店の普段の平均G ${Number(b.medianG).toLocaleString("en-US")}（東京の上位${Math.round((1 - b.pct) * 100)}%）`;
  }
  const overlap = Number.isFinite(overlapCount) ? Math.max(0, overlapCount) : 0;
  points.overlap = Math.min(overlap, SCORE_PARTS.overlap.max);
  lines.overlap = overlap === 0 ? "同日のほかの予定なし" : `同日にほか${overlap}件`;

  const ordered = {};
  const evidence = [];
  const missing = [];
  let sum = 0;
  let maxSum = 0;
  for (const name of PART_NAMES) {
    if (name in points) {
      ordered[name] = points[name];
      evidence.push(lines[name]);
      sum += points[name];
      maxSum += SCORE_PARTS[name].max;
    } else {
      ordered[name] = null;
      missing.push(name);
    }
  }

  const group = ordered.mediaG === null && ordered.mediaSamai === null ? "unrated" : "rated";
  return {
    group,
    score: clamp(round1((10 * sum) / maxSum), 0, 10),
    points: ordered,
    evidence,
    missing,
  };
}

/**
 * 周年のバッジを付けるか。企画名に周年を示す語がある、または店の annual ルールがその日に当たる。
 * @param {string} title
 * @param {string | Date} date "YYYY-MM-DD" または Date
 * @param {object[]} [storeRules] stores.json の店の rules
 * @returns {boolean}
 */
export function isAnniversary(title, date, storeRules) {
  if (ANNIVERSARY_RE.test(title || "")) return true;
  const d =
    typeof date === "string"
      ? (([y, m, day]) => new Date(y, m - 1, day))(date.split("-").map(Number))
      : date;
  return (storeRules || []).some((rule) => rule.type === "annual" && matchRule(rule, d));
}
