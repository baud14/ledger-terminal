// Toasts + confetti celebrations.

export function toast(msg, ms = 4200) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const CONFETTI = ["🎉", "✨", "💰", "📈", "⭐", "🔥"];

export function confetti(n = 26) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div");
    el.className = "confetti";
    el.textContent = CONFETTI[i % CONFETTI.length];
    el.style.left = Math.random() * 100 + "vw";
    el.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
    el.style.animationDelay = Math.random() * 0.5 + "s";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
}
