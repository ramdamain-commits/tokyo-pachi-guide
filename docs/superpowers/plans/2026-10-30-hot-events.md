# 熱いイベント一覧と自動更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 東京都全体の来店・取材予定を DMMぱちタウンから自動収集し、みんレポの日別実績（平均G・平均差枚）と自前で貯めた過去イベントから熱さを点数化して、ビューワの新タブ「熱いイベント」に熱い順で出す。GitHub Actions で毎月1日と毎週自動更新する。

**Architecture:** 収集は Node.js の素のスクリプト（依存パッケージなし・組み込み `fetch`）。取得（`collect/http.mjs`）、サイト別のパーサ（`collect/dmm.mjs` 等）、突き合わせ、統計、点数化を純粋関数に分け、`scripts/collect-events.mjs` がつなぐ。過去日になったイベントは凍結し、その日のみんレポ実績（店の通常日との差）を「結果」として書き込んで履歴にする。取材の強さはこの履歴から計算する。成果物は `data/` 配下の JSON で、ビューワ（既存の静的 HTML + ES module）がそれを読む。

**Tech Stack:** Node.js 24（ローカル v24.14.0）、`node:test`、素の HTML/JS、GitHub Actions、GitHub Pages

**Spec:** `docs/superpowers/specs/2026-10-30-hot-events-design.md`（2026-10-30 ホールナビ除外の改訂を含む）

## Global Constraints

- 依存パッケージを入れない（`package.json` を作らない）。HTML の解析は正規表現と文字列処理で行う
- 取得は1リクエストごとに 2,000ms 以上あける。同じ URL は1回の実行で1度しか取らない。User-Agent は `collect/http.mjs` の `UA`（収集用の自己申告）だけを使い、**ブラウザを装う User-Agent に変えない**（遮断の回避になる）。403 を返すサイトは使わない
- 取得元は DMMぱちタウンとみんレポだけ。ホールナビは使わない（自己申告 UA に 403。ユーザー決定で除外）
- 公開するのは事実情報（日付・店名・住所・媒体名・企画名・数値）と元ページへのリンクだけ。取得元の説明文・画像は保存も表示もしない。みんレポの日別データも丸ごとは保存せず、計算結果（中央値・差・回数）だけを保存する。**テスト用フィクスチャも同じ扱い**で、実ページから構造に必要な部分を2〜3件分だけ切り出し、1ファイル 5KB 以下にする（空白・不要属性を落としても収まらないときだけ 8KB まで）
- 欠測を0や平均で埋めない。欠けた要素は `missing` に名前を入れ、画面に「データなし」と出す
- 平均G・平均差枚は「その店の通常日との差」にしてから使う。店どうしで生の値を比べてよいのは「店の普段のにぎわい」（通常日の平均G の順位）だけ
- 日付はすべて日本時間で扱う。Actions では環境変数 `TZ=Asia/Tokyo` を設定する。日付の生成は既存 `match.mjs` と同じく `new Date(y, m-1, d)` 形式で行い、`new Date("YYYY-MM-DD")` は使わない
- 周年は加点しない（バッジ表示のみ）。「○のつく日」型の企画も加点しない
- 取得したデータには出典 URL と取得日（`checkedAt`、`YYYY-MM-DD`）を付ける。自前の計算結果（取材の強さ）は計算日（`computedAt`）を付ける
- 失敗時は公開データを上書きせず、終了コード1で終える
- コード・コメント・コミットメッセージ・ドキュメントは日本語（識別子は英語）。既存コードの書き方（JSDoc コメント・`node:test`・`assert/strict`）に合わせる
- テストの実行: `node --test test/*.test.mjs`

## 用語

- **通常日**: その店のイベント日（履歴・予定にある日）でも旧イベント日（特定日ルールに当たる日）でもない日
- **基準**: その店の通常日の平均G の中央値（`medianG`）と平均差枚の中央値（`medianSamai`）
- **結果（outcome）**: 過去日のイベントについて、その日の平均G − `medianG`（`g`）と平均差枚 − `medianSamai`（`samai`）
- **履歴**: 凍結済み（`frozen: true`）で `outcome` を持つイベント

## Review Focus

1. **年をまたぐ日付**: みんレポは年なしの日付で、12月から1月にかけて年の補い方を誤りやすい。上から新しい順に並ぶ表で正しい年を付けること
2. **DMM の重複掲載**: 同じ店・同じ日・同じ企画が2回並ぶ実例がある（2026-10-30 のクリエ府中西原店）。1件にまとめること
3. **一部ページの取得失敗**: みんレポの店ページ1件の 5xx やタイムアウトで実行全体を止めない。その店は欠測扱いで残す。ただし DMM の予定一覧が取れないときは全体を失敗にする
4. **Actions のタイムゾーン**: UTC で動くと「今日」が1日ずれ、凍結や7日間表示がずれる。基準日は `jstToday()` で求め、引数でも渡せるようにすること
5. **履歴ゼロからの立ち上がり**: 初回は履歴が無く、全イベントが「強さ不明」になる。このとき画面が空にならず、強さ不明の枠に並ぶこと。結果は過去日になった後の実行で一度だけ書き込まれ、二度目以降は変わらないこと

