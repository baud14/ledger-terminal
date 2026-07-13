# The Ledger Terminal

A Bloomberg-style terminal for the Pokémon trading-card market. Installable
PWA — market movers, chase-card leaderboards, set release countdowns, news,
and a personal collection portfolio with value tracking.

- **App**: static PWA in `docs/` (vanilla JS, no build step), hosted on GitHub Pages
- **Data**: refreshed daily by `pipeline/update.py` (Python stdlib only) from the
  free [TCGdex API](https://tcgdex.dev/) — TCGplayer USD + Cardmarket EUR prices
- **Portfolio**: stored entirely in the browser (IndexedDB) — nothing personal
  ever leaves the device or enters this repo

## Data files (`docs/data/`)

| File | Contents |
|---|---|
| `movers.json` | top gainers/losers, day-over-day + week-over-week |
| `boards.json` | top-10 most valuable cards per recent set + all-time icons |
| `sets.json` | upcoming set release dates + recent sets |
| `news.json` | latest TCG headlines |
| `catalog-lite.json` | offline search index of the tracked universe |
| `meta.json` | last update stamp |

Prices are market reference data (TCGplayer market price; Cardmarket-trend
estimates flagged `eur-est`) — not offers to buy or sell.
