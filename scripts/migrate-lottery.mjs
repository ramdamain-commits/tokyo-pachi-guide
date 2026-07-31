// 既存店の lottery.method から type / random / tool を派生して stores.json へ書き戻す。
// 判別できない項目は null のまま残し、要確認リストを _staging/lottery-review.md に出力する。
// 冪等: 既に type キーがある店は再計算せずスキップする。
// 実行: node scripts/migrate-lottery.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveChannel, deriveTool, deriveRandom, reviewFlags } from "../lottery.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = path.join(root, "data", "stores.json");
const stagingDir = path.join(root, "_staging");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const reviewRows = [];
let migrated = 0;
let skipped = 0;

for (const store of data.stores) {
  if (!store.lottery) continue;
  if ("type" in store.lottery) {
    skipped += 1;
    continue;
  }

  const method = store.lottery.method || null;
  // 派生値を先頭に置いて可読性を保つ
  store.lottery = {
    type: deriveChannel(method),
    random: deriveRandom(method),
    tool: deriveTool(method),
    ...store.lottery,
  };
  migrated += 1;

  const flags = reviewFlags(method);
  if (flags.length) {
    reviewRows.push({ id: store.id, name: store.name, area: store.area, method, flags });
  }
}

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

fs.mkdirSync(stagingDir, { recursive: true });
const lines = [
  "# lottery 要確認リスト（Phase 2 の収集対象）",
  "",
  `生成: ${new Date().toISOString().slice(0, 10)} / 対象 ${reviewRows.length}店`,
  "",
  "method の文言だけでは確定できなかった項目。出典（みんパチ店舗ページ・店公式）で再確認して埋める。",
  "",
  "| id | 店名 | エリア | 現在のmethod | 要確認 |",
  "|----|------|--------|--------------|--------|",
  ...reviewRows.map((r) => `| ${r.id} | ${r.name} | ${r.area} | ${r.method ?? "(未記載)"} | ${r.flags.join(" / ")} |`),
  "",
];
fs.writeFileSync(path.join(stagingDir, "lottery-review.md"), lines.join("\n"), "utf8");

console.log(`移行 ${migrated}店 / スキップ ${skipped}店 / 要確認 ${reviewRows.length}店`);
console.log("要確認リスト: _staging/lottery-review.md");
