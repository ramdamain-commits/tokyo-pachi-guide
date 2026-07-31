// data/stores.json のスキーマ検証。scripts/validate-data.mjs から呼ぶ。
//
// 方針: 「未確認（null）」「フィールドそのものが無い」は正常とみなす（収集途中の状態）。
// エラーにするのは、値が入っているのに型・列挙値・形式が不正なケースだけ。

const LOTTERY_TYPES = new Set(["lineup", "onsite", "app"]);
const LOTTERY_KEYS = new Set(["type", "random", "tool", "method", "draw", "lineup", "auth"]);
const SNS_KEYS = new Set(["x", "line", "instagram"]);
const URL_RE = /^https?:\/\//;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUrl(v) {
  return typeof v === "string" && URL_RE.test(v);
}

function checkLotteryCore(lottery, label, errors, warnings) {
  if (lottery.type != null && !LOTTERY_TYPES.has(lottery.type)) {
    errors.push(`${label}: lottery.type が不正 "${lottery.type}"`);
  }
  if (lottery.random != null && typeof lottery.random !== "boolean") {
    errors.push(`${label}: lottery.random は真偽値かnull "${lottery.random}"`);
  }
  if (lottery.type === "app" && !lottery.tool) {
    warnings.push(`${label}: type=app だが tool 未特定（出典で要確認）`);
  }
}

function checkLottery(lottery, label, errors, warnings) {
  checkLotteryCore(lottery, label, errors, warnings);

  for (const genre of ["pachinko", "slot"]) {
    const sub = lottery[genre];
    if (sub == null) continue;
    if (typeof sub !== "object") {
      errors.push(`${label}: lottery.${genre} はオブジェクト`);
      continue;
    }
    const unknown = Object.keys(sub).filter((k) => !LOTTERY_KEYS.has(k));
    if (unknown.length) {
      errors.push(`${label}: lottery.${genre} に未知のキー ${unknown.join(",")}`);
    }
    checkLotteryCore(sub, `${label}/${genre}`, errors, warnings);
  }
}

function checkSns(sns, label, errors) {
  const unknown = Object.keys(sns).filter((k) => !SNS_KEYS.has(k));
  if (unknown.length) {
    errors.push(`${label}: sns に未知のキー ${unknown.join(",")}`);
  }
  for (const [key, value] of Object.entries(sns)) {
    if (value != null && !isUrl(value)) {
      errors.push(`${label}: sns.${key} はURLかnull "${value}"`);
    }
  }
}

function checkCrowd(crowd, label, errors) {
  if (typeof crowd.note !== "string" || !crowd.note) {
    errors.push(`${label}: crowd.note が未設定`);
  }
  if (!isUrl(crowd.sourceUrl)) {
    errors.push(`${label}: crowd.sourceUrl がURLでない`);
  }
  if (typeof crowd.checkedAt !== "string" || !DATE_RE.test(crowd.checkedAt)) {
    errors.push(`${label}: crowd.checkedAt はYYYY-MM-DD形式`);
  }
}

function checkAnnualRule(rule, label, errors) {
  const monthOk = Number.isInteger(rule.month) && rule.month >= 1 && rule.month <= 12;
  const dayOk = Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31;
  if (!monthOk || !dayOk) {
    errors.push(`${label}: annual の month/day が不正 (${rule.month}/${rule.day})`);
  }
  if (rule.label != null && typeof rule.label !== "string") {
    errors.push(`${label}: annual の label は文字列`);
  }
}

/**
 * 店舗配列を検証し、errors（要修正）と warnings（要確認）を返す。
 * @param {object[]} stores
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateStores(stores) {
  const errors = [];
  const warnings = [];
  const seenIds = new Set();

  for (const store of stores) {
    const label = store.id || store.name || "(id不明)";

    if (seenIds.has(store.id)) errors.push(`${label}: id重複`);
    seenIds.add(store.id);

    if (store.lottery) checkLottery(store.lottery, label, errors, warnings);
    if (store.sns) checkSns(store.sns, label, errors);
    if (store.crowd) checkCrowd(store.crowd, label, errors);

    for (const rule of store.rules || []) {
      if (rule.type === "annual") checkAnnualRule(rule, label, errors);
    }
  }

  return { errors, warnings };
}
