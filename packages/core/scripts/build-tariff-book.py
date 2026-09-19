#!/usr/bin/env python3
"""
Parses the BDP Customs Tariff 2026-27 books into the generated masters under
src/masters/generated/tariff-book/.

    pip install pymupdf
    python3 packages/core/scripts/build-tariff-book.py

Companion to build-masters.py, and it keeps the same contract: the generated
files are committed, the build aborts rather than shipping a value it cannot
justify, and every row names the printed page it came from.

## Why the source is read the way it is

build-masters.py reads CBIC's notifications as *ruled* tables, because only the
ruling says where one entry ends and the next begins. These books have no
ruling to read. They are copier scans (Konica Minolta AccurioPress) OCR'd by
Acrobat Paper Capture, so every page is a JPEG plus an invisible word layer.
Two consequences drive everything below.

First, PyMuPDF's `page.get_text()` in reading order is *scrambled* on these
pages — it emits column blocks, not rows, so a row's HS code and its duty rates
come out hundreds of lines apart. Everything here works from
`get_text("words")` coordinates instead. That is a correctness requirement, not
an optimisation.

Second, OCR mis-reads digits silently, and a wrong duty rate on a Bill of Entry
is not a typo, it is a short payment. So the parse is not trusted on its own.
Every schedule row is checked against arithmetic the book itself prints:

    SWS   = 10% of BCD, or nil for surcharge-exempt goods (printed as % of AV)
    IGST  = igst% x (100 + BCD_eff + SWS + extra) / 100
    TOTAL = BCD_eff + SWS + extra + IGST

The TOTAL column is therefore a checksum over the other four. A mis-read digit
almost always breaks it, and where one cell is unreadable the rest pin its
value — on page 390 the BASIC cell of 29394110 OCR'd as "750" while EFFECTIVE
7.50, SWS 0.75 and TOTAL 27.735 each independently say 7.50. Rows that
reconcile ship as `verified`; rows recovered from the others ship as `repaired`
and say so; rows that do neither ship as `unverified` and are listed in the
build report for review. Nothing is defaulted.

## What the columns mean, which is not what they are named

The printed IGST column is the *statutory* rate (18.00). The printed SWS column
is not a rate at all — it is Social Welfare Surcharge already expressed as a
percentage of assessable value (0.75 on a 7.5% BCD line). The rate duty.ts
wants is 10. Copying the SWS column into a rate field understates the surcharge
by 92.5%, so `swsRate` below is always the rate on BCD and `swsOfAv` keeps the
printed figure, which exists to feed the checksum and nothing else.

Likewise BASIC is the First Schedule statutory rate and EFFECTIVE is what is
left after the exemption notification the REMARKS column cites. `bcdRate`
carries BASIC, because the 45/2025 machinery in packages/extraction applies the
concession itself; handing it EFFECTIVE would apply the concession twice.
"""

from __future__ import annotations

import hashlib
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF is required: pip install pymupdf")

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
OUT = ROOT / "src" / "masters" / "generated" / "tariff-book"

EDITION = "2026-27"
PUBLISHER = "BDP (Business Datainfo Publishing Co. Pvt. Ltd.)"

# The books are bought, not fetched: unlike the CBIC corpus there is no
# re-download command, so the build pins what it parsed by digest. A refreshed
# edition changes these and must be reviewed, not silently re-parsed.
SOURCE = REPO / "data" / "tariff-books"
BOOKS = {1: "bdp-2026-27-vol1.pdf", 2: "bdp-2026-27-vol2.pdf", 3: "bdp-2026-27-vol3.pdf"}
MANIFEST = ROOT / "masters-source" / "bdp-2026-27.sha256"

# Below these the parse is not good enough to ship. A refreshed source that
# reads worse must fail loudly, the way a serial gap does in build-masters.py,
# rather than quietly produce a thinner master.
CHECKSUM_FLOOR = 0.85
MIN_ROWS = 11_000

# India's First Schedule reserves chapter 77. Encoding it means a missing
# chapter is an error rather than a discovery.
RESERVED_CHAPTERS = {77}


# --------------------------------------------------------------------------- #
#  Reading a number off a scan
# --------------------------------------------------------------------------- #

# OCR on these pages prefixes decimals with a stray dot often enough to matter:
# page 237 prints 10.00 / 1.00 / 16.550 and the text layer carries ".10.00",
# ".1.00" and ".19.650". The leading dot is an artefact and is dropped; the
# mangled digits inside are not repairable here and are left to the checksum,
# which on that page does catch them.
NUMERIC = re.compile(r"^[.,]?(\d{1,5}(?:[.,]\d{1,3})?)[.,]?$")


def number(token: str) -> float | None:
    """The numeric value of an OCR'd cell, or None if it is not a number."""
    m = NUMERIC.match(token)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "."))
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
#  The checksum
# --------------------------------------------------------------------------- #

TOLERANCE = 0.02

# Column order as the book prints it. PRE (preferential) is frequently blank.
RATE_COLUMNS = ("basic", "effective", "pref", "igst", "sws", "total")

# The statutory IGST rates in force under 9/2025-IT(R), plus nil and the 40%
# slab the 2025 rationalisation introduced (21069020, pan masala, prints it).
# A value here is evidence the column really is IGST; a value outside it is
# evidence it is not. This is a signal for *fitting*, never a correction — the
# rate that ships is whatever reconciles, and CBIC's own schedule is the
# authority at the end of the build.
IGST_RATES = {0.0, 0.1, 0.25, 1.0, 1.5, 2.5, 3.0, 5.0, 6.0, 9.0, 12.0, 18.0, 28.0, 40.0}


def total_of(effective: float, igst: float, sws: float, extra: float = 0.0) -> float:
    """TOTAL incidence as a percentage of assessable value."""
    return effective + sws + extra + igst / 100.0 * (100.0 + effective + sws + extra)


def sws_is_sane(effective: float, sws: float | None) -> bool:
    """
    SWS is either 10% of BCD or nil. Nil is not an OCR failure — a great many
    goods are surcharge-exempt (08054000 prints 25.00 BCD against 0.00 SWS, and
    its TOTAL of 31.250 confirms it), so deriving SWS rather than reading it
    would silently overcharge them.
    """
    if sws is None:
        return False
    return abs(sws) <= TOLERANCE or abs(sws - 0.10 * effective) <= TOLERANCE


def evidence(basic: float | None, effective: float | None, igst: float | None,
             sws: float | None, total: float | None) -> int:
    """
    How strongly these five cells behave like a tariff row. Used to choose the
    column layout for a page: a wrong layout scores near zero across 20-40 rows
    and the right one scores heavily, so the winner is unambiguous.
    """
    if effective is None:
        return 0
    score = 0
    if sws_is_sane(effective, sws):
        score += 2
    if igst is not None and igst in IGST_RATES:
        score += 1
    if igst is not None and total is not None:
        applied = sws if sws is not None else 0.10 * effective
        if abs(total_of(effective, igst, applied) - total) <= TOLERANCE:
            score += 3
    if basic is not None and basic + TOLERANCE >= effective:
        score += 1
    return score


# The confidence a row ships with, and what each tier means.
#   verified   — the cells reconcile exactly as printed. Nothing to doubt.
#   repaired   — they reconcile once a lost decimal point is restored, and the
#                restored reading is the one that ships.
#   unverified — no reading reconciles. The row is kept with its cells as
#                printed, flagged, and listed for review. Nothing is defaulted.
VERIFIED, REPAIRED, UNVERIFIED = "verified", "repaired", "unverified"

# The decimal point is what OCR loses most often on these scans, and it loses it
# in both directions: 08013100 prints 2.50 BCD and 0.25 SWS, and the text layer
# carries "250" and "025"; 08054000 prints a TOTAL of 31.250 that arrives as
# "31250". A factor of ten or a hundred is therefore a reading to try, not a
# rate to believe.
SCALES = (1.0, 0.1, 0.01)


