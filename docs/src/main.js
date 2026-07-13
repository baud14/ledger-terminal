// THE LEDGER TERMINAL — boot.

import { register, startRouter } from "./router.js";
import { renderHome } from "./screens/home.js";
import { renderMovers } from "./screens/movers.js";
import { renderMyCards } from "./screens/mycards.js";
import { renderSets } from "./screens/sets.js";
import { renderNews } from "./screens/news.js";
import { renderLearn } from "./screens/learn.js";
import { buildTicker } from "./ticker.js";
import { getMovers, getSets } from "./api/data.js";
import { listHoldings } from "./portfolio.js";
import { snapshotAndDiff } from "./snapshots.js";
import { toast } from "./ui/toast.js";

register("home", renderHome);
register("movers", renderMovers);
register("cards", renderMyCards);
register("sets", renderSets);
register("news", renderNews);
register("learn", renderLearn);

// First-run: ask for a first name (stays on this device only).
// window.prompt is unreliable in iOS standalone PWAs — use an in-app panel.
function ensureName() {
  if (localStorage.getItem("lt-trader-name")) return;
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-back"><div class="modal" style="border-radius:12px;margin:auto;max-width:340px">
    <div class="brand">THE LEDGER TERMINAL <span class="cursor"></span></div>
    <div class="dim" style="font-size:.75rem;margin:10px 0">Welcome to the trading floor. What's your first name, trader?</div>
    <input type="text" id="fr-name" maxlength="20" placeholder="FIRST NAME" autocomplete="off">
    <button class="btn" id="fr-go" style="width:100%;margin-top:10px">OPEN MY TERMINAL</button>
    <div class="dim" style="font-size:.6rem;margin-top:8px">Stays on this phone only. Never sent anywhere.</div>
  </div></div>`;
  const save = () => {
    const v = root.querySelector("#fr-name").value.trim();
    localStorage.setItem("lt-trader-name", (v || "Trader").slice(0, 20));
    root.innerHTML = "";
    window.dispatchEvent(new Event("hashchange")); // re-render greeting
  };
  root.querySelector("#fr-go").addEventListener("click", save);
  root.querySelector("#fr-name").addEventListener("keydown", e => { if (e.key === "Enter") save(); });
}

async function boot() {
  startRouter();
  ensureName();

  // ticker + portfolio snapshot run in the background of first paint
  try {
    const [movers, sets, holdings] = await Promise.all([
      getMovers().catch(() => null),
      getSets().catch(() => null),
      listHoldings().catch(() => []),
    ]);
    buildTicker({ movers, sets, holdings });
    if (holdings.length) await snapshotAndDiff();
  } catch { /* offline first launch — screens handle their own errors */ }

  // service worker + update prompt
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            toast("⬆ NEW TERMINAL SOFTWARE — CLOSE AND REOPEN TO UPGRADE", 6000);
          }
        });
      });
    } catch { /* http / unsupported */ }
  }
}

boot();
