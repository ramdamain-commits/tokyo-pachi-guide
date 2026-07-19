# 下北沢追加＋取材系強化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 下北沢エリアを stores.json に追加し、取材系を coverage.json 新設＋media.json 拡充＋手順書＋ビューワ強化の4点で強化する。

**Architecture:** データは3ファイル分離（stores=特定日マスタ / media=媒体マスタ / coverage=店舗×媒体の紐付け）。結合ロジックは `coverage.mjs` の純関数に切り出し `node --test` で担保。ビューワは既存5タブ構成を維持し取材傾向タブと店舗カードを拡張。

**Tech Stack:** Vanilla JS (ES modules), `node --test`, 静的JSON, GitHub Pages。

**設計書:** `docs/superpowers/specs/2026-07-20-shimokitazawa-coverage-design.md`

**調査委任の共通ルール（Task 1/3/4 で適用）:**
- researcher エージェント（model: sonnet）に委任。出力は `_staging/` へ直書きさせ、完了報告は要約のみ
- 一次抽出は curl 生HTML＋スクリプト機械抽出（WebFetch のAI要約は数値がぶれる）。デコードは utf-8 → cp932 → shift_jis の順
- bot遮断（403）サイトは researcher に割り当てず、メイン側の Playwright MCP 作業として切り出す
- 相互検証: 集約サイトで当たり→媒体公式で裏取り。両者一致のみ `confidence: "高"`、片側のみ `"中"` or `"低"`
- 並列は最大3

---

### Task 1: 下北沢の店舗調査（researcher 委任）

**Files:**
- Create: `_staging/shimokitazawa-stores.md`（researcher が直書き）

- [ ] **Step 1: researcher を1体ディスパッチ**

プロンプト骨子（上記共通ルールを含めること）:

```
下北沢駅から徒歩10分圏のパチンコ・パチスロ店を全店リストアップし、各店について以下を調査:
店名/住所/アクセス/スロ台数/パチ台数/特定日パターン(「5のつく日」等)/抽選方式・時刻/営業時間/換金率/出典URL+確認日。
情報源: みんパチ(minpachi.com)・manmai.club 等の集約サイト＋店舗公式。curl 生HTML+機械抽出で取得し、
結果を C:/Users/ramda/projects/tokyo-pachi-guide/_staging/shimokitazawa-stores.md へ
既存 data/stores.json のスキーマ（下記サンプル貼付）に合わせた JSON 断片＋根拠メモとして直書きする。
閉店済み店舗も closed フィールド付きで含める。403 で取れないサイトは URL を「未取得」として明記する。
```

プロンプトには `data/stores.json` の1店分サンプル（PIA上野のエントリ）を丸ごと貼り付けてスキーマを示す。

- [ ] **Step 2: 完了通知後に成果物を検収**

Run: `cat _staging/shimokitazawa-stores.md` を読み、店数（2〜4店想定）・出典URL・確認日の有無を確認。403未取得が残っていればメイン側で Playwright MCP により補完する。

### Task 2: stores.json へ下北沢追加＋AREA_ORDER 更新

**Files:**
- Modify: `data/stores.json`（stores 配列末尾に下北沢店を追加、updated を更新）
- Modify: `app.js:4`（AREA_ORDER に "下北沢" を追加）

- [ ] **Step 1: stores.json に下北沢エントリを追加**

Task 1 の検収済み JSON 断片を stores 配列へ追記（`area: "下北沢"`、id は `<チェーン名ローマ字>-shimokitazawa` 形式）。`updated` を作業日に更新。

- [ ] **Step 2: JSON 整合を検証**

Run:
```bash
cd /c/Users/ramda/projects/tokyo-pachi-guide && python3 << 'PYEOF'
import json,sys; sys.stdout.reconfigure(encoding='utf-8')
d=json.load(open('data/stores.json',encoding='utf-8'))
ids=[s['id'] for s in d['stores']]
assert len(ids)==len(set(ids)), "id重複"
print(len(d['stores']),"stores OK")
print([s['name'] for s in d['stores'] if s['area']=='下北沢'])
PYEOF
```
Expected: 店数が32+追加数、下北沢の店名が表示される。