def grade(basic: float | None, effective: float | None, igst: float | None,
          sws: float | None, total: float | None) -> tuple[str, dict]:
    """
    (confidence, the rate cells to ship) for one row.

    The printed TOTAL is the most trustworthy number on the row, because it is
    the one the other four have to explain. So the first thing tried is not
    "recompute TOTAL from the inputs" but the opposite: find the reading of the
    inputs that reproduces the TOTAL as printed. Recomputing comes last, and
    only when no reading of the inputs explains what is on the page.

    Getting that order wrong is not academic. 08013100 reads 250/250/025/7.888;
    recomputing from the inputs ships a 250% basic duty on cashews and throws
    away the 7.888 that proves it is 2.5%.
    """
    printed = {"basic": basic, "effective": effective, "igst": igst,
               "sws": sws, "total": total}
    if effective is None or igst is None:
        return UNVERIFIED, printed

    for t_scale in (1.0, 0.001):
        if total is None:
            break
        target = total * t_scale
        for e_scale in SCALES:
            e = effective * e_scale
            for s_scale in (SCALES if sws is not None else (1.0,)):
                s = sws * s_scale if sws is not None else None
                applied = s if sws_is_sane(e, s) else 0.10 * e
                if abs(total_of(e, igst, applied) - target) > TOLERANCE:
                    continue
                exact = e_scale == 1.0 and s_scale == 1.0 and t_scale == 1.0
                return (VERIFIED if exact else REPAIRED), {
                    "basic": _rescale_basic(basic, e, e_scale),
                    "effective": round(e, 3),
                    "igst": igst,
                    "sws": None if s is None else round(applied, 3),
                    "total": round(target, 3),
                }

    # Nothing on the page to check against, but the row is self-consistent: SWS
    # is a tenth of BCD and IGST is a statutory rate, so TOTAL follows.
    if sws_is_sane(effective, sws) and igst in IGST_RATES:
        return REPAIRED, {**printed,
                          "total": round(total_of(effective, igst, sws or 0.0), 3)}
    return UNVERIFIED, printed


def _rescale_basic(basic: float | None, effective: float, e_scale: float) -> float | None:
    """
    BASIC is the one rate the arithmetic does not constrain — nothing on the row
    has to agree with it — so it cannot be solved for, only kept plausible.

    The rule is the smallest reading that is still at least the effective rate,
    which is the one thing always true of a statutory rate against a
    concessional one. 25201090 prints "250" against an EFFECTIVE of 2.50 that
    reconciles perfectly: 250 clears the floor, but so does 2.5, and 2.5 is the
    one the page means. A genuine 120 against an effective 100 is untouched,
    because 12 and 1.2 both fall below the floor.
    """
    if basic is None:
        return None
    floor = effective - TOLERANCE
    readings = sorted(basic * s for s in SCALES)
    for value in readings:
        if value >= floor:
            return round(value, 3)
    return None


# --------------------------------------------------------------------------- #
#  Geometry
# --------------------------------------------------------------------------- #

# A row's words share a baseline to within a couple of points. 3.0 pt keeps a
# wrapped description line separate from the line above it (leading is ~9 pt)
# while tolerating the baseline jitter a scan introduces.
ROW_TOLERANCE = 3.0

# The running head and column titles occupy the top ~70 pt of every page. Used
# only to discard label rows: a tariff row that high up is still a tariff row.
HEADER_BAND = 70.0

# Numbers in one column are aligned to within a character width; 7 pt is wider
# than the jitter and narrower than the ~26 pt gap between rate columns.
COLUMN_GAP = 7.0

HS8 = re.compile(r"^\d{8}$")


def rows(page) -> list[list[tuple]]:
    """A page's words grouped into visual rows by baseline, each left-to-right."""
    words = sorted(
        (w for w in page.get_text("words") if w[4].strip()),
        key=lambda w: (w[1], w[0]),
    )
    out: list[list[tuple]] = []
    for w in words:
        if out and abs(w[1] - out[-1][0][1]) < ROW_TOLERANCE:
            out[-1].append(w)
        else:
            out.append([w])
    for r in out:
        r.sort(key=lambda w: w[0])
    return out


def cluster(values: list[float], gap: float) -> list[list[float]]:
    """One-dimensional clustering: split wherever consecutive values differ by `gap`."""
    if not values:
        return []
    ordered = sorted(values)
    groups = [[ordered[0]]]
    for v in ordered[1:]:
        if v - groups[-1][-1] > gap:
            groups.append([v])
        else:
            groups[-1].append(v)
    return groups


# --------------------------------------------------------------------------- #
#  Schedule pages: recovering the columns
# --------------------------------------------------------------------------- #
#
# The printed column headers are too badly OCR'd to key off. Across the 892
# schedule pages a fuzzy match constrained to the correct left-to-right order
# recovers all twelve headers on only 44% of them ("11.\SIC" for BASIC,
# "I!FFECTIVE", "JISCODE", "llEMAJUCS", "EFP'ECTlVE"). Column x-positions also
# shift between recto and verso — the HS code sits at x~34 on one side and x~65
# on the other — so one hardcoded layout is wrong too.
#
# So the columns are recovered from the data and the arithmetic decides. A page
# carries 20-40 rows sharing one layout, so: cluster the x of every numeric
# token into vertical stacks, then try every order-preserving map of those
# stacks onto (basic, effective, pref, igst, sws, total) and keep the one whose
# rows behave most like tariff rows. A wrong layout scores near zero; the right
# one scores heavily. The fit is self-validating rather than heuristic.


def numeric_cells(row: list[tuple]) -> list[tuple[float, float]]:
    """(centre, value) for every numeric token on a row."""
    out = []
    for w in row:
        v = number(w[4])
        if v is not None:
            out.append(((w[0] + w[2]) / 2, v))
    return out


def numeric_stacks(cells: list[list[tuple[float, float]]]) -> list[float]:
    """
    Centres of the vertical stacks numeric tokens form, keeping only stacks with
    real support. A rate column appears on nearly every row; a number inside a
    description ("heading 61.04", "Rs.2500 per piece") appears on one or two and
    would otherwise offer the fitter a column that is not there.
    """
    xs = [c for row in cells for c, _ in row]
    floor = max(2, int(0.35 * len(cells)))
    return [statistics.median(g) for g in cluster(xs, COLUMN_GAP) if len(g) >= floor]


def index_rows(cells: list[list[tuple[float, float]]],
               stacks: list[float]) -> list[dict[int, float]]:
    """Row values keyed by stack index, so fitting is a lookup and not a scan."""
    indexed: list[dict[int, float]] = []
    for row in cells:
        found: dict[int, float] = {}
        for centre, value in row:
            for i, s in enumerate(stacks):
                if abs(centre - s) <= COLUMN_GAP:
                    found.setdefault(i, value)
                    break
        indexed.append(found)
    return indexed


def fit_columns(indexed: list[dict[int, float]],
                stacks: list[float]) -> dict[str, int] | None:
    """Stack indices keyed by column name, for the best-scoring layout."""
    if len(stacks) < 3:
        return None
    width = min(len(stacks), len(RATE_COLUMNS))
    best: tuple[int, dict[str, int]] | None = None
    for picked in combinations(range(len(stacks)), width):
        for names in combinations(RATE_COLUMNS, width):
            if "effective" not in names:
                continue
            mapping = dict(zip(names, picked))
            score = 0
            for r in indexed:
                get = lambda n: r.get(mapping[n]) if n in mapping else None
                score += evidence(get("basic"), get("effective"), get("igst"),
                                  get("sws"), get("total"))
            if best is None or score > best[0]:
                best = (score, mapping)
    if best is None or best[0] == 0:
        return None
    return best[1]


# --------------------------------------------------------------------------- #
#  Schedule pages: reading a row
# --------------------------------------------------------------------------- #

# The unit column, as this book prints it. Values are the book's own spelling on
# the left and the ICES UQC on the right; `m'` is how the scan renders the
# superscript in m2/m3, and is ambiguous between them, so it resolves to the
# unqualified metre and the row says the unit was uncertain.
UNITS = {
    "kg.": "KGS", "kg": "KGS", "kg,": "KGS",
    "u": "NOS", "u.": "NOS",
    "t": "TON", "l": "LTR",
    # m2 is a SQUARE METRE and m3 a CUBIC METRE. These used to read MTS and
    # MCU -- MTS is the ICES UQC for a metric TONNE, and MCU is not an ICES UQC
    # at all, so 42 tariff items declared an area as a weight and 5 a volume as
    # nothing. Caught by comparing against CBIC's own First Schedule; see
    # build-standard-uqc.py, which refuses both tokens on the way in.
    "m": "MTR", "m2": "SQM", "m3": "CBM", "m'": "MTR",
    "pa": "PRS", "c/k": "CTM", "tu": "THD", "g": "GMS", "ct": "CTM",
}
AMBIGUOUS_UNITS = {"m'"}

# Import and export policy, as DGFT words it. The scan decorates these with
# stray quotes and bullets often enough that matching is done on letters only.
POLICIES = ("Free", "Restricted", "Prohibited", "State Trading", "Exclusive")
_LETTERS = re.compile(r"[^a-z]")


def policy_of(tokens: list[str]) -> str | None:
    """The DGFT policy word in a run of tokens, ignoring OCR decoration."""
    for t in tokens:
        bare = _LETTERS.sub("", t.lower())
        for p in POLICIES:
            if bare and bare == _LETTERS.sub("", p.lower()):
                return p
        if bare == "state":
            return "State Trading"
    return None


