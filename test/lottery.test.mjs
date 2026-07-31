import test from "node:test";
import assert from "node:assert/strict";
import { deriveChannel, deriveTool, deriveRandom, reviewFlags } from "../lottery.mjs";

// --- deriveChannel: 入場チャネル ---

test("deriveChannel: モバイル/オンライン/コンパス/入場くん を含めば app", () => {
  assert.equal(deriveChannel("モバイル抽選"), "app");
  assert.equal(deriveChannel("モバイル抽選(777コンパス)"), "app");
  assert.equal(deriveChannel("入場くんオンライン(モバイル抽選)"), "app");
  assert.equal(deriveChannel("777コンパス モバイル抽選"), "app");
});

test("deriveChannel: 整理券/店頭/抽選券 を含めば onsite", () => {
  assert.equal(deriveChannel("整理券(会員カード不要)"), "onsite");
  assert.equal(deriveChannel("整理券・シャッフル抽選"), "onsite");
  assert.equal(deriveChannel("整理券抽選"), "onsite");
  assert.equal(deriveChannel("抽選券配布(スロ)"), "onsite");
});

test("deriveChannel: チャネルが判別できない文言は null", () => {
  // 「抽選」だけではアプリか店頭か決まらないので推測しない
  assert.equal(deriveChannel("抽選方式"), null);
  assert.equal(deriveChannel("抽選(会員カード不要)"), null);
  assert.equal(deriveChannel(null), null);
  assert.equal(deriveChannel(""), null);
});

test("deriveChannel: app と onsite の両方の語を含む場合は app を優先する", () => {
  // ハイブリッド運用の店。reviewFlags 側で要確認として拾う
  assert.equal(deriveChannel("店頭/モバイル抽選"), "app");
});

// --- deriveTool: アプリ名 ---

test("deriveTool: 既知のツール名を正規化して返す", () => {
  assert.equal(deriveTool("モバイル抽選(777コンパス)"), "777コンパス");
  assert.equal(deriveTool("777コンパス モバイル抽選"), "777コンパス");
  // 「コンパス」だけの表記も 777コンパス に寄せる
  assert.equal(deriveTool("モバイル抽選(コンパス、2024-12-15方式変更)"), "777コンパス");
  assert.equal(deriveTool("入場くんオンライン(モバイル抽選)"), "入場くんオンライン");
});

test("deriveTool: ∞付きは別ツール名として区別する", () => {
  assert.equal(deriveTool("モバイル抽選(入場くんオンライン∞)"), "入場くんオンライン∞");
});

test("deriveTool: ツール名の記載がなければ null", () => {
  assert.equal(deriveTool("モバイル抽選"), null);
  assert.equal(deriveTool("整理券(会員カード不要)"), null);
  assert.equal(deriveTool(null), null);
});

// --- deriveRandom: 抽選要素の有無 ---

test("deriveRandom: 文言に「抽選」があれば true", () => {
  assert.equal(deriveRandom("整理券抽選"), true);
  assert.equal(deriveRandom("整理券・シャッフル抽選"), true);
  assert.equal(deriveRandom("抽選方式"), true);
});

test("deriveRandom: 抽選の記載が無ければ null（false と断定しない）", () => {
  // 「整理券」だけでは先着か抽選か決まらない。無記載を false と読むのは推測補完
  assert.equal(deriveRandom("整理券(会員カード不要)"), null);
  assert.equal(deriveRandom("整理券"), null);
  assert.equal(deriveRandom(null), null);
});

// --- reviewFlags: 要確認の理由 ---

test("reviewFlags: チャネル不明・抽選有無不明を理由として返す", () => {
  assert.deepEqual(reviewFlags("抽選方式"), ["チャネル不明"]);
  assert.deepEqual(reviewFlags("整理券"), ["抽選有無不明"]);
});

test("reviewFlags: app なのにツール名が無い場合を拾う", () => {
  assert.deepEqual(reviewFlags("モバイル抽選"), ["ツール名不明"]);
});

test("reviewFlags: 店頭とアプリの併記はハイブリッド疑いとして拾う", () => {
  assert.ok(reviewFlags("店頭/モバイル抽選").includes("ハイブリッド疑い"));
});

test("reviewFlags: パチ/スロ差分の疑いを拾う", () => {
  assert.ok(reviewFlags("モバイル抽選(スロ)").includes("パチ/スロ差分疑い"));
  assert.ok(reviewFlags("整理券(パチ/スロ別抽選)").includes("パチ/スロ差分疑い"));
});

test("reviewFlags: 判別できる文言なら空配列", () => {
  assert.deepEqual(reviewFlags("整理券抽選"), []);
  assert.deepEqual(reviewFlags("モバイル抽選(777コンパス)"), []);
});

test("reviewFlags: 略称だけでツール名を推定した場合は要確認にする", () => {
  // 原文に「777」が無く「コンパス」だけ → 推定なので確定扱いにしない
  assert.ok(
    reviewFlags("モバイル抽選(コンパス、2024-12-15方式変更)").includes("ツール名要確認(略称一致)")
  );
  // 正式名称が書かれていれば要確認にしない
  assert.deepEqual(reviewFlags("モバイル抽選(777コンパス)"), []);
});
