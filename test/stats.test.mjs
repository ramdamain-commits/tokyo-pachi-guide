import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseline,
  ruleEffects,
  outcomeOf,
  summarize,
  strengthTable,
  pickStrength,
  venueLift,
  busyPercentiles,
} from "../collect/stats.mjs";

/** 2026-09-01 から連続した日付の日別行を作る（日付は new Date(y, m-1, d) 形式で生成）。 */
function mkDays(n, fn, startDay = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(2026, 8, startDay + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date, ...fn(i, d) });
  }
  return out;
}

test("baseline: 旧イベント日と除外日を含めずに中央値を取る", () => {
  // 9/1〜9/20。5のつく日(5,15)は旧イベント日、9/10 は除外日。いずれも外れ値。
  const rules = [{ type: "digit", value: 5 }];
  const days = mkDays(20, (i, d) => {
    const day = d.getDate();
    if (day === 5 || day === 15 || day === 10) return { totalSamai: null, avgSamai: 5000, avgG: 9000 };
    return { totalSamai: null, avgSamai: 10, avgG: 2000 };
  });
  const b = baseline(days, new Set(["2026-09-10"]), rules);
  assert.equal(b.medianG, 2000);
  assert.equal(b.medianSamai, 10);
  assert.equal(b.daysG, 17);
  assert.equal(b.daysSamai, 17);
  // 除外しなければ外れ値が入って daysG が増える（入力が効いていることの確認）
  const b2 = baseline(days, new Set(), []);
  assert.equal(b2.daysG, 20);
});

test("baseline: 中央値は偶数個なら中央2つの平均を四捨五入する", () => {
  const vals = [1000, 2000, 2000, 2001, 3000, 3000, 3000, 3000, 3000, 3000];
  const days = mkDays(10, (i) => ({ totalSamai: null, avgSamai: i * 10, avgG: vals[i] }));
  const b = baseline(days, new Set(), []);
  // avgG の中央2つは 3000 と 2001 ではなく、整列後の5・6番目 = 3000, 3000
  assert.equal(b.medianG, 3000);
  // avgSamai 0..90 の中央は (40+50)/2 = 45
  assert.equal(b.medianSamai, 45);
  const days2 = mkDays(10, (i) => ({ totalSamai: null, avgSamai: null, avgG: i < 5 ? 2000 : 2001 }));
  assert.equal(baseline(days2, new Set(), []).medianG, 2001); // 2000.5 は四捨五入で 2001
});

test("baseline: 通常日の avgG が9日なら null、10日なら値", () => {
  const mk = (n) => mkDays(n, () => ({ totalSamai: null, avgSamai: 0, avgG: 2000 }));
  assert.equal(baseline(mk(9), new Set(), []), null);
  const b = baseline(mk(10), new Set(), []);
  assert.equal(b.medianG, 2000);
  assert.equal(b.daysG, 10);
  // avgG が null の日は数えない
  const days = mkDays(12, (i) => ({ totalSamai: null, avgSamai: 0, avgG: i < 9 ? 2000 : null }));
  assert.equal(baseline(days, new Set(), []), null);
});

test("baseline: avgSamai が9日なら medianSamai だけ null", () => {
  const mk = (nSamai) =>
    mkDays(12, (i) => ({ totalSamai: null, avgSamai: i < nSamai ? 30 : null, avgG: 2000 }));
  const b9 = baseline(mk(9), new Set(), []);
  assert.equal(b9.medianSamai, null);
  assert.equal(b9.daysSamai, 9);
  assert.equal(b9.medianG, 2000);
  const b10 = baseline(mk(10), new Set(), []);
  assert.equal(b10.medianSamai, 30);
  assert.equal(b10.daysSamai, 10);
});

