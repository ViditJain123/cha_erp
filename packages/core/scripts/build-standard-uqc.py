#!/usr/bin/env python3
"""
Regenerates src/masters/generated/tariff-book/standard-uqc.json.

The ITCHS standard unit per CTH — what ICES calls the SUQC, and the whole of
`SW_ADDL_INFO.Measure_Unit`:

    Info_uqc: UQC declared should be as that of UQC in ITCHS for that CTH
    -- BE Message format 2.25, CACHI01 Part 19/24

## Why this is not just `TariffMaster.unit`

The tariff book already carries a unit, and for 9,279 of the 11,081 CTHs the
two sources share it agrees. Where it does not, the book is wrong in a way that
is diagnostic of its own source: it is an OCR'd scan, and the scan loses the
superscript.

    first schedule -> book     rows   what happened
    SQM -> MTR                  238   m2 rendered as m', read as a plain metre
    SQM -> MTS                   42   m2 mapped to MTS, the UQC for a METRIC TONNE
    CBM -> MTR                   38   m3 rendered as m', read as a plain metre
    GMS -> KGS                   16   g read as kg
    CBM -> MCU                    5   m3 mapped to MCU, which is not an ICES UQC

`build-tariff-book.py` is honest about the first and third of those --
`AMBIGUOUS_UNITS = {"m'"}` sets `unitUncertain` on the row -- but the second and
fifth are silent mis-mappings, and a square metre filed as a metric tonne is a
declared quantity out by whatever the goods happen to weigh.

CBIC publishes the First Schedule as digital text, where the superscript
survives. So the schedule wins, the book fills the schedule's holes, and where
only the book has an opinion its poisoned tokens are refused rather than used.

Sources:
  data/customs-corpus/index/tariff-first-schedule.json   (committed, CBIC)
  src/masters/generated/tariff-book/schedule.json        (committed, BDP scan)

Run:  python3 packages/core/scripts/build-standard-uqc.py
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / "src" / "masters" / "generated" / "tariff-book" / "schedule.json"
OUT = ROOT / "src" / "masters" / "generated" / "tariff-book" / "standard-uqc.json"

# The corpus lives at the repo root, not under packages/core.
REPO = ROOT.parent.parent
SCHEDULE = REPO / "data" / "customs-corpus" / "index" / "tariff-first-schedule.json"

# The First Schedule's own notation on the left, the ICES UQC on the right.
# Every token CBIC actually uses in Volume I; an unknown one aborts rather than
# being dropped, because a silently missing unit becomes a blocked export and
# nobody would know which chapter to look in.
SCHEDULE_UNITS = {
    "kg": "KGS",
    "u": "NOS",
    "m2": "SQM",
    "m": "MTR",
    "l": "LTR",
    "m3": "CBM",
    "g": "GMS",
    "cm": "CMS",
}

# Book tokens that are only ever produced by the superscript bug above, and so
# can never be trusted even when the schedule has nothing to say. MTS is the UQC
# for a metric tonne and the book only ever emits it for m2; MCU is not an ICES
# UQC at all.
BOOK_POISONED = {"MTS", "MCU"}


def main() -> None:
    schedule = json.loads(SCHEDULE.read_text())
    book = json.loads(BOOK.read_text())["rows"]

    unknown = sorted({r["uqc"] for r in schedule if r.get("uqc") and r["uqc"] not in SCHEDULE_UNITS})
    if unknown:
        raise SystemExit(f"unmapped First Schedule unit tokens: {unknown}")

    rows: dict[str, str] = {}
    source: dict[str, str] = {}

    for r in schedule:
        uqc = SCHEDULE_UNITS.get(r.get("uqc") or "")
        if uqc:
            rows[r["cth"]] = uqc
            source[r["cth"]] = "schedule"

    filled = disagreed = refused = 0
    for r in book:
        cth, unit = r["cth"], r.get("unit")
        if not unit:
            continue
        if cth in rows:
            if rows[cth] != unit:
                disagreed += 1
            continue
        if r.get("unitUncertain") or unit in BOOK_POISONED:
            refused += 1
            continue
        rows[cth] = unit
        source[cth] = "book"
        filled += 1

    gap = sorted(({r["cth"] for r in schedule} | {r["cth"] for r in book}) - set(rows))

    OUT.write_text(
        json.dumps(
            {
                "builtAt": date.today().isoformat(),
                "sources": {
                    "schedule": str(SCHEDULE.relative_to(REPO)),
                    "book": str(BOOK.relative_to(ROOT)),
                },
                "count": len(rows),
                "fromSchedule": sum(1 for v in source.values() if v == "schedule"),
                "fromBook": filled,
                "bookDisagreements": disagreed,
                "bookRefused": refused,
                # CTHs neither source gives a unit for. Kept in the file rather
                # than only in this script's output, so the export can say "the
                # tariff has no standard unit for this heading" and mean it.
                "noUnit": gap,
                "rows": dict(sorted(rows.items())),
            },
            separators=(",", ":"),
        )
        + "\n"
    )

    print(f"{len(rows)} CTHs -> {OUT.relative_to(ROOT)}")
    print(f"  from the First Schedule : {sum(1 for v in source.values() if v == 'schedule')}")
    print(f"  filled from the book    : {filled}")
    print(f"  book disagreed, ignored : {disagreed}")
    print(f"  book refused (uncertain or poisoned token): {refused}")
    print(f"  no unit from either     : {len(gap)}")


if __name__ == "__main__":
    main()
