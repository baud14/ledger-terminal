// SETS — release countdowns + chase-card leaderboards per set + icons board.

import { getSets, getBoards } from "../api/data.js";
import { cardRow, wireCardRows } from "../ui/cards.js";
import { daysUntil, fmtDateShort, esc } from "../ui/format.js";

export async function renderSets(el) {
  const [sets, boards] = await Promise.all([getSets(), getBoards()]);

  const upcomingHTML = (sets.upcoming || [])
    .filter(u => daysUntil(u.releaseDate) >= 0)
    .map(u => {
      const d = daysUntil(u.releaseDate);
      return `<div class="panel" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="medium amber">${esc(u.name.toUpperCase())}</div>
          <div class="dim" style="font-size:.7rem">${fmtDateShort(u.releaseDate)}</div>
        </div>
        <div class="chip">${d === 0 ? "DROPS TODAY!" : `T-${d}`}</div>
      </div>`;
    }).join("") || `<div class="dim" style="font-size:.75rem">No announced sets on the calendar.</div>`;

  const iconsHTML = (boards.icons || []).slice(0, 15).map(c =>
    cardRow(c, { sub: c.label && c.label !== c.n ? c.label : undefined })).join("");

  const setBoards = (boards.recentSets || []).map((s, i) => `
    <details class="lesson" ${i === 0 ? "open" : ""}>
      <summary>${esc(s.setName.toUpperCase())} <span class="dim" style="font-weight:400">· ${fmtDateShort(s.releaseDate)}</span></summary>
      <div class="lbody" style="padding:2px 8px">
        ${s.top.map((c, j) => cardRow(c, { sub: `#${j + 1} CHASE · ${c.r || ""}` })).join("")}
      </div>
    </details>`).join("");

  el.innerHTML = `
    <div class="hdr">RELEASE CALENDAR</div>
    ${upcomingHTML}
    <div class="hdr">HALL OF FAME — ALL-TIME ICONS</div>
    <div class="panel" style="padding:2px 8px">${iconsHTML}</div>
    <div class="hdr">CHASE BOARDS — NEWEST SETS</div>
    ${setBoards}`;

  wireCardRows(el);
}
