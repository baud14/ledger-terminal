// Tiny hash router.

const routes = {};
let current = null;

export function register(name, renderFn) { routes[name] = renderFn; }

export function currentRoute() { return current; }

async function render() {
  const hash = location.hash.replace(/^#\//, "") || "home";
  const name = routes[hash] ? hash : "home";
  current = name;
  document.querySelectorAll("#tabbar a").forEach(a =>
    a.classList.toggle("active", a.dataset.tab === name));
  const screen = document.getElementById("screen");
  screen.innerHTML = `<div class="dim" style="padding:30px;text-align:center">LOADING…</div>`;
  try {
    await routes[name](screen);
  } catch (e) {
    screen.innerHTML = `<div class="empty"><div class="big">TERMINAL ERROR</div>
      <div class="dim" style="font-size:.75rem">${e.message}</div></div>`;
  }
  screen.scrollTop = 0;
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}

export function navigate(name) { location.hash = "#/" + name; }
