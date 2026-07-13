// MOVERS — full gainers/losers boards, day / week toggle.

import { getMovers } from "../api/data.js";
import { cardRow, wireCardRows } from "../ui/cards.js";

export async function renderMovers(el) {
  const movers = await getMovers();
  let period = "dod", side = "gainers";

  const draw = () => {
    const block = movers[period];
    const list = block?.[side] || [];
    el.querySelector("#mv-list").innerHTML = list.length
      ? list.map(m => cardRow(m, { change: m.pct, sparkVals: m.spark })).join("")
      : `<div class="empty"><div class="big">NO ${side.toUpperCase()} YET</div>
         <div class="dim" style="font-size:.72rem">The market feed builds its history one day at a time — check back tomorrow.</div></div>`;
    el.querySelector("#mv-note").innerHTML = block?.est
      ? `~ ESTIMATED FROM MARKET AVERAGES — REAL DAILY TRACKING KICKS IN AS THE TERMINAL COLLECTS HISTORY`
      : `VS ${period === "dod" ? "YESTERDAY" : "LAST WEEK"} · TCGPLAYER MARKET PRICE`;
    el.querySelectorAll("[data-period]").forEach(b => b.classList.toggle("active", b.dataset.period === period));
    el.querySelectorAll("[data-side]").forEach(b => b.classList.toggle("active", b.dataset.side === side));
    wireCardRows(el.querySelector("#mv-list"));
  };

  el.innerHTML = `
    <div class="hdr">MARKET MOVERS</div>
    <div class="seg">
      <button data-period="dod">1 DAY</button>
      <button data-period="wow">1 WEEK</button>
    </div>
    <div class="seg">
      <button data-side="gainers" class="up">▲ GAINERS</button>
      <button data-side="losers" class="down">▼ LOSERS</button>
    </div>
    <div class="dim" id="mv-note" style="font-size:.62rem;margin-bottom:6px"></div>
    <div class="panel" id="mv-list" style="padding:2px 8px"></div>`;

  el.querySelectorAll("[data-period]").forEach(b => b.onclick = () => { period = b.dataset.period; draw(); });
  el.querySelectorAll("[data-side]").forEach(b => b.onclick = () => { side = b.dataset.side; draw(); });
  draw();
}
