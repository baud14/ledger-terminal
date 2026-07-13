#!/usr/bin/env python3
"""Ledger Terminal — daily data pipeline.

Pulls the tracked Pokémon TCG card universe from TCGdex (free, no key),
snapshots prices, and derives the JSON artifacts the PWA reads from
docs/data/. Stdlib only — no third-party packages.

Usage:
  python3 update.py                 # full daily run
  python3 update.py --limit-sets 2  # dev run (small universe)
  python3 update.py --fake-yesterday  # copy today's snapshot to yesterday,
                                       # perturbed, to test real movers
  python3 update.py --skip-news     # skip the news fetch
"""

import argparse
import gzip
import json
import os
import random
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

API = "https://api.tcgdex.net/v2/en"
UA = "ledger-terminal-pipeline/1.0 (personal hobby project)"
RATE_DELAY = 0.25  # 4 req/s
RECENT_SETS = 10
SNAPSHOT_RETENTION_DAYS = 400
MAX_FAIL_FRACTION = 0.05
MOVERS_PRICE_FLOOR = 1.00
MOVERS_TOP_N = 20
SPARK_POINTS = 8
EUR_USD = 1.17  # rough conversion for cards with only Cardmarket data (flagged pxv="eur-est")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(ROOT, "pipeline")
SNAP_DIR = os.path.join(PIPELINE, "snapshots")
STATE_DIR = os.path.join(PIPELINE, "state")
DATA_DIR = os.path.join(ROOT, "docs", "data")

_last_request = [0.0]


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def http_get(url, timeout=20, retries=3):
    """Throttled GET with exponential backoff. Returns bytes or raises."""
    wait = RATE_DELAY - (time.monotonic() - _last_request[0])
    if wait > 0:
        time.sleep(wait)
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                _last_request[0] = time.monotonic()
                return resp.read()
        except Exception as e:  # noqa: BLE001 — retry anything transient
            last_err = e
            _last_request[0] = time.monotonic()
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise last_err if last_err else RuntimeError(f"GET failed: {url}")


def get_json(url, **kw):
    return json.loads(http_get(url, **kw).decode("utf-8"))


def atomic_write(path, data_bytes):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data_bytes)
    os.replace(tmp, path)


