import { matchRules, ruleLabel } from "./match.mjs";
import { resolveLottery, lotteryLabel } from "./lottery.mjs";
import { validateCoverage, mediaForStore, storesForMedia } from "./coverage.mjs";
import {
  selectHotEvents,
  staleness,
  ruleEffectLabel,
  missingLabels,
  areaOptions,
  buildRuleEffectIndex,
} from "./hot.mjs";

// エリア表示順（固定）
const AREA_ORDER = [
  "上野", "秋葉原", "新宿", "渋谷", "下北沢", "池袋", "新橋", "京橋/銀座",
  "中野", "吉祥寺", "立川", "町田", "蒲田", "錦糸町", "北千住", "赤羽",
];
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch failed: ${path}`);
  return res.json();
}

// 自動収集データ（企画名など）を innerHTML に入れる前のエスケープ。
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// href に入れてよいのは http(s) だけ。それ以外は空文字（リンクを出さない）。
function safeUrl(url) {
  return /^https?:\/\//.test(String(url ?? "")) ? esc(url) : "";
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

// effectsByLabel: 特定日ルールのラベル → { label, diff, days }（store-stats の ruleEffects）。
// ruleLabel(rule) と一致したバッジにだけ、実効性（通常日比）を添える。無ければ従来どおりの表示。
function ruleBadges(rules, effectsByLabel) {
  if (!rules.length) return "";
  return rules
    .map((r) => {
      const label = ruleLabel(r);
      const effect = effectsByLabel?.get(label);
      return (
        `<span class="badge badge--rule">${label}</span>` +
        (effect ? ` <span class="badge badge--effect">${esc(ruleEffectLabel(effect))}</span>` : "")
      );
    })
    .join(" ");
}

// パチ/スロの値が異なる場合、または片方のみ確定している場合はジャンル名付きで併記する
// （片方だけ確定のとき裸表示にすると、未確認の側にも同じ方式が及ぶかのように誤読されるため）。
// 両方同じ値のときのみ1個だけ表示する。
// type未確認(null)の場合はlotteryLabelがnullを返しバッジ非表示になる。
function lotteryBadges(lottery) {
  if (!lottery) return "";
  const pachi = lotteryLabel(resolveLottery(lottery, "pachinko"));
  const slot = lotteryLabel(resolveLottery(lottery, "slot"));
  if (!pachi && !slot) return "";
  if (pachi && slot && pachi === slot) {
    return `<span class="badge badge--lottery">${pachi}</span>`;
  }
  return (
    (pachi ? `<span class="badge badge--lottery">パチンコ ${pachi}</span>` : "") +
    (slot ? `<span class="badge badge--lottery">スロット ${slot}</span>` : "")
  );
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

function crowdLine(crowd) {
  if (!crowd) return "";
  return `混雑参考: ${crowd.note} <a href="${crowd.sourceUrl}" target="_blank" rel="noopener">出典</a>(確認: ${crowd.checkedAt})`;
}

function sourcesHtml(sources) {
  return (sources || [])
    .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">出典</a>(確認: ${s.checkedAt})`)
    .join(" ・ ");
}

const SNS_LABELS = { x: "X", line: "LINE", instagram: "Instagram" };

function snsLinks(sns) {
  if (!sns) return "";
  return Object.entries(sns)
    .filter(([, url]) => url)
    .map(([key, url]) => `<a href="${url}" target="_blank" rel="noopener">${SNS_LABELS[key] || key}</a>`)
    .join(" ・ ");
}

// UIで「取材が入る店」として提示する確度。低は最終確認が数年前/未確認のものが多く、
// 肯定バッジにすると誤誘導になるためデータ(coverage.json)には残しつつ表示から除外する。
const COVERAGE_DISPLAY_CONFIDENCE = new Set(["高", "中"]);

function displayCoverage(coverage, storeId) {
  return mediaForStore(coverage, storeId).filter((c) =>
    COVERAGE_DISPLAY_CONFIDENCE.has(c.confidence)
  );
}

// 店に紐づく取材実績バッジ（過去実績の推定・伝聞ベース。confidence併記）
function coverageBadges(coverage, storeId) {
  const items = displayCoverage(coverage, storeId);
  if (!items.length) return "";
  return items
    .map((c) => `<span class="badge badge--coverage">取材: ${c.mediaName}(${c.confidence})</span>`)
    .join(" ");
}

