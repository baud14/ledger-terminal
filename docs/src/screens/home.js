// HOME — greeting, portfolio panel, market snapshot, next drop, headlines.

import { getMovers, getSets, getNews, getMeta, isStale } from "../api/data.js";
import { listHoldings } from "../portfolio.js";
import { getSnapshots } from "../snapshots.js";
import { fmtUSD, fmtPct, fmtDelta, arrow, deltaClass, daysUntil, esc, fmtDateShort } from "../ui/format.js";
import { cardRow, wireCardRows } from "../ui/cards.js";
import { sparkline } from "../sparkline.js";
import { navigate } from "../router.js";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "GOOD MORNING" : h < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
}

export async function renderHome(el) {
  const [movers, sets, news, meta, stale, holdings, snaps] = await Promise.all([
    getMovers().catch(() => null), getSets().catch(() => null),
    getNews().catch(() => null), getMeta().catch(() => null),
    isStale(), listHoldings(), getSnapshots(),
  ]);

  const name = (localStorage.getItem("lt-trader-name") || "TRADER").toUpperCase();
  const asOf = meta ? new Date(meta.lastUpdated).toLocaleString("en-US",
    { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  // portfolio panel
  let portfolioHTML;
  if (!holdings.length) {
    portfolioHTML = `<div class="panel empty">
      <div class="big">YOUR TRADING FLOOR IS EMPTY</div>
      <div class="dim" style="font-size:.75rem;margin-bottom:12px">Add the cards you own and watch their value move — like a real trader.</div>
      <a class="btn" href="#/cards">＋ ADD YOUR FIRST CARD</a>
    </div>`;
  } else {
    const latest = snaps[snaps.length - 1];
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const total = latest?.totalUSD ?? 0;
    const day = prev ? total - prev.totalUSD : null;
    const series = snaps.slice(-30).map(s => s.totalUSD);
    portfolioHTML = `<div class="panel" id="pf-panel" style="cursor:pointer">
      <div class="dim" style="font-size:.65rem;letter-spacing:.1em">YOUR PORTFOLIO · ${holdings.length} POSITION${holdings.length > 1 ? "S" : ""}</div>
      <div class="bignum">${fmtUSD(total)}</div>
      ${day != null ? `<div class="${deltaClass(day)}" style="font-size:.85rem">${arrow(day)} ${fmtDelta(day)} (${fmtPct(prev.totalUSD ? day / prev.totalUSD * 100 : 0)}) TODAY</div>` : `<div class="dim" style="font-size:.7rem">Come back tomorrow to see your first day change.</div>`}
      ${series.length >= 2 ? `<div style="margin-top:6px">${sparkline(series, { w: 300, h: 34 })}</div>` : ""}
    </div>`;
  }

  // market snapshot: top 3 gainers/losers
  const g = movers?.dod?.gainers?.slice(0, 3) || [];
  const l = movers?.dod?.losers?.slice(0, 3) || [];
  const snapshotHTML = (g.length || l.length) ? `
    <div class="hdr">MARKET SNAPSHOT ${movers.dod.est ? '<span class="est">(EST~)</span>' : ""}</div>
    <div class="panel" style="padding:2px 8px">
      ${g.map(m => cardRow(m, { change: m.pct })).join("")}
      ${l.map(m => cardRow(m, { change: m.pct })).join("")}
    </div>` : "";

  // next drop
  const next = sets?.upcoming?.find(u => daysUntil(u.releaseDate) >= 0);
  const dropHTML = next ? `
    <div class="panel" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="dim" style="font-size:.65rem;letter-spacing:.1em">NEXT DROP</div>
        <div class="medium amber">${esc(next.name.toUpperCase())}</div>
        <div class="dim" style="font-size:.7rem">${fmtDateShort(next.releaseDate)}</div>
      </div>
      <div class="chip">T-MINUS ${daysUntil(next.releaseDate)} DAY${daysUntil(next.releaseDate) === 1 ? "" : "S"}</div>
    </div>` : "";

  const newsHTML = news?.items?.length ? `
    <div class="hdr">WIRE</div>
    ${news.items.slice(0, 3).map(i => `<div class="news-item">
      <a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.t)}</a>
      <div class="nsub">${esc(i.source || "")}</div>
    </div>`).join("")}
    <div style="text-align:right;margin-top:6px"><a class="cyan" style="font-size:.7rem" href="#/news">FULL WIRE →</a></div>` : "";

  el.innerHTML = `
    ${stale ? `<div id="stale-banner">⚠ DATA IS STALE — LAST FEED ${asOf}. CHECK BACK LATER.</div>` : ""}
    <div style="margin:8px 0 2px" class="brand">THE LEDGER TERMINAL <span class="cursor"></span></div>
    <div class="dim" style="font-size:.7rem">${greeting()}, ${esc(name)} · DATA AS OF ${asOf} ET</div>
    <div style="height:12px"></div>
    ${portfolioHTML}
    ${dropHTML}
    ${snapshotHTML}
    ${newsHTML}`;

  wireCardRows(el);
  el.querySelector("#pf-panel")?.addEventListener("click", () => navigate("cards"));
}
