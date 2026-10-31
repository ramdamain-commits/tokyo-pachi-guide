import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseDmmSchedulePage, dedupeDmmEvents, parseDmmReportsPage, dmmReportsUrl } from "../collect/dmm.mjs";

const html = fs.readFileSync(new URL("./fixtures/dmm-schedule.html", import.meta.url), "utf8");

test("parseDmmSchedulePage: 店舗ID・店名・住所・日付・媒体・企画名を取り出す", () => {
  const { events } = parseDmmSchedulePage(html);
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], {
    dmmShopId: "343",
    shopName: "ゴードン祖師谷店",
    address: "東京都世田谷区祖師谷3-1-20",
    date: "2026-10-30",
    media: "パチ＆スロ必勝本",
    title: "PP・闘玉丸取材",
  });
});

test("parseDmmSchedulePage: span.text-icon が1つなら媒体なしで企画名にする（時刻つきの日付も読める）", () => {
  const { events } = parseDmmSchedulePage(html);
  assert.deepEqual(events[1], {
    dmmShopId: "12231",
    shopName: "クリエ府中西原店",
    address: "東京都府中市西原町1-4-5",
    date: "2026-10-30",
    media: null,
    title: "ぱちたん川柳SELECTION",
  });
});

test("parseDmmSchedulePage: lastPage はページ送りの最大値", () => {
  assert.equal(parseDmmSchedulePage(html).lastPage, 29);
});

test("parseDmmSchedulePage: ページ送りが無ければ lastPage は null、予定が無ければ events は空", () => {
  assert.deepEqual(parseDmmSchedulePage("<html></html>"), { events: [], lastPage: null });
});

test("dedupeDmmEvents: 同じ店・日・媒体・企画の重複を1件にする", () => {
  const { events } = parseDmmSchedulePage(html);
  assert.equal(events.length, 3);
  const deduped = dedupeDmmEvents(events);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((e) => e.dmmShopId), ["343", "12231"]);
});

test("dedupeDmmEvents: 企画名だけ違うものは残す", () => {
  const base = {
    dmmShopId: "102", shopName: "A", address: "東京都", date: "2026-11-07",
    media: "M", title: "企画1",
  };
  const out = dedupeDmmEvents([base, { ...base, title: "企画2" }, { ...base }]);
  assert.deepEqual(out.map((e) => e.title), ["企画1", "企画2"]);
});

test("dedupeDmmEvents: 媒体・日付・店が違うものは残し、先に出た1件を返す", () => {
  const base = {
    dmmShopId: "102", shopName: "A", address: "東京都", date: "2026-11-07",
    media: null, title: "企画1",
  };
  const out = dedupeDmmEvents([
    base,
    { ...base, media: "M" },
    { ...base, date: "2026-11-08" },
    { ...base, dmmShopId: "103" },
    { ...base, shopName: "先の1件を残す確認" },
  ]);
  assert.equal(out.length, 4);
  assert.equal(out[0].shopName, "A");
});

// ---- 来店イベントレポート一覧 ----

const reportsHtml = fs.readFileSync(new URL("./fixtures/dmm-reports.html", import.meta.url), "utf8");

test("dmmReportsUrl: 1ページ目は page なし、2ページ目以降は &page=N", () => {
  assert.equal(dmmReportsUrl(1), "https://p-town.dmm.com/shop_reports?prefecture=13");
  assert.equal(dmmReportsUrl(2), "https://p-town.dmm.com/shop_reports?prefecture=13&page=2");
});

test("parseDmmReportsPage: レポートID・店名・住所・実施日・取材名を取り出す（店舗IDは無い）", () => {
  const { reports } = parseDmmReportsPage(reportsHtml);
  assert.equal(reports.length, 3);
  assert.deepEqual(reports[0], {
    reportId: "563472",
    shopName: "ジャラン水元店",
    address: "東京都葛飾区南水元4-18-7",
    date: "2026-11-01",
    media: null,
    title: "スロセレ",
  });
  assert.deepEqual(reports.map((r) => r.reportId), ["563472", "560028", "564106"]);
  assert.deepEqual(reports.map((r) => r.date), ["2026-11-01", "2026-10-25", "2026-10-24"]);
});

test("parseDmmReportsPage: lastPage は &amp;page=N のリンクの最大値", () => {
  assert.equal(parseDmmReportsPage(reportsHtml).lastPage, 253);
});

test("parseDmmReportsPage: span.text-icon が2つなら 媒体・取材名 の順", () => {
  const li = (icons) =>
    `<ul><li class="unit"><a href=/shop_reports/9><p class="title">A店</p><p class="lead">東京都</p>` +
    `<p class="date">実施日：2026/10/01</p><div class="right">${icons}</div></a></li></ul>`;
  const two = parseDmmReportsPage(li(`<span class="text-icon">媒体M</span><span class="text-icon">取材T</span>`));
  assert.equal(two.reports[0].media, "媒体M");
  assert.equal(two.reports[0].title, "取材T");
});

test("parseDmmReportsPage: span が無くても画像 alt の「…」から取材名を読む。どちらも無ければ対象外", () => {
  const li = (inner) =>
    `<ul><li class="unit"><a href=/shop_reports/9>${inner}<p class="title">A店</p><p class="lead">東京都</p>` +
    `<p class="date">実施日：2026/10/01</p></a></li></ul>`;
  const alt = parseDmmReportsPage(li(`<img alt="A店 2026/10/1/（木）の来店イベントレポート「取材T」">`));
  assert.equal(alt.reports[0].title, "取材T");
  assert.equal(alt.reports[0].media, null);
  assert.deepEqual(parseDmmReportsPage(li("")).reports, []);
});

test("parseDmmReportsPage: 予定一覧のリンク（/shops/tokyo/…）は対象外。ページ送りが無ければ lastPage は null", () => {
  assert.deepEqual(parseDmmReportsPage(html).reports, []);
  assert.deepEqual(parseDmmReportsPage("<html></html>"), { reports: [], lastPage: null });
});
