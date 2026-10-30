# 熱いイベント一覧と自動更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 東京都全体の来店・取材予定を DMMぱちタウンから自動収集し、ホールナビ・みんレポの客観データで熱さを点数化して、ビューワの新タブ「熱いイベント」に熱い順で出す。GitHub Actions で毎月1日と毎週自動更新する。

**Architecture:** 収集は Node.js の素のスクリプト（依存パッケージなし・組み込み `fetch`）。取得（`collect/http.mjs`）、サイト別のパーサ（`collect/dmm.mjs` 等）、突き合わせ、統計、点数化を純粋関数に分け、`scripts/collect-events.mjs` がつなぐ。成果物は `data/` 配下の JSON で、ビューワ（既存の静的 HTML + ES module）がそれを読む。GitHub Actions がスクリプトを動かし、データだけを main に push する。

**Tech Stack:** Node.js 24（ローカル v24.14.0）、`node:test`、素の HTML/JS、GitHub Actions、GitHub Pages

**Spec:** `docs/superpowers/specs/2026-10-30-hot-events-design.md`

## Global Constraints

- 依存パッケージを入れない（`package.json` を作らない）。HTML の解析は正規表現と文字列処理で行う
- 取得は1リクエストごとに 2,000ms 以上あける。同じ URL は1回の実行で1度しか取らない。User-Agent は固定の1つを使う
- 会員登録・ログインが要る情報は取らない（ホールナビの「会員登録して表示する」の部分は飛ばす）
- 公開するのは事実情報（日付・店名・住所・媒体名・企画名・数値）と元ページへのリンクだけ。取得元の説明文・画像は保存も表示もしない。**テスト用フィクスチャも同じ扱い**で、実ページから構造に必要な部分を2〜3件分だけ切り出し、1ファイル 5KB 以下にする（公開リポジトリに取得元のページを丸ごと置かない）
- 欠測を0や平均で埋めない。欠けた要素は `missing` に名前を入れ、画面に「データなし」と出す
- 店をまたいで生の平均差枚を比べない。差枚は「その店の通常日との差」にしてから使う
- 日付はすべて日本時間で扱う。Actions では環境変数 `TZ=Asia/Tokyo` を設定する。日付の生成は既存 `match.mjs` と同じく `new Date(y, m-1, d)` 形式で行い、`new Date("YYYY-MM-DD")` は使わない
- 周年は加点しない（バッジ表示のみ）。「○のつく日」型の企画も加点しない
- 全データに出典 URL と取得日（`checkedAt`、`YYYY-MM-DD`）を付ける
- 失敗時は公開データを上書きせず、終了コード1で終える
- コード・コメント・コミットメッセージ・ドキュメントは日本語（識別子は英語）。既存コードの書き方（JSDoc コメント・`node:test`・`assert/strict`）に合わせる
- テストの実行: `node --test test/*.test.mjs`

## 設計書からの変更点（下調べの結果。計画で確定）

- **追加**: 「店×その取材の過去開催」の並び人数を材料に加える（`history`）。ホールナビの店舗ページに、その店でその取材が来た過去の日付・評価・並び人数の一覧がある（`hole_view?hid=...&ec=event&koe=...`）
- **削除**: 「SNS・ネットの噂◯件」は店舗ページに無く、予定一覧の会員限定でない行にしか出ないため、v1 では使わない
- **周年の判定**: DMM・ホールナビの企画名に `周年|グランドオープン|創業|記念日` を含むか、`stores.json` の `annual` ルールがその日に当たるとき

## Review Focus

1. **年をまたぐ日付**: ホールナビは `1/3(` のように年なし、みんレポも年なしで、12月から1月にかけて年の補い方を誤りやすい。基準日の前後で正しい年を付けること
2. **DMM の重複掲載**: 同じ店・同じ日・同じ企画が2回並ぶ実例がある（2026-10-30 のクリエ府中西原店）。1件にまとめること
3. **一部ページの取得失敗**: 店舗ページ1件の 5xx やタイムアウトで実行全体を止めない。そのイベントは欠測扱いで残す。ただし DMM の予定一覧が取れないときは全体を失敗にする
4. **Actions のタイムゾーン**: UTC で動くと「今日」が1日ずれ、凍結や7日間表示がずれる。`TZ=Asia/Tokyo` を前提に、基準日を引数でも渡せるようにすること
5. **閉店・未収載の店**: ホールナビやみんレポに店が無い場合は、点数を下げるのではなく欠測として扱う

各項目のテストは、担当タスクの中に入れてある。

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `collect/http.mjs` | 間隔をあけた取得・実行内キャッシュ・再試行 |
| `collect/dates.mjs` | 年なし日付への年の補完、JST の基準日 |
| `collect/dmm.mjs` | DMM 予定一覧ページの解析と重複除去 |
| `collect/hallnavi.mjs` | ホールナビの店舗一覧・店舗ページ・店×取材ページの解析 |
| `collect/minrepo.mjs` | みんレポのタグ一覧・店舗ページの解析 |
| `collect/rule-text.mjs` | 「16日、月と日がゾロ目の日」等の文言を `match.mjs` のルールへ変換 |
| `collect/venues.mjs` | 店名・住所の正規化と、DMM・ホールナビ・みんレポ・`stores.json` の突き合わせ |
| `collect/stats.mjs` | 通常日の基準・特定日の実効性・イベント日の上振れ |
| `collect/score.mjs` | 熱さの点数・根拠・欠測 |
| `collect/merge.mjs` | 月ファイルの更新（過去日の凍結） |
| `validate-events.mjs` | 新データファイルの検証（ルート。既存 `validate.mjs` と並べる） |
| `hot.mjs` | ビューワ側の絞り込み・並べ替え（ルート。既存 `coverage.mjs` と並べる） |
| `scripts/probe-sources.mjs` | 各サイトに届くかの確認 |
| `scripts/collect-events.mjs` | 収集の本体（つなぎ役） |
| `scripts/validate-data.mjs` | 既存。新データの検証を追加 |
| `.github/workflows/probe.yml` / `collect.yml` | Actions |
| `data/venues.json` / `data/media-strength.json` / `data/store-stats.json` / `data/events/YYYY-MM.json` / `data/collect-meta.json` | 成果物 |
| `test/fixtures/*.html` | 切り出したフィクスチャ（各 5KB 以下） |