// 今日/明日/日付指定タブ用: 特定日マッチした店カード（マッチしたルールのバッジのみ表示）
function renderDateMatchCard(store, matched, coverage, ruleEffects) {
  const wrap = el("div", "store-card");
  const covBadges = coverageBadges(coverage, store.id);
  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${store.name}</span>` +
    `<span class="store-card__area">${store.area}</span></div>` +
    `<div class="store-card__meta">${countLabel(store)}</div>` +
    `<div class="store-card__badges">${ruleBadges(matched, ruleEffects?.get(store.id))}</div>` +
    (covBadges ? `<div class="store-card__badges">${covBadges}</div>` : "") +
    (store.memo ? `<div class="store-card__memo">${store.memo}</div>` : "");
  return wrap;
}

// エリア別一覧タブ用: 店の全情報カード
function renderStoreDetailCard(store, coverage, ruleEffects) {
  const wrap = el("div", store.closed ? "store-card store-card--closed" : "store-card");
  const closedBadge = store.closed
    ? `<span class="badge badge--closed">閉店(${store.closed})</span> `
    : "";
  const addressLine = [store.address, store.access].filter(Boolean).join(" / ");
  const rulesBadges = store.rules && store.rules.length
    ? ruleBadges(store.rules, ruleEffects?.get(store.id))
    : "特定日情報なし";
  const covBadges = coverageBadges(coverage, store.id);
  const lotteryBadgesHtml = lotteryBadges(store.lottery);
  const lottery = lotteryLine(store.lottery);
  const hours = `営業: ${store.open || "不明"}〜${store.close || "不明"} / 換金率: ${store.exchange || "不明"}`;
  const crowd = crowdLine(store.crowd);
  const sns = snsLinks(store.sns);
  const src = sourcesHtml(store.sources);
  const links = [sns, src].filter(Boolean).join(" ・ ");

  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${closedBadge}${store.name}</span></div>` +
    (addressLine ? `<div class="store-card__meta">${addressLine}</div>` : "") +
    `<div class="store-card__meta">${countLabel(store)}</div>` +
    `<div class="store-card__badges">${rulesBadges}</div>` +
    (covBadges ? `<div class="store-card__badges">${covBadges}</div>` : "") +
    (lotteryBadgesHtml ? `<div class="store-card__badges">${lotteryBadgesHtml}</div>` : "") +
    (lottery ? `<div class="store-card__desc">抽選: ${lottery}</div>` : "") +
    `<div class="store-card__desc">${hours}</div>` +
    (crowd ? `<div class="store-card__desc">${crowd}</div>` : "") +
    (store.memo ? `<div class="store-card__memo">${store.memo}</div>` : "") +
    (links ? `<div class="store-card__links">${links}</div>` : "");
  return wrap;
}

// 今日/明日/日付指定タブ共通の描画（閉店店は対象から除外）
function renderDateMatches(container, stores, date, coverage, ruleEffects) {
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
    container.appendChild(renderDateMatchCard(store, matched, coverage, ruleEffects));
    matchCount += 1;
  });

  if (matchCount === 0) {
    container.appendChild(el("p", "none-notice", "該当なしの日です。"));
  }
}

// エリア別一覧タブ（閉店店も表示。閉店バッジ付き）
function renderAreaList(container, stores, coverage, ruleEffects) {
  const disclaimer = container.querySelector(".disclaimer");
  container.innerHTML = "";
  if (disclaimer) container.appendChild(disclaimer);
  const grouped = sortByArea(stores);
  let currentArea = null;
  grouped.forEach((store) => {
    if (store.area !== currentArea) {
      container.appendChild(el("h2", "area-heading", store.area));
      currentArea = store.area;
    }
    container.appendChild(renderStoreDetailCard(store, coverage, ruleEffects));
  });
}

