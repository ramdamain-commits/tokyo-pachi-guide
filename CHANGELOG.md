# CHANGELOG

## 2026-11-01

みんレポの自動収集を外し、DMM の予定一覧で公開する形に切り替え（ブランチ `feat/hot-events`）。みんレポが日別レポート・店ページの前に JS のボット確認を入れて自動取得できなくなり、これを再現するのは回避にあたるため行わない（ユーザー決定）。

### 変更
- `scripts/collect-events.mjs` — `runCollect` に `useMinrepo`（既定 `false`）を追加。CLI は `--with-minrepo` のときだけ `true`。`false` のときはみんレポ（カテゴリ・直接引き・店ページ）に一切アクセスせず、`minrepoTag`・`minrepoCheckedAt`・`store-stats.json` は前回のまま、`rates.minrepoMatched` は `null`（対応率の急落判定もしない）。`collect-meta.json` に `sources`（`["dmm"]`、`useMinrepo` なら `["dmm", "minrepo"]`）を書く
- `validate-events.mjs` — `validateEventsData` が任意の `meta` を受け取り、`sources`（`dmm`・`minrepo` の文字列配列）と `rates.minrepoMatched`（`null` か 0〜1）を検証。`sources` に `minrepo` が無いときは「みんレポ未対応の店が多い」警告を出さない
- 「熱いイベント」タブを「近日のイベント」に改名（最初に開くタブのまま）。`collect-meta.json` の `sources` に `minrepo` が無いときは、今日から7日の予定を日付順（同日は同じ店の同日の予定数が多い店→店名順）に既定30件・「もっと見る」で全件。「強さ不明」の見出し・「データなし」・点数の案内は出さず、熱さの点数が停止中である注記を足す。`sources` に `minrepo` があれば従来の表示。`hot.mjs` / `app.js` / `index.html`
- `docs/熱いイベントの自動更新.md`・`README.md` — 現状（点数停止中・みんレポを回避しない理由・`--with-minrepo` は再開用）を反映。テスト件数を実数（263件）に更新

### 追加
- 予定カードに DMM の取材実績（直近1年）を参考表示（ブランチ `feat/dmm-reports`・ユーザー決定「参考表示にとどめる」）。「DMM取材実績（直近1年）: N回・直近 YYYY-MM-DD「取材名」」（0回は「なし」）と「DMMの来店レポート」リンクを各予定に出す。DMM の来店レポート（`shop_reports?prefecture=13`）は DMM 自身の取材班の企画だけで、本文に数値があるのは一部のため、点数・並び順には使わない
  - `collect/dmm.mjs` — `parseDmmReportsPage`・`dmmReportsUrl`（予定一覧と共通の部分は `readCommon`・`splitIcons` に切り出し。`parseDmmSchedulePage` の挙動は変えない）
  - `scripts/collect-events.mjs` — 予定の取得後に来店レポートを集めて `data/dmm-reports.json` を作る。初回は 365 日前より古い実施日のページまで（上限 100 ページ）、以後は既知の `reportId` だけのページまで（上限 10 ページ）。365 日より古いものは捨てる。住所の正規化一致で `venue` を付け、付かなければ `null`（venues は増やさない）。一覧の取得失敗・検証エラーでも全体は失敗にせず、その回は前回のファイルのまま
  - `validate-events.mjs` / `scripts/validate-data.mjs` — `dmm-reports.json` があれば `reportId` 重複・日付・`venue` を検証（無ければ飛ばす）
  - `hot.mjs` / `app.js` — `reportSummary`（直近365日・店の一致。365日前の当日を含む）・取材実績の1行・リンク。`dmm-reports.json` が読めなければ行とリンクを出さない
  - `docs/熱いイベントの自動更新.md`・`README.md` — 取材実績の範囲（DMM 自身の企画だけ・点数に使わない）と取得の範囲を追記
- 各予定に「みんレポで見る」リンク（店のタグページ。タグが無い店は店名のサイト内検索）。`hot.mjs` に `selectUpcomingEvents`・`usesMinrepo`・`minrepoLink`・`minrepoTagUrl`

## 2026-10-31

熱いイベント一覧と自動収集（ブランチ `feat/hot-events`）。設計書: `docs/superpowers/specs/2026-10-30-hot-events-design.md`、実装計画: `docs/superpowers/plans/2026-10-30-hot-events.md`

