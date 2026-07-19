// 店舗×媒体の取材実績(coverage.json)の検証・結合ロジック。app.js から import する。

// coverage エントリのうち stores/media に実在するものだけを valid に残す。
// 不整合は warnings（文字列配列）として返し、呼び出し側で console.warn する。
export function validateCoverage(coverageList, stores, mediaList) {
  const storeIds = new Set(stores.map((s) => s.id));
  const mediaNames = new Set(mediaList.map((m) => m.name));
  const valid = [];
  const warnings = [];
  for (const c of coverageList) {
    if (!storeIds.has(c.storeId)) {
      warnings.push(`coverage: 未知のstoreId "${c.storeId}"`);
      continue;
    }
    if (!mediaNames.has(c.mediaName)) {
      warnings.push(`coverage: 未知のmediaName "${c.mediaName}"`);
      continue;
    }
    valid.push(c);
  }
  return { valid, warnings };
}

export function mediaForStore(coverageList, storeId) {
  return coverageList.filter((c) => c.storeId === storeId);
}

export function storesForMedia(coverageList, mediaName) {
  return coverageList.filter((c) => c.mediaName === mediaName);
}