def _row_text_columns(row, first_rate: float, last_rate: float) -> dict:
    """Description, unit and the two policy columns, given the rate band's edges."""
    left = [w for w in row[1:] if (w[0] + w[2]) / 2 < first_rate - 10]
    unit_token = left[-1][4] if left else ""
    unit = UNITS.get(unit_token.lower())
    right = [w[4] for w in row if (w[0] + w[2]) / 2 > last_rate + 8]
    # IMP.POL and EXP.POL bracket REMARKS, so the policy words are the frame and
    # everything between them is the remark. Leaving them in would make every
    # remark read "Free ... Free" and would hide whether a remark exists at all.
    imp = policy_of(right[:2])
    exp = policy_of(right[-2:])
    inner = right[1:] if imp else right
    inner = inner[:-1] if exp and inner else inner
    return {
        "description": prose(" ".join(w[4] for w in (left[:-1] if unit else left))),
        "unit": unit,
        "unitUncertain": unit_token.lower() in AMBIGUOUS_UNITS,
        "impPolicy": imp,
        "expPolicy": exp,
        "remarks": prose(" ".join(inner)),
    }


# A tariff item's own description is a leaf: 34039900 prints "Other", 17021110
# prints "In solid form". On the page the heading above supplies the rest, and
# without it the row is useless both to a reviewer and to the classification
# candidates Volume III feeds. So the un-coded rows are read too, and each row
# carries the heading and sub-group it sits under.
HEADING = re.compile(r"^\d{4}$|^\d{6}$")
GROUP = re.compile(r"^[-\u2022\u00b7.]{1,4}\s*\S")


def context_of(row, first_rate: float) -> tuple[str, str] | None:
    """
    ('heading' | 'group' | 'more', text) for a row that is not a tariff item.

    Only the description column is read. A heading row runs the full width of
    the table and its REMARKS cell carries notification text, so taking the
    whole row would fold "Exemption: see Ntfn 24/05-Cus." into the name of the
    goods and hand that to the classifier as the product description.

    A heading is also usually too long for one line — "Polymers of propylene or
    of other olefins, in primary forms" wraps three times — so a plain
    continuation line comes back as 'more' and is appended to whatever is open.
    """
    first = row[0][4]
    body = [w for w in row if (w[0] + w[2]) / 2 < first_rate - 10]
    if not body:
        return None
    text = prose(" ".join(w[4] for w in body))
    if HEADING.match(first):
        return "heading", prose(" ".join(w[4] for w in body[1:]))
    if HS8.match(first):
        return None
    if GROUP.match(text):
        return "group", text
    return ("more", text) if text else None


def compose(heading: str, group: str, leaf: str) -> str:
    """The full description of a tariff item, outermost label first."""
    parts = [p for p in (heading, group, leaf) if p]
    seen: list[str] = []
    for p in parts:
        if p.lower() not in (s.lower() for s in seen):
            seen.append(p)
    return " > ".join(seen)


def _emit(cth: str, page_no: int, text: dict, rates: dict, confidence: str) -> dict:
    """One master row. Every optional field is omitted rather than defaulted."""
    return {
        "cth": cth,
        "description": text["description"],
        **({"unit": text["unit"]} if text["unit"] else {}),
        **({"unitUncertain": True} if text["unitUncertain"] else {}),
        **rates,
        **({"impPolicy": text["impPolicy"]} if text["impPolicy"] else {}),
        **({"expPolicy": text["expPolicy"]} if text["expPolicy"] else {}),
        **({"remarks": text["remarks"]} if text["remarks"] else {}),
        **({"notificationRefs": refs} if (refs := notification_refs(text["remarks"])) else {}),
        "confidence": confidence,
        "page": page_no,
    }


# Under a tariff row BDP prints its own annotation rows, marked in the
# description column with the notification they come from — "N45" for the jumbo
# exemption 45/2025, "N11", "N52". They carry the *concessional* rate for one
# narrow description of the goods ("SPF Polychaete worms", "Insect Meal for use
# in ..."), not a second reading of the tariff item. Treated as tariff rows they
# would overwrite the statutory rate with a concession that only some
# consignments qualify for; captured properly they are exactly the per-goods
# candidate list that notification-choose.ts asks the model to choose between.
ANNOTATION = re.compile(r"^N(\d{1,3})$")


# The REMARKS column is where Volume I points into Volume II: "Ntfn
# 45/2025-Cus. - Sl No.24", "Exemption: see Ntfn 25/05-Cus. dated 01.03.2005".
# That pair — notification and serial — is a stronger key than any code prefix,
# because it names the exact entry rather than a range the entry happens to
# cover, and it is what lets a CTH be traversed to the *conditions* attached to
# its concession.
#
# The scan mangles the suffix freely (-Cus., -Gus., -CUs.) and spaces the serial
# any way it likes, so neither is matched strictly. The year is normalised: the
# book writes both "25/05" and "45/2025", and the masters use "045/2025".
NOTIFICATION_REF = re.compile(
    r"Ntfn\.?\s*(\d{1,3})\s*/\s*(\d{2,4})"            # 45/2025
    r"(?:\s*-\s*(\d{2,4})(?![\d.]))?"                 # -2020 / -26: a DGFT span, not a date
    r"(?:\s*[-\u2013]?\s*[A-Za-z]{2,4}\.?)?"           # -Cus. / -Gus. / -IT
    r"(?:[^A-Za-z0-9]{0,4}S[lL]\.?\s*No\.?\s*(\d{1,3}))?",  # - Sl No.24
    re.I,
)

# DGFT numbers its notifications against the Foreign Trade Policy period or the
# financial year — "20/2015-2020", "44/2025-26" — where CBIC uses the calendar
# year alone. The span is the only thing that tells them apart on the page, and
# losing it files a DGFT policy notification under the customs notification that
# happens to share its number and year: 44/2025-26 is an import-policy
# condition, 44/2025-Customs is a different instrument entirely. They are the
# two most-cited references in the schedule, so this is not an edge case.


def notification_refs(remarks: str) -> list[dict]:
    """The notifications a REMARKS cell cites, in order, each with its authority."""
    seen: dict[str, dict] = {}
    for m in NOTIFICATION_REF.finditer(remarks):
        number, year, span, serial = m.group(1), m.group(2), m.group(3), m.group(4)
        # "25/05" is 2005; the book uses two digits for anything last century
        # and four for recent years. Nothing in the customs tariff predates
        # 1950, so a two-digit year over 50 is 19xx.
        if len(year) == 2:
            year = f"20{year}" if int(year) < 50 else f"19{year}"
        dgft = bool(span) and _is_year_span(year, span)
        # The span can wrap onto the next line of the REMARKS cell, leaving
        # "Ntfn 20/2015- 07.07.2022": a hyphen with no suffix, followed by a
        # date or by nothing. A CBIC citation is never shaped like that — its
        # hyphen introduces "Cus." — so the dangling hyphen is itself the mark
        # of a DGFT period whose end year went to another line.
        if not dgft and not span and _DANGLING_SPAN.match(remarks, m.end(2)):
            dgft = True
            wrapped = _WRAPPED_YEAR.search(remarks, m.end())
            span = wrapped.group(1) if wrapped and _is_year_span(year, wrapped.group(1)) else ""
        # A DGFT key always names its period, so the two namespaces can never
        # collide; "??" says the end year wrapped somewhere it could not be found.
        key = f"{int(number):03d}/{year}" + (f"-{span[-2:] if span else '??'}" if dgft else "")
        ref = {
            "printed": m.group(0).strip(),
            "notification": key,
            "authority": "DGFT" if dgft else "CBIC",
        }
        if serial:
            ref["serial"] = str(int(serial))
        # A later mention carrying a serial beats an earlier bare one.
        if key not in seen or (serial and "serial" not in seen[key]):
            seen[key] = ref
    return list(seen.values())


# What follows a dangling hyphen: a date, however badly scanned ("07.0720ZZ"
# is 07.07.2022), or the end of the cell.
_DANGLING_SPAN = re.compile(r"\s*-\s*(?=\d{1,2}\.|$)")
_WRAPPED_YEAR = re.compile(r"(?<![\d.])(20\d{2})(?![\d.])")