## データ形式（全タスク共通）

```jsonc
// data/venues.json — 店の対応表。キーは "dmm:<DMM店舗ID>"（DMMに無くホールナビだけの店は "hn:<hid>"）
{ "updated": "2026-11-01", "venues": { "dmm:102": {
  "name": "エスパス日拓上野新館", "address": "東京都台東区上野4-7-5", "municipality": "台東区",
  "area": "上野",            // stores.json の店なら既存エリア、それ以外は municipality
  "storeId": "espace-ueno-shinkan" | null, "dmmShopId": "102", "hallNaviHid": "1310..." | null,
  "minrepoTag": "エスパス日拓上野新館" | null, "x": "https://..." | null } } }

// data/media-strength.json — 取材種別の強さ（ホールナビの全国集計）
{ "updated": "2026-11-01", "media": [ {
  "name": "スロパチステーション来店取材(オレンジ)", "media": "スロパチステーション",
  "aliases": ["…DMM側の企画名…"], "confirmed": 226, "held": 664, "storeCount": 51,
  "impactSamai": 70, "impactG": 787, "sourceUrl": "https://hall-navi.com/hole_view?hid=…", "checkedAt": "2026-11-01" } ] }

// data/store-stats.json — 店の実績
{ "updated": "2026-11-01", "stats": { "dmm:102": {
  "crowd": { "avg": 177, "min": 71, "max": 580, "samples": 26, "sourceUrl": "…", "checkedAt": "…" } | null,
  "baseline": { "medianSamai": 12, "days": 140, "sourceUrl": "…min-repo…", "checkedAt": "…" } | null,
  "ruleEffects": [ { "label": "5のつく日", "diff": 18, "days": 21 } ],
  "eventHistory": { "<取材名>": { "dates": ["2026-10-01"], "lineups": [734, 148], "marks": ["GOOD"], "sourceUrl": "…", "checkedAt": "…" } } } } }

// data/events/2026-11.json
{ "month": "2026-11", "generatedAt": "2026-11-01T09:04:00+09:00", "events": [ {
  "id": "2026-11-07|dmm:102|裏桜梅桃李", "date": "2026-11-07", "venue": "dmm:102",
  "media": "パチ＆スロ必勝本", "title": "裏桜梅桃李", "anniversary": false,
  "group": "rated" | "unrated", "score": 6.4,
  "points": { "media": 7.4, "crowd": 2.9, "history": null, "lift": null, "overlap": 1 },
  "evidence": ["取材の効き: 開催時 +70枚・+787G（全国51店）", "平均並び 177人（26回）"],
  "missing": ["history", "lift"], "frozen": false,
  "sources": [ { "url": "https://p-town.dmm.com/shops/tokyo/102", "checkedAt": "2026-11-01" } ] } ] }

// data/collect-meta.json
{ "lastSuccessAt": "2026-11-01T09:04:00+09:00", "months": ["2026-11", "2026-12"],
  "rates": { "hallNaviMatched": 0.82, "minrepoMatched": 0.41 }, "counts": { "events": 612 } }
```

---

### Task 1: 取得部品と、Actions から各サイトに届くかの確認

**最初に行う。** ここで Actions から取れないと分かったら、以降の計画（Task 11）の実行基盤が変わるので、結果をユーザーに報告して止まる。

**Files:**
- Create: `collect/http.mjs`, `scripts/probe-sources.mjs`, `.github/workflows/probe.yml`
- Test: `test/http.test.mjs`

**Interfaces:**
- Produces: `createFetcher({ delayMs = 2000, userAgent = UA, maxRetries = 2, fetchImpl = fetch, sleep }) -> { get(url): Promise<{ status: number, text: string }> }`
  - 200 なら `{status:200, text}`。404/410 は再試行せず `{status, text:""}` を返す
  - それ以外（403・429・5xx・ネットワーク例外）は `maxRetries` 回まで再試行し、だめなら `FetchError`（`url` と `status` を持つ）を投げる。403 を「存在しない」扱いにしない
  - 同じ URL への2回目以降は、通信せずにキャッシュを返す
  - `UA` は `collect/http.mjs` から export する