各項目のテストは、担当タスクの中に入れてある。

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `collect/http.mjs` | 間隔をあけた取得・実行内キャッシュ・再試行（Task 1 で作成済み） |
| `collect/dates.mjs` | 年なし日付への年の補完、JST の基準日 |
| `collect/dmm.mjs` | DMM 予定一覧ページの解析と重複除去 |
| `collect/minrepo.mjs` | みんレポのカテゴリ一覧・店舗ページの解析 |
| `collect/rule-text.mjs` | 「16日、月と日がゾロ目の日」等の文言を `match.mjs` のルールへ変換 |
| `collect/venues.mjs` | 店名・住所の正規化と、DMM・みんレポ・`stores.json` の突き合わせ |
| `collect/stats.mjs` | 基準・特定日の実効性・結果・取材の強さ・にぎわいの順位 |
| `collect/score.mjs` | 熱さの点数・根拠・欠測、周年の判定 |
| `collect/merge.mjs` | 月ファイルの更新（過去日の凍結と結果の書き込み） |
| `validate-events.mjs` | 新データファイルの検証（ルート。既存 `validate.mjs` と並べる） |
| `hot.mjs` | ビューワ側の絞り込み・並べ替え（ルート。既存 `coverage.mjs` と並べる） |
| `scripts/probe-sources.mjs` | 各サイトに届くかの確認（Task 1 で作成済み） |
| `scripts/collect-events.mjs` | 収集の本体（つなぎ役） |
| `scripts/validate-data.mjs` | 既存。新データの検証を追加 |
| `.github/workflows/probe.yml` / `collect.yml` | Actions |
| `data/venues.json` / `data/media-strength.json` / `data/store-stats.json` / `data/events/YYYY-MM.json` / `data/collect-meta.json` | 成果物 |
| `test/fixtures/*.html` | 切り出したフィクスチャ |

## データ形式（全タスク共通）

```jsonc
// data/venues.json — 店の対応表。キーは "dmm:<DMM店舗ID>"
{ "updated": "2026-11-01", "venues": { "dmm:102": {
  "name": "エスパス日拓上野新館", "address": "東京都台東区上野4-7-5", "municipality": "台東区",
  "area": "上野",            // stores.json の店なら既存エリア、それ以外は municipality
  "storeId": "espace-ueno-shinkan" | null, "dmmShopId": "102",
  "minrepoTag": "エスパス日拓上野新館" | null, "x": "https://..." | null } } }

// data/store-stats.json — 店の実績（みんレポの日別データそのものは保存しない）
{ "updated": "2026-11-01", "stats": { "dmm:102": {
  "baseline": { "medianG": 2480, "medianSamai": 12 | null, "daysG": 61, "daysSamai": 24,
                "sourceUrl": "https://min-repo.com/tag/…/", "checkedAt": "2026-11-01" } | null,
  "busyPct": 0.81 | null,                       // 東京の店の中での medianG の順位（0〜1）
  "ruleEffects": [ { "label": "5のつく日", "diff": 18, "days": 9 } ],
  "lift": { "g": { "mean": 310, "n": 3 } | null, "samai": { "mean": 22, "n": 2 } | null } } } }

// data/media-strength.json — 取材の強さ（履歴からの自前計算）
{ "computedAt": "2026-11-01", "entries": [ {
  "key": "t:裏桜梅桃李",          // "t:<企画名>" または "m:<媒体名>"
  "g": { "mean": 640, "n": 8 } | null, "samai": { "mean": 41, "n": 5 } | null } ] }

// data/events/2026-11.json
{ "month": "2026-11", "generatedAt": "2026-11-01T09:04:00+09:00", "events": [ {
  "id": "2026-11-07|dmm:102|パチ＆スロ必勝本|裏桜梅桃李", "date": "2026-11-07", "venue": "dmm:102",
  "media": "パチ＆スロ必勝本" | null, "title": "裏桜梅桃李", "anniversary": false,
  "group": "rated" | "unrated", "score": 6.4,
  "points": { "mediaG": 4.3, "mediaSamai": null, "venueG": null, "venueSamai": null, "busy": 4.1, "overlap": 1 },
  "evidence": ["同じ企画の過去の開催: 通常日より平均G +640（8回）", "この店の普段の平均G 2,480（東京の上位19%）", "同日にほか1件"],
  "missing": ["mediaSamai", "venueG", "venueSamai"],
  "frozen": false, "outcome": null | { "g": 520, "samai": 33 | null },
  "sources": [ { "url": "https://p-town.dmm.com/shops/tokyo/102", "checkedAt": "2026-11-01" } ] } ] }

// data/collect-meta.json
{ "lastSuccessAt": "2026-11-01T09:04:00+09:00", "months": ["2026-10", "2026-11", "2026-12"],
  "rates": { "minrepoMatched": 0.41 }, "counts": { "events": 612, "history": 0 } }
```

---

### Task 1: 取得部品と、Actions から各サイトに届くかの確認

**状態: 実装済み（6b40ce1）。** レビュー前に、プローブ対象からホールナビの2件を外す（ホールナビ除外の改訂）。プローブ対象は次の3件になる。

- `https://p-town.dmm.com/schedules/tokyo`（確認用の文字列: `実施日：`）
- `https://min-repo.com/category/%e6%9d%b1%e4%ba%ac%e9%83%bd/`（`min-repo.com/tag/`）
- `https://min-repo.com/tag/%e3%82%ab%e3%83%ac%e3%82%a4%e3%83%89%e6%96%b0%e5%ae%bf%e5%ba%97/`（`旧イベント日`）

**Files:**
- Create: `collect/http.mjs`, `scripts/probe-sources.mjs`, `.github/workflows/probe.yml`
- Test: `test/http.test.mjs`

**Interfaces:**
- Produces: `createFetcher({ delayMs = 2000, userAgent = UA, maxRetries = 2, fetchImpl = fetch, sleep }) -> { get(url): Promise<{ status: number, text: string }> }`。200 は `{status:200, text}`、404/410 は再試行せず `{status, text:""}`、それ以外は再試行のうえ `FetchError`（`url`・`status`）。同じ URL の2回目以降はキャッシュ。`UA` を export

