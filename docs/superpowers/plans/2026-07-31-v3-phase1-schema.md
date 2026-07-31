# v3 Phase 1（スキーマ拡張＋データ基盤）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽選方式・周年・SNS・混雑の v3 スキーマを受け入れられるようにデータ基盤（派生ロジック・検証・移行スクリプト・収集手順書）を整備し、新規8エリアの収集を開始できる状態にする。

**Architecture:** 既存の `match.mjs` / `coverage.mjs` と同じ「純関数モジュール＋`node --test` のテスト」パターンを踏襲する。新規モジュールは `lottery.mjs`（抽選方式の派生・正規化・ラベル生成）と `validate.mjs`（stores.json のスキーマ検証）の2つ。CLI は `scripts/` 配下に置き、モジュールを呼ぶだけの薄いラッパにする。ビューワ（app.js / index.html）への配線は Phase 3 の別計画で行うため、本計画では `lotteryLabel` を作るところまでにとどめる。

**Tech Stack:** Node.js ES Modules（ビルドツールなし・依存パッケージなし）、`node --test`、静的HTML+fetch

**設計書:** `docs/superpowers/specs/2026-07-31-v3-expansion-design.md`

---

## 前提知識（この計画を実行する人向け）

このリポジトリは東京都内のパチンコ・スロット店の「特定日（旧イベント日）」パターンを検索するローカル静的ビューワ。ビルドツールも npm 依存もなく、`data/*.json` を素の ES Modules が読むだけの構成になっている。

**必ず守るルール:**

- `package.json` は無い。テストは `node --test test/*.test.mjs` で直接実行する
- 日付は必ず `new Date(y, m-1, d)`（ローカル基準）で作る。`new Date("YYYY-MM-DD")` は UTC 解釈で JST が1日ズレる
- `data/stores.json` は CRLF・2スペースインデント。スクリプトから書き戻すときは `JSON.stringify(data, null, 2)` に改行を付けて素直に LF で書けばよい（git の `core.autocrlf=true` が吸収する）。**ファイルのバイト比較・md5比較はしない**（ツールを跨ぐと改行変換で必ず不一致になる）
- **出典に無い情報を推測で埋めない。** 判別できない項目は `null` のままにして「要確認」として残す。これはこのリポジトリで最も重要なルール

**現状データの重要な事実:**

- `data/stores.json` は `{ "updated": "YYYY-MM-DD", "stores": [...] }` の形。全35店
- 各店の `lottery` は `{ method, draw, lineup, auth }` の自由記述。`method` の実データは「整理券(会員カード不要)」「モバイル抽選(777コンパス)」「整理券・シャッフル抽選」「抽選方式」など表記がバラバラ
- `match.mjs` の `ruleLabel()` は**すでに `rule.label` に対応済み**（109行目付近）。周年ラベルのために match.mjs を変更する必要はない

---

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `lottery.mjs`（新規） | 抽選方式の派生（method文字列→type/random/tool）、パチ/スロ差分の解決、バッジ用ラベル生成 |
| `validate.mjs`（新規） | `stores.json` のスキーマ検証。errors / warnings を返す純関数 |
| `test/lottery.test.mjs`（新規） | lottery.mjs のテスト |
| `test/validate.test.mjs`（新規） | validate.mjs のテスト |
| `scripts/validate-data.mjs`（新規） | 検証CLI。`node scripts/validate-data.mjs` で data/ を検証 |
| `scripts/migrate-lottery.mjs`（新規） | 既存35店の `lottery.method` から type/random/tool を派生して書き戻し、要確認リストを出力 |
| `data/stores.json`（変更） | 移行スクリプトによる lottery 拡張 |
| `docs/収集手順_v3.md`（新規） | researcher へ渡す収集指示テンプレートとソース序列 |
| `index.html`（変更） | フッターの「非公開ローカルツール（GitHub非掲載）」が公開後も残っている誤記の修正 |
| `README.md` / `CHANGELOG.md`（変更） | 構成・変更履歴の追随 |

---

### Task 1: lottery.mjs — method 文字列からの派生ロジック

**方針:** 派生は「すでに出典から記録済みの `method` 文言」を読むだけに限定する。文言から判別できない項目は `null` を返し、`reviewFlags()` が「要確認」の理由を返す。これにより推測補完を避けつつ、機械的に埋められる部分だけ埋める。

**Files:**
- Create: `lottery.mjs`
- Test: `test/lottery.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`test/lottery.test.mjs` を新規作成する。テストデータは `data/stores.json` に実在する method 文字列をそのまま使う。

```js
import test from "node:test";
import assert from "node:assert/strict";
import { deriveChannel, deriveTool, deriveRandom, reviewFlags } from "../lottery.mjs";

// --- deriveChannel: 入場チャネル ---

test("deriveChannel: モバイル/オンライン/コンパス/入場くん を含めば app", () => {
  assert.equal(deriveChannel("モバイル抽選"), "app");
  assert.equal(deriveChannel("モバイル抽選(777コンパス)"), "app");
  assert.equal(deriveChannel("入場くんオンライン(モバイル抽選)"), "app");
  assert.equal(deriveChannel("777コンパス モバイル抽選"), "app");
});

