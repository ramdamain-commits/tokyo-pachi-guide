import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEvent, isAnniversary } from "../collect/score.mjs";

const strengthOf = (gMean, samaiMean, basis = "title") => ({
  basis,
  g: gMean === null ? null : { mean: gMean, n: 8 },
  samai: samaiMean === null ? null : { mean: samaiMean, n: 5 },
});
const lift = (g, s) => ({
  g: g === null ? null : { mean: g, n: 3 },
  samai: s === null ? null : { mean: s, n: 2 },
});

test("scoreEvent: strength が null なら unrated、score は他の要素だけで出す", () => {
  const r = scoreEvent({
    strength: null,
    venueLift: lift(150, 25), // venueG 1, venueSamai 1
    busy: { pct: 0.5, medianG: 2000 }, // 2.5
    overlapCount: 1, // 1
  });
  assert.equal(r.group, "unrated");
  assert.deepEqual(r.missing, ["mediaG", "mediaSamai"]);
  // 合計 5.5、最大 5+5+5+3=18 → 10×5.5/18 = 3.06 → 3.1
  assert.equal(r.score, 3.1);
  assert.equal(r.points.mediaG, null);
  assert.equal(r.points.mediaSamai, null);
  // 片方だけあれば rated
  assert.equal(scoreEvent({ strength: strengthOf(300, null), venueLift: lift(null, null), busy: null, overlapCount: 0 }).group, "rated");
  assert.equal(scoreEvent({ strength: strengthOf(null, 25), venueLift: lift(null, null), busy: null, overlapCount: 0 }).group, "rated");
});

test("scoreEvent: busy 欠測は 0点扱いにしない", () => {
  const base = { strength: strengthOf(750, 125), venueLift: lift(750, 125), overlapCount: 3 };
  // busy あり pct 0.5: 5+5+5+5+2.5+3 = 25.5 / 28
  const withBusy = scoreEvent({ ...base, busy: { pct: 0.5, medianG: 2000 } });
  assert.equal(withBusy.score, 9.1);
  // busy 欠測: 23/23 = 10（分母が5減る）
  const noBusy = scoreEvent({ ...base, busy: null });
  assert.equal(noBusy.score, 10);
  assert.equal(noBusy.points.busy, null);
  assert.deepEqual(noBusy.missing, ["busy"]);
  // busy.pct=0 を渡した場合(0点)と一致しない
  const zeroBusy = scoreEvent({ ...base, busy: { pct: 0, medianG: 1000 } });
  assert.equal(zeroBusy.score, 8.2); // 23/28
  assert.notEqual(noBusy.score, zeroBusy.score);
  // pct が null でも欠測
  assert.equal(scoreEvent({ ...base, busy: { pct: null, medianG: null } }).score, 10);
});

test("scoreEvent: mediaG は mean 750 で 5、mean 749 付近は丸めで 5 に見えるが 740 なら 5 未満、上限は 5", () => {
  const f = (m) => scoreEvent({ strength: strengthOf(m, null), venueLift: lift(null, null), busy: null, overlapCount: 0 }).points.mediaG;
  assert.equal(f(750), 5);
  assert.equal(f(900), 5); // 上限
  assert.equal(f(740), 4.9);
  assert.equal(f(375), 2.5);
  assert.equal(f(-300), 0); // 下限 0
  // venueG も同じ式
  const v = (m) => scoreEvent({ strength: null, venueLift: lift(m, null), busy: null, overlapCount: 0 }).points.venueG;
  assert.equal(v(750), 5);
  assert.equal(v(1500), 5);
  assert.equal(v(740), 4.9);
  assert.equal(v(-10), 0);
});

test("scoreEvent: mediaSamai の下限は -2、score は 0 未満にならない", () => {
  const r = scoreEvent({ strength: strengthOf(null, -100), venueLift: lift(null, null), busy: null, overlapCount: 0 });
  assert.equal(r.points.mediaSamai, -2);
  // 合計 -2 / 最大 5+3 → 負になるので 0 に丸める
  assert.equal(r.score, 0);
  // 下限の手前では丸めだけ
  const r2 = scoreEvent({ strength: strengthOf(null, -25), venueLift: lift(null, null), busy: null, overlapCount: 0 });
  assert.equal(r2.points.mediaSamai, -1);
  // 上限 5
  assert.equal(scoreEvent({ strength: strengthOf(null, 500), venueLift: lift(null, null), busy: null, overlapCount: 0 }).points.mediaSamai, 5);
  // venueSamai も同じ
  const v = scoreEvent({ strength: null, venueLift: lift(null, -100), busy: null, overlapCount: 0 });
  assert.equal(v.points.venueSamai, -2);
});

test("scoreEvent: overlap は 3 で頭打ち、欠測にならない", () => {
  const f = (n) => scoreEvent({ strength: null, venueLift: lift(null, null), busy: null, overlapCount: n });
  assert.equal(f(0).points.overlap, 0);
  assert.equal(f(2).points.overlap, 2);
  assert.equal(f(7).points.overlap, 3);
  assert.equal(f(0).missing.includes("overlap"), false);
  assert.equal(f(3).score, 10);
});

