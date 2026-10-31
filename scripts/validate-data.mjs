// data/stores.json と、熱いイベント関連の収集データをスキーマ検証する CLI。
// 実行: node scripts/validate-data.mjs [--dir=<新データのディレクトリ>]
// --dir を省略すると新データは data/ から読む。stores.json は常に data/ から読む。
// 新データは collect-meta.json が無ければ「未生成」として飛ばす。
// errors があれば終了コード1、warnings のみなら0を返す。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStores } from "../validate.mjs";
import { validateEventsData } from "../validate-events.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "data");
const dirArg = process.argv.slice(2).find((a) => a.startsWith("--dir="));
const eventsDir = dirArg ? path.resolve(dirArg.slice("--dir=".length)) : dataDir;

const data = JSON.parse(fs.readFileSync(path.join(dataDir, "stores.json"), "utf8"));
const { errors, warnings } = validateStores(data.stores);

/** 新データを読んで検証し、結果を errors / warnings へ足す。 */
function validateNewData() {
  const metaPath = path.join(eventsDir, "collect-meta.json");
  if (!fs.existsSync(metaPath)) {
    console.log(`熱いイベントのデータ: 未生成（${metaPath} が無いので検証を飛ばす）`);
    return;
  }
  const readJson = (rel) => {
    const p = path.join(eventsDir, rel);
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (err) {
      errors.push(`${rel}: 読み込めない（${err.message}）`);
      return null;
    }
  };

  const meta = readJson("collect-meta.json");
  const venues = readJson("venues.json");
  const mediaStrength = readJson("media-strength.json");
  const storeStats = readJson("store-stats.json");
  const months = {};
  for (const month of Array.isArray(meta?.months) ? meta.months : []) {
    const file = readJson(path.join("events", `${month}.json`));
    if (file) months[month] = file;
  }
  if (!meta || !venues || !storeStats) return;

  const result = validateEventsData({
    venues: venues.venues,
    mediaStrength,
    storeStats: storeStats.stats,
    months,
  });
  errors.push(...result.errors);
  warnings.push(...result.warnings);
  console.log(`熱いイベントのデータ: ${Object.keys(months).length}か月分を検証`);
}

validateNewData();

warnings.forEach((w) => console.warn(`WARN  ${w}`));
errors.forEach((e) => console.error(`ERROR ${e}`));
console.log(`\n検証: ${data.stores.length}店 / errors ${errors.length} / warnings ${warnings.length}`);

process.exit(errors.length ? 1 : 0);
