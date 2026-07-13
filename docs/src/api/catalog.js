// Offline / CORS-fallback search over the published catalog-lite index.

let catalog = null;

async function ensure() {
  if (!catalog) {
    const resp = await fetch("./data/catalog-lite.json", { cache: "no-cache" });
    catalog = await resp.json();
  }
  return catalog;
}

// Full catalog array — used by the scanner matcher and set browsing.
export async function listCatalog() {
  return ensure();
}

export async function searchCatalog(q, limit = 25) {
  const cards = await ensure();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const c of cards) {
    if ((c.n || "").toLowerCase().includes(needle)) {
      hits.push(c);
      if (hits.length >= limit) break;
    }
  }
  // most valuable first — the interesting ones
  return hits.sort((a, b) => (b.px || 0) - (a.px || 0));
}

export async function getCatalogCard(id) {
  const cards = await ensure();
  return cards.find(c => c.id === id) || null;
}

// ---------------------------------------------------------------- scan index
// Every English card ever printed (~21k), for the camera scanner and the
// card-# lookup — catalog-lite only covers the ~1.9k priced cards we track.
// Rows stay in their compact [setId, localId, name] form (a phone shouldn't
// materialise 21k objects); hydrate() builds a card only for the few we show.

let scanIndex = null;

export async function loadScanIndex() {
  if (!scanIndex) {
    const resp = await fetch("./data/scan-index.json", { cache: "no-cache" });
    scanIndex = await resp.json();
  }
  return scanIndex;
}

// [setId, localId, name] -> the card shape the rest of the app expects
export function hydrate(idx, row, px = null) {
  const [setId, localId, name] = row;
  const set = idx.sets[setId] || {};
  return {
    id: `${setId}-${localId}`,
    n: name,
    num: localId,
    set: setId,
    setName: set.n || setId,
    tot: set.t ?? null,
    img: set.p ? `${set.p}/${localId}` : "",
    px,
  };
}

export async function getScanCard(id) {
  const idx = await loadScanIndex();
  const row = idx.cards.find(r => `${r[0]}-${r[1]}` === id);
  return row ? hydrate(idx, row) : null;
}

// px lookup so scanned cards we DO track still show a live-ish price in the list
export async function priceMap() {
  const cards = await ensure();
  const m = new Map();
  for (const c of cards) if (c.px != null) m.set(c.id, c.px);
  return m;
}
