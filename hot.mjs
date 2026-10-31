// 熱いイベントタブ用の絞り込み・並べ替え（ビューワ側）。app.js から import する。
// 日付は "YYYY-MM-DD" 文字列で受け取り、new Date("YYYY-MM-DD")（UTC解釈）は使わない。

/** 最終更新からこの日数を超えたら古いデータとして警告する */
const STALE_DAYS = 35;

/** missing の要素名 → 画面に出す日本語名 */
const MISSING_LABELS = {
  mediaG: "企画の過去の開催",
  mediaSamai: "企画の過去の開催",
  venueG: "この店の過去のイベント日",
  venueSamai: "この店の過去のイベント日",
  busy: "この店の普段のにぎわい",
};

/**
 * "YYYY-MM-DD"（先頭10文字）を、実行環境のタイムゾーンに依らない通し日数へ変換する。
 * 読めなければ NaN。
 */
function dayNumber(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ""));
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Date.UTC(y, mo - 1, d) / 86400000;
}

/**
 * 今日以降 days 日以内（days が null なら全件）の予定を、rated / unrated に分けて返す。
 * rated は score の高い順（同点は日付の早い順）、unrated は日付の早い順（同日は score の高い順）。
 * limit は rated と unrated それぞれに掛け、total は絞り込み後（limit 前）の件数。
 * area を指定するときは venues（venueキー → 店）が必要。引けない店の予定は除く。
 * @param {object[]} events
 * @param {{ today: string, days?: number|null, limit?: number, area?: string|null, venues?: object }} opts
 * @returns {{ rated: object[], unrated: object[], total: number }}
 */
export function selectHotEvents(events, { today, days = 7, limit = 30, area = null, venues = {} }) {
  const start = dayNumber(today);
  const inRange = (events || []).filter((e) => {
    const n = dayNumber(e.date);
    if (Number.isNaN(n) || n < start) return false;
    if (days !== null && n > start + days) return false;
    if (area !== null && venues?.[e.venue]?.area !== area) return false;
    return true;
  });
  const byDate = (a, b) => dayNumber(a.date) - dayNumber(b.date);
  const rated = inRange
    .filter((e) => e.group === "rated")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || byDate(a, b));
  const unrated = inRange
    .filter((e) => e.group !== "rated")
    .sort((a, b) => byDate(a, b) || (b.score ?? 0) - (a.score ?? 0));
  return {
    rated: rated.slice(0, limit),
    unrated: unrated.slice(0, limit),
    total: inRange.length,
  };
}

/**
 * 今日以降 days 日以内（days が null なら全件）の予定を、点数に関係なく日付の早い順に並べる。
 * みんレポを取っていない回（点数なし）の一覧用。同日は「同じ店のその日の予定数」が多い店が先、同数なら店名順。
 * limit は並べた後に掛け、total は絞り込み後（limit 前）の件数。
 * area を指定するときは venues（venueキー → 店）が必要。引けない店の予定は除く。
 * @param {object[]} events
 * @param {{ today: string, days?: number|null, limit?: number, area?: string|null, venues?: object }} opts
 * @returns {{ events: object[], total: number }}
 */
export function selectUpcomingEvents(events, { today, days = 7, limit = 30, area = null, venues = {} }) {
  const start = dayNumber(today);
  const inRange = (events || []).filter((e) => {
    const n = dayNumber(e.date);
    if (Number.isNaN(n) || n < start) return false;
    if (days !== null && n > start + days) return false;
    if (area !== null && venues?.[e.venue]?.area !== area) return false;
    return true;
  });
  const perVenueDay = new Map();
  for (const e of inRange) {
    const k = `${e.venue}|${e.date}`;
    perVenueDay.set(k, (perVenueDay.get(k) ?? 0) + 1);
  }
  const countOf = (e) => perVenueDay.get(`${e.venue}|${e.date}`);
  const nameOf = (e) => venues?.[e.venue]?.name ?? "";
  const sorted = [...inRange].sort(
    (a, b) =>
      dayNumber(a.date) - dayNumber(b.date) ||
      countOf(b) - countOf(a) ||
      nameOf(a).localeCompare(nameOf(b), "ja") ||
      String(a.venue).localeCompare(String(b.venue)),
  );
  return { events: sorted.slice(0, limit), total: inRange.length };
}

