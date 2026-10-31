// 月ファイルの更新。today より前の日は前回のイベントを凍結して残し（結果は一度だけ書き込む）、
// today 以降は今回の取得結果で置き換える。入力は書き換えない。

/**
 * 前回の月ファイルから、today より前の日のイベントを凍結して取り出す。
 * outcome は null のときに限り outcomes の値で埋める（一度入った値は変えない）。
 * @param {{ events?: object[] } | null | undefined} previousFile
 * @param {string} today YYYY-MM-DD
 * @param {Map<string, { g: number, samai: number | null } | null>} outcomes
 * @returns {object[]}
 */
export function frozenEvents(previousFile, today, outcomes) {
  const out = [];
  for (const e of previousFile?.events ?? []) {
    if (!(e.date < today)) continue;
    const filled = e.outcome == null ? (outcomes.get(e.id) ?? null) : e.outcome;
    out.push({ ...e, frozen: true, outcome: filled });
  }
  return out;
}

/**
 * 月ファイルを作る。
 * - today より前の日: 前回のイベントを frozen: true で残す。前回に無い過去日のイベントは今回の分でも捨てる
 * - 凍結イベントの outcome: null のときだけ outcomes（イベント id → 結果）で埋める
 * - today 以降: 今回の freshEvents（その月のもの）で置き換える。前回だけにある未来のイベントは消える
 * @param {{ month?: string, events?: object[] } | null} previousFile 前回の月ファイル（無ければ null）
 * @param {object[]} freshEvents 今回の取得結果（点数つき。月や日付の範囲外のものは除く）
 * @param {string} today YYYY-MM-DD（JST）
 * @param {string} month YYYY-MM
 * @param {Map<string, { g: number, samai: number | null } | null>} outcomes
 * @param {string} [generatedAt] 生成時刻（ISO・JST）。省略時は today の0時
 * @returns {{ month: string, generatedAt: string, events: object[] }}
 */
export function mergeMonth(previousFile, freshEvents, today, month, outcomes, generatedAt = `${today}T00:00:00+09:00`) {
  const frozen = frozenEvents(previousFile, today, outcomes);
  const fresh = freshEvents
    .filter((e) => e.date >= today && e.date.slice(0, 7) === month)
    .map((e) => ({ ...e }));
  const events = [...frozen, ...fresh].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1,
  );
  return { month, generatedAt, events };
}
