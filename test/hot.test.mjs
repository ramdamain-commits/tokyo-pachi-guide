import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectHotEvents,
  staleness,
  ruleEffectLabel,
  missingLabels,
  areaOptions,
  buildRuleEffectIndex,
  esc,
  safeUrl,
  selectUpcomingEvents,
  minrepoLink,
  minrepoTagUrl,
  usesMinrepo,
  reportSummary,
  dmmReportRow,
  dmmReportsLinkUrl,
  dmmReportLinkHtml,
} from "../hot.mjs";

const TODAY = "2026-11-01";

function ev(id, date, group, score, venue = "dmm:1") {
  return { id, date, venue, group, score };
}

const venues = {
  "dmm:1": { name: "A店", area: "上野", storeId: "store-a" },
  "dmm:2": { name: "B店", area: "八王子市", storeId: null },
  "dmm:3": { name: "C店", area: "新宿", storeId: "store-c" },
};

test("selectHotEvents: 8日後の予定は days 7 で入らず、days null で入る", () => {
  const events = [
    ev("d7", "2026-11-08", "rated", 5),
    ev("d8", "2026-11-09", "rated", 9),
  ];
  const seven = selectHotEvents(events, { today: TODAY, days: 7 });
  assert.deepEqual(seven.rated.map((e) => e.id), ["d7"]);
  const all = selectHotEvents(events, { today: TODAY, days: null });
  assert.deepEqual(all.rated.map((e) => e.id), ["d8", "d7"]);
});

test("selectHotEvents: 昨日の予定は入らない（今日は入る）", () => {
  const events = [
    ev("yesterday", "2026-10-31", "rated", 9),
    ev("today", "2026-11-01", "rated", 1),
  ];
  const r = selectHotEvents(events, { today: TODAY, days: null });
  assert.deepEqual(r.rated.map((e) => e.id), ["today"]);
  assert.equal(r.total, 1);
});

test("selectHotEvents: 月またぎ・年またぎでも日数が正しい", () => {
  const events = [
    ev("in", "2027-01-03", "rated", 1),
    ev("out", "2027-01-04", "rated", 1),
  ];
  const r = selectHotEvents(events, { today: "2026-12-27", days: 7 });
  assert.deepEqual(r.rated.map((e) => e.id), ["in"]);
});

test("selectHotEvents: unrated は rated に混ざらない", () => {
  const events = [
    ev("r1", "2026-11-02", "rated", 3),
    ev("u1", "2026-11-02", "unrated", 8),
    ev("r2", "2026-11-03", "rated", 6),
  ];
  const r = selectHotEvents(events, { today: TODAY });
  assert.deepEqual(r.rated.map((e) => e.id), ["r2", "r1"]);
  assert.deepEqual(r.unrated.map((e) => e.id), ["u1"]);
  assert.equal(r.total, 3);
});

test("selectHotEvents: rated は点数の高い順（同点は日付の早い順）、unrated は日付の早い順（同日は点数の高い順）", () => {
  const events = [
    ev("r-late", "2026-11-05", "rated", 5),
    ev("r-early", "2026-11-02", "rated", 5),
    ev("r-top", "2026-11-06", "rated", 9),
    ev("u-low", "2026-11-03", "unrated", 1),
    ev("u-high", "2026-11-03", "unrated", 4),
    ev("u-first", "2026-11-02", "unrated", 0),
  ];
  const r = selectHotEvents(events, { today: TODAY });
  assert.deepEqual(r.rated.map((e) => e.id), ["r-top", "r-early", "r-late"]);
  assert.deepEqual(r.unrated.map((e) => e.id), ["u-first", "u-high", "u-low"]);
});

test("selectHotEvents: limit は rated と unrated それぞれに掛かり、total は limit 前の件数", () => {
  const events = [
    ev("r1", "2026-11-02", "rated", 3),
    ev("r2", "2026-11-02", "rated", 2),
    ev("r3", "2026-11-02", "rated", 1),
    ev("u1", "2026-11-02", "unrated", 3),
    ev("u2", "2026-11-03", "unrated", 2),
    ev("u3", "2026-11-04", "unrated", 1),
  ];
  const r = selectHotEvents(events, { today: TODAY, limit: 2 });
  assert.equal(r.rated.length, 2);
  assert.equal(r.unrated.length, 2);
  assert.equal(r.total, 6);
  const inf = selectHotEvents(events, { today: TODAY, limit: Infinity });
  assert.equal(inf.rated.length, 3);
  assert.equal(inf.unrated.length, 3);
});