- [ ] **Step 3: AREA_ORDER を更新**

`app.js:4` を以下に変更:

```js
const AREA_ORDER = ["上野", "秋葉原", "新宿", "渋谷", "下北沢", "池袋", "新橋", "京橋/銀座"];
```

- [ ] **Step 4: 既存テストの確認**

Run: `node --test test/`
Expected: 全件 pass（match.mjs 非変更のため）。

- [ ] **Step 5: ローカル表示確認**

Run: `python3 -m http.server 8099` → ブラウザ（Playwright MCP 可）で `http://localhost:8099/` を開き、エリア別タブに「下北沢」見出しと店カードが出ることを確認。

- [ ] **Step 6: Commit**

```bash
git add data/stores.json app.js && git commit -m "feat: 下北沢エリアを追加"
```

### Task 3: media.json 拡充（researcher 委任 → 追記）

**Files:**
- Create: `_staging/media-expansion.md`（researcher が直書き）
- Modify: `data/media.json`

- [ ] **Step 1: researcher を1体ディスパッチ**

プロンプト骨子:

```
パチンコ・パチスロの取材/来店イベント媒体を調査し、既存7媒体（リスト貼付）に無いものを8〜13媒体追加調査する。
対象: 来店系（いそまる・よしき・ういち等の演者来店）、ホール取材系（〇〇取材・△△調査等の名称付き取材）、
雑誌・web媒体系。各媒体について: 媒体名/type(web・動画・来店等)/取材傾向(全台系・機種指定等)/
対象ジャンル/確度/公式スケジュールページURL(scheduleUrl)/出典URL+確認日。
既存 data/media.json のスキーマ（1媒体分サンプル貼付）＋新フィールド scheduleUrl で
_staging/media-expansion.md へ JSON 断片として直書き。公約は「〜とされる」の伝聞表現で書く。
```

- [ ] **Step 2: 既存7媒体にも scheduleUrl を調査・追記**

researcher の調査対象に既存7媒体の scheduleUrl も含める（Step 1 のプロンプトに明記）。休刊媒体（パチンコ攻略マガジン）は `scheduleUrl: null`。

- [ ] **Step 3: media.json へ統合**

検収後、新媒体を `media` 配列へ追加し、既存媒体に `scheduleUrl` を追記。`updated` を更新。

- [ ] **Step 4: JSON 検証**

Run:
```bash
python3 -c "import json;m=json.load(open('data/media.json',encoding='utf-8'));print(len(m['media']))"
```
Expected: 15〜20。エラーなし。

- [ ] **Step 5: Commit**

```bash
git add data/media.json && git commit -m "feat: 媒体マスタを拡充(scheduleUrl追加・15媒体規模へ)"
```

### Task 4: coverage.json 収集（researcher 並列 → 新設）

**Files:**
- Create: `_staging/coverage-{ueno-akiba,shinjuku-shibuya-shimokita,ikebukuro-shimbashi-ginza}.md`（researcher 3体が直書き）
- Create: `data/coverage.json`

- [ ] **Step 1: researcher を3並列でディスパッチ（エリア分割）**

分割は店舗数均等目安: ①上野+秋葉原(9店) ②新宿+渋谷+下北沢(10店+α) ③池袋+新橋+京橋銀座(13店)。プロンプト骨子（各自のエリアと店リストを差し替え）:

```
以下の店舗リスト（id・店名・住所を貼付）について、過去1年程度の取材実績を調査する。
手順: (1) スロカク・みんレポ等の集約サイトで店名検索し実績の当たりを付ける
(2) 媒体公式スケジュール/結果ページ（media.json の scheduleUrl リストを貼付）で裏取りする。
両者一致= confidence 高 / 片側のみ= 中 / 伝聞のみ= 低。
出力スキーマ: {storeId, mediaName(貼付した正規名から選ぶ・新規名は別枠でメモ), frequency, lastSeen(YYYY-MM),
confidence, sources[{url,checkedAt}], note} の JSON 断片。
_staging/coverage-<担当>.md へ直書き。実績が見つからない店は「実績なし」と明記（欠測≠取材なしの断定はしない）。
403 サイトは URL を「未取得」として明記。
```

