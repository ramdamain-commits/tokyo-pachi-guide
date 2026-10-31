// 各取得元に、この実行環境（ローカル・GitHub Actions）から届くかを確かめる。
// URL・HTTP ステータス・本文の長さ・確認用の文字列の有無を1行ずつ出す。
// 1つでも 200 以外か確認用の文字列が無ければ終了コード1。
import { createFetcher, FetchError } from "../collect/http.mjs";

export const TARGETS = [
  { url: "https://p-town.dmm.com/schedules/tokyo", needle: "実施日：" },
  { url: "https://min-repo.com/category/%e6%9d%b1%e4%ba%ac%e9%83%bd/", needle: "min-repo.com/tag/" },
  {
    url: "https://min-repo.com/tag/%e3%82%ab%e3%83%ac%e3%82%a4%e3%83%89%e6%96%b0%e5%ae%bf%e5%ba%97/",
    needle: "旧イベント日",
  },
];

async function main() {
  const fetcher = createFetcher();
  let ok = true;
  for (const { url, needle } of TARGETS) {
    let status;
    let length = 0;
    let found = false;
    try {
      const res = await fetcher.get(url);
      status = res.status;
      length = res.text.length;
      found = res.text.includes(needle);
    } catch (e) {
      status = e instanceof FetchError ? e.status : "ERR";
    }
    const pass = status === 200 && found;
    if (!pass) ok = false;
    console.log(`${pass ? "OK  " : "NG  "} status=${status} length=${length} 確認文字列「${needle}」=${found ? "あり" : "なし"} ${url}`);
  }
  if (!ok) {
    console.error("到達確認に失敗した取得元があります");
    process.exitCode = 1;
  }
}

main();
