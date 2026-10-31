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
 * 1件分の `<li class="unit …>` を取り出す。取り出せなければ null。
 * @param {string} li
 * @returns {DmmEvent | null}
 */
function parseUnit(li) {
  // href は引用符なしのことがある（href=/shops/tokyo/102）
  const shop = /href=["']?\/shops\/tokyo\/(\d+)/.exec(li);
  const name = /<p class="title[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(li);
  const addr = /<p class="lead[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(li);
  const date = /<p class="date[^"]*"[^>]*>[^<]*?(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(li);
  if (!shop || !name || !date) return null;

  const right = /<div class="right"[^>]*>([\s\S]*?)<\/div>/.exec(li);
  const icons = [];
  if (right) {
    for (const m of right[1].matchAll(/<span class="text-icon"[^>]*>([\s\S]*?)<\/span>/g)) {
      const t = text(m[1]);
      if (t) icons.push(t);
    }
  }
  if (icons.length === 0) return null; // 企画名が取れないものは対象外

  // 1つなら媒体なしでそれを企画名にする。2つ以上なら 媒体・企画名 の順
  const media = icons.length >= 2 ? icons[0] : null;
  const title = icons.length >= 2 ? icons[1] : icons[0];

  return {
    dmmShopId: shop[1],
    shopName: text(name[1]),
    address: addr ? text(addr[1]) : "",
    date: `${date[1]}-${String(date[2]).padStart(2, "0")}-${String(date[3]).padStart(2, "0")}`,
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
