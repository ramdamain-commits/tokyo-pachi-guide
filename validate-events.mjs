// 熱いイベント関連データ（venues / store-stats / events/*.json）の検証。
// scripts/validate-data.mjs から呼ぶ。
//
// 方針: 公開ページを壊れたデータで上書きしないための関門。
// 「欠測（null）」は仕様上ありうる正常値なので、missing と points の食い違いだけをエラーにする。
// エラーにするのは、日付・参照・出典・範囲・整合が崩れているケース。
// 警告にするのは、画面は出せるが品質が落ちるケース（みんレポ未対応の店が多い等）。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\//;
const MONTH_RE = /^\d{4}-\d{2}$/;
const GROUPS = new Set(["rated", "unrated"]);
/** collect-meta の sources に書いてよい取得元 */
const SOURCE_NAMES = ["dmm", "minrepo"];
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

/** venues が null のときは venue の参照検査を飛ばす（形の誤りは別に報告済み） */
function checkEvent(e, label, month, venues, errors) {
  if (!isRealDate(e.date)) {
    errors.push(`${label}: 日付が YYYY-MM-DD の実在日でない "${e.date}"`);
  } else if (e.date.slice(0, 7) !== month) {
    errors.push(`${label}: 日付 ${e.date} が月ファイルの月 ${month} と違う`);
  }

  if (venues && !Object.hasOwn(venues, e.venue)) {
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
 * dmm-reports.json（DMM 取材実績。参考表示用）を検証する。
 * reportId の重複・実施日の形式と実在・venue が null か venues のキーか、を見る。
 * venueMap が null のときは venue の参照検査を飛ばす（形の誤りは別に報告済み）。
 * @param {unknown} file dmm-reports.json の中身（{ updated, reports }）
 * @param {Record<string, unknown>|null} venueMap venues.json の `venues`
 * @returns {string[]} エラーの一覧
 */
export function validateDmmReports(file, venueMap) {
  const errors = [];
  if (!isPlainObject(file) || !Array.isArray(file.reports)) {
    return ["dmm-reports: reports が配列でない"];
  }
  if (file.updated !== undefined && !isRealDate(file.updated)) {
    errors.push(`dmm-reports: updated が YYYY-MM-DD の実在日でない "${file.updated}"`);
  }
  const seen = new Set();
  file.reports.forEach((r, i) => {
    const label = `dmm-reports[${i}] ${r?.reportId ?? "(reportIdなし)"}`;
    if (!isPlainObject(r)) {
      errors.push(`${label}: レポートがオブジェクトでない`);
      return;
    }
    if (typeof r.reportId !== "string" || r.reportId === "") {
      errors.push(`${label}: reportId が空、または文字列でない`);
    } else if (seen.has(r.reportId)) {
      errors.push(`${label}: reportId 重複`);
    } else {
      seen.add(r.reportId);
    }
    if (!isRealDate(r.date)) errors.push(`${label}: 日付が YYYY-MM-DD の実在日でない "${r.date}"`);
    if (typeof r.title !== "string" || r.title === "") errors.push(`${label}: title が空、または文字列でない`);
    if (r.media != null && typeof r.media !== "string") errors.push(`${label}: media が null か文字列でない`);
    if (r.venue !== null && (typeof r.venue !== "string" || (venueMap && !Object.hasOwn(venueMap, r.venue)))) {
      errors.push(`${label}: venue "${r.venue}" が null でも venues のキーでもない`);
    }
  });
  return errors;
}

/**
 * 収集結果を検証する。
 * @param {object} data
 * @param {object} data.venues venues.json の `venues`（店キー → 店。ファイル全体ではなく中身）
 * @param {object} data.mediaStrength media-strength.json（現状は形式の追加検証なし）
 * @param {object} data.storeStats store-stats.json の `stats`（店キー → 統計。中身）
 * @param {Record<string, {month: string, events: object[]}>} data.months 月ファイル（キーは YYYY-MM）
 * @param {object|null} [data.dmmReports] dmm-reports.json（任意。無い・null なら飛ばす）。
 * @param {{sources?: string[], rates?: {minrepoMatched?: number|null}}} [data.meta] collect-meta.json（任意）。
 *   sources があれば dmm / minrepo の文字列配列、rates.minrepoMatched は null か 0〜1 の数。
 *   sources に minrepo が無いとき（みんレポを取っていない回）は「みんレポ未対応の店が多い」警告を出さない。
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateEventsData({ venues, storeStats, months, meta, dmmReports }) {
  const errors = [];
  const warnings = [];
  // 形が違うと以降の検査が空回りして素通りするので、先に形を固定する
  const venueMap = isPlainObject(venues) ? venues : null;
  const statsMap = isPlainObject(storeStats) ? storeStats : null;
  if (!venueMap) errors.push("venues がオブジェクト（店キー → 店）でない");
  if (!statsMap) errors.push("store-stats の stats がオブジェクト（店キー → 統計）でない");

  // collect-meta（任意）: sources は dmm / minrepo だけ、minrepoMatched は null か 0〜1
  let usesMinrepo = true;
  if (meta != null) {
    if (meta.sources !== undefined) {
      const ok = Array.isArray(meta.sources) && meta.sources.every((s) => typeof s === "string" && SOURCE_NAMES.includes(s));
      if (!ok) {
        errors.push(`collect-meta: sources は ${SOURCE_NAMES.join(" / ")} の文字列配列でなければならない "${JSON.stringify(meta.sources)}"`);
      } else {
        usesMinrepo = meta.sources.includes("minrepo");
      }
    }
    const matched = meta.rates?.minrepoMatched;
    if (matched !== undefined && matched !== null && !(typeof matched === "number" && Number.isFinite(matched) && matched >= 0 && matched <= 1)) {
      errors.push(`collect-meta: rates.minrepoMatched は null か 0〜1 の数でなければならない "${matched}"`);
    }
  }

  // store-stats: baseline があるなら出典 URL が要る
  for (const [key, st] of Object.entries(statsMap ?? {})) {
    if (st?.baseline != null && !isUrl(st.baseline.sourceUrl)) {
      errors.push(`store-stats ${key}: baseline に sourceUrl が無い、または http(s):// でない`);
    }
  }

  // みんレポ未対応の店の割合
  const venueList = Object.values(venueMap ?? {});
  if (usesMinrepo && venueList.length > 0) {
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
    if (typeof file.month !== "string" || !MONTH_RE.test(file.month)) {
      errors.push(`events/${month}: month が YYYY-MM でない "${file.month}"`);
    } else if (file.month !== month) {
      errors.push(`events/${month}: month "${file.month}" が月キーと違う`);
    }
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
      checkEvent(e, label, month, venueMap, errors);
    });
  }

  if (dmmReports != null) errors.push(...validateDmmReports(dmmReports, venueMap));

  return { errors, warnings };
}