### 追加
- 「熱いイベント」タブ（最初に開くタブ）— 今日以降の東京都の来店・取材・周年イベントを熱さの点数順に表示。既定は今日から7日・上位30件、「もっと見る」で全件。点数の根拠の数字、データのない要素の「データなし」、強さを測れない予定の「強さ不明」の枠、周年バッジ、最終更新日と古さ（35日超）の警告を表示。特定日（○のつく日）の実効性を測れた店には通常日比の差枚を添える。`hot.mjs` / `app.js` / `index.html`
- `collect/` — 収集の部品（取得・DMM と みんレポの解析・日付補完・文言の変換・店の突き合わせ・統計・熱さの点数・月ファイルの更新）
- `scripts/collect-events.mjs` — 収集の本体。DMMぱちタウンの東京都の予定を取り、みんレポの日別実績（平均G・平均差枚）と突き合わせて、`data/venues.json`・`store-stats.json`・`media-strength.json`・`events/YYYY-MM.json`・`collect-meta.json` を作る。過去日のイベントは凍結して結果を一度だけ書き込む。失敗時は `data/` を書き換えず終了コード1。みんレポのカテゴリ一覧に出ない店は店名から店ページを直接引く。取得した店ページの8割超が空なら「構造変更の可能性」を警告
- `validate-events.mjs` / `scripts/validate-data.mjs` — 新データの検証（欠測を0で埋めていないか・日付の範囲・出典URLなど）
- `scripts/run-collect.ps1` / `scripts/register-collect-task.ps1` / `scripts/commit-message.txt` — PC のタスクスケジューラでの定期実行（毎週月曜 6:00・毎月1日 9:00・ログオン時の取りこぼし分）。main 以外・未コミットの変更ありなら何もせず終了コード2。テスト・収集・検証が通ったときだけ `data/` をコミットして main へ push
- `docs/熱いイベントの自動更新.md` — 定期実行の説明（動く時刻・取得元と間隔・点数の式・既知の制約・失敗時の見方・止め方）
- `scripts/probe-sources.mjs` — 取得元に届くかの切り分け用

### 変更
- `README.md` — 構成・閲覧方法（6タブ）・更新方法に熱いイベントを追加。テスト件数を実数（240件）に更新
- `.gitignore` — `logs/` を追加

### 削除
- `.github/workflows/probe.yml` — 到達確認用の Actions を削除

### 取得元の判断
- ホールナビは使わない — 収集用の User-Agent に 403 を返す（自動収集の拒否）。User-Agent を偽装した回避はしない。そのため熱さの点数は DMM とみんレポだけで組み、並び人数の代わりにみんレポの平均G（稼働）を使う
- GitHub Actions は使わない — Actions の実行環境からは DMM が 403 を返した（家庭回線からは 200）。回避せず PC で動かす
- 周年は加点しない（バッジ表示のみ）

### 既知の制約
- 2026-10-31 の実データ確認で、みんレポが収集に表の無い空ページしか返さなかった（167ページ中166ページ）。2026-11-01 の再確認で JS のボット確認の導入が分かったため、回避はせず、みんレポの自動収集を外した（上の 2026-11-01 の節）

## 2026-08-01

v3拡張 Phase 2②（既存21店の抽選方式・出典再確認）＋ Phase 3（ビューワー配線）。設計書: `docs/superpowers/specs/2026-07-31-v3-expansion-design.md`

### 変更（Phase 2②）
- `data/stores.json` — Phase1で要確認扱いだった既存21店（上野・秋葉原・新宿・渋谷・池袋・新橋・下北沢）をみんパチ店舗ページで再訪問し `lottery.type`／`random`／`tool` を確定。パチンコ/スロットで方式が異なると判明した7店は `lottery.pachinko`／`lottery.slot` サブオブジェクトへ分割（例: ビッグアップル秋葉原=パチンコ並び順/スロットのみモバイル抽選）。出典で確認できなかった項目はnullのまま維持し理由をmemoに記録（AI推測補完の禁止を継続適用）。ミナミ10号店（2017年閉店）は一次情報が現存せず確認不能と結論
- `scripts/migrate-lottery.mjs` — 要確認リスト生成ロジックのバグ修正。従来はmethod自由文をキーワード再解析していたため、pachinko/slotサブオブジェクトで既に解決済みの店でも「パチ/スロ差分疑い」等が機械的に残っていた。現在の構造化フィールド（pachinko/slot含む）が実際にnullかどうかで判定するよう変更し、要確認21→7店（+他エリアの既存未解決5店）に減少