- [ ] **Step 1: `scripts/probe-sources.mjs` のプローブ対象を上の3件にする**
- [ ] **Step 2: ローカルで動かす** — Run: `node scripts/probe-sources.mjs` / Expected: 3行とも 200・確認用の文字列あり、終了コード0
- [ ] **Step 3: コミット** — `git commit -m "fix: 到達確認の対象からホールナビを外す"`
- [ ] **Step 4（コントローラー）: 作業ブランチを push し、Actions の probe が成功することを確かめる**。失敗したら、どのサイトが何番で返ったかをユーザーに報告して止まる

---

### Task 2: 日付の補完と DMM 予定一覧の解析

**Files:**
- Create: `collect/dates.mjs`, `collect/dmm.mjs`, `test/fixtures/dmm-schedule.html`
- Test: `test/dates.test.mjs`, `test/dmm.test.mjs`

**Interfaces:**
- Produces:
  - `jstToday(now = new Date()) -> string`（`YYYY-MM-DD`。`TZ` に頼らず `Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" })` で求める）
  - `inferYear(month, day, refDate: string, direction: "future" | "past") -> string`（`YYYY-MM-DD`）。`future` は基準日の60日前以降で最も近い日、`past` は基準日以前で最も近い日
  - `addDaysStr(dateStr, n) -> string`
  - `monthOf(dateStr) -> string`（`YYYY-MM`）
  - `parseDmmSchedulePage(html) -> { events: DmmEvent[], lastPage: number | null }`
  - `DmmEvent = { dmmShopId: string, shopName: string, address: string, date: string, media: string | null, title: string }`
  - `dedupeDmmEvents(events) -> DmmEvent[]`（キーは `dmmShopId|date|media|title`。最初の1件を残す）
- DMM の1件は `<li class="unit …">` で、店舗リンクが `href=/shops/tokyo/<ID>`（引用符なし）、店名が `p.title`、住所が `p.lead`、日付が `p.date` の `実施日：YYYY/MM/DD`、`.bottom .right` の `span.text-icon` が媒体名・企画名の順に並ぶ。`span.text-icon` が1つなら媒体なし（`media: null`）とし、それを企画名にする。前後の空白は落とす。最終ページ番号は `schedules/tokyo?page=N` のリンクの最大値

- [ ] **Step 1: フィクスチャを作る** — `https://p-town.dmm.com/schedules/tokyo?page=1` を `createFetcher` で取り、`<li class="unit` を3件（うち2件は同じ店・同じ日・同じ企画の重複。無ければ1件を複製して作る）と、`?page=29` 等のページ送りのリンクだけを残して `test/fixtures/dmm-schedule.html` に保存する。画像の `alt` は空にする
- [ ] **Step 2: 失敗するテストを書く**
  - `test("inferYear: 基準 2026-12-28 で 1/3 は future なら 2027-01-03")`
  - `test("inferYear: 基準 2027-01-02 で 12/30 は past なら 2026-12-30")`
  - `test("inferYear: 基準 2026-11-01 で 10/31 は past なら 2026-10-31")`
  - `test("jstToday: UTC 2026-10-31T15:30Z は 2026-11-01")` — Review Focus 4
  - `test("parseDmmSchedulePage: 店舗ID・店名・住所・日付・媒体・企画名を取り出す")` — フィクスチャの1件目を、実際の値を書き写した期待値と `deepEqual` で比べる
  - `test("parseDmmSchedulePage: lastPage はページ送りの最大値")`
  - `test("dedupeDmmEvents: 同じ店・日・媒体・企画の重複を1件にする")` — Review Focus 2
  - `test("dedupeDmmEvents: 企画名だけ違うものは残す")`
- [ ] **Step 3: 落ちることを確かめる** — Run: `node --test test/dates.test.mjs test/dmm.test.mjs` / Expected: FAIL
- [ ] **Step 4: `collect/dates.mjs` と `collect/dmm.mjs` を実装する**
- [ ] **Step 5: 通ることを確かめる** — Expected: PASS
- [ ] **Step 6: コミット** — `git commit -m "feat: DMM予定一覧の解析と日付補完を追加"`

---

### Task 3: （削除）

ホールナビの解析だったが、ホールナビ除外の改訂で不要になった。番号は台帳との対応のため欠番のまま残す。

---

### Task 4: みんレポの解析と特定日の文言の変換

**Files:**
- Create: `collect/minrepo.mjs`, `collect/rule-text.mjs`, `test/fixtures/minrepo-store.html`, `test/fixtures/minrepo-category.html`
- Test: `test/minrepo.test.mjs`, `test/rule-text.test.mjs`