- [ ] **Step 1: 失敗するテストを書く** — `fetchImpl` と `sleep` は呼ばれた引数を記録する偽物にする（引数を無視しない）
  - `test("get: 2回目の同じURLは fetchImpl を呼ばない")` — 呼び出し URL の配列が `[url]` のまま
  - `test("get: 連続する別URLの間で sleep(2000) を呼ぶ")` — `sleep` の引数が `[2000]`
  - `test("get: 404 は再試行せず status 404 を返す")` — `fetchImpl` の呼び出しが1回
  - `test("get: 503 を maxRetries 回再試行して FetchError")` — 呼び出し3回、`err.status === 503`
  - `test("get: 403 も再試行対象で、最後は FetchError")` — 403 を 404 扱いしない
  - `test("get: User-Agent ヘッダに UA を付ける")` — `fetchImpl` の第2引数の headers を確かめる
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test test/http.test.mjs` / Expected: FAIL（モジュールが無い）
- [ ] **Step 3: `collect/http.mjs` を実装する**
- [ ] **Step 4: 通ることを確かめる** — Run: `node --test test/http.test.mjs` / Expected: PASS
- [ ] **Step 5: `scripts/probe-sources.mjs` を書く** — 次の5つの URL を `createFetcher` で取り、URL・HTTP ステータス・本文の長さ・確認用の文字列の有無を1行ずつ出す。1つでも 200 以外か確認用の文字列が無ければ終了コード1にする
  - `https://p-town.dmm.com/schedules/tokyo`（確認用の文字列: `実施日：`）
  - `https://hall-navi.com/serch_hole_result?k=1&c=all&area=kanto`（`hole_view?hid=`）
  - `https://hall-navi.com/hole_view?hid=194001300000613210`（`並び人数の集計`）
  - `https://min-repo.com/category/%e6%9d%b1%e4%ba%ac%e9%83%bd/`（`min-repo.com/tag/`）
  - `https://min-repo.com/tag/%e3%82%ab%e3%83%ac%e3%82%a4%e3%83%89%e6%96%b0%e5%ae%bf%e5%ba%97/`（`旧イベント日`）
- [ ] **Step 6: ローカルで動かす** — Run: `node scripts/probe-sources.mjs` / Expected: 5行とも 200・確認用の文字列あり、終了コード0
- [ ] **Step 7: `.github/workflows/probe.yml` を書く** — `workflow_dispatch` のみ、`ubuntu-latest`、`actions/setup-node@v4`（`node-version: 24`）、`env: TZ: Asia/Tokyo`、`node scripts/probe-sources.mjs` を実行するだけ
- [ ] **Step 8: コミットし、push して Actions で動かす**

```bash
git add collect/http.mjs test/http.test.mjs scripts/probe-sources.mjs .github/workflows/probe.yml
git commit -m "feat: 取得部品と取得元への到達確認を追加"
git push
gh workflow run probe.yml && gh run watch --exit-status
```

Expected: 成功。**失敗したら、どのサイトが何番で返ったかをユーザーに報告して止まる**（代替はPCのタスクスケジューラ実行で、Task 11 が変わる）。

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
  - `parseDmmSchedulePage(html) -> { events: DmmEvent[], lastPage: number | null }`
  - `DmmEvent = { dmmShopId: string, shopName: string, address: string, date: string, media: string | null, title: string }`
  - `dedupeDmmEvents(events) -> DmmEvent[]`（キーは `dmmShopId|date|media|title`。最初の1件を残す）
- DMM の1件は `<li class="unit …">` で、店舗リンクが `href=/shops/tokyo/<ID>`（引用符なし）、店名が `p.title`、住所が `p.lead`、日付が `p.date` の `実施日：YYYY/MM/DD`、`.bottom .right` の `span.text-icon` が媒体名・企画名の順に並ぶ。`span.text-icon` が1つなら媒体なし（`media: null`）とし、それを企画名にする。最終ページ番号は `schedules/tokyo?page=N` のリンクの最大値

- [ ] **Step 1: フィクスチャを作る** — `https://p-town.dmm.com/schedules/tokyo?page=1` を取り、`<li class="unit` を3件（うち2件は同じ店・同じ日・同じ企画の重複。無ければ1件を複製して作る）と、`?page=29` を含むページ送りのリンクだけを残して `test/fixtures/dmm-schedule.html` に保存する。説明文・画像の `alt` は空にする
- [ ] **Step 2: 失敗するテストを書く**
  - `test("inferYear: 基準 2026-12-28 で 1/3 は future なら 2027-01-03")`
  - `test("inferYear: 基準 2027-01-02 で 12/30 は past なら 2026-12-30")`
  - `test("inferYear: 基準 2026-11-01 で 10/31 は past なら 2026-10-31")`
  - `test("jstToday: UTC 2026-10-31T15:30Z は 2026-11-01")` — Review Focus 4
  - `test("parseDmmSchedulePage: 店舗ID・店名・住所・日付・媒体・企画名を取り出す")` — フィクスチャの1件目を、実際の値を書き写した期待値と `deepEqual` で比べる
  - `test("parseDmmSchedulePage: lastPage は 29")`
  - `test("dedupeDmmEvents: 同じ店・日・媒体・企画の重複を1件にする")` — 3件→2件。Review Focus 2
  - `test("dedupeDmmEvents: 企画名だけ違うものは残す")`
- [ ] **Step 3: 落ちることを確かめる** — Run: `node --test test/dates.test.mjs test/dmm.test.mjs` / Expected: FAIL
- [ ] **Step 4: `collect/dates.mjs` と `collect/dmm.mjs` を実装する**
- [ ] **Step 5: 通ることを確かめる** — Run: 同上 / Expected: PASS
- [ ] **Step 6: コミット** — `git commit -m "feat: DMM予定一覧の解析と日付補完を追加"`