test("deriveChannel: 整理券/店頭/抽選券 を含めば onsite", () => {
  assert.equal(deriveChannel("整理券(会員カード不要)"), "onsite");
  assert.equal(deriveChannel("整理券・シャッフル抽選"), "onsite");
  assert.equal(deriveChannel("整理券抽選"), "onsite");
  assert.equal(deriveChannel("抽選券配布(スロ)"), "onsite");
});

test("deriveChannel: チャネルが判別できない文言は null", () => {
  // 「抽選」だけではアプリか店頭か決まらないので推測しない
  assert.equal(deriveChannel("抽選方式"), null);
  assert.equal(deriveChannel("抽選(会員カード不要)"), null);
  assert.equal(deriveChannel(null), null);
  assert.equal(deriveChannel(""), null);
});

test("deriveChannel: app と onsite の両方の語を含む場合は app を優先する", () => {
  // ハイブリッド運用の店。reviewFlags 側で要確認として拾う
  assert.equal(deriveChannel("店頭/モバイル抽選"), "app");
});

// --- deriveTool: アプリ名 ---

test("deriveTool: 既知のツール名を正規化して返す", () => {
  assert.equal(deriveTool("モバイル抽選(777コンパス)"), "777コンパス");
  assert.equal(deriveTool("777コンパス モバイル抽選"), "777コンパス");
  // 「コンパス」だけの表記も 777コンパス に寄せる
  assert.equal(deriveTool("モバイル抽選(コンパス、2024-12-15方式変更)"), "777コンパス");
  assert.equal(deriveTool("入場くんオンライン(モバイル抽選)"), "入場くんオンライン");
});

test("deriveTool: ∞付きは別ツール名として区別する", () => {
  assert.equal(deriveTool("モバイル抽選(入場くんオンライン∞)"), "入場くんオンライン∞");
});

test("deriveTool: ツール名の記載がなければ null", () => {
  assert.equal(deriveTool("モバイル抽選"), null);
  assert.equal(deriveTool("整理券(会員カード不要)"), null);
  assert.equal(deriveTool(null), null);
});

// --- deriveRandom: 抽選要素の有無 ---

test("deriveRandom: 文言に「抽選」があれば true", () => {
  assert.equal(deriveRandom("整理券抽選"), true);
  assert.equal(deriveRandom("整理券・シャッフル抽選"), true);
  assert.equal(deriveRandom("抽選方式"), true);
});

test("deriveRandom: 抽選の記載が無ければ null（false と断定しない）", () => {
  // 「整理券」だけでは先着か抽選か決まらない。無記載を false と読むのは推測補完
  assert.equal(deriveRandom("整理券(会員カード不要)"), null);
  assert.equal(deriveRandom("整理券"), null);
  assert.equal(deriveRandom(null), null);
});

// --- reviewFlags: 要確認の理由 ---

test("reviewFlags: チャネル不明・抽選有無不明を理由として返す", () => {
  assert.deepEqual(reviewFlags("抽選方式"), ["チャネル不明"]);
  assert.deepEqual(reviewFlags("整理券"), ["抽選有無不明"]);
});

test("reviewFlags: app なのにツール名が無い場合を拾う", () => {
  assert.deepEqual(reviewFlags("モバイル抽選"), ["ツール名不明"]);
});

test("reviewFlags: 店頭とアプリの併記はハイブリッド疑いとして拾う", () => {
  assert.ok(reviewFlags("店頭/モバイル抽選").includes("ハイブリッド疑い"));
});

test("reviewFlags: パチ/スロ差分の疑いを拾う", () => {
  assert.ok(reviewFlags("モバイル抽選(スロ)").includes("パチ/スロ差分疑い"));
  assert.ok(reviewFlags("整理券(パチ/スロ別抽選)").includes("パチ/スロ差分疑い"));
});

test("reviewFlags: 判別できる文言なら空配列", () => {
  assert.deepEqual(reviewFlags("整理券抽選"), []);
  assert.deepEqual(reviewFlags("モバイル抽選(777コンパス)"), []);
});

