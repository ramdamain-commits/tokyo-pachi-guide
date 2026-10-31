// 熱いイベントの収集本体。DMM ぱちタウンの予定とみんレポの日別実績をつなぎ、
// 店の対応表・店の実績・取材の強さ・月ファイルを作る。
// 実行: node scripts/collect-events.mjs [--dry-run] [--today=YYYY-MM-DD]
//   --dry-run は _staging/collect/ に書き、data/ には触れない（前回データの読み込みは data/ から）。
// 失敗時（DMM が取れない・検証エラー・みんレポ対応率の急落）は何も書かず、終了コード1で終える。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFetcher, FetchError } from "../collect/http.mjs";
import { jstToday, addDaysStr, monthOf } from "../collect/dates.mjs";
import { parseDmmSchedulePage, dedupeDmmEvents } from "../collect/dmm.mjs";
import { minrepoCategoryUrl, minrepoTagUrl, parseMinrepoCategory, parseMinrepoStorePage } from "../collect/minrepo.mjs";
import { parseRuleText } from "../collect/rule-text.mjs";
import { buildVenues } from "../collect/venues.mjs";
import {
  baseline as computeBaseline,
  ruleEffects as computeRuleEffects,
  outcomeOf,
  strengthTable,
  pickStrength,
  venueLift,
  busyPercentiles,
} from "../collect/stats.mjs";
import { scoreEvent, isAnniversary } from "../collect/score.mjs";
import { mergeMonth, frozenEvents } from "../collect/merge.mjs";
import { validateEventsData } from "../validate-events.mjs";

const DMM_URL = "https://p-town.dmm.com/schedules/tokyo";
const dmmUrl = (page) => (page <= 1 ? DMM_URL : `${DMM_URL}?page=${page}`);
const dmmShopUrl = (id) => `https://p-town.dmm.com/shops/tokyo/${id}`;
/** DMM 一覧を読むページ数の上限（リンクの読み違いで際限なく取りに行かないための安全弁） */
const MAX_DMM_PAGES = 100;
/** みんレポのカテゴリ一覧を読むページ数の上限 */
const MAX_CATEGORY_PAGES = 10;
/** 店ページを取り直す基準。baseline の取得日がこれより古い店は取り直す */
const BASELINE_MAX_AGE_DAYS = 7;
/** 結果待ち（outcome が null の過去日イベント）のために店ページを取り直す期間。これより古い日は追わない */
const PENDING_LOOKBACK_DAYS = 30;
/** 対応率がこれ以上下がったら失敗 */
const RATE_DROP_LIMIT = 0.3;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** 日本時間の ISO 文字列（2026-11-01T09:04:00+09:00） */
function jstIso(now) {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `${s.replace(" ", "T")}+09:00`;
}

/** 月（YYYY-MM）に n か月足す */
function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** 翌月末の日付（今日から翌月末までを予定の対象にする） */
function endOfNextMonth(today) {
  return addDaysStr(`${addMonths(monthOf(today), 2)}-01`, -1);
}

/**
 * 収集を1回行う。
 * @param {object} args
 * @param {{ get: (url: string) => Promise<{ status: number, text: string }> }} args.fetcher
 * @param {string} [args.today] 基準日 YYYY-MM-DD（JST）。省略時は jstToday()
 * @param {Date} [args.now] 生成時刻
 * @param {(rel: string) => Promise<any> | any} args.readJson data/ からの相対パス → 中身（無ければ null）
 * @param {(rel: string, obj: any) => Promise<void> | void} args.writeJson 書き出し先の相対パス → 中身
 * @param {(msg: string) => void} [args.log]
 * @returns {Promise<{ ok: boolean, reasons: string[], counts: object }>}
 */