---

### Task 3: ホールナビの解析

**Files:**
- Create: `collect/hallnavi.mjs`, `test/fixtures/hallnavi-list.html`, `test/fixtures/hallnavi-hall.html`, `test/fixtures/hallnavi-koe.html`
- Test: `test/hallnavi.test.mjs`

**Interfaces:**
- Consumes: `inferYear`（Task 2）
- Produces:
  - `parseHallList(html) -> { halls: { hid, name, address }[], lastPage: number | null }`（住所の先頭の `[○○駅]` は落とす。ページ送りは `serch_hole_result?...&page=N`）
  - `parseHallPage(html, refDate) -> { crowd, upcoming, pastEventMenu }`
    - `crowd`: 「並び人数の集計」ブロックから `{ avg, min, max, samples }`。ブロックが無ければ `null`
    - `upcoming`: 「以降のスケジュール(1週間分)」の各取材 `{ date, name, media, koe, strength }`。日付は `h3.flat_subtt_os_eve` の `M/D(` を `inferYear(..., "future")` で補う。`name` は `li.list_event_name_li`、`media` は `span.tag_badge`、`koe` は「過去開催結果を見る」リンクの `koe=` の値。`strength` は `table.ana_result` から `{ confirmed, held, impactSamai, impactG, storeCount }`。表が無ければ `null`
    - `pastEventMenu`: 「取材:絞り込み」メニューの各項目 `{ koe, name, media, count }`（`[4件]` の数字が count）
  - `parseKoePage(html, refDate) -> { date, mark, lineup }[]` — `#past_repo` 以降の各 `past_repo_new_ymd` ブロックの日付（`inferYear(..., "past")`）、評価（`GOOD` 等。無ければ `null`）、`並びN人`（無ければ `null`）
  - `EXCLUDED_EVENT_PATTERNS`: 予定として扱わない名前の正規表現の配列。`/^ナビ子/`, `/^旧イベ\(/`, `/予測\(/`, `/^店舗傾向分析/`（ホールナビ独自の予想で、実在の催しではない）

- [ ] **Step 1: フィクスチャを作る** — 実ページから必要な部分だけ切り出す。各 5KB 以下にし、説明文（`<p style="margin-top:5px;">…</p>`）は消す
  - `hallnavi-list.html`: `serch_hole_result?k=1&c=all&area=kanto` から店舗2件（うち1件は `[有楽町駅]` 付きの住所）と、`page=2` のページ送り
  - `hallnavi-hall.html`: `hole_view?hid=194001300000613210`（PIA町田新館）から「並び人数の集計」ブロックと「取材:絞り込み」メニューの3項目。加えて `hole_view?hid=131004200000002850`（エクス・アリーナ東京）から、信頼度の表を持つ予定1件と表を持たない予定1件（無ければ表を消して作る）
  - `hallnavi-koe.html`: `hole_view?hid=131004200000002850&ec=event&koe=12959` の `#past_repo` 以降の2日分（並びのある日と、並びの行を消した日）
- [ ] **Step 2: 失敗するテストを書く** — 期待値は切り出した実データから書き写す
  - `test("parseHallList: hid・店名・住所（駅名を除く）と lastPage")`
  - `test("parseHallPage: 並び人数の集計 avg177 min71 max580 samples26")`
  - `test("parseHallPage: 信頼度の表から confirmed226 held664 storeCount51 impactSamai70 impactG787")`
  - `test("parseHallPage: 信頼度の表が無い予定は strength null")`
  - `test("parseHallPage: 並び人数の集計が無いページは crowd null")`
  - `test("parseHallPage: 基準 2026-12-28 で 1/2( の予定は 2027-01-02")` — Review Focus 1
  - `test("parseKoePage: 日付・評価・並び。並びの無い日は lineup null")`
  - `test("EXCLUDED_EVENT_PATTERNS: ナビ子AI予想・旧イベ(1のつく日)・アナスロ予測(虹) を除外し、スロパチステーション来店取材 は残す")`
- [ ] **Step 3: 落ちることを確かめる** — Run: `node --test test/hallnavi.test.mjs` / Expected: FAIL
- [ ] **Step 4: `collect/hallnavi.mjs` を実装する**
- [ ] **Step 5: 通ることを確かめる** — Expected: PASS
- [ ] **Step 6: コミット** — `git commit -m "feat: ホールナビの店舗一覧・店舗ページ・取材別ページの解析を追加"`

---

### Task 4: みんレポの解析と特定日の文言の変換

**Files:**
- Create: `collect/minrepo.mjs`, `collect/rule-text.mjs`, `test/fixtures/minrepo-store.html`, `test/fixtures/minrepo-category.html`
- Test: `test/minrepo.test.mjs`, `test/rule-text.test.mjs`

