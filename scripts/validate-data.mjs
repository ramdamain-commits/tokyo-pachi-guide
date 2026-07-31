// data/stores.json をスキーマ検証する CLI。
// 実行: node scripts/validate-data.mjs
// errors があれば終了コード1、warnings のみなら0を返す。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStores } from "../validate.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = path.join(root, "data", "stores.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const { errors, warnings } = validateStores(data.stores);

warnings.forEach((w) => console.warn(`WARN  ${w}`));
errors.forEach((e) => console.error(`ERROR ${e}`));
console.log(`\n検証: ${data.stores.length}店 / errors ${errors.length} / warnings ${warnings.length}`);

process.exit(errors.length ? 1 : 0);
