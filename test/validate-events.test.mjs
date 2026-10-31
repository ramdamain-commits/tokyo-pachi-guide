import test from "node:test";
import assert from "node:assert/strict";
import { validateEventsData } from "../validate-events.mjs";

// 検証を通る最小の収集結果。各テストはここから1か所だけ壊す。
function minimal() {
  const venues = {
    "dmm:102": {
      name: "テスト店A", address: "東京都台東区上野1-1-1", municipality: "台東区", area: "上野",
      storeId: "store-a", dmmShopId: "102", minrepoTag: "テスト店A", x: null,
    },
    "dmm:103": {
      name: "テスト店B", address: "東京都新宿区1-1-1", municipality: "新宿区", area: "新宿区",
      storeId: null, dmmShopId: "103", minrepoTag: "テスト店B", x: null,
    },
  };
  const mediaStrength = {
    computedAt: "2026-11-01",
    entries: [{ key: "t:裏桜梅桃李", g: { mean: 640, n: 8 }, samai: null }],
  };
  const storeStats = {
    "dmm:102": {
      baseline: {
        medianG: 2480, medianSamai: 12, daysG: 61, daysSamai: 24,
        sourceUrl: "https://min-repo.com/tag/test/", checkedAt: "2026-11-01",
      },
      busyPct: 0.81, ruleEffects: [], lift: { g: null, samai: null },
    },
    "dmm:103": { baseline: null, busyPct: null, ruleEffects: [], lift: { g: null, samai: null } },
  };
  const rated = {
    id: "2026-11-07|dmm:102|パチ＆スロ必勝本|裏桜梅桃李", date: "2026-11-07", venue: "dmm:102",
    media: "パチ＆スロ必勝本", title: "裏桜梅桃李", anniversary: false,
    group: "rated", score: 6.4,
    points: { mediaG: 4.3, mediaSamai: null, venueG: null, venueSamai: null, busy: 4.1, overlap: 1 },
    evidence: ["根拠"], missing: ["mediaSamai", "venueG", "venueSamai"],
    frozen: false, outcome: null,
    sources: [{ url: "https://p-town.dmm.com/shops/tokyo/102", checkedAt: "2026-11-01" }],
  };
  const unrated = {
    id: "2026-11-08|dmm:103||特日", date: "2026-11-08", venue: "dmm:103",
    media: null, title: "特日", anniversary: false,
    group: "unrated", score: 2,
    points: { mediaG: null, mediaSamai: null, venueG: null, venueSamai: null, busy: null, overlap: 1 },
    evidence: [], missing: ["mediaG", "mediaSamai", "venueG", "venueSamai", "busy"],
    frozen: true, outcome: { g: 520, samai: null },
    sources: [{ url: "https://p-town.dmm.com/shops/tokyo/103", checkedAt: "2026-11-01" }],
  };
  return { venues, mediaStrength, storeStats, months: { "2026-11": { month: "2026-11", events: [rated, unrated] } } };
}

// 最初のイベント（rated）を書き換えて検証する
function withEvent(mutate) {
  const input = minimal();
  mutate(input.months["2026-11"].events[0], input);
  return validateEventsData(input);
}

function assertOneError(result, re) {
  assert.equal(result.errors.length, 1, result.errors.join(" / "));
  assert.match(result.errors[0], re);
}