- [ ] **Step 2: 3体の完了通知後に検収・統合**

confidence の根拠（両ソースURLの有無）をサンプル数店分で目視確認。researcher が「新規媒体名」を報告していたら media.json への追加要否を判断（追加時は Task 3 の形式で）。403未取得はメイン側 Playwright で補完。

- [ ] **Step 3: data/coverage.json を生成**

```json
{
  "updated": "2026-07-XX",
  "note": "過去の取材実績に基づく推定・伝聞情報であり、店舗・媒体の公式情報ではない",
  "coverage": [ /* _staging 3ファイルの検収済みエントリを統合 */ ]
}
```

- [ ] **Step 4: 参照整合を検証**

Run:
```bash
cd /c/Users/ramda/projects/tokyo-pachi-guide && python3 << 'PYEOF'
import json,sys; sys.stdout.reconfigure(encoding='utf-8')
s={x['id'] for x in json.load(open('data/stores.json',encoding='utf-8'))['stores']}
m={x['name'] for x in json.load(open('data/media.json',encoding='utf-8'))['media']}
c=json.load(open('data/coverage.json',encoding='utf-8'))['coverage']
bad=[x for x in c if x['storeId'] not in s or x['mediaName'] not in m]
print(len(c),"entries;", "NG:",bad if bad else "なし")
PYEOF
```
Expected: `NG: なし`。

- [ ] **Step 5: Commit**

```bash
git add data/coverage.json && git commit -m "feat: 店舗×媒体の取材実績 coverage.json を新設"
```

### Task 5: coverage.mjs 純関数＋テスト（TDD）

**Files:**
- Create: `coverage.mjs`
- Create: `test/coverage.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`test/coverage.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateCoverage, mediaForStore, storesForMedia } from "../coverage.mjs";

const stores = [{ id: "a" }, { id: "b" }];
const media = [{ name: "M1" }, { name: "M2" }];
const cov = [
  { storeId: "a", mediaName: "M1" },
  { storeId: "a", mediaName: "M2" },
  { storeId: "b", mediaName: "M1" },
  { storeId: "zzz", mediaName: "M1" },  // 不整合: storeId
  { storeId: "a", mediaName: "NoSuch" }, // 不整合: mediaName
];

test("validateCoverage: 不整合エントリを除外しwarningsに積む", () => {
  const { valid, warnings } = validateCoverage(cov, stores, media);
  assert.equal(valid.length, 3);
  assert.equal(warnings.length, 2);
});

test("mediaForStore: 店に紐づく実績を返す", () => {
  const { valid } = validateCoverage(cov, stores, media);
  assert.deepEqual(mediaForStore(valid, "a").map((c) => c.mediaName), ["M1", "M2"]);
  assert.equal(mediaForStore(valid, "nothing").length, 0);
});

test("storesForMedia: 媒体に紐づく店を返す", () => {
  const { valid } = validateCoverage(cov, stores, media);
  assert.deepEqual(storesForMedia(valid, "M1").map((c) => c.storeId), ["a", "b"]);
});

