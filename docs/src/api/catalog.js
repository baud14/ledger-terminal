// Offline / CORS-fallback search over the published catalog-lite index.

let catalog = null;

async function ensure() {
  if (!catalog) {
    const resp = await fetch("./data/catalog-lite.json", { cache: "no-cache" });
    catalog = await resp.json();
  }
  return catalog;
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