def write_json(path, obj):
    atomic_write(path, json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


# ---------------------------------------------------------------- sets

def load_set_cache():
    path = os.path.join(STATE_DIR, "sets_cache.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_set_cache(cache):
    write_json(os.path.join(STATE_DIR, "sets_cache.json"), cache)


def fetch_all_sets():
    """Return list of set detail dicts (physical TCG only, with releaseDate)."""
    briefs = get_json(f"{API}/sets")
    cache = load_set_cache()
    details = []
    fetched = 0
    for brief in briefs:
        sid = brief["id"]
        cached = cache.get(sid)
        # Re-fetch uncached sets, and recently released/future sets whose card
        # lists may still be growing (cache entries carry a fetchedAt stamp).
        needs_fetch = cached is None
        if cached and cached.get("releaseDate"):
            rel = cached["releaseDate"]
            fresh_window = (date.today() - timedelta(days=45)).isoformat()
            if rel >= fresh_window:
                needs_fetch = True
        if needs_fetch:
            try:
                d = get_json(f"{API}/sets/{sid}")
            except Exception as e:  # noqa: BLE001
                log(f"  WARN set {sid} fetch failed: {e}")
                continue
            cached = {
                "id": sid,
                "name": d.get("name"),
                "releaseDate": d.get("releaseDate"),
                "serie": (d.get("serie") or {}).get("id"),
                "serieName": (d.get("serie") or {}).get("name"),
                "logo": d.get("logo"),
                "cardCount": (d.get("cardCount") or {}).get("total"),
                "cards": [
                    {"id": c["id"], "localId": c.get("localId"),
                     "name": c.get("name"), "image": c.get("image")}
                    for c in d.get("cards", [])
                ],
            }
            cache[sid] = cached
            fetched += 1
        if not cached:
            continue
        if cached.get("serie") == "tcgp":  # Pokémon TCG Pocket (mobile game)
            continue
        if not cached.get("releaseDate"):
            continue
        details.append(cached)
    save_set_cache(cache)
    log(f"sets: {len(details)} physical sets ({fetched} fetched fresh)")
    return details


# ---------------------------------------------------------------- cards

def extract_record(card):
    """Compact per-card record for snapshots/catalog."""
    pricing = card.get("pricing") or {}
    tp = pricing.get("tcgplayer") or {}
    cm = pricing.get("cardmarket") or {}
    p = {}
    for variant in ("normal", "holofoil", "reverse-holofoil", "1st-edition-holofoil", "1st-edition"):
        v = tp.get(variant)
        if isinstance(v, dict) and v.get("marketPrice") is not None:
            p[variant] = round(v["marketPrice"], 2)
    px, pxv = None, None
    for variant in ("holofoil", "1st-edition-holofoil", "normal", "reverse-holofoil", "1st-edition"):
        if variant in p:
            px, pxv = p[variant], variant
            break
    eur = {k: cm.get(k) for k in ("avg", "trend", "avg1", "avg7", "avg30") if cm.get(k) is not None}
    trend = eur.get("trend")
    if px is None and trend:
        # No USD market price (old/promo cards) — estimate from Cardmarket trend.
        px, pxv = round(trend * EUR_USD, 2), "eur-est"
    st = card.get("set") or {}
    return {
        "id": card["id"],
        "n": card.get("name"),
        "set": st.get("id"),
        "num": card.get("localId"),
        "r": card.get("rarity"),
        "img": card.get("image"),
        "px": px,
        "pxv": pxv,
        "p": p or None,
        "eur": eur or None,
    }


def fetch_universe(card_ids, prev_by_id):
    records, failed = [], []
    total = len(card_ids)
    for i, cid in enumerate(card_ids):
        if i and i % 250 == 0:
            log(f"  cards {i}/{total} ({len(failed)} failed)")
        try:
            records.append(extract_record(get_json(f"{API}/cards/{cid}")))
        except Exception:  # noqa: BLE001
            if cid in prev_by_id:
                records.append(prev_by_id[cid])  # carry forward yesterday
            failed.append(cid)
    if total and len(failed) / total > MAX_FAIL_FRACTION:
        raise RuntimeError(f"{len(failed)}/{total} card fetches failed (> {MAX_FAIL_FRACTION:.0%}) — aborting")
    if failed:
        log(f"  WARN {len(failed)} card fetches failed (carried forward where possible): {failed[:10]}")
    return records


# ---------------------------------------------------------------- snapshots

def snapshot_path(d):
    return os.path.join(SNAP_DIR, f"{d.isoformat()}.json.gz")


def write_snapshot(d, records):
    atomic_write(snapshot_path(d), gzip.compress(
        json.dumps(records, separators=(",", ":")).encode("utf-8")))


def load_snapshot(d):
    path = snapshot_path(d)
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt") as f:
        return {r["id"]: r for r in json.load(f)}


def available_snapshot_dates():
    dates = []
    for name in os.listdir(SNAP_DIR):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})\.json\.gz$", name)
        if m:
            dates.append(date.fromisoformat(m.group(1)))
    return sorted(dates)


def nearest_snapshot(target, dates, tolerance_days=3):
    """Closest snapshot date <= target within tolerance, else None."""
    candidates = [d for d in dates if d <= target and (target - d).days <= tolerance_days]
    return max(candidates) if candidates else None


def prune_snapshots():
    cutoff = date.today() - timedelta(days=SNAPSHOT_RETENTION_DAYS)
    for d in available_snapshot_dates():
        if d < cutoff:
            os.remove(snapshot_path(d))


# ---------------------------------------------------------------- derived

def spark_series(card_id, spark_dates, snaps_by_date):
    series = []
    for d in spark_dates:
        rec = snaps_by_date[d].get(card_id)
        series.append(rec["px"] if rec and rec.get("px") is not None else None)
    # need at least 2 real points to be worth drawing
    return series if sum(v is not None for v in series) >= 2 else []


def mover_entry(rec, prev_px, set_names, spark, est=False):
    px = rec["px"]
    delta = round(px - prev_px, 2)
    pct = round((px - prev_px) / prev_px * 100, 1)
    e = {
        "id": rec["id"], "n": rec["n"], "set": rec["set"],
        "setName": set_names.get(rec["set"], rec["set"]),
        "num": rec["num"], "img": rec["img"],
        "px": px, "pxv": rec["pxv"],
        "prev": round(prev_px, 2), "delta": delta, "pct": pct,
        "spark": spark,
    }
    if est:
        e["est"] = True
    return e


