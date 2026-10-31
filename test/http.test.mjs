import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetcher, FetchError, UA } from "../collect/http.mjs";

// fetchImpl の偽物。呼ばれた (url, options) を calls に記録し、responses を順に返す。
// responses の要素が Error なら投げる。足りなくなったら最後の要素を繰り返す。
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { status: r.status, text: async () => r.text ?? "" };
  };
  return { fn, calls };
}

// sleep の偽物。呼ばれた引数を記録する。
function fakeSleep() {
  const calls = [];
  return { fn: async (ms) => { calls.push(ms); }, calls };
}

test("get: 2回目の同じURLは fetchImpl を呼ばない", async () => {
  const f = fakeFetch([{ status: 200, text: "本文" }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn });
  const url = "https://example.test/a";
  const r1 = await fetcher.get(url);
  const r2 = await fetcher.get(url);
  assert.deepEqual(f.calls.map((c) => c.url), [url]);
  assert.deepEqual(r1, { status: 200, text: "本文" });
  assert.deepEqual(r2, r1);
});

test("get: 連続する別URLの間で sleep(2000) を呼ぶ", async () => {
  const f = fakeFetch([{ status: 200, text: "x" }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn });
  await fetcher.get("https://example.test/a");
  assert.deepEqual(s.calls, [], "最初の通信の前には sleep しない");
  await fetcher.get("https://example.test/b");
  assert.deepEqual(s.calls, [2000]);
  assert.equal(f.calls.length, 2);
});

test("get: 404 は再試行せず status 404 を返す", async () => {
  const f = fakeFetch([{ status: 404, text: "not found" }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn });
  const r = await fetcher.get("https://example.test/missing");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(r, { status: 404, text: "" });
});

test("get: 503 を maxRetries 回再試行して FetchError", async () => {
  const f = fakeFetch([{ status: 503 }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn, maxRetries: 2 });
  const url = "https://example.test/down";
  await assert.rejects(fetcher.get(url), (err) => {
    assert.ok(err instanceof FetchError);
    assert.equal(err.status, 503);
    assert.equal(err.url, url);
    return true;
  });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(s.calls, [2000, 2000], "再試行の前も間隔をあける");
});

test("get: 403 も再試行対象で、最後は FetchError", async () => {
  const f = fakeFetch([{ status: 403 }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn, maxRetries: 2 });
  await assert.rejects(fetcher.get("https://example.test/blocked"), (err) => {
    assert.ok(err instanceof FetchError);
    assert.equal(err.status, 403);
    return true;
  });
  assert.equal(f.calls.length, 3, "403 を 404 扱いにして打ち切らない");
});

test("get: 一時的な失敗のあとに200が返れば成功する", async () => {
  const f = fakeFetch([{ status: 429 }, new Error("network down"), { status: 200, text: "ok" }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn, maxRetries: 2 });
  const r = await fetcher.get("https://example.test/flaky");
  assert.deepEqual(r, { status: 200, text: "ok" });
  assert.equal(f.calls.length, 3);
});

test("get: ネットワーク例外は再試行し、だめなら FetchError（status 0）", async () => {
  const f = fakeFetch([new Error("timeout")]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn, maxRetries: 1 });
  await assert.rejects(fetcher.get("https://example.test/x"), (err) => {
    assert.ok(err instanceof FetchError);
    assert.equal(err.status, 0);
    return true;
  });
  assert.equal(f.calls.length, 2);
});

test("get: User-Agent ヘッダに UA を付ける", async () => {
  const f = fakeFetch([{ status: 200, text: "x" }]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn });
  await fetcher.get("https://example.test/a");
  assert.equal(f.calls[0].options.headers["User-Agent"], UA);
  assert.ok(UA.length > 0);
});

test("get: 通信にタイムアウト用の signal を付け、タイムアウト（AbortError 相当）は再試行して最後は FetchError", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const f = fakeFetch([timeout]);
  const s = fakeSleep();
  const fetcher = createFetcher({ fetchImpl: f.fn, sleep: s.fn, maxRetries: 2 });
  await assert.rejects(fetcher.get("https://example.test/slow"), (err) => {
    assert.ok(err instanceof FetchError);
    assert.equal(err.status, 0);
    return true;
  });
  assert.equal(f.calls.length, 3, "タイムアウトも一時エラーとして再試行する");
  for (const c of f.calls) {
    assert.ok(c.options.signal instanceof AbortSignal, "fetch に AbortSignal を渡す");
  }
});
