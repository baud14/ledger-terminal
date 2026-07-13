// Formatting helpers — Bloomberg style, kid-readable.

export function fmtUSD(v, est = false) {
  if (v == null || isNaN(v)) return "—";
  const s = v >= 100
    ? "$" + Math.round(v).toLocaleString("en-US")
    : "$" + v.toFixed(2);
  return est ? "≈" + s : s;
}

export function fmtPct(p) {
  if (p == null || isNaN(p)) return "";
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
}

export function fmtDelta(d) {
  if (d == null || isNaN(d)) return "";
  const abs = Math.abs(d);
  const s = abs >= 100 ? "$" + Math.round(abs).toLocaleString("en-US") : "$" + abs.toFixed(2);
  return (d >= 0 ? "+" : "-") + s;
}

export function arrow(v) { return v >= 0 ? "▲" : "▼"; } // ▲ ▼
export function deltaClass(v) { return v >= 0 ? "up" : "down"; }

// "Charizard", "4" -> "CHAR-4" — the fake stock ticker symbol.
export function fakeTicker(name, num) {
  const base = (name || "????").replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "CARD";
  return num ? `${base}-${String(num).replace(/^0+/, "") || num}` : base;
}

export function imgUrl(base, quality = "low") {
  if (!base) return "";
  return `${base}/${quality}.webp`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function daysUntil(iso) {
  const target = new Date(iso + "T00:00:00");
  return Math.ceil((target - new Date()) / 86400000);
}

export function fmtDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