export async function runCollect({ fetcher, today = jstToday(), now = new Date(), readJson, writeJson, log = () => {} }) {
  const counts = { events: 0, history: 0, venues: 0, minrepoFetched: 0 };
  const fail = (...reasons) => ({ ok: false, reasons, counts });

  // 同じ URL は1回の実行で1度しか取らない（呼び出し側の取得器にキャッシュがあっても、ここで保証する）
  const memo = new Map();
  const get = (url) => {
    if (!memo.has(url)) memo.set(url, fetcher.get(url));
    return memo.get(url);
  };

  // 1. 前回データ
  const prevMeta = await readJson("collect-meta.json");
  const prevMonths = Array.isArray(prevMeta?.months) ? prevMeta.months : [];
  /** @type {Record<string, any>} */
  const prevFiles = {};
  for (const m of prevMonths) {
    const f = await readJson(`events/${m}.json`);
    // 月ファイルが欠けたまま進むと、その月の凍結イベントと履歴が静かに消える
    if (!f) return fail(`collect-meta.json の months にある ${m} の月ファイル（events/${m}.json）が無い`);
    prevFiles[m] = f;
  }
  const prevVenues = (await readJson("venues.json"))?.venues ?? {};
  const prevStats = (await readJson("store-stats.json"))?.stats ?? {};
  const storesFile = await readJson("stores.json");
  if (!Array.isArray(storesFile?.stores)) return fail("stores.json を読めない");
  const stores = storesFile.stores;
  const prevEvents = Object.values(prevFiles).flatMap((f) => f.events ?? []);

  // 2. DMM 予定一覧
  const windowEnd = endOfNextMonth(today);
  const dmmAll = [];
  let parsedTotal = 0;
  let dmmLast = null;
  for (let page = 1; page <= (dmmLast ?? 1); page++) {
    if (page > MAX_DMM_PAGES) {
      log(`DMM 一覧: ${MAX_DMM_PAGES} ページで打ち切り`);
      break;
    }
    let res;
    try {
      res = await get(dmmUrl(page));
    } catch (e) {
      if (e instanceof FetchError) return fail(`DMM 一覧 ${page} ページ目を取得できない: ${e.message}`);
      throw e;
    }
    if (res.status !== 200) return fail(`DMM 一覧 ${page} ページ目が HTTP ${res.status}`);
    const parsed = parseDmmSchedulePage(res.text);
    const liCount = (res.text.match(/<li class="unit\b/g) ?? []).length;
    log(`DMM ${page}ページ目: li ${liCount}件 / 解析 ${parsed.events.length}件（差 ${liCount - parsed.events.length}件）`);
    parsedTotal += parsed.events.length;
    dmmAll.push(...parsed.events);
    if (parsed.lastPage !== null && (dmmLast === null || parsed.lastPage > dmmLast)) dmmLast = parsed.lastPage;
  }
  if (parsedTotal === 0) return fail("DMM 一覧から予定を1件も解析できなかった");
  const dmmEvents = dedupeDmmEvents(dmmAll.filter((e) => e.date >= today && e.date <= windowEnd));
  if (dmmEvents.length === 0) return fail(`DMM 一覧に ${today} 〜 ${windowEnd} の予定が1件も無い`);

  // 3. みんレポのカテゴリ（東京都）→ 店の対応表
  const minrepoTags = [];
  let categoryLast = null;
  for (let page = 1; page <= (categoryLast ?? MAX_CATEGORY_PAGES) && page <= MAX_CATEGORY_PAGES; page++) {
    let res;
    try {
      res = await get(minrepoCategoryUrl(page));
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      if (page === 1) return fail(`みんレポのカテゴリ 1 ページ目を取得できない: ${e.message}`);
      log(`みんレポのカテゴリ ${page} ページ目を取得できない（読み飛ばす）: ${e.message}`);
      continue;
    }
    if (res.status !== 200) {
      if (page === 1) return fail(`みんレポのカテゴリ 1 ページ目が HTTP ${res.status}`);
      break; // 最終ページを過ぎた
    }
    const parsed = parseMinrepoCategory(res.text);
    if (page === 1) categoryLast = parsed.lastPage;
    minrepoTags.push(...parsed.tags);
  }
  const { venues } = buildVenues({ dmmEvents, minrepoTags, stores, previous: prevVenues });
  counts.venues = Object.keys(venues).length;

  const currentKeys = [...new Set(dmmEvents.map((e) => `dmm:${e.dmmShopId}`))];
  const matched = currentKeys.filter((k) => venues[k]?.minrepoTag != null).length;
  const rate = Math.round((matched / currentKeys.length) * 1000) / 1000;

  // 4. みんレポの店ページを取る店 = 今回の予定がある店 ∪ 結果待ちの過去日イベントがある店
  const pendingKeys = new Set(
    prevEvents
      .filter((e) => e.date < today && e.date >= addDaysStr(today, -PENDING_LOOKBACK_DAYS) && e.outcome == null)
      .map((e) => e.venue),
  );
  const staleBefore = addDaysStr(today, -BASELINE_MAX_AGE_DAYS);
  const targets = [...new Set([...currentKeys, ...pendingKeys])].filter((k) => {
    if (!venues[k]?.minrepoTag) return false;
    const checkedAt = prevStats[k]?.baseline?.checkedAt;
    // 基準が新しくても、結果待ちの店は日別実績が要るので取り直す（日別実績は保存しないため）
    return pendingKeys.has(k) || !checkedAt || checkedAt < staleBefore;
  });

  /** @type {Map<string, { baseline: object | null, ruleEffects: object[] }>} 今回計算し直した店 */
  const computed = new Map();
  /** @type {Map<string, { days: object[], base: object | null }>} 結果の計算に使う日別実績（保存しない） */
  const dailyByVenue = new Map();
  let done = 0;
  for (const key of targets) {
    done++;
    if (done % 25 === 0) log(`みんレポ店ページ ${done}/${targets.length}`);
    const venue = venues[key];
    const url = minrepoTagUrl(venue.minrepoTag);
    let res;
    try {
      res = await get(url);
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      log(`みんレポ店ページを取得できない（前回値で続ける）: ${venue.minrepoTag} ${e.message}`);
      continue;
    }
    if (res.status !== 200) {
      log(`みんレポ店ページが見つからない（HTTP ${res.status}・前回値で続ける）: ${venue.minrepoTag}`);
      continue;
    }
    counts.minrepoFetched++;
    const page = parseMinrepoStorePage(res.text, today);
    if (page.days.length === 0) {
      log(`みんレポ ${venue.minrepoTag}: 日別実績の表を読めなかった（見出しの構造が変わった可能性）。baseline は作らず前回値を使う`);
      continue;
    }
    const store = venue.storeId ? stores.find((s) => s.id === venue.storeId) : null;
    const rules = store ? (store.rules ?? []) : parseRuleText(page.ruleText).rules;
    const eventDates = new Set([
      ...prevEvents.filter((e) => e.venue === key).map((e) => e.date),
      ...dmmEvents.filter((e) => `dmm:${e.dmmShopId}` === key).map((e) => e.date),
    ]);
    const base = computeBaseline(page.days, eventDates, rules);
    if (base) {
      computed.set(key, {
        baseline: { ...base, sourceUrl: url, checkedAt: today },
        ruleEffects: computeRuleEffects(page.days, rules, base),
      });
    } else {
      log(`みんレポ ${venue.minrepoTag}: 通常日が足りず baseline を作れない（前回値を使う）`);
    }
    dailyByVenue.set(key, { days: page.days, base: base ?? prevStats[key]?.baseline ?? null });
  }

  // 6. 結果待ちの過去日イベントに outcome を当てる
  /** @type {Map<string, { g: number, samai: number | null }>} */
  const outcomes = new Map();
  for (const e of prevEvents) {
    if (!(e.date < today) || e.outcome != null) continue;
    const daily = dailyByVenue.get(e.venue);
    if (!daily) continue;
    const o = outcomeOf(daily.days, e.date, daily.base);
    if (o) outcomes.set(e.id, o);
  }

  // 7. 履歴 → 取材の強さ・店ごとの上振れ・にぎわいの順位
  const history = Object.values(prevFiles)
    .flatMap((f) => frozenEvents(f, today, outcomes))
    .filter((e) => e.outcome != null);
  counts.history = history.length;
  const table = strengthTable(history);
  const mediaStrength = { computedAt: today, entries: Object.entries(table).map(([key, v]) => ({ key, g: v.g, samai: v.samai })) };

  const baselines = {};
  for (const key of Object.keys(venues)) {
    baselines[key] = computed.get(key)?.baseline ?? prevStats[key]?.baseline ?? null;
  }
  const busy = busyPercentiles(baselines);
  const stats = {};
  for (const key of Object.keys(venues)) {
    stats[key] = {
      baseline: baselines[key],
      busyPct: busy[key] ?? null,
      ruleEffects: computed.get(key)?.ruleEffects ?? prevStats[key]?.ruleEffects ?? [],
      lift: venueLift(history, key),
    };
  }

  // 8. 今回のイベントに点数をつける
  const perDay = new Map();
  for (const e of dmmEvents) {
    const k = `dmm:${e.dmmShopId}|${e.date}`;
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const fresh = dmmEvents.map((e) => {
    const key = `dmm:${e.dmmShopId}`;
    const st = stats[key];
    const medianG = st.baseline?.medianG;
    // pct と medianG は両方そろったときだけ渡す（片方だけの状態を作らない）
    const busyInput = isNum(st.busyPct) && isNum(medianG) ? { pct: st.busyPct, medianG } : null;
    const scored = scoreEvent({
      strength: pickStrength(table, e.title, e.media),
      venueLift: st.lift,
      busy: busyInput,
      overlapCount: perDay.get(`${key}|${e.date}`) - 1,
    });
    const store = venues[key].storeId ? stores.find((s) => s.id === venues[key].storeId) : null;
    const sources = [{ url: dmmShopUrl(e.dmmShopId), checkedAt: today }];
    if (st.baseline) sources.push({ url: st.baseline.sourceUrl, checkedAt: st.baseline.checkedAt });
    return {
      id: `${e.date}|${key}|${e.media ?? ""}|${e.title}`,
      date: e.date,
      venue: key,
      media: e.media,
      title: e.title,
      anniversary: isAnniversary(e.title, e.date, store?.rules),
      group: scored.group,
      score: scored.score,
      points: scored.points,
      evidence: scored.evidence,
      missing: scored.missing,
      frozen: false,
      outcome: null,
      sources,
    };
  });
  counts.events = fresh.length;

  // 9. 月ファイル
  const generatedAt = jstIso(now);
  const monthKeys = [...new Set([...prevMonths, monthOf(today), addMonths(monthOf(today), 1)])].sort();
  const monthFiles = {};
  for (const m of monthKeys) monthFiles[m] = mergeMonth(prevFiles[m] ?? null, fresh, today, m, outcomes, generatedAt);

  const { errors, warnings } = validateEventsData({ venues, storeStats: stats, months: monthFiles });
  warnings.forEach((w) => log(`警告: ${w}`));

  // 10. 失敗の判定
  const reasons = [];
  if (errors.length > 0) {
    reasons.push(`検証エラー ${errors.length}件: ${errors.slice(0, 5).join(" / ")}`);
  }
  const prevRate = prevMeta?.rates?.minrepoMatched;
  if (isNum(prevRate) && prevRate - rate >= RATE_DROP_LIMIT - 1e-9) {
    reasons.push(`みんレポ対応率が前回 ${prevRate} から ${rate} に ${RATE_DROP_LIMIT} 以上下がった`);
  }
  if (reasons.length > 0) return fail(...reasons);

  // 11. 書き出し（collect-meta は最後。これが新しければ全ファイルがそろっている）
  await writeJson("venues.json", { updated: today, venues });
  await writeJson("media-strength.json", mediaStrength);
  await writeJson("store-stats.json", { updated: today, stats });
  for (const m of monthKeys) await writeJson(`events/${m}.json`, monthFiles[m]);
  await writeJson("collect-meta.json", {
    lastSuccessAt: generatedAt,
    months: monthKeys,
    rates: { minrepoMatched: rate },
    counts: { events: counts.events, history: counts.history },
  });
  return { ok: true, reasons: [], counts };
}

// ---- CLI ----

/** YYYY-MM-DD の形で、かつ実在する日付か（new Date("YYYY-MM-DD") は使わない） */
function isRealDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** CLI の引数を読む。不正なら Error を投げる */
export function parseArgs(argv) {
  const args = { dryRun: false, today: null };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--today=")) args.today = a.slice("--today=".length);
    else throw new Error(`知らない引数: ${a}`);
  }
  if (args.today !== null && !isRealDate(args.today)) {
    throw new Error(`--today は YYYY-MM-DD の実在日で指定する: ${args.today}`);
  }
  return args;
}

async function main() {
  const { dryRun, today } = parseArgs(process.argv.slice(2));
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dataDir = path.join(root, "data");
  const outDir = dryRun ? path.join(root, "_staging", "collect") : dataDir;

  const readJson = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, rel), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  const writeJson = (rel, obj) => {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(`${p}.tmp`, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
    fs.renameSync(`${p}.tmp`, p);
  };

  const result = await runCollect({
    fetcher: createFetcher(),
    today: today ?? jstToday(),
    readJson,
    writeJson,
    log: (m) => console.log(m),
  });
  if (!result.ok) {
    result.reasons.forEach((r) => console.error(`失敗: ${r}`));
    process.exitCode = 1;
    return;
  }
  console.log(`成功${dryRun ? "（dry-run: " + outDir + " に書き出し）" : ""}: ${JSON.stringify(result.counts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`失敗: ${e?.stack ?? e}`);
    process.exitCode = 1;
  });
}
