// 店の統計。みんレポの日別実績から「通常日の基準」「特定日の実効性」「イベントの結果」を計算し、
// 凍結済みの履歴から「取材の強さ」「店ごとの上振れ」「店の普段のにぎわいの順位」を求める。
// 日別実績そのものは保存しない（呼び出し側が計算結果だけを残す）。
import { matchRule, ruleLabel } from "../match.mjs";

/** 基準に必要な最小日数 */
const MIN_BASE_DAYS = 10;
/** 特定日ルールの実効性を出すのに必要な最小日数 */
const MIN_RULE_DAYS = 3;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** -0 を 0 にそろえて四捨五入する（deepEqual で -0 と 0 が別物になるのを避ける）。 */
function roundInt(x) {
  return Math.round(x) + 0;
}

/** 中央値。偶数個なら中央2つの平均。空配列は null。 */
function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** "YYYY-MM-DD" を new Date(y, m-1, d) で Date にする（UTC 解釈を避ける）。 */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** どれかのルールに当たる日か。 */
function matchesAny(rules, date) {
  return (rules || []).some((rule) => matchRule(rule, date));
}

/**
 * 通常日（excludeDates に無く、どの rules にも当たらない日）から店の基準を求める。
 * avgG が数値の日が 10 日未満なら全体を null。avgSamai が 10 日未満なら medianSamai だけ null。
 * @param {{date: string, avgG: number|null, avgSamai: number|null}[]} days
 * @param {Set<string>} excludeDates イベント日（履歴・予定）
 * @param {object[]} rules 旧イベント日の特定日ルール
 * @returns {{medianG: number, medianSamai: number|null, daysG: number, daysSamai: number} | null}
 */
export function baseline(days, excludeDates, rules) {
  const normal = (days || []).filter(
    (d) => !excludeDates.has(d.date) && !matchesAny(rules, parseDate(d.date)),
  );
  const gs = normal.map((d) => d.avgG).filter(isNum);
  const ss = normal.map((d) => d.avgSamai).filter(isNum);
  if (gs.length < MIN_BASE_DAYS) return null;
  return {
    medianG: roundInt(median(gs)),
    medianSamai: ss.length < MIN_BASE_DAYS ? null : roundInt(median(ss)),
    daysG: gs.length,
    daysSamai: ss.length,
  };
}

/**
 * ルールごとの「当たる日の平均差枚 − 基準の差枚中央値」。当たる日（avgSamai が数値）が 3 日未満のルールは出さない。
 * @param {{date: string, avgSamai: number|null}[]} days
 * @param {object[]} rules
 * @param {{medianSamai: number|null} | null} base
 * @param {(rule: object) => string} [labelOf]
 * @returns {{label: string, diff: number, days: number}[]}
 */
export function ruleEffects(days, rules, base, labelOf = ruleLabel) {
  if (!base || !isNum(base.medianSamai)) return [];
  const out = [];
  for (const rule of rules || []) {
    const vals = [];
    for (const d of days || []) {
      if (isNum(d.avgSamai) && matchRule(rule, parseDate(d.date))) vals.push(d.avgSamai);
    }
    if (vals.length < MIN_RULE_DAYS) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    out.push({ label: labelOf(rule), diff: roundInt(mean - base.medianSamai), days: vals.length });
  }
  return out;
}

/**
 * その日の結果（店の基準との差）。行が無い・avgG が null・基準が無いときは null。
 * samai は avgSamai と medianSamai の両方が数値のときだけ。
 * @returns {{g: number, samai: number|null} | null}
 */
export function outcomeOf(days, date, base) {
  if (!base || !isNum(base.medianG)) return null;
  const row = (days || []).find((d) => d.date === date);
  if (!row || !isNum(row.avgG)) return null;
  return {
    g: row.avgG - base.medianG,
    samai: isNum(row.avgSamai) && isNum(base.medianSamai) ? row.avgSamai - base.medianSamai : null,
  };
}

/**
 * 値の平均（四捨五入の整数）と件数。件数が minN 未満（または 0）なら null。
 * @param {number[]} values
 * @param {number} minN
 * @returns {{mean: number, n: number} | null}
 */
export function summarize(values, minN) {
  const n = values.length;
  if (n === 0 || n < minN) return null;
  return { mean: roundInt(values.reduce((a, b) => a + b, 0) / n), n };
}

/** outcome の g と samai をそれぞれ集めて summarize する。 */
function summarizeOutcomes(events, minN) {
  const gs = [];
  const ss = [];
  for (const e of events) {
    if (isNum(e.outcome.g)) gs.push(e.outcome.g);
    if (isNum(e.outcome.samai)) ss.push(e.outcome.samai);
  }
  return { g: summarize(gs, minN), samai: summarize(ss, minN) };
}

/**
 * 履歴（outcome を持つ凍結イベント）を "t:<企画名>" と "m:<媒体名>" に集める。各 3 件未満は null。
 * @param {object[]} historyEvents
 * @returns {Record<string, {g: object|null, samai: object|null}>}
 */
export function strengthTable(historyEvents) {
  const groups = new Map();
  const add = (key, e) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  };
  for (const e of historyEvents || []) {
    if (!e.outcome) continue;
    add(`t:${e.title}`, e);
    if (e.media) add(`m:${e.media}`, e);
  }
  const table = {};
  for (const [key, evs] of groups) table[key] = summarizeOutcomes(evs, 3);
  return table;
}

/**
 * 企画名の強さを優先し、足りなければ媒体の強さを使う。どちらも無ければ null。
 * @returns {{basis: "title"|"media", g: object|null, samai: object|null} | null}
 */
export function pickStrength(table, title, media) {
  const t = table[`t:${title}`];
  if (t && (t.g !== null || t.samai !== null)) return { basis: "title", g: t.g, samai: t.samai };
  const m = media ? table[`m:${media}`] : undefined;
  if (m) return { basis: "media", g: m.g, samai: m.samai };
  return null;
}

/**
 * その店の履歴の結果をまとめた「店ごとの上振れ」。各 2 件未満は null。
 * @returns {{g: object|null, samai: object|null}}
 */
export function venueLift(historyEvents, venueKey) {
  const evs = (historyEvents || []).filter((e) => e.venue === venueKey && e.outcome);
  return summarizeOutcomes(evs, 2);
}

/**
 * 店の普段のにぎわいの順位（0〜1）。自分より medianG が小さい店の数 /（比べられる店の数 − 1）。
 * 比べられる店が 1 つ以下、または baseline が null の店は null。
 * @param {Record<string, {medianG: number} | null>} baselines
 * @returns {Record<string, number|null>}
 */
export function busyPercentiles(baselines) {
  const entries = Object.entries(baselines);
  const gs = entries.filter(([, b]) => b && isNum(b.medianG)).map(([, b]) => b.medianG);
  const out = {};
  for (const [key, b] of entries) {
    if (!b || !isNum(b.medianG) || gs.length < 2) {
      out[key] = null;
      continue;
    }
    out[key] = gs.filter((g) => g < b.medianG).length / (gs.length - 1);
  }
  return out;
}
