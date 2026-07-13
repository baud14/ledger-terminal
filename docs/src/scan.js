// LDGR VISION — point the camera at a card, identify it, add it.
// Fully on-device: photo -> Tesseract OCR (vendored) -> match against the
// catalog on collector number ("238/191") + fuzzy name. Nothing is uploaded.
// Also exports quickMatch() for the typed "CARD #" quick-add on MY CARDS.

import { searchCards } from "./api/tcgdex.js";
import { loadScanIndex, hydrate, priceMap } from "./api/catalog.js";
import { cardRow, showCardModal } from "./ui/cards.js";
import { esc } from "./ui/format.js";

// ------------------------------------------------------------ matching

const normNum = s => String(s ?? "").toUpperCase().replace(/^0+(?=.)/, "");
const normName = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    out.set(b, (out.get(b) || 0) + 1);
  }
  return out;
}

// Dice bigram similarity, 0..1
function dice(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigrams(a), bb = bigrams(b);
  let overlap = 0, na = 0, nb = 0;
  for (const v of ba.values()) na += v;
  for (const v of bb.values()) nb += v;
  for (const [g, v] of ba) overlap += Math.min(v, bb.get(g) || 0);
  return na + nb ? (2 * overlap) / (na + nb) : 0;
}

const NUM_MATCH = 3;      // collector number matched
const TOT_BONUS = 2.5;    // ...and the printed total matched too -> 5.5
const NAME_WEIGHT = 2;    // name similarity contributes up to this

