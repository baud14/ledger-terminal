// LEARN — Trading Floor 101: why cards are worth money, with tap quizzes.

import { esc } from "../ui/format.js";

let lessons = null;

export async function renderLearn(el) {
  if (!lessons) {
    const resp = await fetch("./learn/lessons.json");
    lessons = await resp.json();
  }
  el.innerHTML = `
    <div class="hdr">TRADING FLOOR 101</div>
    <div class="dim" style="font-size:.72rem;margin-bottom:10px">Everything a card trader needs to know. Tap a module.</div>
    ${lessons.modules.map((m, i) => `
      <details class="lesson">
        <summary>${String(i + 1).padStart(2, "0")} · ${esc(m.title.toUpperCase())}</summary>
        <div class="lbody">
          ${m.body.map(p => `<p>${p}</p>`).join("")}
          ${(m.quiz || []).map((qz, qi) => `
            <div class="quiz-q" data-mod="${i}" data-q="${qi}">
              <div style="font-weight:700;font-size:.78rem">🧠 ${esc(qz.q)}</div>
              ${qz.options.map((o, oi) => `<button class="qopt" data-correct="${oi === qz.answer}">${esc(o)}</button>`).join("")}
            </div>`).join("")}
        </div>
      </details>`).join("")}`;

  el.querySelectorAll(".qopt").forEach(btn => {
    btn.addEventListener("click", () => {
      const box = btn.closest(".quiz-q");
      box.querySelectorAll(".qopt").forEach(b => {
        b.classList.remove("right", "wrong");
        if (b.dataset.correct === "true") b.classList.add("right");
      });
      if (btn.dataset.correct !== "true") btn.classList.add("wrong");
    });
  });
}
