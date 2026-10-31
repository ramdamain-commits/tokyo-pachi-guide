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
  assertOneError(withEvent((e) => { e.date = "2026-11-7"; }), /日付/);
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

test("validateEventsData: storeStats が配列だとエラー（検査が空回りしない）", () => {
  const input = minimal();
  input.storeStats = [];
  assertOneError(validateEventsData(input), /stats/);
});

test("validateEventsData: storeStats が undefined だとエラー", () => {
  const input = minimal();
  input.storeStats = undefined;
  assertOneError(validateEventsData(input), /stats/);
});

test("validateEventsData: venues が undefined だとエラー1件（イベントごとの参照エラーは重ねない）", () => {
  const input = minimal();
  input.venues = undefined;
  assertOneError(validateEventsData(input), /venues/);
});

test("validateEventsData: 月ファイルの month が YYYY-MM でないとエラー", () => {
  const input = minimal();
  input.months["2026-11"].month = "2026-11-01";
  assertOneError(validateEventsData(input), /YYYY-MM/);
});

test("validateEventsData: 月ファイルの month が月キーと違うとエラー", () => {
  const input = minimal();
  input.months["2026-11"].month = "2026-12";
  assertOneError(validateEventsData(input), /月キー/);
});

// ---- collect-meta の sources・rates.minrepoMatched ----

const withMeta = (meta) => ({ ...minimal(), meta });

test("validateEventsData: meta が無い・sources が無いのは正常（任意）", () => {
  assert.deepEqual(validateEventsData(minimal()).errors, []);
  assert.deepEqual(validateEventsData(withMeta({})).errors, []);
});

test("validateEventsData: meta.sources が dmm / minrepo の文字列配列ならエラー0", () => {
  assert.deepEqual(validateEventsData(withMeta({ sources: ["dmm"] })).errors, []);
  assert.deepEqual(validateEventsData(withMeta({ sources: ["dmm", "minrepo"] })).errors, []);
});

test("validateEventsData: meta.sources が配列でない・未知の要素・文字列でない要素はエラー", () => {
  assertOneError(validateEventsData(withMeta({ sources: "dmm" })), /sources/);
  assertOneError(validateEventsData(withMeta({ sources: ["dmm", "holenavi"] })), /sources/);
  assertOneError(validateEventsData(withMeta({ sources: ["dmm", 1] })), /sources/);
  assertOneError(validateEventsData(withMeta({ sources: null })), /sources/);
});

test("validateEventsData: rates.minrepoMatched は null と 0〜1 の数を許し、それ以外はエラー", () => {
  assert.deepEqual(validateEventsData(withMeta({ rates: { minrepoMatched: null } })).errors, []);
  assert.deepEqual(validateEventsData(withMeta({ rates: { minrepoMatched: 0.41 } })).errors, []);
  assertOneError(validateEventsData(withMeta({ rates: { minrepoMatched: "0.4" } })), /minrepoMatched/);
  assertOneError(validateEventsData(withMeta({ rates: { minrepoMatched: 1.5 } })), /minrepoMatched/);
});

test("validateEventsData: sources に minrepo が無いときは、みんレポ未対応の店が多くても警告しない", () => {
  const input = minimal();
  input.venues["dmm:102"].minrepoTag = null;
  input.venues["dmm:103"].minrepoTag = null;
  assert.deepEqual(validateEventsData({ ...input, meta: { sources: ["dmm"] } }).warnings, []);
  assert.equal(validateEventsData({ ...input, meta: { sources: ["dmm", "minrepo"] } }).warnings.length, 1);
});

// ---- dmm-reports.json（取材実績。無ければ検証を飛ばす） ----

const goodReports = () => ({
  updated: "2026-11-01",
  reports: [
    { reportId: "563472", venue: "dmm:102", date: "2026-11-01", title: "スロセレ", media: null },
    { reportId: "560028", venue: null, date: "2026-10-25", title: "VEPPAN", media: "媒体" },
  ],
});

function withReports(mutate) {
  const input = minimal();
  const dmmReports = goodReports();
  mutate(dmmReports, input);
  return validateEventsData({ ...input, dmmReports });
}

test("validateEventsData: dmmReports が無ければ飛ばす（null・省略どちらもエラー0）", () => {
  assert.deepEqual(validateEventsData({ ...minimal(), dmmReports: null }).errors, []);
  assert.deepEqual(validateEventsData(minimal()).errors, []);
});

test("validateEventsData: 正しい dmmReports（venue は venues のキーか null）はエラー0", () => {
  assert.deepEqual(validateEventsData({ ...minimal(), dmmReports: goodReports() }).errors, []);
});

test("validateEventsData: dmmReports の reportId 重複はエラー", () => {
  assertOneError(withReports((r) => { r.reports[1].reportId = "563472"; }), /reportId.*重複/);
});

test("validateEventsData: dmmReports の日付形式違い・実在しない日付はエラー", () => {
  assertOneError(withReports((r) => { r.reports[0].date = "2026-11-1"; }), /日付/);
  assertOneError(withReports((r) => { r.reports[0].date = "2026-11-31"; }), /日付/);
});

test("validateEventsData: dmmReports の venue が venues に無いキーだとエラー（null は正常）", () => {
  assertOneError(withReports((r) => { r.reports[0].venue = "dmm:999"; }), /venue/);
  assert.deepEqual(withReports((r) => { r.reports[0].venue = null; }).errors, []);
});

test("validateEventsData: dmmReports の reportId が空・title が文字列でないとエラー、reports が配列でないとエラー", () => {
  assertOneError(withReports((r) => { r.reports[0].reportId = ""; }), /reportId/);
  assertOneError(withReports((r) => { r.reports[0].title = null; }), /title/);
  assertOneError(withReports((r) => { r.reports = {}; }), /reports/);
});

test("validateEventsData: venues の形が壊れているときは dmmReports の venue 参照を検査しない（二重に報告しない）", () => {
  const input = minimal();
  const r = validateEventsData({ ...input, venues: null, dmmReports: goodReports() });
  assert.ok(r.errors.every((e) => !/dmm-reports/.test(e)), r.errors.join(" / "));
});
