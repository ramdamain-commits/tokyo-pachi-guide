import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseDmmSchedulePage, dedupeDmmEvents } from "../collect/dmm.mjs";

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