**Interfaces:**
- Consumes: `inferYear`（Task 2）、`matchRule`（既存 `match.mjs`）
- Produces:
  - `parseMinrepoCategory(html) -> { tags: string[], lastPage: number | null }` — `min-repo.com/tag/<名前>/` の名前（URL デコード済み・重複なし）
  - `minrepoCategoryUrl(page) -> string`（1ページ目は `https://min-repo.com/category/%e6%9d%b1%e4%ba%ac%e9%83%bd/`、2ページ目以降は末尾に `page/N/`）
  - `minrepoTagUrl(tag) -> string`（`https://min-repo.com/tag/<encodeURIComponent(tag) を小文字の%表記にしたもの>/`）
  - `parseMinrepoStorePage(html, refDate) -> { ruleText: string | null, days: { date, totalSamai, avgSamai, avgG }[] }` — 「データ一覧」の表の行（1列目が日付リンク・2列目が総差枚・3列目が平均差枚・4列目が平均G）。`-` は `null`、カンマ区切りの数字と符号を数値にする。日付は表の上から新しい順に並ぶので、1行目を `inferYear(..., "past")` で補い、以降は前の行より新しくなったら1年戻す。`ruleText` は「旧イベント日」の行の文言（読点の区切りは残し、`※追加・修正…` の注記は除く）
  - `parseRuleText(text) -> { rules: Rule[], unparsed: string[] }` — 読点で区切った各句を `match.mjs` の形へ変換。対応表:
    - `Nのつく日` → `{type:"digit", value:N}`
    - `N日` → `{type:"monthday", value:N}`、`末日` → `{type:"monthday", value:"last"}`
    - `月と日がゾロ目の日` → `{type:"month-day-match"}`
    - `ゾロ目の日` → `{type:"zorome"}`
    - `毎週X曜日` → `{type:"weekday", value:<getDay()の数値>}`
    - `第NX曜日` → `{type:"nth-weekday", nth:N, weekday:<数値>}`
    - それ以外は `unparsed` へ入れる（推測で変換しない）

- [ ] **Step 1: フィクスチャを作る** — `minrepoTagUrl("カレイド新宿店")` から「旧イベント日」の行と「データ一覧」の表の5行（差枚が `-` の行を含む）。表の機種欄は空にする。カテゴリページは tag リンク3件とページ送り
- [ ] **Step 2: 失敗するテストを書く**
  - `test("parseMinrepoStorePage: ruleText は '16日、月と日がゾロ目の日、第4土曜日'")`
  - `test("parseMinrepoStorePage: '-' の差枚は null、平均G は数値、'+22,430' は 22430")`
  - `test("parseMinrepoStorePage: 基準 2027-01-02 で 1/1, 12/31 の並びは 2027-01-01, 2026-12-31")` — 表の日付を書き換えた小さな HTML 文字列で確かめる。Review Focus 1
  - `test("minrepoTagUrl: カレイド新宿店 は小文字%表記の URL")` — `https://min-repo.com/tag/%e3%82%ab%e3%83%ac%e3%82%a4%e3%83%89%e6%96%b0%e5%ae%bf%e5%ba%97/`
  - `test("parseRuleText: '16日、月と日がゾロ目の日、第4土曜日' を3ルールに変換し unparsed は空")` — 第4土曜日は `{type:"nth-weekday", nth:4, weekday:6}`
  - `test("parseRuleText: '5のつく日、末日' を digit 5 と monthday last に")`
  - `test("parseRuleText: 'リニューアル記念' は unparsed に入りルールを作らない")`
  - `test("parseRuleText の結果は matchRule で 2026-10-24 にだけ第4土曜日がマッチする")` — 2026-10-17 と 2026-10-31 はマッチしない
- [ ] **Step 3: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 4: 実装する**
- [ ] **Step 5: 通ることを確かめる** — Expected: PASS
- [ ] **Step 6: コミット** — `git commit -m "feat: みんレポの解析と旧イベント日の文言変換を追加"`

---

### Task 5: 店の突き合わせ

**Files:**
- Create: `collect/venues.mjs`
- Test: `test/venues.test.mjs`

**Interfaces:**
- Consumes: `DmmEvent`（Task 2）、`parseMinrepoCategory` の `tags`（Task 4）、`data/stores.json` の `stores`
- Produces:
  - `normalizeName(s) -> string` — NFKC、空白・中黒・記号（`・ .-()（）`）の除去、小文字化
  - `normalizeAddress(s) -> string` — NFKC、`東京都` の除去、「丁目」「番地」「番」「号」を `-` に、漢数字の丁目（`六丁目`）を算用数字に、建物名（最初の空白以降）と末尾の `-` を落とす
  - `municipality(address) -> string | null` — `東京都` の直後の `…区|…市|…町|…村`
  - `buildVenues({ dmmEvents, minrepoTags, stores, previous }) -> { venues: Record<string, Venue>, unmatchedMinrepo: string[] }`
    - DMM の店ごとに `dmm:<ID>` を作る。みんレポとは正規化店名の**完全一致**だけで対応付ける（あいまい一致はしない）。`stores.json` とは正規化住所の一致で対応付ける
    - `previous`（前回の `venues.json` の `venues`）にあった `minrepoTag` は、今回のタグ一覧で見つからなくても残す
    - みんレポと対応が付かなかった店の名前を `unmatchedMinrepo` に入れる（捨てない）
    - `area` は `stores.json` の店ならその `area`、それ以外は `municipality`。`x` は `stores.json` の店なら `sns.x`、それ以外は `null`

- [ ] **Step 1: 失敗するテストを書く**
  - `test("normalizeAddress: '東京都町田市原町田6丁目13番21号' と '東京都町田市原町田6-13-21' が一致")`
  - `test("normalizeAddress: '東京都台東区上野4-7-5　日拓上野アメ横ビル' の建物名を落とす")`
  - `test("normalizeName: 'エクス・アリーナ東京' と 'エクス・アリーナ 東京' が一致")`
  - `test("buildVenues: 正規化店名が一致するみんレポのタグを付ける")`
  - `test("buildVenues: 'ガイア瑞江店' に 'ガイア瑞江ⅱ' を付けない（完全一致のみ）")`
  - `test("buildVenues: 対応の無い店は venues に残り unmatchedMinrepo に入る")`
  - `test("buildVenues: stores.json と住所一致した店は storeId・既存エリア・sns.x を持つ")`
  - `test("buildVenues: previous の minrepoTag は今回見つからなくても残す")`
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: `collect/venues.mjs` を実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: DMM・みんレポ・既存店の突き合わせを追加"`

