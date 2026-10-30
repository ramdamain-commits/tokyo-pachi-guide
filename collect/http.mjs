// 取得部品: 間隔をあけた取得・実行内キャッシュ・再試行。外部依存なし（Node 標準の fetch のみ）。

// 全リクエストで使う固定の User-Agent
export const UA = "tokyo-pachi-guide-collector/1.0 (+https://github.com/ramdamain-commits/tokyo-pachi-guide)";

/** 取得に失敗したことを表すエラー。url と status（通信自体の失敗は 0）を持つ。 */
export class FetchError extends Error {
  constructor(url, status, message) {
    super(message ?? `取得に失敗: ${url} (status ${status})`);
    this.name = "FetchError";
    this.url = url;
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 取得器を作る。
 * - 通信と通信の間は delayMs あける（最初の通信の前だけは待たない。再試行の前は待つ）
 * - 同じ URL は1つの取得器の中で1度しか通信しない（200・404・410 の結果をキャッシュする）
 * - 404/410 は再試行せず { status, text: "" } を返す
 * - 403・429・5xx・ネットワーク例外は maxRetries 回まで再試行し、だめなら FetchError を投げる
 *   （403 を「存在しない」扱いにしない。遮断でも返るため）
 * @param {{ delayMs?: number, userAgent?: string, maxRetries?: number,
 *           fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {{ get: (url: string) => Promise<{ status: number, text: string }> }}
 */
export function createFetcher({
  delayMs = 2000,
  userAgent = UA,
  maxRetries = 2,
  fetchImpl = fetch,
  sleep = defaultSleep,
} = {}) {
  const cache = new Map();
  let requested = false; // 通信を1回でも始めたか

  async function request(url) {
    if (requested) await sleep(delayMs);
    requested = true;
    return fetchImpl(url, { headers: { "User-Agent": userAgent } });
  }

  async function get(url) {
    if (cache.has(url)) return cache.get(url);

    let lastStatus = 0;
    let lastMessage = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await request(url);
        if (res.status === 200) {
          const result = { status: 200, text: await res.text() };
          cache.set(url, result);
          return result;
        }
        if (res.status === 404 || res.status === 410) {
          const result = { status: res.status, text: "" };
          cache.set(url, result);
          return result;
        }
        lastStatus = res.status;
        lastMessage = `HTTP ${res.status}`;
      } catch (e) {
        lastStatus = 0;
        lastMessage = e?.message ?? String(e);
      }
    }
    throw new FetchError(url, lastStatus, `取得に失敗: ${url} (${lastMessage}, ${maxRetries + 1}回試行)`);
  }

  return { get };
}
