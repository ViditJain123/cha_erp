#!/usr/bin/env python3
"""
Fetches the ICEGATE ERAM exchange rate tables into masters-source/eram/.

## Why this exists

CBIC stopped notifying exchange rates as Customs (N.T.) notifications on
**20 June 2024**. From **4 July 2024** they are published by the Exchange Rate
Automation Module on ICEGATE -- 22 currencies, 18:00 on the first and third
Thursday of the month, effective from midnight the following day (Circular
07/2024-Customs). A parser that only reads notifications therefore stops dead
in mid-2024, and every Bill of Entry filed since would convert at a rate that
was superseded years ago.

## The endpoint

    POST https://foservices.icegate.gov.in/cbu/icegateapi/igexratesubscribe
    {"currencyCode": "ALL", "currencyDate": "DD-MM-YYYY"}

Unauthenticated, no API key, and no captcha -- the captcha on
`foservices.icegate.gov.in/#/services/viewExchangeRate` gates the *form*, not
the service, and is not part of the request. The response gives the table in
force on that date:

    {"status": 1, "notStartDate": "05-09-2026",
     "currencyDetail": [{"currencyCode": "JPY", "cbicImport": 62.45,
                         "cbicExport": 60.55, "units": "100.0"}, ...]}

`units` is the thing to respect: ICEGATE quotes the yen and the won per **100**
units, and says so in the field rather than leaving it to a schedule heading.
We store per single unit, so everything is divided by `units` before it is
written.

`notEndDate` in the response is not an end date -- it comes back as the day
before `notStartDate` -- so windows are derived from the next table's start by
`build-exchange-rates.py` instead.

## How it probes

Every date from 2024-07-05 to today, because a fortnightly schedule is a
convention and not a guarantee: a correction issued mid-window would be
invisible to a fortnightly probe. `probed.json` remembers which dates have been
asked, so a re-run only pays for the days since the last one.

Run:  python3 packages/core/scripts/fetch-eram.py
      python3 packages/core/scripts/fetch-eram.py --refetch   (ignore the cache)
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "masters-source" / "eram"
CACHE = OUT / "probed.json"

URL = "https://foservices.icegate.gov.in/cbu/icegateapi/igexratesubscribe"
# ERAM's first publication was 4 July 2024, effective from the following
# midnight. Nothing before this date has an answer here; that era belongs to
# the notification parse.
START = date(2024, 7, 5)
WORKERS = 4


def probe(d: date) -> dict | None:
    """The table in force on `d`, or None when ICEGATE has nothing for it."""
    body = json.dumps({"currencyCode": "ALL", "currencyDate": d.strftime("%d-%m-%Y")})
    req = urllib.request.Request(
        URL,
        data=body.encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode()
            if not text.strip():
                return None
            payload = json.loads(text)
            if payload.get("status") != 1 or not payload.get("currencyDetail"):
                return None
            return payload
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == 2:
                return None
            time.sleep(2 * (attempt + 1))
    return None


def iso(ddmmyyyy: str) -> str:
    d, m, y = ddmmyyyy.split("-")
    return f"{y}-{m}-{d}"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    refetch = "--refetch" in sys.argv
    cache: dict[str, str | None] = (
        {} if refetch or not CACHE.exists() else json.loads(CACHE.read_text())
    )

    today = date.today()
    days = [START + timedelta(days=i) for i in range((today - START).days + 1)]
    todo = [d for d in days if d.isoformat() not in cache]
    print(f"{len(days)} days in range, {len(todo)} to probe")

    tables: dict[str, dict] = {}

    def work(d: date) -> tuple[date, dict | None]:
        return d, probe(d)

    if todo:
        done = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for d, payload in pool.map(work, todo):
                done += 1
                if done % 50 == 0:
                    print(f"  probed {done}/{len(todo)}")
                if not payload:
                    cache[d.isoformat()] = None
                    continue
                start = iso(payload["notStartDate"])
                cache[d.isoformat()] = start
                if start not in tables:
                    tables[start] = payload
        CACHE.write_text(json.dumps(dict(sorted(cache.items())), indent=0) + "\n")

    # Any window the cache knows about but has no file for — a first run writes
    # them all, a later run writes only what is new.
    known = {v for v in cache.values() if v}
    for start in sorted(known):
        f = OUT / f"{start}.json"
        if f.exists() and not refetch:
            continue
        payload = tables.get(start)
        if payload is None:
            payload = probe(date.fromisoformat(start))
            if not payload:
                print(f"  ! could not re-fetch {start}")
                continue
        rates = {}
        for c in payload["currencyDetail"]:
            units = float(c.get("units") or 1) or 1.0
            rates[c["currencyCode"]] = {
                "import": round(float(c["cbicImport"]) / units, 8),
                "export": round(float(c["cbicExport"]) / units, 8),
            }
        f.write_text(
            json.dumps(
                {
                    "effectiveFrom": start,
                    "source": f"ICEGATE ERAM {start}",
                    "rates": dict(sorted(rates.items())),
                },
                indent=1,
            )
            + "\n"
        )
        print(f"  wrote {f.name} ({len(rates)} currencies)")

    files = sorted(OUT.glob("2*.json"))
    print(f"{len(files)} ERAM tables in {OUT.relative_to(ROOT)}")
    if files:
        print(f"  {files[0].stem} .. {files[-1].stem}")


if __name__ == "__main__":
    main()
