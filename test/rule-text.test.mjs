import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRuleText } from "../collect/rule-text.mjs";
import { matchRule } from "../match.mjs";

test("parseRuleText: '16日、月と日がゾロ目の日、第4土曜日' を3ルールに変換し unparsed は空", () => {
  const { rules, unparsed } = parseRuleText("16日、月と日がゾロ目の日、第4土曜日");
  assert.deepEqual(rules, [
    { type: "monthday", value: 16 },
    { type: "month-day-match" },
    { type: "nth-weekday", nth: 4, weekday: 6 },
  ]);
  assert.deepEqual(unparsed, []);
});

test("parseRuleText: '5のつく日、末日' を digit 5 と monthday last に", () => {
  const { rules, unparsed } = parseRuleText("5のつく日、末日");
  assert.deepEqual(rules, [
    { type: "digit", value: 5 },
    { type: "monthday", value: "last" },
  ]);
  assert.deepEqual(unparsed, []);
});

test("parseRuleText: 'ゾロ目の日' と '毎週X曜日' を変換する", () => {
  const { rules, unparsed } = parseRuleText("ゾロ目の日、毎週日曜日、毎週水曜日");
  assert.deepEqual(rules, [
    { type: "zorome" },
    { type: "weekday", value: 0 },
    { type: "weekday", value: 3 },
  ]);
  assert.deepEqual(unparsed, []);
});

test("parseRuleText: 'リニューアル記念' は unparsed に入りルールを作らない", () => {
  const { rules, unparsed } = parseRuleText("リニューアル記念");
  assert.deepEqual(rules, []);
  assert.deepEqual(unparsed, ["リニューアル記念"]);
});

test("parseRuleText: 解釈できる句と混ざっても解釈できない句だけ unparsed に残る", () => {
  const { rules, unparsed } = parseRuleText("7のつく日、リニューアル記念、32日、第6土曜日、毎週月日");
  assert.deepEqual(rules, [{ type: "digit", value: 7 }]);
  assert.deepEqual(unparsed, ["リニューアル記念", "32日", "第6土曜日", "毎週月日"]);
});

test("parseRuleText: null・空文字は空の結果", () => {
  assert.deepEqual(parseRuleText(null), { rules: [], unparsed: [] });
  assert.deepEqual(parseRuleText(""), { rules: [], unparsed: [] });
});

test("parseRuleText の結果は matchRule で 2026-10-24 にだけ第4土曜日がマッチする", () => {
  const { rules } = parseRuleText("第4土曜日");
  assert.equal(rules.length, 1);
  assert.equal(matchRule(rules[0], new Date(2026, 9, 24)), true);
  assert.equal(matchRule(rules[0], new Date(2026, 9, 17)), false);
  assert.equal(matchRule(rules[0], new Date(2026, 9, 31)), false);
});