**Interfaces:**
- Consumes: `inferYear`（Task 2）、`matchRule`（既存 `match.mjs`）
- Produces:
  - `parseMinrepoCategory(html) -> { tags: string[], lastPage: number | null }` — `min-repo.com/tag/<名前>/` の名前（URL デコード済み・重複なし）
  - `minrepoTagUrl(tag) -> string`
  - `parseMinrepoStorePage(html, refDate) -> { ruleText: string | null, days: { date, totalSamai, avgSamai, avgG }[], nextPage: string | null }` — 「データ一覧」の表の行。`-` は `null`。日付は表の上から下へ新しい順に並ぶので、`inferYear(..., "past")` で補ったうえで、前の行より新しくなったら1年戻す。`ruleText` は「旧イベント日」の行の文言（`※追加・修正…` の注記は除く）
  - `parseRuleText(text) -> { rules: Rule[], unparsed: string[] }` — 読点で区切った各句を `match.mjs` の形へ変換。対応表:
    - `Nのつく日` → `{type:"digit", value:N}`
    - `N日` → `{type:"monthday", value:N}`、`末日` → `{type:"monthday", value:"last"}`
    - `月と日がゾロ目の日` → `{type:"month-day-match"}`
    - `ゾロ目の日` → `{type:"zorome"}`
    - `毎週X曜日` → `{type:"weekday", value:<getDay()の数値>}`
    - `第NX曜日` → `{type:"nth-weekday", nth:N, weekday:<数値>}`
    - それ以外は `unparsed` へ入れる（推測で変換しない）

- [ ] **Step 1: フィクスチャを作る** — `min-repo.com/tag/カレイド新宿店/` から「旧イベント日」の行と「データ一覧」の表の5行（差枚が `-` の行を含む）とページ送り。表の機種欄は消す。カテゴリページは tag リンク3件とページ送り
- [ ] **Step 2: 失敗するテストを書く**
  - `test("parseMinrepoStorePage: ruleText は '16日、月と日がゾロ目の日、第4土曜日'")`
  - `test("parseMinrepoStorePage: '-' の差枚は null、平均G は数値")`
  - `test("parseMinrepoStorePage: 基準 2027-01-02 で 1/1, 12/31 の並びは 2027-01-01, 2026-12-31")` — Review Focus 1
  - `test("parseRuleText: '16日、月と日がゾロ目の日、第4土曜日' を3ルールに変換し unparsed は空")` — 第4土曜日は `{type:"nth-weekday", nth:4, weekday:6}`
  - `test("parseRuleText: '5のつく日、末日' を digit 5 と monthday last に")`
  - `test("parseRuleText: 'リニューアル記念' は unparsed に入りルールを作らない")`
  - `test("parseRuleText の結果は matchRule で 2026-10-24 にだけ第4土曜日がマッチする")` — 変換結果を既存の `matchRule` に通して確かめる
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
- Consumes: `DmmEvent`（Task 2）、`parseHallList` の `halls`（Task 3）、`parseMinrepoCategory` の `tags`（Task 4）、`data/stores.json` の `stores`
- Produces:
  - `normalizeName(s) -> string` — NFKC、空白・中黒・記号（`・ .-()（）`）の除去、小文字化
  - `normalizeAddress(s) -> string` — NFKC、`東京都` の除去、「丁目」「番地」「番」「号」を `-` に、漢数字の丁目（`六丁目`）を算用数字に、末尾の `-` と建物名（最初の空白以降）を落とす
  - `municipality(address) -> string | null` — `東京都` の直後の `…区|…市|…町|…村`
  - `buildVenues({ dmmEvents, halls, minrepoTags, stores, previous }) -> { venues: Record<string, Venue>, unmatched: { hallNavi: string[], minrepo: string[] } }`
    - DMM の店ごとに `dmm:<ID>` を作る。ホールナビとは**正規化住所の一致**で対応付け、住所が一致しなければ正規化店名の一致で対応付ける。みんレポとは正規化店名の一致だけで対応付ける（住所が無いため）。`stores.json` とは正規化住所で対応付ける
    - `previous`（前回の `venues.json`）にあった対応は、今回の一覧で見つからなくても残す
    - 対応が付かなかった店は `unmatched` に名前を入れる（捨てない）
    - `area` は `stores.json` の店ならその `area`、それ以外は `municipality`

- [ ] **Step 1: 失敗するテストを書く**
  - `test("normalizeAddress: '東京都町田市原町田6丁目13番21号' と '東京都町田市原町田6-13-21' が一致")`
  - `test("normalizeAddress: '東京都台東区上野4-7-5　日拓上野アメ横ビル' の建物名を落とす")`
  - `test("normalizeName: 'エクス・アリーナ東京' と 'エクス・アリーナ 東京' が一致")`
  - `test("buildVenues: 住所一致でホールナビの hid を付ける")`
  - `test("buildVenues: 住所が無く店名だけ一致する場合も hid を付ける")`
  - `test("buildVenues: どれとも一致しない店は venues に残り unmatched.hallNavi に入る")` — Review Focus 5
  - `test("buildVenues: stores.json と住所一致した店は storeId と既存エリアを持つ")`
  - `test("buildVenues: previous の対応は今回見つからなくても残す")`
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: `collect/venues.mjs` を実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: DMM・ホールナビ・みんレポ・既存店の突き合わせを追加"`

---

### Task 6: 店の統計と熱さの点数

**Files:**
- Create: `collect/stats.mjs`, `collect/score.mjs`
- Test: `test/stats.test.mjs`, `test/score.test.mjs`

