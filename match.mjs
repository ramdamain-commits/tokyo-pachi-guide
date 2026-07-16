// 特定日（旧イベント日）パターンの日付マッチングロジック。
// 日付は JST/ローカル基準の Date（new Date(y, m-1, d) 形式）を前提とする。
// UTC文字列パース（new Date("YYYY-MM-DD")）は使わないこと（1日ズレの原因）。

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 指定した年月の末日（28〜31）を返す。
 * @param {number} year
 * @param {number} month1to12 1〜12
 */
export function lastDayOfMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * 1ルールが date にマッチするか判定する。
 * @param {object} rule
 * @param {Date} date
 * @returns {boolean}
 */
export function matchRule(rule, date) {
  const day = date.getDate();
  const month = date.getMonth() + 1;

  switch (rule.type) {
    case "digit":
      // 日を文字列化し、value の数字を含むか（例: value=5 → 5,15,25日）
      return String(day).includes(String(rule.value));

    case "monthday":
      // value:"last" は月末日。数値存在しない日（2/31等）は単に不一致（繰り上げ・繰り下げしない）
      if (rule.value === "last") {
        return day === lastDayOfMonth(date.getFullYear(), month);
      }
      return day === Number(rule.value);

    case "annual":
      // 年1回・月日固定（2/29指定は閏年のみ実在するため非閏年では自然に不一致）
      return month === rule.month && day === rule.day;

    case "weekday":
      // getDay() 準拠（日=0〜土=6）
      return date.getDay() === rule.value;

    case "nth-weekday":
      // 第n○曜日（weekdayはgetDay()準拠）
      return date.getDay() === rule.weekday && Math.ceil(day / 7) === rule.nth;

    case "zorome": {
      // 日を文字列化して2桁以上かつ全桁同一の数字（汎用ゾロ目判定。決め打ちしない）
      const s = String(day);
      return s.length >= 2 && [...s].every((c) => c === s[0]);
    }

    case "month-day-match":
      // 月と日が同数（7/7, 12/12, 1/1等）
      return month === day;

    default:
      return false;
  }
}

/**
 * rules配列全体を matchRule でフィルタし、マッチした元のルールオブジェクトを
 * そのまま配列で返す（重複排除しない。同じdateに複数ルールが同時マッチしたら全部返す）。
 * @param {object[]} rules
 * @param {Date} date
 * @returns {object[]}
 */
export function matchRules(rules, date) {
  return (rules || []).filter((rule) => matchRule(rule, date));
}

/**
 * バッジ表示用の日本語ラベルを返す。rule.label があれば括弧内に併記する。
 * @param {object} rule
 * @returns {string}
 */
export function ruleLabel(rule) {
  let base;
  switch (rule.type) {
    case "digit":
      base = `${rule.value}のつく日`;
      break;
    case "monthday":
      base = rule.value === "last" ? "月末" : `毎月${rule.value}日`;
      break;
    case "annual":
      base = `年周年(${rule.month}/${rule.day})`;
      break;
    case "weekday":
      base = `毎週${WEEKDAY_JA[rule.value]}曜`;
      break;
    case "nth-weekday":
      base = `第${rule.nth}${WEEKDAY_JA[rule.weekday]}曜`;
      break;
    case "zorome":
      base = "ゾロ目";
      break;
    case "month-day-match":
      base = "月日重なり";
      break;
    default:
      base = rule.type;
  }
  return rule.label ? `${base}(${rule.label})` : base;
}
