# v3拡張 Phase 3（ビューワー拡張）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `data/stores.json` に既にある `lottery`（抽選方式）・`sns`（SNSリンク）・`crowd`（混雑参考）・`rules[].type=annual`（周年、label付き）を、ビューワー（`index.html`/`app.js`）の店詳細カードへ配線し、実際にユーザーが見られる状態にする。

**Architecture:** `app.js` の `renderStoreDetailCard`（エリア別一覧タブ専用）にのみ表示を追加する。`lottery.mjs` の `resolveLottery`/`lotteryLabel` を呼ぶ薄いラッパー関数（`lotteryBadges`/`snsLinks`/`crowdLine`）を `app.js` に追加し、既存の `countLabel`/`lotteryLine`/`ruleBadges` と同じパターン（純粋関数がHTML文字列を返す）に揃える。周年ルール（`annual`+`label`）は `match.mjs` の `ruleLabel` が既にlabel付きラベル生成に対応済みで、`ruleBadges` は全ルール種別を汎用的に処理するため**コード変更不要**（動作確認のみ）。

**Tech Stack:** 素のJS（ES Modules）、ビルドツールなし。`app.js` は既存の未テストUI glueコード（`countLabel`/`lotteryLine`等）と同じ慣習に従い、新規のレンダリング関数にも単体テストは追加しない（`lottery.mjs`側の `resolveLottery`/`lotteryLabel` は既存テスト26件でカバー済み・変更なし）。かわりに手順内でローカルサーバ（`python3 -m http.server 8099`、`.claude/launch.json` の `tokyo-pachi-guide` 設定）を使いブラウザで目視確認する。

**前提（2026-08-01時点で完了済み・このプランでは変更しない）:**
- `app.js` の `AREA_ORDER` に新8エリアを追加する不具合修正は別コミット（`49e7e34`）で完了・push済み
- `lottery.mjs` の `resolveLottery`/`lotteryLabel`、`match.mjs` の `annual`+`label` 対応は実装済み・テスト済み
- 設計上の決定3点（バッジ表示範囲はエリア別一覧のみ／パチ/スロ差分は両方併記／低確度値はバッジ通常表示+memo補足）は `docs/superpowers/specs/2026-07-31-v3-expansion-design.md` の「Phase 3 着手時に決める未解決事項 → 2026-08-01 決定」に反映済み

---

### Task 1: 抽選バッジを店詳細カードへ追加

**Files:**
- Modify: `app.js:1`（import追加）, `app.js`（`lotteryBadges` 関数を追加し `renderStoreDetailCard` に配線。関数は67行目 `lotteryLine` の直前に追加する）
- Modify: `index.html`（`.badge--lottery` CSSを74行目 `.badge--coverage` の直後に追加）

- [ ] **Step 1: `resolveLottery`/`lotteryLabel` のimportを追加する**

`app.js:1` の既存importを以下に変更:

```js
import { matchRules, ruleLabel } from "./match.mjs";
import { resolveLottery, lotteryLabel } from "./lottery.mjs";
import { validateCoverage, mediaForStore, storesForMedia } from "./coverage.mjs";
```

- [ ] **Step 2: `lotteryBadges` 関数を追加する**

`app.js` の `lotteryLine` 関数（`function lotteryLine(lottery) {`）の直前に以下を追加:

```js
// パチ/スロで値が異なる場合のみ両方併記する（同じなら1個だけ表示）。
// type未確認(null)の場合はlotteryLabelがnullを返しバッジ非表示になる。
function lotteryBadges(lottery) {
  if (!lottery) return "";
  const pachi = lotteryLabel(resolveLottery(lottery, "pachinko"));
  const slot = lotteryLabel(resolveLottery(lottery, "slot"));
  if (!pachi && !slot) return "";
  if (pachi && slot && pachi !== slot) {
    return (
      `<span class="badge badge--lottery">パチンコ ${pachi}</span>` +
      `<span class="badge badge--lottery">スロット ${slot}</span>`
    );
  }
  return `<span class="badge badge--lottery">${pachi || slot}</span>`;
}
```

- [ ] **Step 3: `renderStoreDetailCard` にバッジを配線する**

`app.js` の `renderStoreDetailCard` 関数内、`const lottery = lotteryLine(store.lottery);` の直前に1行追加:

```js
  const lotteryBadgesHtml = lotteryBadges(store.lottery);
  const lottery = lotteryLine(store.lottery);
```

同関数の `wrap.innerHTML = ...` 内、`(covBadges ? ... : "") +` の直後・`(lottery ? ... : "") +` の直前に1行追加:

```js
    (covBadges ? `<div class="store-card__badges">${covBadges}</div>` : "") +
    (lotteryBadgesHtml ? `<div class="store-card__badges">${lotteryBadgesHtml}</div>` : "") +
    (lottery ? `<div class="store-card__desc">抽選: ${lottery}</div>` : "") +
```

