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
  { storeId: "zzz", mediaName: "M1" }, // 不整合: storeId
  { storeId: "a", mediaName: "NoSuch" }, // 不整合: mediaName
];

test("validateCoverage: 不整合エントリを除外しwarningsに積む", () => {
  const { valid, warnings } = validateCoverage(cov, stores, media);
  assert.equal(valid.length, 3);
  assert.equal(warnings.length, 2);
});

test("validateCoverage: 空のcoverageは空のまま返る", () => {
  const { valid, warnings } = validateCoverage([], stores, media);
  assert.deepEqual(valid, []);
  assert.deepEqual(warnings, []);
});

test("mediaForStore: 店に紐づく実績を返す", () => {
  const { valid } = validateCoverage(cov, stores, media);
  assert.deepEqual(
    mediaForStore(valid, "a").map((c) => c.mediaName),
    ["M1", "M2"]
  );
  assert.equal(mediaForStore(valid, "nothing").length, 0);
});

test("storesForMedia: 媒体に紐づく店を返す", () => {
  const { valid } = validateCoverage(cov, stores, media);
  assert.deepEqual(
    storesForMedia(valid, "M1").map((c) => c.storeId),
    ["a", "b"]
  );
});

test("実データの参照整合: coverage.json の全キーが stores/media に存在する", () => {
  const s = JSON.parse(fs.readFileSync(new URL("../data/stores.json", import.meta.url)));
  const m = JSON.parse(fs.readFileSync(new URL("../data/media.json", import.meta.url)));
  const c = JSON.parse(fs.readFileSync(new URL("../data/coverage.json", import.meta.url)));
  const { warnings } = validateCoverage(c.coverage, s.stores, m.media);
  assert.deepEqual(warnings, []);
});