test("scoreEvent: evidence と missing の数の合計は6", () => {
  const inputs = [
    { strength: strengthOf(640, 41), venueLift: lift(310, 22), busy: { pct: 0.81, medianG: 2480 }, overlapCount: 1 },
    { strength: null, venueLift: lift(null, null), busy: null, overlapCount: 0 },
    { strength: strengthOf(640, null), venueLift: lift(null, 22), busy: null, overlapCount: 2 },
    { strength: strengthOf(null, null, "media"), venueLift: lift(310, null), busy: { pct: 0, medianG: 1000 }, overlapCount: 5 },
  ];
  for (const inp of inputs) {
    const r = scoreEvent(inp);
    assert.equal(r.evidence.length + r.missing.length, 6);
    assert.deepEqual(Object.keys(r.points), ["mediaG", "mediaSamai", "venueG", "venueSamai", "busy", "overlap"]);
    // missing と points が null の要素が一致する
    assert.deepEqual(
      r.missing,
      Object.keys(r.points).filter((k) => r.points[k] === null),
    );
  }
});

test("scoreEvent: 文言の例どおりの evidence を出す", () => {
  const r = scoreEvent({
    strength: { basis: "title", g: { mean: 640, n: 8 }, samai: { mean: 41, n: 5 } },
    venueLift: { g: { mean: 310, n: 3 }, samai: { mean: 22, n: 2 } },
    busy: { pct: 0.81, medianG: 2480 },
    overlapCount: 1,
  });
  assert.deepEqual(r.evidence, [
    "同じ企画の過去の開催: 通常日より平均G +640（8回）",
    "同じ企画の過去の開催: 通常日より差枚 +41枚（5回）",
    "この店の過去のイベント日: 通常日より平均G +310（3回）",
    "この店の過去のイベント日: 通常日より差枚 +22枚（2回）",
    "この店の普段の平均G 2,480（東京の上位19%）",
    "同日にほか1件",
  ]);
  assert.deepEqual(r.missing, []);
});

test("scoreEvent: 媒体ベースの文言・負の符号・+0・同日の予定なし", () => {
  const r = scoreEvent({
    strength: { basis: "media", g: { mean: 0, n: 3 }, samai: { mean: -12, n: 4 } },
    venueLift: { g: null, samai: null },
    busy: null,
    overlapCount: 0,
  });
  assert.deepEqual(r.evidence, [
    "同じ媒体の過去の開催: 通常日より平均G +0（3回）",
    "同じ媒体の過去の開催: 通常日より差枚 -12枚（4回）",
    "同日のほかの予定なし",
  ]);
  assert.deepEqual(r.missing, ["venueG", "venueSamai", "busy"]);
  // 千単位の桁区切り
  const big = scoreEvent({ strength: { basis: "title", g: { mean: 1234, n: 3 }, samai: null }, venueLift: lift(null, null), busy: null, overlapCount: 0 });
  assert.equal(big.evidence[0], "同じ企画の過去の開催: 通常日より平均G +1,234（3回）");
});

test("scoreEvent: 点は小数第1位に丸め、合計も丸めた点で出す", () => {
  const r = scoreEvent({ strength: strengthOf(100, null), venueLift: lift(null, null), busy: { pct: 0.81, medianG: 2480 }, overlapCount: 0 });
  assert.equal(r.points.mediaG, 0.7); // 0.666…
  assert.equal(r.points.busy, 4.1); // 4.05 付近
  assert.equal(r.points.overlap, 0);
});

test("isAnniversary: '7周年記念' は true、'5のつく日' は false、annual 12/29 の店の 12/29 は企画名に関係なく true", () => {
  assert.equal(isAnniversary("7周年記念", "2026-11-07", []), true);
  assert.equal(isAnniversary("グランドオープン", "2026-11-07", []), true);
  assert.equal(isAnniversary("創業祭", "2026-11-07", []), true);
  assert.equal(isAnniversary("記念日イベント", "2026-11-07", []), true);
  assert.equal(isAnniversary("5のつく日", "2026-11-07", []), false);
  assert.equal(isAnniversary("5のつく日", "2026-11-07", undefined), false);
  const rules = [{ type: "digit", value: 5 }, { type: "annual", month: 12, day: 29 }];
  assert.equal(isAnniversary("5のつく日", "2026-12-29", rules), true);
  assert.equal(isAnniversary("5のつく日", "2026-12-28", rules), false);
  assert.equal(isAnniversary("5のつく日", "2026-11-15", rules), false); // digit は周年ではない
});

test("scoreEvent の引数に周年の情報は無く、点数は周年に左右されない", () => {
  const input = { strength: strengthOf(300, 50), venueLift: lift(150, null), busy: { pct: 0.3, medianG: 1800 }, overlapCount: 1 };
  const a = scoreEvent(input);
  const b = scoreEvent({ ...input, anniversary: true, title: "7周年記念" });
  assert.deepEqual(a, b);
  assert.equal(scoreEvent.length, 1);
});