- [ ] **Step 4: CSSに `.badge--lottery` を追加する**

`index.html:74` の `.badge--coverage { background: #1e3a5f; color: #bfdbfe; }` の直後に追加:

```css
    .badge--lottery { background: #134e4a; color: #5eead4; }
```

- [ ] **Step 5: node --test で既存テストが壊れていないことを確認する**

Run: `node --test test/*.mjs`
Expected: `tests 69` `pass 69` `fail 0`（app.js変更はこのテストスイートの対象外のため件数は変わらない）

- [ ] **Step 6: ブラウザで目視確認する**

`.claude/launch.json` の `tokyo-pachi-guide` 設定でローカルサーバを起動し、「エリア別一覧」タブを開く。以下を確認する:
- `pia-ueno`（type=onsite/random=true、pachinko/slot分割なし）→ バッジ1個「店頭抽選」
- `espace-kabukicho`（pachinko=onsite/true, slot=app/true/tool=777コンパス）→ バッジ2個「パチンコ 店頭抽選」「スロット アプリ抽選(777コンパス)」
- `minami-10go-shimokitazawa`（type=null）→ 抽選バッジが出ない（「抽選: 」の行自体は既存の `lotteryLine` がmethod=nullのため元々出ない）

- [ ] **Step 7: コミットする**

```bash
git add app.js index.html
git commit -m "feat: 抽選バッジをエリア別一覧カードへ表示(パチ/スロ差分は両方併記)"
```

---

### Task 2: SNSリンクを店詳細カードへ追加

**Files:**
- Modify: `app.js`（`snsLinks` 関数を追加し `renderStoreDetailCard` の links 生成に組み込む）
- Modify: `index.html`（`#tab-area` に伝聞注記の `.disclaimer` を追加）

- [ ] **Step 1: `snsLinks` 関数を追加する**

`app.js` の `sourcesHtml` 関数（`function sourcesHtml(sources) {`）の直後に追加:

```js
const SNS_LABELS = { x: "X", line: "LINE", instagram: "Instagram" };

function snsLinks(sns) {
  if (!sns) return "";
  return Object.entries(sns)
    .filter(([, url]) => url)
    .map(([key, url]) => `<a href="${url}" target="_blank" rel="noopener">${SNS_LABELS[key] || key}</a>`)
    .join(" ・ ");
}
```

- [ ] **Step 2: `renderStoreDetailCard` の links 生成にSNSを組み込む**

`renderStoreDetailCard` 内の `const src = sourcesHtml(store.sources);` を以下に変更:

```js
  const sns = snsLinks(store.sns);
  const src = sourcesHtml(store.sources);
  const links = [sns, src].filter(Boolean).join(" ・ ");
```

`wrap.innerHTML` 内の `(src ? \`<div class="store-card__links">${src}</div>\` : "")` を以下に変更:

```js
    (links ? `<div class="store-card__links">${links}</div>` : "")
```

- [ ] **Step 3: `#tab-area` に伝聞注記を追加する**

`index.html` の `<section id="tab-area" class="tab-panel" hidden></section>` を以下に変更:

```html
  <section id="tab-area" class="tab-panel" hidden>
    <p class="disclaimer">
      SNS・混雑情報は媒体・利用者由来の参考情報であり、店舗の公式発表ではありません。
    </p>
  </section>
```

- [ ] **Step 4: `renderAreaList` が注記を再描画で消さないようにする**

`app.js` の `renderAreaList` 関数の先頭を以下に変更（`renderMediaList` の既存パターンを踏襲）:

```js
function renderAreaList(container, stores, coverage) {
  const disclaimer = container.querySelector(".disclaimer");
  container.innerHTML = "";
  if (disclaimer) container.appendChild(disclaimer);
  const grouped = sortByArea(stores);
```

- [ ] **Step 5: node --test で既存テストが壊れていないことを確認する**

Run: `node --test test/*.mjs`
Expected: `tests 69` `pass 69` `fail 0`

- [ ] **Step 6: ブラウザで目視確認する**

「エリア別一覧」タブ先頭に伝聞注記が表示され、タブ切り替え後も消えないこと。`niraku-nakano-sunmall` 等 `sns.x` を持つ店のカードに `X` リンクが表示され、クリック先が正しいURLであることを確認する。

- [ ] **Step 7: コミットする**

```bash
git add app.js index.html
git commit -m "feat: SNSリンクをエリア別一覧カードへ表示+伝聞注記を追加"
```

---

### Task 3: 混雑参考(crowd)を店詳細カードへ追加

**Files:**
- Modify: `app.js`（`crowdLine` 関数を追加し `renderStoreDetailCard` に配線）

