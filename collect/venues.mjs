// 店名・住所の正規化と、DMM・みんレポ・stores.json の突き合わせ。
// みんレポとは正規化店名の完全一致だけで対応付ける（あいまい一致はしない）。

/**
 * @typedef {{ name: string, address: string, municipality: string | null, area: string | null,
 *             storeId: string | null, dmmShopId: string, minrepoTag: string | null,
 *             x: string | null }} Venue
 */

/**
 * 店名を比較用にそろえる。NFKC・空白と記号（中黒 `・`、`.`、`-`、括弧）の除去・小文字化。
 * @param {string} s
 * @returns {string}
 */
export function normalizeName(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\s・･.\-()（）]/g, "")
    .toLowerCase();
}

const KANJI_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 漢数字（99まで）を算用数字にする。読めなければ null */
function kanjiToNumber(k) {
  if (k === "十") return 10;
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(k);
  if (m) return (m[1] ? KANJI_DIGIT[m[1]] : 1) * 10 + (m[2] ? KANJI_DIGIT[m[2]] : 0);
  if (k.length === 1 && KANJI_DIGIT[k]) return KANJI_DIGIT[k];
  return null;
}

/**
 * 住所を比較用にそろえる。
 * NFKC → 建物名（最初の空白以降）を落とす → `東京都` の除去 → 漢数字の丁目を算用数字に →
 * 「丁目」「番地」「番」「号」を `-` に → 連続・末尾の `-` を落とす。
 * @param {string} s
 * @returns {string}
 */
export function normalizeAddress(s) {
  let a = String(s ?? "").normalize("NFKC").trim();
  a = a.split(/\s+/)[0]; // 建物名（全角空白は NFKC で半角になっている）
  a = a.replace(/[\u2010-\u2015\u2212]/g, "-"); // ハイフン類
  a = a.replace(/^東京都/, "");
  a = a.replace(/([一二三四五六七八九十]+)丁目/g, (m, k) => {
    const n = kanjiToNumber(k);
    return n === null ? m : `${n}丁目`;
  });
  a = a.replace(/丁目|番地|番|号/g, "-");
  a = a.replace(/-{2,}/g, "-").replace(/-+$/, "");
  return a;
}

/**
 * `東京都` の直後の「…区|…市|…町|…村」（郡部は「…郡…町」まで）を返す。取れなければ null。
 * @param {string} address
 * @returns {string | null}
 */
export function municipality(address) {
  const a = String(address ?? "").normalize("NFKC").trim();
  const m = /^東京都((?:\S+?郡)?\S+?[区市町村])/.exec(a);
  return m ? m[1] : null;
}

/**
 * DMM の店ごとに venues を作り、みんレポのタグ・stores.json の店と対応付ける。
 * - みんレポ: 正規化店名の完全一致。一致が複数ならあいまいとして付けない
 * - previous の minrepoTag は、今回の一致が無ければそのまま残す
 * - stores.json: 正規化住所の一致（同じ住所に複数の店があるときは正規化店名も一致した店だけ）
 * @param {{ dmmEvents: import("./dmm.mjs").DmmEvent[], minrepoTags: string[],
 *           stores: Array<{ id: string, area: string, address: string, sns?: { x?: string | null } | null }>,
 *           previous?: Record<string, { minrepoTag?: string | null }> }} args
 * @returns {{ venues: Record<string, Venue>, unmatchedMinrepo: string[] }}
 */
export function buildVenues({ dmmEvents, minrepoTags, stores, previous = {} }) {
  /** @type {Map<string, string[]>} 正規化名 → タグ（重複タグは1つにまとめる） */
  const tagsByName = new Map();
  for (const tag of minrepoTags) {
    const key = normalizeName(tag);
    if (!key) continue;
    const list = tagsByName.get(key) ?? [];
    if (!list.includes(tag)) list.push(tag);
    tagsByName.set(key, list);
  }

  /** @type {Map<string, Array<(typeof stores)[number]>>} 正規化住所 → 店（同じ建物に複数ありうる） */
  const storesByAddress = new Map();
  for (const st of stores) {
    const key = normalizeAddress(st.address);
    if (!key) continue;
    const list = storesByAddress.get(key) ?? [];
    list.push(st);
    storesByAddress.set(key, list);
  }

  /** @type {Record<string, Venue>} */
  const venues = {};
  /** @type {string[]} */
  const unmatchedMinrepo = [];

  for (const e of dmmEvents) {
    const key = `dmm:${e.dmmShopId}`;
    if (venues[key]) continue; // 同じ店は最初の1件で作る

    const candidates = tagsByName.get(normalizeName(e.shopName)) ?? [];
    let minrepoTag = candidates.length === 1 ? candidates[0] : null;
    if (minrepoTag === null) minrepoTag = previous[key]?.minrepoTag ?? null;
    if (minrepoTag === null) unmatchedMinrepo.push(e.shopName);

    // 住所が一致する店が複数あるときは、正規化店名が一致する店だけを採る（無ければ付けない）
    const sameAddress = storesByAddress.get(normalizeAddress(e.address)) ?? [];
    const store =
      sameAddress.length === 1
        ? sameAddress[0]
        : (sameAddress.find((st) => normalizeName(st.name) === normalizeName(e.shopName)) ?? null);
    const muni = municipality(e.address);
    venues[key] = {
      name: e.shopName,
      address: e.address,
      municipality: muni,
      area: store ? store.area : muni,
      storeId: store ? store.id : null,
      dmmShopId: e.dmmShopId,
      minrepoTag,
      x: store?.sns?.x ?? null,
    };
  }

  return { venues, unmatchedMinrepo };
}