test("実データの参照整合: coverage.json の全キーが stores/media に存在する", () => {
  const s = JSON.parse(fs.readFileSync(new URL("../data/stores.json", import.meta.url)));
  const m = JSON.parse(fs.readFileSync(new URL("../data/media.json", import.meta.url)));
  const c = JSON.parse(fs.readFileSync(new URL("../data/coverage.json", import.meta.url)));
  const { warnings } = validateCoverage(c.coverage, s.stores, m.media);
  assert.deepEqual(warnings, []);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test test/coverage.test.mjs`
Expected: FAIL（`Cannot find module '../coverage.mjs'`）。

- [ ] **Step 3: 実装**

`coverage.mjs`:

```js
// 店舗×媒体の取材実績(coverage.json)の検証・結合ロジック。app.js から import する。

// coverage エントリのうち stores/media に実在するものだけを valid に残す。
// 不整合は warnings（文字列配列）として返し、呼び出し側で console.warn する。
export function validateCoverage(coverageList, stores, mediaList) {
  const storeIds = new Set(stores.map((s) => s.id));
  const mediaNames = new Set(mediaList.map((m) => m.name));
  const valid = [];
  const warnings = [];
  for (const c of coverageList) {
    if (!storeIds.has(c.storeId)) {
      warnings.push(`coverage: 未知のstoreId "${c.storeId}"`);
      continue;
    }
    if (!mediaNames.has(c.mediaName)) {
      warnings.push(`coverage: 未知のmediaName "${c.mediaName}"`);
      continue;
    }
    valid.push(c);
  }
  return { valid, warnings };
}

export function mediaForStore(coverageList, storeId) {
  return coverageList.filter((c) => c.storeId === storeId);
}

export function storesForMedia(coverageList, mediaName) {
  return coverageList.filter((c) => c.mediaName === mediaName);
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `node --test test/`
Expected: 既存18件＋新規4件 全pass。

- [ ] **Step 5: Commit**

```bash
git add coverage.mjs test/coverage.test.mjs && git commit -m "feat: coverage結合ロジックとテストを追加"
```

### Task 6: ビューワ強化

**Files:**
- Modify: `app.js`（coverage 読込、取材バッジ、媒体カード拡張）
- Modify: `index.html`（取材傾向タブの注記のみ必要に応じ）

- [ ] **Step 1: coverage.json の読込を追加（欠損時は空扱い）**

`app.js` の `main()` 冒頭を変更:

```js
import { validateCoverage, mediaForStore, storesForMedia } from "./coverage.mjs";

// main() 内:
const data = await loadJSON("data/stores.json");
const mediaData = await loadJSON("data/media.json");
let coverage = [];
try {
  const covData = await loadJSON("data/coverage.json");
  const { valid, warnings } = validateCoverage(covData.coverage, data.stores, mediaData.media);
  warnings.forEach((w) => console.warn(w));
  coverage = valid;
} catch (e) {
  console.warn(`coverage読み込みスキップ: ${e.message}`);
}
```

- [ ] **Step 2: 店舗カードに取材実績バッジを追加**

`renderDateMatchCard(store, matched, coverage)` と `renderStoreDetailCard(store, coverage)` に引数を追加し、バッジ行を挿入:

```js
function coverageBadges(coverage, storeId) {
  const items = mediaForStore(coverage, storeId);
  if (!items.length) return "";
  return items
    .map((c) => `<span class="badge badge--coverage">取材: ${c.mediaName}(${c.confidence})</span>`)
    .join(" ");
}
```

renderDateMatchCard 内の badges 行の直後に `(coverageBadges(coverage, store.id) ? `<div class="store-card__badges">${coverageBadges(coverage, store.id)}</div>` : "")` を追加。renderStoreDetailCard も同様。呼び出し側（renderDateMatches / renderAreaList）へ coverage を引き回す。

- [ ] **Step 3: 媒体カードを拡張（実績店リスト＋scheduleUrlリンク）**

`renderMediaCard(media, coverage, storesById)` に変更:

```js
const covered = storesForMedia(coverage, media.name)
  .map((c) => storesById.get(c.storeId)?.name)
  .filter(Boolean);
const coveredLine = covered.length ? `<div class="media-card__stores">実績店: ${covered.join(" / ")}</div>` : "";
const scheduleLink = media.scheduleUrl
  ? `<a href="${media.scheduleUrl}" target="_blank" rel="noopener">取材スケジュール(公式)</a>`
  : "";
```

を既存の innerHTML に組み込む（coveredLine は tendency の後、scheduleLink は links 行へ）。`storesById` は `main()` で `new Map(data.stores.map((s) => [s.id, s]))` を作って渡す。

- [ ] **Step 4: CSS バッジ用クラスを追加**

`index.html` の `<style>` 内（既存 badge 定義の近く）に `.badge--coverage` を追加（既存 `.badge--rule` に準じた配色・区別可能な色）。

- [ ] **Step 5: テストとローカル確認**

Run: `node --test test/` → 全pass。
Run: `python3 -m http.server 8099` → 全5タブを開き、(a)今日タブの取材バッジ (b)エリア別の下北沢＋取材バッジ (c)取材傾向タブの実績店/スケジュールリンク (d)console にエラーなし、を確認。

- [ ] **Step 6: Commit**

```bash
git add app.js index.html && git commit -m "feat: ビューワに取材実績バッジ・媒体クロス表示を追加"
```

### Task 7: 取材予定の確認手順書

**Files:**
- Create: `docs/取材予定の確認手順.md`

- [ ] **Step 1: 手順書を作成**

構成（media.json の scheduleUrl を正データとして反映）:

```markdown
# 取材予定の確認手順

「今週どの店に取材が入るか」を調べるときの巡回手順。予定情報は日々変わるためデータとしては持たない。

## 手順
1. 集約サイトで当たりを付ける（スロカク等 — URL列挙）
2. 媒体公式スケジュールで裏取り（media.json の scheduleUrl 一覧を媒体名付きで列挙）
3. 特定日と重なる店をビューワの日付指定タブで確認

## 読み方の注意
- 公約・傾向は伝聞。「〜とされる」以上の確度はない
- 掲載が無い＝取材が無い、ではない（欠測をデフォルト推定しない）
```

- [ ] **Step 2: Commit**

```bash
git add docs/取材予定の確認手順.md && git commit -m "docs: 取材予定の確認手順書を追加"
```

### Task 8: README/CHANGELOG 更新・最終検証・push

**Files:**
- Modify: `README.md`（構成に coverage.json/coverage.mjs/手順書を追記、対象エリアに下北沢、注意に取材実績の免責）
- Modify: `CHANGELOG.md`（日付セクション追加）

- [ ] **Step 1: README.md 更新**

「構成」へ `data/coverage.json`・`coverage.mjs`・`docs/取材予定の確認手順.md` の行を追加。「対象エリア」を「8エリア」表記に更新。「注意」に「取材実績(coverage.json)は過去実績に基づく推定・伝聞であり公式情報ではない」を追記。「更新方法」に coverage.json の四半期棚卸しを追記。

- [ ] **Step 2: CHANGELOG.md へセクション追加**

```markdown
## 2026-07-XX
- 下北沢エリアを追加（N店）
- 取材系強化: coverage.json 新設（店舗×媒体の実績紐付け）・media.json 拡充（scheduleUrl 追加・M媒体へ）
- ビューワ: 取材実績バッジ・媒体クロス表示・公式スケジュールリンク
- docs: 取材予定の確認手順書
```

- [ ] **Step 3: 最終検証**

Run: `node --test test/` → 全pass。
Run: `git diff --stat main@{u}..HEAD 2>/dev/null || git log --oneline -8` で想定外の変更がないか確認。public repo のため diff 本文に機微情報（行動圏・実名等）が無いことを確認。

- [ ] **Step 4: push と Pages 確認**

```bash
git push
```
数分後に https://ramdamain-commits.github.io/tokyo-pachi-guide/ で下北沢と取材表示を確認。

- [ ] **Step 5: root repo のサブモジュール参照と台帳**

root（C:/Users/ramda/projects）で `git add tokyo-pachi-guide && git commit`（該当する場合）。台帳/TASKS 更新時は「再export→機微語grep→portal push」の順（lifeops-portal.md）。台帳の記述は抽象表現とし、検討経緯は project_tokyo_pachi_guide.md へ。

- [ ] **Step 6: _staging の後始末**

検収済みの `_staging/shimokitazawa-stores.md`・`media-expansion.md`・`coverage-*.md` を削除（researcher 完了通知の確認後）。