def _is_year_span(year: str, span: str) -> bool:
    """Is "-2020" / "-26" the end of a period starting in `year`?"""
    start = int(year)
    end = int(span) if len(span) == 4 else (start // 100) * 100 + int(span)
    return 0 < end - start <= 5


def extend_remarks(row: dict, more: str) -> None:
    """Append a wrapped REMARKS line to the row it belongs to."""
    text = prose(f"{row.get('remarks', '')} {more}")
    if not text:
        return
    row["remarks"] = text
    refs = notification_refs(text)
    if refs:
        row["notificationRefs"] = refs


def parse_schedule_page(page, page_no: int, context: dict) -> list[dict]:
    """
    Every tariff row printed on one schedule page.

    `context` carries the current heading and sub-group across pages, because a
    heading opened at the foot of one page governs the rows at the top of the
    next.
    """
    limit = drawback_top(page)
    page_rows = [r for r in rows(page) if r[0][1] < limit]
    data = [r for r in page_rows if HS8.match(r[0][4])]
    if len(data) < 3:
        return []
    cells = [numeric_cells(r) for r in data]
    stacks = numeric_stacks(cells)
    fit = fit_columns(index_rows(cells, stacks), stacks)
    if not fit:
        return parse_alternative_rate_page(data, page_no, context)

    indexed = index_rows(cells, stacks)
    first_rate = min(stacks[i] for i in fit.values())
    last_rate = max(stacks[i] for i in fit.values())
    by_id = {id(r): v for r, v in zip(data, indexed)}

    out: list[dict] = []
    opened_at = -2
    for position, row in enumerate(page_rows):
        if not HS8.match(row[0][4]):
            # The running head — "Section XVI / Chapter 85" and the column
            # titles — is not data. Only label rows are filtered by position,
            # because tariff rows themselves legitimately start as high as
            # y=62 on a tightly set page and excluding those loses 218 of them.
            if row[0][1] < HEADER_BAND:
                continue
            # A REMARKS cell is four or five lines deep and only its first line
            # shares a baseline with the tariff row it belongs to. The rest
            # arrive here as rows of their own with nothing left of the rate
            # band, and dropping them truncates every remark to its opening
            # words — which is where the notification references live, so it
            # also costs the entire Volume I to Volume II join.
            if out and all((w[0] + w[2]) / 2 > last_rate + 8 for w in row):
                extend_remarks(out[-1], " ".join(w[4] for w in row))
                continue
            label = context_of(row, first_rate)
            if not label:
                continue
            kind, text = label
            if kind == "more":
                # Only the line immediately below continues a label. Without
                # that, a sibling group further down the page ("Walnuts:") and
                # anything else uncoded would pile onto the heading instead of
                # replacing it.
                open_key = context.get("open")
                if position == opened_at + 1 and open_key and len(context.get(open_key, "")) < 160:
                    context[open_key] = f"{context[open_key]} {text}".strip()
                    opened_at = position
            else:
                context[kind] = text
                context["open"] = kind
                opened_at = position
                if kind == "heading":
                    context["group"] = ""
            continue
        values = by_id[id(row)]
        get = lambda n: values.get(fit[n]) if n in fit else None
        confidence, c = grade(get("basic"), get("effective"), get("igst"),
                              get("sws"), get("total"))
        sws = c["sws"]
        rates = {
            **({"basicBcdRate": c["basic"]} if c["basic"] is not None else {}),
            **({"effectiveBcdRate": c["effective"]} if c["effective"] is not None else {}),
            **({"prefBcdRate": get("pref")} if get("pref") is not None else {}),
            **({"igstRate": c["igst"]} if c["igst"] is not None else {}),
            # The printed SWS is a percentage of assessable value, not a rate.
            # The rate is 10 on BCD, or 0 where the goods are surcharge-exempt.
            **({"swsOfAv": sws, "swsRate": 0.0 if abs(sws) <= TOLERANCE else 10.0}
               if sws is not None else {}),
            **({"totalIncidencePercent": c["total"]} if c["total"] is not None else {}),
        }
        text = _row_text_columns(row, first_rate, last_rate)
        text["description"] = compose(
            context.get("heading", ""), context.get("group", ""), text["description"]
        )
        mark = ANNOTATION.match(row[1][4]) if len(row) > 1 else None
        if mark and out:
            out[-1].setdefault("concessions", []).append({
                "notification": f"{int(mark.group(1)):03d}/2025",
                "printed": mark.group(0),
                "description": text["description"],
                **rates,
                **({"remarks": text["remarks"]} if text["remarks"] else {}),
                "confidence": confidence,
            })
            continue
        out.append(_emit(row[0][4], page_no, text, rates, confidence))
    return out


# Some headings are not charged at a single ad-valorem rate at all. Chapter 66
# prints "20% or Rs.X per piece, whichever is higher" — a specific-cum-ad-valorem
# rate that the scan renders as the token "20%or". No numeric column forms, so
# the fitter finds nothing and the whole chapter would otherwise vanish from the
# master, which is the failure the chapter-coverage invariant exists to catch.
#
# These rows are recorded with their rate cells kept verbatim and no numeric
# rate at all. Declining to state a rate is the correct answer here: the duty
# depends on quantity as well as value, so no single number is right, and
# inventing one would be worse than the reviewer seeing the printed words.
ALTERNATIVE_RATE = re.compile(r"%\s*or|whichever|per\s+(?:kg|piece|unit|sq)", re.I)


def parse_alternative_rate_page(data: list[list[tuple]], page_no: int,
                                context: dict) -> list[dict]:
    out: list[dict] = []
    for row in data:
        anchor = next(
            ((w[0] + w[2]) / 2 for w in row if w[4].lower() in UNITS), None
        )
        if anchor is None:
            continue
        rate_tokens = [w[4] for w in row if (w[0] + w[2]) / 2 > anchor + 4]
        text = _row_text_columns(row, anchor + 10, anchor + 4)
        text["description"] = compose(
            context.get("heading", ""), context.get("group", ""), text["description"]
        )
        out.append(_emit(
            row[0][4], page_no, text,
            {"rateText": prose(" ".join(rate_tokens))},
            UNVERIFIED,
        ))
    return out


# Whitespace and the scan's decorative punctuation, normalised. Unlike
# build-masters.py's `clean()` this does not abort on an unexpected character:
# a description legitimately carries quotes, dashes and brackets, and OCR adds
# its own, so the strictness belongs on the numbers instead — where the
# checksum enforces it.
_PUNCT = {"·": "-", "•": "-", "‐": "-", "–": "-", "—": "-", "’": "'", "‘": "'",
          "“": '"', "”": '"'}


def prose(value: str) -> str:
    for bad, good in _PUNCT.items():
        value = value.replace(bad, good)
    value = re.sub(r"^[\s\-.]+", "", value)
    return re.sub(r"\s+", " ", value).strip()


# --------------------------------------------------------------------------- #
#  Walking Volume I
# --------------------------------------------------------------------------- #
#
# Volume I interleaves the schedule with per-chapter drawback tables, and the
# drawback serials look exactly like tariff items — 61150106, 62040103 — so a
# drawback page read as schedule would inject codes that are not tariff items
# at all into the master. They are told apart by the word "Drawback", which
# appears on every drawback page in the volume and on no schedule page.


# Matching the word anywhere in the page text is not enough: "--- Drawing ink"
# is a tariff item in chapter 32, and "(Duty Drawback Rates on Next Page)" is a
# pointer printed *on* a schedule page. Both would cost the chapter its rows.
# The table is found by its column header instead, whose first word stands alone
# as the token "Draw-" or "Drawback", and only the part of the page below that
# header is skipped — several pages carry a chapter's last tariff rows above its
# drawback table.
_DRAW_HEADER = {"draw", "drawback"}


def drawback_top(page) -> float:
    """The y above which a page is schedule and below which it is drawback."""
    for row in rows(page):
        for w in row:
            if _LETTERS.sub("", w[4].lower()) in _DRAW_HEADER:
                return w[1]
    return float("inf")


def parse_volume_one(doc) -> tuple[list[dict], dict]:
    """Every schedule row in Volume I, plus the counters the report prints."""
    stats = Counter()
    collected: list[dict] = []
    context: dict[str, str] = {}
    for i in range(doc.page_count):
        page = doc[i]
        if drawback_top(page) != float("inf"):
            stats["drawbackPages"] += 1
        found = parse_schedule_page(page, i + 1, context)
        if not found:
            if sum(1 for w in page.get_text("words") if HS8.match(w[4])) >= 3:
                stats["unfittedPages"] += 1
            continue
        stats["schedulePages"] += 1
        collected.extend(found)
    return collected, stats


RATE_KEYS = ("basicBcdRate", "effectiveBcdRate", "igstRate", "swsOfAv",
             "totalIncidencePercent", "rateText")
_RANK = {VERIFIED: 0, REPAIRED: 1, UNVERIFIED: 2}


def _rates_of(row: dict) -> tuple:
    return tuple(row.get(k) for k in RATE_KEYS)


def dedupe(found: list[dict]) -> tuple[list[dict], list[str]]:
    """
    One row per CTH, and an honest account of the codes that carry more than one
    printed rate.

    A code appearing twice is usually a page break or a repeated heading. But it
    is also, often, the book being right: 03069100 prints 30% BCD against both
    nil and 5% IGST on the same page, and both reconcile against their own
    TOTAL, because the rate turns on the state of the goods. Textiles do the
    same by sale-value bracket ("of sale value not exceeding Rs.2500 per piece"
    against "exceeding"). Collapsing those to one number would invent a rate the
    book does not state.

    So: the best-graded reading leads, and every other reading that reconciles
    is kept beside it as a variant. A code with variants is not a defect to
    report, it is a choice the goods description has to settle — the same shape
    notification-choose.ts already hands to the model. Only a disagreement where
    nothing reconciles is a parse failure, and those are reported.
    """
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in found:
        grouped[row["cth"]].append(row)

    out: list[dict] = []
    conflicts: list[str] = []
    for cth in sorted(grouped):
        readings = sorted(grouped[cth], key=lambda r: (_RANK[r["confidence"]], r["page"]))
        best = readings[0]
        tier = best["confidence"]
        distinct: dict[tuple, dict] = {}
        for r in readings:
            if r["confidence"] == tier:
                distinct.setdefault(_rates_of(r), r)

        if len(distinct) > 1:
            if tier == UNVERIFIED:
                conflicts.append(
                    f"{cth}: {len(distinct)} readings and none reconciles — "
                    + "; ".join(
                        f"p{r['page']} BCD {r.get('basicBcdRate')}/"
                        f"{r.get('effectiveBcdRate')} IGST {r.get('igstRate')}"
                        for r in list(distinct.values())[:3]
                    )
                )
            else:
                best = dict(best)
                best["variants"] = [
                    {**{k: v for k, v in r.items() if k in RATE_KEYS and v is not None},
                     "description": r["description"], "page": r["page"]}
                    for r in list(distinct.values())[1:]
                ]
        out.append(best)
    return out, conflicts


# --------------------------------------------------------------------------- #
#  Vision repairs
# --------------------------------------------------------------------------- #
#
# A row the arithmetic cannot reconcile is not always a row the *page* cannot
# settle: on page 104 the text layer carries ":io.oo" where the scan plainly
# prints 30.00, and on 129 "o.oo" for 0.00. Those are legible to a reader and
# lost to the OCR, so they are read again from the rendered page by
# packages/extraction/cli/repair-tariff-book.ts and land in repairs.json.
#
# The repairs are merged here rather than written straight into the schedule so
# that this script stays the single thing that decides what a row says, and so
# a fresh clone with no repairs file still builds. Nothing arrives trusted: a
# repair is put through exactly the same grader as the original parse, and one
# that does not reconcile is dropped. The model is a second pair of eyes on the
# page; the arithmetic is still the judge.

REPAIRS = OUT / "repairs.json"


def apply_repairs(schedule: list[dict]) -> int:
    if not REPAIRS.exists():
        return 0
    repairs = json.loads(REPAIRS.read_text()).get("rows", {})
    if not repairs:
        return 0
    by_cth = {row["cth"]: row for row in schedule}
    applied = 0
    for cth, fix in repairs.items():
        row = by_cth.get(cth)
        if row is None or row["confidence"] != UNVERIFIED:
            continue
        confidence, graded = grade(
            fix.get("basicBcdRate"), fix.get("effectiveBcdRate"),
            fix.get("igstRate"), fix.get("swsOfAv"),
            fix.get("totalIncidencePercent"),
        )
        if confidence == UNVERIFIED:
            continue
        sws = graded["sws"]
        row.update({
            "basicBcdRate": graded["basic"],
            "effectiveBcdRate": graded["effective"],
            "igstRate": graded["igst"],
            "totalIncidencePercent": graded["total"],
            "confidence": REPAIRED,
            "repairedBy": "vision",
        })
        if sws is not None:
            row["swsOfAv"] = sws
            row["swsRate"] = 0.0 if abs(sws) <= TOLERANCE else 10.0
        applied += 1
    return applied


# --------------------------------------------------------------------------- #
#  Invariants
# --------------------------------------------------------------------------- #
#
# build-masters.py aborts when a notification's serials are not 1..n, because a
# gap means a row was dropped or split. The schedule has no serials, so these
# are its equivalents. Each message says what the failure *means*, not just
# that it happened.


def check_invariants(schedule: list[dict], pass_rate: float) -> None:
    if len(schedule) < MIN_ROWS:
        raise SystemExit(
            f"Only {len(schedule)} tariff rows parsed, expected at least {MIN_ROWS}. "
            "Pages are being skipped — check the drawback classifier and the "
            "column fit before trusting this build."
        )

    if pass_rate < CHECKSUM_FLOOR:
        raise SystemExit(
            f"Only {pass_rate:.1%} of rows reconcile against the printed TOTAL, "
            f"floor is {CHECKSUM_FLOOR:.0%}. The source reads worse than the "
            "edition this parser was written against; do not ship it."
        )

    chapters = {int(r["cth"][:2]) for r in schedule}
    expected = set(range(1, 99)) - RESERVED_CHAPTERS
    missing = sorted(expected - chapters)
    if missing:
        raise SystemExit(
            f"Chapters absent from the parse: {missing}. Every chapter of the "
            "First Schedule carries tariff items, so a missing one is a page "
            "range that failed to read, not an empty chapter."
        )

    unexpected = sorted(chapters - set(range(1, 99)))
    if unexpected:
        raise SystemExit(
            f"Codes parsed into chapters that do not exist: {unexpected}. A "
            "drawback page has most likely been read as a schedule page."
        )


# --------------------------------------------------------------------------- #
#  Volume I: Section and Chapter Notes
# --------------------------------------------------------------------------- #
#
# Before each chapter's rate table the book prints that chapter's Notes, and
# under the General Interpretative Rules those notes are what actually decide a
# contested heading — Note 1 to Chapter 7 says the chapter "does not cover
# forage products of heading 1214", and no amount of reading the goods
# description will tell you that.
#
# They matter here because of what they let the classifier stop apologising
# for. classify-propose.ts currently tells the model "if the goods could fall
# under a Section or Chapter Note you cannot see here, answer null", which is
# the honest instruction while the notes are only on paper, and a permanent
# ceiling on how often it can answer at all. With the notes parsed, the
# candidates can carry the note that governs them.

NOTES_MARKER = re.compile(r"^N[o0]tes?\.?$", re.I)
CHAPTER_HEAD = re.compile(r"^Chapter\s*(\d{1,2})$", re.I)
# The notes end where the tariff table begins, or where the book moves on to
# the export-policy conditions it prints in the same position.
NOTES_END = re.compile(r"^(HS\s*CODE|Export\s+Policy|Sub-?Heading\s+Notes?)", re.I)


def parse_chapter_notes(doc) -> list[dict]:
    """
    The Notes printed ahead of each chapter's rate table.

    Only the first Notes block a chapter opens is kept. The word appears again
    further on — "Sub-heading Notes", and the running head reprints the chapter
    number on every page — and reopening on those splices one chapter's notes
    onto another's, which is worse than having none: a classifier told that
    Chapter 2 excludes mammals of heading 0106 will exclude the wrong goods.
    """
    found: dict[int, dict] = {}
    closed: set[int] = set()
    chapter: int | None = None
    capturing = False
    expect_title = False

    for i in range(doc.page_count):
        for row in rows(doc[i]):
            line = prose(" ".join(w[4] for w in row))
            if not line:
                continue
            head = CHAPTER_HEAD.match(re.sub(r"^(Chapter)\s*(\d)", r"\1 \2", line))
            if head:
                number = int(head.group(1))
                if number != chapter:
                    chapter, capturing, expect_title = number, False, True
                continue
            if chapter is None:
                continue
            # The line under the chapter head is normally its title, but the
            # book sometimes prints a budget annotation there instead. A title
            # is a name, so anything parenthesised or talking about rates is not
            # one, and no title is better than a wrong one.
            if (expect_title and len(line) > 12 and not NOTES_MARKER.match(line)
                    and not re.match(r"^[({\[]|.*\bBCD\b|.*\brate\b", line, re.I)):
                found.setdefault(chapter, {"chapter": chapter, "title": line,
                                           "notes": [], "page": i + 1})
                expect_title = False
                continue
            if NOTES_MARKER.match(line):
                if chapter in closed:
                    continue
                capturing = True
                expect_title = False
                entry = found.setdefault(chapter, {"chapter": chapter, "title": "",
                                                   "notes": [], "page": i + 1})
                entry["page"] = i + 1
                continue
            if not capturing:
                continue
            if NOTES_END.match(line) or HS8.match(row[0][4]) or HEADING.match(row[0][4]):
                capturing = False
                closed.add(chapter)
                continue
            entry = found[chapter]
            # A note runs over several lines and only its first carries the
            # number; anything else continues the note above it.
            if re.match(r"^\d{1,2}\s*[.)]", line):
                entry["notes"].append(line)
            elif entry["notes"]:
                entry["notes"][-1] = f"{entry['notes'][-1]} {line}"

    return [found[c] for c in sorted(found) if found[c]["notes"]]


# --------------------------------------------------------------------------- #
#  Volume I: the drawback tables
# --------------------------------------------------------------------------- #
#
# 163 pages of All Industry Rates, printed after each chapter's tariff rows and
# set in two columns of (Tariff Item, Description, Unit, Drawback Rate, cap in
# Rs. per unit). The serials are HS-aligned but they are *drawback* item
# numbers, not tariff items — 61150106 is a drawback serial and not a code any
# Bill of Entry declares — so they are kept in their own file and never merged
# into the schedule.
#
# Unlike the rate table there is no arithmetic here: a drawback rate is a
# percentage of FOB with a cap, and nothing on the row constrains it. That
# matters, because page 400 prints "12%" and "1.2%" against sibling headings
# and the scan cannot be trusted to tell them apart. So every rate is kept as
# printed alongside its parsed value, and the file says plainly that it is not
# verified. It is a reference for a human, not an input to a calculation, until
# it has been reconciled against the Department of Revenue's own schedule.

DRAWBACK_CODE = re.compile(r"^(\d{4}|\d{6}|\d{8})$")
DRAWBACK_RATE = re.compile(r"^(\d{1,3}(?:\.\d{1,2})?)\s*%$")
DRAWBACK_UNITS = {"kg", "kg.", "piece", "pieces", "pair", "pairs", "sqm", "unit",
                  "nos", "no.", "gm", "gms", "ltr", "mtr", "set", "tonne", "mt"}


def parse_drawback_page(page, page_no: int) -> list[dict]:
    top = drawback_top(page)
    if top == float("inf"):
        return []
    mid = page.rect.width / 2
    out: list[dict] = []
    for row in rows(page):
        if row[0][1] <= top:
            continue
        halves = ([w for w in row if (w[0] + w[2]) / 2 < mid],
                  [w for w in row if (w[0] + w[2]) / 2 >= mid])
        for half in halves:
            if not half or not DRAWBACK_CODE.match(half[0][4]):
                continue
            rest = half[1:]
            rate = None
            rate_printed = None
            cap = None
            words_out: list[str] = []
            unit = None
            for w in rest:
                token = w[4]
                m = DRAWBACK_RATE.match(token)
                if m and rate is None:
                    rate, rate_printed = float(m.group(1)), token
                    continue
                if rate is not None and cap is None and number(token) is not None:
                    cap = number(token)
                    continue
                if token.lower() in DRAWBACK_UNITS and unit is None:
                    unit = token
                    continue
                if rate is None:
                    words_out.append(token)
            if rate is None:
                continue
            out.append({
                "serial": half[0][4],
                "description": prose(" ".join(words_out)),
                **({"unit": unit} if unit else {}),
                "rate": rate,
                # Kept because the parsed value cannot be checked against
                # anything: a reviewer comparing "1.2%" to 1.2 is the only
                # verification this table admits of.
                "ratePrinted": rate_printed,
                **({"capRupees": cap} if cap is not None else {}),
                "page": page_no,
            })
    return out


def flag_suspect_rates(entries: list[dict]) -> int:
    """
    Mark drawback rates that are an order of magnitude out of step with their
    chapter, without changing them.

    All Industry Rates cluster tightly within a chapter — organic chemicals sit
    around 1-2%, garments around 1-5%. Chapter 29 comes off this scan with 21
    entries at 12% and 18 at 1.2%, which is not a spread, it is the same number
    read two ways. The AIR for organic chemicals is not 12%, so those are almost
    certainly a lost decimal point.

    Almost certainly is not certainly, and there is no arithmetic here to
    settle it the way the rate table settles itself. Correcting them would be
    inventing a duty drawback claim; leaving them silent would let someone file
    one. So they are flagged, the printed text is kept beside the parsed value,
    and a reviewer decides.
    """
    by_chapter: dict[str, list[float]] = defaultdict(list)
    for entry in entries:
        by_chapter[entry["serial"][:2]].append(entry["rate"])
    medians = {ch: statistics.median(rates) for ch, rates in by_chapter.items()}
    flagged = 0
    for entry in entries:
        median = medians[entry["serial"][:2]]
        if median > 0 and entry["rate"] / median >= 8:
            entry["rateUncertain"] = True
            flagged += 1
    return flagged


# --------------------------------------------------------------------------- #
#  Volume II: what each notification occupies
# --------------------------------------------------------------------------- #
#
# Volume II is 1,456 pages of notification text — the exemptions, the
# anti-dumping and safeguard duties, the FTA concessions, the Customs Tariff
# Act — printed one after another with no machine-readable break between them.
# Read as one document it is useless: a search for the condition attached to a
# concession returns whatever prose happens to look similar anywhere in a
# thousand pages.
#
# So what is emitted here is not the text but the *map*: which pages each
# notification occupies. That is what turns Volume II from a haystack into an
# index, because Volume I already names the notification for a tariff line —
# "Ntfn 45/2025-Cus. - Sl No.24" — so a duty question does not need to search
# at all. It needs to read notification 45/2025 near serial 24, and this says
# where that is.

# Where the map comes from. The first attempt read notification headings off
# the body pages, and found 31 of the 135 notifications the schedule cites: the
# exemption appendix heads each one "Ntfn 45 dated 24.10.2025", but the General
# Exemption section, which is most of the volume, sets them out by subject with
# no heading a parser can anchor on. The Contents has no such gaps. It lists all
# of them, each with the page label it starts on — "B-32", "G-75" — and every
# body page prints its own label in the running head. Joining the two gives the
# physical page for each notification without reading the body at all.

# The number and date classes admit the letters this scan substitutes for
# digits — "Ntfn4Sdated24.10.202S" is the Contents line for 45/2025, the jumbo
# exemption itself, and a strict \\d drops the one notification that matters most.
CONTENTS_ENTRY = re.compile(
    r"^Ntfn\s*([0-9OoIlSZ]{1,3})\s*(?:\(([A-Za-z. ]{1,8})\))?\s*dated\s*([\dOoIlSZ.]+)",
    re.I,
)
# The label a Contents line ends on. The scan reads a "B" as "0" often enough
# to matter ("0-36" between B-35 and B-37); the section is recovered from the
# entries around it rather than guessed.
CONTENTS_LABEL = re.compile(r"([ABG0])\s*[-\u00b7.]\s*([0-9IlO]{1,4})\s*$")
PAGE_LABEL = re.compile(r"^([ABG])[-\u00b7.](\d{1,4})[I|l]?$")
_OCR_DIGITS = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "S": "5", "Z": "2"})
_LEADER = re.compile(r"\s*[.\-_\u00b7 ]{4,}.*$")


