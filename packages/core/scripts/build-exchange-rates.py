#!/usr/bin/env python3
"""
Regenerates src/masters/generated/exchange-rates.ts.

The rate of exchange that converts every foreign figure on a Bill of Entry into
rupees. Section 14 of the Customs Act fixes it by the **date the Bill of Entry
is presented**, so this master is a history of tables with effective windows,
not a current-rate lookup -- a BE filed today against a vessel that came in last
month converts at last month's rate.

## Two sources, and the seam between them

Until **20 June 2024** CBIC notified the rates as Customs (N.T.) notifications,
roughly fortnightly. Every one of them is in the committed corpus index and its
PDF is on disk, so that half is a deterministic offline parse.

From **4 July 2024** publication moved to the Exchange Rate Automation Module
(ERAM) on ICEGATE -- 22 currencies, published 18:00 on the first and third
Thursday of the month, effective from midnight the following day, per Circular
07/2024-Customs. There are no notifications after 45/2024 and there never will
be again, so a parser that only reads notifications stops dead in mid-2024.

ERAM tables are supplied by `fetch-eram.py` into masters-source/eram/*.json and
merged here. Where the two sources overlap, ERAM wins: it is the publisher.

## Why the window matters more than the rates

The previous master was a single hand-typed table with an `effectiveFrom` and no
end, so `exchangeRatesOn()` returned it for *any* date. That is how `liv_job1`
filed USD at 96.05 against a correct 86.20 -- about 11% on the assessable value
of every line, straight into the duty. Every table written here therefore
carries an explicit `effectiveTo`, and the file carries a `coverageEnd`: the
last date this master is entitled to answer for. Past it, the lookup returns
nothing and the export refuses, which is the only safe answer when the true
rate is unknown.

## The 100-unit trap

Schedule I is quoted per one unit of foreign currency; Schedule II is quoted per
**100** units. `100 JPY = 53.60` is `0.5360` per yen. We store per-unit
throughout, so the workbook shows 0.5360 where the notification says 53.60 --
correct, and not to be "fixed". Getting this backwards is a 100x error on the
assessable value that looks obviously wrong only if somebody checks.

Sources:
  data/customs-corpus/index/cbic-notifications.json   (committed)
  data/customs-corpus/notifications/*.pdf             (gitignored; fetch-corpus.py)
  packages/core/masters-source/eram/*.json            (committed; fetch-eram.py)

Run:  python3 packages/core/scripts/build-exchange-rates.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
INDEX = REPO / "data" / "customs-corpus" / "index" / "cbic-notifications.json"
PDFS = REPO / "data" / "customs-corpus" / "notifications"
ERAM = ROOT / "masters-source" / "eram"
OUT = ROOT / "src" / "masters" / "generated" / "exchange-rates.ts"

# The 22 currencies ERAM publishes, name as the notification prints it -> ISO
# code. Taken from the ERAM user manual v1.01 section 2, which lists exactly the
# same 22 in exactly the order Schedules I and II print them. Older
# notifications also carry currencies that have since been dropped from the
# list; those are here too, because a 2015 Bill of Entry is still a Bill of
# Entry and the master has to be able to answer for it.
CURRENCY_CODES = {
    "australian dollar": "AUD",
    "bahraini dinar": "BHD",
    "canadian dollar": "CAD",
    "chinese yuan": "CNY",
    "danish kroner": "DKK",
    "danish krone": "DKK",
    "euro": "EUR",
    "hong kong dollar": "HKD",
    "kuwaiti dinar": "KWD",
    "new zealand dollar": "NZD",
    "norwegian kroner": "NOK",
    "norwegian krone": "NOK",
    "pound sterling": "GBP",
    "qatari riyal": "QAR",
    "qatari rial": "QAR",
    "saudi arabian riyal": "SAR",
    "saudi arabian rial": "SAR",
    "singapore dollar": "SGD",
    "south african rand": "ZAR",
    "swedish kroner": "SEK",
    "swedish krona": "SEK",
    "swiss franc": "CHF",
    "turkish lira": "TRY",
    "uae dirham": "AED",
    "us dollar": "USD",
    "japanese yen": "JPY",
    "korean won": "KRW",
    # Retired from the list, present in older notifications.
    "deutsche mark": "DEM",
    "french franc": "FRF",
    "sri lankan rupee": "LKR",
    "malaysian ringgit": "MYR",
    "thai baht": "THB",
    "kenya shilling": "KES",
    "kenyan shilling": "KES",
}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}

# ERAM's first publication, 4 July 2024, took effect from the following
# midnight. Before any ERAM table is supplied, this is where the notification
# history stops being entitled to answer.
ERAM_START = "2024-07-05"

# A full table with fewer currencies than this did not parse; it is not a short
# notification. The list has never been smaller than 13 in the corpus era.
MIN_FULL_CURRENCIES = 13


def effective_date(text: str) -> str | None:
    """The `with effect from 21st June, 2024` in the operative paragraph."""
    m = re.search(
        r"with\s+effect\s+from\s+(?:the\s+)?(\d{1,2})\s*(?:st|nd|rd|th)?\s*"
        r"([A-Za-z]+)\s*,?\s*(\d{4})",
        " ".join(text.split()),
        re.I,
    )
    if not m:
        return None
    day, month, year = int(m.group(1)), MONTHS.get(m.group(2).lower()), int(m.group(3))
    if not month:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def parse_schedules(text: str) -> dict[str, dict[str, float]]:
    """
    Schedule I at one unit, Schedule II at a hundred, both `import` and `export`.

    The PDFs put each cell on its own line, so a row is recognised by shape --
    a serial number, a currency name, then two decimals -- rather than by
    position. Notifications from before about 2012 print the two rates on one
    line; both forms are handled.
    """
    flat = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # Where Schedule II starts, so the 100-unit divisor applies from there on.
    divisor = 1.0
    rates: dict[str, dict[str, float]] = {}
    i = 0
    while i < len(flat):
        line = flat[i]
        if re.search(r"SCHEDULE\s*[-–—]?\s*(II|2)\b", line, re.I):
            divisor = 100.0
            i += 1
            continue
        if re.search(r"SCHEDULE\s*[-–—]?\s*(I|1)\b", line, re.I):
            divisor = 1.0
            i += 1
            continue

        # `1.` / `1` alone, or `1. Australian Dollar 56.90 54.50` on one line.
        m = re.match(
            r"^\d{1,2}\s*[.)]?\s+([A-Za-z][A-Za-z .'-]+?)\s+"
            r"(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$",
            line,
        )
        if m:
            code = CURRENCY_CODES.get(m.group(1).strip().lower())
            if code:
                rates[code] = {
                    "import": float(m.group(2)) / divisor,
                    "export": float(m.group(3)) / divisor,
                }
            i += 1
            continue

        if re.match(r"^\d{1,2}\s*[.)]?$", line) and i + 3 < len(flat):
            name = CURRENCY_CODES.get(flat[i + 1].strip().lower())
            a, b = flat[i + 2], flat[i + 3]
            if name and re.fullmatch(r"\d+(?:\.\d+)?", a) and re.fullmatch(r"\d+(?:\.\d+)?", b):
                rates[name] = {"import": float(a) / divisor, "export": float(b) / divisor}
                i += 4
                continue
        i += 1
    return rates


def classify(text: str) -> str:
    """
    A notification either replaces the whole table or edits one row of it.

    `full` supersedes the last one and carries every currency. `amend` says
    "for serial No. 10 and the entries relating thereto, the following shall be
    substituted" and carries exactly the rows it changes -- a fifth of the
    corpus is this shape, and CBIC writes it both as "amendments" and "further
    amendments". Reading an amendment as a full table is how a Bill of Entry
    ends up with 21 of its 22 currencies missing, so the two are told apart
    before anything is parsed.

    CBIC's own index also files some *tariff value* notifications (the TABLE-1/
    2/3 amendments to 36/2001-Customs) under an "Exchange rates" title. Those
    match neither shape and are refused here rather than parsed into nonsense.
    """
    flat = " ".join(text.split())
    if not re.search(r"rate of exchange", flat, re.I):
        # A tariff value notification (the TABLE-1/2/3 amendments to
        # 36/2001-Customs) that CBIC's index happens to title "Exchange rates".
        return "unknown"
    if re.search(r"makes? the following (?:further )?amendments?", flat, re.I):
        return "amend"
    if re.search(r"determines that the rate of exchange|supersession", flat, re.I):
        return "full"
    return "unknown"


def from_notifications():
    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.exit("PyMuPDF is required: pip3 install pymupdf")

    index = json.loads(INDEX.read_text())
    by_id = {}
    for f in PDFS.glob("*.pdf"):
        m = re.search(r"__(\d+)\.pdf$", f.name)
        if m:
            by_id[m.group(1)] = f

    parsed = []
    skipped: list[str] = []
    # Notifications that are genuinely exchange rates and did not parse. Each one
    # leaves a window where the table in force is not the one we hold, so the
    # lookup has to refuse there rather than hand back its predecessor.
    holes: list[dict] = []
    for n in index:
        name = str(n.get("notificationName") or "")
        if not re.match(r"^\s*(Exchange rates?|Rate of exchange)\b", name, re.I):
            continue
        no = str(n.get("notificationNo") or "").strip()
        pdf = by_id.get(str(n.get("id")))
        if not pdf:
            skipped.append(f"{no}: pdf not downloaded")
            continue
        try:
            with fitz.open(pdf) as doc:
                text = "\n".join(page.get_text() for page in doc)
        except Exception as err:
            skipped.append(f"{no}: {err}")
            continue

        if not text.strip():
            # An image-only scan. Five of these fall after 2018, and each leaves
            # a fortnight whose real rates we do not hold. OCR (ocr-corpus)
            # would close them; until then they are refused, not guessed.
            skipped.append(f"{no}: scanned, no text layer")
            holes.append({"from": (n.get("notificationDt") or "")[:10], "source": no,
                          "reason": "scanned, no text layer"})
            continue

        kind = classify(text)
        eff = effective_date(text)
        rates = parse_schedules(text)
        if kind == "unknown":
            skipped.append(f"{no}: neither a full table nor an amendment")
            continue
        if not eff:
            skipped.append(f"{no}: no effective date")
            holes.append({"from": (n.get("notificationDt") or "")[:10], "source": no,
                          "reason": 'no effective date'})
            continue
        if not rates:
            skipped.append(f"{no}: no rates parsed")
            holes.append({"from": (n.get("notificationDt") or "")[:10], "source": no,
                          "reason": 'no rates parsed'})
            continue
        if kind == "full" and len(rates) < MIN_FULL_CURRENCIES:
            # A full table that came out short is a parse failure, not a short
            # table. Emitting it would silently drop currencies, and a missing
            # currency reads downstream as "no notified rate" -- which is a
            # different and wrong statement.
            skipped.append(f"{no}: full table parsed only {len(rates)} currencies")
            holes.append({"from": (n.get("notificationDt") or "")[:10], "source": no,
                          "reason": 'full table parsed short'})
            continue
        parsed.append({"effectiveFrom": eff, "source": no, "kind": kind, "rates": rates})

    # Fold in effective-date order: a full table replaces what is in force, an
    # amendment edits it. Two notifications can share an effective date (a
    # correction issued the same day); the later serial wins, which is the order
    # the index already carries them in.
    parsed.sort(key=lambda t: t["effectiveFrom"])
    tables = []
    running: dict[str, dict[str, float]] = {}
    orphans = 0
    for t in parsed:
        if t["kind"] == "full":
            running = dict(t["rates"])
        else:
            if not running:
                orphans += 1
                skipped.append(f"{t['source']}: amendment with no table in force")
                continue
            running = {**running, **t["rates"]}
        if tables and tables[-1]["effectiveFrom"] == t["effectiveFrom"]:
            tables[-1] = {
                "effectiveFrom": t["effectiveFrom"],
                "source": t["source"],
                "rates": dict(running),
            }
            continue
        tables.append(
            {"effectiveFrom": t["effectiveFrom"], "source": t["source"], "rates": dict(running)}
        )
    return tables, skipped, holes


def from_eram() -> list[dict]:
    """
    ERAM tables, one JSON per publication, as `fetch-eram.py` writes them:
    `{"effectiveFrom": "2026-09-05", "rates": {"USD": {"import": 88.3, ...}}}`.
    """
    if not ERAM.is_dir():
        return []
    tables = []
    # `2*.json` rather than `*.json`: probed.json beside them is the fetcher's
    # own cache, not a table.
    for f in sorted(ERAM.glob("2*.json")):
        row = json.loads(f.read_text())
        tables.append(
            {
                "effectiveFrom": row["effectiveFrom"],
                "source": row.get("source") or f"ICEGATE ERAM {row['effectiveFrom']}",
                "rates": row["rates"],
            }
        )
    return tables


def main() -> None:
    notified, skipped, holes = from_notifications()
    eram = from_eram()

    # ERAM is the publisher from 2024-07-05; a notification claiming a date in
    # its era would be a re-run of stale input, so it loses.
    by_date: dict[str, dict] = {}
    for t in notified:
        if not eram or t["effectiveFrom"] < min(e["effectiveFrom"] for e in eram):
            by_date[t["effectiveFrom"]] = t
    for t in eram:
        by_date[t["effectiveFrom"]] = t

    tables = [by_date[k] for k in sorted(by_date)]
    if not tables:
        sys.exit("no exchange rate tables parsed — is the corpus downloaded?")

    # An inclusive last day, matching the convention in item-masters.ts.
    for a, b in zip(tables, tables[1:]):
        a["effectiveTo"] = (date.fromisoformat(b["effectiveFrom"]) - timedelta(days=1)).isoformat()

    last = tables[-1]
    if eram:
        # The newest ERAM table stands until the next publication supersedes it.
        last["effectiveTo"] = None
        coverage_end = None
    else:
        # Notifications only. The history is not entitled to answer for the ERAM
        # era, so it is closed off rather than left open.
        last["effectiveTo"] = (date.fromisoformat(ERAM_START) - timedelta(days=1)).isoformat()
        coverage_end = last["effectiveTo"]

    # A hole runs from the day the unparsed notification was issued to the day
    # before the next table we do hold takes over.
    starts = [t["effectiveFrom"] for t in tables]
    gaps = []
    for h in holes:
        if not h["from"] or h["from"] < starts[0] or (coverage_end and h["from"] > coverage_end):
            continue
        nxt = next((s for s in starts if s > h["from"]), None)
        gaps.append(
            {
                "from": h["from"],
                "to": (date.fromisoformat(nxt) - timedelta(days=1)).isoformat() if nxt else coverage_end,
                "source": h["source"],
                "reason": h["reason"],
            }
        )
    gaps.sort(key=lambda g: g["from"])

    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Source: CBIC Customs (N.T.) exchange rate notifications, and ICEGATE ERAM.",
        "// Regenerate: python3 packages/core/scripts/build-exchange-rates.py",
        "",
        "import type { ExchangeRateMaster } from '../data.js';",
        "",
        "/**",
        " * The last date this master is entitled to answer for, or `null` when the",
        " * newest table is still in force. A lookup past it returns nothing, and the",
        " * export refuses — the rate of exchange is not a field with a safe default.",
        " */",
        f"export const EXCHANGE_RATE_COVERAGE_END: string | null = "
        f"{'null' if coverage_end is None else json.dumps(coverage_end)};",
        "",
        "/**",
        " * Windows where CBIC notified a table we could not read — image-only scans,",
        " * and PDFs whose text layer comes out too mangled to trust. Most are from",
        " * 2012-2016; five fall after 2018. The rates in force inside one of these",
        " * are not the rates the table above would hand back, so the lookup refuses",
        " * there rather than returning the previous fortnight's.",
        " */",
        "export const EXCHANGE_RATE_GAPS: { from: string; to: string; source: string; reason: string }[] = [",
        *[
            f"  {{ from: {json.dumps(g['from'])}, to: {json.dumps(g['to'])},"
            f" source: {json.dumps(g['source'])}, reason: {json.dumps(g['reason'])} }},"
            for g in gaps
        ],
        "];",
        "",
        f"/** {len(tables)} notified tables, {tables[0]['effectiveFrom']} to "
        f"{tables[-1]['effectiveFrom']}. Rates are per single unit. */",
        "export const GENERATED_EXCHANGE_RATES: ExchangeRateMaster[] = [",
    ]
    for t in tables:
        rates = ", ".join(
            f"{c}: {{ import: {r['import']:g}, export: {r['export']:g} }}"
            for c, r in sorted(t["rates"].items())
        )
        to = "null" if t["effectiveTo"] is None else json.dumps(t["effectiveTo"])
        lines.append(
            f"  {{ effectiveFrom: {json.dumps(t['effectiveFrom'])}, effectiveTo: {to},"
            f" source: {json.dumps(t['source'])}, rates: {{ {rates} }} }},"
        )
    lines.append("];")

    OUT.write_text("\n".join(lines) + "\n")

    print(f"{len(tables)} tables -> {OUT.relative_to(ROOT)}")
    print(f"  from notifications : {len([t for t in tables if not t['source'].startswith('ICEGATE')])}")
    print(f"  from ERAM          : {len([t for t in tables if t['source'].startswith('ICEGATE')])}")
    print(f"  window             : {tables[0]['effectiveFrom']} .. {coverage_end or 'in force'}")
    print(f"  unreadable gaps    : {len(gaps)}")
    if skipped:
        print(f"  skipped            : {len(skipped)}")
        for s in skipped[:10]:
            print(f"    {s}")


if __name__ == "__main__":
    main()