// 取材傾向タブ用: 媒体カード（掲載店の実績と公式スケジュールリンク付き）
function renderMediaCard(media, coverage, storesById) {
  const wrap = el("div", "store-card");
  const confidenceBadge = `<span class="badge badge--confidence-${media.confidence}">確度: ${media.confidence}</span>`;
  const covered = storesForMedia(coverage, media.name)
    .filter((c) => COVERAGE_DISPLAY_CONFIDENCE.has(c.confidence))
    .map((c) => storesById.get(c.storeId)?.name)
    .filter(Boolean);
  const coveredLine = covered.length
    ? `<div class="media-card__stores">実績店: ${covered.join(" / ")}</div>`
    : "";
  const scheduleLink = media.scheduleUrl
    ? `<a href="${media.scheduleUrl}" target="_blank" rel="noopener">取材スケジュール(公式)</a>`
    : "";
  const src = sourcesHtml(media.sources);
  const links = [scheduleLink, src].filter(Boolean).join(" ・ ");
  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${media.name}</span>` +
    `<span class="store-card__area">${media.type}</span></div>` +
    `<div class="store-card__badges">${confidenceBadge}</div>` +
    `<div class="media-card__tendency">${media.tendency}</div>` +
    `<div class="media-card__genre">対象: ${media.targetGenre}</div>` +
    coveredLine +
    (media.note ? `<div class="store-card__memo">${media.note}</div>` : "") +
    (links ? `<div class="store-card__links">${links}</div>` : "");
  return wrap;
}

function renderMediaList(container, mediaList, coverage, storesById) {
  const disclaimer = container.querySelector(".disclaimer");
  container.innerHTML = "";
  if (disclaimer) container.appendChild(disclaimer);
  mediaList.forEach((media) =>
    container.appendChild(renderMediaCard(media, coverage, storesById))
  );
}

// ---- 熱いイベントタブ ----

// 新データ（collect-meta / events / venues / store-stats）を読む。
// meta・venues が読めない、または必要な月ファイルが1件も読めなければ throw
// （呼び出し側で「データ未生成」にする）。store-stats は任意（無くても熱いイベントは出せる）。
async function loadHotData(todayStr) {
  const [meta, venuesData] = await Promise.all([
    loadJSON("data/collect-meta.json"),
    loadJSON("data/venues.json"),
  ]);
  if (!meta || typeof meta.lastSuccessAt !== "string" || !Array.isArray(meta.months)) {
    throw new Error("collect-meta.json の形が不正");
  }
  if (!venuesData || typeof venuesData.venues !== "object" || venuesData.venues === null) {
    throw new Error("venues.json の形が不正");
  }
  // 今月より前の月ファイルには表示対象が無いので読まない
  const thisMonth = todayStr.slice(0, 7);
  const months = meta.months.filter((m) => m >= thisMonth);
  const events = [];
  let loaded = 0;
  for (const month of months) {
    try {
      const data = await loadJSON(`data/events/${month}.json`);
      if (!Array.isArray(data.events)) throw new Error("events が配列でない");
      events.push(...data.events);
      loaded += 1;
    } catch (e) {
      console.warn(`events/${month} 読み込みスキップ: ${e.message}`);
    }
  }
  if (months.length > 0 && loaded === 0) throw new Error("月ファイルが1件も読めない");

  let stats = null;
  try {
    const statsData = await loadJSON("data/store-stats.json");
    stats = statsData.stats && typeof statsData.stats === "object" ? statsData.stats : null;
  } catch (e) {
    console.warn(`store-stats読み込みスキップ: ${e.message}`);
  }
  return { meta, venues: venuesData.venues, events, stats };
}

function hotEventCard(ev, venues, withScore) {
  const venue = venues[ev.venue];
  const wrap = el("div", "store-card");
  const [y, m, d] = ev.date.split("-").map(Number);
  const dateText = dateHeading(new Date(y, m - 1, d));
  const missing = missingLabels(ev.missing);
  const evidence = (ev.evidence || []).map((line) => `<li>${esc(line)}</li>`).join("");
  const sourceLinks = (ev.sources || [])
    .filter((s) => safeUrl(s.url))
    .map((s) => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">出典</a>(確認: ${esc(s.checkedAt)})`)
    .join(" ・ ");
  const xLink =
    venue?.x && safeUrl(venue.x)
      ? `<a href="${safeUrl(venue.x)}" target="_blank" rel="noopener">店の公式X</a>`
      : "";
  const links = [sourceLinks, xLink].filter(Boolean).join(" ・ ");
  const scoreHtml =
    withScore && typeof ev.score === "number"
      ? ` <span class="hot-card__score">熱さ ${ev.score.toFixed(1)}点</span>`
      : "";
  wrap.innerHTML =
    `<div class="store-card__head"><span class="store-card__name">${esc(venue?.name ?? "（店名不明）")}</span>` +
    `<span class="store-card__area">${esc(venue?.area ?? "")}</span></div>` +
    `<div class="store-card__meta">${esc(dateText)}${ev.media ? ` / ${esc(ev.media)}` : ""}</div>` +
    `<div class="hot-card__title">${esc(ev.title)}${scoreHtml}</div>` +
    (ev.anniversary ? `<div class="store-card__badges"><span class="badge badge--anniv">周年</span></div>` : "") +
    (evidence ? `<ul class="hot-card__evidence">${evidence}</ul>` : "") +
    (missing.length ? `<div class="hot-card__missing">データなし: ${esc(missing.join("・"))}</div>` : "") +
    (links ? `<div class="store-card__links">${links}</div>` : "");
  return wrap;
}

function renderHotUnavailable(body, reason) {
  body.innerHTML = "";
  body.appendChild(
    el("p", "none-notice", "データ未生成（熱いイベントのデータがまだ作られていないか、読み込めませんでした）")
  );
  console.warn(`熱いイベント: ${reason}`);
}

