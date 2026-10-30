import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, normalizeAddress, municipality, buildVenues } from "../collect/venues.mjs";

/** DMM の予定1件（店の突き合わせに使う項目だけ） */
function ev(dmmShopId, shopName, address) {
  return { dmmShopId, shopName, address, date: "2026-11-07", media: null, title: "企画" };
}

const STORES = [
  {
    id: "espace-ueno-shinkan",
    name: "エスパス日拓上野新館",
    area: "上野",
    address: "東京都台東区上野4-7-5 日拓上野アメ横ビル",
    sns: { x: "https://x.com/espace_ueno", line: null, instagram: null },
  },
  { id: "no-sns", name: "SNSなし店", area: "新宿", address: "東京都新宿区西新宿1-19-1", sns: null },
];

test("normalizeAddress: '東京都町田市原町田6丁目13番21号' と '東京都町田市原町田6-13-21' が一致", () => {
  assert.equal(
    normalizeAddress("東京都町田市原町田6丁目13番21号"),
    normalizeAddress("東京都町田市原町田6-13-21"),
  );
  assert.equal(normalizeAddress("東京都町田市原町田6丁目13番21号"), "町田市原町田6-13-21");
});

test("normalizeAddress: 漢数字の丁目・番地・全角数字も揃える", () => {
  assert.equal(normalizeAddress("東京都新宿区西新宿六丁目5番1号"), "新宿区西新宿6-5-1");
  assert.equal(normalizeAddress("東京都渋谷区道玄坂十二丁目３番地"), "渋谷区道玄坂12-3");
  assert.equal(normalizeAddress("東京都新宿区西新宿１－１９－１"), "新宿区西新宿1-19-1");
});

test("normalizeAddress: '東京都台東区上野4-7-5　日拓上野アメ横ビル' の建物名を落とす", () => {
  assert.equal(normalizeAddress("東京都台東区上野4-7-5　日拓上野アメ横ビル"), "台東区上野4-7-5");
  assert.equal(
    normalizeAddress("東京都台東区上野4-7-5　日拓上野アメ横ビル"),
    normalizeAddress("東京都台東区上野4-7-5 日拓上野アメ横ビル"),
  );
});

test("normalizeName: 'エクス・アリーナ東京' と 'エクス・アリーナ 東京' が一致", () => {
  assert.equal(normalizeName("エクス・アリーナ東京"), normalizeName("エクス・アリーナ 東京"));
});

test("normalizeName: 全角英数・括弧・大文字小文字をそろえる", () => {
  assert.equal(normalizeName("ＭＧＭ国領店"), "mgm国領店");
  assert.equal(normalizeName("清瀬UNO"), normalizeName("清瀬uno"));
  assert.equal(normalizeName("店A（本館）.-"), "店a本館");
});

test("municipality: 区・市・郡部の町村を取り出す", () => {
  assert.equal(municipality("東京都台東区上野4-7-5"), "台東区");
  assert.equal(municipality("東京都町田市原町田6-13-21"), "町田市");
  assert.equal(municipality("東京都西多摩郡瑞穂町箱根ケ崎1"), "西多摩郡瑞穂町");
  assert.equal(municipality("東京都檜原村1"), "檜原村");
  assert.equal(municipality("神奈川県横浜市1-1"), null);
});

test("buildVenues: 正規化店名が一致するみんレポのタグを付ける", () => {
  const { venues } = buildVenues({
    dmmEvents: [ev("1", "MGM国領店", "東京都調布市国領町3-1"), ev("1", "MGM国領店", "東京都調布市国領町3-1")],
    minrepoTags: ["mgm国領店", "別の店"],
    stores: [],
    previous: {},
  });
  assert.deepEqual(Object.keys(venues), ["dmm:1"]);
  assert.equal(venues["dmm:1"].minrepoTag, "mgm国領店");
  assert.equal(venues["dmm:1"].name, "MGM国領店");
  assert.equal(venues["dmm:1"].dmmShopId, "1");
  assert.equal(venues["dmm:1"].municipality, "調布市");
});

test("buildVenues: 'ガイア瑞江店' に 'ガイア瑞江ⅱ' を付けない（完全一致のみ）", () => {
  const { venues, unmatchedMinrepo } = buildVenues({
    dmmEvents: [ev("2", "ガイア瑞江店", "東京都江戸川区東瑞江1-1-1")],
    minrepoTags: ["ガイア瑞江ⅱ", "ガイア瑞江"],
    stores: [],
    previous: {},
  });
  assert.equal(venues["dmm:2"].minrepoTag, null);
  assert.deepEqual(unmatchedMinrepo, ["ガイア瑞江店"]);
});