---

### Task 6: 店の統計と熱さの点数

**Files:**
- Create: `collect/stats.mjs`, `collect/score.mjs`
- Test: `test/stats.test.mjs`, `test/score.test.mjs`

**Interfaces:**
- Consumes: `matchRule`, `ruleLabel`（既存 `match.mjs`）、みんレポの `days`（Task 4）
- Produces（`collect/stats.mjs`）:
  - `baseline(days, excludeDates: Set<string>, rules) -> { medianG, medianSamai, daysG, daysSamai } | null` — 通常日（`excludeDates` に無く、どの `rules` にも当たらない日）について、`avgG` が数値の日の中央値と、`avgSamai` が数値の日の中央値。`daysG < 10` なら全体を `null`。`daysSamai < 10` なら `medianSamai` だけ `null`
  - `ruleEffects(days, rules, base, labelOf = ruleLabel) -> { label, diff, days }[]` — ルールごとに「当たる日の `avgSamai` 平均 − `base.medianSamai`」（四捨五入で整数）。当たる日が3日未満のルールは出さない。`base` か `base.medianSamai` が `null` なら `[]`
  - `outcomeOf(days, date, base) -> { g, samai } | null` — その日の行が無いか `avgG` が `null` なら `null`。`g = avgG − medianG`、`samai` は `avgSamai` と `medianSamai` の両方が数値のときだけ差、それ以外は `null`
  - `summarize(values: number[], minN) -> { mean, n } | null` — `n < minN` なら `null`。`mean` は四捨五入で整数
  - `strengthTable(historyEvents) -> Record<string, { g, samai }>` — `outcome` を持つ凍結イベントを、`"t:<title>"` と（`media` があれば）`"m:<media>"` の両方のキーに集める。`g` と `samai` はそれぞれ `summarize(…, 3)`
  - `pickStrength(table, title, media) -> { basis: "title" | "media", g, samai } | null` — `t:` の `g` か `samai` のどちらかが `null` でなければ `basis:"title"`、そうでなく `m:` の側にあれば `basis:"media"`、どちらも無ければ `null`
  - `venueLift(historyEvents, venueKey) -> { g, samai }` — その店の履歴の `outcome` を `summarize(…, 2)` でまとめる
  - `busyPercentiles(baselines: Record<string, base | null>) -> Record<string, number | null>` — `medianG` を持つ店について「自分より `medianG` が小さい店の数 /（店の数 − 1）」。店が1つなら `null`。`baseline` が `null` の店は `null`
- Produces（`collect/score.mjs`）:
  - `scoreEvent({ strength, venueLift, busy, overlapCount }) -> { group, score, points, evidence, missing }`
    - `strength` は `pickStrength` の戻り値、`venueLift` は `venueLift` の戻り値、`busy` は `{ pct, medianG } | null`、`overlapCount` は同じ店・同じ日のほかの予定の数
  - `isAnniversary(title, date, storeRules) -> boolean` — 企画名が `/周年|グランドオープン|創業|記念日/` を含むか、`storeRules`（`stores.json` の店の `rules`。無ければ `[]`）の `annual` ルールが `date` に当たるとき `true`

点数の式（`collect/score.mjs` の先頭に定数として置く）:

| 要素 | 点 | 最大 | 欠測の条件 |
|---|---|---|---|
| `mediaG` | `clamp(strength.g.mean / 150, 0, 5)` | 5 | `strength` か `strength.g` が `null` |
| `mediaSamai` | `clamp(strength.samai.mean / 25, -2, 5)` | 5 | `strength` か `strength.samai` が `null` |
| `venueG` | `clamp(venueLift.g.mean / 150, 0, 5)` | 5 | `venueLift.g` が `null` |
| `venueSamai` | `clamp(venueLift.samai.mean / 25, -2, 5)` | 5 | `venueLift.samai` が `null` |
| `busy` | `5 × busy.pct` | 5 | `busy` か `busy.pct` が `null` |
| `overlap` | `min(overlapCount, 3)` | 3 | 欠測にならない |

- 点は小数第1位に丸める
- `score = clamp(round1(10 × 点の合計 / 欠測でない要素の最大の合計), 0, 10)`
- `group` は `mediaG` と `mediaSamai` の両方が欠測なら `"unrated"`、そうでなければ `"rated"`
- `evidence` は欠測でない要素ごとに1行。文言:
  - `mediaG`: `同じ企画の過去の開催: 通常日より平均G +640（8回）`（`basis:"media"` なら `同じ媒体の過去の開催: …`）
  - `mediaSamai`: `同じ企画の過去の開催: 通常日より差枚 +41枚（5回）`（同上）
  - `venueG` / `venueSamai`: `この店の過去のイベント日: 通常日より平均G +310（3回）` / `… 差枚 +22枚（2回）`
  - `busy`: `この店の普段の平均G 2,480（東京の上位19%）`（上位% は `round((1 − pct) × 100)`）
  - `overlap`: `同日にほか1件` / 0件なら `同日のほかの予定なし`
  - 符号は常に付ける（`+0`、`-12`）
- `missing` は欠測の要素名の配列（上の表の順）

