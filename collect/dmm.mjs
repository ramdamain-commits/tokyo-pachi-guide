// DMMぱちタウンの予定一覧ページ（schedules/tokyo?page=N）の解析。正規表現と文字列処理だけで行う。

/**
 * @typedef {{ dmmShopId: string, shopName: string, address: string, date: string,
 *             media: string | null, title: string }} DmmEvent
 */

/** タグを除いて前後の空白を落とす（HTML エンティティの最小限の解除つき） */
function text(s) {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

/**
 * 予定・来店レポートの `<li class="unit …>` に共通の項目（店名・住所・実施日・span.text-icon）を読む。
 * 店名か実施日が無ければ null。icons は媒体名・企画名の順。
 * @param {string} li
 * @returns {{ shopName: string, address: string, date: string, icons: string[] } | null}
 */
function readCommon(li) {
  const name = /<p class="title[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(li);
  const addr = /<p class="lead[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(li);
  const date = /<p class="date[^"]*"[^>]*>[^<]*?(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(li);
  if (!name || !date) return null;

  const right = /<div class="right"[^>]*>([\s\S]*?)<\/div>/.exec(li);
  const icons = [];
  if (right) {
    for (const m of right[1].matchAll(/<span class="text-icon"[^>]*>([\s\S]*?)<\/span>/g)) {
      const t = text(m[1]);
      if (t) icons.push(t);
    }
  }
  return {
    shopName: text(name[1]),
    address: addr ? text(addr[1]) : "",
    date: `${date[1]}-${String(date[2]).padStart(2, "0")}-${String(date[3]).padStart(2, "0")}`,
    icons,
  };
}

/** 1つなら媒体なしでそれを企画名にする。2つ以上なら 媒体・企画名 の順 */
function splitIcons(icons) {
  return icons.length >= 2 ? { media: icons[0], title: icons[1] } : { media: null, title: icons[0] };
}

/**
 * 1件分の `<li class="unit …>` を取り出す。取り出せなければ null。
 * @param {string} li
 * @returns {DmmEvent | null}
 */
function parseUnit(li) {
  // href は引用符なしのことがある（href=/shops/tokyo/102）
  const shop = /href=["']?\/shops\/tokyo\/(\d+)/.exec(li);
  const common = readCommon(li);
  if (!shop || !common) return null;
  if (common.icons.length === 0) return null; // 企画名が取れないものは対象外

  const { media, title } = splitIcons(common.icons);
  return {
    dmmShopId: shop[1],
    shopName: common.shopName,
    address: common.address,
    date: common.date,
    media,
    title,
  };
}

/**
 * 予定一覧の1ページを解析する。
 * lastPage は `schedules/tokyo?page=N` のリンクの最大値（リンクが無ければ null）。
 * @param {string} html
 * @returns {{ events: DmmEvent[], lastPage: number | null }}
 */
export function parseDmmSchedulePage(html) {
  const events = [];
  const chunks = html.split(/<li class="unit\b/).slice(1);
  for (const chunk of chunks) {
    const li = chunk.split("</li>")[0];
    const ev = parseUnit(li);
    if (ev) events.push(ev);
  }

  let lastPage = null;
  for (const m of html.matchAll(/schedules\/tokyo\?page=(\d+)/g)) {
    const n = Number(m[1]);
    if (lastPage === null || n > lastPage) lastPage = n;
  }
  return { events, lastPage };
}

/**
 * 同じ店・日・媒体・企画の重複を除く（キーは dmmShopId|date|media|title。最初の1件を残す）。
 * @param {DmmEvent[]} events
 * @returns {DmmEvent[]}
 */
export function dedupeDmmEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = [e.dmmShopId, e.date, e.media ?? "", e.title].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// ---- 来店イベントレポート一覧（shop_reports?prefecture=13） ----

/**
 * @typedef {{ reportId: string, shopName: string, address: string, date: string,
 *             media: string | null, title: string }} DmmReport
 */

/** 来店レポート一覧（東京都）の URL。1ページ目は page を付けない */
export function dmmReportsUrl(page) {
  const base = "https://p-town.dmm.com/shop_reports?prefecture=13";
  return page <= 1 ? base : `${base}&page=${page}`;
}

/**
 * 来店レポート1件分の `<li class="unit …>` を取り出す。取り出せなければ null。
 * 取材名は span.text-icon（予定と同じ規則）から読み、無ければ画像 alt の「…の来店イベントレポート「<取材名>」」から読む。
 * @param {string} li
 * @returns {DmmReport | null}
 */
function parseReportUnit(li) {
  // リンクは href=/shop_reports/<レポートID>（店舗IDは無い）。引用符なしのことがある
  const id = /href=["']?\/shop_reports\/(\d+)/.exec(li);
  const common = readCommon(li);
  if (!id || !common) return null;

  let media = null;
  let title;
  if (common.icons.length > 0) {
    ({ media, title } = splitIcons(common.icons));
  } else {
    const alt = /alt="[^"]*来店イベントレポート「([^」]+)」/.exec(li);
    if (!alt) return null; // 取材名が取れないものは対象外
    title = text(alt[1]);
  }
  return { reportId: id[1], shopName: common.shopName, address: common.address, date: common.date, media, title };
}

/**
 * 来店レポート一覧の1ページを解析する。
 * lastPage は `shop_reports?…page=N` のリンクの最大値（リンクが無ければ null）。
 * @param {string} html
 * @returns {{ reports: DmmReport[], lastPage: number | null }}
 */
export function parseDmmReportsPage(html) {
  const reports = [];
  const chunks = html.split(/<li class="unit\b/).slice(1);
  for (const chunk of chunks) {
    const li = chunk.split("</li>")[0];
    const r = parseReportUnit(li);
    if (r) reports.push(r);
  }

  let lastPage = null;
  for (const m of html.matchAll(/shop_reports\?[^"'\s>]*?page=(\d+)/g)) {
    const n = Number(m[1]);
    if (lastPage === null || n > lastPage) lastPage = n;
  }
  return { reports, lastPage };
}