**Interfaces:**
- Consumes: `matchRule`（既存）、みんレポの `days`（Task 4）
- Produces:
  - `baselineSamai(days, excludeDates: Set<string>, rules) -> { medianSamai, days } | null` — `avgSamai` が数値の日のうち、`excludeDates` に無く、どの `rules` にも当たらない日の中央値。該当日が10日未満なら `null`
  - `ruleEffects(days, rules, labelOf = ruleLabel) -> { label, diff, days }[]` — ルールごとに「当たる日の `avgSamai` 平均 − 基準の中央値」。当たる日が3日未満のルールは出さない。`ruleLabel` は既存 `match.mjs` のもの
  - `isAnniversary(title, date, storeRules) -> boolean` — 企画名が `/周年|グランドオープン|創業|記念日/` を含むか、`storeRules`（`stores.json` の店の `rules`。無ければ `[]`）の `annual` ルールが `date` に当たるとき `true`。点数には使わない
  - `eventLift(days, eventDates: string[], baseline) -> { diff, days } | null` — `eventDates` のうち `avgSamai` がある日の平均 − 基準。該当が2日未満なら `null`
  - `scoreEvent({ strength, crowd, history, lift, overlapCount }) -> { group, score, points, evidence, missing }`

点数の式（ここで確定。`collect/score.mjs` の先頭に定数として置く）:

| 要素 | 点 | 最大 | 欠測の条件 |
|---|---|---|---|
| `media` | `clamp(impactSamai/20, 0, 5) + clamp(impactG/200, 0, 5)` | 10 | `strength` が `null` |
| `crowd` | `clamp(avg/60, 0, 5)`。`samples < 5` なら半分 | 5 | `crowd` が `null` |
| `history` | 並びのある回の平均 `/100` を `clamp(…,0,5)`。並びのある回が2回未満なら半分 | 5 | 並びのある回が0 |
| `lift` | `clamp(diff/50, -2, 5)` | 5 | `lift` が `null` |
| `overlap` | `min(overlapCount, 3)`（同じ店・同じ日のほかの予定の数） | 3 | 欠測にならない |

- `score = round1(10 × 得た点の合計 / 欠測でない要素の最大の合計)`
- `group` は `media` が欠測なら `"unrated"`、そうでなければ `"rated"`
- `evidence` は欠測でない要素ごとに1行（例: `取材の効き: 開催時 +70枚・+787G（全国51店）`、`平均並び 177人（26回）`、`この取材の過去の並び 734人・148人`、`過去の同取材日は通常日比 +40枚（5日）`、`同日にほか1件`）
- `missing` は欠測の要素名の配列

- [ ] **Step 1: 失敗するテストを書く**（閾値の境目でだけ結論が変わる入力にする）
  - `test("baselineSamai: 旧イベント日と除外日を含めずに中央値を取る")` — 旧イベント日に +500 の外れ値を置き、含めると中央値が変わる入力にする
  - `test("baselineSamai: 対象が9日なら null、10日なら値")`
  - `test("ruleEffects: 当たる日が2日のルールは出さず、3日なら出す")`
  - `test("eventLift: 店の基準との差で返す（生の平均差枚ではない）")` — 基準 +100 の店で、イベント日平均 +130 なら `diff` は 30
  - `test("scoreEvent: media 欠測は unrated になり、score は他の要素だけで出す")`
  - `test("scoreEvent: crowd 欠測でも 0 点扱いにしない")` — 同じ入力で crowd を `null` にしたとき、分母が5減ることを確かめる（0点を足した値と一致しないこと）
  - `test("scoreEvent: samples 4 と 5 で crowd の点が半分と満額に分かれる")`
  - `test("scoreEvent: impactSamai 70・impactG 787 で media は 7.4（3.5+3.9）")`
  - `test("scoreEvent: lift の下限は -2")`
  - `test("scoreEvent: evidence と missing が要素と一対一")`
  - `test("isAnniversary: '7周年記念' は true、'5のつく日' は false、annual 12/29 の店の 12/29 は企画名に関係なく true")`
  - `test("scoreEvent の結果は isAnniversary に関係なく同じ")` — 周年は加点しない（ユーザー決定）。`scoreEvent` の引数に周年の情報が無いことをこのテストで固定する
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: 変異で確かめる** — scratchpad に `collect/score.mjs` を複製し、(a) 欠測を0点として分母に含める (b) `samples < 5` の半減を外す (c) `lift` の下限を外す、の3つを1つずつ入れて、それぞれでテストが落ちることを確かめる。結果を報告に残す。本体は変えない
- [ ] **Step 6: コミット** — `git commit -m "feat: 店の統計と熱さの点数化を追加"`

---

### Task 7: データ検証

**Files:**
- Create: `validate-events.mjs`
- Modify: `scripts/validate-data.mjs`（新データの検証を追加。ファイルが無ければ飛ばして「未生成」と出す。`--dir=<パス>` で新データの読み込み元を変えられるようにする。既定は `data/`。店データ `stores.json` は常に `data/` から読む）
- Test: `test/validate-events.test.mjs`

**Interfaces:**
- Produces: `validateEventsData({ venues, mediaStrength, storeStats, months: Record<string, eventsFile> }) -> { errors: string[], warnings: string[] }`
- エラーにするもの: 日付が `YYYY-MM-DD` でない／月ファイルの `month` と違う月の日付／`venue` が `venues` に無い／`sources` が空、または URL が `http(s)://` でない／`checkedAt` の形式違い／`group` が `rated|unrated` 以外／`rated` なのに `points.media` が `null`／`missing` に入っている要素の `points` が `null` でない（または逆）／`score` が 0〜10 の範囲外／`id` の重複
- 警告にするもの: ホールナビ未対応の店の割合が5割を超える

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
  - `mergeMonth(previousFile | null, freshEvents, today, month) -> eventsFile` — `today` より前の日のイベントは前回のものをそのまま残して `frozen: true` にする。今回取れた過去日のイベントは捨てる。`today` 以降は今回のもので置き換える
  - `runCollect({ fetcher, today, readJson, writeJson, outDir, log }) -> Promise<{ ok: boolean, reasons: string[], counts }>` — 下の手順を行う。`fetcher` と `readJson`/`writeJson` を引数で受けるのはテストで差し替えるため
  - CLI: `node scripts/collect-events.mjs [--dry-run] [--today=YYYY-MM-DD]`。`--dry-run` は `_staging/collect/` に書き、`data/` に触れない

