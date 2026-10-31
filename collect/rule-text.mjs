// みんレポの「旧イベント日」の文言（例: 16日、月と日がゾロ目の日、第4土曜日）を
// match.mjs のルール形式へ変換する。解釈できない句は推測で変換せず unparsed に残す。

const WEEKDAY_NUM = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 }; // getDay() 準拠

/**
 * 1つの句をルールへ変換する。解釈できなければ null。
 * @param {string} phrase 全角数字などを半角にそろえた句
 * @returns {object | null}
 */
function parsePhrase(phrase) {
  let m;
  if ((m = /^(\d)のつく日$/.exec(phrase))) {
    return { type: "digit", value: Number(m[1]) };
  }
  if ((m = /^(\d{1,2})日$/.exec(phrase))) {
    const day = Number(m[1]);
    return day >= 1 && day <= 31 ? { type: "monthday", value: day } : null;
  }
  if (phrase === "末日") return { type: "monthday", value: "last" };
  if (phrase === "月と日がゾロ目の日") return { type: "month-day-match" };
  if (phrase === "ゾロ目の日") return { type: "zorome" };
  if ((m = /^毎週([日月火水木金土])曜日$/.exec(phrase))) {
    return { type: "weekday", value: WEEKDAY_NUM[m[1]] };
  }
  if ((m = /^第(\d)([日月火水木金土])曜日$/.exec(phrase))) {
    const nth = Number(m[1]);
    return nth >= 1 && nth <= 5 ? { type: "nth-weekday", nth, weekday: WEEKDAY_NUM[m[2]] } : null;
  }
  return null;
}

/**
 * 特定日の文言を読点（、）で区切り、各句を match.mjs のルールへ変換する。
 * @param {string | null | undefined} text
 * @returns {{ rules: object[], unparsed: string[] }}
 */
export function parseRuleText(text) {
  const rules = [];
  const unparsed = [];
  if (!text) return { rules, unparsed };
  for (const raw of text.split(/[、，,]/)) {
    const original = raw.trim();
    if (!original) continue;
    const rule = parsePhrase(original.normalize("NFKC"));
    if (rule) rules.push(rule);
    else unparsed.push(original);
  }
  return { rules, unparsed };
}
