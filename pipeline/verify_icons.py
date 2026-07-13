#!/usr/bin/env python3
"""Verify every icons.json id exists on TCGdex and has a usable price."""
import json
import os
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://api.tcgdex.net/v2/en/cards/"

with open(os.path.join(HERE, "icons.json")) as f:
    cards = json.load(f)["cards"]

ok, no_price, missing = [], [], []
for c in cards:
    cid = c["id"]
    try:
        req = urllib.request.Request(API + cid, headers={"User-Agent": "ledger-terminal-pipeline/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.load(r)
        tp = (d.get("pricing") or {}).get("tcgplayer") or {}
        px = None
        for v in ("holofoil", "1st-edition-holofoil", "normal", "reverse-holofoil", "1st-edition"):
            if isinstance(tp.get(v), dict) and tp[v].get("marketPrice"):
                px = tp[v]["marketPrice"]
                break
        if px:
            ok.append((cid, d.get("name"), px))
        else:
            no_price.append((cid, d.get("name"), c["label"]))
    except Exception as e:  # noqa: BLE001
        missing.append((cid, c["label"], str(e)[:60]))
    time.sleep(0.25)

print(f"OK ({len(ok)}):")
for cid, name, px in ok:
    print(f"  {cid:<22} {name:<28} ${px}")
print(f"\nNO PRICE ({len(no_price)}):")
for cid, name, label in no_price:
    print(f"  {cid:<22} {name} — {label}")
print(f"\nMISSING ({len(missing)}):")
for cid, label, err in missing:
    print(f"  {cid:<22} {label} — {err}")