def page_labels(doc) -> dict[tuple[str, int], int]:
    """Printed label -> physical page, from the running head of every page."""
    labels: dict[tuple[str, int], int] = {}
    for i in range(doc.page_count):
        for row in rows(doc[i])[:3]:
            hit = next((PAGE_LABEL.match(w[4].strip()) for w in row
                        if PAGE_LABEL.match(w[4].strip())), None)
            if hit:
                labels.setdefault((hit.group(1), int(hit.group(2))), i + 1)
                break
    return labels


def physical_page(labels: dict[tuple[str, int], int], section: str, number: int) -> int | None:
    """
    The physical page a label lands on. About one page in fourteen has a running
    head the OCR could not read, so a missing label is placed from the nearest
    one that was read in the same section — pages run consecutively within a
    section, so the offset carries across the gap.
    """
    if (section, number) in labels:
        return labels[(section, number)]
    known = sorted(n for s, n in labels if s == section)
    if not known:
        return None
    nearest = min(known, key=lambda n: abs(n - number))
    if abs(nearest - number) > 12:
        return None  # too far to trust the offset across
    return labels[(section, nearest)] + (number - nearest)


def contents_pages(doc) -> set[int]:
    """
    The pages of the Contents, found by what is on them rather than by where the
    body's page labels begin. A Contents page ends its lines in labels too —
    "... A-1" — so the first labelled page is not the first body page, and
    taking it as one leaves the parser reading four pages of Contents instead of
    thirty.
    """
    found: set[int] = set()
    for i in range(doc.page_count):
        hits = sum(
            1 for row in rows(doc[i])
            if CONTENTS_ENTRY.match(prose(" ".join(w[4] for w in row)))
        )
        if hits >= 3:
            found.add(i)
        elif found and i - max(found) > 8:
            # The Contents is one run at the front, but not an unbroken one:
            # section dividers and subject headings leave pages with one entry
            # or none (15-18 here). A short gap is inside the run; a long one
            # means the body has begun.
            break
    return found