/**
 * みんレポも取った回のデータか（collect-meta の sources に minrepo がある）。
 * sources が無い・壊れているときは false（点数は出さず、日付順の一覧にする）。
 * @param {{ sources?: unknown }|null|undefined} meta
 * @returns {boolean}
 */
export function usesMinrepo(meta) {
  return Array.isArray(meta?.sources) && meta.sources.includes("minrepo");
}

/**
 * みんレポの店タグページの URL。collect/minrepo.mjs の minrepoTagUrl と同じ形
 * （%表記は小文字。ビューワはその収集コードを読み込まないので同じ関数をここに置く）。
 * @param {string} tag
 * @returns {string}
 */
export function minrepoTagUrl(tag) {
  return `https://min-repo.com/tag/${encodeURIComponent(tag).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())}/`;
}

/**
 * 「みんレポで見る」リンクの URL。minrepoTag があればタグページ、無ければ店名のサイト内検索。
 * 店名もタグも無くリンクを作れないときは null。href に入れる前に safeUrl を通すこと。
 * @param {{ name?: string, minrepoTag?: string|null }|null|undefined} venue
 * @returns {string|null}
 */
export function minrepoLink(venue) {
  if (venue?.minrepoTag) return minrepoTagUrl(venue.minrepoTag);
  if (venue?.name) return `https://min-repo.com/?s=${encodeURIComponent(venue.name)}`;
  return null;
}

/**
 * 最終成功日（ISO文字列でも日付文字列でもよい）から today までの日数と、古いかどうか。
 * 読めない値は stale 扱い（days は NaN）。
 * @param {string} lastSuccessAt
 * @param {string} today "YYYY-MM-DD"
 * @returns {{ days: number, stale: boolean }}
 */
export function staleness(lastSuccessAt, today) {
  const days = dayNumber(today) - dayNumber(lastSuccessAt);
  if (Number.isNaN(days)) return { days: NaN, stale: true };
  return { days, stale: days > STALE_DAYS };
}

/**
 * 特定日の実効性の表示文。例: 通常日比 +18枚（9日）
 * diff が数値でない（欠測）ときは 0 で埋めず null を返す（呼び出し側はバッジを付けない）。
 * days が数値でないときは「（N日）」を省く。
 * @param {{ diff: number, days?: number }} effect
 * @returns {string|null}
 */
export function ruleEffectLabel(effect) {
  if (!Number.isFinite(effect?.diff)) return null;
  const diff = Math.round(effect.diff);
  const signed = diff > 0 ? `+${diff}` : diff < 0 ? `-${Math.abs(diff)}` : "±0";
  const span = Number.isFinite(effect.days) ? `（${effect.days}日）` : "";
  return `通常日比 ${signed}枚${span}`;
}

/**
 * innerHTML に入れる前のエスケープ（自動収集データ用）。
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * href に入れてよい URL だけをエスケープして返す。許可は http(s) のみで、
 * スキームの大文字小文字は区別しない（HTTP://… は通す）。先頭の空白は取り除かず、通さない。
 * 通さないときは空文字（リンクを出さない）。
 * @param {unknown} url
 * @returns {string}
 */
export function safeUrl(url) {
  return /^https?:\/\//i.test(String(url ?? "")) ? esc(url) : "";
}

/**
 * missing（欠測の要素名）を画面用の日本語名にする。同じ名前は1回だけ。
 * 未知の要素名はそのまま残す（黙って捨てない）。
 * @param {string[]|undefined} missing
 * @returns {string[]}
 */
