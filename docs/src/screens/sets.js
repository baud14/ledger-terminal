// SETS — release countdowns + chase-card leaderboards per set + icons board.

import { getSets, getBoards } from "../api/data.js";
import { listCatalog } from "../api/catalog.js";
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
        <button class="btn ghost" data-browse-set="${esc(s.setId)}" style="width:100%;margin:8px 0">▦ BROWSE THE WHOLE SET${s.cardCount ? ` (${s.cardCount} CARDS)` : ""}</button>
        <div data-set-grid="${esc(s.setId)}"></div>
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

  // "browse the whole set" — full card list from the offline catalog, tap to add
  el.querySelectorAll("[data-browse-set]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const setId = btn.dataset.browseSet;
      const grid = el.querySelector(`[data-set-grid="${CSS.escape(setId)}"]`);
      if (!grid) return;
      if (grid.innerHTML) { grid.innerHTML = ""; btn.textContent = btn.textContent.replace("▲ HIDE", "▦ BROWSE"); return; }
      btn.textContent = btn.textContent.replace("▦ BROWSE", "▲ HIDE");
      const all = (await listCatalog()).filter(c => c.set === setId);
      const numKey = c => {
        const digits = String(c.num || "").replace(/\D/g, "");
        return [digits ? parseInt(digits, 10) : 9999, String(c.num || "")];
      };
      all.sort((a, b) => {
        const [na, sa] = numKey(a), [nb, sb] = numKey(b);
        return na - nb || sa.localeCompare(sb);
      });
      grid.innerHTML = all.map(c =>
        cardRow(c, { sub: `#${c.num || "?"}${c.tot ? "/" + c.tot : ""}${c.r ? " · " + c.r.toUpperCase() : ""}` })).join("")
        || `<div class="dim" style="padding:8px;font-size:.72rem">Card list not available offline yet.</div>`;
      wireCardRows(grid);
    });
  });
}
