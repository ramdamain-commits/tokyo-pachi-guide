import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runCollect, parseArgs } from "../scripts/collect-events.mjs";
import { FetchError } from "../collect/http.mjs";
import { minrepoCategoryUrl, minrepoTagUrl } from "../collect/minrepo.mjs";
import { addDaysStr } from "../collect/dates.mjs";

const TODAY = "2026-11-05";
const NOW = new Date("2026-11-05T00:04:00Z"); // JST 09:04
const DMM1 = "https://p-town.dmm.com/schedules/tokyo";
const DMM2 = "https://p-town.dmm.com/schedules/tokyo?page=2";

// ---- 偽のページを組み立てる小さな部品 ----

/** DMM 一覧の1ページ。items: { id, name, address, date(YYYY-MM-DD), media, title }。nextPage があれば次ページへのリンクを付ける */
function dmmPage(items, nextPage = null) {
  const lis = items
    .map((it) => {
      const [y, m, d] = it.date.split("-");
      const icons = [it.media, it.title].filter(Boolean).map((t) => `<span class="text-icon">${t}</span>`).join("");
      return (
        `<li class="unit pr-badge"><a class="link " href=/shops/tokyo/${it.id}>` +
        `<p class="title _ellipsis">${it.name}</p><p class="lead">${it.address}</p>` +
        `<p class="date -fz12">実施日：${y}/${m}/${d}</p>` +
        `<div class="right">${icons}</div></a></li>`
      );
    })
    .join("\n");
  const pager = nextPage ? `<ul class="pagination-link"><li><a href="${DMM1}?page=${nextPage}">${nextPage}</a></li></ul>` : "";
  return `<html><body><ul class="list-units">${lis}</ul>${pager}</body></html>`;
}

/** みんレポのカテゴリ一覧 */
function categoryPage(tags) {
  return `<html><body>${tags
    .map((t) => `<div class="hall_header"><span class="hall_name"><a href="${minrepoTagUrl(t)}">${t}</a></span></div>`)
    .join("")}</body></html>`;
}

/** みんレポの店ページ。dayValues: { date, g, samai } の配列 */
function storePage(dayValues, ruleText = "") {
  const wd = "日月火水木金土";
  const rows = dayValues
    .map(({ date, g, samai }, i) => {
      const [y, m, d] = date.split("-").map(Number);
      const w = wd[new Date(y, m - 1, d).getDay()];
      const sg = g == null ? "-" : String(g);
      const ss = samai == null ? "-" : (samai >= 0 ? "+" : "") + samai;
      return `<tr><td><a href="https://min-repo.com/${i}/">${m}/${d}(${w})</a></td><td>${ss}</td><td>${ss}</td><td>${sg}</td><td></td></tr>`;
    })
    .join("");
  return (
    `<html><body><table class="sou"><tbody><tr><th>旧イベント日</th><td>${ruleText}</td></tr></tbody></table>` +
    `<h2>テスト データ一覧</h2><table><tbody><tr><th>日付</th><th>総差枚</th><th>平均差枚</th><th>平均G</th><th>機種</th></tr>${rows}</tbody></table></body></html>`
  );
}

/** endDate から n 日さかのぼる日別実績。overrides: { 日付: { g, samai } } で一部の日を差し替える */
function days(endDate, n, base = { g: 2000, samai: 0 }, overrides = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDaysStr(endDate, -i);
    out.push({ date, ...(overrides[date] ?? base) });
  }
  return out;
}

const shop = (id, name, date, extra = {}) => ({
  id, name, address: `東京都台東区上野${id}-1-1`, date, media: "媒体X", title: `企画${id}`, ...extra,
});

/**
 * 実行環境の偽物。files は readJson が返す前回データ、pages は URL → 本文（Error なら投げる）。
 * 未登録の URL は 404。fetcher に渡された URL と writeJson の呼び出しを記録する。
 */
function makeEnv({ files = {}, pages = {} } = {}) {
  const urls = [];
  const writes = [];
  const logs = [];
  const all = { "stores.json": { updated: "2026-08-01", stores: [] }, ...files };
  return {
    urls, writes, logs,
    fetcher: {
      get: async (url) => {
        urls.push(url);
        const p = pages[url];
        if (p instanceof Error) throw p;
        if (p === undefined) return { status: 404, text: "" };
        return { status: 200, text: p };
      },
    },
    readJson: async (rel) => (rel in all ? structuredClone(all[rel]) : null),
    writeJson: async (rel, obj) => { writes.push({ rel, obj: structuredClone(obj) }); },
    log: (m) => logs.push(m),
    written: (rel) => writes.find((w) => w.rel === rel)?.obj,
  };
}

const run = (env, opts = {}) =>
  runCollect({ fetcher: env.fetcher, today: TODAY, now: NOW, readJson: env.readJson, writeJson: env.writeJson, log: env.log, useMinrepo: true, ...opts });

/** 3店・各1件の標準シナリオ。店1〜3それぞれにみんレポの店ページがある */
function baseScenario({ g = { 1: 1500, 2: 2000, 3: 2500 } } = {}) {
  const items = [1, 2, 3].map((i) => shop(i, `テスト店${i}`, "2026-11-07"));
  const pages = { [DMM1]: dmmPage(items), [minrepoCategoryUrl(1)]: categoryPage(["テスト店1", "テスト店2", "テスト店3"]) };
  for (const i of [1, 2, 3]) {
    pages[minrepoTagUrl(`テスト店${i}`)] = storePage(days("2026-11-04", 30, { g: g[i], samai: 0 }));
  }
  return { items, pages };
}

// ---- テスト ----