test("selectHotEvents: rated が0件でも unrated は返る", () => {
  const events = [
    ev("u1", "2026-11-02", "unrated", 3),
    ev("u2", "2026-11-03", "unrated", 2),
  ];
  const r = selectHotEvents(events, { today: TODAY });
  assert.deepEqual(r.rated, []);
  assert.deepEqual(r.unrated.map((e) => e.id), ["u1", "u2"]);
  assert.equal(r.total, 2);
});

test("selectHotEvents: area で絞る（venues から引いたエリア。店が引けない予定は除く）", () => {
  const events = [
    ev("ueno", "2026-11-02", "rated", 3, "dmm:1"),
    ev("hachi", "2026-11-02", "rated", 5, "dmm:2"),
    ev("ueno-u", "2026-11-03", "unrated", 1, "dmm:1"),
    ev("ghost", "2026-11-03", "rated", 9, "dmm:999"),
  ];
  const r = selectHotEvents(events, { today: TODAY, area: "上野", venues });
  assert.deepEqual(r.rated.map((e) => e.id), ["ueno"]);
  assert.deepEqual(r.unrated.map((e) => e.id), ["ueno-u"]);
  assert.equal(r.total, 2);
  const none = selectHotEvents(events, { today: TODAY, area: "渋谷", venues });
  assert.equal(none.total, 0);
  // area 未指定なら venues に無い店の予定も残る
  const everything = selectHotEvents(events, { today: TODAY });
  assert.equal(everything.total, 4);
});

test("selectHotEvents: 入力の配列を並べ替えて壊さない", () => {
  const events = [ev("b", "2026-11-03", "rated", 1), ev("a", "2026-11-02", "rated", 9)];
  const copy = events.map((e) => e.id);
  selectHotEvents(events, { today: TODAY });
  assert.deepEqual(events.map((e) => e.id), copy);
});

test("staleness: 35日は stale でなく、36日は stale", () => {
  assert.deepEqual(staleness("2026-09-26T09:04:00+09:00", "2026-10-31"), { days: 35, stale: false });
  assert.deepEqual(staleness("2026-09-25T09:04:00+09:00", "2026-10-31"), { days: 36, stale: true });
  assert.deepEqual(staleness("2026-10-31T09:04:00+09:00", "2026-10-31"), { days: 0, stale: false });
});

test("staleness: 読めない日付は stale 扱い", () => {
  assert.equal(staleness(null, "2026-10-31").stale, true);
  assert.equal(staleness("not-a-date", "2026-10-31").stale, true);
});

test("ruleEffectLabel: 正の差は '+18枚'、負の差は '-12枚' と出す", () => {
  assert.equal(ruleEffectLabel({ label: "5のつく日", diff: 18, days: 9 }), "通常日比 +18枚（9日）");
  assert.equal(ruleEffectLabel({ label: "ゾロ目", diff: -12, days: 4 }), "通常日比 -12枚（4日）");
  assert.equal(ruleEffectLabel({ label: "x", diff: 0, days: 3 }), "通常日比 ±0枚（3日）");
});

test("ruleEffectLabel: diff が欠測（undefined・NaN・非数）なら 0 で埋めず null", () => {
  assert.equal(ruleEffectLabel({ label: "x", days: 3 }), null);
  assert.equal(ruleEffectLabel({ label: "x", diff: undefined, days: 3 }), null);
  assert.equal(ruleEffectLabel({ label: "x", diff: NaN, days: 3 }), null);
  assert.equal(ruleEffectLabel({ label: "x", diff: null, days: 3 }), null);
  assert.equal(ruleEffectLabel({ label: "x", diff: "18", days: 3 }), null);
  assert.equal(ruleEffectLabel({ label: "x", diff: Infinity, days: 3 }), null);
  assert.equal(ruleEffectLabel(undefined), null);
});

