// Inline-SVG sparklines and the portfolio area chart. No libraries.

export function sparkline(values, { w = 64, h = 20, cls = "" } = {}) {
  const pts = values.filter(v => v != null);
  if (pts.length < 2) return "";
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  let x = 0;
  const step = w / (values.length - 1);
  const coords = [];
  values.forEach((v, i) => {
    if (v != null) coords.push(`${(i * step).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 4)).toFixed(1)}`);
  });
  const up = pts[pts.length - 1] >= pts[0];
  const color = up ? "var(--green)" : "var(--red)";
  return `<svg class="spark ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${coords.join(" ")}" stroke="${color}"/></svg>`;
}

// Filled area chart for the portfolio value history.
export function areaChart(points, { w = 320, h = 110 } = {}) {
  // points: [{date, value}]
  if (points.length < 2) return "";
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const xy = points.map((p, i) =>
    [i * step, h - 8 - ((p.value - min) / range) * (h - 24)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${h} ` + line + ` ${w},${h}`;
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "var(--green)" : "var(--red)";
  const fmt = v => v >= 100 ? "$" + Math.round(v).toLocaleString("en-US") : "$" + v.toFixed(2);
  return `<svg width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".35"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#ag)"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/>
  </svg>
  <div style="display:flex;justify-content:space-between;font-size:.62rem" class="dim">
    <span>${points[0].date.slice(5)}</span>
    <span>HI ${fmt(max)} · LO ${fmt(min)}</span>
    <span>${points[points.length - 1].date.slice(5)}</span>
  </div>`;
}
