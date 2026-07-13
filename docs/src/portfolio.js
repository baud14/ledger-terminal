// Holdings CRUD + valuation. A holding = one card variant he owns.

import { getAll, getOne, put, del } from "./db.js";
import { priceCards } from "./api/tcgdex.js";

export const holdingKey = (cardId, variant) => `${cardId}|${variant}`;

export async function listHoldings() {
  const h = await getAll("holdings");
  return h.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export async function addHolding({ cardId, variant, qty, paidPrice, card }) {
  const key = holdingKey(cardId, variant);
  const existing = await getOne("holdings", key);
  const holding = existing
    ? { ...existing, qty: existing.qty + qty }
    : {
        key, cardId, variant, qty,
        paidPrice: paidPrice ?? null,
        name: card.n, setId: card.set, setName: card.setName,
        localId: card.num, rarity: card.r, img: card.img,
        addedAt: Date.now(),
      };
  await put("holdings", holding);
  return holding;
}

export async function updateQty(key, qty) {
  const h = await getOne("holdings", key);
  if (!h) return;
  if (qty <= 0) await del("holdings", key);
  else await put("holdings", { ...h, qty });
}

export const removeHolding = key => del("holdings", key);

// Value every holding. Returns {rows, total, priced, unpriced}.
export async function valuePortfolio() {
  const holdings = await listHoldings();
  const ids = [...new Set(holdings.map(h => h.cardId))];
  const prices = await priceCards(ids);
  let total = 0, unpriced = 0;
  const rows = holdings.map(h => {
    const pr = prices[h.cardId];
    const unit = pr ? pr.px : null;
    const value = unit != null ? unit * h.qty : null;
    if (value != null) total += value;
    else unpriced++;
    return { ...h, unit, unitEst: pr?.pxv === "eur-est", value };
  });
  return { rows, total: Math.round(total * 100) / 100, priced: rows.length - unpriced, unpriced };
}
