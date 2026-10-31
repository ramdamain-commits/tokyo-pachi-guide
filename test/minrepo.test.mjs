import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseMinrepoCategory,
  parseMinrepoStorePage,
  minrepoCategoryUrl,
  minrepoTagUrl,
} from "../collect/minrepo.mjs";

const storeHtml = fs.readFileSync(new URL("./fixtures/minrepo-store.html", import.meta.url), "utf8");
const categoryHtml = fs.readFileSync(new URL("./fixtures/minrepo-category.html", import.meta.url), "utf8");

test("parseMinrepoStorePage: ruleText は '16日、月と日がゾロ目の日、第4土曜日'", () => {
  const { ruleText } = parseMinrepoStorePage(storeHtml, "2026-10-30");
  assert.equal(ruleText, "16日、月と日がゾロ目の日、第4土曜日");
});

test("parseMinrepoStorePage: 旧イベント日の行が無ければ ruleText は null", () => {
  const html = storeHtml.replace("旧イベント日", "別の項目");
  assert.equal(parseMinrepoStorePage(html, "2026-10-30").ruleText, null);
});

test("parseMinrepoStorePage: '-' の差枚は null、平均G は数値、'+22,430' は 22430", () => {
  const { days } = parseMinrepoStorePage(storeHtml, "2026-10-30");
  assert.equal(days.length, 5);
  assert.deepEqual(days[0], { date: "2026-10-29", totalSamai: 1070, avgSamai: 4, avgG: 1946 });
  assert.deepEqual(days[1], { date: "2026-10-28", totalSamai: null, avgSamai: null, avgG: 2375 });
  assert.deepEqual(days[2], { date: "2026-10-27", totalSamai: 22430, avgSamai: 93, avgG: 2743 });
  assert.equal(days[4].date, "2026-10-25");
});

test("parseMinrepoStorePage: ランキング表（td.rank）の行は拾わない", () => {
  const { days } = parseMinrepoStorePage(storeHtml, "2026-10-30");
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-10-29", "2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25"],
  );
});

test("parseMinrepoStorePage: 負の差枚は負の数にする", () => {
  const html = storeHtml.replace("+1,070", "-12,345").replace("<td>+4</td>", "<td>-51</td>");
  const { days } = parseMinrepoStorePage(html, "2026-10-30");
  assert.equal(days[0].totalSamai, -12345);
  assert.equal(days[0].avgSamai, -51);
});

test("parseMinrepoStorePage: 基準 2027-01-02 で 1/1, 12/31 の並びは 2027-01-01, 2026-12-31", () => {
  const rows = [["1/1(金)", "3"], ["12/31(木)", "2"], ["12/30(水)", "1"]]
    .map(([d, g]) => `<tr><td><a href="https://min-repo.com/1/">${d}</a></td><td>+1</td><td>+1</td><td>${g},000</td><td></td></tr>`)
    .join("");
  const html = `<h2>テスト店 データ一覧</h2><div><table><tbody><tr><th>日付</th></tr>${rows}</tbody></table></div>`;
  const { days } = parseMinrepoStorePage(html, "2027-01-02");
  assert.deepEqual(
    days.map((d) => d.date),
    ["2027-01-01", "2026-12-31", "2026-12-30"],
  );
});

test("parseMinrepoStorePage: 「データ一覧」より前の表の日付行は拾わない", () => {
  const before = '<table><tbody><tr><td><a href="https://min-repo.com/9/">1/1(金)</a></td><td>+9</td><td>+9</td><td>9,999</td><td></td></tr></tbody></table>';
  const html = storeHtml.replace("<h2>", `${before}<h2>`);
  const { days } = parseMinrepoStorePage(html, "2026-10-30");
  assert.equal(days.length, 5);
  assert.equal(days[0].date, "2026-10-29");
});

test("parseMinrepoStorePage: データ一覧の見出しが無ければ days は空", () => {
  assert.deepEqual(parseMinrepoStorePage("<html></html>", "2026-10-30"), { ruleText: null, days: [] });
});

test("minrepoTagUrl: カレイド新宿店 は小文字%表記の URL", () => {
  assert.equal(
    minrepoTagUrl("カレイド新宿店"),
    "https://min-repo.com/tag/%e3%82%ab%e3%83%ac%e3%82%a4%e3%83%89%e6%96%b0%e5%ae%bf%e5%ba%97/",
  );
});

test("minrepoCategoryUrl: 1ページ目はページ番号なし、2ページ目以降は page/N/", () => {
  assert.equal(minrepoCategoryUrl(1), "https://min-repo.com/category/%e6%9d%b1%e4%ba%ac%e9%83%bd/");
  assert.equal(minrepoCategoryUrl(2), "https://min-repo.com/category/%e6%9d%b1%e4%ba%ac%e9%83%bd/page/2/");
});

test("parseMinrepoCategory: tag 名を URL デコードして重複なしで返し、最終ページを読む", () => {
  const { tags, lastPage } = parseMinrepoCategory(categoryHtml);
  assert.deepEqual(tags, ["清瀬uno", "カレイド新宿店", "mgm国領店"]);
  assert.equal(lastPage, 107);
});

test("parseMinrepoCategory: ページ送りが無ければ lastPage は null", () => {
  assert.deepEqual(parseMinrepoCategory("<html></html>"), { tags: [], lastPage: null });
});
