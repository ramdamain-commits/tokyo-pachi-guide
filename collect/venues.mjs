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
 * 「武蔵村山市」「東村山市」のように市名に「村」を含むため、区・市 → 郡つきの町村 → 町村 の順に探す。
 * @param {string} address
 * @returns {string | null}
 */
export function municipality(address) {
  const a = String(address ?? "").normalize("NFKC").trim();
  const m = /^東京都(?:([^\s郡]+?[区市])|(\S+?郡\S+?[町村])|(\S+?[町村]))/.exec(a);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * 同じ正規化住所の stores.json の店の中から、DMM の店名に対応する店を選ぶ。
 * 候補が1件ならそれ。複数なら (a) 正規化名の完全一致 → (b) 一方がもう一方の先頭と一致 を、
 * それぞれ1件だけ見つかったときに採る。決まらないときは store=null で、候補の area がすべて同じならその値を返す。
 * @param {Array<{ name: string, area: string }>} sameAddress
 * @param {string} shopName
 * @returns {{ store: (typeof sameAddress)[number] | null, area: string | null }}
 */
function matchStore(sameAddress, shopName) {
  if (sameAddress.length === 0) return { store: null, area: null };
  let store = null;
  if (sameAddress.length === 1) {
    store = sameAddress[0];
  } else {
    const n = normalizeName(shopName);
    const exact = sameAddress.filter((st) => normalizeName(st.name) === n);
    if (exact.length === 1) {
      store = exact[0];
    } else if (exact.length === 0) {
      const part = sameAddress.filter((st) => {
        const sn = normalizeName(st.name);
        return n !== "" && (sn.startsWith(n) || n.startsWith(sn));
      });
      if (part.length === 1) store = part[0];
    }
  }
  if (store) return { store, area: store.area };
  const areas = new Set(sameAddress.map((st) => st.area));
  return { store: null, area: areas.size === 1 ? [...areas][0] : null };
}

/**
 * DMM の店ごとに venues を作り、みんレポのタグ・stores.json の店と対応付ける。
 * - みんレポ: 正規化店名の完全一致。一致が複数ならあいまいとして付けない
 * - previous の店は今回の DMM に現れなくてもすべて引き継ぐ（過去日の凍結イベントが店キーを参照し続けるため）。
 *   今回の DMM に現れた店は今回の情報で作り直し、minrepoTag は「今回の一致 → 無ければ previous の値」
 * - stores.json: 正規化住所の一致。同じ住所に複数の店があるときは
 *   (a) 正規化名の完全一致が1件ならそれ、(b) 無ければ一方の正規化名がもう一方の先頭と一致する店が1件だけならそれ、
 *   (c) 決まらなければ storeId・x は付けない（候補の area がすべて同じなら area はその値）
 * @param {{ dmmEvents: import("./dmm.mjs").DmmEvent[], minrepoTags: string[],
 *           stores: Array<{ id: string, name: string, area: string, address: string, sns?: { x?: string | null } | null }>,
 *           previous?: Record<string, any> }} args
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

  /** @type {Record<string, Venue>} previous の店を先に引き継ぎ、今回の DMM の店で上書きする */
  const venues = {};
  for (const [k, v] of Object.entries(previous)) venues[k] = { ...v };
  /** @type {Set<string>} 今回の DMM で作った店 */
  const built = new Set();
  /** @type {string[]} */
  const unmatchedMinrepo = [];

  for (const e of dmmEvents) {
    const key = `dmm:${e.dmmShopId}`;
    if (built.has(key)) continue; // 同じ店は最初の1件で作る
    built.add(key);

    const candidates = tagsByName.get(normalizeName(e.shopName)) ?? [];
    let minrepoTag = candidates.length === 1 ? candidates[0] : null;
    if (minrepoTag === null) minrepoTag = previous[key]?.minrepoTag ?? null;
    if (minrepoTag === null) unmatchedMinrepo.push(e.shopName);

    const { store, area: storeArea } = matchStore(storesByAddress.get(normalizeAddress(e.address)) ?? [], e.shopName);
    const muni = municipality(e.address);
    venues[key] = {
      name: e.shopName,
      address: e.address,
      municipality: muni,
      area: storeArea ?? muni,
      storeId: store ? store.id : null,
      dmmShopId: e.dmmShopId,
      minrepoTag,
      x: store?.sns?.x ?? null,
    };
  }

  return { venues, unmatchedMinrepo };
}