- [ ] **Step 1: 失敗するテストを書く**（閾値の境目でだけ結論が変わる入力にする）
  - `test("baseline: 旧イベント日と除外日を含めずに中央値を取る")` — 旧イベント日と除外日に外れ値を置き、含めると中央値が変わる入力にする
  - `test("baseline: 通常日の avgG が9日なら null、10日なら値")`
  - `test("baseline: avgSamai が9日なら medianSamai だけ null")`
  - `test("ruleEffects: 当たる日が2日のルールは出さず、3日なら出す")`
  - `test("outcomeOf: 店の基準との差で返す（生の値ではない）")` — `medianG` 2000 の店で `avgG` 2600 なら `g` は 600
  - `test("outcomeOf: avgSamai が null の日は samai null、g は値")`
  - `test("strengthTable/pickStrength: 企画名で2回・媒体で3回なら basis media")`
  - `test("strengthTable/pickStrength: 企画名で3回あれば basis title")`
  - `test("venueLift: 1回なら null、2回なら値")`
  - `test("busyPercentiles: 3店の medianG 1000/2000/3000 は 0, 0.5, 1")`
  - `test("scoreEvent: strength が null なら unrated、score は他の要素だけで出す")`
  - `test("scoreEvent: busy 欠測は 0点扱いにしない")` — 同じ入力で `busy` を `null` にしたとき、分母が5減ることを確かめる（0点を足した値と一致しないこと）
  - `test("scoreEvent: mediaG は mean 750 で 5、mean 749 で 5 未満")`
  - `test("scoreEvent: mediaSamai の下限は -2、score は 0 未満にならない")`
  - `test("scoreEvent: evidence と missing の数の合計は6")`
  - `test("scoreEvent: 文言の例どおりの evidence を出す")` — 上の文言の例の入力で、文字列を完全一致で比べる
  - `test("isAnniversary: '7周年記念' は true、'5のつく日' は false、annual 12/29 の店の 12/29 は企画名に関係なく true")`
  - `test("scoreEvent の引数に周年の情報は無く、点数は周年に左右されない")` — 周年は加点しない（ユーザー決定）
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: 変異で確かめる** — scratchpad に `collect/score.mjs` と `collect/stats.mjs` を複製し、(a) 欠測を0点として分母に含める (b) `mediaSamai` の下限を外す (c) `baseline` で旧イベント日を除外しない (d) `outcomeOf` で基準を引かない、の4つを1つずつ入れて、それぞれでテストが落ちることを確かめる。結果を報告に残す。本体は変えない
- [ ] **Step 6: コミット** — `git commit -m "feat: 店の統計と熱さの点数化を追加"`

---

### Task 7: データ検証

**Files:**
- Create: `validate-events.mjs`
- Modify: `scripts/validate-data.mjs`（新データの検証を追加。ファイルが無ければ飛ばして「未生成」と出す。`--dir=<パス>` で新データの読み込み元を変えられるようにする。既定は `data/`。店データ `stores.json` は常に `data/` から読む）
- Test: `test/validate-events.test.mjs`

**Interfaces:**
- Produces: `validateEventsData({ venues, mediaStrength, storeStats, months: Record<string, eventsFile> }) -> { errors: string[], warnings: string[] }`
- エラーにするもの: 日付が `YYYY-MM-DD` でない／月ファイルの `month` と違う月の日付／`venue` が `venues` に無い／`sources` が空、または URL が `http(s)://` でない／`checkedAt` の形式違い／`group` が `rated|unrated` 以外／`rated` なのに `mediaG` と `mediaSamai` が両方 `null`／`missing` に入っている要素の `points` が `null` でない（または逆）／`score` が 0〜10 の範囲外／`id` の重複／`frozen: false` なのに `outcome` がある／`store-stats` の `baseline` に `sourceUrl` が無い
- 警告にするもの: みんレポ未対応の店の割合が5割を超える

- [ ] **Step 1: 失敗するテストを書く** — 正しい最小データを作る関数を1つ用意し、そこから1か所ずつ壊した入力で、それぞれ1件のエラーが出ることを確かめる（上のエラー条件ごとに1テスト）。加えて `test("validateEventsData: 正しい最小データはエラー0")`
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: 実装し、`scripts/validate-data.mjs` から呼ぶ**
- [ ] **Step 4: 通ることを確かめる** — Run: `node --test test/validate-events.test.mjs && node scripts/validate-data.mjs` / Expected: PASS、既存の店データの結果（errors 0）は変わらず、新データは「未生成」
- [ ] **Step 5: コミット** — `git commit -m "feat: 熱いイベント関連データの検証を追加"`

---

### Task 8: 収集の本体

**Files:**
- Create: `collect/merge.mjs`, `scripts/collect-events.mjs`
- Test: `test/merge.test.mjs`, `test/collect-events.test.mjs`

**Interfaces:**
- Consumes: Task 1〜7 のすべて
- Produces:
  - `mergeMonth(previousFile | null, freshEvents, today, month, outcomes: Map<id, outcome>) -> eventsFile` — `today` より前の日のイベントは前回のものを残して `frozen: true` にする（前回に無い過去日のイベントは捨てる）。凍結イベントは `outcome` だけ、`null` のときに限り `outcomes` の値で埋める（一度入った `outcome` は変えない）。`today` 以降は今回のもので置き換える
  - `runCollect({ fetcher, today, readJson, writeJson, log }) -> Promise<{ ok: boolean, reasons: string[], counts }>` — 下の手順を行う。`fetcher` と `readJson`/`writeJson` を引数で受けるのはテストで差し替えるため
  - CLI: `node scripts/collect-events.mjs [--dry-run] [--today=YYYY-MM-DD]`。`--dry-run` は `_staging/collect/` に書き、`data/` に触れない（前回データの読み込みは `data/` から）

