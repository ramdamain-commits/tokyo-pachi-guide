// 抽選方式（lottery）の派生・正規化・ラベル生成。app.js と scripts/ から import する。
//
// 重要: 派生は「出典から記録済みの method 文言を読む」ことに限定する。
// 文言から判別できない項目は null のままにし、reviewFlags() で要確認として返す。
// 無記載を false と断定しない（推測補完の禁止）。

// アプリ・オンライン抽選を示す語
const APP_MARKERS = ["モバイル", "オンライン", "コンパス", "入場くん", "アプリ"];
// 店頭での配布・抽選を示す語。「抽選」単独はチャネルを決めないので含めない
const ONSITE_MARKERS = ["整理券", "店頭", "抽選券"];
// パチ/スロで方式が分かれている可能性を示す語
const GENRE_MARKERS = ["パチ", "スロ"];

// 表記ゆれをツール名へ正規化する。∞付きを先に判定すること（部分一致の取りこぼし防止）
const TOOL_PATTERNS = [
  [/入場くんオンライン∞/, "入場くんオンライン∞"],
  [/入場くん/, "入場くんオンライン"],
  [/コンパス/, "777コンパス"],
];

function hasAny(method, markers) {
  return markers.some((m) => method.includes(m));
}

/**
 * 入場チャネルを返す。判別できなければ null。
 * 「lineup」（並びのみ）は method 文言からは判別できないため本関数では返さない。
 * 出典の再確認で人手により設定する。
 * @param {string|null} method
 * @returns {"onsite"|"app"|null}
 */
export function deriveChannel(method) {
  if (!method) return null;
  if (hasAny(method, APP_MARKERS)) return "app";
  if (hasAny(method, ONSITE_MARKERS)) return "onsite";
  return null;
}

/**
 * アプリ・ツール名を返す。記載が無ければ null。
 * @param {string|null} method
 * @returns {string|null}
 */
export function deriveTool(method) {
  if (!method) return null;
  for (const [pattern, name] of TOOL_PATTERNS) {
    if (pattern.test(method)) return name;
  }
  return null;
}

/**
 * 抽選要素の有無を返す。「抽選」の記載があれば true、無ければ null。
 * 無記載を false（＝先着確定）と読むのは推測になるため null を返す。
 * @param {string|null} method
 * @returns {true|null}
 */
export function deriveRandom(method) {
  if (!method) return null;
  return method.includes("抽選") ? true : null;
}

/**
 * 出典の再確認が必要な理由を配列で返す。空配列なら文言だけで確定できている。
 * @param {string|null} method
 * @returns {string[]}
 */
export function reviewFlags(method) {
  const flags = [];
  if (!method) return ["方式未記載"];

  const channel = deriveChannel(method);
  if (channel === null) flags.push("チャネル不明");
  if (deriveRandom(method) === null) flags.push("抽選有無不明");
  if (channel === "app" && deriveTool(method) === null) flags.push("ツール名不明");
  if (hasAny(method, APP_MARKERS) && hasAny(method, ONSITE_MARKERS)) {
    flags.push("ハイブリッド疑い");
  }
  if (hasAny(method, GENRE_MARKERS)) flags.push("パチ/スロ差分疑い");
  // 「コンパス」の略称のみで「777コンパス」と推定した場合は出典に無い情報の補完になるため要確認
  if (method.includes("コンパス") && !method.includes("777")) {
    flags.push("ツール名要確認(略称一致)");
  }
  return flags;
}

/**
 * パチ/スロで方式が異なる店の値を解決する。
 * 共通値（トップレベル）に genre のサブオブジェクトを重ねた新しいオブジェクトを返す。
 * サブオブジェクト自体（pachinko / slot）は結果に含めない。
 * @param {object|null} lottery
 * @param {"pachinko"|"slot"|null} genre
 * @returns {object|null}
 */
export function resolveLottery(lottery, genre) {
  if (!lottery) return null;
  const { pachinko, slot, ...common } = lottery;
  const override = genre === "pachinko" ? pachinko : genre === "slot" ? slot : null;
  return override ? { ...common, ...override } : common;
}

/**
 * バッジ表示用の日本語ラベルを返す。
 * type が未確認（null）のときは null を返し、呼び出し側でバッジを出さない
 * （「抽選なし」と誤読されるのを避けるため）。
 * @param {object|null} lottery resolveLottery 済みのオブジェクト
 * @returns {string|null}
 */
export function lotteryLabel(lottery) {
  if (!lottery || !lottery.type) return null;
  switch (lottery.type) {
    case "app":
      return lottery.tool ? `アプリ抽選(${lottery.tool})` : "アプリ抽選";
    case "onsite":
      if (lottery.random === true) return "店頭抽選";
      if (lottery.random === false) return "先着整理券";
      return "店頭整理券";
    case "lineup":
      return "並び順";
    default:
      return null;
  }
}
