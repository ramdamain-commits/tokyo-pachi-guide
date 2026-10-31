// 熱いイベント関連データ（venues / store-stats / events/*.json）の検証。
// scripts/validate-data.mjs から呼ぶ。
//
// 方針: 公開ページを壊れたデータで上書きしないための関門。
// 「欠測（null）」は仕様上ありうる正常値なので、missing と points の食い違いだけをエラーにする。
// エラーにするのは、日付・参照・出典・範囲・整合が崩れているケース。
// 警告にするのは、画面は出せるが品質が落ちるケース（みんレポ未対応の店が多い等）。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\//;
const GROUPS = new Set(["rated", "unrated"]);
/** score.mjs の points のキー。missing に入りうる名前もこの中だけ。 */
const POINT_KEYS = ["mediaG", "mediaSamai", "venueG", "venueSamai", "busy", "overlap"];
/** みんレポ未対応の店の割合がこれを超えたら警告 */
const MINREPO_UNSUPPORTED_WARN_RATIO = 0.5;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUrl(v) {
  return typeof v === "string" && URL_RE.test(v);
}

/** YYYY-MM-DD の形で、かつ実在する日付か。new Date("YYYY-MM-DD") は使わない。 */
function isRealDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** ファイル全体（{ venues: {...} }）でも中身だけでも受け付ける。 */
function unwrap(v, key) {
  return isPlainObject(v) && isPlainObject(v[key]) ? v[key] : v;
}

function checkEvent(e, label, month, venues, errors) {
  if (!isRealDate(e.date)) {
    errors.push(`${label}: 日付が YYYY-MM-DD の実在日でない "${e.date}"`);
  } else if (e.date.slice(0, 7) !== month) {
    errors.push(`${label}: 日付 ${e.date} が月ファイルの月 ${month} と違う`);
  }

  if (!Object.hasOwn(venues, e.venue)) {
    errors.push(`${label}: venue "${e.venue}" が venues に無い`);
  }

  if (!Array.isArray(e.sources) || e.sources.length === 0) {
    errors.push(`${label}: sources が空`);
  } else {
    e.sources.forEach((s, i) => {
      if (!isUrl(s?.url)) errors.push(`${label}: sources[${i}] の URL が http(s):// でない "${s?.url}"`);
      if (typeof s?.checkedAt !== "string" || !isRealDate(s.checkedAt)) {
        errors.push(`${label}: sources[${i}] の checkedAt が YYYY-MM-DD でない "${s?.checkedAt}"`);
      }
    });
  }

  if (!GROUPS.has(e.group)) {
    errors.push(`${label}: group が不正 "${e.group}"`);
  }

  const points = isPlainObject(e.points) ? e.points : {};
  const missing = Array.isArray(e.missing) ? e.missing : [];
  if (e.group === "rated" && points.mediaG == null && points.mediaSamai == null) {
    errors.push(`${label}: rated なのに mediaG と mediaSamai が両方 null`);
  }
  // missing に入っている要素は points が null、入っていない要素は null でない
  for (const key of new Set([...POINT_KEYS, ...missing])) {
    const inMissing = missing.includes(key);
    const isNull = points[key] === null;
    if (inMissing && !isNull) {
      errors.push(`${label}: missing に "${key}" があるが points.${key} が null でない`);
    } else if (!inMissing && isNull) {
      errors.push(`${label}: points.${key} が null なのに missing に "${key}" が無い`);
    }
  }

  if (typeof e.score !== "number" || !Number.isFinite(e.score) || e.score < 0 || e.score > 10) {
    errors.push(`${label}: score が 0〜10 の範囲外 "${e.score}"`);
  }

  if (e.frozen === false && e.outcome != null) {
    errors.push(`${label}: frozen: false なのに outcome がある`);
  }
}

/**
 * 収集結果を検証する。
 * @param {object} data
 * @param {object} data.venues venues.json の venues（ファイル全体でも可）
 * @param {object} data.mediaStrength media-strength.json（現状は形式の追加検証なし）
 * @param {object} data.storeStats store-stats.json の stats（ファイル全体でも可）
 * @param {Record<string, {month: string, events: object[]}>} data.months 月ファイル（キーは YYYY-MM）
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateEventsData({ venues, storeStats, months }) {
  const errors = [];
  const warnings = [];
  const venueMap = unwrap(venues, "venues") ?? {};
  const statsMap = unwrap(storeStats, "stats") ?? {};

  // store-stats: baseline があるなら出典 URL が要る
  for (const [key, st] of Object.entries(statsMap)) {
    if (st?.baseline != null && !isUrl(st.baseline.sourceUrl)) {
      errors.push(`store-stats ${key}: baseline に sourceUrl が無い、または http(s):// でない`);
    }
  }

  // みんレポ未対応の店の割合
  const venueList = Object.values(venueMap);
  if (venueList.length > 0) {
    const unsupported = venueList.filter((v) => v?.minrepoTag == null).length;
    const ratio = unsupported / venueList.length;
    if (ratio > MINREPO_UNSUPPORTED_WARN_RATIO) {
      warnings.push(
        `みんレポ未対応の店が ${unsupported}/${venueList.length} 店（${Math.round(ratio * 100)}%）と多い`,
      );
    }
  }

  // 月ファイル
  const seenIds = new Set();
  for (const [month, file] of Object.entries(months ?? {})) {
    if (!isPlainObject(file) || !Array.isArray(file.events)) {
      errors.push(`events/${month}: events が配列でない`);
      continue;
    }
    const fileMonth = file.month;
    file.events.forEach((e, i) => {
      const label = `events/${month}[${i}] ${e?.id ?? "(idなし)"}`;
      if (!isPlainObject(e)) {
        errors.push(`${label}: イベントがオブジェクトでない`);
        return;
      }
      if (seenIds.has(e.id)) {
        errors.push(`${label}: id重複`);
      }
      seenIds.add(e.id);
      checkEvent(e, label, fileMonth, venueMap, errors);
    });
  }

  return { errors, warnings };
}
