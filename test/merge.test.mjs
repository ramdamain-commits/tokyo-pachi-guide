import test from "node:test";
import assert from "node:assert/strict";
import { mergeMonth } from "../collect/merge.mjs";

// 月ファイルのイベントの最小形。テストごとに必要な項目だけ上書きする。
function ev(date, title, over = {}) {
  return {
    id: `${date}|dmm:1||${title}`, date, venue: "dmm:1", media: null, title, anniversary: false,
    group: "unrated", score: 1, points: {}, evidence: [], missing: [],
    frozen: false, outcome: null,
    sources: [{ url: "https://p-town.dmm.com/shops/tokyo/1", checkedAt: "2026-11-01" }],
    ...over,
  };
}

const file = (month, events) => ({ month, generatedAt: "2026-11-01T09:00:00+09:00", events });

test("mergeMonth: today より前は前回のまま frozen、今回取れた過去日は捨てる", () => {
  const prev = file("2026-11", [
    ev("2026-11-03", "過去A", { score: 7.7 }),
    ev("2026-11-04", "過去B"),
  ]);
  // 今回の取得に過去日（11-03 を別の点数で）が混ざっていても、前回のものを残す
  const fresh = [
    ev("2026-11-03", "過去A", { score: 1.1 }),
    ev("2026-11-02", "前回に無い過去日"),
    ev("2026-11-10", "未来"),
  ];
  const out = mergeMonth(prev, fresh, "2026-11-05", "2026-11", new Map());
  const byId = Object.fromEntries(out.events.map((e) => [e.id, e]));
  assert.equal(byId["2026-11-03|dmm:1||過去A"].score, 7.7, "前回の値のまま");
  assert.equal(byId["2026-11-03|dmm:1||過去A"].frozen, true);
  assert.equal(byId["2026-11-04|dmm:1||過去B"].frozen, true);
  assert.equal(byId["2026-11-02|dmm:1||前回に無い過去日"], undefined, "前回に無い過去日は捨てる");
  assert.equal(byId["2026-11-10|dmm:1||未来"].frozen, false);
  assert.equal(out.month, "2026-11");
  assert.equal(out.events.length, 3);
});

test("mergeMonth: 凍結イベントの outcome は null のときだけ埋まり、二度目は変わらない", () => {
  const id = "2026-11-03|dmm:1||過去A";
  const prev = file("2026-11", [ev("2026-11-03", "過去A")]);
  const first = mergeMonth(prev, [], "2026-11-05", "2026-11", new Map([[id, { g: 520, samai: 33 }]]));
  assert.deepEqual(first.events[0].outcome, { g: 520, samai: 33 });
  assert.equal(first.events[0].frozen, true);

  // 二度目: 違う outcome を渡しても、入っている値は変わらない
  const second = mergeMonth(first, [], "2026-11-06", "2026-11", new Map([[id, { g: -999, samai: -999 }]]));
  assert.deepEqual(second.events[0].outcome, { g: 520, samai: 33 });

  // outcomes に無ければ null のまま（欠測を0で埋めない）
  const none = mergeMonth(prev, [], "2026-11-05", "2026-11", new Map());
  assert.equal(none.events[0].outcome, null);
  // 入力は書き換えない
  assert.equal(prev.events[0].outcome, null);
  assert.equal(prev.events[0].frozen, false);
});

test("mergeMonth: today 以降は今回のもので置き換え、前回だけにある未来のイベントは消える", () => {
  const prev = file("2026-11", [
    ev("2026-11-05", "今日の古い", { score: 2.2 }),
    ev("2026-11-20", "中止になった"),
  ]);
  const fresh = [ev("2026-11-05", "今日の古い", { score: 8.8 }), ev("2026-11-21", "新規")];
  const out = mergeMonth(prev, fresh, "2026-11-05", "2026-11", new Map());
  const titles = out.events.map((e) => e.title);
  assert.deepEqual(titles, ["今日の古い", "新規"]);
  assert.equal(out.events[0].score, 8.8, "today 当日は今回のもの");
  assert.equal(out.events[0].frozen, false);
});

test("mergeMonth: 前回が null（初回）なら今回の今日以降だけで作る。月が違うイベントは入れない", () => {
  const fresh = [ev("2026-12-02", "翌月"), ev("2026-11-30", "当月")];
  const out = mergeMonth(null, fresh, "2026-11-05", "2026-11", new Map());
  assert.deepEqual(out.events.map((e) => e.title), ["当月"]);
  assert.equal(out.month, "2026-11");
});