test("ruleEffects: 当たる日が2日のルールは出さず、3日なら出す", () => {
  // 毎月1日と毎月2日と毎月3日 を別ルールにする。1日=2日分(9月と10月)、など
  const rules = [
    { type: "monthday", value: 1 },
    { type: "monthday", value: 2 },
  ];
  const days = [
    { date: "2026-09-01", totalSamai: null, avgSamai: 100, avgG: 2000 },
    { date: "2026-10-01", totalSamai: null, avgSamai: 120, avgG: 2000 },
    { date: "2026-11-01", totalSamai: null, avgSamai: 110, avgG: 2000 },
    { date: "2026-09-02", totalSamai: null, avgSamai: 100, avgG: 2000 },
    { date: "2026-10-02", totalSamai: null, avgSamai: 100, avgG: 2000 },
    { date: "2026-09-20", totalSamai: null, avgSamai: 10, avgG: 2000 },
  ];
  const base = { medianG: 2000, medianSamai: 20, daysG: 20, daysSamai: 20 };
  const r = ruleEffects(days, rules, base);
  assert.deepEqual(r, [{ label: "毎月1日", diff: 90, days: 3 }]);
});

test("ruleEffects: 差は四捨五入の整数、ラベル関数を差し替えられ、基準なしなら空", () => {
  const rules = [{ type: "monthday", value: 1 }];
  const days = [
    { date: "2026-09-01", totalSamai: null, avgSamai: 11, avgG: 2000 },
    { date: "2026-10-01", totalSamai: null, avgSamai: 12, avgG: 2000 },
    { date: "2026-11-01", totalSamai: null, avgSamai: 12, avgG: 2000 },
  ];
  const base = { medianG: 2000, medianSamai: 20, daysG: 20, daysSamai: 20 };
  // 平均 11.666… − 20 = −8.33 → −8
  assert.deepEqual(ruleEffects(days, rules, base, () => "X"), [{ label: "X", diff: -8, days: 3 }]);
  assert.deepEqual(ruleEffects(days, rules, null), []);
  assert.deepEqual(ruleEffects(days, rules, { ...base, medianSamai: null }), []);
});

test("outcomeOf: 店の基準との差で返す（生の値ではない）", () => {
  const days = [{ date: "2026-10-01", totalSamai: null, avgSamai: 150, avgG: 2600 }];
  const base = { medianG: 2000, medianSamai: 50, daysG: 20, daysSamai: 20 };
  assert.deepEqual(outcomeOf(days, "2026-10-01", base), { g: 600, samai: 100 });
});

test("outcomeOf: avgSamai が null の日は samai null、g は値", () => {
  const days = [{ date: "2026-10-01", totalSamai: null, avgSamai: null, avgG: 2600 }];
  const base = { medianG: 2000, medianSamai: 50, daysG: 20, daysSamai: 20 };
  assert.deepEqual(outcomeOf(days, "2026-10-01", base), { g: 600, samai: null });
  // medianSamai が null でも samai は null
  const days2 = [{ date: "2026-10-01", totalSamai: null, avgSamai: 80, avgG: 2600 }];
  assert.deepEqual(outcomeOf(days2, "2026-10-01", { ...base, medianSamai: null }), { g: 600, samai: null });
});

test("outcomeOf: 行が無い・avgG が null なら null", () => {
  const base = { medianG: 2000, medianSamai: 50, daysG: 20, daysSamai: 20 };
  const days = [{ date: "2026-10-01", totalSamai: null, avgSamai: 80, avgG: null }];
  assert.equal(outcomeOf(days, "2026-10-01", base), null);
  assert.equal(outcomeOf(days, "2026-10-02", base), null);
  assert.equal(outcomeOf([{ date: "2026-10-01", avgG: 2600, avgSamai: 1 }], "2026-10-01", null), null);
});

test("summarize: n が minN 未満なら null、mean は四捨五入の整数", () => {
  assert.equal(summarize([1, 2], 3), null);
  assert.deepEqual(summarize([1, 2, 2], 3), { mean: 2, n: 3 }); // 1.666 → 2
  assert.deepEqual(summarize([-1, -2, 0, -2], 4), { mean: -1, n: 4 }); // -1.25 → -1
  assert.deepEqual(summarize([], 0), null); // 空は平均を作れない
});

const ev = (title, media, g, samai, venue = "dmm:1", frozen = true) => ({
  title,
  media,
  venue,
  date: "2026-10-01",
  frozen,
  outcome: g === undefined ? null : { g, samai },
});