def parse_notification_map(doc) -> list[dict]:
    """Every notification Volume II prints, with the pages it occupies."""
    contents = contents_pages(doc)
    labels = {k: v for k, v in page_labels(doc).items() if v - 1 not in contents}

    entries: list[dict] = []
    title_lines: list[str] = []
    section = "A"
    for i in sorted(contents):
        for row in rows(doc[i]):
            line = prose(" ".join(w[4] for w in row))
            if not line:
                continue
            match = CONTENTS_ENTRY.match(line)
            if not match:
                title_lines.append(line)
                continue
            label = CONTENTS_LABEL.search(line) or next(
                (CONTENTS_LABEL.search(t) for t in reversed(title_lines[-2:])
                 if CONTENTS_LABEL.search(t)), None)
            # A title wraps onto at most two lines. Anything further back is a
            # section divider ("PART-I APPENDICES Appendix-A") and not the name
            # of this notification.
            title = " ".join(_LEADER.sub("", t) for t in title_lines[-2:]).strip()
            # The Contents' own running head lands in front of the first entry
            # on each page.
            title = re.sub(r"^(?:\S{0,6}\s+)?contents\s+", "", title, flags=re.I)
            title_lines = []
            if not label:
                continue
            letter = label.group(1)
            section = letter if letter in "ABG" else section
            number = int(label.group(2).translate(_OCR_DIGITS))
            page = physical_page(labels, section, number)
            date = match.group(3).translate(_OCR_DIGITS).strip(".")
            year = date.split(".")[-1] if date.count(".") == 2 else ""
            kind = re.sub(r"[^A-Za-z]", "", match.group(2) or "Cus").upper()
            entry = {
                "number": int(match.group(1).translate(_OCR_DIGITS)),
                "kind": kind,
                "date": date,
                "title": prose(title)[:240],
                "label": f"{section}-{number}",
                **({"startPage": page} if page else {}),
            }
            # A notification is known by number *and year*; a date the scan
            # truncated ("27.") leaves the year unknowable, and a guessed year
            # would file the text under a different notification.
            if len(year) in (2, 4):
                if len(year) == 2:
                    year = f"20{year}" if int(year) < 50 else f"19{year}"
                entry["notification"] = f"{entry['number']:03d}/{year}"
            entries.append(entry)

    # A notification ends where the next one in page order begins.
    placed = sorted((e for e in entries if "startPage" in e), key=lambda e: e["startPage"])
    for earlier, later in zip(placed, placed[1:]):
        earlier["endPage"] = max(earlier["startPage"], later["startPage"] - 1)
    if placed:
        placed[-1]["endPage"] = doc.page_count
    return entries


