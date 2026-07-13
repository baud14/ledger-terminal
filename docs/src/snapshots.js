// Daily portfolio value snapshots (taken on app open) + "your card went up"
// detection against the previous snapshot.

import { getAll, getOne, put } from "./db.js";
import { valuePortfolio } from "./portfolio.js";
import { toast, confetti } from "./ui/toast.js";
import { fakeTicker, fmtDelta, arrow } from "./ui/format.js";

const todayStr = () => new Date().toISOString().slice(0, 10);

export async function getSnapshots() {
  const s = await getAll("snapshots");
  return s.sort((a, b) => a.date.localeCompare(b.date));
}

// Take today's snapshot, compare with the last one, surface moves.
// Returns {portfolio, dayDelta, events}.
export async function snapshotAndDiff() {
  const portfolio = await valuePortfolio();
  const today = todayStr();
  const all = await getSnapshots();
  const prev = [...all].reverse().find(s => s.date < today) || null;

  const prices = {};
  for (const r of portfolio.rows) if (r.unit != null) prices[r.key] = r.unit;
  await put("snapshots", { date: today, totalUSD: portfolio.total, prices });

  const events = [];
  let dayDelta = null;
  if (prev) {
    dayDelta = Math.round((portfolio.total - prev.totalUSD) * 100) / 100;
    for (const r of portfolio.rows) {
      const was = prev.prices?.[r.key];
      if (was == null || r.unit == null) continue;
      const delta = r.unit - was;
      const pct = was > 0 ? (delta / was) * 100 : 0;
      if (Math.abs(pct) > 2 && Math.abs(delta) > 0.25) {
        events.push({ key: r.key, name: r.name, localId: r.localId, delta, pct });
      }
    }
    // all-time-high celebration
    const prevMax = Math.max(0, ...all.map(s => s.totalUSD));
    if (portfolio.total > prevMax && portfolio.total > 0 && all.length > 0) {
      confetti();
      toast(`🏆 ALL-TIME HIGH — PORTFOLIO ${portfolio.total >= 100 ? "$" + Math.round(portfolio.total) : "$" + portfolio.total.toFixed(2)}`);
    }
  }

  // toasts for the biggest moves (max 3)
  events.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const e of events.slice(0, 3)) {
    toast(`${e.delta >= 0 ? "📈" : "📉"} ${fakeTicker(e.name, e.localId)} ${e.name.toUpperCase()} ${arrow(e.delta)} ${fmtDelta(e.delta)} TODAY`);
  }
  if (events.length) document.getElementById("cards-dot")?.removeAttribute("hidden");

  return { portfolio, dayDelta, events };
}