test("reviewFlags: 略称だけでツール名を推定した場合は要確認にする", () => {
  // 原文に「777」が無く「コンパス」だけ → 推定なので確定扱いにしない
  assert.ok(
    reviewFlags("モバイル抽選(コンパス、2024-12-15方式変更)").includes("ツール名要確認(略称一致)")
  );
  // 正式名称が書かれていれば要確認にしない
  assert.deepEqual(reviewFlags("モバイル抽選(777コンパス)"), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test test/lottery.test.mjs`
Expected: FAIL（`Cannot find module ... lottery.mjs`）

- [ ] **Step 3: lottery.mjs を実装する**

`lottery.mjs` を新規作成する。

```js
// 抽選方式（lottery）の派生・正規化・ラベル生成。app.js と scripts/ から import する。
//
// 重要: 派生は「出典から記録済みの method 文言を読む」ことに限定する。
// 文言から判別できない項目は null のままにし、reviewFlags() で要確認として返す。
// 無記載を false と断定しない（推測補完の禁止）。

// アプリ・オンライン抽選を示す語
const APP_MARKERS = ["モバイル", "オンライン", "コンパス", "入場くん", "アプリ"];
// 店頭での配布・抽選を示す語。「抽選」単独はチャネルを決めないので含めない
const ONSITE_MARKERS = ["整理券", "店頭", "抽選券"];
// パチ/スロで方式が分かれている可能性を示す語
const GENRE_MARKERS = ["パチ", "スロ"];

// 表記ゆれをツール名へ正規化する。∞付きを先に判定すること（部分一致の取りこぼし防止）
const TOOL_PATTERNS = [
  [/入場くんオンライン∞/, "入場くんオンライン∞"],
  [/入場くん/, "入場くんオンライン"],
  [/コンパス/, "777コンパス"],
];

function hasAny(method, markers) {
  return markers.some((m) => method.includes(m));
}

/**
 * 入場チャネルを返す。判別できなければ null。
 * @param {string|null} method
 * @returns {"lineup"|"onsite"|"app"|null}
 */
export function deriveChannel(method) {
  if (!method) return null;
  if (hasAny(method, APP_MARKERS)) return "app";
  if (hasAny(method, ONSITE_MARKERS)) return "onsite";
  return null;
}

/**
 * アプリ・ツール名を返す。記載が無ければ null。
 * @param {string|null} method
 * @returns {string|null}
 */
export function deriveTool(method) {
  if (!method) return null;
  for (const [pattern, name] of TOOL_PATTERNS) {
    if (pattern.test(method)) return name;
  }
  return null;
}

/**
 * 抽選要素の有無を返す。「抽選」の記載があれば true、無ければ null。
 * 無記載を false（＝先着確定）と読むのは推測になるため null を返す。
 * @param {string|null} method
 * @returns {true|null}
 */
export function deriveRandom(method) {
  if (!method) return null;
  return method.includes("抽選") ? true : null;
}

/**
 * 出典の再確認が必要な理由を配列で返す。空配列なら文言だけで確定できている。
 * @param {string|null} method
 * @returns {string[]}
 */
export function reviewFlags(method) {
  const flags = [];
  if (!method) return ["方式未記載"];

  const channel = deriveChannel(method);
  if (channel === null) flags.push("チャネル不明");
  if (deriveRandom(method) === null) flags.push("抽選有無不明");
  if (channel === "app" && deriveTool(method) === null) flags.push("ツール名不明");
  if (hasAny(method, APP_MARKERS) && hasAny(method, ONSITE_MARKERS)) {
    flags.push("ハイブリッド疑い");
  }
  if (hasAny(method, GENRE_MARKERS)) flags.push("パチ/スロ差分疑い");
  // 「コンパス」だけの略称からツール名を推定した場合は確定扱いにしない
  if (method.includes("コンパス") && !method.includes("777")) {
    flags.push("ツール名要確認(略称一致)");
  }
  return flags;
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `node --test test/lottery.test.mjs`
Expected: PASS（15件）

- [ ] **Step 5: コミット**

```bash
git add lottery.mjs test/lottery.test.mjs && git commit -m "feat: 抽選方式のmethod文言からの派生ロジックを追加(lottery.mjs)"
```

---

### Task 2: lottery.mjs — パチ/スロ差分の解決とバッジ用ラベル

**方針:** パチとスロで抽選方式が違う店（実データに「モバイル抽選(スロ)」「整理券(パチ/スロ別抽選)」が存在する）に対応する。共通値をトップレベルに置き、異なる項目だけ `lottery.pachinko` / `lottery.slot` で上書きできるようにする。ラベル生成は Phase 3 のビューワが使う。

**Files:**
- Modify: `lottery.mjs`（末尾に追記）
- Modify: `test/lottery.test.mjs`（末尾に追記）

- [ ] **Step 1: 失敗するテストを追記する**

`test/lottery.test.mjs` の import 行を差し替え、ファイル末尾にテストを追記する。

import 行を以下に差し替える:

```js
import {
  deriveChannel,
  deriveTool,
  deriveRandom,
  reviewFlags,
  resolveLottery,
  lotteryLabel,
} from "../lottery.mjs";
```

末尾に追記:

```js
// --- resolveLottery: パチ/スロ差分の解決 ---

test("resolveLottery: サブオブジェクトが無ければ共通値をそのまま返す", () => {
  const lottery = { type: "onsite", random: true, tool: null, method: "整理券抽選" };
  assert.deepEqual(resolveLottery(lottery, "slot"), lottery);
  assert.deepEqual(resolveLottery(lottery, "pachinko"), lottery);
});

test("resolveLottery: genre 指定時はサブオブジェクトで上書きする", () => {
  const lottery = {
    type: "onsite",
    random: true,
    tool: null,
    method: "整理券(パチ/スロ別抽選)",
    slot: { type: "app", tool: "777コンパス" },
  };
  const slot = resolveLottery(lottery, "slot");
  assert.equal(slot.type, "app");
  assert.equal(slot.tool, "777コンパス");
  // 上書きされていない項目は共通値が残る
  assert.equal(slot.random, true);
  // サブオブジェクト自体は結果に混入させない
  assert.equal(slot.slot, undefined);
});

test("resolveLottery: genre 未指定なら共通値のみ（サブオブジェクトは除去）", () => {
  const lottery = { type: "onsite", slot: { type: "app" } };
  const resolved = resolveLottery(lottery, null);
  assert.equal(resolved.type, "onsite");
  assert.equal(resolved.slot, undefined);
});

test("resolveLottery: lottery が無い店は null を返す", () => {
  assert.equal(resolveLottery(null, "slot"), null);
});

// --- lotteryLabel: バッジ文言 ---

test("lotteryLabel: app はツール名を併記する", () => {
  assert.equal(lotteryLabel({ type: "app", tool: "777コンパス" }), "アプリ抽選(777コンパス)");
  assert.equal(lotteryLabel({ type: "app", tool: null }), "アプリ抽選");
});

test("lotteryLabel: onsite は抽選有無で文言を分ける", () => {
  assert.equal(lotteryLabel({ type: "onsite", random: true }), "店頭抽選");
  assert.equal(lotteryLabel({ type: "onsite", random: false }), "先着整理券");
  // 抽選有無が未確認のときは断定しない中立表現
  assert.equal(lotteryLabel({ type: "onsite", random: null }), "店頭整理券");
});

test("lotteryLabel: lineup は並び順", () => {
  assert.equal(lotteryLabel({ type: "lineup", random: false }), "並び順");
});

test("lotteryLabel: type 未確認はバッジを出さない（null を返す）", () => {
  // 「抽選なし」と誤読させないため、未確認はバッジ非表示にする
  assert.equal(lotteryLabel({ type: null, random: true }), null);
  assert.equal(lotteryLabel(null), null);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test test/lottery.test.mjs`
Expected: FAIL（`resolveLottery is not a function`）

- [ ] **Step 3: lottery.mjs に実装を追記する**

`lottery.mjs` の末尾に追記する。

```js
/**
 * パチ/スロで方式が異なる店の値を解決する。
 * 共通値（トップレベル）に genre のサブオブジェクトを重ねた新しいオブジェクトを返す。
 * サブオブジェクト自体（pachinko / slot）は結果に含めない。
 * @param {object|null} lottery
 * @param {"pachinko"|"slot"|null} genre
 * @returns {object|null}
 */
export function resolveLottery(lottery, genre) {
  if (!lottery) return null;
  const { pachinko, slot, ...common } = lottery;
  const override = genre === "pachinko" ? pachinko : genre === "slot" ? slot : null;
  return override ? { ...common, ...override } : common;
}

/**
 * バッジ表示用の日本語ラベルを返す。
 * type が未確認（null）のときは null を返し、呼び出し側でバッジを出さない
 * （「抽選なし」と誤読されるのを避けるため）。
 * @param {object|null} lottery resolveLottery 済みのオブジェクト
 * @returns {string|null}
 */
export function lotteryLabel(lottery) {
  if (!lottery || !lottery.type) return null;
  switch (lottery.type) {
    case "app":
      return lottery.tool ? `アプリ抽選(${lottery.tool})` : "アプリ抽選";
    case "onsite":
      if (lottery.random === true) return "店頭抽選";
      if (lottery.random === false) return "先着整理券";
      return "店頭整理券";
    case "lineup":
      return "並び順";
    default:
      return null;
  }
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `node --test test/lottery.test.mjs`
Expected: PASS（23件）

- [ ] **Step 5: コミット**

```bash
git add lottery.mjs test/lottery.test.mjs && git commit -m "feat: パチ/スロ差分の解決とバッジラベル生成を追加(lottery.mjs)"
```

---

### Task 3: validate.mjs — stores.json のスキーマ検証

**方針:** 収集で入ってくる新フィールド（lottery.type/random/tool・sns・crowd・annual+label）の型崩れを機械的に弾く。**未確認を意味する `null` や、フィールドそのものの欠損はエラーにしない**（収集途中の状態が正常なため）。エラーは「値が入っているが型・列挙値が不正」なケースに限る。

**Files:**
- Create: `validate.mjs`
- Test: `test/validate.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`test/validate.test.mjs` を新規作成する。

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateStores } from "../validate.mjs";

// 検証を通る最小の店データ
function store(overrides = {}) {
  return { id: "s1", name: "テスト店", area: "上野", rules: [], ...overrides };
}

test("validateStores: 最小構成の店はエラーも警告も出さない", () => {
  const { errors, warnings } = validateStores([store()]);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("validateStores: id 重複をエラーにする", () => {
  const { errors } = validateStores([store(), store()]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /id重複/);
});

// --- lottery ---

test("validateStores: lottery.type の未知の値をエラーにする", () => {
  const { errors } = validateStores([store({ lottery: { type: "unknown" } })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /lottery\.type/);
});

test("validateStores: lottery.type が null や未指定なら通る（未確認は正常）", () => {
  assert.deepEqual(validateStores([store({ lottery: { type: null } })]).errors, []);
  assert.deepEqual(validateStores([store({ lottery: { method: "整理券" } })]).errors, []);
});

test("validateStores: lottery.random が真偽値でも null でもなければエラー", () => {
  const { errors } = validateStores([store({ lottery: { type: "onsite", random: "yes" } })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /lottery\.random/);
});

test("validateStores: type=app でツール名が無い場合は警告（エラーではない）", () => {
  const { errors, warnings } = validateStores([store({ lottery: { type: "app", tool: null } })]);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tool/);
});

test("validateStores: lottery のサブオブジェクトに未知のキーがあればエラー", () => {
  const { errors } = validateStores([
    store({ lottery: { type: "onsite", slot: { type: "app", nonsense: 1 } } }),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /slot/);
});

test("validateStores: サブオブジェクトの入れ子（slot の中の slot）をエラーにする", () => {
  const { errors } = validateStores([
    store({ lottery: { type: "onsite", slot: { slot: { type: "app" } } } }),
  ]);
  assert.equal(errors.length, 1);
});

// --- sns ---

test("validateStores: sns の未知のキーをエラーにする", () => {
  const { errors } = validateStores([store({ sns: { tiktok: "https://example.com" } })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sns/);
});

test("validateStores: sns の値が URL でなければエラー、null は通る", () => {
  assert.equal(validateStores([store({ sns: { x: "@someaccount" } })]).errors.length, 1);
  assert.deepEqual(validateStores([store({ sns: { x: null, line: null } })]).errors, []);
  assert.deepEqual(
    validateStores([store({ sns: { x: "https://x.com/example" } })]).errors,
    []
  );
});

// --- crowd ---

test("validateStores: crowd は note/sourceUrl/checkedAt が揃っていること", () => {
  const ok = { note: "アクセス集中日あり", sourceUrl: "https://example.com", checkedAt: "2026-07-31" };
  assert.deepEqual(validateStores([store({ crowd: ok })]).errors, []);

  // sourceUrl と checkedAt の両方が欠けるので2件出る
  const { errors } = validateStores([store({ crowd: { note: "メモだけ" } })]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /crowd/);
});

test("validateStores: crowd.checkedAt の日付形式が不正ならエラー", () => {
  const bad = { note: "n", sourceUrl: "https://example.com", checkedAt: "2026/07/31" };
  const { errors } = validateStores([store({ crowd: bad })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /checkedAt/);
});

// --- annual rule ---

test("validateStores: annual の month/day 範囲外をエラーにする", () => {
  const { errors } = validateStores([
    store({ rules: [{ type: "annual", month: 13, day: 1 }] }),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /annual/);
});

test("validateStores: annual の label は文字列なら通り、文字列以外はエラー", () => {
  const ok = [{ type: "annual", month: 3, day: 15, label: "グランドオープン記念" }];
  assert.deepEqual(validateStores([store({ rules: ok })]).errors, []);

  const ng = [{ type: "annual", month: 3, day: 15, label: 5 }];
  assert.equal(validateStores([store({ rules: ng })]).errors.length, 1);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test test/validate.test.mjs`
Expected: FAIL（`Cannot find module ... validate.mjs`）

- [ ] **Step 3: validate.mjs を実装する**

`validate.mjs` を新規作成する。

```js
// data/stores.json のスキーマ検証。scripts/validate-data.mjs から呼ぶ。
//
// 方針: 「未確認（null）」「フィールドそのものが無い」は正常とみなす（収集途中の状態）。
// エラーにするのは、値が入っているのに型・列挙値・形式が不正なケースだけ。

const LOTTERY_TYPES = new Set(["lineup", "onsite", "app"]);
const LOTTERY_KEYS = new Set(["type", "random", "tool", "method", "draw", "lineup", "auth"]);
const SNS_KEYS = new Set(["x", "line", "instagram"]);
const URL_RE = /^https?:\/\//;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUrl(v) {
  return typeof v === "string" && URL_RE.test(v);
}

function checkLotteryCore(lottery, label, errors, warnings) {
  if (lottery.type != null && !LOTTERY_TYPES.has(lottery.type)) {
    errors.push(`${label}: lottery.type が不正 "${lottery.type}"`);
  }
  if (lottery.random != null && typeof lottery.random !== "boolean") {
    errors.push(`${label}: lottery.random は真偽値かnull "${lottery.random}"`);
  }
  if (lottery.type === "app" && !lottery.tool) {
    warnings.push(`${label}: type=app だが tool 未特定（出典で要確認）`);
  }
}

function checkLottery(lottery, label, errors, warnings) {
  checkLotteryCore(lottery, label, errors, warnings);

  for (const genre of ["pachinko", "slot"]) {
    const sub = lottery[genre];
    if (sub == null) continue;
    if (typeof sub !== "object") {
      errors.push(`${label}: lottery.${genre} はオブジェクト`);
      continue;
    }
    const unknown = Object.keys(sub).filter((k) => !LOTTERY_KEYS.has(k));
    if (unknown.length) {
      errors.push(`${label}: lottery.${genre} に未知のキー ${unknown.join(",")}`);
    }
    checkLotteryCore(sub, `${label}/${genre}`, errors, warnings);
  }
}

function checkSns(sns, label, errors) {
  const unknown = Object.keys(sns).filter((k) => !SNS_KEYS.has(k));
  if (unknown.length) {
    errors.push(`${label}: sns に未知のキー ${unknown.join(",")}`);
  }
  for (const [key, value] of Object.entries(sns)) {
    if (value != null && !isUrl(value)) {
      errors.push(`${label}: sns.${key} はURLかnull "${value}"`);
    }
  }
}

function checkCrowd(crowd, label, errors) {
  if (typeof crowd.note !== "string" || !crowd.note) {
    errors.push(`${label}: crowd.note が未設定`);
  }
  if (!isUrl(crowd.sourceUrl)) {
    errors.push(`${label}: crowd.sourceUrl がURLでない`);
  }
  if (typeof crowd.checkedAt !== "string" || !DATE_RE.test(crowd.checkedAt)) {
    errors.push(`${label}: crowd.checkedAt はYYYY-MM-DD形式`);
  }
}

function checkAnnualRule(rule, label, errors) {
  const monthOk = Number.isInteger(rule.month) && rule.month >= 1 && rule.month <= 12;
  const dayOk = Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31;
  if (!monthOk || !dayOk) {
    errors.push(`${label}: annual の month/day が不正 (${rule.month}/${rule.day})`);
  }
  if (rule.label != null && typeof rule.label !== "string") {
    errors.push(`${label}: annual の label は文字列`);
  }
}

/**
 * 店舗配列を検証し、errors（要修正）と warnings（要確認）を返す。
 * @param {object[]} stores
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateStores(stores) {
  const errors = [];
  const warnings = [];
  const seenIds = new Set();

  for (const store of stores) {
    const label = store.id || store.name || "(id不明)";

    if (seenIds.has(store.id)) errors.push(`${label}: id重複`);
    seenIds.add(store.id);

    if (store.lottery) checkLottery(store.lottery, label, errors, warnings);
    if (store.sns) checkSns(store.sns, label, errors);
    if (store.crowd) checkCrowd(store.crowd, label, errors);

    for (const rule of store.rules || []) {
      if (rule.type === "annual") checkAnnualRule(rule, label, errors);
    }
  }

  return { errors, warnings };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `node --test test/validate.test.mjs`
Expected: PASS（14件）

- [ ] **Step 5: コミット**

```bash
git add validate.mjs test/validate.test.mjs && git commit -m "feat: stores.jsonのv3スキーマ検証を追加(validate.mjs)"
```

---

### Task 4: 検証CLI と現行データへの適用

**Files:**
- Create: `scripts/validate-data.mjs`

- [ ] **Step 1: CLI を作成する**

`scripts/validate-data.mjs` を新規作成する。

```js
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
```

- [ ] **Step 2: 現行データに対して実行する**

Run: `node scripts/validate-data.mjs`
Expected: `errors 0`。現行データにはまだ lottery.type / sns / crowd / annual が無いため warnings も 0 で、`検証: 35店 / errors 0 / warnings 0` と出る。errors が出た場合は既存データの不整合なので、内容を確認してから次へ進む

- [ ] **Step 3: コミット**

```bash
git add scripts/validate-data.mjs && git commit -m "feat: データ検証CLIを追加(scripts/validate-data.mjs)"
```

---

### Task 5: 既存35店の lottery 移行

**方針:** `lottery.method` の文言から機械的に確定できる `type` / `random` / `tool` だけを書き込み、確定できないものは `null` のまま残す。同時に「出典を再確認すべき店」のリストを `_staging/` に出力し、Phase 2 の収集対象を明確にする。スクリプトは何度実行しても同じ結果になる（冪等）ようにする。

**Files:**
- Create: `scripts/migrate-lottery.mjs`
- Modify: `data/stores.json`（スクリプト実行による）

- [ ] **Step 1: 移行スクリプトを作成する**

`scripts/migrate-lottery.mjs` を新規作成する。

```js
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
```

- [ ] **Step 2: 移行を実行する**

Run: `node scripts/migrate-lottery.mjs`
Expected: `移行 35店 / スキップ 0店 / 要確認 ...店`（全35店が `lottery` オブジェクトを持っているため全件が移行対象になる）

なお `data/stores.json` の `updated` は**意図的に更新しない**。今回は既存の記録済み文言から派生値を作っただけで、出典の再確認（`checkedAt` の更新）は行っていないため

- [ ] **Step 3: 冪等性を確認する**

同じコマンドをもう一度実行する。

Run: `node scripts/migrate-lottery.mjs`
Expected: `移行 0店 / スキップ 35店 ...`（2回目は全店スキップされる）

- [ ] **Step 4: 検証とテストを実行する**

Run: `node scripts/validate-data.mjs`
Expected: `errors 0`。`type=app` でツール名が無い店の warnings が数件出るのは想定どおり

Run: `node --test test/*.test.mjs`
Expected: 全件 PASS（実績: match 18 + coverage 5 + lottery 26 + validate 20 = 69件。レビュー指摘対応でテストを追加したため計画時の見込みより増えている）

- [ ] **Step 5: 差分を目視確認する**

Run: `git diff --stat data/stores.json`
Expected: `data/stores.json` 1ファイルのみ変更。改行コード起因で全行変更に見える場合は `git diff data/stores.json | head -40` で中身が lottery への追記だけであることを確認する（バイト比較・md5比較はしない）

- [ ] **Step 6: コミット**

```bash
git add scripts/migrate-lottery.mjs data/stores.json && git commit -m "feat: 既存35店のlotteryにtype/random/toolを派生付与(判別不能はnull保持)"
```

---

### Task 6: 収集手順書（researcher 指示テンプレート）

**方針:** Phase 1 後半（新規8エリア収集）と Phase 2（既存店の要確認スイープ）で researcher へ渡す指示を、毎回書き起こさずに済むようドキュメント化する。`docs/取材予定の確認手順.md` と同じ構成にする。

**Files:**
- Create: `docs/収集手順_v3.md`

- [ ] **Step 1: 手順書を作成する**

`docs/収集手順_v3.md` を新規作成する。

```markdown
# v3 データ収集手順（特定日・抽選・周年・SNS・混雑）

新規エリアの店舗収集と、既存店の要確認スイープで共通に使う手順。1店舗につき1回の訪問で全項目を拾うことでトークン消費を抑える。

## ソース序列

| 順位 | ソース | 用途 | 取得方法 |
|------|--------|------|----------|
| 第1 | すろざんまい（https://manmai.club/?p=5615） | 特定日パターン | **curl で生HTML取得 → Python で機械抽出**。WebFetch の要約は照会ごとに数値がぶれるため使わない |
| 第2 | みんパチ（https://minpachi.com/） | 店舗詳細・抽選方式・周年・公式SNSリンク | 店舗個別ページ |
| 補助 | 店公式サイト・公式X | 抽選ツール名の裏取り、SNSリンク | みんパチ記載が古いことがあるため |

生HTMLのデコードは utf-8 を先に試す（cp932 で読むと文字化けする）。コンソール表示だけの化けとファイル破損を混同しない。

## 収集項目（1店舗1パス）

- `rules[]` — 特定日パターン。型は `digit` / `monthday`（`value:"last"` で月末）/ `annual` / `weekday` / `nth-weekday` / `zorome` / `month-day-match`
- `lottery` — `type`（`lineup` / `onsite` / `app`）、`random`（抽選要素の有無）、`tool`（アプリ名）、`method`（原文）、`draw` / `lineup` / `auth`
  - **パチとスロで方式が違う場合**は共通値をトップレベルに置き、異なる項目だけ `lottery.pachinko` / `lottery.slot` に入れる
- 周年・店固有日 — `rules[]` に `{ "type": "annual", "month": M, "day": D, "label": "5周年" }` の形で追加する
- `sns` — `{ "x": URL|null, "line": URL|null, "instagram": URL|null }`。**みんパチ店舗ページのリンク欄 → 無ければ店公式サイトのフッター/ヘッダー** から取る。Web検索での推測取得はしない（同名アカウントの誤爆防止）
- `crowd` — `{ "note": "...", "sourceUrl": "...", "checkedAt": "YYYY-MM-DD" }`。混雑・アクセス集中の参考情報。断定表現は使わず伝聞形式で書く
- `sources[]` — 全データに出典URL＋確認日が必須

## 禁止事項

- **出典に無い情報を推測で埋めない。** 判別できない項目は `null` のままにし、理由を `memo` に書く
- 第1ソースと第2ソースで食い違ったら、どちらかを採用して消すのではなく `memo` に両方を記録する
- Playwright が必要なサイト（bot遮断で403になるもの）は researcher に割り当てない。メイン側の作業として切り出す

## 出力先

`_staging/{エリア名}.md` へ直書きし、完了報告は要約のみ返す（メイン側で中間整形しない）。

## 新規エリアの担当割り（3並列・沿線でまとめる）

| 担当 | エリア |
|------|--------|
| 1 | 中野・吉祥寺・立川（中央線） |
| 2 | 町田・蒲田（南部） |
| 3 | 錦糸町・北千住・赤羽（東部・北部） |

## 着手前の確認

1. 第1ソース（manmai.club/?p=5615）が対象8エリアを収録しているかをサンプル確認する。未収録エリアは代替ソースを決めてから収集を始める
2. DMMぱちタウンのアクセス集中日が curl の生HTMLで取れるかを1店で判定する。JS描画で取れない場合はメイン側の Playwright 作業に切り出す

## 取り込み後の検証

```
node scripts/validate-data.mjs
node --test test/*.test.mjs
```
```

- [ ] **Step 2: コミット**

```bash
git add docs/収集手順_v3.md && git commit -m "docs: v3データ収集手順(researcher指示テンプレート)を追加"
```

---

### Task 7: 公開後に残っていたフッター誤記の修正とドキュメント追随

**背景:** `index.html` のフッターに「非公開ローカルツール（GitHub非掲載）」という記述が残っているが、このリポジトリは 2026-07-17 に公開へ変更済み（README も公開前提に更新済み）。公開ページに事実と異なる記述が出ているため修正する。

**Files:**
- Modify: `index.html`（フッター）
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: フッターを修正する**

`index.html` の該当行を以下のように置き換える。

置換前:

```html
    データ出典は各店カード内リンクを参照。非公開ローカルツール（GitHub非掲載）。
```

置換後:

```html
    データ出典は各店カード内リンクを参照。掲載情報は第三者サイト由来の過去傾向推定であり、店舗の公式情報ではありません。
```

- [ ] **Step 2: ブラウザで表示を確認する**

`preview_start` で `tokyo-pachi-guide`（ワークスペース root の `.claude/launch.json` に登録済み・ポート8099）を起動し、`http://localhost:8099/` を開く。静的サイトは HMR が効かないため、編集後は `location.reload()` してから確認する。

Expected: フッターが新しい文言になっており、5タブすべてが従来どおり描画される（今日／明日／日付指定／エリア別一覧／取材傾向）。コンソールにエラーが出ていないこと

- [ ] **Step 3: README を更新する**

`README.md` の「構成」セクションに以下の3行を追加する（`coverage.mjs` の行の後）。

```markdown
- `lottery.mjs` — 抽選方式の派生（method文言→type/random/tool）・パチ/スロ差分の解決・バッジ用ラベル生成
- `validate.mjs` — `data/stores.json` のスキーマ検証（v3フィールド: lottery.type/random/tool・sns・crowd・annual+label）
- `scripts/` — `validate-data.mjs`（検証CLI）・`migrate-lottery.mjs`（既存店のlottery派生付与）
```

同じく「構成」セクションの `docs/取材予定の確認手順.md` の行の後に追加する。

```markdown
- `docs/収集手順_v3.md` — 特定日・抽選・周年・SNS・混雑を1パスで集める収集手順とソース序列
```

`test/` の行を以下に差し替える（テスト件数の更新）。

```markdown
- `test/` — `node --test test/*.test.mjs` で実行（match 18件 + coverage 5件 + lottery 23件 + validate 14件）
```

- [ ] **Step 4: CHANGELOG を更新する**

`CHANGELOG.md` の先頭（最新セクションの上）に追加する。

```markdown
## 2026-07-31

### 追加
- `lottery.mjs` — 抽選方式の派生ロジック（`method` の文言から `type`／`random`／`tool` を導出。判別できない項目は `null` のまま残す）、パチ/スロ差分の解決、バッジ用ラベル生成
- `validate.mjs` + `scripts/validate-data.mjs` — `stores.json` のスキーマ検証（lottery・sns・crowd・annual+label）
- `scripts/migrate-lottery.mjs` — 既存店の lottery へ派生値を付与し、要確認リストを出力
- `docs/収集手順_v3.md` — v3 データ収集手順（researcher 指示テンプレート）

### 変更
- `data/stores.json` — 既存店の `lottery` に `type`／`random`／`tool` を追加（出典から判別できない項目は `null`）
- `index.html` — フッターの「非公開ローカルツール」記述を公開後の実態に合わせて修正
```

- [ ] **Step 5: 全テストと検証を実行する**

Run: `node --test test/*.test.mjs`
Expected: 全件 PASS（実績69件）

Run: `node scripts/validate-data.mjs`
Expected: `errors 0`

- [ ] **Step 6: コミット**

```bash
git add index.html README.md CHANGELOG.md && git commit -m "docs: v3 Phase1のREADME/CHANGELOG追随とフッター誤記修正"
```

---

## Phase 1 完了後の作業（本計画のスコープ外）

以下は本計画のタスクではなく、完了後に別途実施する。

- **新規8エリアの収集** — `docs/収集手順_v3.md` に沿って researcher 3並列で実施。着手前確認2点（第1ソースの収録範囲・DMMぱちタウンの取得可否）を先に済ませる
- **Phase 2: 既存店の要確認スイープ** — `_staging/lottery-review.md` の対象店を出典で再確認し、`random` や `tool` を埋める
- **Phase 3: ビューワー拡張** — 抽選バッジ（`lotteryLabel` を app.js へ配線）、周年 label 表示、SNS・混雑リンク、`docs/示唆・イベントの確認手順.md`。別計画として作成する