### 収集メモ（Phase 2②）
- researcher 3並列worktree分離で実行したところ、`_staging/` がgitignore対象のため完了直後にworktreeが自動クリーンアップされ、書き込み済みファイルが3班とも消失。SendMessageでエージェントを再開し全文をテキスト応答として再送させて復旧（次回以降、researcherの`_staging`直書きタスクはworktree分離を使わない）

### 追加（Phase 3・ビューワー配線）
- `docs/示唆・イベントの確認手順.md` — SNS示唆・周年・混雑傾向の確認手順とリンク集

### 変更（Phase 3・ビューワー配線）
- `app.js` — `AREA_ORDER` に新8エリア（中野・吉祥寺・立川・町田・蒲田・錦糸町・北千住・赤羽）を追加。Phase1で `data/stores.json` に追加した48店（全83店の58%）が全タブから欠落していた不具合を修正
- `app.js` / `index.html` — エリア別一覧カードに抽選バッジ（パチ/スロ差分は両方併記）・SNSリンク・混雑参考（crowd、現状データ0件）を追加。周年ルール（`annual`+`label`）は既存の `ruleBadges`/`ruleLabel` がそのまま処理するためコード変更なしで表示された
- `README.md` — 店舗数・エリア数を83店/16エリアへ更新（Phase1時点で更新漏れ）

## 2026-07-31

v3拡張の Phase 1（データ基盤整備）。設計書: `docs/superpowers/specs/2026-07-31-v3-expansion-design.md`、実装計画: `docs/superpowers/plans/2026-07-31-v3-phase1-schema.md`

### 追加
- `lottery.mjs` — 抽選方式の派生ロジック（`method` の文言から `type`／`random`／`tool` を導出。判別できない項目は `null` のまま残す）、パチ/スロ差分の解決（`lottery.pachinko`／`lottery.slot` のサブオブジェクト上書き）、バッジ用ラベル生成
- `validate.mjs` + `scripts/validate-data.mjs` — `stores.json` のスキーマ検証（lottery・sns・crowd・annual+label）。「未確認（null）・キー欠損は正常、値が入っていて型が不正ならエラー」の方針
- `scripts/migrate-lottery.mjs` — 既存店の lottery へ派生値を付与し、要確認リスト（`_staging/lottery-review.md`）を出力する冪等スクリプト
- `docs/収集手順_v3.md` — v3 データ収集手順（ソース序列・1パス収集項目・禁止事項・要確認スイープの読み方）

### 変更
- `data/stores.json` — 既存35店の `lottery` に `type`／`random`／`tool` を追加（追加のみ・既存値の変更なし）。出典の文言から確定できたのは14店、残る21店は判別できない項目を `null` で保持し要確認扱い。出典の再確認は行っていないため `updated` は据え置き
- `index.html` — フッターに残っていた「非公開ローカルツール（GitHub非掲載）」を公開後の実態に合わせて修正（2026-07-17 の公開化時の更新漏れ）

## 2026-07-20

- 下北沢エリアを追加（カレイド下北沢店＋閉店2店＝ミナミ本店・ミナミ10号店）。全35店・8エリア体制に
- 取材系強化:
  - `data/coverage.json` 新設 — 店舗×媒体の取材実績35件（高19/中4/低12）。集約サイト当たり付け→媒体公式ページ裏取りの相互検証で収集し、DMMぱちタウン・スロパチステーション等の静的HTML機械抽出で日付を確定
  - `data/media.json` を7→17媒体へ拡充（マグロ取材・でちゃう!PLUS・オフミー・一撃・スクープTV等）。全媒体に公式スケジュールURL（`scheduleUrl`）を追加
  - `coverage.mjs` 新設 — 参照整合検証＋結合ロジック（テスト5件追加、全23件pass）
  - ビューワ: 店舗カードに取材実績バッジ、媒体カードに実績店一覧＋公式スケジュールリンクを追加。coverage.json 欠損時は従来表示のまま動作
  - `docs/取材予定の確認手順.md` 新設 — 取材予定はデータで持たず巡回手順＋リンク集で対応
