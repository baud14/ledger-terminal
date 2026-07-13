// Shared card row + card detail modal (with EXECUTE TRADE add-to-portfolio flow).

import { fmtUSD, fmtPct, arrow, deltaClass, fakeTicker, imgUrl, esc } from "./format.js";
import { sparkline } from "../sparkline.js";
import { getCard } from "../api/tcgdex.js";
import { addHolding } from "../portfolio.js";
import { toast, confetti } from "./toast.js";

const VARIANT_LABEL = {
  "normal": "NORMAL", "holofoil": "HOLO", "reverse-holofoil": "REVERSE HOLO",
  "1st-edition-holofoil": "1ST ED HOLO", "1st-edition": "1ST EDITION",
  "eur-est": "MARKET EST",
};

export function cardRow(c, { sub, change, sparkVals } = {}) {
  const est = c.pxv === "eur-est" || c.est;
  const chg = change != null
    ? `<div class="cchg ${deltaClass(change)}">${arrow(change)} ${fmtPct(change)}${c.est ? "~" : ""}</div>`
    : "";
  return `<div class="crow" data-card="${esc(c.id)}">
    <img src="${imgUrl(c.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="cmid">
      <div class="cname">${esc(c.n)}</div>
      <div class="csub">${esc(sub ?? `${fakeTicker(c.n, c.num)} · ${c.setName || c.set || ""}`)}</div>
    </div>
    ${sparkVals?.length ? sparkline(sparkVals) : ""}
    <div class="cright">
      <div class="cpx">${fmtUSD(c.px, est)}</div>
      ${chg}
    </div>
  </div>`;
}

// Wire click-through to the detail modal on any container with .crow[data-card]
export function wireCardRows(container) {
  container.querySelectorAll(".crow[data-card]").forEach(row =>
    row.addEventListener("click", () => showCardModal(row.dataset.card)));
}

export async function showCardModal(cardId) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-back"><div class="modal">
    <button class="close">✕</button>
    <div class="dim" style="padding:30px;text-align:center">PULLING QUOTE…</div>
  </div></div>`;
  wireClose(root);

  const c = await getCard(cardId);
  if (!c) {
    root.querySelector(".modal").innerHTML = `<button class="close">✕</button>
      <div class="empty"><div class="big">CARD NOT FOUND</div></div>`;
    wireClose(root);
    return;
  }

  const variants = Object.entries(c.p || {});
  const est = c.pxv === "eur-est";
  const priceRows = variants.length
    ? variants.map(([v, p]) => `<div class="statrow"><span class="k">${VARIANT_LABEL[v] || v.toUpperCase()}</span><span>${fmtUSD(p)}</span></div>`).join("")
    : (est ? `<div class="statrow"><span class="k">MARKET EST</span><span>${fmtUSD(c.px, true)}</span></div>`
           : `<div class="statrow"><span class="k">PRICE</span><span class="dim">PENDING — TOO FRESH TO TRADE</span></div>`);

  root.querySelector(".modal").innerHTML = `
    <button class="close">✕</button>
    <div style="display:flex;gap:14px;align-items:flex-start">
      <img src="${imgUrl(c.img, "high")}" alt="${esc(c.n)}"
           style="width:150px;border-radius:8px" onerror="this.style.display='none'">
      <div style="flex:1;min-width:0">
        <div class="brand">${esc(fakeTicker(c.n, c.num))}</div>
        <div style="font-weight:700;margin:2px 0">${esc(c.n)}</div>
        <div class="dim" style="font-size:.7rem">${esc(c.setName || "")} · #${esc(c.num || "?")}${c.r ? " · " + esc(c.r.toUpperCase()) : ""}</div>
        <div class="bignum" style="margin-top:10px">${fmtUSD(c.px, est)}</div>
        <div class="dim" style="font-size:.62rem">${c.live ? "LIVE QUOTE — TCGPLAYER MARKET" : "CACHED QUOTE"}</div>
      </div>
    </div>
    <div class="hdr">PRICE BOARD</div>
    ${priceRows}
    <div class="hdr">EXECUTE TRADE</div>
    <div id="trade-zone">
      ${c.px == null ? `<div class="dim" style="font-size:.75rem">No market price yet — you can still add it to your collection.</div>` : ""}
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <select id="tr-variant" style="background:#000;color:var(--text);border:1px solid var(--amber-dim);font-family:var(--mono);padding:9px;border-radius:4px">
          ${(variants.length ? variants.map(([v]) => v) : ["normal"]).map(v =>
            `<option value="${esc(v)}">${VARIANT_LABEL[v] || v.toUpperCase()}</option>`).join("")}
        </select>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="btn ghost small" id="tr-minus">−</button>
          <span id="tr-qty" style="min-width:2ch;text-align:center;font-weight:700">1</span>
          <button class="btn ghost small" id="tr-plus">+</button>
        </div>
      </div>
      <input type="number" id="tr-paid" placeholder="WHAT DID YOU PAY? (optional, per card)" inputmode="decimal" style="margin-bottom:8px">
      <button class="btn" id="tr-buy" style="width:100%">＋ ADD TO MY CARDS</button>
    </div>`;
  wireClose(root);

  let qty = 1;
  const qtyEl = root.querySelector("#tr-qty");
  root.querySelector("#tr-minus").onclick = () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; };
  root.querySelector("#tr-plus").onclick = () => { qty = Math.min(99, qty + 1); qtyEl.textContent = qty; };
  root.querySelector("#tr-buy").onclick = async () => {
    const variant = root.querySelector("#tr-variant").value;
    const paidRaw = parseFloat(root.querySelector("#tr-paid").value);
    await addHolding({
      cardId: c.id, variant, qty,
      paidPrice: isNaN(paidRaw) ? null : paidRaw,
      card: c,
    });
    confetti(14);
    toast(`✅ TRADE EXECUTED — ${qty}× ${c.n.toUpperCase()} (${VARIANT_LABEL[variant] || variant})`);
    closeModal();
    if (location.hash.includes("cards")) window.dispatchEvent(new Event("hashchange"));
  };
}

function wireClose(root) {
  root.querySelector(".close")?.addEventListener("click", closeModal);
  root.querySelector(".modal-back")?.addEventListener("click", e => {
    if (e.target.classList.contains("modal-back")) closeModal();
  });
}

export function closeModal() { document.getElementById("modal-root").innerHTML = ""; }
