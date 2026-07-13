// Live TCGdex client (search + pricing) with graceful fallback to the
// published catalog when offline / API unreachable.

import { searchCatalog, getCatalogCard } from "./catalog.js";

const API = "https://api.tcgdex.net/v2/en";
let apiDown = false; // session flag — flip on first failure, retry next launch

async function get(url, timeoutMs = 3500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

function extractPricing(card) {
  const tp = card.pricing?.tcgplayer ?? {};
  const cm = card.pricing?.cardmarket ?? {};
  const p = {};
  for (const v of ["normal", "holofoil", "reverse-holofoil", "1st-edition-holofoil", "1st-edition"]) {
    const mp = tp[v]?.marketPrice;
    if (mp != null) p[v] = Math.round(mp * 100) / 100;
  }
  let px = null, pxv = null;
  for (const v of ["holofoil", "1st-edition-holofoil", "normal", "reverse-holofoil", "1st-edition"]) {
    if (v in p) { px = p[v]; pxv = v; break; }
  }
  if (px == null && cm.trend) { px = Math.round(cm.trend * 117) / 100; pxv = "eur-est"; }
  return { p, px, pxv };
}

// -> [{id, n, num, img}] card briefs
export async function searchCards(q, limit = 25) {
  const needle = q.trim();
  if (!needle) return { results: [], live: false };
  if (!apiDown) {
    try {
      const briefs = await get(
        `${API}/cards?name=like:${encodeURIComponent(needle)}&pagination:itemsPerPage=${limit}`);
      return {
        live: true,
        results: briefs.map(b => ({ id: b.id, n: b.name, num: b.localId, img: b.image })),
      };
    } catch {
      apiDown = true;
    }
  }
  return { results: await searchCatalog(needle, limit), live: false };
}

// -> full card with {n, num, setName, r, img, p, px, pxv, variants, live}
export async function getCard(id) {
  if (!apiDown) {
    try {
      const c = await get(`${API}/cards/${encodeURIComponent(id)}`);
      const { p, px, pxv } = extractPricing(c);
      return {
        id: c.id, n: c.name, num: c.localId, r: c.rarity,
        set: c.set?.id, setName: c.set?.name, img: c.image,
        p, px, pxv, live: true,
      };
    } catch {
      apiDown = true;
    }
  }
  const c = await getCatalogCard(id);
  if (!c) return null;
  return { ...c, p: c.px != null && c.pxv ? { [c.pxv]: c.px } : {}, live: false };
}

// Price a set of holdings: {cardId: {px, pxv}} — live where possible.
export async function priceCards(ids) {
  const out = {};
  for (const id of ids) {
    const c = await getCard(id);
    if (c && c.px != null) out[id] = { px: c.px, pxv: c.pxv };
  }
  return out;
}

export function isLive() { return !apiDown; }