def compute_movers(today_recs, prev_map, week_map, icon_ids, set_names,
                   spark_dates, snaps_by_date):
    """Returns {dod: {gainers, losers}, wow: {...}} with bootstrap fallback."""
    out = {}
    for key, ref_map, cm_ref in (("dod", prev_map, "avg7"), ("wow", week_map, "avg30")):
        entries = []
        estimated = ref_map is None
        for rec in today_recs:
            px = rec.get("px")
            if px is None:
                continue
            if px < MOVERS_PRICE_FLOOR and rec["id"] not in icon_ids:
                continue
            prev_px = None
            if not estimated:
                prev = ref_map.get(rec["id"])
                if prev and prev.get("px"):
                    prev_px = prev["px"]
            else:
                # Bootstrap: estimate change from Cardmarket short-vs-long averages.
                eur = rec.get("eur") or {}
                recent = eur.get("avg1") if key == "dod" else eur.get("avg7")
                baseline = eur.get(cm_ref)
                if recent and baseline and baseline > 0:
                    ratio = recent / baseline
                    if 0.2 < ratio < 5:  # discard garbage ratios
                        prev_px = px / ratio
            if not prev_px or prev_px <= 0:
                continue
            pct = (px - prev_px) / prev_px * 100
            if abs(pct) < 0.05:
                continue
            # Estimated (Cardmarket-ratio) changes are noisy on low-volume
            # vintage cards — clamp to plausible daily/weekly moves.
            if estimated and abs(pct) > 30:
                continue
            spark = spark_series(rec["id"], spark_dates, snaps_by_date)
            entries.append(mover_entry(rec, prev_px, set_names, spark, est=estimated))
        entries.sort(key=lambda e: (abs(e["pct"]), abs(e["delta"])), reverse=True)
        gainers = [e for e in entries if e["pct"] > 0][:MOVERS_TOP_N]
        losers = [e for e in entries if e["pct"] < 0][:MOVERS_TOP_N]
        out[key] = {"gainers": gainers, "losers": losers, "est": estimated}
    return out


def board_card(rec, set_names):
    return {"id": rec["id"], "n": rec["n"], "set": rec["set"],
            "setName": set_names.get(rec["set"], rec["set"]),
            "num": rec["num"], "r": rec["r"], "img": rec["img"],
            "px": rec["px"], "pxv": rec["pxv"]}


# ---------------------------------------------------------------- news

def parse_rss(xml_bytes, source):
    items = []
    root = ET.fromstring(xml_bytes)
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        if title and link:
            items.append({"t": re.sub(r"<[^>]+>", "", title), "link": link,
                          "date": pub, "source": source})
    return items