test("validateEventsData: 正しい最小データはエラー0", () => {
  const { errors, warnings } = validateEventsData(minimal());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("validateEventsData: 日付が YYYY-MM-DD でないとエラー", () => {
  assertOneError(withEvent((e) => { e.date = "2026/11/07"; }), /日付/);
});

test("validateEventsData: 実在しない日付はエラー", () => {
  assertOneError(withEvent((e) => { e.date = "2026-11-31"; }), /日付/);
});

test("validateEventsData: 月ファイルの month と違う月の日付はエラー", () => {
  assertOneError(withEvent((e) => { e.date = "2026-12-07"; }), /月/);
});

test("validateEventsData: venue が venues に無いとエラー", () => {
  assertOneError(withEvent((e) => { e.venue = "dmm:999"; }), /venue/);
});

test("validateEventsData: sources が空だとエラー", () => {
  assertOneError(withEvent((e) => { e.sources = []; }), /sources/);
});

test("validateEventsData: sources の URL が http(s):// でないとエラー", () => {
  assertOneError(withEvent((e) => { e.sources[0].url = "ftp://example.com/"; }), /URL/);
});

test("validateEventsData: sources の checkedAt の形式違いはエラー", () => {
  assertOneError(withEvent((e) => { e.sources[0].checkedAt = "2026-11-1"; }), /checkedAt/);
});

test("validateEventsData: group が rated|unrated 以外だとエラー", () => {
  assertOneError(withEvent((e) => { e.group = "other"; }), /group/);
});

test("validateEventsData: rated なのに mediaG と mediaSamai が両方 null だとエラー", () => {
  assertOneError(
    withEvent((e) => { e.points.mediaG = null; e.missing = ["mediaG", ...e.missing]; }),
    /rated/,
  );
});

test("validateEventsData: missing に入っているのに points が null でないとエラー", () => {
  assertOneError(withEvent((e) => { e.missing.push("busy"); }), /missing/);
});

test("validateEventsData: points が null なのに missing に無いとエラー", () => {
  assertOneError(withEvent((e) => { e.missing = ["venueG", "venueSamai"]; }), /missing/);
});

test("validateEventsData: score が 10 を超えるとエラー", () => {
  assertOneError(withEvent((e) => { e.score = 10.1; }), /score/);
});

test("validateEventsData: score が 0 未満だとエラー", () => {
  assertOneError(withEvent((e) => { e.score = -0.1; }), /score/);
});

test("validateEventsData: score が 0 と 10 ちょうどなら通る", () => {
  const input = minimal();
  input.months["2026-11"].events[0].score = 10;
  input.months["2026-11"].events[1].score = 0;
  assert.deepEqual(validateEventsData(input).errors, []);
});

test("validateEventsData: id が重複するとエラー", () => {
  const input = minimal();
  input.months["2026-11"].events[1].id = input.months["2026-11"].events[0].id;
  assertOneError(validateEventsData(input), /id/);
});

test("validateEventsData: frozen: false なのに outcome があるとエラー", () => {
  assertOneError(withEvent((e) => { e.outcome = { g: 100, samai: null }; }), /outcome/);
});

test("validateEventsData: store-stats の baseline に sourceUrl が無いとエラー", () => {
  const input = minimal();
  delete input.storeStats["dmm:102"].baseline.sourceUrl;
  assertOneError(validateEventsData(input), /sourceUrl/);
});

test("validateEventsData: baseline が null の店は正常", () => {
  assert.deepEqual(validateEventsData(minimal()).errors, []);
});

test("validateEventsData: みんレポ未対応の店が5割を超えると警告", () => {
  const input = minimal();
  input.venues["dmm:102"].minrepoTag = null;
  input.venues["dmm:103"].minrepoTag = null;
  const { errors, warnings } = validateEventsData(input);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /みんレポ/);
});

test("validateEventsData: みんレポ未対応の店がちょうど5割なら警告しない", () => {
  const input = minimal();
  input.venues["dmm:103"].minrepoTag = null;
  assert.deepEqual(validateEventsData(input).warnings, []);
});

test("validateEventsData: ファイル全体の形（venues / stats のラッパー）でも同じ結果になる", () => {
  const input = minimal();
  const wrapped = {
    ...input,
    venues: { updated: "2026-11-01", venues: input.venues },
    storeStats: { updated: "2026-11-01", stats: input.storeStats },
  };
  assert.deepEqual(validateEventsData(wrapped), validateEventsData(input));
  delete wrapped.storeStats.stats["dmm:102"].baseline.sourceUrl;
  assertOneError(validateEventsData(wrapped), /sourceUrl/);
});