**注:** 2026-08-01時点で `crowd` を持つ店は0件（`data/stores.json` 全83店）。表示コードは今回作るが、実際にカードへ出る店はまだ無い。空データで壊れないことの確認が本タスクの検証の中心になる。

- [ ] **Step 1: `crowdLine` 関数を追加する**

`app.js` の `lotteryLine` 関数の直後に追加:

```js
function crowdLine(crowd) {
  if (!crowd) return "";
  const src = crowd.sourceUrl
    ? ` <a href="${crowd.sourceUrl}" target="_blank" rel="noopener">出典</a>(確認: ${crowd.checkedAt})`
    : "";
  return `混雑参考: ${crowd.note}${src}`;
}
```

- [ ] **Step 2: `renderStoreDetailCard` に配線する**

`renderStoreDetailCard` 内、`const hours = ...` の直後に1行追加:

```js
  const hours = `営業: ${store.open || "不明"}〜${store.close || "不明"} / 換金率: ${store.exchange || "不明"}`;
  const crowd = crowdLine(store.crowd);
```

`wrap.innerHTML` 内、`\`<div class="store-card__desc">${hours}</div>\` +` の直後に1行追加:

```js
    `<div class="store-card__desc">${hours}</div>` +
    (crowd ? `<div class="store-card__desc">${crowd}</div>` : "") +
```

- [ ] **Step 3: node --test で既存テストが壊れていないことを確認する**

Run: `node --test test/*.mjs`
Expected: `tests 69` `pass 69` `fail 0`

- [ ] **Step 4: ブラウザで目視確認する**

「エリア別一覧」タブで全83店を表示し、コンソールエラーが出ないこと（`store.crowd` が全店 `undefined` でも `crowdLine` が空文字を返し何も描画されないこと）を確認する。`read_console_messages` でエラー0件を確認する。

- [ ] **Step 5: コミットする**

```bash
git add app.js
git commit -m "feat: 混雑参考(crowd)表示をエリア別一覧カードへ追加(現状データ0件・空時は非表示)"
```

---

### Task 4: `docs/示唆・イベントの確認手順.md` を新設する

**Files:**
- Create: `docs/示唆・イベントの確認手順.md`

- [ ] **Step 1: ドキュメントを作成する**

`docs/取材予定の確認手順.md` と同形式で以下の内容で作成する:

```markdown
# 示唆・イベントの確認手順

店のSNS（X/LINE/Instagram）による当日の入場・混雑示唆と、周年イベント・混雑傾向を確認するときの手順。示唆内容そのものは鮮度が高く数時間で古くなるため、このリポジトリではデータとして持たず、確認手順とリンク集だけを整備する（正データは `data/stores.json` の `sns` / `crowd` / `rules[].type=annual`）。

## 手順

1. **周年・店固有日を確認する** — ビューワの「エリア別一覧」タブで店の特定日バッジに `annual` の周年ラベル（例:「年周年(3/15)(グランドオープン記念)」）が出ていれば該当日。日付はデータ化済みのため巡回不要（`match.mjs` の `annual` 判定＋ `ruleLabel` のlabel併記で自動表示）。
2. **店のSNSで当日の示唆を確認する** — 店カードのSNSリンク（X/LINE/Instagram、`data/stores.json` の `sns`）から直近投稿を確認する。「本日は◯◯予定」等の当日投稿が中心で、前日夜〜当日朝に更新されることが多い。
3. **混雑傾向を確認する** — `data/stores.json` の `crowd.note`（例: 「アクセス集中日: 7のつく日」）を持つ店はカードに表示される。無ければ以下の集約サイトで確認する。
   - [DMMぱちタウン](https://p-town.dmm.com/) — 店舗ページのアクセス数から混雑傾向を推測

## データ追加の手順

- SNSリンクの収集元: みんパチ店舗ページのリンク欄 → なければ店公式サイトのフッター/ヘッダー。Web検索での推測取得はしない（別店舗の同名アカウント誤爆防止、既存ルール踏襲）
- 周年イベントの収集元: みんパチ店舗ページの「グランドオープン日」等の記載
- 混雑参考の収集元: DMMぱちタウンのアクセス集中日等、参考情報の位置づけで断定表現を避ける

## 読み方の注意

- SNS示唆は店舗アカウントの投稿であっても「示唆」であり公式公約ではない（風営法上、設定示唆の公式イベントは存在しない）
- 周年・混雑情報は第三者サイト・過去傾向推定を含み、確度は出典の `checkedAt` で判断する
- 掲載が無い＝示唆が無い、ではない（欠測をデフォルト推定しない）
```

- [ ] **Step 2: コミットする**

```bash
git add "docs/示唆・イベントの確認手順.md"
git commit -m "docs: 示唆・イベントの確認手順を新設(SNS/周年/混雑の見方とリンク集)"
```

