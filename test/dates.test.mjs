import { test } from "node:test";
import assert from "node:assert/strict";
import { jstToday, inferYear, addDaysStr, monthOf } from "../collect/dates.mjs";

test("inferYear: 基準 2026-12-28 で 1/3 は future なら 2027-01-03", () => {
  assert.equal(inferYear(1, 3, "2026-12-28", "future"), "2027-01-03");
});

test("inferYear: 基準 2027-01-02 で 12/30 は past なら 2026-12-30", () => {
  assert.equal(inferYear(12, 30, "2027-01-02", "past"), "2026-12-30");
});

test("inferYear: 基準 2026-11-01 で 10/31 は past なら 2026-10-31", () => {
  assert.equal(inferYear(10, 31, "2026-11-01", "past"), "2026-10-31");
});

test("inferYear: future は基準日の60日前以降で最も近い日（同日・60日前の境界を含む）", () => {
  // 基準日そのもの
  assert.equal(inferYear(11, 1, "2026-11-01", "future"), "2026-11-01");
  // 60日前（2026-09-02）はその年のまま
  assert.equal(inferYear(9, 2, "2026-11-01", "future"), "2026-09-02");
  // 61日前（2026-09-01）は来年に回る
  assert.equal(inferYear(9, 1, "2026-11-01", "future"), "2027-09-01");
});

test("inferYear: past は基準日そのものを含み、翌日なら前年", () => {
  assert.equal(inferYear(11, 1, "2026-11-01", "past"), "2026-11-01");
  assert.equal(inferYear(11, 2, "2026-11-01", "past"), "2025-11-02");
});

test("jstToday: UTC 2026-10-31T15:30Z は 2026-11-01", () => {
  assert.equal(jstToday(new Date("2026-10-31T15:30:00Z")), "2026-11-01");
  assert.equal(jstToday(new Date("2026-10-31T14:59:00Z")), "2026-10-31");
});

test("addDaysStr: 月・年をまたいで加減算する", () => {
  assert.equal(addDaysStr("2026-12-30", 3), "2027-01-02");
  assert.equal(addDaysStr("2027-01-02", -3), "2026-12-30");
  assert.equal(addDaysStr("2028-02-28", 1), "2028-02-29");
});

test("monthOf: YYYY-MM を返す", () => {
  assert.equal(monthOf("2026-11-07"), "2026-11");
});
