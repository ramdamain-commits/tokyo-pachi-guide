import test from "node:test";
import assert from "node:assert/strict";
import { lastDayOfMonth, matchRule, matchRules, ruleLabel } from "../match.mjs";

// --- lastDayOfMonth ---

test("lastDayOfMonth: 31日月・30日月・平年2月・閏年2月", () => {
  assert.equal(lastDayOfMonth(2026, 1), 31); // 1月
  assert.equal(lastDayOfMonth(2026, 4), 30); // 4月
  assert.equal(lastDayOfMonth(2026, 2), 28); // 2026年は平年
  assert.equal(lastDayOfMonth(2028, 2), 29); // 2028年は閏年
});

// --- monthday: 31日が存在しない月では一致しない（繰り上げしない） ---

test("monthday:31 は31日のない月(2,4,6,9,11月)で一致しない", () => {
  const year = 2026;
  const monthsWithout31 = [2, 4, 6, 9, 11];
  monthsWithout31.forEach((month) => {
    const last = lastDayOfMonth(year, month);
    // 月の最終日ですら31ではないので、月内のどの日も monthday:31 に一致しないはず
    for (let d = 1; d <= last; d += 1) {
      const date = new Date(year, month - 1, d);
      assert.equal(
        matchRule({ type: "monthday", value: 31 }, date),
        false,
        `${year}-${month}-${d} は monthday:31 に一致してはいけない`
      );
    }
  });
});

test("monthday:31 は31日がある月では31日にのみ一致する", () => {
  const date = new Date(2026, 0, 31); // 1月31日
  assert.equal(matchRule({ type: "monthday", value: 31 }, date), true);
  const notLast = new Date(2026, 0, 30);
  assert.equal(matchRule({ type: "monthday", value: 31 }, notLast), false);
});

// --- monthday:"last" が各月末日に正しくマッチすること ---

test('monthday:"last" は28/30/31日それぞれの月末日に正しくマッチする', () => {
  const year = 2026; // 平年
  const cases = [
    { month: 2, expectedLast: 28 }, // 平年2月
    { month: 4, expectedLast: 30 },
    { month: 1, expectedLast: 31 },
  ];
  cases.forEach(({ month, expectedLast }) => {
    const last = lastDayOfMonth(year, month);
    assert.equal(last, expectedLast);
    const lastDate = new Date(year, month - 1, last);
    assert.equal(matchRule({ type: "monthday", value: "last" }, lastDate), true);
    const dayBefore = new Date(year, month - 1, last - 1);
    assert.equal(matchRule({ type: "monthday", value: "last" }, dayBefore), false);
  });
});

test('monthday:"last" は閏年2/29にも正しくマッチする', () => {
  const leapYear = 2028;
  assert.equal(lastDayOfMonth(leapYear, 2), 29);
  const date = new Date(leapYear, 1, 29);
  assert.equal(matchRule({ type: "monthday", value: "last" }, date), true);
  const dayBefore = new Date(leapYear, 1, 28);
  assert.equal(matchRule({ type: "monthday", value: "last" }, dayBefore), false);
});

// --- うるう年2/29（monthday:29 と annual{month:2,day:29}） ---
// 非閏年には2/29というDateが存在しないため、閏年年(2028年)の日付で検証する。

test("うるう年2/29: monthday:29 が一致する", () => {
  const date = new Date(2028, 1, 29);
  assert.equal(matchRule({ type: "monthday", value: 29 }, date), true);
});

test("うるう年2/29: annual{month:2,day:29} が一致する", () => {
  const date = new Date(2028, 1, 29);
  assert.equal(matchRule({ type: "annual", month: 2, day: 29 }, date), true);
  // 平年の2/28は annual{month:2,day:29} に一致しない
  const nonLeapFeb28 = new Date(2026, 1, 28);
  assert.equal(matchRule({ type: "annual", month: 2, day: 29 }, nonLeapFeb28), false);
});

// --- zorome と monthday:11 の併記で両方マッチ・重複排除しないこと ---

test("zorome と monthday:11 を併記した店は11日に両方マッチし配列長2(重複排除なし)", () => {
  const rules = [{ type: "zorome" }, { type: "monthday", value: 11 }];
  const date = new Date(2026, 6, 11); // 7月11日
  const matched = matchRules(rules, date);
  assert.equal(matched.length, 2);
  // 元のルールオブジェクトがそのまま返ること（参照同一性）
  assert.equal(matched[0], rules[0]);
  assert.equal(matched[1], rules[1]);
});

test("zorome は22日にもマッチし、12日等の非ゾロ目には一致しない", () => {
  assert.equal(matchRule({ type: "zorome" }, new Date(2026, 6, 22)), true);
  assert.equal(matchRule({ type: "zorome" }, new Date(2026, 6, 12)), false);
  assert.equal(matchRule({ type: "zorome" }, new Date(2026, 6, 1)), false);
});

// --- month-day-match と digit の同時マッチ ---

test("month-day-match と digit:7 が7/7に同時マッチし配列長2", () => {
  const rules = [{ type: "month-day-match" }, { type: "digit", value: 7 }];
  const date = new Date(2026, 6, 7); // 7月7日
  const matched = matchRules(rules, date);
  assert.equal(matched.length, 2);
});