`runCollect` の手順:
1. DMM 予定一覧を1ページ目から `lastPage` まで取り、`today` から翌月末までのイベントだけを残して重複を除く。1件も取れなければ失敗
2. ホールナビ東京都の店舗一覧（`venues.json` の更新日が7日より古いときだけ全ページ）と、みんレポ東京都カテゴリの1〜10ページを取り、`buildVenues` で対応表を作る
3. `today` から7日以内に予定がある店（ホールナビ対応あり）の店舗ページを取る。`upcoming` の取材のうち `EXCLUDED_EVENT_PATTERNS` に当たらないものについて、`strength` を `media-strength.json` に入れる（名前で上書き。取得日を更新）。DMM の同じ店・同じ日の予定と、正規化した名前のどちらかがもう一方を含むとき、DMM の企画名を `aliases` に足す。DMM に無いホールナビだけの取材は、`hn:` の店でなく DMM 側の店のイベントとして足す
4. 同じ店舗ページの `pastEventMenu` で、7日以内の予定と名前が一致し `count >= 1` の取材だけ、店×取材のページを取って `eventHistory` に入れる
5. 予定がある店（みんレポ対応あり、`store-stats.json` の `baseline.checkedAt` が7日より古い）のみんレポ店舗ページを1ページ取り、基準・特定日の実効性（ルールは `stores.json` の店ならその `rules`、それ以外は `parseRuleText(ruleText)`）・イベント日の上振れ（`eventHistory` の日付）を計算する
6. 全イベントに `scoreEvent` をかける。`strength` はイベントの企画名を `media-strength.json` の `name` と `aliases` から引く。`anniversary` は `isAnniversary` で付ける
7. `mergeMonth` で当月と翌月のファイルを作り、`validateEventsData` に通す。エラーがあれば失敗
8. 失敗の判定: 1 で0件／7 でエラー／ホールナビ対応率が前回の `collect-meta.json` より 0.3 以上下がった。失敗なら何も書かずに `ok:false`
9. 成功なら `venues.json`・`media-strength.json`・`store-stats.json`・月ファイル・`collect-meta.json` を書く
- 店舗ページ・店×取材ページ・みんレポの取得失敗（`FetchError`）は、その店を欠測扱いにして続ける（`log` に1行出す）。DMM 一覧の `FetchError` は失敗にする

- [ ] **Step 1: 失敗するテストを書く**
  - `test("mergeMonth: today より前は前回のまま frozen、今回取れた過去日は捨てる")`
  - `test("mergeMonth: today 以降は今回のもので置き換え、前回だけにある未来のイベントは消える")`
  - `test("runCollect: DMM が0件なら ok:false で writeJson を呼ばない")` — `writeJson` の偽物は呼び出し引数を記録する
  - `test("runCollect: 店舗ページ1件が FetchError でも ok:true、その店のイベントは missing に crowd を持つ")` — Review Focus 3
  - `test("runCollect: DMM 一覧が FetchError なら ok:false")`
  - `test("runCollect: ホールナビ対応率が前回 0.8 から 0.4 に落ちたら ok:false")`
  - `test("runCollect: fetcher に渡した URL に同じものが2回無い")`
  - いずれも `fetcher` は URL ごとにフィクスチャを返す偽物（Task 2〜4 のフィクスチャを使う）
- [ ] **Step 2: 落ちることを確かめる** — Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Run: `node --test test/*.test.mjs` / Expected: 既存69件を含め全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 熱いイベントの収集本体を追加"`

---

### Task 9: 実データでのドライランと目視確認

**Files:**
- Create: `docs/熱いイベントのドライラン結果_20261030.md`（実行日で命名）

- [ ] **Step 1: ドライランを実行する** — Run: `node scripts/collect-events.mjs --dry-run`（実行時間は15〜20分を見込む。バックグラウンドで動かし、完了を待つ）/ Expected: 終了コード0、`_staging/collect/` に5種のファイル
- [ ] **Step 2: 数字を確かめる** — Run: `node scripts/validate-data.mjs --dir=_staging/collect` / Expected: errors 0。ほかに、イベント件数・`rated` と `unrated` の件数・ホールナビとみんレポの対応率・`unmatched` の件数を記録する
- [ ] **Step 3: 目視確認** — 上位20件と下位10件、`unrated` の上位10件を、出典ページを開いて照合する。確かめる点: 店と予定の取り違えがないこと／根拠の数字が出典と一致すること／`EXCLUDED_EVENT_PATTERNS` の予想が混ざっていないこと／周年バッジの誤検出がないこと。ホールナビ未対応の店から10件を選び、本当にホールナビに無いのか、表記揺れで取りこぼしているのかを確かめる
- [ ] **Step 4: 結果を文書にする** — Step 2・3 の数字と、見つかった問題・直したことを書く。**ホールナビ対応率が5割未満なら、ここでユーザーに報告して判断を仰ぐ**（設計書「店の突き合わせ」の取り決め）
- [ ] **Step 5: 問題があれば該当タスクの関数を直し、テストを足してから Step 1 からやり直す**
- [ ] **Step 6: コミット** — 文書と修正だけ。`_staging/` はコミットしない