// Score the whole scan index (~21k compact rows) against what we read off the
// card. Rows stay compact here; only the winners get hydrated into cards.
function scoreIndex(idx, { collectors = [], names = [] }, limit = 12) {
  const scored = [];
  for (const row of idx.cards) {
    const localId = row[1], name = row[2];
    const cn = normNum(localId);
    const setTot = idx.sets[row[0]]?.t;
    let s = 0;
    for (const col of collectors) {
      if (cn === normNum(col.num)) {
        const totOk = col.tot != null && setTot != null && Number(col.tot) === Number(setTot);
        s = Math.max(s, NUM_MATCH + (totOk ? TOT_BONUS : 0));
      }
    }
    // Damp very short card names: OCR picks up stray words from the rules text
    // ("will", "item"), which score a perfect match against short-named cards
    // and would otherwise outrank the real Pokémon name.
    let bestName = 0;
    for (const n of names) bestName = Math.max(bestName, dice(n, name));
    if (bestName >= 0.45) {
      s += NAME_WEIGHT * bestName * Math.min(1, (name || "").length / 6);
    }
    if (s > 0) scored.push({ row, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Hydrate the winners, attaching a price where we track one.
async function hydrateTop(idx, scored) {
  const px = await priceMap().catch(() => new Map());
  return scored.map(({ row, score }) => {
    const card = hydrate(idx, row, px.get(`${row[0]}-${row[1]}`) ?? null);
    return { card, score };
  });
}

// OCR often glues a stray letter onto the numerator ("V4/102" for 4/102), so
// for SCANNED numbers we also try the digits-only form. Never do this for a
// number the user typed — "SV107" is a real promo id, and stripping it to "107"
// would match every card numbered 107 in every set.
function collectorVariants(numRaw, tot) {
  const out = [{ num: numRaw, tot }];
  const digits = String(numRaw).replace(/\D/g, "");
  if (digits && digits !== numRaw) out.push({ num: digits, tot });
  return out;
}

// Typed quick-add: "238/191", "086/159", "sv107", "238", "pikachu 85/108"
export async function quickMatch(input, limit = 5) {
  const idx = await loadScanIndex();
  const collectors = [];
  const frac = input.match(/([A-Za-z]{0,4}\s?\d{1,3})\s*\/\s*(\d{1,3})/);
  let rest = input;
  if (frac) {
    collectors.push({
      num: frac[1].replace(/\s/g, ""),
      tot: parseInt(frac[2], 10) || null,
    });
    rest = input.replace(frac[0], " ");
  } else {
    const bare = input.trim().match(/^([A-Za-z]{0,4}\d{1,4})$/);
    if (bare) { collectors.push({ num: bare[1], tot: null }); rest = ""; }
  }
  const names = normName(rest) ? [rest] : [];
  const scored = scoreIndex(idx, { collectors, names }, limit * 3)
    .filter(x => x.score >= (collectors.length ? NUM_MATCH : 0.9));
  return (await hydrateTop(idx, scored)).slice(0, limit).map(x => x.card);
}

// ------------------------------------------------------------ OCR text parsing

// Words that appear in card rules text. Left in, they get matched against
// real (short) card names — a stray "will" scored a perfect hit on the Trainer
// card "Will" and outranked the actual Pokémon.
const STOPWORDS = new Set([
  "pokemon", "basic", "stage", "stage1", "stage2", "evolves", "evolve", "from",
  "trainer", "supporter", "item", "stadium", "energy", "ability", "weakness",
  "resistance", "retreat", "illus", "damage", "attack", "attacks", "this",
  "your", "each", "when", "then", "with", "that", "will", "would", "could",
  "card", "cards", "into", "onto", "coin", "flip", "heads", "tails", "more",
  "them", "they", "their", "than", "does", "have", "opponent", "opponents",
  "active", "bench", "benched", "during", "turn", "once", "search", "deck",
  "discard", "hand", "shuffle", "draw", "prize", "prizes", "knocked", "attach",
  "attached", "effect", "instead", "before", "after", "between", "choose",
  "chosen", "other", "another", "only", "also", "take", "takes", "play",
  "played", "counter", "counters", "remove", "removes", "heal", "asleep",
  "confused", "paralyzed", "poisoned", "burned", "reveal", "revealed", "put",
  "place", "placed", "return", "returns", "cost", "full", "level", "rule",
  "used", "using", "number", "total", "same", "next", "until", "still",
]);

// Collector numbers ("238/191", "4/102") out of a number-region OCR pass.
// The card number is tiny, so this text comes from an upscaled crop — never
// from the whole card (a full-frame pass never resolves it; measured).
function parseCollectors(text) {
  const out = [];
  const up = text.toUpperCase();
  const add = c => {
    if (!out.some(x => x.num === c.num && x.tot === c.tot)) out.push(c);
  };
  for (const m of up.matchAll(/([A-Z]{0,4}\s?\d{1,3})\s*\/\s*(\d{1,3})/g)) {
    const tot = parseInt(m[2], 10) || null;
    collectorVariants(m[1].replace(/\s/g, ""), tot).forEach(add);
  }
  // promo ids printed without a denominator (SV107, GG69, TG12)
  for (const m of up.matchAll(/\b([A-Z]{2,4}\d{1,3})\b/g)) add({ num: m[1], tot: null });
  return out;
}

function parseNames(text) {
  const names = new Set();
  for (const rawLine of text.split("\n")) {
    const tokens = rawLine.trim().split(/[^A-Za-z]+/)
      .filter(t => t.length >= 4 && !STOPWORDS.has(t.toLowerCase()));
    for (const t of tokens) names.add(t);
    if (tokens.length >= 2) names.add(tokens.slice(0, 2).join(" "));
  }
  return [...names].slice(0, 60);
}

function bestNameGuesses(names, catalogScores) {
  // prefer tokens that partially resembled a catalog name, longest first
  const ranked = [...names].sort((a, b) => b.length - a.length);
  const hinted = catalogScores.slice(0, 5).map(x => x.card.n);
  return [...new Set([...hinted, ...ranked])].slice(0, 3);
}

// ------------------------------------------------------------ OCR engine (lazy)

let tessPromise = null;

function loadTess(onProgress) {
  if (!tessPromise) {
    tessPromise = (async () => {
      // the vendored ESM build exposes everything on the default export
      const T = (await import("../vendor/tesseract/tesseract.esm.min.js")).default;
      const base = new URL("../vendor/tesseract/", import.meta.url).href;
      const worker = await T.createWorker("eng", 1, {
        workerPath: base + "worker.min.js",
        corePath: base,
        langPath: base.replace(/\/$/, ""),
        gzip: true,
        logger: m => onProgress?.(m),
      });
      return { worker, PSM: T.PSM };
    })();
    tessPromise.catch(() => { tessPromise = null; }); // allow retry after failure
  }
  return tessPromise;
}

// Crop a fractional box out of the source, upscale it toward `target` px wide,
// and threshold it. "stretch" = contrast stretch, "otsu" = binarize.
function cropCanvas(src, [fx, fy, fw, fh], target, mode) {
  const sx = Math.round(src.width * fx), sy = Math.round(src.height * fy);
  const sw = Math.round(src.width * fw), sh = Math.round(src.height * fh);
  const scale = Math.min(8, Math.max(0.2, target / sw));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);

  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const gray = new Float32Array(c.width * c.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  if (mode === "otsu") {
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = gray.length - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
      if (between > best) { best = between; thr = t; }
    }
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = gray[j] > thr ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else {
    let mn = 255, mx = 0;
    for (const v of gray) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = Math.max(1, mx - mn);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = ((gray[j] - mn) / range) * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function toSource(fileOrCanvas) {
  if (fileOrCanvas instanceof HTMLCanvasElement) return fileOrCanvas;
  return createImageBitmap(fileOrCanvas);
}

// The collector number is ~1% of the card's height — legible only in an
// upscaled crop, never in a full-frame pass. Every box below earned its place
// against real card scans: the wide band catches numbers printed over art
// (special-illustration rares), the tight bottom-left corner catches ordinary
// modern cards (a wider crop doesn't zoom enough and loses them), and the
// right-hand boxes catch vintage cards, which print the number bottom-right.
const NUM_PASSES = [
  { box: [0.00, 0.80, 1.00, 0.20], target: 1600, mode: "stretch" },
  { box: [0.00, 0.80, 1.00, 0.20], target: 1600, mode: "otsu" },
  { box: [0.02, 0.87, 0.32, 0.10], target: 1400, mode: "stretch" },
  { box: [0.02, 0.87, 0.32, 0.10], target: 1400, mode: "otsu" },
  { box: [0.45, 0.84, 0.55, 0.16], target: 1400, mode: "stretch" },
  { box: [0.62, 0.87, 0.36, 0.10], target: 1400, mode: "stretch" },
];
const NUM_WHITELIST = "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const NAME_PASSES = [
  { box: [0.00, 0.00, 1.00, 0.22], target: 1500, mode: "stretch" },
  { box: [0.00, 0.00, 1.00, 1.00], target: 1300, mode: "stretch" },
];

// Run every number pass and tally how many independent passes saw each number.
// A number only one pass saw is not trustworthy — measured: on a Base Set card
// one pass misread "4/102" as "94/102", and only the name broke the tie. So we
// keep every candidate and let agreement (and the name) decide.
async function readNumbers(src, worker, PSM, tick) {
  const seen = new Map(); // "num/tot" -> {num, tot, hits}
  for (let i = 0; i < NUM_PASSES.length; i++) {
    const p = NUM_PASSES[i];
    tick(i / NUM_PASSES.length);
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: NUM_WHITELIST,
    });
    const { data } = await worker.recognize(cropCanvas(src, p.box, p.target, p.mode));
    for (const c of parseCollectors(data.text || "")) {
      const key = `${c.num}/${c.tot ?? ""}`;
      const prev = seen.get(key);
      if (prev) prev.hits++;
      else seen.set(key, { ...c, hits: 1 });
    }
  }
  return [...seen.values()];
}

async function readNames(src, worker, PSM, tick) {
  const names = new Set();
  for (let i = 0; i < NAME_PASSES.length; i++) {
    const p = NAME_PASSES[i];
    tick(i / NAME_PASSES.length);
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "",
    });
    const { data } = await worker.recognize(cropCanvas(src, p.box, p.target, p.mode));
    for (const n of parseNames(data.text || "")) names.add(n);
  }
  return [...names];
}

// ------------------------------------------------------------ scanner UI

let activeStream = null;

function stopStream() {
  activeStream?.getTracks().forEach(t => t.stop());
  activeStream = null;
}

export async function openScanner() {
  const root = document.getElementById("modal-root");
  stopStream();
  root.innerHTML = `<div class="modal-back"><div class="modal scan-modal">
    <button class="close">✕</button>
    <div class="brand">LDGR VISION <span class="cursor"></span></div>
    <div class="dim" style="font-size:.68rem;margin:2px 0 10px">OPTICAL CARD SCAN — photo stays on this phone, never uploaded.</div>
    <div id="scan-stage"></div>
    <div id="scan-status"></div>
    <div id="scan-results"></div>
    <input type="file" id="scan-file-cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="scan-file-lib" accept="image/*" hidden>
  </div></div>`;

  const modalBack = root.querySelector(".modal-back");
  const close = () => { stopStream(); root.innerHTML = ""; };
  root.querySelector(".close").addEventListener("click", close);
  modalBack.addEventListener("click", e => { if (e.target === modalBack) close(); });
  window.addEventListener("hashchange", stopStream, { once: true });

  const stage = root.querySelector("#scan-stage");
  const camInput = root.querySelector("#scan-file-cam");
  const libInput = root.querySelector("#scan-file-lib");
  camInput.addEventListener("change", () => camInput.files[0] && identify(camInput.files[0], root));
  libInput.addEventListener("change", () => libInput.files[0] && identify(libInput.files[0], root));

  const fallbackButtons = () => {
    stage.innerHTML = `
      <button class="btn" id="scan-open-cam" style="width:100%">📷 OPEN CAMERA</button>
      <button class="btn ghost" id="scan-open-lib" style="width:100%;margin-top:8px">🖼 FROM PHOTO LIBRARY</button>
      <div class="dim" style="font-size:.62rem;margin-top:8px">Fill the frame with the card. Good light, no glare.</div>`;
    stage.querySelector("#scan-open-cam").addEventListener("click", () => camInput.click());
    stage.querySelector("#scan-open-lib").addEventListener("click", () => libInput.click());
  };

  // Live viewfinder where supported; file-input capture otherwise.
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no getUserMedia");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false,
    });
    activeStream = stream;
    stage.innerHTML = `
      <div class="scan-view">
        <video id="scan-video" autoplay playsinline muted></video>
        <div class="scan-guide"><div class="scan-line"></div></div>
      </div>
      <button class="btn" id="scan-snap" style="width:100%;margin-top:10px">◉ SNAP &amp; IDENTIFY</button>
      <button class="btn ghost" id="scan-open-lib" style="width:100%;margin-top:8px">🖼 FROM PHOTO LIBRARY</button>
      <div class="dim" style="font-size:.62rem;margin-top:8px">Line the card up inside the brackets. Good light, no glare.</div>`;
    const video = stage.querySelector("#scan-video");
    video.srcObject = stream;
    stage.querySelector("#scan-open-lib").addEventListener("click", () => libInput.click());
    stage.querySelector("#scan-snap").addEventListener("click", () => {
      const c = document.createElement("canvas");
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext("2d").drawImage(video, 0, 0);
      identify(c, root);
    });
  } catch {
    fallbackButtons();
  }
}