test("runCollect: 前回データが無い初回は全件 unrated で ok:true", async () => {
  // 店ページが1つも取れない（履歴ゼロ・基準なし）初回
  const items = [shop(1, "テスト店1", "2026-11-07"), shop(2, "テスト店2", "2026-11-09")];
  const env = makeEnv({
    pages: { [DMM1]: dmmPage(items), [minrepoCategoryUrl(1)]: categoryPage(["テスト店1", "テスト店2"]) },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const file = env.written("events/2026-11.json");
  assert.equal(file.events.length, 2);
  for (const e of file.events) {
    assert.equal(e.group, "unrated");
    assert.equal(e.frozen, false);
    assert.equal(e.outcome, null);
    assert.ok(e.sources[0].url.startsWith("https://p-town.dmm.com/shops/tokyo/"));
    assert.equal(e.sources[0].checkedAt, TODAY);
  }
  assert.equal(file.events[0].id, "2026-11-07|dmm:1|媒体X|企画1");
  const meta = env.written("collect-meta.json");
  assert.deepEqual(meta.months, ["2026-11", "2026-12"]);
  assert.equal(meta.lastSuccessAt, "2026-11-05T09:04:00+09:00");
  assert.equal(meta.counts.events, 2);
  assert.deepEqual(env.written("media-strength.json").entries, []);
  assert.ok(env.written("events/2026-12.json"), "翌月のファイルも作る");
  assert.ok(env.written("venues.json").venues["dmm:1"]);
});

test("runCollect: DMM が0件なら ok:false で writeJson を呼ばない", async () => {
  const env = makeEnv({
    pages: { [DMM1]: dmmPage([]), [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]) },
  });
  const r = await run(env);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.length > 0);
  assert.deepEqual(env.writes, [], "失敗時は何も書かない");

  // 解析できたのが過去日だけ（窓の中が0件）でも失敗
  const env2 = makeEnv({
    pages: { [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-01")]), [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]) },
  });
  const r2 = await run(env2);
  assert.equal(r2.ok, false);
  assert.deepEqual(env2.writes, []);
});

test("runCollect: DMM の各ページで li の数と解析できた件数の差を log に出す", async () => {
  const noLink = `<li class="unit"><p class="title">リンクなしの店</p></li>`; // 店舗リンクが無く解析で捨てられる
  const html = dmmPage([shop(1, "テスト店1", "2026-11-07")]).replace("</ul>", `${noLink}</ul>`);
  const env = makeEnv({ pages: { [DMM1]: html, [minrepoCategoryUrl(1)]: categoryPage([]) } });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const line = env.logs.find((l) => l.includes("DMM") && l.includes("2件") && l.includes("1件"));
  assert.ok(line, `li 2件・解析1件の行が無い: ${JSON.stringify(env.logs)}`);
});

test("runCollect: 今日から翌月末までだけを残し、同じ店・日・企画の重複は1件にし、次のページも読む", async () => {
  const dup = shop(1, "テスト店1", "2026-11-07");
  const env = makeEnv({
    pages: {
      [DMM1]: dmmPage([dup, dup, shop(2, "テスト店2", "2026-11-04")], 2), // 11-04 は過去日
      [DMM2]: dmmPage([shop(3, "テスト店3", "2026-12-31"), shop(4, "テスト店4", "2027-01-01")]), // 翌月末まで
      [minrepoCategoryUrl(1)]: categoryPage([]),
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.ok(env.urls.includes(DMM2));
  const ids = [...env.written("events/2026-11.json").events, ...env.written("events/2026-12.json").events].map((e) => e.id);
  assert.deepEqual(ids.sort(), ["2026-11-07|dmm:1|媒体X|企画1", "2026-12-31|dmm:3|媒体X|企画3"]);
  assert.equal(env.written("events/2027-01.json"), undefined);
});

test("runCollect: みんレポ店ページ1件が FetchError でも ok:true、その店のイベントは missing に busy を持つ", async () => {
  const { pages } = baseScenario();
  pages[minrepoTagUrl("テスト店1")] = new FetchError(minrepoTagUrl("テスト店1"), 503);
  const env = makeEnv({ pages });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const events = Object.fromEntries(env.written("events/2026-11.json").events.map((e) => [e.venue, e]));
  assert.ok(events["dmm:1"].missing.includes("busy"), "取れなかった店は busy が欠測");
  assert.equal(events["dmm:1"].points.busy, null);
  assert.ok(!events["dmm:2"].missing.includes("busy"), "取れた店は busy がある");
  assert.ok(!events["dmm:3"].missing.includes("busy"));
  const stats = env.written("store-stats.json").stats;
  assert.equal(stats["dmm:1"].baseline, null);
  assert.equal(stats["dmm:2"].baseline.medianG, 2000);
  assert.ok(env.logs.some((l) => l.includes("テスト店1")), "失敗した店を log に出す");
});

test("runCollect: みんレポ店ページが FetchError のとき、前回の store-stats の値を使う", async () => {
  const { pages } = baseScenario();
  pages[minrepoTagUrl("テスト店1")] = new FetchError(minrepoTagUrl("テスト店1"), 503);
  const prevBaseline = {
    medianG: 3000, medianSamai: 5, daysG: 30, daysSamai: 30,
    sourceUrl: minrepoTagUrl("テスト店1"), checkedAt: "2026-10-01",
  };
  const env = makeEnv({
    pages,
    files: {
      "venues.json": { updated: "2026-10-01", venues: { "dmm:1": { name: "テスト店1", address: "東京都台東区上野1-1-1", municipality: "台東区", area: "台東区", storeId: null, dmmShopId: "1", minrepoTag: "テスト店1", x: null } } },
      "store-stats.json": { updated: "2026-10-01", stats: { "dmm:1": { baseline: prevBaseline, busyPct: 1, ruleEffects: [], lift: { g: null, samai: null } } } },
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(env.written("store-stats.json").stats["dmm:1"].baseline, prevBaseline);
  const e1 = env.written("events/2026-11.json").events.find((e) => e.venue === "dmm:1");
  assert.ok(!e1.missing.includes("busy"), "前回の基準から busy を出す");
});

test("runCollect: DMM 一覧が FetchError なら ok:false", async () => {
  const env = makeEnv({ pages: { [DMM1]: new FetchError(DMM1, 503), [minrepoCategoryUrl(1)]: categoryPage([]) } });
  const r = await run(env);
  assert.equal(r.ok, false);
  assert.deepEqual(env.writes, []);

  // 2ページ目の失敗も全体の失敗（予定の一部だけを公開データにしない）
  const env2 = makeEnv({
    pages: { [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")], 2), [DMM2]: new FetchError(DMM2, 503) },
  });
  const r2 = await run(env2);
  assert.equal(r2.ok, false);
  assert.deepEqual(env2.writes, []);
});

test("runCollect: みんレポのカテゴリ1ページ目が FetchError なら ok:false", async () => {
  const env = makeEnv({
    pages: { [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]), [minrepoCategoryUrl(1)]: new FetchError(minrepoCategoryUrl(1), 503) },
  });
  const r = await run(env);
  assert.equal(r.ok, false);
  assert.deepEqual(env.writes, []);
});

/** 5店の予定があり、みんレポに載る店を matched 件にした環境（対応率 = matched/5）。前回の対応率を prevRate で与える */
function rateEnv(matched, prevRate) {
  const items = [1, 2, 3, 4, 5].map((i) => shop(i, `テスト店${i}`, "2026-11-07"));
  const tags = items.slice(0, matched).map((it) => it.name);
  return makeEnv({
    pages: { [DMM1]: dmmPage(items), [minrepoCategoryUrl(1)]: categoryPage(tags) },
    files: {
      "collect-meta.json": { lastSuccessAt: "2026-11-04T09:00:00+09:00", months: [], rates: { minrepoMatched: prevRate }, counts: { events: 5, history: 0 } },
    },
  });
}

test("runCollect: みんレポ対応率が前回 0.8 から 0.4 に落ちたら ok:false", async () => {
  const env = rateEnv(2, 0.8); // 2/5 = 0.4
  const r = await run(env);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("対応率")), r.reasons.join(" / "));
  assert.deepEqual(env.writes, []);

  // 対照: 落ち幅が小さければ通る（0.5 → 0.4）
  const env2 = rateEnv(2, 0.5);
  const r2 = await run(env2);
  assert.equal(r2.ok, true, r2.reasons.join(" / "));
  assert.equal(env2.written("collect-meta.json").rates.minrepoMatched, 0.4);
});

test("runCollect: 対応率の落ち幅がちょうど 0.3 なら失敗、0.3 未満なら成功", async () => {
  const exact = await run(rateEnv(2, 0.7)); // 0.7 → 0.4 = 0.3
  assert.equal(exact.ok, false, "0.3 以上の低下は失敗");
  const under = await run(rateEnv(2, 0.69)); // 0.29
  assert.equal(under.ok, true, under.reasons.join(" / "));
});

test("runCollect: fetcher に渡した URL に同じものが2回無い", async () => {
  // 同名の2店（DMM の店ID違い）は同じ tag を指すので、店ページの URL が重なる
  const items = [shop(1, "同名店", "2026-11-07"), { ...shop(2, "同名店", "2026-11-08"), address: "東京都台東区上野2-1-1" }, shop(3, "別の店", "2026-11-07")];
  const env = makeEnv({
    pages: {
      [DMM1]: dmmPage(items, 2),
      [DMM2]: dmmPage([shop(4, "別の店2", "2026-11-10")]),
      [minrepoCategoryUrl(1)]: categoryPage(["同名店", "別の店", "別の店2"]),
      [minrepoTagUrl("同名店")]: storePage(days("2026-11-04", 30)),
      [minrepoTagUrl("別の店")]: storePage(days("2026-11-04", 30)),
      [minrepoTagUrl("別の店2")]: storePage(days("2026-11-04", 30)),
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(new Set(env.urls).size, env.urls.length, `重複: ${JSON.stringify(env.urls)}`);
  assert.ok(env.urls.includes(minrepoTagUrl("同名店")), "店ページは実際に取っている");
});

/** 前回の月ファイル（過去日の3件・結果なし）と店の前回データ */
function pendingFiles() {
  const mk = (date) => ({
    id: `${date}|dmm:1|媒体X|裏桜梅桃李`, date, venue: "dmm:1", media: "媒体X", title: "裏桜梅桃李", anniversary: false,
    group: "unrated", score: 1, points: { mediaG: null, mediaSamai: null, venueG: null, venueSamai: null, busy: null, overlap: 0 },
    evidence: [], missing: ["mediaG", "mediaSamai", "venueG", "venueSamai", "busy"], frozen: false, outcome: null,
    sources: [{ url: "https://p-town.dmm.com/shops/tokyo/1", checkedAt: "2026-10-29" }],
  });
  return {
    "collect-meta.json": { lastSuccessAt: "2026-11-01T09:00:00+09:00", months: ["2026-11"], rates: { minrepoMatched: 1 }, counts: { events: 3, history: 0 } },
    "events/2026-11.json": { month: "2026-11", generatedAt: "2026-11-01T09:00:00+09:00", events: [mk("2026-11-01"), mk("2026-11-02"), mk("2026-11-03")] },
    "venues.json": { updated: "2026-11-01", venues: { "dmm:1": { name: "テスト店1", address: "東京都台東区上野1-1-1", municipality: "台東区", area: "台東区", storeId: null, dmmShopId: "1", minrepoTag: "テスト店1", x: null } } },
    // 基準は直近（7日以内）に取得済み。それでも結果待ちの店なので店ページを取り直す
    "store-stats.json": {
      updated: "2026-11-04",
      stats: { "dmm:1": { baseline: { medianG: 2000, medianSamai: 0, daysG: 30, daysSamai: 30, sourceUrl: minrepoTagUrl("テスト店1"), checkedAt: "2026-11-04" }, busyPct: null, ruleEffects: [], lift: { g: null, samai: null } } },
    },
  };
}

test("runCollect: 前回の過去日イベントに、取得したみんレポの日別データから outcome が入る", async () => {
  const dayValues = days("2026-11-04", 30, { g: 2000, samai: 0 }, {
    "2026-11-01": { g: 2600, samai: 100 },
    "2026-11-02": { g: 2500, samai: 100 },
    "2026-11-03": { g: 2700, samai: 100 },
  });
  const env = makeEnv({
    files: pendingFiles(),
    pages: {
      [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07", { media: "媒体X", title: "裏桜梅桃李" })]),
      [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
      [minrepoTagUrl("テスト店1")]: storePage(dayValues),
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const events = env.written("events/2026-11.json").events;
  const past = events.filter((e) => e.date < TODAY);
  assert.equal(past.length, 3);
  for (const e of past) assert.equal(e.frozen, true);
  assert.deepEqual(past.map((e) => e.outcome), [
    { g: 600, samai: 100 }, { g: 500, samai: 100 }, { g: 700, samai: 100 },
  ]);
  // 結果が履歴になり、同じ企画の取材の強さ・次の予定の評価に使われる
  const entry = env.written("media-strength.json").entries.find((x) => x.key === "t:裏桜梅桃李");
  assert.deepEqual(entry.g, { mean: 600, n: 3 });
  assert.equal(env.written("collect-meta.json").counts.history, 3);
  const upcoming = events.find((e) => e.date === "2026-11-07");
  assert.equal(upcoming.group, "rated");
  assert.equal(upcoming.points.mediaG, 4); // 600 / 150
  assert.equal(env.written("store-stats.json").stats["dmm:1"].lift.g.n, 3);
});

test("runCollect: 二度目の実行で入った outcome は変わらない", async () => {
  const first = makeEnv({
    files: pendingFiles(),
    pages: {
      [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]),
      [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
      [minrepoTagUrl("テスト店1")]: storePage(days("2026-11-04", 30, { g: 2000, samai: 0 }, { "2026-11-01": { g: 2600, samai: 100 } })),
    },
  });
  await run(first);
  const filled = first.written("events/2026-11.json");
  assert.deepEqual(filled.events.find((e) => e.date === "2026-11-01").outcome, { g: 600, samai: 100 });

  // 翌日: 同じ日に別の値（9999）が見えても、前回入った結果は書き換えない
  const files2 = pendingFiles();
  files2["store-stats.json"].stats["dmm:1"].baseline.checkedAt = "2026-10-01"; // 古いので店ページを取り直す
  const second = makeEnv({
    files: {
      ...files2,
      "events/2026-11.json": filled,
    },
    pages: {
      [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]),
      [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
      [minrepoTagUrl("テスト店1")]: storePage(days("2026-11-05", 30, { g: 2000, samai: 0 }, { "2026-11-01": { g: 9999, samai: 9999 } })),
    },
  });
  const r = await runCollect({ fetcher: second.fetcher, today: "2026-11-06", now: NOW, readJson: second.readJson, writeJson: second.writeJson, log: second.log, useMinrepo: true });
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const again = second.written("events/2026-11.json").events.find((e) => e.date === "2026-11-01");
  assert.deepEqual(again.outcome, { g: 600, samai: 100 });
});

test("runCollect: 特定日ルールの日を基準から除く（stores.json の店はその rules、それ以外はみんレポの文言）", async () => {
  // 28日間（月曜が4日）。ルール「毎週月曜日」を除くと基準に使う日は24日
  const dayValues = days("2026-11-04", 28);
  const shop1 = shop(1, "テスト店1", "2026-11-07");
  const mk = (stores) =>
    makeEnv({
      files: { "stores.json": { updated: "2026-08-01", stores } },
      pages: {
        [DMM1]: dmmPage([shop1]),
        [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
        [minrepoTagUrl("テスト店1")]: storePage(dayValues, "毎週月曜日"),
      },
    });
  const fromText = mk([]);
  await run(fromText);
  assert.equal(fromText.written("store-stats.json").stats["dmm:1"].baseline.daysG, 24);

  // 同じ住所の stores.json の店があれば、みんレポの文言ではなくその rules（ここでは空）を使う
  const store = { id: "s1", name: "テスト店1", area: "上野", address: "東京都台東区上野1-1-1", rules: [] };
  const fromStores = mk([store]);
  await run(fromStores);
  assert.equal(fromStores.written("store-stats.json").stats["dmm:1"].baseline.daysG, 28);
});

test("runCollect: 前回の venues.json の店は、今回の予定に無くても引き継ぐ", async () => {
  const files = pendingFiles();
  const env = makeEnv({
    files,
    pages: { [DMM1]: dmmPage([shop(2, "テスト店2", "2026-11-07")]), [minrepoCategoryUrl(1)]: categoryPage(["テスト店2"]), [minrepoTagUrl("テスト店1")]: storePage(days("2026-11-04", 30)), [minrepoTagUrl("テスト店2")]: storePage(days("2026-11-04", 30)) },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.ok(env.written("venues.json").venues["dmm:1"], "過去日の凍結イベントが参照する店を残す");
  assert.ok(env.written("venues.json").venues["dmm:2"]);
  assert.deepEqual(env.written("collect-meta.json").months, ["2026-11", "2026-12"]);
});

test("runCollect: 検証でエラーが出たら ok:false で何も書かない", async () => {
  // 前回の月ファイルの凍結イベントが壊れている（score が範囲外）→ validateEventsData が落とす
  const files = pendingFiles();
  files["events/2026-11.json"].events[0].score = 99;
  const env = makeEnv({
    files,
    pages: { [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]), [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]), [minrepoTagUrl("テスト店1")]: storePage(days("2026-11-04", 30)) },
  });
  const r = await run(env);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("検証")), r.reasons.join(" / "));
  assert.deepEqual(env.writes, []);
});

test("runCollect: みんレポの日別表が空（見出し構造の変化）なら log に出し、その店の baseline は作らない", async () => {
  const { pages } = baseScenario();
  pages[minrepoTagUrl("テスト店1")] = "<html><body><h1>構造が変わったページ</h1></body></html>";
  const env = makeEnv({ pages });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("store-stats.json").stats["dmm:1"].baseline, null);
  assert.ok(env.logs.some((l) => l.includes("テスト店1") && l.includes("日別")), JSON.stringify(env.logs));
});

// ---- 修正ラウンド1 ----

/** 前回の月ファイル用の、結果つき（凍結済み）の過去日イベント */
function pastEvent(date, outcome = { g: 7000, samai: 0 }, venue = "dmm:1") {
  return {
    id: `${date}|${venue}|媒体X|企画1`, date, venue, media: "媒体X", title: "企画1", anniversary: false,
    group: "unrated", score: 1, points: { mediaG: null, mediaSamai: null, venueG: null, venueSamai: null, busy: null, overlap: 0 },
    evidence: [], missing: ["mediaG", "mediaSamai", "venueG", "venueSamai", "busy"], frozen: true, outcome,
    sources: [{ url: "https://p-town.dmm.com/shops/tokyo/1", checkedAt: "2026-10-01" }],
  };
}

const VENUE1 = { name: "テスト店1", address: "東京都台東区上野1-1-1", municipality: "台東区", area: "台東区", storeId: null, dmmShopId: "1", minrepoTag: "テスト店1", x: null };

/** 店1の前回データ。baselineCheckedAt を与えると基準つきの store-stats も付く。events は { "2026-11": [...] } */
function prevFilesFor({ baselineCheckedAt = null, events = {} } = {}) {
  const months = Object.keys(events).sort();
  const files = {
    "collect-meta.json": { lastSuccessAt: "2026-11-01T09:00:00+09:00", months, rates: { minrepoMatched: 1 }, counts: { events: 0, history: 0 } },
    "venues.json": { updated: "2026-11-01", venues: { "dmm:1": VENUE1 } },
  };
  for (const m of months) files[`events/${m}.json`] = { month: m, generatedAt: "2026-11-01T09:00:00+09:00", events: events[m] };
  if (baselineCheckedAt) {
    files["store-stats.json"] = {
      updated: baselineCheckedAt,
      stats: { "dmm:1": { baseline: { medianG: 2000, medianSamai: 0, daysG: 30, daysSamai: 30, sourceUrl: minrepoTagUrl("テスト店1"), checkedAt: baselineCheckedAt }, busyPct: null, ruleEffects: [], lift: { g: null, samai: null } } },
    };
  }
  return files;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

test("runCollect: 前回・今回のイベント日は基準（daysG・medianG）から除かれる", async () => {
  const today = "2026-11-20";
  // 前回のイベント日 11-01〜11-12（12日）と、今回の予定の日 11-20（今日の行）は極端な 9000。
  // 通常日は 10-10〜10-31 と 11-13〜11-19（29日）で、日ごとに値が違う（除外を忘れると中央値が動く）
  const dayValues = [];
  const normalG = [];
  for (let i = 0; i <= 41; i++) {
    const date = addDaysStr(today, -i);
    const isPrevEvent = date >= "2026-11-01" && date <= "2026-11-12";
    const isCurrentEvent = date === today;
    if (isPrevEvent || isCurrentEvent) {
      dayValues.push({ date, g: 9000, samai: 500 });
    } else {
      const g = 2000 + i * 10;
      normalG.push(g);
      dayValues.push({ date, g, samai: 0 });
    }
  }
  assert.equal(normalG.length, 29);
  const prevEvents = [];
  for (let d = 1; d <= 12; d++) prevEvents.push(pastEvent(`2026-11-${String(d).padStart(2, "0")}`));
  const env = makeEnv({
    files: prevFilesFor({ events: { "2026-11": prevEvents } }),
    pages: {
      [DMM1]: dmmPage([shop(1, "テスト店1", today)]),
      [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
      [minrepoTagUrl("テスト店1")]: storePage(dayValues),
    },
  });
  const r = await runCollect({ fetcher: env.fetcher, today, now: NOW, readJson: env.readJson, writeJson: env.writeJson, log: env.log, useMinrepo: true });
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const base = env.written("store-stats.json").stats["dmm:1"].baseline;
  assert.equal(base.daysG, 29, "前回のイベント日12日と今回の予定の日1日を除いた件数");
  assert.equal(base.medianG, median(normalG));
  assert.equal(base.medianSamai, 0);
});

test("runCollect: collect-meta の months にある月のファイルが無ければ ok:false で何も書かない", async () => {
  const files = prevFilesFor({ events: { "2026-11": [pastEvent("2026-11-01")] } });
  delete files["events/2026-11.json"];
  const env = makeEnv({
    files,
    pages: { [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]), [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]) },
  });
  const r = await run(env);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("2026-11")), r.reasons.join(" / "));
  assert.deepEqual(env.writes, []);
});

test("runCollect: 基準が7日以内で結果待ちも無い店は店ページを取らず、7日より古ければ取る", async () => {
  const tagUrl = minrepoTagUrl("テスト店1");
  const pagesFor = () => ({
    [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]),
    [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
    [tagUrl]: storePage(days("2026-11-04", 30)),
  });
  // 今日 2026-11-05 の 7日前 = 10-29（ちょうど7日は「古い」に入らない）、8日前 = 10-28
  for (const [checkedAt, fetched] of [["2026-11-04", false], ["2026-10-29", false], ["2026-10-28", true]]) {
    const env = makeEnv({ files: prevFilesFor({ baselineCheckedAt: checkedAt }), pages: pagesFor() });
    const r = await run(env);
    assert.equal(r.ok, true, r.reasons.join(" / "));
    assert.equal(env.urls.includes(tagUrl), fetched, `checkedAt=${checkedAt}`);
    const base = env.written("store-stats.json").stats["dmm:1"].baseline;
    assert.equal(base.checkedAt, fetched ? TODAY : checkedAt, "取らなかった店は前回の基準のまま");
  }
  // 基準が無い店は取る
  const env0 = makeEnv({ files: prevFilesFor(), pages: pagesFor() });
  await run(env0);
  assert.ok(env0.urls.includes(tagUrl));
});

test("runCollect: 結果待ちの過去日イベントは30日前までなら基準が新しくても取り直し、31日前は対象外", async () => {
  const tagUrl = minrepoTagUrl("テスト店1");
  const pagesFor = () => ({
    [DMM1]: dmmPage([shop(1, "テスト店1", "2026-11-07")]),
    [minrepoCategoryUrl(1)]: categoryPage(["テスト店1"]),
    [tagUrl]: storePage(days("2026-11-04", 30)),
  });
  // 今日 2026-11-05 の 30日前 = 10-06、31日前 = 10-05。どちらも outcome が null
  for (const [date, fetched] of [["2026-10-06", true], ["2026-10-05", false]]) {
    const env = makeEnv({
      files: prevFilesFor({ baselineCheckedAt: "2026-11-04", events: { "2026-10": [pastEvent(date, null)] } }),
      pages: pagesFor(),
    });
    const r = await run(env);
    assert.equal(r.ok, true, r.reasons.join(" / "));
    assert.equal(env.urls.includes(tagUrl), fetched, `結果待ちの日付=${date}`);
  }
});

test("parseArgs: --today は形式だけでなく実在日であることも確かめる", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--today=2026-11-05"]), { dryRun: true, today: "2026-11-05", withMinrepo: false });
  assert.deepEqual(parseArgs([]), { dryRun: false, today: null, withMinrepo: false });
  assert.equal(parseArgs(["--with-minrepo"]).withMinrepo, true);
  assert.equal(parseArgs(["--today=2028-02-29"]).today, "2028-02-29");
  for (const bad of ["2026-13-45", "2026-02-30", "2027-02-29", "2026-11-5", "abc"]) {
    assert.throws(() => parseArgs([`--today=${bad}`]), /--today/, bad);
  }
  assert.throws(() => parseArgs(["--unknown"]));
});

test("CLI: 実在しない --today は通信せず終了コード1", () => {
  const r = spawnSync(process.execPath, ["scripts/collect-events.mjs", "--dry-run", "--today=2026-13-45"], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--today/);
});

// ---- 追加作業（R20）: 店名からの直接引き ----

const EMPTY_TAG_PAGE = "<html><body><h1>店ページ</h1><p>スロットの記録はありません</p></body></html>";

test("runCollect: カテゴリに無い店は店名から作ったタグ（a: NFKC・小文字化・空白除去）を直接引いて対応が付く", async () => {
  const items = [shop(1, "ベガスベガス国分寺恋ヶ窪店", "2026-11-07"), shop(2, "ＰＬＡＺＡ　ABC店", "2026-11-07"), shop(3, "テスト店3", "2026-11-07")];
  const env = makeEnv({
    pages: {
      [DMM1]: dmmPage(items),
      [minrepoCategoryUrl(1)]: categoryPage(["テスト店3"]),
      [minrepoTagUrl("ベガスベガス国分寺恋ヶ窪店")]: storePage(days("2026-11-04", 30)),
      [minrepoTagUrl("plazaabc店")]: storePage(days("2026-11-04", 30)),
      [minrepoTagUrl("テスト店3")]: storePage(days("2026-11-04", 30)),
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const v = env.written("venues.json").venues;
  assert.equal(v["dmm:1"].minrepoTag, "ベガスベガス国分寺恋ヶ窪店");
  assert.equal(v["dmm:2"].minrepoTag, "plazaabc店");
  assert.equal(v["dmm:3"].minrepoTag, "テスト店3", "カテゴリで付いた店は直接引きしない");
  // 直接引きで取ったページを基準づくりにそのまま使う（同じ URL を2回取らない）
  assert.equal(new Set(env.urls).size, env.urls.length);
  assert.equal(env.written("store-stats.json").stats["dmm:1"].baseline.daysG, 30);
  // 対応率は直接引きの分を含む（3店すべて対応）
  assert.equal(env.written("collect-meta.json").rates.minrepoMatched, 1);
  // 全体の検証（validateEventsData）も、minrepoCheckedAt のある venues で通っている
  assert.ok("minrepoCheckedAt" in v["dmm:1"]);
});

test("runCollect: (a) で見つからなければ記号を除いた (b) を引き、b で対応が付く", async () => {
  const name = "ジャム・アンド&ジャム店"; // (a) は記号を含む。(b) は ・ と & を除く
  const urlB = minrepoTagUrl("ジャムアンドジャム店");
  const env = makeEnv({
    pages: {
      [DMM1]: dmmPage([shop(1, name, "2026-11-07")]),
      [minrepoCategoryUrl(1)]: categoryPage([]),
      [urlB]: storePage(days("2026-11-04", 30)),
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(
    env.urls.filter((u) => u.includes("min-repo.com/tag/")),
    [minrepoTagUrl(name.normalize("NFKC").toLowerCase()), urlB],
    "(a) を先に引き、404 なら (b)",
  );
  assert.equal(env.written("venues.json").venues["dmm:1"].minrepoTag, "ジャムアンドジャム店");
});

test("runCollect: どちらの候補も空か 404 なら minrepoCheckedAt に今日が入り tag は null のまま", async () => {
  const name = "ジャム・アンド&ジャム店";
  const env = makeEnv({
    pages: {
      [DMM1]: dmmPage([shop(1, name, "2026-11-07")]),
      [minrepoCategoryUrl(1)]: categoryPage([]),
      [minrepoTagUrl(name.normalize("NFKC").toLowerCase())]: EMPTY_TAG_PAGE, // (a) は日別表なし
      // (b) は 404
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const v = env.written("venues.json").venues["dmm:1"];
  assert.equal(v.minrepoTag, null);
  assert.equal(v.minrepoCheckedAt, TODAY);
  assert.ok(env.logs.includes(`みんレポ ${name.normalize("NFKC").toLowerCase()}: スロットの日別データなし（タグページに表が無い）`), JSON.stringify(env.logs));
});

test("runCollect: minrepoCheckedAt が30日以内の店は直接引きしない。30日より古ければ引き直す", async () => {
  const name = "ジャム店";
  const url = minrepoTagUrl(name);
  const venue = { ...VENUE1, name, minrepoTag: null };
  // 今日 2026-11-05 の 30日前 = 10-06（30日以内）、31日前 = 10-05（古い）
  for (const [checkedAt, fetched] of [["2026-11-04", false], ["2026-10-06", false], ["2026-10-05", true], [null, true]]) {
    const env = makeEnv({
      files: { "venues.json": { updated: "2026-11-01", venues: { "dmm:1": { ...venue, minrepoCheckedAt: checkedAt } } } },
      pages: { [DMM1]: dmmPage([shop(1, name, "2026-11-07")]), [minrepoCategoryUrl(1)]: categoryPage([]) },
    });
    const r = await run(env);
    assert.equal(r.ok, true, r.reasons.join(" / "));
    assert.equal(env.urls.includes(url), fetched, `minrepoCheckedAt=${checkedAt}`);
    const v = env.written("venues.json").venues["dmm:1"];
    // 引かなかった店の確認日は前回のまま、引いて見つからなかった店は今日になる
    assert.equal(v.minrepoCheckedAt, fetched ? TODAY : checkedAt);
  }
});

test("runCollect: 直接引きで取得に失敗した店は minrepoCheckedAt を記録せず、次回また試す", async () => {
  const name = "ジャム店";
  const env = makeEnv({
    pages: {
      [DMM1]: dmmPage([shop(1, name, "2026-11-07")]),
      [minrepoCategoryUrl(1)]: categoryPage([]),
      [minrepoTagUrl(name)]: new FetchError(minrepoTagUrl(name), 503),
    },
  });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("venues.json").venues["dmm:1"].minrepoCheckedAt, null);
});

test("runCollect: 日別表の無いタグページは「スロットの日別データなし」を log に出す", async () => {
  const { pages } = baseScenario();
  pages[minrepoTagUrl("テスト店1")] = EMPTY_TAG_PAGE;
  const env = makeEnv({ pages });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.ok(env.logs.includes("みんレポ テスト店1: スロットの日別データなし（タグページに表が無い）"), JSON.stringify(env.logs));
});

/** 10店すべてがカテゴリで対応し、空の店ページが emptyCount 店ぶんの環境 */
function emptyRatioEnv(shopCount, emptyCount) {
  const items = [];
  const pages = {};
  for (let i = 1; i <= shopCount; i++) {
    items.push(shop(i, `テスト店${i}`, "2026-11-07"));
    pages[minrepoTagUrl(`テスト店${i}`)] = i <= emptyCount ? EMPTY_TAG_PAGE : storePage(days("2026-11-04", 30));
  }
  pages[DMM1] = dmmPage(items);
  pages[minrepoCategoryUrl(1)] = categoryPage(items.map((it) => it.name));
  return makeEnv({ pages });
}

test("runCollect: 取得した店ページが10件以上で8割を超えて空なら警告を log に出す（失敗にはしない）", async () => {
  const warned = (env) => env.logs.some((l) => l.includes("警告: みんレポの日別表がほとんど読めない（構造変更の可能性）"));
  const over = emptyRatioEnv(10, 9); // 9/10 = 90%
  const r = await run(over);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.ok(warned(over), JSON.stringify(over.logs));
  assert.ok(!warned((await (async () => { const e = emptyRatioEnv(10, 8); await run(e); return e; })())), "8/10 = 80% はちょうどで、超えていない");
  const few = emptyRatioEnv(9, 9); // 全部空でも9件では警告しない
  await run(few);
  assert.ok(!warned(few));
});

/**
 * 直接引きの確認日の記録を調べる環境。店1〜emptyCount は直接引きで「200 だが日別表なし」、
 * 続く filledCount 店はカテゴリで対応して日別表あり、最後の1店は 404（タグなし）。
 * 店1 は前回 2026-09-01 に確認済み（30日より古いので引き直す）。
 */
function directLookupEnv(emptyCount, filledCount) {
  const items = [];
  const pages = {};
  const tags = [];
  const total = emptyCount + filledCount + 1;
  for (let i = 1; i <= total; i++) {
    items.push(shop(i, `ジャム店${i}`, "2026-11-07"));
    if (i <= emptyCount) pages[minrepoTagUrl(`ジャム店${i}`)] = EMPTY_TAG_PAGE;
    else if (i < total) {
      pages[minrepoTagUrl(`ジャム店${i}`)] = storePage(days("2026-11-04", 30));
      tags.push(`ジャム店${i}`);
    }
  }
  pages[DMM1] = dmmPage(items);
  pages[minrepoCategoryUrl(1)] = categoryPage(tags);
  const prev = { ...VENUE1, name: "ジャム店1", minrepoTag: null, minrepoCheckedAt: "2026-09-01" };
  return { env: makeEnv({ pages, files: { "venues.json": { updated: "2026-11-01", venues: { "dmm:1": prev } } } }), total };
}

test("runCollect: 取得した店ページの8割超が空なら、直接引きで見つからなかった店の minrepoCheckedAt を記録しない（前回値に戻す）", async () => {
  const warned = (env) => env.logs.some((l) => l.includes("警告: みんレポの日別表がほとんど読めない（構造変更の可能性）"));
  // 空9 + 日別表あり1 = 取得10ページ中9ページが空（90%）+ 404 の店1つ
  const { env, total } = directLookupEnv(9, 1);
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.ok(warned(env), JSON.stringify(env.logs));
  const v = env.written("venues.json").venues;
  assert.equal(v["dmm:1"].minrepoCheckedAt, "2026-09-01", "前回値に戻る");
  for (let i = 2; i <= total; i++) assert.equal(v[`dmm:${i}`].minrepoCheckedAt, null, `dmm:${i}（空ページ・404 とも記録しない）`);
});

test("runCollect: 取得した店ページの空が8割以下なら、直接引きで見つからなかった店は minrepoCheckedAt に今日が入る", async () => {
  const warned = (env) => env.logs.some((l) => l.includes("警告: みんレポの日別表がほとんど読めない（構造変更の可能性）"));
  // 空8 + 日別表あり2 = 取得10ページ中8ページが空（ちょうど80%で警告なし）+ 404 の店1つ
  const { env, total } = directLookupEnv(8, 2);
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.ok(!warned(env), JSON.stringify(env.logs));
  const v = env.written("venues.json").venues;
  for (let i = 1; i <= 8; i++) assert.equal(v[`dmm:${i}`].minrepoCheckedAt, TODAY, `dmm:${i}`);
  assert.equal(v[`dmm:${total}`].minrepoCheckedAt, TODAY, "404 の店");
});

// ---- useMinrepo: false（DMM だけで公開する形） ----

const MINREPO_HOST = "min-repo.com";

test("runCollect: useMinrepo 省略時の既定は false で、みんレポにアクセスしない", async () => {
  const { pages } = baseScenario();
  const env = makeEnv({ pages });
  const r = await runCollect({ fetcher: env.fetcher, today: TODAY, now: NOW, readJson: env.readJson, writeJson: env.writeJson, log: env.log });
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(env.urls.filter((u) => u.includes(MINREPO_HOST)), []);
  assert.deepEqual(env.written("collect-meta.json").sources, ["dmm"]);
});

test("runCollect: useMinrepo:false はみんレポへ1件もアクセスせず、前回の minrepoTag・minrepoCheckedAt・store-stats を残し、sources は dmm だけ", async () => {
  // 店1: 前回タグあり＋基準が古い（true なら取り直す）＋結果待ちの過去日イベントあり（true なら取り直す）
  // 店2: タグ無し＋確認日が古い（true なら直接引きする）
  const prevStatsFile = {
    updated: "2026-10-20",
    stats: {
      "dmm:1": { baseline: { medianG: 2100, medianSamai: 5, daysG: 30, daysSamai: 30, sourceUrl: minrepoTagUrl("テスト店1"), checkedAt: "2026-10-20" }, busyPct: 0.5, ruleEffects: [{ label: "5のつく日", diff: 10, days: 3 }], lift: { g: null, samai: null } },
    },
  };
  const pendingEvent = {
    id: "2026-11-02|dmm:1|媒体X|企画1", date: "2026-11-02", venue: "dmm:1", media: "媒体X", title: "企画1", anniversary: false,
    group: "unrated", score: 0, points: { mediaG: null, mediaSamai: null, venueG: null, venueSamai: null, busy: null, overlap: null },
    evidence: [], missing: ["mediaG", "mediaSamai", "venueG", "venueSamai", "busy", "overlap"], frozen: false, outcome: null,
    sources: [{ url: "https://p-town.dmm.com/shops/tokyo/1", checkedAt: "2026-11-01" }],
  };
  const venue2 = { ...VENUE1, name: "テスト店2", dmmShopId: "2", minrepoTag: null, minrepoCheckedAt: "2026-09-01" };
  const venue1 = { ...VENUE1, minrepoCheckedAt: "2026-10-01" };
  const files = {
    "venues.json": { updated: "2026-10-20", venues: { "dmm:1": venue1, "dmm:2": venue2 } },
    "store-stats.json": prevStatsFile,
    "collect-meta.json": { lastSuccessAt: "2026-11-01T09:00:00+09:00", months: ["2026-11"], rates: { minrepoMatched: 1 }, counts: { events: 1, history: 0 } },
    "events/2026-11.json": { month: "2026-11", generatedAt: "2026-11-01T09:00:00+09:00", events: [pendingEvent] },
  };
  const items = [shop(1, "テスト店1", "2026-11-07"), shop(2, "テスト店2", "2026-11-08")];
  // みんレポのページも置いておく（アクセスすれば取れてしまう状況でも触らないことを確かめる）
  const pages = {
    [DMM1]: dmmPage(items),
    [minrepoCategoryUrl(1)]: categoryPage(["テスト店1", "テスト店2"]),
    [minrepoTagUrl("テスト店1")]: storePage(days("2026-11-04", 30)),
    [minrepoTagUrl("テスト店2")]: storePage(days("2026-11-04", 30)),
  };
  const env = makeEnv({ files, pages });
  const r = await run(env, { useMinrepo: false });
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(env.urls.filter((u) => u.includes(MINREPO_HOST)), [], "min-repo.com へのアクセスが1件も無い");
  assert.ok(env.urls.some((u) => u.startsWith("https://p-town.dmm.com/")), "DMM は取る");

  const v = env.written("venues.json").venues;
  assert.equal(v["dmm:1"].minrepoTag, "テスト店1", "前回のタグを引き継ぐ");
  assert.equal(v["dmm:1"].minrepoCheckedAt, "2026-10-01", "前回の確認日を引き継ぐ");
  assert.equal(v["dmm:2"].minrepoTag, null);
  assert.equal(v["dmm:2"].minrepoCheckedAt, "2026-09-01", "直接引きしないので確認日は動かない");
  assert.deepEqual(env.written("store-stats.json").stats["dmm:1"], prevStatsFile.stats["dmm:1"], "store-stats は前回のまま（busyPct も再計算しない）");
  assert.deepEqual(env.written("store-stats.json").stats["dmm:2"], { baseline: null, busyPct: null, ruleEffects: [], lift: { g: null, samai: null } }, "前回に無い店は空");
  assert.equal(env.written("store-stats.json").stats["dmm:1"].baseline.checkedAt, "2026-10-20");

  const meta = env.written("collect-meta.json");
  assert.deepEqual(meta.sources, ["dmm"]);
  assert.equal(meta.rates.minrepoMatched, null);
  // みんレポ由来の要素は欠測、overlap だけが残る
  for (const e of env.written("events/2026-11.json").events.filter((x) => !x.frozen)) {
    assert.equal(e.group, "unrated");
    assert.equal(e.points.mediaG, null);
    assert.equal(e.points.venueG, null);
  }
});

test("runCollect: useMinrepo:false は前回の対応率が高くても対応率の急落で失敗しない", async () => {
  const items = [shop(1, "テスト店1", "2026-11-07"), shop(2, "テスト店2", "2026-11-07")];
  const files = {
    "collect-meta.json": { lastSuccessAt: "2026-11-01T09:00:00+09:00", months: [], rates: { minrepoMatched: 0.9 }, counts: { events: 2, history: 0 } },
  };
  const env = makeEnv({ files, pages: { [DMM1]: dmmPage(items) } });
  const r = await run(env, { useMinrepo: false });
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("collect-meta.json").rates.minrepoMatched, null);
  // 比較: useMinrepo:true なら同じ状況は急落で失敗する（ガードが効いている側の対照）
  const env2 = makeEnv({ files, pages: { [DMM1]: dmmPage(items), [minrepoCategoryUrl(1)]: categoryPage([]) } });
  const r2 = await run(env2, { useMinrepo: true });
  assert.equal(r2.ok, false);
});

test("runCollect: useMinrepo:true は collect-meta の sources が dmm と minrepo", async () => {
  const { pages } = baseScenario();
  const env = makeEnv({ pages });
  const r = await run(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(env.written("collect-meta.json").sources, ["dmm", "minrepo"]);
  assert.ok(env.urls.some((u) => u.includes(MINREPO_HOST)));
});

// ---- DMM 来店レポート（取材実績の参考表示） ----

const REPORTS1 = "https://p-town.dmm.com/shop_reports?prefecture=13";
const reportsUrl = (n) => (n <= 1 ? REPORTS1 : `${REPORTS1}&page=${n}`);

/** 来店レポート一覧の1ページ。items: { id, name, address, date(YYYY-MM-DD), title, media? }。nextPage があれば次ページへのリンクを付ける */
function reportsPage(items, nextPage = null) {
  const lis = items
    .map((it) => {
      const [y, m, d] = it.date.split("-");
      const icons = [it.media, it.title].filter(Boolean).map((t) => `<span class="text-icon">${t}</span>`).join("");
      return (
        `<li class="unit pr-badge"><a class="link " href=/shop_reports/${it.id}>` +
        `<p class="title _ellipsis">${it.name}</p><p class="lead">${it.address}</p>` +
        `<p class="date -fz12">実施日：${y}/${m}/${d}</p><div class="right">${icons}</div></a></li>`
      );
    })
    .join("\n");
  const pager = nextPage ? `<ul class="pagination-link"><li><a href="${REPORTS1}&amp;page=${nextPage}">${nextPage}</a></li></ul>` : "";
  return `<html><body><ul class="list-units">${lis}</ul>${pager}</body></html>`;
}

/** 店 n（venues の dmm:n と同じ住所）の取材1件 */
const rpt = (id, date, n = 1, title = "取材") => ({ id, name: `テスト店${n}`, address: `東京都台東区上野${n}-1-1`, date, title });

/** DMM の予定（店1・店2）だけを置いた基本のページ。みんレポは使わない（useMinrepo:false） */
function reportsEnvPages(extra = {}) {
  const items = [shop(1, "テスト店1", "2026-11-07"), shop(2, "テスト店2", "2026-11-08")];
  return { [DMM1]: dmmPage(items), ...extra };
}

const runR = (env, opts = {}) => run(env, { useMinrepo: false, ...opts });
const reportUrlsOf = (env) => env.urls.filter((u) => u.includes("/shop_reports"));

/** 前回の dmm-reports.json */
const prevReportsFile = (reports) => ({ updated: "2026-11-01", reports });
const prevReport = (reportId, date, venue = "dmm:1", title = "前回の取材") => ({ reportId, venue, date, title, media: null });

test("runCollect(取材実績): 初回は365日前より古い実施日が出たページで止まり、境界（365日前ちょうど）は残す", async () => {
  // TODAY=2026-11-05 の365日前は 2025-11-05。2ページ目の最も古い日がちょうど境界（止まらない）、3ページ目で境界より古くなって止まる
  const env = makeEnv({
    pages: reportsEnvPages({
      [reportsUrl(1)]: reportsPage([rpt(1001, "2026-11-01"), rpt(1002, "2026-10-25", 2)], 2),
      [reportsUrl(2)]: reportsPage([rpt(1003, "2026-05-01"), rpt(1004, "2025-11-05")], 3),
      [reportsUrl(3)]: reportsPage([rpt(1005, "2025-11-05"), rpt(1006, "2025-11-04")], 4),
      [reportsUrl(4)]: reportsPage([rpt(1007, "2025-11-01")]),
    }),
  });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(reportUrlsOf(env), [reportsUrl(1), reportsUrl(2), reportsUrl(3)], "4ページ目は取らない");
  const file = env.written("dmm-reports.json");
  assert.equal(file.updated, TODAY);
  assert.deepEqual(file.reports.map((x) => x.reportId).sort(), ["1001", "1002", "1003", "1004", "1005"], "365日前ちょうどは残し、366日前は捨てる");
});

test("runCollect(取材実績): 初回は100ページで打ち切る（際限なく取りに行かない）", async () => {
  const pages = {};
  for (let p = 1; p <= 105; p++) pages[reportsUrl(p)] = reportsPage([rpt(2000 + p, "2026-10-01")], p + 1);
  const env = makeEnv({ pages: reportsEnvPages(pages) });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(reportUrlsOf(env).length, 100);
  assert.equal(env.written("dmm-reports.json").reports.length, 100);
  assert.ok(env.logs.some((m) => m.includes("来店レポート") && m.includes("100")), env.logs.join("\n"));
});

test("runCollect(取材実績): 2回目以降は既知の reportId だけのページで止まる（新しいものが混じるページでは止まらない）", async () => {
  const files = { "dmm-reports.json": prevReportsFile([prevReport("100", "2026-10-30"), prevReport("101", "2026-10-29"), prevReport("102", "2026-10-28")]) };
  const env = makeEnv({
    files,
    pages: reportsEnvPages({
      // 1ページ目: 新しい 900 と既知 100 の混在（止まらない）
      [reportsUrl(1)]: reportsPage([rpt(900, "2026-11-04"), rpt(100, "2026-10-30")], 2),
      // 2ページ目: 既知だけ（ここで止まる）
      [reportsUrl(2)]: reportsPage([rpt(101, "2026-10-29"), rpt(102, "2026-10-28")], 3),
      [reportsUrl(3)]: reportsPage([rpt(800, "2026-10-01")]),
    }),
  });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(reportUrlsOf(env), [reportsUrl(1), reportsUrl(2)]);
  const ids = env.written("dmm-reports.json").reports.map((x) => x.reportId).sort();
  assert.deepEqual(ids, ["100", "101", "102", "900"]);
});

test("runCollect(取材実績): 2回目以降は10ページで打ち切る", async () => {
  const files = { "dmm-reports.json": prevReportsFile([prevReport("1", "2026-10-01")]) };
  const pages = {};
  for (let p = 1; p <= 15; p++) pages[reportsUrl(p)] = reportsPage([rpt(3000 + p, "2026-10-20")], p + 1);
  const env = makeEnv({ files, pages: reportsEnvPages(pages) });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(reportUrlsOf(env).length, 10);
});

test("runCollect(取材実績): 一覧の取得失敗（FetchError）でも全体は ok:true で、前回のファイルを書き換えない・ログに1行", async () => {
  const files = { "dmm-reports.json": prevReportsFile([prevReport("100", "2026-10-30")]) };
  const env = makeEnv({ files, pages: reportsEnvPages({ [reportsUrl(1)]: new FetchError(reportsUrl(1), 503) }) });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("dmm-reports.json"), undefined, "前回のまま（書き換えない）");
  assert.ok(env.written("collect-meta.json"), "ほかのファイルは書く");
  assert.equal(env.logs.filter((m) => m.includes("来店レポート") && m.includes("取得できない")).length, 1, env.logs.join("\n"));
});

test("runCollect(取材実績): 途中のページで取得に失敗したら、そこまでの分も反映せず前回のまま（取り残しを作らない）", async () => {
  const files = { "dmm-reports.json": prevReportsFile([prevReport("100", "2026-10-30")]) };
  const env = makeEnv({
    files,
    pages: reportsEnvPages({
      [reportsUrl(1)]: reportsPage([rpt(900, "2026-11-04")], 2),
      [reportsUrl(2)]: new FetchError(reportsUrl(2), 0),
    }),
  });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("dmm-reports.json"), undefined);
});

test("runCollect(取材実績): 一覧が 404 など 200 でないときも全体は ok:true で前回のまま", async () => {
  const env = makeEnv({ pages: reportsEnvPages() }); // 来店レポートのページは未登録（404）
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("dmm-reports.json"), undefined);
});

test("runCollect(取材実績): 365日より古いものは前回のファイルからも捨てる（境界の365日前は残す）", async () => {
  const files = {
    "dmm-reports.json": prevReportsFile([
      prevReport("1", "2025-11-04"), // 366日前: 捨てる
      prevReport("2", "2025-11-05"), // 365日前: 残す
      prevReport("3", "2026-10-30"),
    ]),
  };
  const env = makeEnv({ files, pages: reportsEnvPages({ [reportsUrl(1)]: reportsPage([rpt(3, "2026-10-30")]) }) });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.deepEqual(env.written("dmm-reports.json").reports.map((x) => x.reportId).sort(), ["2", "3"]);
});

test("runCollect(取材実績): 住所の正規化一致で venue が付き、付かなければ null。venues は増やさない・店名と住所は保存しない", async () => {
  const env = makeEnv({
    pages: reportsEnvPages({
      [reportsUrl(1)]: reportsPage([
        rpt(1, "2026-11-01", 1), // 住所が venues の dmm:1 と同じ
        { id: 2, name: "テスト店2", address: "東京都台東区上野2丁目1番1号 テストビル3F", date: "2026-11-01", title: "表記ゆれ" }, // 丁目・番・号・建物名
        { id: 3, name: "未知の店", address: "東京都新宿区西新宿9-9-9", date: "2026-11-01", title: "予定に出ない店" },
      ]),
    }),
  });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const byId = Object.fromEntries(env.written("dmm-reports.json").reports.map((x) => [x.reportId, x]));
  assert.equal(byId["1"].venue, "dmm:1");
  assert.equal(byId["2"].venue, "dmm:2");
  assert.equal(byId["3"].venue, null);
  assert.deepEqual(Object.keys(env.written("venues.json").venues).sort(), ["dmm:1", "dmm:2"], "予定に出ない店は venues に足さない");
  assert.deepEqual(Object.keys(byId["1"]).sort(), ["date", "media", "reportId", "title", "venue"], "店名・住所は保存しない");
  assert.deepEqual(byId["1"], { reportId: "1", venue: "dmm:1", date: "2026-11-01", title: "取材", media: null });
});

test("runCollect(取材実績): 同じ住所に店が複数あるときは店名の一致で選び、決まらなければ null", async () => {
  const sameAddr = "東京都台東区上野1-1-1";
  const v1 = { ...VENUE1, name: "甲店", address: sameAddr, dmmShopId: "1", minrepoTag: null };
  const v2 = { ...VENUE1, name: "乙店", address: sameAddr, dmmShopId: "2", minrepoTag: null };
  const files = { "venues.json": { updated: "2026-10-20", venues: { "dmm:1": v1, "dmm:2": v2 } } };
  const env = makeEnv({
    files,
    pages: {
      [DMM1]: dmmPage([shop(1, "甲店", "2026-11-07", { address: sameAddr }), shop(2, "乙店", "2026-11-07", { address: sameAddr })]),
      [reportsUrl(1)]: reportsPage([
        { id: 1, name: "乙店", address: sameAddr, date: "2026-11-01", title: "A" },
        { id: 2, name: "丙店", address: sameAddr, date: "2026-11-01", title: "B" },
      ]),
    },
  });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  const byId = Object.fromEntries(env.written("dmm-reports.json").reports.map((x) => [x.reportId, x.venue]));
  assert.deepEqual(byId, { 1: "dmm:2", 2: null });
});

test("runCollect(取材実績): 検証エラーになる取材実績（実在しない日付）は全体を失敗にせず、書かずに警告だけ出す", async () => {
  const env = makeEnv({ pages: reportsEnvPages({ [reportsUrl(1)]: reportsPage([rpt(1, "2026-02-31")]) }) });
  const r = await runR(env);
  assert.equal(r.ok, true, r.reasons.join(" / "));
  assert.equal(env.written("dmm-reports.json"), undefined);
  assert.ok(env.logs.some((m) => m.includes("警告") && m.includes("dmm-reports")), env.logs.join("\n"));
});

test("runCollect(取材実績): 予定の取得に失敗した回は取材実績も書かない", async () => {
  const env = makeEnv({ pages: { [DMM1]: new FetchError(DMM1, 503), [reportsUrl(1)]: reportsPage([rpt(1, "2026-11-01")]) } });
  const r = await runR(env);
  assert.equal(r.ok, false);
  assert.deepEqual(env.writes, []);
});
