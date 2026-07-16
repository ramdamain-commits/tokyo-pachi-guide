import { matchRules, ruleLabel } from "./match.mjs";

// エリア表示順（固定）
const AREA_ORDER = ["上野", "秋葉原", "新宿", "渋谷", "池袋", "新橋", "京橋/銀座"];
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch failed: ${path}`);
  return res.json();
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// JSTズレ回避のため new Date(y, m-1, d)（ローカル）で生成する。
function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateHeading(date) {
  return `${fmtDate(date)}（${WEEKDAY_JA[date.getDay()]}）`;
}

// <input type="date"> の値("YYYY-MM-DD")をローカル基準のDateへ変換する。
function parseDateInputValue(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function sortByArea(stores) {
  return AREA_ORDER.flatMap((area) => stores.filter((s) => s.area === area));
}

// 台数表示。slots/pachinkoがnullの店は専門店注記を付ける。
function countLabel(store) {
  const parts = [];
  if (store.slots != null) parts.push(`スロ${store.slots}台`);
  if (store.pachinko != null) parts.push(`パチ${store.pachinko}台`);
  if (store.slots != null && store.pachinko == null) parts.push("(スロット専門店)");
  if (store.pachinko != null && store.slots == null) parts.push("(パチンコ専門店)");
  if (store.slots == null && store.pachinko == null) parts.push("台数不明");
  return parts.join(" / ");
}

function ruleBadges(rules) {
  if (!rules.length) return "";
  return rules.map((r) => `<span class="badge badge--rule">${ruleLabel(r)}</span>`).join(" ");
}

function lotteryLine(lottery) {
  if (!lottery) return "";
  const parts = [
    lottery.method && `方式: ${lottery.method}`,
    lottery.draw && `配布/開始: ${lottery.draw}`,
    lottery.auth && `認証: ${lottery.auth}`,
    lottery.lineup && `並び: ${lottery.lineup}`,
  ].filter(Boolean);
  return parts.join(" / ");
}

function sourcesHtml(sources) {
  return (sources || [])
    .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">出典</a>(確認: ${s.checkedAt})`)
    .join(" ・ ");
}

// 今日/明日/日付指定タブ用: 特定日マッチした店カード（マッチしたルールのバッジのみ表示）
function renderDateMatchCard(store, matched) {
  const wrap = el("div", "store-card");
  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${store.name}</span>` +
    `<span class="store-card__area">${store.area}</span></div>` +
    `<div class="store-card__meta">${countLabel(store)}</div>` +
    `<div class="store-card__badges">${ruleBadges(matched)}</div>` +
    (store.memo ? `<div class="store-card__memo">${store.memo}</div>` : "");
  return wrap;
}

// エリア別一覧タブ用: 店の全情報カード
function renderStoreDetailCard(store) {
  const wrap = el("div", store.closed ? "store-card store-card--closed" : "store-card");
  const closedBadge = store.closed
    ? `<span class="badge badge--closed">閉店(${store.closed})</span> `
    : "";
  const addressLine = [store.address, store.access].filter(Boolean).join(" / ");
  const rulesBadges = store.rules && store.rules.length ? ruleBadges(store.rules) : "特定日情報なし";
  const lottery = lotteryLine(store.lottery);
  const hours = `営業: ${store.open || "不明"}〜${store.close || "不明"} / 換金率: ${store.exchange || "不明"}`;
  const src = sourcesHtml(store.sources);

  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${closedBadge}${store.name}</span></div>` +
    (addressLine ? `<div class="store-card__meta">${addressLine}</div>` : "") +
    `<div class="store-card__meta">${countLabel(store)}</div>` +
    `<div class="store-card__badges">${rulesBadges}</div>` +
    (lottery ? `<div class="store-card__desc">抽選: ${lottery}</div>` : "") +
    `<div class="store-card__desc">${hours}</div>` +
    (store.memo ? `<div class="store-card__memo">${store.memo}</div>` : "") +
    (src ? `<div class="store-card__links">${src}</div>` : "");
  return wrap;
}

// 今日/明日/日付指定タブ共通の描画（閉店店は対象から除外）
function renderDateMatches(container, stores, date) {
  container.innerHTML = "";
  container.appendChild(el("p", "date-heading", dateHeading(date)));

  const active = stores.filter((s) => !s.closed);
  const grouped = sortByArea(active);
  let currentArea = null;
  let matchCount = 0;

  grouped.forEach((store) => {
    const matched = matchRules(store.rules, date);
    if (!matched.length) return;
    if (store.area !== currentArea) {
      container.appendChild(el("h2", "area-heading", store.area));
      currentArea = store.area;
    }
    container.appendChild(renderDateMatchCard(store, matched));
    matchCount += 1;
  });

  if (matchCount === 0) {
    container.appendChild(el("p", "none-notice", "該当なしの日です。"));
  }
}

// エリア別一覧タブ（閉店店も表示。閉店バッジ付き）
function renderAreaList(container, stores) {
  container.innerHTML = "";
  const grouped = sortByArea(stores);
  let currentArea = null;
  grouped.forEach((store) => {
    if (store.area !== currentArea) {
      container.appendChild(el("h2", "area-heading", store.area));
      currentArea = store.area;
    }
    container.appendChild(renderStoreDetailCard(store));
  });
}

// 取材傾向タブ用: 媒体カード
function renderMediaCard(media) {
  const wrap = el("div", "store-card");
  const confidenceBadge = `<span class="badge badge--confidence-${media.confidence}">確度: ${media.confidence}</span>`;
  const src = sourcesHtml(media.sources);
  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${media.name}</span>` +
    `<span class="store-card__area">${media.type}</span></div>` +
    `<div class="store-card__badges">${confidenceBadge}</div>` +
    `<div class="media-card__tendency">${media.tendency}</div>` +
    `<div class="media-card__genre">対象: ${media.targetGenre}</div>` +
    (media.note ? `<div class="store-card__memo">${media.note}</div>` : "") +
    (src ? `<div class="store-card__links">${src}</div>` : "");
  return wrap;
}

function renderMediaList(container, mediaList) {
  const disclaimer = container.querySelector(".disclaimer");
  container.innerHTML = "";
  if (disclaimer) container.appendChild(disclaimer);
  mediaList.forEach((media) => container.appendChild(renderMediaCard(media)));
}

function setupTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab-btn"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.hidden = true;
      });
      document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
    });
  });
}

async function main() {
  const data = await loadJSON("data/stores.json");
  const mediaData = await loadJSON("data/media.json");
  document.getElementById("updated").textContent = `データ更新日: ${data.updated}`;

  const today = todayLocal();
  const tomorrow = addDays(today, 1);

  renderDateMatches(document.getElementById("tab-today"), data.stores, today);
  renderDateMatches(document.getElementById("tab-tomorrow"), data.stores, tomorrow);
  renderAreaList(document.getElementById("tab-area"), data.stores);
  renderMediaList(document.getElementById("tab-media"), mediaData.media);

  const dateInput = document.getElementById("date-input");
  const customResult = document.getElementById("custom-result");
  dateInput.value = fmtDate(today);

  function renderCustom() {
    if (!dateInput.value) return;
    renderDateMatches(customResult, data.stores, parseDateInputValue(dateInput.value));
  }
  dateInput.addEventListener("change", renderCustom);
  renderCustom();

  setupTabs();
}

main().catch((e) => {
  document.body.appendChild(
    el("p", null, `<span style="color:#f87171">読み込みエラー: ${e.message}</span>`)
  );
});