function setStatus(root, html) {
  const el = root.querySelector("#scan-status");
  if (el) el.innerHTML = html;
}

function progressBar(label, pct) {
  return `<div class="dim" style="font-size:.66rem;margin:8px 0 4px">${esc(label)}</div>
    <div class="scan-bar"><div style="width:${Math.round(pct * 100)}%"></div></div>`;
}

const OCR_LABEL = {
  "loading tesseract core": "LOADING OPTICS (one-time download)",
  "initializing tesseract": "CALIBRATING OPTICS",
  "loading language traineddata": "LOADING LEXICON (one-time download)",
  "initializing api": "CALIBRATING OPTICS",
  "recognizing text": "SCANNING CARD",
};

// Exported for the test harness: image -> ranked candidates, no DOM.
export async function identifyImage(input, onStatus = () => {}) {
  const src = await toSource(input);
  const [{ worker, PSM }, idx] = await Promise.all([loadTess(), loadScanIndex()]);

  onStatus("READING CARD NUMBER", 0);
  const collectors = await readNumbers(src, worker, PSM,
    p => onStatus("READING CARD NUMBER", p));

  let scored = scoreIndex(idx, { collectors, names: [] });
  let names = [];

  // Fast path: skip the slow full-card name passes only when the number is
  // beyond doubt — two independent passes agreed on it, total included, and it
  // lands on exactly one card. Anything less and we read the name to arbitrate.
  const trusted = collectors.some(c => c.tot != null && c.hits >= 2);
  const exact = scored.filter(x => x.score >= NUM_MATCH + TOT_BONUS);
  if (!(trusted && exact.length === 1)) {
    onStatus("READING CARD NAME", 0);
    names = await readNames(src, worker, PSM, p => onStatus("READING CARD NAME", p));
    scored = scoreIndex(idx, { collectors, names });
  }
  return { scored: await hydrateTop(idx, scored), names, collectors };
}