- 残課題（次回棚卸し時）: JS描画でcurl抽出不可の媒体（ジャンバリ・ARROWS SCREEN等10媒体）と一部店舗の突合が未了。新規媒体候補（REAL取材/スロミューセレクト等）の裏取り未実施。詳細は `_staging` 検収記録のコミット履歴と coverage.json の note を参照

## 2026-07-17

- 公開方針を変更: 非公開（ローカルgitのみ）→ **GitHub公開リポジトリ＋GitHub Pages＋portal掲載**（本人判断・当初READMEの「非公開」記述を上書き）
  - 公開前チェック: tracked ファイルに個人情報（居住エリア・実名等）が含まれないことを grep で確認。掲載データは店舗の公開情報・第三者サイトの過去傾向推定のみ
  - README・設計書の「非公開」記述を更新。公開ビューワ URL を README へ追記

## 2026-07-16（追記）

- 「取材傾向」機能を追加: `data/media.json`（取材媒体7件・傾向/対象ジャンル/確度/出典）を researcher 収集で新規作成し、ビューワに5番目のタブとして追加（`index.html`/`app.js`）
  - 断定的な設定示唆表現は避け「〜と言われる」等の伝聞形式に統一。店舗単位ではなく媒体単位の一般的傾向として扱う
  - ブラウザ実表示で7件全件・既存タブへの影響なしを確認済み

## 2026-07-16

- プロジェクト新設。設計書（`docs/superpowers/specs/2026-07-16-tokyo-pachi-guide-design.md`）・README を作成
- 方針確定: 対象7エリア／スコープは旧イベ日パターン＋店概要のみ（取材イベはv2送り）／ローカルgitのみで非公開
- reviewer レビュー指摘10件（critical4/should4/suggestion2）＋アナスロ照合の担当矛盾1件を設計書へ反映
- データ収集（第1弾）: `data/stores.json` を新規生成（全32店）。7エリア内訳＝上野4／秋葉原5／新宿6／渋谷4／池袋8／新橋3／京橋銀座2
  - researcher 2並列で上野+秋葉原・新宿+渋谷を収集（各店みんパチ詳細＋すろざんまい一次抽出パターン）。3体目（池袋+新橋+京橋銀座）はセッション上限で中断
  - 池袋+新橋+京橋銀座はメイン側で manmai 生HTMLを直接抽出し特定日パターンを確定（詳細フィールドはみんパチ未取得のため null、次セッションで補完）
  - すろざんまい×みんパチのパターン食い違い店は各 memo に明記
  - 特記: エスパス日拓渋谷本館は2026-03-31閉店（`closed` フィールド付与・過去データとして保持）
- データ収集（第2弾・同日）: ③池袋+新橋+京橋銀座の13店を researcher 再投入でみんパチ詳細補完（住所・台数・抽選・換金率・営業時間）→ **全32店の詳細フィールドが揃い null 解消**
  - ③食い違い3件を memo 明記: マルハン池袋SLOT BASE（すろ2の付く日 vs みんパチ7のつく日）／プレゴEX（みんパチに毎月11日なし）／甲子園池袋（みんパチに毎月15日明記なし）
  - tie-breaker 調査結果: **アナスロ(ana-slo.com)は Playwright でも全ドメイン403(WAF)、DMMぱちタウンは旧イベ日パターン非掲載**（あるのはアクセス集中日=データ由来の混雑ランキングのみ）＝特定日パターンの相互検証ソースが入手不能。設計どおりすろざんまいを第1ソースとして確定し、みんパチ差分は memo 記録で担保。パターン再検証は次に有効ソースが見つかった時点で実施
  - 全32店の整合検証済み（rules空/ID重複なし・型/曜日/monthday妥当・全レコードに出典URL+checkedAt）
- ビューワ実装完了: `match.mjs`（日付マッチングロジック、rules[].type 全7種対応）・`test/match.test.mjs`（`node --test` で境界ケース網羅、全18件pass）・`index.html`/`app.js`（今日/明日/日付指定/エリア別一覧の4タブ、ダークテーマ、閉店店は今日系タブ除外・一覧タブで閉店バッジ表示、専門店注記、固定注記ヘッダー）を新規作成。README を実装完了の実態に合わせて更新