# The text itself, for retrieval. Written beside the source PDFs rather than into
# the committed output: the map of which notification sits where is a fact we
# derived, but a thousand pages of the publisher's own prose is the book, and
# it stays as private as the book does.
VOL2_TEXT = SOURCE / "vol2-text.jsonl"

# Where a page has a clean vertical gutter at the middle, it is set in two
# columns and must be read one column at a time; joining across the gutter
# interleaves two unrelated sentences on every line. A table cell that happens
# to straddle the middle is not a gutter, so it takes most rows being split.
_GUTTER = 0.04
_TWO_COLUMN_SHARE = 0.6


def page_text(page) -> str:
    """One page of Volume II as readable text, in reading order."""
    page_rows = [r for r in rows(page) if r[0][1] >= HEADER_BAND * 0.6]
    if not page_rows:
        return ""
    mid, width = page.rect.width / 2, page.rect.width
    split = sum(
        1 for r in page_rows
        if any(w[2] < mid - _GUTTER * width for w in r)
        and any(w[0] > mid + _GUTTER * width for w in r)
        and not any(w[0] < mid < w[2] for w in r)
    )
    if split >= _TWO_COLUMN_SHARE * len(page_rows):
        left = [" ".join(w[4] for w in r if (w[0] + w[2]) / 2 < mid) for r in page_rows]
        right = [" ".join(w[4] for w in r if (w[0] + w[2]) / 2 >= mid) for r in page_rows]
        lines = [l for l in left if l] + [l for l in right if l]
    else:
        lines = [" ".join(w[4] for w in r) for r in page_rows]
    return prose("\n".join(lines))


def write_volume_two_text(doc, notifications: list[dict]) -> int:
    """Every notification page's text, tagged with the notification it belongs to."""
    written = 0
    with VOL2_TEXT.open("w") as out:
        for entry in notifications:
            if "notification" not in entry or "startPage" not in entry:
                continue
            for page_no in range(entry["startPage"], entry["endPage"] + 1):
                text = page_text(doc[page_no - 1])
                if len(text) < 40:
                    continue
                out.write(json.dumps({
                    "notification": entry["notification"],
                    "kind": entry["kind"],
                    "title": entry["title"],
                    "page": page_no,
                    "text": text,
                }, ensure_ascii=False) + "\n")
                written += 1
    return written


# --------------------------------------------------------------------------- #
#  Volume III: the alphabetical product index
# --------------------------------------------------------------------------- #
#
# 154 pages mapping a product *name* to the heading it is classified under —
# "Flatirons Electric .... 8516.40", "Flaxseed (Linseed) .... 1204.00". It is
# the only thing in the three volumes that answers "what code is this?" rather
# than "what does this code cost?", which is the question the pipeline cannot
# answer today: the extraction prompts forbid inferring an HS code from a goods
# description, because a guessed code pulls in the wrong compliance
# requirements.
#
# This index does not turn a guess into a classification — it is a finding aid,
# not a legal one, and it knows nothing of the Section and Chapter Notes that
# actually decide a contested heading. What it does is turn an open question
# into a closed list of real tariff headings, which the model can then choose
# between and cite. That is the same shape notification-choose.ts already uses.

# A dotted leader separates the name from the code. Three or more dots, because
# the scan renders a leader as anything from ".." to a long run.
INDEX_ENTRY = re.compile(r"^(.{3,120}?)\s*[.\u00b7]{3,}\s*(.+)$")

# "8516.40", "5301", "7219-7220", "8460.11-90", "Ch. 84-3", "3004.90, Ch. 30-1"
INDEX_CODE = re.compile(r"^(?:Ch\.?\s*)?\d{2,4}(?:[.\u00b7]\d{2})?")
CODE_PART = re.compile(r"(\d{4})(?:[.\u00b7](\d{2}))?")

# A sub-entry hangs off the entry above it: "Fittings and Similar Articles"
# followed by "-of base metals, for furniture". Read alone the sub-entry is
# meaningless, so it carries its parent.
SUB_ENTRY = re.compile(r"^[-\u2022\u00b7]\s*")


def index_columns(page) -> list[list[tuple[float, str]]]:
    """
    The index is set in two columns, and it reads down one before starting the
    other. Returning them interleaved would scramble the parent of every
    sub-entry, so each column comes back whole and in order.

    The indent of each line comes back with it, because indentation is what
    marks a sub-entry: "Copper" is flush left and "bars, rods and profiles"
    hangs under it, and read on its own the sub-entry classifies nothing.
    """
    mid = page.rect.width / 2
    columns: list[list[tuple[float, str]]] = [[], []]
    for row in rows(page):
        halves = ([w for w in row if (w[0] + w[2]) / 2 < mid],
                  [w for w in row if (w[0] + w[2]) / 2 >= mid])
        for side, half in enumerate(halves):
            if half:
                columns[side].append((half[0][0], " ".join(w[4] for w in half)))
    return columns


def parse_product_index(doc) -> list[dict]:
    entries: list[dict] = []
    for i in range(doc.page_count):
        columns = index_columns(doc[i])
        if sum(1 for col in columns for _, ln in col if INDEX_ENTRY.match(ln)) < 8:
            continue  # not an index page: front matter, or the rules of origin
        for column in columns:
            if not column:
                continue
            # A column's own flush-left margin. Taken as the commonest indent
            # rather than the smallest, because one stray word bleeding across
            # the midline would otherwise redefine the margin for the page.
            flush = Counter(round(x) for x, _ in column).most_common(1)[0][0]
            entries.extend(_parse_index_column(column, float(flush), i + 1))
    return entries


