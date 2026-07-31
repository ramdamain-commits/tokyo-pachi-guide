import test from "node:test";
import assert from "node:assert/strict";
import { validateStores } from "../validate.mjs";

// 検証を通る最小の店データ
function store(overrides = {}) {
  return { id: "s1", name: "テスト店", area: "上野", rules: [], ...overrides };
}

test("validateStores: 最小構成の店はエラーも警告も出さない", () => {
  const { errors, warnings } = validateStores([store()]);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("validateStores: id 重複をエラーにする", () => {
  const { errors } = validateStores([store(), store()]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /id重複/);
});

// --- lottery ---

test("validateStores: lottery.type の未知の値をエラーにする", () => {
  const { errors } = validateStores([store({ lottery: { type: "unknown" } })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /lottery\.type/);
});

test("validateStores: lottery.type が null や未指定なら通る（未確認は正常）", () => {
  assert.deepEqual(validateStores([store({ lottery: { type: null } })]).errors, []);
  assert.deepEqual(validateStores([store({ lottery: { method: "整理券" } })]).errors, []);
});

test("validateStores: lottery.random が真偽値でも null でもなければエラー", () => {
  const { errors } = validateStores([store({ lottery: { type: "onsite", random: "yes" } })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /lottery\.random/);
});

test("validateStores: type=app でツール名が無い場合は警告（エラーではない）", () => {
  const { errors, warnings } = validateStores([store({ lottery: { type: "app", tool: null } })]);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tool/);
});

test("validateStores: lottery のサブオブジェクトに未知のキーがあればエラー", () => {
  const { errors } = validateStores([
    store({ lottery: { type: "onsite", slot: { type: "app", nonsense: 1 } } }),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /slot/);
});

test("validateStores: サブオブジェクトの入れ子（slot の中の slot）をエラーにする", () => {
  const { errors } = validateStores([
    store({ lottery: { type: "onsite", slot: { slot: { type: "app" } } } }),
  ]);
  assert.equal(errors.length, 1);
});

// --- sns ---

test("validateStores: sns の未知のキーをエラーにする", () => {
  const { errors } = validateStores([store({ sns: { tiktok: "https://example.com" } })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sns/);
});

test("validateStores: sns の値が URL でなければエラー、null は通る", () => {
  assert.equal(validateStores([store({ sns: { x: "@someaccount" } })]).errors.length, 1);
  assert.deepEqual(validateStores([store({ sns: { x: null, line: null } })]).errors, []);
  assert.deepEqual(
    validateStores([store({ sns: { x: "https://x.com/example" } })]).errors,
    []
  );
});

// --- crowd ---

test("validateStores: crowd は note/sourceUrl/checkedAt が揃っていること", () => {
  const ok = { note: "アクセス集中日あり", sourceUrl: "https://example.com", checkedAt: "2026-07-31" };
  assert.deepEqual(validateStores([store({ crowd: ok })]).errors, []);

  // sourceUrl と checkedAt の両方が欠けるので2件出る
  const { errors } = validateStores([store({ crowd: { note: "メモだけ" } })]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /crowd/);
});

test("validateStores: crowd.checkedAt の日付形式が不正ならエラー", () => {
  const bad = { note: "n", sourceUrl: "https://example.com", checkedAt: "2026/07/31" };
  const { errors } = validateStores([store({ crowd: bad })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /checkedAt/);
});

// --- annual rule ---

test("validateStores: annual の month/day 範囲外をエラーにする", () => {
  const { errors } = validateStores([
    store({ rules: [{ type: "annual", month: 13, day: 1 }] }),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /annual/);
});

test("validateStores: annual の label は文字列なら通り、文字列以外はエラー", () => {
  const ok = [{ type: "annual", month: 3, day: 15, label: "グランドオープン記念" }];
  assert.deepEqual(validateStores([store({ rules: ok })]).errors, []);

  const ng = [{ type: "annual", month: 3, day: 15, label: 5 }];
  assert.equal(validateStores([store({ rules: ng })]).errors.length, 1);
});
