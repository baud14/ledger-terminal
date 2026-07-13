// NEWS — the wire.

import { getNews } from "../api/data.js";
import { esc } from "../ui/format.js";

export async function renderNews(el) {
  const news = await getNews();
  const items = news.items || [];
  el.innerHTML = `
    <div class="hdr">THE WIRE</div>
    ${items.length ? items.map(i => `<div class="news-item">
        <a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.t)}</a>
        <div class="nsub">${esc(i.source || "")}${i.date ? " · " + esc(new Date(i.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : ""}</div>
      </div>`).join("")
      : `<div class="empty"><div class="big">WIRE SILENT</div></div>`}`;
}