def _parse_index_column(column: list[tuple[float, str]], flush: float,
                        page_no: int) -> list[dict]:
    entries: list[dict] = []
    parent = ""
    for x, line in column:
            m = INDEX_ENTRY.match(line.strip())
            if not m:
                continue
            name, tail = prose(m.group(1)), m.group(2).strip()
            if not INDEX_CODE.match(tail):
                continue
            headings = sorted({
                part.group(1) + (part.group(2) or "")
                for part in CODE_PART.finditer(tail)
            })
            if not headings:
                continue
            if (SUB_ENTRY.match(name) or x > flush + 3.0) and parent:
                term = f"{parent} {prose(name)}"
            else:
                parent = name
                term = name
            if len(term) < 3:
                continue
            entries.append({
                "term": term,
                "headings": headings,
                "printed": tail,
                "page": page_no,
            })
    return entries


# --------------------------------------------------------------------------- #
#  Emit
# --------------------------------------------------------------------------- #


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def check_manifest(paths: dict[int, Path]) -> dict[str, str]:
    """
    Pin the PDFs by digest. The books are bought rather than fetched, so unlike
    the CBIC corpus there is no command that reproduces them; recording what was
    parsed is the only way "where did this number come from" keeps an answer.
    """
    actual = {p.name: digest(p) for p in paths.values()}
    if MANIFEST.exists():
        recorded = dict(
            line.split("  ", 1)[::-1]
            for line in MANIFEST.read_text().split("\n")
            if "  " in line
        )
        drifted = [n for n, d in actual.items() if n in recorded and recorded[n] != d]
        if drifted:
            raise SystemExit(
                f"Source PDFs differ from {MANIFEST.name}: {drifted}. This is a "
                "different edition or a re-scan. Review what changed, then delete "
                "the manifest to re-pin it."
            )
    else:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(
            "".join(f"{d}  {n}\n" for n, d in sorted(actual.items()))
        )
        print(f"  pinned {len(actual)} source PDFs in {MANIFEST.relative_to(REPO)}")
    return actual


def write_json(name: str, payload: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    size = path.stat().st_size
    print(f"  wrote {path.relative_to(REPO)}  ({size / 1e6:.1f} MB)")


def main() -> None:
    paths = {n: SOURCE / f for n, f in BOOKS.items()}
    missing = [str(p.relative_to(REPO)) for p in paths.values() if not p.exists()]
    if missing:
        raise SystemExit(
            f"Source books not found: {missing}. They are gitignored (162 MB of "
            "bought, copyrighted PDFs); put them in data/tariff-books/ named as "
            f"{sorted(BOOKS.values())}."
        )
    digests = check_manifest(paths)

    vol1 = fitz.open(paths[1])
    found, stats = parse_volume_one(vol1)
    schedule, conflicts = dedupe(found)

    repaired_by_vision = apply_repairs(schedule)

    tiers = Counter(r["confidence"] for r in schedule)
    good = tiers[VERIFIED] + tiers[REPAIRED]
    pass_rate = good / len(schedule) if schedule else 0.0
    check_invariants(schedule, pass_rate)

    unverified = [r["cth"] for r in schedule if r["confidence"] == UNVERIFIED]

    write_json("schedule.json", {
        "_generated": "do not edit by hand — python3 packages/core/scripts/build-tariff-book.py",
        "source": "bdp",
        "publisher": PUBLISHER,
        "edition": EDITION,
        "volume": 1,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": digests[BOOKS[1]],
        "rowCount": len(schedule),
        "checksumPassRate": round(pass_rate, 4),
        "confidence": dict(tiers),
        # Published rather than hidden, the way build-masters.py exports the
        # amendments it could not apply: these are the rows a reviewer owes
        # attention to, and merge.ts can refuse to auto-apply them.
        "unverified": unverified,
        "rows": schedule,
    })

    drawback: list[dict] = []
    for i in range(vol1.page_count):
        drawback.extend(parse_drawback_page(vol1[i], i + 1))
    suspect = flag_suspect_rates(drawback)
    write_json("drawback.json", {
        "_generated": "do not edit by hand — python3 packages/core/scripts/build-tariff-book.py",
        "source": "bdp",
        "publisher": PUBLISHER,
        "edition": EDITION,
        "volume": 1,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": digests[BOOKS[1]],
        "entryCount": len(drawback),
        "uncertainRates": suspect,
        # Said once, plainly, in the file itself: unlike the rate table nothing
        # here checks itself, so this is a reference for a person and not an
        # input to a calculation until it is reconciled against the Department
        # of Revenue's own schedule.
        "verified": False,
        "note": (
            "All Industry Rates as printed. No arithmetic constrains a drawback "
            "rate, so none of these is checked; rateUncertain marks the ones an "
            "order of magnitude out of step with their chapter, which is what a "
            "lost decimal point looks like. Reconcile against the DoR schedule "
            "before any of this is claimed."
        ),
        "entries": drawback,
    })

    notes = parse_chapter_notes(vol1)
    write_json("chapter-notes.json", {
        "_generated": "do not edit by hand — python3 packages/core/scripts/build-tariff-book.py",
        "source": "bdp",
        "publisher": PUBLISHER,
        "edition": EDITION,
        "volume": 1,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": digests[BOOKS[1]],
        "chapterCount": len(notes),
        "noteCount": sum(len(n["notes"]) for n in notes),
        "chapters": notes,
    })

    vol2 = fitz.open(paths[2])
    notifications = parse_notification_map(vol2)
    write_json("notifications.json", {
        "_generated": "do not edit by hand — python3 packages/core/scripts/build-tariff-book.py",
        "source": "bdp",
        "publisher": PUBLISHER,
        "edition": EDITION,
        "volume": 2,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": digests[BOOKS[2]],
        "notificationCount": len({n["notification"] for n in notifications if "notification" in n}),
        "unplaced": sum(1 for n in notifications if "startPage" not in n),
        "pageCount": vol2.page_count,
        "notifications": notifications,
    })

    vol2_pages = write_volume_two_text(vol2, notifications)

    index = parse_product_index(fitz.open(paths[3]))
    headings = {h for e in index for h in e["headings"]}
    known = {r["cth"][:4] for r in schedule} | {r["cth"][:6] for r in schedule}
    orphans = sorted(headings - known)
    write_json("product-index.json", {
        "_generated": "do not edit by hand — python3 packages/core/scripts/build-tariff-book.py",
        "source": "bdp",
        "publisher": PUBLISHER,
        "edition": EDITION,
        "volume": 3,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": digests[BOOKS[3]],
        "entryCount": len(index),
        "headingCount": len(headings),
        # Headings the index names that the schedule does not carry. A few are
        # expected — the index is set against HS-2022 and cites Chapter Notes as
        # well as headings — but a large number would mean one of the two parses
        # has drifted.
        "headingsNotInSchedule": orphans,
        "entries": index,
    })

    print(f"\n  {len(schedule)} tariff items from {stats['schedulePages']} schedule pages "
          f"({stats['drawbackPages']} drawback pages skipped, "
          f"{stats['unfittedPages']} pages with rows but no readable columns)")
    print(f"  {tiers[VERIFIED]} verified, {tiers[REPAIRED]} repaired "
          f"({repaired_by_vision} of them re-read from the page image), "
          f"{tiers[UNVERIFIED]} unverified — {pass_rate:.1%} reconcile")
    chapters = {int(r['cth'][:2]) for r in schedule}
    print(f"  {len(chapters)} chapters, {len({r['cth'][:6] for r in schedule})} subheadings")
    # Only CBIC's. Volume II prints customs notifications; a DGFT policy
    # notification being absent from it is correct, not a gap.
    cited = {r["notification"] for row in schedule for r in row.get("notificationRefs", [])
             if r.get("authority") == "CBIC"}
    mapped = {n["notification"] for n in notifications if "notification" in n and "startPage" in n}
    print(f"  {len(notifications)} notification sections in Vol II over "
          f"{len(mapped)} notifications; {len(cited & mapped)} of the {len(cited)} "
          f"the schedule cites are in it ({vol2_pages} pages of text for retrieval, "
          f"kept beside the PDFs and not committed)")
    print(f"  {sum(len(n['notes']) for n in notes)} chapter notes over {len(notes)} chapters")
    print(f"  {len(drawback)} drawback rates ({suspect} an order of magnitude "
          f"out of step with their chapter — unchecked, flagged)")
    print(f"  {len(index)} product-index entries over {len(headings)} headings "
          f"({len(orphans)} not in the schedule)")
    if conflicts:
        print(f"  {len(conflicts)} codes read differently on two pages:")
        for c in conflicts[:12]:
            print(f"    - {c}")
        if len(conflicts) > 12:
            print(f"    ... and {len(conflicts) - 12} more")


if __name__ == "__main__":
    main()