test("strengthTable/pickStrength: 企画名で2回・媒体で3回なら basis media", () => {
  const hist = [ev("A企画", "M媒体", 600, 40), ev("A企画", "M媒体", 700, 50), ev("B企画", "M媒体", 500, 30)];
  const table = strengthTable(hist);
  assert.equal(table["t:A企画"].g, null);
  assert.deepEqual(table["m:M媒体"].g, { mean: 600, n: 3 });
  assert.deepEqual(pickStrength(table, "A企画", "M媒体"), {
    basis: "media",
    g: { mean: 600, n: 3 },
    samai: { mean: 40, n: 3 },
  });
});

test("strengthTable/pickStrength: 企画名で3回あれば basis title", () => {
  const hist = [
    ev("A企画", "M媒体", 600, 40),
    ev("A企画", "M媒体", 700, 50),
    ev("A企画", "M媒体", 800, null),
    ev("B企画", "M媒体", 100, 0),
  ];
  const table = strengthTable(hist);
  assert.deepEqual(table["t:A企画"].g, { mean: 700, n: 3 });
  assert.equal(table["t:A企画"].samai, null); // 差枚は2回だけ
  const p = pickStrength(table, "A企画", "M媒体");
  assert.equal(p.basis, "title");
  assert.deepEqual(p.g, { mean: 700, n: 3 });
});

test("strengthTable/pickStrength: 結果の無い・凍結前のイベントは数えず、無ければ null、媒体なしは t: のみ", () => {
  const hist = [ev("A", null, 600, 40), ev("A", null, 600, 40), ev("A", null, 600, 40), ev("A", null, undefined, null)];
  const table = strengthTable(hist);
  assert.deepEqual(Object.keys(table).sort(), ["t:A"]);
  assert.equal(table["t:A"].g.n, 3);
  assert.equal(pickStrength(table, "Z", "Q"), null);
  assert.equal(pickStrength(table, "Z", null), null);
  assert.equal(pickStrength(table, "A", null).basis, "title");
  // 企画名側が両方 null で媒体側に値がある
  const t2 = strengthTable([ev("A", "M", 1, 1), ev("B", "M", 1, 1), ev("C", "M", 1, 1)]);
  assert.equal(pickStrength(t2, "A", "M").basis, "media");
});

test("venueLift: 1回なら null、2回なら値", () => {
  const h1 = [ev("A", "M", 300, 20, "dmm:1")];
  assert.deepEqual(venueLift(h1, "dmm:1"), { g: null, samai: null });
  const h2 = [ev("A", "M", 300, 20, "dmm:1"), ev("B", null, 321, 25, "dmm:1"), ev("C", null, 9999, 9999, "dmm:2")];
  assert.deepEqual(venueLift(h2, "dmm:1"), { g: { mean: 311, n: 2 }, samai: { mean: 23, n: 2 } });
  // 差枚が1回分だけなら samai だけ null
  const h3 = [ev("A", "M", 300, 20, "dmm:1"), ev("B", null, 320, null, "dmm:1")];
  assert.deepEqual(venueLift(h3, "dmm:1"), { g: { mean: 310, n: 2 }, samai: null });
});

test("busyPercentiles: 3店の medianG 1000/2000/3000 は 0, 0.5, 1", () => {
  const mk = (g) => ({ medianG: g, medianSamai: null, daysG: 10, daysSamai: 0 });
  const r = busyPercentiles({ a: mk(1000), b: mk(2000), c: mk(3000) });
  assert.deepEqual(r, { a: 0, b: 0.5, c: 1 });
});

test("busyPercentiles: 店が1つなら null、baseline が null の店は null で数に入れない", () => {
  const mk = (g) => ({ medianG: g, medianSamai: null, daysG: 10, daysSamai: 0 });
  assert.deepEqual(busyPercentiles({ a: mk(1000) }), { a: null });
  assert.deepEqual(busyPercentiles({ a: mk(1000), b: null }), { a: null, b: null });
  assert.deepEqual(busyPercentiles({ a: mk(1000), b: null, c: mk(2000) }), { a: 0, b: null, c: 1 });
  // 同値は「小さい店」に数えない
  assert.deepEqual(busyPercentiles({ a: mk(1000), b: mk(1000), c: mk(2000) }), { a: 0, b: 0, c: 1 });
});