---

### Task 5: README/CHANGELOGを更新する

**Files:**
- Modify: `README.md:9,17,19,36`
- Modify: `CHANGELOG.md`（既存の `## 2026-08-01` セクションへ追記）

- [ ] **Step 1: README.mdの店舗マスタ説明を更新する**

`README.md:9` を以下に置き換える:

```markdown
- `data/stores.json` — 店舗マスタ（エリア・台数・特定日ルール・抽選方式・SNS・混雑参考・閉店時刻・換金率・概要・出典・確認日）。2026-08-01 時点で全83店・16エリア（上野4/秋葉原5/新宿6/渋谷4/下北沢3/池袋8/新橋3/京橋銀座2/中野5/吉祥寺2/立川5/町田4/蒲田10/錦糸町10/北千住3/赤羽9）
```

- [ ] **Step 2: README.mdのビューワ説明を更新する**

`README.md:17` を以下に置き換える:

```markdown
- `index.html` / `app.js` — ビューワ（今日/明日/日付指定/エリア別一覧/取材傾向の5タブ）。エリア別一覧の店舗カードに取材実績バッジ・抽選方式バッジ（パチ/スロで異なる場合は両方併記）・SNSリンク・混雑参考を表示、媒体カードに実績店一覧と公式スケジュールリンクを表示
```

- [ ] **Step 3: README.mdに新規docsへの参照を追加する**

`README.md:19` の `- \`docs/取材予定の確認手順.md\` — ...` 行の直後に追加:

```markdown
- `docs/示唆・イベントの確認手順.md` — SNS示唆・周年・混雑傾向を確認する手順とリンク集
```

- [ ] **Step 4: README.mdの対象エリアを更新する**

`README.md:36` を以下に置き換える:

```markdown
上野・秋葉原・新宿・渋谷・下北沢・池袋・新橋・京橋/銀座・中野・吉祥寺・立川・町田・蒲田・錦糸町・北千住・赤羽（16エリア、全83店）
```

- [ ] **Step 5: CHANGELOG.mdの `## 2026-08-01` セクションに追記する**

`CHANGELOG.md` の `## 2026-08-01` セクション末尾（`### 収集メモ` の直後、`## 2026-07-31` の直前）に追加:

```markdown
### 追加（Phase 3・ビューワー配線）
- `docs/示唆・イベントの確認手順.md` — SNS示唆・周年・混雑傾向の確認手順とリンク集

### 変更（Phase 3・ビューワー配線）
- `app.js` — `AREA_ORDER` に新8エリア（中野・吉祥寺・立川・町田・蒲田・錦糸町・北千住・赤羽）を追加。Phase1で `data/stores.json` に追加した48店（全83店の58%）が全タブから欠落していた不具合を修正
- `app.js` / `index.html` — エリア別一覧カードに抽選バッジ（パチ/スロ差分は両方併記）・SNSリンク・混雑参考（crowd、現状データ0件）を追加。周年ルール（`annual`+`label`）は既存の `ruleBadges`/`ruleLabel` がそのまま処理するためコード変更なしで表示された
- `README.md` — 店舗数・エリア数を83店/16エリアへ更新（Phase1時点で更新漏れ）
```

- [ ] **Step 6: 変更内容を確認する**

Run: `git diff README.md CHANGELOG.md`
Expected: 上記の変更のみが差分として出ること

- [ ] **Step 7: コミットする**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: Phase3(ビューワー配線)のREADME/CHANGELOG更新"
```

---

### Task 6: 最終確認とpush

**Files:** なし（確認のみ）

- [ ] **Step 1: 全テストを実行する**

Run: `node --test test/*.mjs`
Expected: `tests 69` `pass 69` `fail 0`

- [ ] **Step 2: データ検証スクリプトを実行する**

Run: `node scripts/validate-data.mjs`
Expected: `errors 0`（warningsは既存の6件程度のまま。tool未特定は想定内）

- [ ] **Step 3: ブラウザで全タブを目視確認する**

ローカルサーバで「今日」「明日」「日付指定」「エリア別一覧」「取材傾向」の5タブを開き、コンソールエラーが無いこと（`read_console_messages`）、エリア別一覧で新旧16エリア全てが表示されること、抽選バッジ・SNSリンクが意図通り出ることを確認する。

- [ ] **Step 4: 機微語grepを実行する（公開repoのため必須）**

Run: `git diff 6ec6d2b..HEAD | grep -iE "居住|年収|偏差値|本名|電話番号|パスワード"`
Expected: 出力なし（exit 1）

- [ ] **Step 5: pushする**

```bash
git push origin main
```

ユーザーに最終確認してから実行する（push は明示的な許可が必要な操作）。
