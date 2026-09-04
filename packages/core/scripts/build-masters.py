#!/usr/bin/env python3
"""
Regenerates the reference masters in src/masters/generated/ from the source
documents in masters-source/.

    pip install pymupdf
    python3 packages/core/scripts/build-masters.py

The generated files are committed. This script exists so that "where did this
code come from" has an answer, and so a refreshed source list is one command
rather than a hand edit — the same reason packages/exporter clones the vendor's
own template instead of rebuilding it.

## Why the sources are read the way they are

The four reference lists are read as a stream of lines; the two CBIC duty
notifications are read as ruled tables (see "Duty rates" below), because only
the ruling says where one entry of a notification ends and the next begins.

Two of the list PDFs are set in a font whose "ti", "tt" and "ff" ligatures are
mapped to codepoints that are not those letters. Extracted naively, Rotterdam
comes out "RoƩerdam" and Argentina "ArgenƟna". LIGATURES below undoes that.
The set is closed and asserted: an unknown non-ASCII character aborts the build
rather than silently shipping a misspelt port into a Bill of Entry.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF is required: pip install pymupdf")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "masters-source"
OUT = ROOT / "src" / "masters" / "generated"

# Ligatures the source PDFs encode outside ASCII. Verified by eye against the
# rendered page — 'Ɵ' only ever stands for "ti", 'Ʃ' only for "tt".
LIGATURES = {
    "Ɵ": "ti",
    "Ʃ": "tt",
    "ﬀ": "ff",
    "（": "(",
    "）": ")",
    "’": "'",
    # The airline list divides itself into 【A】…【Z】 sections. The brackets carry
    # no data; dropping them leaves a bare letter the row parser skips anyway.
    "【": "",
    "】": "",
}

# Characters that are legitimately non-ASCII in a name we keep as-is.
ALLOWED_NON_ASCII = set("ôéèíáãçüöäñåæøÅÉÈÍÁÃÇÜÖÄÑ")


def clean(value: str) -> str:
    for bad, good in LIGATURES.items():
        value = value.replace(bad, good)
    value = re.sub(r"\s+", " ", value).strip()
    for ch in value:
        if ord(ch) > 126 and ch not in ALLOWED_NON_ASCII:
            raise SystemExit(
                f"Unmapped non-ASCII character {ch!r} (U+{ord(ch):04X}) in {value!r}. "
                "Add it to LIGATURES or ALLOWED_NON_ASCII after checking the rendered PDF."
            )
    return value


def pdf_lines(name: str) -> list[str]:
    doc = fitz.open(SOURCE / name)
    text = "".join(page.get_text() for page in doc)
    return [line for line in (clean(l) for l in text.split("\n")) if line]


# --------------------------------------------------------------------------- #
# The existing ISO country master, read back out of codes.ts.
#
# It is the authority for which alpha-2 codes are real; these lists are only
# allowed to add detail to it, never to invent a country.
# --------------------------------------------------------------------------- #

def existing_countries() -> dict[str, str]:
    src = (ROOT / "src" / "masters" / "codes.ts").read_text()
    block = src.split("export const COUNTRIES: Record<string, string> = {")[1].split("};")[0]
    pairs = re.findall(r"([A-Z]{2}):\s*(?:'((?:[^'\\]|\\.)*)'|\"([^\"]*)\")", block)
    return {code: (single or double).replace("\\'", "'") for code, single, double in pairs}


COUNTRIES = existing_countries()

# UN/LOCODE prefixes in the port list that ISO 3166-1 has since retired. Left
# as-is they would put a dead country code on a Bill of Entry, so they are
# remapped to the successor rather than dropped.
RETIRED_PREFIX = {
    "ANAUA": "AW",  # Aruba Is. — Netherlands Antilles dissolved 2010
    "ANCUR": "CW",  # Curacao
    "ANSFG": "SX",  # St. Martin (Dutch side)
    "ZRMAT": "CD",  # Matadi — Zaire is now Congo, DR
}


# --------------------------------------------------------------------------- #
# Foreign ports  —  port-name-and-code.pdf
# --------------------------------------------------------------------------- #

# Typos in the source document itself — not extraction artifacts. Every PDF
# text extractor agrees with what the page renders, and the page is wrong.
#
# Found by sorting: the list is alphabetical by intended name, so a misspelling
# lands out of order. Running that check over all 372 rows turns up exactly one
# real violation (the other seven are the source sorting "An Ping" before
# "Ancona", i.e. treating the space as a character, which is not an error).
#
# The printed spelling is kept as an alias, so a document that repeats the same
# mistake still resolves.
NAME_CORRECTIONS = {
    "CNTAO": "Qingdao",  # printed "Ingdao", filed between Pusan and Qinhuangdao
}



def build_foreign_ports() -> list[dict]:
    lines = pdf_lines("port-name-and-code.pdf")
    rows, i = [], 0
    while i < len(lines) - 2:
        if re.fullmatch(r"[A-Z]{5}", lines[i + 1]):
            rows.append((lines[i], lines[i + 1], lines[i + 2]))
            i += 3
        else:
            i += 1

    ports: dict[str, dict] = {}
    for name, unlocode, country_label in rows:
        if name == "Name of port":
            continue

        # "Leghorn(Livorno)" is one port under two names.
        aliases: list[str] = []
        paren = re.match(r"^(.*?)\((.*?)\)\s*$", name)
        if paren:
            name = paren.group(1).strip()
            alias = paren.group(2).strip()
            if alias.lower() != name.lower():
                aliases.append(alias)

        # A UN/LOCODE is by construction <ISO 3166-1 alpha-2><3-char locality>,
        # so the country code is in the code itself and needs no name matching.
        # That matters: the source spells countries "Chinese Mainland",
        # "Britain" and "Columbia", none of which resolve through iso2().
        country_code = RETIRED_PREFIX.get(unlocode, unlocode[:2])
        if country_code not in COUNTRIES:
            raise SystemExit(f"{unlocode} ({name}) has no ISO country {country_code}")

        corrected = NAME_CORRECTIONS.get(unlocode)
        if corrected and corrected.lower() != name.lower():
            aliases.append(name)
            name = corrected

        existing = ports.get(unlocode)
        if existing:
            # Two names for one code — keep the first, record the second.
            if name.lower() != existing["name"].lower() and name not in existing["aliases"]:
                existing["aliases"].append(name)
            continue

        ports[unlocode] = {
            "name": name,
            "unlocode": unlocode,
            "countryCode": country_code,
            "country": COUNTRIES[country_code],
            "aliases": aliases,
            "sourceCountry": country_label,
        }

    return sorted(ports.values(), key=lambda p: p["unlocode"])


# --------------------------------------------------------------------------- #
# Indian custom houses  —  custom-house-list.csv
# --------------------------------------------------------------------------- #

# The mode is not a column; it is in the name, which follows ICEGATE's own
# naming. Ordered — "ACC" beats "SEA" in "ACC SAHAR SEA"-shaped names is not a
# case that arises, but ICD/CFS must be tested before SEA so that an inland
# depot is not filed as a port.
MODE_PATTERNS = [
    ("air", r"\bACC\b|AIR CARGO|\bAIRPORT\b|\bAIR\b"),
    ("icd", r"\bICD\b|\bCFS\b|\bDRY PORT\b|\bINLAND\b"),
    ("sea", r"\bSEA\b|\bPORT\b|\bHARBOU?R\b|\bDOCK\b|\bJETTY\b|\bWHARF\b"),
    ("land", r"\bLCS\b|\bLAND\b|\bBORDER\b|\bRAIL\b"),
    ("sez", r"\bSEZ\b|\bEPZ\b|\bFTZ\b"),
]


def classify_mode(name: str) -> str | None:
    upper = name.upper()
    for mode, pattern in MODE_PATTERNS:
        if re.search(pattern, upper):
            return mode
    return None


def build_custom_houses() -> list[dict]:
    with (SOURCE / "custom-house-list.csv").open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    houses: dict[str, dict] = {}
    for row in rows:
        name = clean(row["Name"] or "")
        unece = clean(row["UNECE Code"] or "").upper()
        edi = clean(row["EDI"] or "").upper()
        email = clean(row["ICEGATE EmailAddress"] or "")
        if not name or not re.fullmatch(r"[A-Z0-9]{6}", unece):
            continue
        if unece in houses:
            continue
        houses[unece] = {
            "code": unece,
            "ediCode": edi,
            "name": name,
            "mode": classify_mode(name),
            "email": email.lower(),
        }

    return sorted(houses.values(), key=lambda h: h["code"])


# --------------------------------------------------------------------------- #
# Airlines  —  major-airline-code-list.pdf
# --------------------------------------------------------------------------- #

def build_airlines() -> list[dict]:
    lines = pdf_lines("major-airline-code-list.pdf")
    airlines: dict[str, dict] = {}
    i = 0
    while i < len(lines) - 3:
        prefix, name, country, iata = lines[i : i + 4]
        # The air waybill prefix is the 3-digit IATA accounting code that opens
        # every MAWB number: 020-1234 5675 is Lufthansa.
        if not (re.fullmatch(r"\d{3}", prefix) and re.fullmatch(r"[0-9A-Z]{2}", iata)):
            i += 1
            continue
        # ICAO is present for all but one row (774 Shanghai Airlines), so it is
        # read only if it is actually there. The token after a row without one
        # is the IATA-membership asterisk or a repeated page header, neither of
        # which is three capitals, and the next row opens with three digits —
        # so there is nothing for this to swallow by mistake.
        icao = lines[i + 4] if i + 4 < len(lines) else ""
        has_icao = bool(re.fullmatch(r"[A-Z]{3}", icao))
        if prefix not in airlines:
            airlines[prefix] = {
                "awbPrefix": prefix,
                "name": name,
                "country": country,
                "iata": iata,
                "icao": icao if has_icao else None,
            }
        i += 5 if has_icao else 4
    return sorted(airlines.values(), key=lambda a: a["awbPrefix"])


# --------------------------------------------------------------------------- #
# Country alpha-3  —  country-code-list.pdf
# --------------------------------------------------------------------------- #

def build_country_alpha3() -> dict[str, str]:
    doc = fitz.open(SOURCE / "country-code-list.pdf")
    text = clean_pages(doc)
    alpha3: dict[str, str] = {}
    # "Afghanistan   AF / AFG   93" — the separator is inconsistently spaced,
    # and a few rows run the pair together as "AC/ASC".
    for match in re.finditer(r"([A-Z]{2})\s*/\s*([A-Z]{3})", text):
        two, three = match.group(1), match.group(2)
        # The source is AT&T's telephone list, which carries a handful of
        # non-ISO territories (Ascension "AC/ASC"). The ISO master decides.
        if two in COUNTRIES:
            alpha3.setdefault(three, two)
    return dict(sorted(alpha3.items()))


def clean_pages(doc) -> str:
    return "".join(clean(page.get_text().replace("\n", " ")) for page in doc)


# --------------------------------------------------------------------------- #
# Duty rates  —  igst-rate-notification-09-2025.pdf,
#                bcd-exemption-notification-45-2025.pdf
#
# Two CBIC notifications, both in force:
#
#   9/2025-Integrated Tax (Rate), 17 Sep 2025 — supersedes 1/2017-IT(R) and is
#   now the whole IGST rate structure: seven schedules, one rate each, every
#   entry a tariff-code spec plus a description.
#
#   45/2025-Customs, 24 Oct 2025 — supersedes 50/2017-Customs and thirty other
#   notifications. Four tables of *effective* BCD (and where stated IGST and
#   compensation cess) rates, most of them conditional.
#
# Unlike the four list documents these are read with PyMuPDF's table finder,
# not the line stream: descriptions wrap over many lines and only the ruling
# says where one entry ends and the next begins. The parse is checked by serial
# number — a notification numbers its entries 1..n with no gaps, so a missing
# or duplicated serial means a row was dropped or split, and the build aborts.
# --------------------------------------------------------------------------- #

# Typographic punctuation the notifications set in prose. `clean()` is not used
# for these: it aborts on non-ASCII, which is right for a port name and wrong
# for a legal description that legitimately contains quotes and dashes.
PUNCTUATION = {
    "–": "-",  # en dash
    "—": "-",  # em dash
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
}


def prose(value: str | None) -> str:
    for bad, good in PUNCTUATION.items():
        value = (value or "").replace(bad, good)
    return re.sub(r"\s+", " ", value).strip()


def column_bounds(table) -> list[tuple[float, float]]:
    """The table's logical columns, as (x0, x1) pairs.

    A row is normally one cell per column, but the odd row is sliced into
    slivers by a stray ruling (S.No. 162 of Schedule I is cut into seven cells
    where its neighbours have three). Taking the most common layout as the
    truth and placing every cell by its midpoint keeps those rows aligned
    instead of shifting their columns left by one.
    """
    layouts: dict[tuple, int] = {}
    for row in table.rows:
        cells = tuple((round(c[0], 1), round(c[2], 1)) for c in row.cells if c)
        if cells:
            layouts[cells] = layouts.get(cells, 0) + 1
    if not layouts:
        return []
    return list(max(layouts, key=lambda k: layouts[k]))


def logical_rows(table) -> list[list[str]]:
    """Table rows as one string per logical column."""
    bounds = column_bounds(table)
    if not bounds:
        return []
    out = []
    for row, values in zip(table.rows, table.extract()):
        cells = [""] * len(bounds)
        for cell, value in zip(row.cells, values):
            value = prose(value)
            if not cell or not value:
                continue
            mid = (cell[0] + cell[2]) / 2
            index = next((i for i, (a, b) in enumerate(bounds) if a <= mid <= b), None)
            if index is None:  # outside every column — nearest one wins
                index = min(range(len(bounds)), key=lambda i: abs((bounds[i][0] + bounds[i][1]) / 2 - mid))
            cells[index] = f"{cells[index]} {value}".strip()
        out.append(cells)
    return out


# --------------------------------------------------------------------------- #
# Tariff-code specs
#
# Column (2) of both notifications is not a code, it is a little language:
#
#   0207 25 00, 0207 27 00      a list, spaced as the tariff prints it
#   5004 to 5006               a range of headings
#   0910 [other than 0910 11 10, 0910 30 10]   inclusion minus exclusions
#   2106 (other than 21069020)                 the same, other brackets
#   90 or any other Chapter    a chapter plus "wherever else it may fall"
#   Any Chapter                anything
#
# It is parsed into prefixes: a spec matches a CTH when one of its include
# codes is a prefix of that CTH and none of its exclude codes is. Everything is
# stored digits-only, the convention the rest of masters/ uses.
# --------------------------------------------------------------------------- #

EXCLUSION = re.compile(r"[\[(]\s*(?:other than|except)\s*(.*?)(?:[\])]|$)", re.I | re.S)
ANY_CHAPTER = re.compile(r"\bany\s+(?:other\s+)?chapter\b", re.I)


def parse_codes(text: str) -> tuple[list[str], list[str]]:
    """Digit-only codes from a comma/or/and separated list; unread tokens too."""
    codes: list[str] = []
    unread: list[str] = []
    # Not `\bor\b`: the notification loses the space often enough ("1701 or1702")
    # that a word boundary on the right misses it, 'r' and '1' both being word
    # characters. Letters on either side are what actually rule "or" out — this
    # leaves "for", "motor" and "sorbitol" alone.
    text = re.sub(r"(?i)(?<![a-z])(?:or|and)(?![a-z])", ",", text)
    for token in text.split(","):
        token = token.strip().strip(".;:")
        if not token:
            continue
        span = re.fullmatch(r"(\d[\d ]*?)\s*to\s*(\d[\d ]*)", token, re.I)
        if span:
            low, high = span.group(1).replace(" ", ""), span.group(2).replace(" ", "")
            # Ranges are printed at one level ("5004 to 5006", "8525 81 to
            # 8525 89"); expanding them keeps the matcher a prefix test.
            if len(low) == len(high) and len(low) in (4, 6) and int(low) <= int(high):
                width = len(low)
                codes += [str(i).zfill(width) for i in range(int(low), int(high) + 1)]
                continue
            unread.append(token)
            continue
        if not re.fullmatch(r"[\d ]+", token):
            unread.append(token)
            continue
        digits = token.replace(" ", "")
        if len(digits) in (2, 4, 6, 8):
            codes.append(digits)
        elif len(digits) > 8 and len(digits) % 8 == 0:
            # A missing comma: "2711 12 00 2711 13 00" is two tariff items.
            codes += [digits[i : i + 8] for i in range(0, len(digits), 8)]
        else:
            unread.append(token)
    return codes, unread


def parse_spec(spec: str) -> dict:
    spec = prose(spec)
    excludes: list[str] = []
    unread: list[str] = []

    def take(match: re.Match) -> str:
        found, bad = parse_codes(match.group(1))
        excludes.extend(found)
        unread.extend(bad)
        return " "

    body = EXCLUSION.sub(take, spec)
    any_chapter = bool(ANY_CHAPTER.search(body))
    body = ANY_CHAPTER.sub(" ", body)
    body = re.sub(r"(?i)\bchapters?\b", " ", body)
    body = re.sub(r"[\[(].*?[\])]", " ", body)  # leftover bracketed prose
    includes, bad = parse_codes(body)
    unread += bad
    return {
        "spec": spec,
        "include": sorted(set(includes), key=includes.index),
        "exclude": sorted(set(excludes), key=excludes.index),
        "anyChapter": any_chapter,
        "unread": unread,
    }


def check_serials(label: str, serials: list[str]) -> None:
    numbers = [int(s) for s in serials]
    expected = list(range(1, max(numbers) + 1)) if numbers else []
    if numbers != expected:
        missing = sorted(set(expected) - set(numbers))
        repeated = sorted({n for n in numbers if numbers.count(n) > 1})
        raise SystemExit(
            f"{label}: serials are not 1..{max(numbers) if numbers else 0} in order — "
            f"missing {missing[:10]}, repeated {repeated[:10]}. A row was dropped or split."
        )


# --------------------------------------------------------------------------- #
# IGST schedules  —  notification 9/2025-Integrated Tax (Rate)
# --------------------------------------------------------------------------- #

SCHEDULE_HEADING = re.compile(r"^Schedule\s*[-]?\s*([IVX]+)\s*[-]\s*([\d.]+)\s*%")


def schedule_headings(page) -> list[tuple[float, str, float]]:
    """(y, schedule, rate) for every "Schedule II - 18 %" line on the page.

    A schedule can start half way down a page, so the rate that applies to a
    table is the last heading above it, not the last heading on the page.
    """
    found = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = prose("".join(span["text"] for span in line["spans"]))
            match = SCHEDULE_HEADING.match(text)
            if match:
                found.append((line["bbox"][1], match.group(1), float(match.group(2))))
    return found


def build_igst_schedule() -> list[dict]:
    doc = fitz.open(SOURCE / "igst-rate-notification-09-2025.pdf")
    entries: list[dict] = []
    current: tuple[str, float] | None = None

    for number, page in enumerate(doc, start=1):
        headings = schedule_headings(page)
        for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
            for y, schedule, rate in headings:
                if y <= table.bbox[1] + 2:
                    current = (schedule, rate)
            if current is None:  # the preamble table on page 1
                continue
            for cells in logical_rows(table):
                if len(cells) < 3:
                    continue
                serial, spec, description = cells[0], cells[1], " ".join(cells[2:]).strip()
                if serial.lower().startswith("s.") or serial == "(1)":
                    continue
                if re.fullmatch(r"\d+\.?", serial):
                    entries.append(
                        {
                            "schedule": current[0],
                            "rate": current[1],
                            "serial": serial.rstrip("."),
                            "description": description,
                            "page": number,
                            **parse_spec(spec),
                        }
                    )
                elif entries and not serial:
                    # A row continued across a page break or a ruled sub-row.
                    if spec:
                        merged = parse_spec(f"{entries[-1]['spec']} {spec}")
                        entries[-1].update({k: merged[k] for k in ("spec", "include", "exclude", "anyChapter", "unread")})
                    if description:
                        entries[-1]["description"] = f"{entries[-1]['description']} {description}".strip()

    for schedule in sorted({e["schedule"] for e in entries}):
        check_serials(f"IGST Schedule {schedule}", [e["serial"] for e in entries if e["schedule"] == schedule])
    return entries


# --------------------------------------------------------------------------- #
# Compensation cess  —  notification 1/2017-Compensation Cess (Rate)
# --------------------------------------------------------------------------- #

# One flat Schedule of 56 serials, so there are no schedule headings to track
# and the rate lives in column (4) of each row rather than in a heading. Read
# with the same helpers as 9/2025: the two notifications are ruled the same way.
#
# Amendments are NOT applied. Nineteen notifications amend this Schedule
# (2/2017 through 3/2025) and every one of them moves a rate on tobacco, coal or
# motor vehicles. The serial that matters for the trade this system files —
# S.No. 56, "any chapter, all other goods, Nil" — is untouched by all of them,
# and `check_serials` would fail the build if an amendment had added a 57th.
# Entries 1 to 55 are therefore published as candidates, never as a rate to
# file, which is the same position `staleBy` takes on 45/2025.
COMP_CESS_UNAPPLIED_AMENDMENTS = [
    "002/2017", "003/2017", "005/2017", "006/2017", "007/2017",
    "001/2018", "002/2018",
    "001/2019", "002/2019", "003/2019",
    "001/2021", "002/2021",
    "001/2023", "002/2023", "003/2023",
    "001/2024",
    "001/2025", "002/2025", "003/2025",
]


def build_comp_cess_schedule() -> list[dict]:
    doc = fitz.open(SOURCE / "comp-cess-rate-notification-01-2017.pdf")
    entries: list[dict] = []

    for number, page in enumerate(doc, start=1):
        for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
            for cells in logical_rows(table):
                if len(cells) < 4:
                    continue
                serial, spec, description, rate_text = cells[0], cells[1], cells[2], cells[3]
                # The header and the "(1) (2) (3) (4)" column-number row repeat
                # on every page. Neither is an entry, and neither may be folded
                # into the previous one as a continuation — that is how "(4)"
                # ends up inside S.No. 47's rate.
                if serial.lower().startswith("s.") or serial == "(1)" or description.lower().startswith("description of goods"):
                    continue
                if re.fullmatch(r"\d+\.?", serial):
                    entries.append(
                        {
                            "serial": serial.rstrip("."),
                            "description": description,
                            "rateText": rate_text,
                            "brandSensitive": bool(re.search(r"bearing a brand name", description, re.I)),
                            "page": number,
                            **parse_spec(spec),
                        }
                    )
                elif entries and not serial:
                    # A row continued across a page break. The motor-vehicle
                    # entries run to half a page and split their rate cell too.
                    if spec:
                        merged = parse_spec(f"{entries[-1]['spec']} {spec}")
                        entries[-1].update({k: merged[k] for k in ("spec", "include", "exclude", "anyChapter", "unread")})
                    if description:
                        entries[-1]["description"] = f"{entries[-1]['description']} {description}".strip()
                        entries[-1]["brandSensitive"] = bool(
                            re.search(r"bearing a brand name", entries[-1]["description"], re.I)
                        )
                    if rate_text:
                        entries[-1]["rateText"] = f"{entries[-1]['rateText']} {rate_text}".strip()

    check_serials("Compensation cess 1/2017", [e["serial"] for e in entries])
    residual = [e for e in entries if e["anyChapter"]]
    if len(residual) != 1 or residual[0]["serial"] != "56":
        raise SystemExit(
            "Compensation cess 1/2017: expected exactly one 'Any chapter' entry at S.No. 56, "
            f"got {[e['serial'] for e in residual]}. The residual entry is what every uncessed "
            "import files against, so a build that cannot find it must not ship."
        )
    return entries


# --------------------------------------------------------------------------- #
# BCD exemptions  —  notification 45/2025-Customs
# --------------------------------------------------------------------------- #

# Table I and II: S.No | codes | description | BCD | IGST | condition.
# Table III adds a compensation-cess column; Table IV is a valuation rule and
# carries no rates at all.
BCD_COLUMNS = {"I": 6, "II": 6, "III": 7, "IV": 3}

TABLE_HEADING = re.compile(r"^TABLE\s+(I|II|III|IV)$", re.I)
ANNEXURE_HEADING = re.compile(r"^ANNEXURE\s+TO\s+TABLE\s+(I|II|III|IV)$", re.I)
LIST_HEADING = re.compile(r"^List\s+\d+\s*[(\[]", re.I)


def sections(page) -> list[tuple[float, str, str | None]]:
    """(y, kind, table) for the "TABLE II" / "ANNEXURE TO TABLE II" / "List 3"
    headings on a page.

    Positions matter, not just presence: conditions 85 to 87 of the annexure to
    Table I sit above "List 1 (See S. No. 69 of TABLE I)" on the same page, and
    the last rows of Table I sit above "ANNEXURE to TABLE I" on another. Read
    by page alone, both sets are lost.
    """
    found = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = prose("".join(span["text"] for span in line["spans"]))
            annexure = ANNEXURE_HEADING.match(text)
            table = TABLE_HEADING.match(text)
            if annexure:
                found.append((line["bbox"][1], "annexure", annexure.group(1).upper()))
            elif table:
                found.append((line["bbox"][1], "table", table.group(1).upper()))
            elif LIST_HEADING.match(text):
                found.append((line["bbox"][1], "list", None))
    return sorted(found)


def rate_value(text: str) -> float | None:
    """The numeric rate in a rate cell, when the cell states exactly one.

    Cells are "Nil", "5%", "-" (no concession — the tariff/schedule rate
    stands), or several rates stacked for the sub-items of one S.No.
    ("15% 35% 70% 70%"). Only the unambiguous ones become a number; the cell
    text is kept either way, so a stacked entry reads as what it is instead of
    being flattened to a rate that is right for one sub-item and wrong for the
    other three.
    """
    tokens = [t for t in text.split(" ") if t]
    if not tokens or set(tokens) == {"-"}:
        return None
    values = {t.rstrip("%").lower() for t in tokens}
    if len(values) != 1:
        return None
    only = values.pop()
    if only == "nil":
        return 0.0
    try:
        return float(only) if tokens[0].endswith("%") else None
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# Amendments
# --------------------------------------------------------------------------- #
#
# A notification is not a document, it is a document plus everything issued
# against it since. 45/2025 has been amended six times, and reading the base
# PDF alone gets a third of the entries wrong: 02/2026 alone extends 93 sunset
# provisos from 31.03.2026 to 31.03.2028 and omits 85 serials outright. Without
# it, S.No. 160 — wood pulp — reads as expired since March, and a live Nil-BCD
# concession worth 5% ad valorem gets denied.
#
# Two things make applying them safely possible. Instructions are numbered
# 1..n, so none can be silently skipped; and each cites the serial it acts on,
# so it can be applied to exactly one entry and asserted first.

# In the order they were issued. Order matters: 15/2026 substitutes a rate that
# 02/2026 may already have moved.
BCD_AMENDMENTS = [
    ("bcd-amendment-corrigendum-2025-10-31.pdf", "Corrigendum", "2025-10-31"),
    ("bcd-amendment-02-2026.pdf", "02/2026-Customs", "2026-02-01"),
    ("bcd-amendment-06-2026.pdf", "06/2026-Customs", "2026-03-12"),
    ("bcd-amendment-15-2026.pdf", "15/2026-Customs", "2026-05-12"),
    ("bcd-amendment-corrigendum-2026-06-12.pdf", "Corrigendum", "2026-06-12"),
    ("bcd-amendment-25-2026.pdf", "25/2026-Customs", "2026-07-08"),
]

# The start of a numbered instruction: "(77) against S. No. 160, ...".
INSTRUCTION_START = re.compile(r"\((\d{1,3})\)\s+(?=against|S\. ?No|in |after|for )")

# What an instruction does. Most specific first: a column (3) proviso edit is
# also a column (3) edit, and only the first reading is the right one.
INSTRUCTION_FORMS = [
    # Applied automatically — see apply_bcd_amendments.
    (
        "sunset",
        r"against S\. ?No\. (?P<serial>\d+[A-Z]?), in column \(3\), in the proviso, for the figures, letters "
        r"and word\s*[“\"‘'](?P<old>[^”\"’']+)[”\"’'], the figures, letters and word"
        r"\s*[“\"‘'](?P<new>[^”\"’']+)[”\"’']",
    ),
    ("omit", r"S\. ?No\. (?P<serial>\d+[A-Z]?) and the entries relating thereto shall be omitted"),
    (
        "rate",
        r"against S\. ?No\. (?P<serial>\d+[A-Z]?), in column \(4\), for the entry\s*[“\"‘']"
        r"(?P<old>[^”\"’']+)[”\"’'](?P<both>, at both the places)?, the entry\s*"
        r"[“\"‘'](?P<new>[^”\"’']+)[”\"’']",
    ),
    # Recorded, not applied — each needs a person to read the new text.
    ("insert", r"after S\. ?No\. (?P<serial>\d+[A-Z]?) and the entries relating thereto, the following"),
    ("replace", r"for S\. ?No\. (?P<serial>\d+[A-Z]?) and the entries relating thereto, the following"),
    ("column3", r"against S\. ?No\. (?P<serial>\d+[A-Z]?), in column \(3\),(?! in the proviso)"),
    ("condition", r"against S\. ?No\. (?P<serial>\d+[A-Z]?), in column \((?:5|6|7)\)"),
    ("list", r"in the LISTS appended to TABLE\s*(?P<table>\w+), in List (?P<list>\d+)"),
    # A corrigendum edits the printed page, not a serial, so it cannot be
    # located in our model at all. It is reported and nothing more.
    ("page", r"at page (?P<page>\d+),?\s*-?\s*in lines? (?P<lines>[\d and,]+)"),
]

# The forms we act on. Everything else is recorded against the serial and marks
# it stale, because the entry we hold is no longer what the notification says.
APPLIED_FORMS = {"sunset", "omit", "rate"}


def classify_instruction(text: str) -> dict | None:
    for kind, pattern in INSTRUCTION_FORMS:
        m = re.search(pattern, text, re.I)
        if m:
            return {"kind": kind, **{k: v for k, v in m.groupdict().items() if v}}
    return None


def read_amendment(filename: str, notification: str, date: str) -> list[dict]:
    """The instructions one amending notification carries, in document order.

    Instructions are numbered, and the numbering is the safety net: if the
    count of markers and the count we classify disagree, one has been read as
    part of its neighbour and the build stops rather than applying a partial
    amendment.
    """
    text = re.sub(r"\s+", " ", "".join(page.get_text() for page in fitz.open(SOURCE / filename)))
    markers = list(INSTRUCTION_START.finditer(text))

    if markers:
        serials = [int(m.group(1)) for m in markers]
        if serials != list(range(1, len(serials) + 1)):
            raise SystemExit(f"{notification}: instructions are numbered {serials[:5]}…, expected 1..n")
        bounds = [m.start() for m in markers] + [len(text)]
        segments = [text[bounds[i] : bounds[i + 1]] for i in range(len(markers))]
    else:
        # A corrigendum, or an amendment carrying a single unnumbered edit.
        segments = [text[text.find("G.S.R") :]]

    instructions = []
    for position, segment in enumerate(segments, start=1):
        for clause in split_clauses(segment):
            found = classify_instruction(clause)
            if not found:
                raise SystemExit(
                    f"{notification}: instruction {position} matches no known form — "
                    f"{clause[:160]!r}. Add a form or the amendment cannot be trusted."
                )
            instructions.append({"notification": notification, "date": date, "position": position, **found})
    return instructions


# "against S. No. 140,- (a) in column (3) …; (b) in column (6) …" — one
# instruction doing several things to one serial.
COMPOUND = re.compile(r"S\. ?No\. (?P<serial>\d+[A-Z]?),\s*-\s*(?=\(a\))")
CLAUSE = re.compile(r"\((?:[a-z])\)\s+")


def split_clauses(instruction: str) -> list[str]:
    """One instruction, one action — unless it lettered them, then one each.

    Instruction 62 of 02/2026 moves S.No. 140's sunset *and* rewrites its
    conditions. Classifying the instruction as a whole would see only the
    first, apply it, and silently drop the second — which is the failure this
    whole pass exists to prevent. Each clause is restated with its serial so it
    reads like a standalone instruction.
    """
    head = COMPOUND.search(instruction)
    if not head:
        return [instruction]
    serial = head.group("serial")
    parts = CLAUSE.split(instruction[head.end() :])
    return [f"against S. No. {serial}, {part.strip()}" for part in parts if part.strip()]


def apply_bcd_amendments(entries: list[dict]) -> list[dict]:
    """Apply what can be applied; mark the rest stale on the entry it touches.

    Only three forms are applied, and each asserts before it writes: the serial
    must exist, and the text being replaced must actually be there. An
    amendment that does not match what we hold means our parse of the base
    notification is wrong, which is worth stopping for.

    Everything else — an inserted serial, a substituted row, a new description,
    an amended List, a corrigendum against a printed page — is recorded. The
    entry it names is marked stale, and callers must not apply its rate.
    """
    by_serial = {(e["table"], e["serial"]): e for e in entries}
    unapplied: list[dict] = []

    for filename, notification, date in BCD_AMENDMENTS:
        for instruction in read_amendment(filename, notification, date):
            kind = instruction["kind"]
            serial = instruction.get("serial")
            # Every amendment to 45/2025 so far edits TABLE I. When one edits
            # another table this will stop finding its serial and say so.
            entry = by_serial.get(("I", serial)) if serial else None

            if kind in APPLIED_FORMS and entry is None:
                raise SystemExit(
                    f"{notification} instruction {instruction['position']} amends "
                    f"S.No. {serial}, which is not in Table I of the base notification"
                )

            if kind == "sunset":
                old, new = instruction["old"], instruction["new"]
                if old not in entry["description"]:
                    raise SystemExit(
                        f"{notification} replaces {old!r} in S.No. {serial}, which does not contain it"
                    )
                entry["description"] = entry["description"].replace(old, new)
                entry.setdefault("amendedBy", []).append(f"{notification} ({kind})")
            elif kind == "omit":
                entry["omitted"] = {"notification": notification, "date": date}
            elif kind == "rate":
                old, new = instruction["old"], instruction["new"]
                if old not in entry["bcdRateText"]:
                    raise SystemExit(
                        f"{notification} replaces rate {old!r} on S.No. {serial}, "
                        f"which reads {entry['bcdRateText']!r}"
                    )
                count = -1 if instruction.get("both") else 1
                entry["bcdRateText"] = entry["bcdRateText"].replace(old, new, count)
                entry.setdefault("amendedBy", []).append(f"{notification} ({kind})")
            else:
                unapplied.append(instruction)
                if entry is not None:
                    entry.setdefault("staleBy", []).append(f"{notification} ({kind})")

    return unapplied


def build_bcd_exemptions() -> tuple[list[dict], list[dict], list[dict]]:
    doc = fitz.open(SOURCE / "bcd-exemption-notification-45-2025.pdf")
    entries: list[dict] = []
    conditions: list[dict] = []
    table_no: str | None = None
    annexure_no: str | None = None

    for number, page in enumerate(doc, start=1):
        headings = sections(page)

        def section_at(top: float) -> None:
            nonlocal table_no, annexure_no
            for y, kind, value in headings:
                if y > top + 2:
                    break
                if kind == "table":
                    table_no, annexure_no = value, None
                elif kind == "annexure":
                    table_no, annexure_no = None, value
                else:  # the appended Lists end the condition annexure
                    annexure_no = None

        for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
            section_at(table.bbox[1])
            rows = logical_rows(table)
            if not rows:
                continue
            width = len(rows[0])

            if table_no and width == BCD_COLUMNS[table_no]:
                for cells in rows:
                    serial, spec, description = cells[0], cells[1], cells[2]
                    rest = cells[3:]
                    if serial.lower().startswith(("s.", "sl")) or serial == "(1)":
                        continue
                    if re.fullmatch(r"\d+\.?", serial):
                        rates = dict(zip(("bcd", "igst", "compCess", "condition"), rest)) if table_no == "III" else dict(
                            zip(("bcd", "igst", "condition"), rest)
                        )
                        entries.append(
                            {
                                "table": table_no,
                                "serial": serial.rstrip("."),
                                "description": description,
                                "bcdRateText": rates.get("bcd", ""),
                                "igstRateText": rates.get("igst", ""),
                                "compCessRateText": rates.get("compCess", ""),
                                # "-" in column (6)/(7) means unconditional.
                                "condition": rates.get("condition", "").strip("- ").strip() and rates["condition"],
                                # The same cell before that normalisation, because
                                # in a stacked entry each "-" marks a position.
                                "conditionCell": rates.get("condition", ""),
                                "page": number,
                                **parse_spec(spec),
                            }
                        )
                    elif entries and not serial:
                        if spec:
                            merged = parse_spec(f"{entries[-1]['spec']} {spec}")
                            entries[-1].update(
                                {k: merged[k] for k in ("spec", "include", "exclude", "anyChapter", "unread")}
                            )
                        if description:
                            entries[-1]["description"] = f"{entries[-1]['description']} {description}".strip()
                        for key, value in zip(("bcd", "igst", "compCess", "condition") if table_no == "III" else ("bcd", "igst", "condition"), rest):
                            field = {"bcd": "bcdRateText", "igst": "igstRateText", "compCess": "compCessRateText", "condition": "condition"}[key]
                            if value and not entries[-1][field]:
                                entries[-1][field] = value
                                if key == "condition":
                                    entries[-1]["conditionCell"] = value

            elif annexure_no and width == 2:
                for serial, body in rows:
                    if serial.lower().startswith("condition"):
                        continue
                    # "1." in the annexures to Tables I and II, "(1)" in the
                    # annexure to Table III — the same numbering either way.
                    if re.fullmatch(r"\(?\d+\)?\.?", serial):
                        conditions.append({"table": annexure_no, "no": re.sub(r"\D", "", serial), "text": body})
                    elif conditions and not serial and body:
                        conditions[-1]["text"] = f"{conditions[-1]['text']} {body}".strip()

        section_at(float("inf"))

    for table in sorted({e["table"] for e in entries}):
        check_serials(f"BCD Table {table}", [e["serial"] for e in entries if e["table"] == table])
    for table in sorted({c["table"] for c in conditions}):
        check_serials(f"BCD Annexure to Table {table}", [c["no"] for c in conditions if c["table"] == table])

    # Every condition number a table entry cites must exist in that table's
    # annexure, or the entry points at nothing.
    for entry in entries:
        for cited in cited_conditions(entry["condition"]):
            if not any(c["table"] == entry["table"] and c["no"] == cited for c in conditions):
                raise SystemExit(
                    f"BCD Table {entry['table']} S.No. {entry['serial']} cites condition {cited}, "
                    "which the annexure does not define"
                )
    # Amendments first: a sunset date moved by 02/2026 must be in the
    # description before validity is read off it, and a rate substituted by
    # 15/2026 must be in the cell before the sub-items are split on it.
    unapplied = apply_bcd_amendments(entries)
    omitted = [e for e in entries if e.get("omitted")]
    entries[:] = [e for e in entries if not e.get("omitted")]

    for entry in entries:
        entry["subEntries"] = split_sub_entries(entry)

    for condition in conditions:
        condition["kinds"] = condition_kinds(condition["text"])

    applied = sum(len(e.get("amendedBy", [])) for e in entries)
    stale = [e for e in entries if e.get("staleBy")]
    print(
        f"  45/2025 amendments: {applied} applied, {len(omitted)} serials omitted, "
        f"{len(unapplied)} instructions left for a human ({len(stale)} entries marked stale)"
    )

    return entries, conditions, unapplied


# A condition is prose, but it is prose about a small number of things. These
# are the obligations it can impose, in the order a reviewer cares about.
#
# Measured over the 125 conditions of 45/2025 and the 286 conditional entries
# that cite them: `igcr` alone reaches 120 entries (42%), `certificate` 70
# (25%), `importer-type` 55 (19%) — three kinds covering 80% of everything
# conditional. The rest is a long tail, most of it cited by a single entry, and
# `other` is the honest answer there rather than a worse rule.
CONDITION_KINDS = [
    # The exact sentence of Table I condition 3 and Table II condition 1. It is
    # boilerplate, repeated verbatim, so this matches on text and not on luck.
    ("igcr", r"Import of Goods at Concessional Rate of Duty"),
    ("bond", r"execution of (?:a )?bond|bond, in such form|binds himself"),
    ("bank-guarantee", r"bank guarantee|fixed deposit receipt"),
    ("certificate", r"furnishes? (?:in all cases )?a certificate|produces? (?:a )?certificate|certificate (?:is )?(?:issued|from|to the effect)|certified by"),
    ("registration", r"registered with|is an establishment registered|registration certificate"),
    ("export-obligation", r"are exported by the importer within|export obligation|re-export"),
    ("end-use-declaration", r"gives? (?:a )?(?:declaration|an undertaking)|declares? that|undertaking to (?:the effect|pay)"),
    ("importer-type", r"imported into India by the Ministry|by the Defence|imported by a|imported by the Government|by a sports person|by an? (?:exporter|operator|hospital|institution)"),
    ("quantity-value-cap", r"shall not exceed|quantity of import does not exceed"),
    ("contract-registration", r"contracts? registered"),
    ("time-limit", r"within (?:six|three|nine|twelve|one|two)\s+(?:months?|years?)|within \d+ (?:days|months|years)"),
    ("payment-mode", r"convertible foreign currency"),
    ("direct-shipment", r"directly shipped from the country"),
]


# "Provided that nothing contained in this S.No. shall have effect after the
# 31st March, 2028" — the date a concession stops being available.
SUNSET = re.compile(
    r"shall have effect after the (\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+),?\s+(\d{4})", re.I
)
MONTHS = {
    m: i + 1
    for i, m in enumerate(
        "january february march april may june july august september october november december".split()
    )
}


def sunset_date(description: str) -> str | None:
    """The ISO date a concession lapses, where the entry states one.

    Kept as its own field because it is a fact about the entry, not a sentence
    in it: 213 of the 539 published entries carry a proviso like this, and
    whether it has passed depends on the date the Bill of Entry is filed. Left
    inside the description it cannot be compared to anything.
    """
    m = SUNSET.search(description)
    if not m:
        return None
    month = MONTHS.get(m.group(2).lower())
    if not month:
        return None
    return f"{m.group(3)}-{month:02d}-{int(m.group(1)):02d}"


# A rate as column (4) writes it: "Nil", "Free", "7.5%", "2.5%".
RATE_TOKEN = re.compile(r"Nil|Free|\d+(?:\.\d+)?%", re.I)

# One position in a stacked condition cell: either a condition group — "3", or
# "3 and 19" — or a bare "-", which is column (6)'s way of saying that this
# sub-item alone carries no condition. S.No. 260 reads "- - - - - 3": five
# unconditional looms and one conditional line of parts. Dropping the dashes
# would lose which sub-item the 3 belongs to.
CONDITION_SLOT = re.compile(r"\d+(?:\s+and\s+\d+)*|-")

# "(i) newsprint; (ii) paper and paperboard; ..." — the enumerated end uses a
# single serial can carry, each with its own rate and its own conditions.
SUB_ITEM = re.compile(r"\((i|ii|iii|iv|v|vi|vii|viii|ix|x)\)\s*", re.I)


def split_sub_entries(entry: dict) -> list[dict] | None:
    """One serial, several end uses, a different rate and condition for each.

    S.No. 160 of 45/2025 is the shape: wood pulp is Nil for newsprint, Nil for
    paper and paperboard, Nil for adult diapers and 2.5% for everything else of
    heading 9619 — four rates and four condition groups stacked into one row,
    which flatten to `bcdRateText: "Nil Nil Nil 2.5%"` and
    `condition: "3 and 19 3 3 3"`. Read as a single entry it has no rate at
    all, so the concession cannot be claimed.

    Returns None whenever the three counts do not reconcile. That is not a
    failure to handle later — it is the answer: 9 of the 23 stacked entries in
    this notification do not line up (S.No. 130 has five rates against ten
    enumerated items), and inventing a correspondence there would put a wrong
    duty rate on a Bill of Entry. Those keep the null rate they have today and
    go to a human, which is what happens now anyway.
    """
    rates = RATE_TOKEN.findall(entry["bcdRateText"] or "")
    if len(rates) < 2:
        return None

    # The proviso is about the serial as a whole, not about its last sub-item.
    described = re.split(r"\bProvided that\b", entry["description"])[0]
    parts = SUB_ITEM.split(described)
    if len(parts) < 3:
        return None
    labels = [parts[i].lower() for i in range(1, len(parts), 2)]
    texts = [parts[i].strip(" ;.-") for i in range(2, len(parts), 2)]

    # The raw cell, not entry["condition"], which has already had a lone "-"
    # normalised away — here the dashes are positional and must be kept.
    slots = CONDITION_SLOT.findall(entry["conditionCell"] or "")
    if slots and len(slots) != len(rates):
        return None
    if len(labels) != len(rates):
        return None

    return [
        {
            "label": label,
            "text": text,
            "bcdRate": rate_value(rate),
            "bcdRateText": rate,
            "conditions": cited_conditions(slots[i]) if slots else [],
        }
        for i, (label, text, rate) in enumerate(zip(labels, texts, rates))
    ]


def cited_conditions(cell: str | None) -> list[str]:
    """The condition numbers a column (6)/(7) cell cites, in first-seen order.

    The cell is not a number but a little language: "3", "2 and 3", and — where
    one serial stacks several sub-items — "3 and 19 3 3 3". Order is preserved
    and repeats dropped, so that last cell yields ["3", "19"].
    """
    return list(dict.fromkeys(re.findall(r"\d+", cell or "")))


def condition_kinds(text: str) -> list[str]:
    """What a condition actually demands, so something downstream can act on it.

    A condition can demand several things at once — a certificate *and* a time
    limit — so this returns every kind that matches, most consequential first.
    Nothing matching is `other`: real, and the reviewer reads the prose.
    """
    kinds = [kind for kind, pattern in CONDITION_KINDS if re.search(pattern, text, re.I)]
    return kinds or ["other"]



# --------------------------------------------------------------------------- #
# Emit
# --------------------------------------------------------------------------- #

BANNER = """// GENERATED FILE — do not edit by hand.
// Source: packages/core/masters-source/{source}
// Regenerate: python3 packages/core/scripts/build-masters.py
"""


def ts(value) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return json.dumps(value, ensure_ascii=False)


def write(path: Path, body: str) -> None:
    path.write_text(body)
    print(f"  wrote {path.relative_to(ROOT.parent.parent)}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    ports = build_foreign_ports()
    lines = [
        BANNER.format(source="port-name-and-code.pdf"),
        "import type { ForeignPortMaster } from '../data.js';",
        "",
        f"/** {len(ports)} sea ports and airports, keyed by UN/LOCODE. */",
        "export const GENERATED_FOREIGN_PORTS: ForeignPortMaster[] = [",
    ]
    for p in ports:
        fields = [
            f"name: {ts(p['name'])}",
            f"unlocode: {ts(p['unlocode'])}",
            f"country: {ts(p['country'])}",
            f"countryCode: {ts(p['countryCode'])}",
        ]
        if p["aliases"]:
            fields.append(f"aliases: {ts(p['aliases'])}")
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")
    write(OUT / "foreign-ports.ts", "\n".join(lines) + "\n")

    houses = build_custom_houses()
    unclassified = [h["name"] for h in houses if h["mode"] is None]
    lines = [
        BANNER.format(source="custom-house-list.csv"),
        "import type { CustomHouseMaster } from '../data.js';",
        "",
        f"/** {len(houses)} ICEGATE custom houses, keyed by UN/LOCODE-style site code. */",
        "export const GENERATED_CUSTOM_HOUSES: CustomHouseMaster[] = [",
    ]
    for h in houses:
        fields = [
            f"code: {ts(h['code'])}",
            f"ediCode: {ts(h['ediCode'])}",
            f"name: {ts(h['name'])}",
        ]
        if h["mode"]:
            fields.append(f"mode: {ts(h['mode'])}")
        if h["email"]:
            fields.append(f"email: {ts(h['email'])}")
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")
    write(OUT / "custom-houses.ts", "\n".join(lines) + "\n")

    airlines = build_airlines()
    lines = [
        BANNER.format(source="major-airline-code-list.pdf"),
        "import type { AirlineMaster } from '../data.js';",
        "",
        f"/** {len(airlines)} airlines, keyed by the 3-digit IATA air waybill prefix. */",
        "export const GENERATED_AIRLINES: AirlineMaster[] = [",
    ]
    for a in airlines:
        fields = [f"awbPrefix: {ts(a['awbPrefix'])}", f"iata: {ts(a['iata'])}"]
        if a["icao"]:
            fields.append(f"icao: {ts(a['icao'])}")
        fields += [f"name: {ts(a['name'])}", f"country: {ts(a['country'])}"]
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")
    write(OUT / "airlines.ts", "\n".join(lines) + "\n")

    igst = build_igst_schedule()
    lines = [
        BANNER.format(source="igst-rate-notification-09-2025.pdf"),
        "import type { IgstScheduleEntry } from '../data.js';",
        "",
        f"/** {len(igst)} entries of notification 9/2025-Integrated Tax (Rate), 17 September 2025. */",
        "export const GENERATED_IGST_SCHEDULE: IgstScheduleEntry[] = [",
    ]
    for e in igst:
        fields = [
            f"schedule: {ts(e['schedule'])}",
            f"rate: {ts(e['rate'])}",
            f"serial: {ts(e['serial'])}",
            f"include: {ts(e['include'])}",
        ]
        if e["exclude"]:
            fields.append(f"exclude: {ts(e['exclude'])}")
        if e["anyChapter"]:
            fields.append("anyChapter: true")
        fields += [
            f"description: {ts(e['description'])}",
            f"spec: {ts(e['spec'])}",
            f"page: {ts(e['page'])}",
        ]
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")
    write(OUT / "igst-schedule.ts", "\n".join(lines) + "\n")

    cess = build_comp_cess_schedule()
    lines = [
        BANNER.format(source="comp-cess-rate-notification-01-2017.pdf"),
        "import type { CompCessEntry } from '../data.js';",
        "",
        f"/** {len(cess)} entries of notification 1/2017-Compensation Cess (Rate), 28 June 2017. */",
        "export const GENERATED_COMP_CESS_SCHEDULE: CompCessEntry[] = [",
    ]
    for e in cess:
        fields = [f"serial: {ts(e['serial'])}", f"include: {ts(e['include'])}"]
        if e["exclude"]:
            fields.append(f"exclude: {ts(e['exclude'])}")
        if e["anyChapter"]:
            fields.append("anyChapter: true")
        fields += [
            f"description: {ts(e['description'])}",
            # Both, for the same reason 45/2025 keeps both: the number is what
            # callers compute with, the text is what a reviewer checks against
            # the notification. A specific or compound cess has no number.
            f"rate: {ts(rate_value(e['rateText']))}",
            f"rateText: {ts(e['rateText'])}",
        ]
        if e["brandSensitive"]:
            fields.append("brandSensitive: true")
        fields += [f"spec: {ts(e['spec'])}", f"page: {ts(e['page'])}"]
        lines.append("  { " + ", ".join(fields) + " },")
    lines += [
        "];",
        "",
        f"/** The {len(COMP_CESS_UNAPPLIED_AMENDMENTS)} notifications amending 1/2017 that this master does not carry. */",
        "export const GENERATED_COMP_CESS_UNAPPLIED: string[] = ["
        + ", ".join(ts(a) for a in COMP_CESS_UNAPPLIED_AMENDMENTS)
        + "];",
    ]
    write(OUT / "comp-cess-schedule.ts", "\n".join(lines) + "\n")

    exemptions, conditions, unapplied_instructions = build_bcd_exemptions()
    lines = [
        BANNER.format(source="bcd-exemption-notification-45-2025.pdf"),
        "import type { BcdAmendmentInstruction, BcdConditionMaster, BcdExemptionEntry } from '../data.js';",
        "",
        f"/** {len(exemptions)} entries of notification 45/2025-Customs, 24 October 2025. */",
        "export const GENERATED_BCD_EXEMPTIONS: BcdExemptionEntry[] = [",
    ]
    for e in exemptions:
        fields = [
            f"table: {ts(e['table'])}",
            f"serial: {ts(e['serial'])}",
            f"include: {ts(e['include'])}",
        ]
        if e["exclude"]:
            fields.append(f"exclude: {ts(e['exclude'])}")
        if e["anyChapter"]:
            fields.append("anyChapter: true")
        fields.append(f"description: {ts(e['description'])}")
        fields.append(f"bcdRate: {ts(rate_value(e['bcdRateText']))}")
        fields.append(f"bcdRateText: {ts(e['bcdRateText'])}")
        fields.append(f"igstRate: {ts(rate_value(e['igstRateText']))}")
        fields.append(f"igstRateText: {ts(e['igstRateText'])}")
        if e["compCessRateText"]:
            fields.append(f"compCessRateText: {ts(e['compCessRateText'])}")
        # Both: the verbatim cell, because a reviewer checks the flattening
        # against the notification, and the numbers, because callers need a
        # handle to look a condition up by rather than a string to re-parse.
        cited = cited_conditions(e["condition"])
        fields += [
            f"condition: {ts(e['condition'] or None)}",
            "conditions: [" + ", ".join(ts(n) for n in cited) + "]",
        ]
        if sunset_date(e["description"]):
            fields.append(f"validUntil: {ts(sunset_date(e['description']))}")
        if e.get("amendedBy"):
            fields.append("amendedBy: [" + ", ".join(ts(a) for a in e["amendedBy"]) + "]")
        if e.get("staleBy"):
            fields.append("staleBy: [" + ", ".join(ts(a) for a in e["staleBy"]) + "]")
        if e["subEntries"]:
            subs = ", ".join(
                "{ "
                + ", ".join(
                    [
                        f"label: {ts(sub['label'])}",
                        f"text: {ts(sub['text'])}",
                        f"bcdRate: {ts(sub['bcdRate'])}",
                        f"bcdRateText: {ts(sub['bcdRateText'])}",
                        "conditions: [" + ", ".join(ts(n) for n in sub["conditions"]) + "]",
                    ]
                )
                + " }"
                for sub in e["subEntries"]
            )
            fields.append(f"subEntries: [{subs}]")
        fields += [
            f"spec: {ts(e['spec'])}",
            f"page: {ts(e['page'])}",
        ]
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")
    lines += [
        "",
        f"/** The {len(conditions)} conditions in the annexures, cited by column (6)/(7) of the tables. */",
        "export const GENERATED_BCD_CONDITIONS: BcdConditionMaster[] = [",
    ]
    for c in conditions:
        kinds = "[" + ", ".join(ts(k) for k in c["kinds"]) + "]"
        lines.append(
            "  { "
            + ", ".join(
                [f"table: {ts(c['table'])}", f"no: {ts(c['no'])}", f"kinds: {kinds}", f"text: {ts(c['text'])}"]
            )
            + " },"
        )
    lines.append("];")
    lines += [
        "",
        "/**",
        f" * The {len(unapplied_instructions)} amendment instructions that could not be applied",
        " * mechanically — an inserted serial, a substituted row, a new description, an",
        " * amended List, a corrigendum against a printed page. Each is recorded so the",
        " * gap between what CBIC has notified and what these masters hold is visible",
        " * rather than assumed away.",
        " */",
        "export const GENERATED_BCD_UNAPPLIED: BcdAmendmentInstruction[] = [",
    ]
    for i in unapplied_instructions:
        fields = [f"notification: {ts(i['notification'])}", f"date: {ts(i['date'])}", f"kind: {ts(i['kind'])}"]
        if i.get("serial"):
            fields.append(f"serial: {ts(i['serial'])}")
        lines.append("  { " + ", ".join(fields) + " },")
    lines.append("];")
    write(OUT / "bcd-exemptions.ts", "\n".join(lines) + "\n")

    alpha3 = build_country_alpha3()
    lines = [
        BANNER.format(source="country-code-list.pdf"),
        f"/** ISO 3166-1 alpha-3 -> alpha-2, for the {len(alpha3)} countries in the source list. */",
        "export const COUNTRY_ALPHA3: Record<string, string> = {",
    ]
    for three, two in alpha3.items():
        lines.append(f"  {three}: '{two}',")
    lines.append("};")
    write(OUT / "country-alpha3.ts", "\n".join(lines) + "\n")

    print(
        f"\n  {len(ports)} foreign ports, {len(houses)} custom houses, "
        f"{len(airlines)} airlines, {len(alpha3)} alpha-3 codes"
    )
    print(
        f"  {len(igst)} IGST schedule entries, {len(exemptions)} BCD exemption entries, "
        f"{len(conditions)} exemption conditions"
    )
    unread = [e for e in igst + exemptions if e["unread"]]
    if unread:
        print(f"  {len(unread)} tariff-code specs not fully read:")
        for e in unread[:12]:
            print(f"    - {e.get('schedule') or 'Table ' + e['table']} S.No. {e['serial']}: {e['unread']}")
    if unclassified:
        print(f"  {len(unclassified)} custom houses with no mode read off the name:")
        for name in unclassified[:12]:
            print(f"    - {name}")
        if len(unclassified) > 12:
            print(f"    ... and {len(unclassified) - 12} more")


if __name__ == "__main__":
    main()