test("buildVenues: 正規化名が一致するタグが複数あるときは付けず unmatchedMinrepo に入れる", () => {
  const { venues, unmatchedMinrepo } = buildVenues({
    dmmEvents: [ev("3", "清瀬UNO", "東京都清瀬市元町1-1")],
    minrepoTags: ["清瀬uno", "清瀬 uno"],
    stores: [],
    previous: {},
  });
  assert.equal(venues["dmm:3"].minrepoTag, null);
  assert.deepEqual(unmatchedMinrepo, ["清瀬UNO"]);
});

test("buildVenues: 対応の無い店は venues に残り unmatchedMinrepo に入る", () => {
  const { venues, unmatchedMinrepo } = buildVenues({
    dmmEvents: [ev("4", "あり店", "東京都新宿区1-1"), ev("5", "なし店", "東京都新宿区2-2")],
    minrepoTags: ["あり店"],
    stores: [],
    previous: {},
  });
  assert.equal(venues["dmm:4"].minrepoTag, "あり店");
  assert.equal(venues["dmm:5"].minrepoTag, null);
  assert.deepEqual(unmatchedMinrepo, ["なし店"]);
});

test("buildVenues: stores.json と住所一致した店は storeId・既存エリア・sns.x を持つ", () => {
  const { venues } = buildVenues({
    dmmEvents: [
      ev("102", "エスパス日拓上野新館", "東京都台東区上野4-7-5　日拓上野アメ横ビル"),
      ev("103", "新規の店", "東京都町田市原町田6丁目13番21号"),
      ev("104", "SNSなし店", "東京都新宿区西新宿1-19-1"),
    ],
    minrepoTags: [],
    stores: STORES,
    previous: {},
  });
  assert.equal(venues["dmm:102"].storeId, "espace-ueno-shinkan");
  assert.equal(venues["dmm:102"].area, "上野");
  assert.equal(venues["dmm:102"].x, "https://x.com/espace_ueno");
  assert.equal(venues["dmm:102"].address, "東京都台東区上野4-7-5　日拓上野アメ横ビル");
  // stores.json に無い店は municipality がエリア・x は null
  assert.equal(venues["dmm:103"].storeId, null);
  assert.equal(venues["dmm:103"].area, "町田市");
  assert.equal(venues["dmm:103"].x, null);
  // sns が null の店は x が null
  assert.equal(venues["dmm:104"].storeId, "no-sns");
  assert.equal(venues["dmm:104"].x, null);
});

test("buildVenues: previous の minrepoTag は今回見つからなくても残す", () => {
  const previous = {
    "dmm:6": { minrepoTag: "旧タグ" },
    "dmm:7": { minrepoTag: "古いタグ" },
    "dmm:8": { minrepoTag: null },
  };
  const { venues, unmatchedMinrepo } = buildVenues({
    dmmEvents: [ev("6", "店六", "東京都新宿区1-1"), ev("7", "店七", "東京都新宿区2-2"), ev("8", "店八", "東京都新宿区3-3")],
    minrepoTags: ["店七"],
    stores: [],
    previous,
  });
  assert.equal(venues["dmm:6"].minrepoTag, "旧タグ"); // 今回見つからなくても残す
  assert.equal(venues["dmm:7"].minrepoTag, "店七"); // 今回の一致が優先
  assert.equal(venues["dmm:8"].minrepoTag, null);
  assert.deepEqual(unmatchedMinrepo, ["店八"]); // 残した店は対応が付いた扱い
});

test("buildVenues: 同じ住所に stores.json の店が複数あるときは店名が一致した店だけ対応付ける", () => {
  const stores = [
    { id: "a", name: "スマートプレゴ池袋", area: "池袋", address: "東京都豊島区南池袋1-21-2 地下1F", sns: null },
    { id: "b", name: "プレゴEX池袋", area: "池袋", address: "東京都豊島区南池袋1-21-2", sns: null },
  ];
  const { venues } = buildVenues({
    dmmEvents: [
      ev("10", "プレゴEX池袋", "東京都豊島区南池袋1-21-2"),
      ev("11", "名前の違う店", "東京都豊島区南池袋1-21-2"),
    ],
    minrepoTags: [],
    stores,
    previous: {},
  });
  assert.equal(venues["dmm:10"].storeId, "b");
  assert.equal(venues["dmm:11"].storeId, null);
  assert.equal(venues["dmm:11"].area, "豊島区");
});