async function identify(input, root) {
  const results = root.querySelector("#scan-results");
  if (results) results.innerHTML = "";
  try {
    setStatus(root, progressBar("PREPARING IMAGE", 0.05));
    // warm the engine first so its download progress is what the user sees
    await loadTess(m => {
      const label = OCR_LABEL[m.status] || m.status?.toUpperCase() || "WORKING";
      setStatus(root, progressBar(label, m.progress ?? 0));
    });
    const { scored, names } = await identifyImage(input,
      (label, p) => setStatus(root, progressBar(label, p)));
    setStatus(root, "");
    await showMatches(root, scored, names);
  } catch (e) {
    setStatus(root, `<div class="dim" style="font-size:.72rem;margin-top:8px">⚠ SCAN FAILED — ${esc(e.message || "camera/OCR error")}. Try again, or type the card number on MY CARDS instead.</div>`);
  }
}

const NUM_HIT = 3;    // a collector-number match scores at least this
const NAME_ONLY = 1.1; // name similarity >= ~0.55 with no number read

async function showMatches(root, scored, names) {
  const results = root.querySelector("#scan-results");
  if (!results) return;

  const byNumber = scored.filter(x => x.score >= NUM_HIT);
  let top = byNumber.slice(0, 3).map(x => x.card);
  let header = "IS THIS YOUR CARD?";
  let note = "";

  if (!top.length) {
    // Number unreadable — fall back to name, and say so rather than pretending.
    const byName = scored.filter(x => x.score >= NAME_ONLY);
    if (byName.length) {
      top = byName.slice(0, 3).map(x => x.card);
      header = "COULDN’T READ THE CARD NUMBER";
      note = `<div class="dim" style="font-size:.62rem;padding:4px 0">Closest matches by name only — check the set and number before you add.</div>`;
    }
  }

  let liveNote = "";
  if (!top.length) {
    // not in the tracked universe — try the live exchange by name
    results.innerHTML = `<div class="dim" style="font-size:.7rem;padding:8px 0">NOT IN TRACKED UNIVERSE — CHECKING THE LIVE EXCHANGE…</div>`;
    for (const guess of bestNameGuesses(names, scored)) {
      const { results: hits, live } = await searchCards(guess, 6);
      if (live && hits.length) {
        top = hits.slice(0, 3).map(h => ({ ...h, px: h.px ?? null }));
        liveNote = `<div class="dim" style="font-size:.6rem;padding:4px 0">LIVE EXCHANGE MATCHES FOR “${esc(guess.toUpperCase())}”</div>`;
        break;
      }
      if (!live) break; // offline — no point trying more guesses
    }
  }

  if (!top.length) {
    results.innerHTML = `<div class="empty" style="margin-top:10px">
      <div class="big">SCAN INCONCLUSIVE</div>
      <div class="dim" style="font-size:.7rem">Get closer so the card fills the frame, avoid glare, and make sure the little number like 238/191 at the bottom is visible. Or add it by name search / card # on MY CARDS.</div>
    </div>
    <button class="btn ghost" id="scan-retry" style="width:100%;margin-top:10px">↻ SCAN AGAIN</button>`;
    results.querySelector("#scan-retry").addEventListener("click", () => openScanner());
    return;
  }

  results.innerHTML = `<div class="hdr">${header}</div>${note}${liveNote}
    <div class="panel" style="padding:2px 8px">
      ${top.map(c => cardRow(c, { sub: `${c.setName || c.set || "LIVE EXCHANGE"} · #${c.num || "?"}${c.tot ? "/" + c.tot : ""}` })).join("")}
    </div>
    <button class="btn ghost" id="scan-retry" style="width:100%;margin-top:10px">↻ NOT IT — SCAN AGAIN</button>`;
  results.querySelectorAll(".crow[data-card]").forEach(row =>
    row.addEventListener("click", () => { stopStream(); showCardModal(row.dataset.card); }));
  results.querySelector("#scan-retry").addEventListener("click", () => openScanner());
}