export function missingLabels(missing) {
  const out = [];
  for (const key of missing || []) {
    const label = MISSING_LABELS[key] ?? key;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * 絞り込みの選択肢。予定がある店のエリアだけを、areaOrder の順 → 残りは五十音順で返す。
 * @param {object[]} events
 * @param {object} venues venueキー → 店
 * @param {string[]} areaOrder
 * @returns {string[]}
 */
export function areaOptions(events, venues, areaOrder) {
  const present = new Set();
  for (const e of events || []) {
    const area = venues?.[e.venue]?.area;
    if (area) present.add(area);
  }
  const ordered = areaOrder.filter((a) => present.has(a));
  const rest = [...present]
    .filter((a) => !areaOrder.includes(a))
    .sort((a, b) => a.localeCompare(b, "ja"));
  return [...ordered, ...rest];
}

/**
 * stores.json の店 id → (特定日ルールのラベル → { label, diff, days }) の索引。
 * venues の storeId で店を結び付け、store-stats の ruleEffects を引く。
 * 引けない・壊れている場合は空の索引を返す。
 * @param {object|null} venues venueキー → 店
 * @param {object|null} stats venueキー → { ruleEffects }
 * @returns {Map<string, Map<string, object>>}
 */
export function buildRuleEffectIndex(venues, stats) {
  const index = new Map();
  if (!venues || !stats) return index;
  for (const [key, venue] of Object.entries(venues)) {
    const effects = stats[key]?.ruleEffects;
    if (!venue?.storeId || !Array.isArray(effects) || !effects.length) continue;
    if (index.has(venue.storeId)) continue;
    index.set(venue.storeId, new Map(effects.map((e) => [e.label, e])));
  }
  return index;
}

// ---- DMM 取材実績（参考表示。点数・並び順には使わない） ----

/** 取材実績を数える期間（日）。今日からさかのぼって、この日数前の当日までを含む */
const REPORT_WINDOW_DAYS = 365;

/**
 * 店の DMM 取材実績（直近365日）を数える。数えるのは venue が店キーに一致し、
 * 実施日が「今日の365日前（当日を含む）から今日まで」のもの。未来の日付と日付の読めないものは数えない。
 * last は最も新しい実施日の取材（同日なら reportId の大きい方）。
 * @param {Array<{ reportId?: string, venue?: string|null, date?: string, title?: string }>|null|undefined} reports
 * @param {string} venueKey
 * @param {string} today "YYYY-MM-DD"
 * @returns {{ count: number, last: { date: string, title: string }|null }}
 */
export function reportSummary(reports, venueKey, today) {
  const t = dayNumber(today);
  let count = 0;
  let last = null;
  for (const r of Array.isArray(reports) ? reports : []) {
    if (r?.venue !== venueKey) continue;
    const age = t - dayNumber(r.date);
    if (!(age >= 0 && age <= REPORT_WINDOW_DAYS)) continue; // NaN も除く
    count++;
    const newer =
      !last || r.date > last.date || (r.date === last.date && Number(r.reportId) > Number(last.reportId));
    if (newer) last = { date: r.date, title: r.title ?? "", reportId: r.reportId };
  }
  return { count, last: last ? { date: last.date, title: last.title } : null };
}

/**
 * カードに出す取材実績の1行（HTML）。reports が配列でない（ファイルが読めない）ときは空文字。
 * 例: DMM取材実績（直近1年）: 2回・直近 2026-10-20「スロセレ」 / DMM取材実績（直近1年）: なし
 * @param {{ reports: unknown, venueKey: string, today: string }} args
 * @returns {string}
 */
export function dmmReportRow({ reports, venueKey, today }) {
  if (!Array.isArray(reports)) return "";
  const { count, last } = reportSummary(reports, venueKey, today);
  const body = count === 0 || !last ? "なし" : `${count}回・直近 ${esc(last.date)}「${esc(last.title)}」`;
  return `<div class="store-card__meta">DMM取材実績（直近1年）: ${body}</div>`;
}

/**
 * 店の DMM 来店レポート一覧の URL。dmmShopId が数字だけのときだけ返す（それ以外は null）。
 * href に入れる前に safeUrl を通すこと。
 * @param {{ dmmShopId?: unknown }|null|undefined} venue
 * @returns {string|null}
 */
export function dmmReportsLinkUrl(venue) {
  const id = venue?.dmmShopId;
  return typeof id === "string" && /^\d+$/.test(id) ? `https://p-town.dmm.com/shops/tokyo/${id}/reports` : null;
}

/**
 * 「DMMの来店レポート」リンク（HTML）。作れないときは空文字。
 * @param {{ dmmShopId?: unknown }|null|undefined} venue
 * @returns {string}
 */
export function dmmReportLinkHtml(venue) {
  const url = safeUrl(dmmReportsLinkUrl(venue));
  return url ? `<a href="${url}" target="_blank" rel="noopener">DMMの来店レポート</a>` : "";
}
