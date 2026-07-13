// MY CARDS — his portfolio: search & add, holdings with live value, P/L, chart, backup.

import { searchCards } from "../api/tcgdex.js";
import { valuePortfolio, updateQty } from "../portfolio.js";
import { getSnapshots } from "../snapshots.js";
import { exportBackup, importBackup, backupOverdue } from "../backup.js";
import { cardRow, wireCardRows, showCardModal } from "../ui/cards.js";
import { areaChart } from "../sparkline.js";
import { fmtUSD, fmtDelta, fmtPct, arrow, deltaClass, imgUrl, fakeTicker, esc } from "../ui/format.js";
import { toast } from "../ui/toast.js";

const VARIANT_SHORT = {
  "normal": "NORM", "holofoil": "HOLO", "reverse-holofoil": "REV",
  "1st-edition-holofoil": "1ED-H", "1st-edition": "1ED", "eur-est": "EST",
};

export async function renderMyCards(el) {
  document.getElementById("cards-dot")?.setAttribute("hidden", "");
  const [pf, snaps] = await Promise.all([valuePortfolio(), getSnapshots()]);

  const totalHTML = pf.rows.length ? (() => {
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const day = prev ? pf.total - prev.totalUSD : null;
    const paidTotal = pf.rows.reduce((s, r) => s + (r.paidPrice != null ? r.paidPrice * r.qty : 0), 0);
    const hasPaid = pf.rows.some(r => r.paidPrice != null);
    const pl = hasPaid ? pf.total - paidTotal : null;
    return `<div class="panel">
      <div class="dim" style="font-size:.65rem;letter-spacing:.1em">TOTAL COLLECTION VALUE</div>
      <div class="bignum">${fmtUSD(pf.total)}</div>
      ${day != null ? `<div class="${deltaClass(day)}" style="font-size:.85rem">${arrow(day)} ${fmtDelta(day)} TODAY</div>` : ""}
      ${pl != null ? `<div class="statrow" style="margin-top:6px"><span class="k">YOU PAID (where known)</span><span>${fmtUSD(paidTotal)}</span></div>
      <div class="statrow"><span class="k">PROFIT / LOSS</span><span class="${deltaClass(pl)}">${arrow(pl)} ${fmtDelta(pl)}</span></div>` : ""}
      ${pf.unpriced ? `<div class="dim" style="font-size:.65rem;margin-top:4px">${pf.unpriced} card${pf.unpriced > 1 ? "s" : ""} without a market price yet</div>` : ""}
    </div>
    ${snaps.length >= 2 ? `<div class="panel">${areaChart(snaps.slice(-60).map(s => ({ date: s.date, value: s.totalUSD })))}</div>` : ""}`;
  })() : "";

  const holdingsHTML = pf.rows.length ? pf.rows.map(r => {
    const est = r.unitEst;
    return `<div class="crow" data-holding="${esc(r.key)}" data-card="${esc(r.cardId)}">
      <img src="${imgUrl(r.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="cmid">
        <div class="cname">${esc(r.name)}</div>
        <div class="csub">${esc(fakeTicker(r.name, r.localId))} · ${esc(r.setName || "")} · ${VARIANT_SHORT[r.variant] || esc(r.variant)}</div>
        <div class="csub">QTY <button class="qbtn" data-dq="-1">−</button> <b>${r.qty}</b> <button class="qbtn" data-dq="1">＋</button></div>
      </div>
      <div class="cright">
        <div class="cpx">${r.value != null ? fmtUSD(r.value, est) : "—"}</div>
        <div class="csub">${r.unit != null ? "@ " + fmtUSD(r.unit, est) : "NO QUOTE"}</div>
        ${r.paidPrice != null && r.unit != null ? `<div class="cchg ${deltaClass(r.unit - r.paidPrice)}">${arrow(r.unit - r.paidPrice)} ${fmtPct(r.paidPrice ? (r.unit - r.paidPrice) / r.paidPrice * 100 : 0)}</div>` : ""}
      </div>
    </div>`;
  }).join("") : "";

  el.innerHTML = `
    <button class="btn" id="scan-card" style="width:100%">⌾ SCAN A CARD WITH THE CAMERA</button>
    <div class="hdr">SEARCH THE EXCHANGE</div>
    <input type="search" id="card-q" placeholder="TYPE A POKÉMON NAME… (e.g. CHARIZARD)" autocomplete="off">
    <input type="search" id="card-num-q" placeholder="OR THE CARD # … (e.g. 238/191)" autocomplete="off" style="margin-top:8px">
    <div id="q-results" class="panel" style="padding:2px 8px;margin-top:8px;display:none"></div>

    ${pf.rows.length ? `
      <div class="hdr">YOUR PORTFOLIO</div>
      ${totalHTML}
      <div class="panel" id="holdings" style="padding:2px 8px">${holdingsHTML}</div>
      ${backupOverdue(Math.min(...pf.rows.map(r => r.addedAt || Date.now()))) ? `<div class="panel" style="border-color:var(--amber)"><div class="dim" style="font-size:.72rem">⚠ It's been a while since your last backup. Save a copy of your collection so it can never be lost.</div></div>` : ""}
      <div class="grid2" style="margin-top:8px">
        <button class="btn ghost" id="bk-export">⬆ EXPORT BACKUP</button>
        <button class="btn ghost" id="bk-import">⬇ IMPORT BACKUP</button>
      </div>
      <input type="file" id="bk-file" accept="application/json" hidden>`
    : `
      <div class="empty" style="margin-top:24px">
        <div class="big">YOUR TRADING FLOOR IS EMPTY</div>
        <div class="dim" style="font-size:.75rem">Scan a card with the camera, or search for it above, tap it, and hit ＋ ADD TO MY CARDS.<br><br>Your collection lives only on this phone — nobody else can see it.</div>
      </div>`}`;

  // camera scanner (module + OCR assets load lazily on first tap)
  el.querySelector("#scan-card").addEventListener("click", async () => {
    const { openScanner } = await import("../scan.js");
    openScanner();
  });

  // search wiring (debounced)
  const q = el.querySelector("#card-q");
  const results = el.querySelector("#q-results");
  let timer = null;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    const text = q.value;
    if (text.trim().length < 3) { results.style.display = "none"; return; }
    timer = setTimeout(async () => {
      results.style.display = "block";
      results.innerHTML = `<div class="dim" style="padding:10px;font-size:.72rem">SEARCHING THE EXCHANGE…</div>`;
      const { results: hits, live } = await searchCards(text, 25);
      results.innerHTML = hits.length
        ? (live ? "" : `<div class="dim" style="padding:6px;font-size:.6rem">OFFLINE MODE — SEARCHING TRACKED CARDS ONLY</div>`) +
          hits.map(h => cardRow({ ...h, px: h.px ?? null }, { sub: h.setName ? `${h.setName} · #${h.num || "?"}` : `#${h.num || "?"} · TAP FOR LIVE QUOTE` })).join("")
        : `<div class="dim" style="padding:10px;font-size:.72rem">NO MATCHES — CHECK THE SPELLING?</div>`;
      wireCardRows(results);
    }, 350);
  });

  // card-number quick add ("238/191", "SV107") — same matcher as the scanner
  const nq = el.querySelector("#card-num-q");
  let ntimer = null;
  nq.addEventListener("input", () => {
    clearTimeout(ntimer);
    const text = nq.value.trim();
    if (text.length < 2) { if (!q.value.trim()) results.style.display = "none"; return; }
    ntimer = setTimeout(async () => {
      const { quickMatch } = await import("../scan.js");
      const hits = await quickMatch(text, 6);
      results.style.display = "block";
      results.innerHTML = hits.length
        ? hits.map(h => cardRow(h, { sub: `${h.setName || ""} · #${h.num || "?"}${h.tot ? "/" + h.tot : ""}` })).join("")
        : `<div class="dim" style="padding:10px;font-size:.72rem">NO MATCH — try the full number like 238/191, or the name search above.</div>`;
      wireCardRows(results);
    }, 300);
  });

  // holdings wiring: qty steppers (stopPropagation) + row tap -> modal
  el.querySelectorAll("#holdings .crow").forEach(row => {
    row.addEventListener("click", () => showCardModal(row.dataset.card));
    row.querySelectorAll(".qbtn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const key = row.dataset.holding;
        const cur = pf.rows.find(r => r.key === key);
        if (!cur) return;
        const next = cur.qty + Number(btn.dataset.dq);
        if (next <= 0 && !confirm(`Remove ${cur.name} from your collection?`)) return;
        await updateQty(key, next);
        window.dispatchEvent(new Event("hashchange")); // re-render
      });
    });
  });

  el.querySelector("#bk-export")?.addEventListener("click", async () => {
    if (await exportBackup()) toast("💾 BACKUP SAVED — KEEP IT SOMEWHERE SAFE");
  });
  const fileInput = el.querySelector("#bk-file");
  el.querySelector("#bk-import")?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", async () => {
    if (fileInput.files[0]) {
      try {
        await importBackup(fileInput.files[0]);
        window.dispatchEvent(new Event("hashchange"));
      } catch (e) { toast("❌ " + e.message); }
    }
  });
}
