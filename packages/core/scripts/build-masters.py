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

Two of the four PDFs are set in a font whose "ti", "tt" and "ff" ligatures are
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
# Emit
# --------------------------------------------------------------------------- #

BANNER = """// GENERATED FILE — do not edit by hand.
// Source: packages/core/masters-source/{source}
// Regenerate: python3 packages/core/scripts/build-masters.py
"""


def ts(value) -> str:
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
    if unclassified:
        print(f"  {len(unclassified)} custom houses with no mode read off the name:")
        for name in unclassified[:12]:
            print(f"    - {name}")
        if len(unclassified) > 12:
            print(f"    ... and {len(unclassified) - 12} more")


if __name__ == "__main__":
    main()