`runCollect` の手順:
1. 前回データを読む: `collect-meta.json` の `months` の月ファイルすべて・`venues.json`・`store-stats.json`（無ければ空として扱う）
2. DMM 予定一覧を1ページ目から `lastPage` まで取り、`today` から翌月末までのイベントだけを残して重複を除く。1件も取れなければ失敗
3. みんレポ東京都カテゴリの1〜10ページを取り、`buildVenues` で対応表を作る
4. みんレポを取る店 = 今回の予定がある店 ∪ 前回の月ファイルで `outcome` が `null` の過去日イベントがある店。そのうち `minrepoTag` があり、`store-stats` の `baseline.checkedAt` が7日より古い（または無い）店について店ページを1ページ取る。取れなかった店は前回の `store-stats` を使う
5. 店ごとに、除外日（その店の過去・今回のイベントの日付）と特定日ルール（`stores.json` の店ならその `rules`、それ以外は `parseRuleText(ruleText).rules`）で `baseline` と `ruleEffects` を計算する
6. 前回の月ファイルの過去日イベントで `outcome` が `null` のものに `outcomeOf` を当て、`outcomes` を作る
7. 履歴（凍結済みで `outcome` があるイベント。6 で埋まったものを含む）から `strengthTable` を作り、店ごとに `venueLift`、全体で `busyPercentiles` を計算する
8. 今回のイベントすべてに `pickStrength` と `scoreEvent` をかけ、`isAnniversary` を付ける
9. `mergeMonth` で前回の各月・当月・翌月のファイルを作り、`validateEventsData` に通す。エラーがあれば失敗
10. 失敗の判定: 2 で0件／9 でエラー／みんレポ対応率が前回の `collect-meta.json` より 0.3 以上下がった。失敗なら何も書かずに `ok:false`
11. 成功なら `venues.json`・`media-strength.json`・`store-stats.json`・各月ファイル・`collect-meta.json` を書く（`months` は前回の月と今回の月の和集合）
- みんレポの店ページの取得失敗（`FetchError`）は、その店を前回値か欠測で続ける（`log` に1行出す）。DMM 一覧とみんレポのカテゴリ1ページ目の `FetchError` は失敗にする

- [ ] **Step 1: 失敗するテストを書く**
  - `test("mergeMonth: today より前は前回のまま frozen、今回取れた過去日は捨てる")`
  - `test("mergeMonth: 凍結イベントの outcome は null のときだけ埋まり、二度目は変わらない")` — Review Focus 5
  - `test("mergeMonth: today 以降は今回のもので置き換え、前回だけにある未来のイベントは消える")`
  - `test("runCollect: 前回データが無い初回は全件 unrated で ok:true")` — Review Focus 5
  - `test("runCollect: DMM が0件なら ok:false で writeJson を呼ばない")` — `writeJson` の偽物は呼び出し引数を記録する
  - `test("runCollect: みんレポ店ページ1件が FetchError でも ok:true、その店のイベントは missing に busy を持つ")` — Review Focus 3
  - `test("runCollect: DMM 一覧が FetchError なら ok:false")`
  - `test("runCollect: みんレポ対応率が前回 0.8 から 0.4 に落ちたら ok:false")`
  - `test("runCollect: fetcher に渡した URL に同じものが2回無い")`
  - `test("runCollect: 前回の過去日イベントに、取得したみんレポの日別データから outcome が入る")`
  - いずれも `fetcher` は URL ごとにフィクスチャまたはテスト内で組んだ小さな HTML を返す偽物
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Run: `node --test test/*.test.mjs` / Expected: 既存69件を含め全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 熱いイベントの収集本体を追加"`

---

### Task 9: 実データでのドライランと目視確認（コントローラー）

**Files:**
- Create: `docs/熱いイベントのドライラン結果_<実行日YYYYMMDD>.md`

- [ ] **Step 1: ドライランを実行する** — Run: `node scripts/collect-events.mjs --dry-run`（実行時間は15〜20分を見込む。バックグラウンドで動かし、完了を待つ）/ Expected: 終了コード0、`_staging/collect/` に5種のファイル
- [ ] **Step 2: 数字を確かめる** — Run: `node scripts/validate-data.mjs --dir=_staging/collect` / Expected: errors 0。ほかに、イベント件数・`rated` と `unrated` の件数（初回は全件 `unrated` が正しい）・みんレポ対応率・`unmatchedMinrepo` の件数を記録する
- [ ] **Step 3: 目視確認** — `busy` の上位10店と下位5店、イベント10件を出典ページと照合する。確かめる点: 店と予定の取り違えがないこと／基準の平均G がみんレポのページと矛盾しないこと／周年バッジの誤検出がないこと。みんレポ未対応の店から10件を選び、本当にみんレポに無いのか、表記揺れで取りこぼしているのかを確かめる
- [ ] **Step 4: 結果を文書にする** — Step 2・3 の数字と、見つかった問題・直したことを書く。**みんレポ対応率が5割未満なら、ここでユーザーに報告して判断を仰ぐ**
- [ ] **Step 5: 問題があれば該当タスクの実装担当に直させ、テストを足してから Step 1 からやり直す**
- [ ] **Step 6: コミット** — 文書だけ。`_staging/` はコミットしない

---

### Task 10: ビューワ

**Files:**
- Create: `hot.mjs`
- Modify: `index.html`（タブとスタイル）、`app.js`（読み込みと描画）
- Test: `test/hot.test.mjs`

**Interfaces:**
- Consumes: `data/collect-meta.json`、`data/events/<month>.json`、`data/venues.json`、`data/store-stats.json`
- Produces:
  - `selectHotEvents(events, { today, days = 7, limit = 30, area = null }) -> { rated: Event[], unrated: Event[], total: number }` — `today` 以降で `today` から `days` 日以内（`days` が `null` なら全件）、`area`（`venues` から引いたエリア名）で絞る。`rated` は `score` の高い順、同点は日付の早い順。`unrated` は日付の早い順、同日は `score` の高い順。`limit` は `rated` と `unrated` それぞれに掛ける
  - `staleness(lastSuccessAt, today) -> { days: number, stale: boolean }` — 35日を超えたら `stale`
  - `ruleEffectLabel(effect) -> string` — 例: `通常日比 +18枚（9日）`

