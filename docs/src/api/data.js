// Published market data (docs/data/*.json, refreshed daily by the Mac pipeline).

const cache = {};

async function load(name) {
  if (cache[name]) return cache[name];
  const resp = await fetch(`./data/${name}.json`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`data/${name}.json ${resp.status}`);
  cache[name] = await resp.json();
  return cache[name];
}

export const getMeta = () => load("meta");
export const getMovers = () => load("movers");
export const getBoards = () => load("boards");
export const getSets = () => load("sets");
export const getNews = () => load("news");

export async function isStale() {
  try {
    const meta = await getMeta();
    return Date.now() - new Date(meta.lastUpdated).getTime() > 48 * 3600 * 1000;
  } catch { return false; }
}