function renderHotTab(body, hot, todayStr) {
  body.innerHTML = "";
  const { meta, venues, events } = hot;

  const st = staleness(meta.lastSuccessAt, todayStr);
  const status = el("p", st.stale ? "hot-status hot-status--stale" : "hot-status");
  status.textContent = st.stale
    ? Number.isNaN(st.days)
      ? "データが古くなっています（最終更新日を読み取れません）"
      : `データが古くなっています（最終更新 ${st.days} 日前）`
    : `最終更新: ${meta.lastSuccessAt.slice(0, 10)}`;
  body.appendChild(status);

  const upcoming = events.filter((e) => e.date >= todayStr);
  const areas = areaOptions(upcoming, venues, AREA_ORDER);
  const state = { area: "", showAll: false };

  const filter = el("div", "hot-filter");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "エリアで絞り込み");
  select.appendChild(new Option("すべてのエリア", ""));
  areas.forEach((a) => select.appendChild(new Option(a, a)));
  filter.appendChild(select);
  const moreBtn = el("button", "hot-more", "もっと見る");
  moreBtn.type = "button";
  filter.appendChild(moreBtn);
  body.appendChild(filter);

  const list = el("div", "hot-list");
  body.appendChild(list);

  function renderList() {
    list.innerHTML = "";
    const range = state.showAll ? { days: null, limit: Infinity } : {};
    const { rated, unrated, total } = selectHotEvents(events, {
      today: todayStr,
      area: state.area || null,
      venues,
      ...range,
    });
    moreBtn.hidden = state.showAll;

    if (total === 0) {
      list.appendChild(
        el(
          "p",
          "none-notice",
          state.showAll
            ? "該当する予定はありません。"
            : "今後7日間に該当する予定はありません。「もっと見る」で先の予定も確認できます。"
        )
      );
      return;
    }

    if (rated.length === 0) {
      list.appendChild(
        el("p", "none-notice", "強さを測れる予定はまだありません。収集を続けると、過去の開催データがたまって点数が付きます")
      );
    } else {
      list.appendChild(el("h2", "hot-section-heading", "熱い順"));
      rated.forEach((ev) => list.appendChild(hotEventCard(ev, venues, true)));
    }

    if (unrated.length) {
      list.appendChild(el("h2", "hot-section-heading", "強さ不明（過去の開催データがまだ無い予定）"));
      list.appendChild(el("p", "hot-section-note", "点数は付けていません。日付の早い順に並べています。"));
      unrated.forEach((ev) => list.appendChild(hotEventCard(ev, venues, false)));
    }
  }

  select.addEventListener("change", () => {
    state.area = select.value;
    renderList();
  });
  moreBtn.addEventListener("click", () => {
    state.showAll = true;
    renderList();
  });
  renderList();
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

  // 取材実績は任意データ。無い/壊れている場合はバッジ無しで既存表示を維持する。
  let coverage = [];
  try {
    const covData = await loadJSON("data/coverage.json");
    const { valid, warnings } = validateCoverage(covData.coverage, data.stores, mediaData.media);
    warnings.forEach((w) => console.warn(w));
    coverage = valid;
  } catch (e) {
    console.warn(`coverage読み込みスキップ: ${e.message}`);
  }
  const storesById = new Map(data.stores.map((s) => [s.id, s]));

  const today = todayLocal();
  const tomorrow = addDays(today, 1);

  // 熱いイベント（新データ）は任意。読めない・壊れている場合はこのタブだけ「データ未生成」にし、
  // 既存タブは今までどおり動かす。
  let ruleEffects = new Map();
  const hotBody = document.getElementById("hot-body");
  try {
    const hot = await loadHotData(fmtDate(today));
    ruleEffects = buildRuleEffectIndex(hot.venues, hot.stats);
    renderHotTab(hotBody, hot, fmtDate(today));
  } catch (e) {
    renderHotUnavailable(hotBody, e.message);
  }

  renderDateMatches(document.getElementById("tab-today"), data.stores, today, coverage, ruleEffects);
  renderDateMatches(document.getElementById("tab-tomorrow"), data.stores, tomorrow, coverage, ruleEffects);
  renderAreaList(document.getElementById("tab-area"), data.stores, coverage, ruleEffects);
  renderMediaList(document.getElementById("tab-media"), mediaData.media, coverage, storesById);

  const dateInput = document.getElementById("date-input");
  const customResult = document.getElementById("custom-result");
  dateInput.value = fmtDate(today);

  function renderCustom() {
    if (!dateInput.value) return;
    renderDateMatches(
      customResult,
      data.stores,
      parseDateInputValue(dateInput.value),
      coverage,
      ruleEffects
    );
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