def fetch_news():
    sources = [
        ("PokeBeach", "https://www.pokebeach.com/feed"),
        ("Google News", "https://news.google.com/rss/search?q=Pokemon+TCG+cards&hl=en-US&gl=US&ceid=US:en"),
    ]
    for name, url in sources:
        try:
            items = parse_rss(http_get(url, timeout=15), name)
            if items:
                log(f"news: {len(items)} items from {name}")
                return items[:20]
        except Exception as e:  # noqa: BLE001
            log(f"  news source {name} failed: {e}")
    return []


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-sets", type=int, default=None)
    ap.add_argument("--skip-news", action="store_true")
    ap.add_argument("--fake-yesterday", action="store_true")
    args = ap.parse_args()

    os.makedirs(SNAP_DIR, exist_ok=True)
    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    today = date.today()
    log(f"Ledger Terminal pipeline — {today}")

    # 1. Sets
    all_sets = fetch_all_sets()

    def is_expansion(s):
        n = s["name"].lower()
        return "promo" not in n and "energy" not in n

    released = sorted([s for s in all_sets if s["releaseDate"] <= today.isoformat() and is_expansion(s)],
                      key=lambda s: s["releaseDate"], reverse=True)
    future = sorted([s for s in all_sets if s["releaseDate"] > today.isoformat()],
                    key=lambda s: s["releaseDate"])
    n_recent = args.limit_sets or RECENT_SETS
    recent_sets = released[:n_recent]
    set_names = {s["id"]: s["name"] for s in all_sets}
    log(f"universe sets: {[s['id'] for s in recent_sets]}")

    # 2. Universe card ids
    with open(os.path.join(PIPELINE, "icons.json")) as f:
        icons_cfg = json.load(f)
    icon_ids = [c["id"] for c in icons_cfg["cards"]]
    icon_labels = {c["id"]: c.get("label") for c in icons_cfg["cards"]}
    universe_ids, seen = [], set()
    for s in recent_sets:
        for c in s["cards"]:
            if c["id"] not in seen:
                seen.add(c["id"])
                universe_ids.append(c["id"])
    for cid in icon_ids:
        if cid not in seen:
            seen.add(cid)
            universe_ids.append(cid)
    log(f"universe: {len(universe_ids)} cards ({len(icon_ids)} icons)")

    # 3. Fetch + snapshot
    snap_dates_before = available_snapshot_dates()
    prev_date = nearest_snapshot(today - timedelta(days=1), snap_dates_before)
    prev_by_id = load_snapshot(prev_date) if prev_date else {}
    t0 = time.time()
    records = fetch_universe(universe_ids, prev_by_id)
    log(f"fetched {len(records)} records in {time.time() - t0:.0f}s")
    write_snapshot(today, records)

    if args.fake_yesterday:
        fake = []
        rng = random.Random(42)
        for r in records:
            r2 = dict(r)
            if r2.get("px"):
                r2["px"] = round(r2["px"] * rng.uniform(0.9, 1.1), 2)
            fake.append(r2)
        write_snapshot(today - timedelta(days=1), fake)
        log("wrote perturbed --fake-yesterday snapshot")

    # 4. Derived artifacts
    snap_dates = available_snapshot_dates()
    prev_date = nearest_snapshot(today - timedelta(days=1), snap_dates_before if not args.fake_yesterday else snap_dates)
    week_date = nearest_snapshot(today - timedelta(days=7), snap_dates)
    if week_date == today:
        week_date = None
    prev_map = load_snapshot(prev_date) if (prev_date and prev_date != today) else None
    week_map = load_snapshot(week_date) if week_date else None
    spark_dates = [d for d in snap_dates if d <= today][-SPARK_POINTS:]
    snaps_by_date = {d: (load_snapshot(d) or {}) for d in spark_dates}

    movers = compute_movers(records, prev_map, week_map, set(icon_ids),
                            set_names, spark_dates, snaps_by_date)
    write_json(os.path.join(DATA_DIR, "movers.json"),
               {"asOf": today.isoformat(), **movers})

    by_id = {r["id"]: r for r in records}
    recent_boards = []
    for s in recent_sets:
        cards = [by_id[c["id"]] for c in s["cards"] if c["id"] in by_id]
        top = sorted([c for c in cards if c.get("px")], key=lambda c: c["px"], reverse=True)[:10]
        recent_boards.append({"setId": s["id"], "setName": s["name"],
                              "releaseDate": s["releaseDate"], "logo": s.get("logo"),
                              "cardCount": s.get("cardCount"),
                              "top": [board_card(c, set_names) for c in top]})
    icons_board = []
    for cid in icon_ids:
        r = by_id.get(cid)
        if r and r.get("px"):
            e = board_card(r, set_names)
            e["label"] = icon_labels.get(cid)
            icons_board.append(e)
    icons_board.sort(key=lambda c: c["px"], reverse=True)
    write_json(os.path.join(DATA_DIR, "boards.json"),
               {"asOf": today.isoformat(), "recentSets": recent_boards, "icons": icons_board})

    # sets.json — API future sets merged with manual overrides (manual wins)
    with open(os.path.join(PIPELINE, "upcoming_manual.json")) as f:
        manual = json.load(f)["upcoming"]
    upcoming = {u["name"].lower(): u for u in [
        {"name": s["name"], "releaseDate": s["releaseDate"], "id": s["id"], "logo": s.get("logo")}
        for s in future]}
    for m in manual:
        if m["releaseDate"] >= today.isoformat():
            upcoming[m["name"].lower()] = {**upcoming.get(m["name"].lower(), {}), **m}
    upcoming_list = sorted(upcoming.values(), key=lambda u: u["releaseDate"])
    write_json(os.path.join(DATA_DIR, "sets.json"), {
        "asOf": today.isoformat(),
        "upcoming": upcoming_list,
        "recent": [{"id": s["id"], "name": s["name"], "releaseDate": s["releaseDate"],
                    "logo": s.get("logo"), "cardCount": s.get("cardCount")}
                   for s in recent_sets]})

    # news.json
    if not args.skip_news:
        items = fetch_news()
        write_json(os.path.join(DATA_DIR, "news.json"),
                   {"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "items": items})

    # catalog-lite.json — offline/CORS-fallback search index
    write_json(os.path.join(DATA_DIR, "catalog-lite.json"),
               [{"id": r["id"], "n": r["n"], "set": r["set"],
                 "setName": set_names.get(r["set"], r["set"]),
                 "num": r["num"], "r": r["r"], "img": r["img"],
                 "px": r["px"], "pxv": r["pxv"]} for r in records])

    write_json(os.path.join(DATA_DIR, "meta.json"), {
        "schemaVersion": 1,
        "lastUpdated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "universe": {"sets": len(recent_sets), "cards": len(records)},
        "snapshotDays": len(snap_dates),
    })

    prune_snapshots()
    log("done — artifacts written to docs/data/")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"FATAL: {e}")
        sys.exit(1)