---

### Task 10: ビューワ

**Files:**
- Create: `hot.mjs`
- Modify: `index.html`（タブとスタイル）、`app.js`（読み込みと描画）
- Test: `test/hot.test.mjs`

**Interfaces:**
- Consumes: `data/collect-meta.json`、`data/events/<month>.json`、`data/venues.json`、`data/store-stats.json`
- Produces:
  - `selectHotEvents(events, { today, days = 7, limit = 30, area = null }) -> { rated: Event[], unrated: Event[], total: number }` — `today` から `days` 日以内（`days` が `null` なら全件）、`area` で絞る。`rated` は `score` の高い順、同点は日付の早い順。`unrated` も同じ並び。`limit` は `rated` に掛ける
  - `staleness(lastSuccessAt, today) -> { days: number, stale: boolean }` — 35日を超えたら `stale`
  - `ruleEffectLabel(effect) -> string` — 例: `通常日比 +18枚（21日）`

- [ ] **Step 1: 失敗するテストを書く**
  - `test("selectHotEvents: 8日後の予定は days 7 で入らず、days null で入る")`
  - `test("selectHotEvents: limit 30 は rated にだけ掛かる")`
  - `test("selectHotEvents: unrated は rated に混ざらない")`
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
  - 1件のカード: 日付・店名・エリア・媒体・企画名・点数・周年バッジ・`evidence` の各行・`missing` があれば「データなし: 並び・過去の同取材…」・出典リンク・店の公式X（`venues` の `x`、無ければ `stores.json` の `sns.x`）
  - `unrated` は「強さ不明」の見出しの下に、点数を出さずに並べる
  - 注記: 既存の「推定・伝聞であり公式情報ではない」の文言をこのタブの冒頭にも置く
  - 既存の今日・明日・日付指定タブと店舗カードの特定日バッジの横に、`store-stats.json` に `ruleEffects` があれば `ruleEffectLabel` を添える。無ければ今の表示のまま
  - 新しいデータが読めない・壊れている場合は、このタブに「データ未生成」と出し、既存タブは今のまま動かす（既存の coverage の扱いと同じ）
- [ ] **Step 6: ブラウザで確かめる** — Task 9 の `_staging/collect/` のファイルを一時的に `data/` に置き（コミットしない）、`python3 -m http.server 8099` で開く。確かめる点: 熱いイベントが最初に開く／エリアで絞れる／もっと見るで全件になる／強さ不明が別枠／データなしの表示／既存5タブの表示が変わらない。スマホ幅（375px）でも確かめる。確認後に一時ファイルを消す
- [ ] **Step 7: コミット** — `git commit -m "feat: 熱いイベントタブと特定日の実効性表示を追加"`

---

### Task 11: 自動実行とドキュメント

**Files:**
- Create: `.github/workflows/collect.yml`, `docs/熱いイベントの自動更新.md`
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: `.github/workflows/collect.yml` を書く**
  - トリガー: `schedule` に `"0 0 1 * *"`（毎月1日 9:00 JST）と `"0 21 * * 0"`（毎週月曜 6:00 JST）、それと `workflow_dispatch`
  - `permissions: contents: write`、`concurrency: { group: collect, cancel-in-progress: false }`、`timeout-minutes: 60`
  - `env: TZ: Asia/Tokyo`
  - 手順: checkout → setup-node（24）→ `node --test test/*.test.mjs` → `node scripts/collect-events.mjs` → `node scripts/validate-data.mjs` → `data/` に差分があれば `git add data/` だけをしてコミット（`chore(data): 熱いイベントを自動更新 YYYY-MM-DD`、author は `github-actions[bot]`）して push。差分が無ければ何もしない
  - どの手順が失敗してもジョブを失敗させる（失敗通知メールで気づけるようにする）
- [ ] **Step 2: `docs/熱いイベントの自動更新.md` を書く** — いつ動くか／何を取るか（出典と取得間隔）／点数の式（Task 6 の表）／失敗したときの見方（Actions の画面・よくある原因: サイトの構造変更、遮断）／手で動かす方法（`gh workflow run collect.yml`）／止め方（ワークフローの無効化）
- [ ] **Step 3: README と CHANGELOG を更新する** — README は構成表に新ファイル・新データ、閲覧方法に新タブ、更新方法に自動更新を足す。テスト件数を実数に直す。CHANGELOG に日付の節を足す
- [ ] **Step 4: 全テストを通す** — Run: `node --test test/*.test.mjs` / Expected: 全件 PASS
- [ ] **Step 5: コミットして push し、手で1回動かす**

```bash
git add .github/workflows/collect.yml docs/熱いイベントの自動更新.md README.md CHANGELOG.md
git commit -m "feat: 熱いイベントの自動更新ワークフローを追加"
git push
gh workflow run collect.yml && gh run watch --exit-status
```

Expected: 成功し、`chore(data): …` のコミットが main に入る。数分後に公開ページ（https://ramdamain-commits.github.io/tokyo-pachi-guide/ ）で熱いイベントタブが出ることを確かめる
- [ ] **Step 6: probe ワークフローを消す** — 役目を終えたので `.github/workflows/probe.yml` を削除してコミット（`scripts/probe-sources.mjs` は障害時の切り分け用に残す）