test("month-day-match は月と日が異なる日には一致しない", () => {
  assert.equal(matchRule({ type: "month-day-match" }, new Date(2026, 6, 8)), false);
  assert.equal(matchRule({ type: "month-day-match" }, new Date(2026, 11, 12)), true); // 12/12
});

// --- 年跨ぎ（12/31→1/1）の判定 ---

test("年跨ぎ(12/31→1/1)でルール判定が年をまたいでも正しく独立していること", () => {
  const dec31 = new Date(2026, 11, 31);
  const jan1 = new Date(2027, 0, 1);
  // annual{month:1,day:1} は1/1のみ一致し、前年12/31には一致しない
  assert.equal(matchRule({ type: "annual", month: 1, day: 1 }, jan1), true);
  assert.equal(matchRule({ type: "annual", month: 1, day: 1 }, dec31), false);
  // month-day-match は 1/1 に一致するが 12/31 には一致しない
  assert.equal(matchRule({ type: "month-day-match" }, jan1), true);
  assert.equal(matchRule({ type: "month-day-match" }, dec31), false);
  // monthday:"last" は 12/31 (12月の月末)に一致する
  assert.equal(matchRule({ type: "monthday", value: "last" }, dec31), true);
});

// --- nth-weekday の年跨ぎ・月初判定（曜日は Date.getDay() で自前計算し、記憶でハードコードしない） ---

test("nth-weekday: 1月の第1土曜（年またぎ直後の月初）", () => {
  const year = 2027;
  let firstSaturday = null;
  for (let d = 1; d <= 7; d += 1) {
    const date = new Date(year, 0, d);
    if (date.getDay() === 6) {
      firstSaturday = d;
      break;
    }
  }
  assert.ok(firstSaturday, "1月の最初の7日以内に土曜日が見つかるはず");

  const firstSatDate = new Date(year, 0, firstSaturday);
  assert.equal(matchRule({ type: "nth-weekday", nth: 1, weekday: 6 }, firstSatDate), true);

  // 翌週の同じ曜日(第2土曜)は第1土曜には一致しない
  const secondSatDate = new Date(year, 0, firstSaturday + 7);
  assert.equal(matchRule({ type: "nth-weekday", nth: 1, weekday: 6 }, secondSatDate), false);
  assert.equal(matchRule({ type: "nth-weekday", nth: 2, weekday: 6 }, secondSatDate), true);

  // 曜日が異なれば一致しない
  const dayAfter = new Date(year, 0, firstSaturday + 1);
  assert.notEqual(dayAfter.getDay(), 6);
  assert.equal(matchRule({ type: "nth-weekday", nth: 1, weekday: 6 }, dayAfter), false);
});

// --- weekday ---

test("weekday: getDay()準拠(日=0〜土=6)で判定される", () => {
  // 2026-07-16は木曜日（getDay()===4）であることを自前計算で確認してから検証する
  const date = new Date(2026, 6, 16);
  const dow = date.getDay();
  assert.equal(matchRule({ type: "weekday", value: dow }, date), true);
  assert.equal(matchRule({ type: "weekday", value: (dow + 1) % 7 }, date), false);
});

// --- digit ---

test("digit: 日の数字にvalueを含む日にマッチする(5→5,15,25)", () => {
  assert.equal(matchRule({ type: "digit", value: 5 }, new Date(2026, 6, 5)), true);
  assert.equal(matchRule({ type: "digit", value: 5 }, new Date(2026, 6, 15)), true);
  assert.equal(matchRule({ type: "digit", value: 5 }, new Date(2026, 6, 25)), true);
  assert.equal(matchRule({ type: "digit", value: 5 }, new Date(2026, 6, 6)), false);
});

// --- ruleLabel ---

test("ruleLabel: 各type別ラベル", () => {
  assert.equal(ruleLabel({ type: "digit", value: 5 }), "5のつく日");
  assert.equal(ruleLabel({ type: "monthday", value: 21 }), "毎月21日");
  assert.equal(ruleLabel({ type: "monthday", value: "last" }), "月末");
  assert.equal(ruleLabel({ type: "annual", month: 3, day: 21 }), "年周年(3/21)");
  assert.equal(ruleLabel({ type: "weekday", value: 3 }), "毎週水曜");
  assert.equal(ruleLabel({ type: "nth-weekday", nth: 1, weekday: 6 }), "第1土曜");
  assert.equal(ruleLabel({ type: "zorome" }), "ゾロ目");
  assert.equal(ruleLabel({ type: "month-day-match" }), "月日重なり");
});

test("ruleLabel: rule.label があれば括弧内に併記する", () => {
  assert.equal(
    ruleLabel({ type: "monthday", value: 21, label: "月周年" }),
    "毎月21日(月周年)"
  );
  assert.equal(
    ruleLabel({ type: "annual", month: 3, day: 21, label: "周年" }),
    "年周年(3/21)(周年)"
  );
});

// --- matchRules: マッチなし ---

test("matchRules: どのルールにもマッチしない日は空配列を返す", () => {
  const rules = [{ type: "digit", value: 3 }, { type: "monthday", value: 21 }];
  const date = new Date(2026, 6, 16); // 7月16日（3のつく日でも21日でもない）
  assert.deepEqual(matchRules(rules, date), []);
});
