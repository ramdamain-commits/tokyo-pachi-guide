// 既存店の lottery.method から type / random / tool を派生して stores.json へ書き戻す。
// 判別できない項目は null のまま残し、要確認リストを _staging/lottery-review.md に出力する。
// 冪等: 既に type キーがある店は再計算せずスキップする。
// 実行: node scripts/migrate-lottery.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveChannel, deriveTool, deriveRandom } from "../lottery.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = path.join(root, "data", "stores.json");
const docsDir = path.join(root, "docs");

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
}

// 要確認リストは移行の有無と関係なく全店から作り直す。
// 移行済みの店だけを対象にすると、2回目以降の実行でリストが空になってしまうため。
//
// method文言の再解析ではなく、現在のtype/random/tool（pachinko/slotサブオブジェクトが
// あればそちらを優先）が実際にnullのままかどうかで要確認判定する。文言だけを見る旧実装は
// 「パチ/スロで方式が異なる」旨をmethodに書いた時点で、値が既にサブオブジェクトで
// 解決済みでも機械的に要確認フラグを立ててしまっていた。
function fieldFlags(entry, prefix) {
  const flags = [];
  if (entry.type == null) flags.push(`${prefix}チャネル不明`);
  if (entry.random == null) flags.push(`${prefix}抽選有無不明`);
  if (entry.type === "app") {
    if (!entry.tool) flags.push(`${prefix}ツール名不明`);
    else if (entry.tool.includes("コンパス") && !entry.tool.includes("777")) {
      flags.push(`${prefix}ツール名要確認(略称一致)`);
    }
  }
  return flags;
}

function structuralFlags(lottery) {
  if (!lottery.method) return ["方式未記載"];
  const { pachinko, slot, ...common } = lottery;
  if (pachinko || slot) {
    const flags = [];
    if (pachinko) flags.push(...fieldFlags({ ...common, ...pachinko }, "パチンコ:"));
    if (slot) flags.push(...fieldFlags({ ...common, ...slot }, "スロット:"));
    return flags;
  }
  return fieldFlags(common, "");
}

for (const store of data.stores) {
  if (!store.lottery) continue;
  const flags = structuralFlags(store.lottery);
  if (flags.length) {
    reviewRows.push({
      id: store.id,
      name: store.name,
      area: store.area,
      method: store.lottery.method || null,
      flags,
    });
  }
}

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

fs.mkdirSync(docsDir, { recursive: true });
const lines = [
  "# 抽選方式の要確認リスト（Phase 2 の収集対象）",
  "",
  "`node scripts/migrate-lottery.mjs` が生成する。手で編集せず、出典を再確認して",
  "`data/stores.json` を直したうえでスクリプトを再実行すること。",
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
fs.writeFileSync(path.join(docsDir, "抽選方式の要確認リスト.md"), lines.join("\n"), "utf8");

console.log(`移行 ${migrated}店 / スキップ ${skipped}店 / 要確認 ${reviewRows.length}店`);
console.log("要確認リスト: docs/抽選方式の要確認リスト.md");
