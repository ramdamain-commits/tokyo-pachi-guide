import test from "node:test";
import assert from "node:assert/strict";
import { runCollect } from "../scripts/collect-events.mjs";
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

const run = (env) =>
  runCollect({ fetcher: env.fetcher, today: TODAY, now: NOW, readJson: env.readJson, writeJson: env.writeJson, log: env.log });

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
  const r = await runCollect({ fetcher: second.fetcher, today: "2026-11-06", now: NOW, readJson: second.readJson, writeJson: second.writeJson, log: second.log });
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