- [ ] **Step 1: 失敗するテストを書く**
  - `test("selectHotEvents: 8日後の予定は days 7 で入らず、days null で入る")`
  - `test("selectHotEvents: 昨日の予定は入らない")`
  - `test("selectHotEvents: unrated は rated に混ざらない")`
  - `test("selectHotEvents: rated が0件でも unrated は返る")` — Review Focus 5
  - `test("selectHotEvents: area で絞る")`
  - `test("staleness: 35日は stale でなく、36日は stale")`
  - `test("ruleEffectLabel: 負の差は '-12枚' と出す")`
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: `hot.mjs` を実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: 画面を作る**（`index.html` / `app.js`）
  - タブの先頭に「熱いイベント」を足し、最初に開くタブにする。既存の5タブはそのまま
  - 上部: 最終更新日。`stale` なら「データが古くなっています（最終更新 N 日前）」を赤字で出す
  - 絞り込み: エリア（既存の `AREA_ORDER` の順、その後に区市町村を五十音順）と「もっと見る」（押すと `days: null, limit: Infinity`）
  - 1件のカード: 日付・店名・エリア・媒体・企画名・点数・周年バッジ・`evidence` の各行・`missing` があれば「データなし: 企画の過去の開催・この店の過去のイベント日…」・出典リンク・店の公式X（`venues` の `x`）
  - `unrated` は「強さ不明（過去の開催データがまだ無い予定）」の見出しの下に、点数を出さずに `evidence` と並べる。`rated` が0件のときは「強さを測れる予定はまだありません。収集を続けると、過去の開催データがたまって点数が付きます」と出す
  - 注記: 既存の「推定・伝聞であり公式情報ではない」の文言をこのタブの冒頭にも置く
  - 既存の今日・明日・日付指定タブと店舗カードの特定日バッジの横に、`store-stats.json` に `ruleEffects` があれば `ruleEffectLabel` を添える（`stores.json` の店 ↔ `venues` の `storeId` で引く）。無ければ今の表示のまま
  - 新しいデータが読めない・壊れている場合は、このタブに「データ未生成」と出し、既存タブは今のまま動かす（既存の coverage の扱いと同じ）
- [ ] **Step 6（コントローラー）: ブラウザで確かめる** — Task 9 の `_staging/collect/` のファイルを一時的に `data/` に置き（コミットしない）、`python3 -m http.server 8099` で開く。確かめる点: 熱いイベントが最初に開く／エリアで絞れる／もっと見るで全件になる／強さ不明の枠と、rated 0件の案内／データなしの表示／既存5タブの表示が変わらない。スマホ幅（375px）でも確かめる。確認後に一時ファイルを消す
- [ ] **Step 7: コミット** — `git commit -m "feat: 熱いイベントタブと特定日の実効性表示を追加"`

---

### Task 11: 自動実行とドキュメント

**Files:**
- Create: `.github/workflows/collect.yml`, `docs/熱いイベントの自動更新.md`
- Modify: `README.md`, `CHANGELOG.md`
- Delete: `.github/workflows/probe.yml`

- [ ] **Step 1: `.github/workflows/collect.yml` を書く**
  - トリガー: `schedule` に `"0 0 1 * *"`（毎月1日 9:00 JST）と `"0 21 * * 0"`（毎週月曜 6:00 JST）、それと `workflow_dispatch`
  - `permissions: contents: write`、`concurrency: { group: collect, cancel-in-progress: false }`、`timeout-minutes: 60`
  - `env: TZ: Asia/Tokyo`
  - 手順: checkout → setup-node（24）→ `node --test test/*.test.mjs` → `node scripts/collect-events.mjs` → `node scripts/validate-data.mjs` → `data/` に差分があれば `git add data/` だけをしてコミット（`chore(data): 熱いイベントを自動更新 YYYY-MM-DD`、author は `github-actions[bot]`）して push。差分が無ければ何もしない
  - どの手順が失敗してもジョブを失敗させる（失敗通知メールで気づけるようにする）
- [ ] **Step 2: `docs/熱いイベントの自動更新.md` を書く** — いつ動くか／何を取るか（DMM・みんレポと取得間隔。ホールナビを使わない理由）／点数の式（Task 6 の表）／立ち上がり直後は全件が強さ不明になること／失敗したときの見方（Actions の画面・よくある原因: サイトの構造変更、遮断）／手で動かす方法（`gh workflow run collect.yml`）／止め方（ワークフローの無効化）
- [ ] **Step 3: README と CHANGELOG を更新する** — README は構成表に新ファイル・新データ、閲覧方法に新タブ、更新方法に自動更新を足す。テスト件数を実数に直す。CHANGELOG に日付の節を足す
- [ ] **Step 4: `.github/workflows/probe.yml` を削除する**（`scripts/probe-sources.mjs` は障害時の切り分け用に残す）
- [ ] **Step 5: 全テストを通す** — Run: `node --test test/*.test.mjs` / Expected: 全件 PASS
- [ ] **Step 6: コミット** — `git commit -m "feat: 熱いイベントの自動更新ワークフローを追加"`
- [ ] **Step 7（コントローラー・マージ後）: `gh workflow run collect.yml` で1回動かし、`chore(data): …` のコミットが main に入り、公開ページ（https://ramdamain-commits.github.io/tokyo-pachi-guide/ ）で熱いイベントタブが出ることを確かめる**
