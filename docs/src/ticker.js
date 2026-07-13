// Scrolling ticker tape: top movers + starred holdings + next-set countdown.

import { fakeTicker, fmtPct, arrow, deltaClass, daysUntil, esc } from "./ui/format.js";

export function buildTicker({ movers, sets, holdings }) {
  const el = document.getElementById("ticker");
  const items = [];

  const next = sets?.upcoming?.[0];
  if (next && daysUntil(next.releaseDate) >= 0) {
    items.push(`<span class="tk"><span class="sym">T-${daysUntil(next.releaseDate)}</span> ${esc(next.name.toUpperCase())}<span class="sep">◆</span></span>`);
  }

  const heldIds = new Set((holdings || []).map(h => h.cardId));
  const tape = [];
  const seen = new Set();
  for (const list of [movers?.dod?.gainers || [], movers?.dod?.losers || []]) {
    for (const m of list.slice(0, 7)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      tape.push(m);
    }
  }
  tape.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  for (const m of tape.slice(0, 14)) {
    const star = heldIds.has(m.id) ? "★" : "";
    items.push(
      `<span class="tk ${star ? "star" : ""}"><span class="sym">${star}${esc(fakeTicker(m.n, m.num))}</span> ` +
      `<span class="${deltaClass(m.pct)}">${arrow(m.pct)} ${fmtPct(m.pct)}${m.est ? "~" : ""}</span><span class="sep">◆</span></span>`);
  }

  if (!items.length) {
    items.push(`<span class="tk"><span class="sym">THE LEDGER TERMINAL</span><span class="sep">◆</span></span>`);
  }

  // render twice for a seamless loop
  const half = items.join("");
  el.innerHTML = half + half;
  el.classList.remove("animate");
  // duration scales with content
  el.style.animationDuration = Math.max(18, items.length * 2.2) + "s";
  requestAnimationFrame(() => el.classList.add("animate"));
}
