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
function ensureName() {
  if (!localStorage.getItem("lt-trader-name")) {
    const name = prompt("Welcome to THE LEDGER TERMINAL.\n\nWhat's your first name, trader?");
    if (name && name.trim()) localStorage.setItem("lt-trader-name", name.trim().slice(0, 20));
  }
}

async function boot() {
  ensureName();
  startRouter();

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