test("ruleEffectLabel: days が欠落・非数なら日数を省く", () => {
  assert.equal(ruleEffectLabel({ label: "x", diff: 18 }), "通常日比 +18枚");
  assert.equal(ruleEffectLabel({ label: "x", diff: -12, days: NaN }), "通常日比 -12枚");
  assert.equal(ruleEffectLabel({ label: "x", diff: 5, days: null }), "通常日比 +5枚");
  // days が 0 は欠測でなく 0日として出す
  assert.equal(ruleEffectLabel({ label: "x", diff: 5, days: 0 }), "通常日比 +5枚（0日）");
});

test("esc: <script> と引用符・アンパサンドをエスケープする", () => {
  assert.equal(
    esc("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;"
  );
  assert.equal(esc(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
  // 二重エスケープしない順序（& を最初に処理）
  assert.equal(esc("<&>"), "&lt;&amp;&gt;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(123), "123");
});

test("safeUrl: http(s) は通し、属性を壊す文字はエスケープする", () => {
  assert.equal(safeUrl("https://p-town.dmm.com/shops/tokyo/102"), "https://p-town.dmm.com/shops/tokyo/102");
  assert.equal(safeUrl("http://example.com/?a=1&b=2"), "http://example.com/?a=1&amp;b=2");
  assert.equal(
    safeUrl('https://a.example/" onmouseover="alert(1)'),
    "https://a.example/&quot; onmouseover=&quot;alert(1)"
  );
});

test("safeUrl: javascript: と data: は通さない", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("JavaScript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(safeUrl("//example.com/"), "");
  assert.equal(safeUrl("example.com"), "");
  assert.equal(safeUrl(null), "");
  assert.equal(safeUrl(undefined), "");
});

test("safeUrl: スキームの大文字小文字は区別せず通す（HTTP://EXAMPLE.COM は通す）", () => {
  assert.equal(safeUrl("HTTP://EXAMPLE.COM"), "HTTP://EXAMPLE.COM");
  assert.equal(safeUrl("Https://Example.com/x"), "Https://Example.com/x");
});

test("safeUrl: 先頭に空白・制御文字がある URL は通さない", () => {
  assert.equal(safeUrl(" https://example.com/"), "");
  assert.equal(safeUrl("\thttps://example.com/"), "");
  assert.equal(safeUrl("\nhttps://example.com/"), "");
  assert.equal(safeUrl(" javascript:alert(1)"), "");
});

test("missingLabels: 日本語名にして、同じ名前は1回だけ出す", () => {
  assert.deepEqual(
    missingLabels(["mediaG", "mediaSamai", "venueG", "venueSamai", "busy"]),
    ["企画の過去の開催", "この店の過去のイベント日", "この店の普段のにぎわい"]
  );
  assert.deepEqual(missingLabels([]), []);
  assert.deepEqual(missingLabels(undefined), []);
  // 未知の要素名は黙って捨てない
  assert.deepEqual(missingLabels(["mystery"]), ["mystery"]);
});

test("areaOptions: 予定がある店のエリアだけ、AREA_ORDER の順 → 残りは五十音順", () => {
  const events = [
    ev("1", "2026-11-02", "rated", 1, "dmm:3"), // 新宿
    ev("2", "2026-11-02", "rated", 1, "dmm:1"), // 上野
    ev("3", "2026-11-02", "rated", 1, "dmm:2"), // 八王子市
    ev("4", "2026-11-02", "rated", 1, "dmm:4"), // 青梅市
    ev("5", "2026-11-02", "rated", 1, "dmm:999"), // 店不明
  ];
  const v = { ...venues, "dmm:4": { name: "D店", area: "青梅市" }, "dmm:5": { name: "E店", area: "渋谷" } };
  const order = ["上野", "秋葉原", "新宿", "渋谷"];
  assert.deepEqual(areaOptions(events, v, order), ["上野", "新宿", "青梅市", "八王子市"]);
});

test("buildRuleEffectIndex: storeId ↔ venues の storeId で引き、ラベルごとに効果を返す", () => {
  const stats = {
    "dmm:1": { ruleEffects: [{ label: "5のつく日", diff: 18, days: 9 }] },
    "dmm:2": { ruleEffects: [{ label: "ゾロ目", diff: 3, days: 2 }] }, // storeId なしの店
    "dmm:3": { ruleEffects: [] },
  };
  const idx = buildRuleEffectIndex(venues, stats);
  assert.deepEqual(idx.get("store-a").get("5のつく日"), { label: "5のつく日", diff: 18, days: 9 });
  assert.equal(idx.get("store-a").get("ゾロ目"), undefined);
  assert.equal(idx.has("store-c"), false);
  assert.equal(idx.size, 1);
});

test("buildRuleEffectIndex: stats が無い・壊れていても空で返る", () => {
  assert.equal(buildRuleEffectIndex(venues, null).size, 0);
  assert.equal(buildRuleEffectIndex(null, {}).size, 0);
  assert.equal(buildRuleEffectIndex(venues, { "dmm:1": {} }).size, 0);
});

// ---- 近日の予定一覧（DMM だけで公開する形） ----

const ids = (r) => r.events.map((e) => e.id);

test("selectUpcomingEvents: 今日から7日までを日付の早い順に並べ、過去日と8日後は除く", () => {
  const events = [
    ev("d8", "2026-11-09", "unrated", 0),
    ev("d7", "2026-11-08", "unrated", 0),
    ev("today", "2026-11-01", "unrated", 0),
    ev("past", "2026-10-31", "unrated", 0),
    ev("d3", "2026-11-04", "unrated", 0),
  ];
  const r = selectUpcomingEvents(events, { today: TODAY });
  assert.deepEqual(ids(r), ["today", "d3", "d7"]);
  assert.equal(r.total, 3);
});

test("selectUpcomingEvents: rated と unrated を分けず、score に関係なく日付順（点数停止中の表示）", () => {
  const events = [ev("b", "2026-11-03", "rated", 9), ev("a", "2026-11-02", "unrated", 0)];
  assert.deepEqual(ids(selectUpcomingEvents(events, { today: TODAY })), ["a", "b"]);
});

test("selectUpcomingEvents: 同日は同じ店の同日の予定数が多い店が先、同数なら店名順", () => {
  const events = [
    ev("a1", "2026-11-02", "unrated", 0, "dmm:1"), // A店 1件
    ev("b1", "2026-11-02", "unrated", 0, "dmm:2"), // B店 2件
    ev("b2", "2026-11-02", "unrated", 0, "dmm:2"),
    ev("c1", "2026-11-02", "unrated", 0, "dmm:3"), // C店 1件
  ];
  assert.deepEqual(ids(selectUpcomingEvents(events, { today: TODAY, venues })), ["b1", "b2", "a1", "c1"]);
});

test("selectUpcomingEvents: 同日の予定数は日ごとに数える（別の日の件数は混ぜない）", () => {
  const events = [
    ev("b-d3", "2026-11-03", "unrated", 0, "dmm:2"),
    ev("a-d2", "2026-11-02", "unrated", 0, "dmm:1"),
    ev("c-d3", "2026-11-03", "unrated", 0, "dmm:3"),
    ev("b-d2", "2026-11-02", "unrated", 0, "dmm:2"),
    ev("b2-d2", "2026-11-02", "unrated", 0, "dmm:2"),
  ];
  assert.deepEqual(ids(selectUpcomingEvents(events, { today: TODAY, venues })), ["b-d2", "b2-d2", "a-d2", "b-d3", "c-d3"]);
});

test("selectUpcomingEvents: limit で切り、total は切る前の件数。days:null / limit:Infinity で全件", () => {
  const events = Array.from({ length: 35 }, (_, i) => ev(`e${i}`, "2026-11-02", "unrated", 0));
  events.push(ev("far", "2026-12-20", "unrated", 0));
  const r = selectUpcomingEvents(events, { today: TODAY });
  assert.equal(r.events.length, 30);
  assert.equal(r.total, 35);
  const all = selectUpcomingEvents(events, { today: TODAY, days: null, limit: Infinity });
  assert.equal(all.events.length, 36);
  assert.equal(all.total, 36);
});

test("selectUpcomingEvents: area で絞る。店を引けない予定は除く", () => {
  const events = [ev("u", "2026-11-02", "unrated", 0, "dmm:1"), ev("h", "2026-11-02", "unrated", 0, "dmm:2"), ev("x", "2026-11-02", "unrated", 0, "dmm:99")];
  assert.deepEqual(ids(selectUpcomingEvents(events, { today: TODAY, area: "上野", venues })), ["u"]);
  assert.equal(selectUpcomingEvents(events, { today: TODAY }).total, 3);
});

test("selectUpcomingEvents: 入力を並べ替えない", () => {
  const events = [ev("b", "2026-11-03", "unrated", 0), ev("a", "2026-11-02", "unrated", 0)];
  selectUpcomingEvents(events, { today: TODAY });
  assert.deepEqual(events.map((e) => e.id), ["b", "a"]);
});

test("usesMinrepo: sources に minrepo があるときだけ true（無い・sources 無し・壊れた値は false）", () => {
  assert.equal(usesMinrepo({ sources: ["dmm", "minrepo"] }), true);
  assert.equal(usesMinrepo({ sources: ["dmm"] }), false);
  assert.equal(usesMinrepo({}), false);
  assert.equal(usesMinrepo(null), false);
  assert.equal(usesMinrepo({ sources: "minrepo" }), false);
});

test("minrepoTagUrl: collect/minrepo.mjs の minrepoTagUrl と同じ形（%表記は小文字）", async () => {
  const { minrepoTagUrl: original } = await import("../collect/minrepo.mjs");
  for (const tag of ["エスパス日拓上野新館", "ABC店", "a b&c", "ＤＡＭ"]) {
    assert.equal(minrepoTagUrl(tag), original(tag), tag);
  }
  assert.equal(minrepoTagUrl("店"), "https://min-repo.com/tag/%e5%ba%97/");
});

test("minrepoLink: minrepoTag があればタグページ、無ければ店名検索", () => {
  assert.equal(minrepoLink({ name: "A店", minrepoTag: "タグ名" }), minrepoTagUrl("タグ名"));
  assert.equal(minrepoLink({ name: "A 店&", minrepoTag: null }), `https://min-repo.com/?s=${encodeURIComponent("A 店&")}`);
  assert.equal(minrepoLink({ name: "A店" }), `https://min-repo.com/?s=${encodeURIComponent("A店")}`);
  assert.equal(minrepoLink({ name: "A店", minrepoTag: "" }), `https://min-repo.com/?s=${encodeURIComponent("A店")}`);
});

test("minrepoLink: リンクを作れないとき（店不明・店名なし）は null。結果は safeUrl を通る", () => {
  assert.equal(minrepoLink(undefined), null);
  assert.equal(minrepoLink({ name: "" }), null);
  assert.ok(safeUrl(minrepoLink({ name: "<script>", minrepoTag: null })).startsWith("https://min-repo.com/?s="));
});

test("selectUpcomingEvents: 同日で予定数も同じなら店名順（店キーの順ではない）", () => {
  const v = { "dmm:1": { name: "ゼット店", area: "上野" }, "dmm:2": { name: "あ店", area: "上野" } };
  const events = [ev("z", "2026-11-02", "unrated", 0, "dmm:1"), ev("a", "2026-11-02", "unrated", 0, "dmm:2")];
  assert.deepEqual(ids(selectUpcomingEvents(events, { today: TODAY, venues: v })), ["a", "z"]);
});

// ---- DMM 取材実績（参考表示） ----

const rep = (reportId, venue, date, title = "取材") => ({ reportId, venue, date, title, media: null });

test("reportSummary: 直近365日・店が一致するものを数え、いちばん新しい取材を last にする", () => {
  const reports = [
    rep("1", "dmm:1", "2026-10-01", "古い方"),
    rep("2", "dmm:1", "2026-10-20", "新しい方"),
    rep("3", "dmm:2", "2026-10-25", "他店"),
    rep("4", "dmm:1", null, "日付なし"),
  ];
  assert.deepEqual(reportSummary(reports, "dmm:1", TODAY), { count: 2, last: { date: "2026-10-20", title: "新しい方" } });
});

test("reportSummary: 365日前の当日は数え、366日前は数えない（今日の分は数える・未来は数えない）", () => {
  // TODAY=2026-11-01 の365日前は 2025-11-01
  assert.equal(reportSummary([rep("1", "dmm:1", "2025-11-01")], "dmm:1", TODAY).count, 1);
  assert.equal(reportSummary([rep("1", "dmm:1", "2025-10-31")], "dmm:1", TODAY).count, 0);
  assert.equal(reportSummary([rep("1", "dmm:1", "2026-11-01")], "dmm:1", TODAY).count, 1);
  assert.equal(reportSummary([rep("1", "dmm:1", "2026-11-02")], "dmm:1", TODAY).count, 0);
});

test("reportSummary: 該当が無ければ count 0・last null。reports が配列でなくても落ちない", () => {
  assert.deepEqual(reportSummary([rep("1", "dmm:2", "2026-10-01")], "dmm:1", TODAY), { count: 0, last: null });
  assert.deepEqual(reportSummary(undefined, "dmm:1", TODAY), { count: 0, last: null });
});

test("reportSummary: 同じ日に2件あるときは reportId の大きい方（後から載った方）を last にする", () => {
  const reports = [rep("10", "dmm:1", "2026-10-20", "A"), rep("20", "dmm:1", "2026-10-20", "B")];
  assert.equal(reportSummary(reports, "dmm:1", TODAY).last.title, "B");
});

test("dmmReportRow: 「DMM取材実績（直近1年）: N回・直近 YYYY-MM-DD「取材名」」を出す", () => {
  const reports = [rep("1", "dmm:1", "2026-10-01"), rep("2", "dmm:1", "2026-10-20", "スロセレ")];
  const html = dmmReportRow({ reports, venueKey: "dmm:1", today: TODAY });
  assert.ok(html.includes("DMM取材実績（直近1年）: 2回・直近 2026-10-20「スロセレ」"), html);
});

test("dmmReportRow: 0回なら「なし」。reports が読めない（null）ときは行を出さない", () => {
  const html = dmmReportRow({ reports: [], venueKey: "dmm:1", today: TODAY });
  assert.ok(html.includes("DMM取材実績（直近1年）: なし"), html);
  assert.ok(!html.includes("0回"));
  assert.equal(dmmReportRow({ reports: null, venueKey: "dmm:1", today: TODAY }), "");
  assert.equal(dmmReportRow({ reports: undefined, venueKey: "dmm:1", today: TODAY }), "");
});

test("dmmReportRow: 取材名はエスケープする", () => {
  const html = dmmReportRow({ reports: [rep("1", "dmm:1", "2026-10-20", "<b>x</b>")], venueKey: "dmm:1", today: TODAY });
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!html.includes("<b>"));
});

test("dmmReportsLinkUrl: dmmShopId が数字だけのときだけ /shops/tokyo/<id>/reports を返す", () => {
  assert.equal(dmmReportsLinkUrl({ dmmShopId: "102" }), "https://p-town.dmm.com/shops/tokyo/102/reports");
  assert.equal(dmmReportsLinkUrl({ dmmShopId: "10a" }), null);
  assert.equal(dmmReportsLinkUrl({ dmmShopId: "../x" }), null);
  assert.equal(dmmReportsLinkUrl({ dmmShopId: "" }), null);
  assert.equal(dmmReportsLinkUrl({}), null);
  assert.equal(dmmReportsLinkUrl(undefined), null);
  assert.ok(safeUrl(dmmReportsLinkUrl({ dmmShopId: "102" })).startsWith("https://"));
});

test("dmmReportLinkHtml: 数字の店IDならリンク「DMMの来店レポート」、そうでなければ空", () => {
  const a = dmmReportLinkHtml({ dmmShopId: "102" });
  assert.ok(a.includes('href="https://p-town.dmm.com/shops/tokyo/102/reports"'));
  assert.ok(a.includes(">DMMの来店レポート</a>"));
  assert.equal(dmmReportLinkHtml({ dmmShopId: "x" }), "");
});
