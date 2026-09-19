#!/usr/bin/env python3
"""
Builds the Section 14(2) tariff-value master from the CBIC notification corpus.

    pip install pymupdf pdfplumber
    python3 packages/core/scripts/build-tariff-values.py

Writes src/masters/generated/items/tariff-values.json and a build report beside
it. Companion to build-masters.py and build-tariff-book.py, and it keeps their
contract: the generated files are committed, every row names the page it came
from, and the build refuses rather than defaults.

## What a tariff value is

Under section 14(2) of the Customs Act the Board may fix a *tariff value* for
goods; duty is then assessed on that value, not on the invoice. The principal
notification is 36/2001-Customs (N.T.) dated 3 August 2001 (S.O. 748(E)). Its
tables are not amended row by row: roughly every fortnight (and mid-fortnight
when gold or silver moves) CBIC issues "Fixation of Tariff Value of Edible Oils,
Brass Scrap, Areca Nut, Gold and Silver" and *substitutes* TABLE-1, TABLE-2 and
TABLE-3 wholesale. So each notification is a complete edition, in force from the
date in its paragraph 2 until the next edition's effective date.

In every edition in scope:

    TABLE-1  edible oils and brass scrap   US $ per metric tonne (column header)
    TABLE-2  gold and silver               US $, unit printed in the cell
                                           ("per 10 grams", "per kilogram")
    TABLE-3  areca nuts                    US $ per metric ton (column header)

The Logi-Sys ITEMS columns map as: Tariff_Value_Notn = 036/2001 (the principal
notification, always), Tariff_Value_NotnSrNo = `serial` of the row in its
table, Tarrif_Value_Amount = `amount`, Tarrif_Value_Currency = `currency`, and
Tarrif_Value_Qty is the declared quantity expressed in the row's unit: `uqc`
times `per`. A gold bar of 1 kg against "1468 per 10 grams" is 1000 GMS / 10 =
100 units of tariff value. `unitText` keeps the words exactly as printed so the
unit is never a guess.

## Why the source is read the way it is

The notifications are ruled Word tables, so pdfplumber's table extraction gives
cell boundaries — which matters because TABLE-2 descriptions run across a page
break, and in the reading-order text stream a row's value can precede the tail
of its own description. A table fragment whose first cell is empty is the
continuation of the previous row.

Three sources do not fit that path, and each is handled explicitly:

* 80/2024-Customs (N.T.): CBIC published the Hindi text under the English file
  name. Serials, CTH and amounts are ASCII digits and are parsed from the Hindi
  table; the units are matched against a closed set of Hindi phrases. The Hindi
  descriptions are not usable text (the font maps conjuncts to private glyphs),
  so each row's English description is carried from the preceding edition,
  only where table, serial and CTH all match, and the edition says so.

* 01/2026-Customs (N.T.): an image-only "Microsoft Print to PDF" scan, no text
  layer, and no OCR engine is installed. TRANSCRIPTIONS below holds the values
  as read from the rendered page at 300 dpi, pinned to the file's SHA-256 so a
  replaced file fails the build. Every row the notification itself marks
  "(i.e., no change)" is asserted equal to the previous edition; only the two
  changed gold/silver figures rest on the reading alone, and the report says so.
  Descriptions are carried as for 80/2024.

* 12/2024-Customs: the same PDF (identical bytes) as 12/2024-Customs (N.T.),
  filed by CBIC under the Tariff category. Only the Non Tariff record is read.

## Checks

* The operative clause must substitute all three tables; a partial amendment
  aborts the edition rather than being read as a full table set.
* Every "(i.e., no change)" marker is compared with the previous edition. CBIC
  has left stale markers on changed figures (49/2026 gold, 72/2026 silver S.No.
  2): the printed figure is kept and the contradiction goes on the edition's
  notes and in the report. For a transcribed edition a mismatch aborts, since
  there the marker is the only guard against a misreading.
* Every edition's "last amended vide Notification No. X" note must name the
  edition before it, which proves no edition is missing from the chain.
* Units must match a known phrase; an unknown one aborts the edition.
* Notification number and date are taken from the PDF, not the index — the
  index misnumbers 23/2026 and 25/2026 as "/2025".
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    import fitz  # PyMuPDF
    import pdfplumber
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF and pdfplumber are required: pip install pymupdf pdfplumber")

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
CORPUS = REPO / "data" / "customs-corpus"
INDEX = CORPUS / "index" / "cbic-notifications.json"
NOTIFICATIONS = CORPUS / "notifications"
OUT = ROOT / "src" / "masters" / "generated" / "items"

# The first date the master must cover. The edition in force on this date is
# included too, even though it was issued earlier.
COVER_FROM = date(2024, 1, 1)

BASE = {
    "notification": "036/2001",
    "title": "36/2001-Customs (N.T.)",
    "date": "2001-08-03",
    "gazette": "S.O. 748(E), dated 3rd August, 2001",
    "section": "Section 14(2), Customs Act, 1962",
}

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}
HINDI_MONTHS = {
    "जनवरी": 1, "फरवरी": 2, "माच": 3, "अ(cid:377)ैल": 4, "मई": 5, "जून": 6,
    "जुलाई": 7, "अग(cid:721)": 8, "िसतंबर": 9, "अ(cid:385)ूबर": 10, "नवंबर": 11, "िदसंबर": 12,
}

# Values read by eye from image-only PDFs, pinned by digest. See the docstring.
TRANSCRIPTIONS: dict[str, dict] = {
    "Non_Tariff__01_2026-Customs__N.T___1010549.pdf": {
        "sha256": "a49d5b000198bdf0de1a320f81124cd93ea0a725e408157db3d80dbef0da5e44",
        "number": 1, "year": 2026,
        "notificationDate": "2026-01-13",
        "effectiveFrom": "2026-01-14",
        "lastAmendedVide": (80, 2025),
        "tables": {
            "1": {"header": "Tariff value (US $Per Metric Tonne)", "rows": [
                (1, "1511 10 00", "1077 (i.e., no change)"),
                (2, "1511 90 10", "1095 (i.e., no change)"),
                (3, "1511 90 90", "1087 (i.e., no change)"),
                (4, "1511 10 00", "1100 (i.e., no change)"),
                (5, "1511 90 20", "1103 (i.e., no change)"),
                (6, "1511 90 90", "1102 (i.e., no change)"),
                (7, "1507 10 00", "1162 (i.e., no change)"),
                (8, "7404 00 22", "6694 (i.e., no change)"),
            ]},
            "2": {"header": "Tariff value (US $)", "rows": [
                (1, "71 or 98", "1485 per 10 grams"),
                (2, "71 or 98", "2724 per kilogram"),
                (3, "71", "2724 per kilogram"),
                (4, "71", "1485 per 10 grams"),
            ]},
            "3": {"header": "Tariff value (US $ Per Metric Ton)", "rows": [
                (1, "080280", "7679 (i.e., no change)"),
            ]},
        },
        # Page each table's rows are printed on (1-based).
        "pages": {("1", 1): 1, ("1", 2): 1, ("1", 3): 1, ("1", 4): 1, ("1", 5): 1,
                  ("1", 6): 1, ("1", 7): 1, ("1", 8): 1, ("2", 1): 1, ("2", 2): 1,
                  ("2", 3): 2, ("2", 4): 2, ("3", 1): 2},
    },
}


class EditionError(Exception):
    pass


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def join_lines(cell: str) -> str:
    """Join a wrapped cell: a line ending in '-' continues the word (semi-\\nmanufactured)."""
    out = ""
    for line in (cell or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if out.endswith("-") and not out.endswith(" -"):
            out += line
        elif out:
            out += " " + line
        else:
            out = line
    return squash(out)


# ---------------------------------------------------------------- units

def unit_from_text(text: str, table: str, header: str) -> tuple[str, str, int]:
    """(unitText as printed, uqc, per). TABLE-2 prints the unit in the cell."""
    if table in ("1", "3"):
        m = re.search(r"per\s*metric\s*ton(?:ne)?", header, re.I)
        if m:
            printed = squash(m.group(0))
            return printed, "MTS", 1
        # Hindi header: "(अमरीकी डालर प्रति मीट्रिक टन)"
        if "मीिट" in header and "टन" in header:
            return "per metric tonne", "MTS", 1
        raise EditionError(f"TABLE-{table}: no unit in header {header!r}")
    m = re.search(r"per\s*(\d+)\s*grams?", text, re.I)
    if m:
        return squash(m.group(0)), "GMS", int(m.group(1))
    m = re.search(r"per\s*kilograms?", text, re.I)
    if m:
        return squash(m.group(0)), "KGS", 1
    m = re.search(r"(\d+)\s*\(cid:356\)ाम", text)  # Hindi "प्रति 10 ग्राम"
    if m:
        return f"per {m.group(1)} grams", "GMS", int(m.group(1))
    if "िकलो(cid:356)ाम" in text:  # Hindi "प्रति किलोग्राम"
        return "per kilogram", "KGS", 1
    raise EditionError(f"TABLE-{table}: unknown unit in {text!r}")


def parse_amount_cell(cell: str) -> tuple[float, bool, str]:
    text = squash(cell).replace("”", "").replace('"', "")
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(.*)$", text)
    if not m:
        raise EditionError(f"unparseable tariff value cell {cell!r}")
    amount = float(m.group(1))
    if amount.is_integer():
        amount = int(amount)
    rest = m.group(2)
    no_change = bool(re.search(r"no\s*change", rest, re.I)) or "प(cid:303)रवत(cid:330)न नही" in rest
    return amount, no_change, rest


def include_from_cth(cth: str) -> list[str]:
    parts = re.split(r"\s+(?:or|या)\s+|,", squash(cth))
    out = []
    for p in parts:
        digits = re.sub(r"\s+", "", p)
        if not re.fullmatch(r"\d{2,8}", digits):
            raise EditionError(f"unparseable CTH {cth!r}")
        out.append(digits)
    return out


# ---------------------------------------------------------------- text fields

ORDINAL = r"(\d{1,2})\s*(?:st|nd|rd|th)?"


def english_date(day: str, month: str, year: str) -> str:
    mo = MONTHS.get(month.lower())
    if not mo:
        raise EditionError(f"unknown month {month!r}")
    return date(int(year), mo, int(day)).isoformat()


def header_fields(text: str) -> dict:
    t = squash(text)
    if re.search(r"Notification\s*No", t):
        m = re.search(r"Notification\s*No\.?\s*(\d{1,3})\s*/\s*(\d{4})", t)
        d = re.search(r"New\s*Delhi,?\s*(?:the\s*)?" + ORDINAL + r"\s*([A-Za-z]+),?\s*(\d{4})", t)
        e = re.search(r"with\s*effect\s*from\s*the\s*" + ORDINAL + r"\s*day\s*of\s*([A-Za-z]+),?\s*(\d{4})", t)
        la = re.search(r"last\s*amended\s*vide\s*Notification\s*No\.?\s*(\d{1,3})\s*/\s*(\d{4})", t)
        op = re.search(r"for\s*TABLE-1,\s*TABLE-2,?\s*and\s*TABLE-3\s*the\s*following\s*Tables\s*shall\s*be\s*substituted", t)
        if not (m and d and e and la):
            raise EditionError(f"header fields missing: no={bool(m)} date={bool(d)} effective={bool(e)} lastAmended={bool(la)}")
        return {
            "language": "en",
            "number": int(m.group(1)), "year": int(m.group(2)),
            "notificationDate": english_date(*d.groups()),
            "effectiveFrom": english_date(*e.groups()),
            "lastAmendedVide": (int(la.group(1)), int(la.group(2))),
            "substitutesAllTables": bool(op),
        }
    if "अिधसूचना" in t:
        m = re.search(r"अिधसूचना\s*सं\.\s*(\d{1,3})/(\d{4})", t)
        d = re.search(r"िदनांक\s*(\d{1,2})\s*(\S+),\s*(\d{4})", t)
        e = re.search(r"यह\s*अिधसूचना\s*(\d{1,2})\s*(\S+),\s*(\d{4})\s*से\s*Ůभावी", t)
        la = re.search(r"अंितम\s*बार\s*अिधसूचना\s*सं\.\s*(\d{1,3})/(\d{4})", t)
        op = re.search(r"सारणी-1,\s*सारणी-2\s*और\s*सारणी-3\s*के\s*̾थान\s*पर", t)
        if not (m and d and e and la):
            raise EditionError("Hindi header fields missing")

        def hd(day, month, year):
            if month not in HINDI_MONTHS:
                raise EditionError(f"unknown Hindi month {month!r}")
            return date(int(year), HINDI_MONTHS[month], int(day)).isoformat()
        return {
            "language": "hi",
            "number": int(m.group(1)), "year": int(m.group(2)),
            "notificationDate": hd(*d.groups()),
            "effectiveFrom": hd(*e.groups()),
            "lastAmendedVide": (int(la.group(1)), int(la.group(2))),
            "substitutesAllTables": bool(op),
        }
    raise EditionError("no text layer")


# ---------------------------------------------------------------- tables

COLUMN_NUMBERS = re.compile(r"^\(\d\)$")


def is_header(row: list) -> bool:
    first = (row[0] or "").strip()
    return bool(first) and not re.fullmatch(r"\d+\.?", first) and not COLUMN_NUMBERS.match(first)


def read_tables(path: Path) -> list[dict]:
    """
    Ruled tables in page order, with page-break fragments merged.

    A row whose serial cell is empty is a fragment of an entry split by a page
    break, and which entry it belongs to follows from which side of the break it
    sits on:

    * the first row on a page continues the entry before the break
      (95/2023: "30.06.2017 is availed" at the top of page 2 ends S.No. 2);
    * the last row on a page starts the entry after the break
      (11/2026: "(i) Silver, in any form, other than" at the foot of page 1 is
      the head of S.No. 3, whose serial is printed on page 2; in 42/2025 the
      fragment even carries half the value, "1189 per", and page 2 "kilogram").

    A fragment anywhere else is ambiguous and aborts the edition.
    """
    items: list[dict] = []  # {"header": str} or {"cells": [...], "page": n}
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            page_rows = []
            for raw in page.extract_tables():
                for row in raw:
                    if len(row) != 4:
                        raise EditionError(f"page {pno}: table row with {len(row)} cells: {row!r}")
                    cells = [c or "" for c in row]
                    if COLUMN_NUMBERS.match(cells[0].strip()):
                        continue
                    if is_header(cells):
                        page_rows.append({"header": join_lines(cells[3])})
                    else:
                        page_rows.append({"cells": cells, "page": pno})
            for i, it in enumerate(page_rows):
                it["first"] = i == 0
                it["last"] = i == len(page_rows) - 1
            items.extend(page_rows)

    tables: list[dict] = []
    pending: dict | None = None
    for it in items:
        if "header" in it:
            if pending:
                raise EditionError(f"page {pending['page']}: fragment before a table header: {pending['cells']!r}")
            tables.append({"header": it["header"], "rows": []})
            continue
        if not tables:
            raise EditionError(f"page {it['page']}: row before any table header: {it['cells']!r}")
        rows = tables[-1]["rows"]
        cells = it["cells"]
        if not cells[0].strip():
            if pending:
                raise EditionError(f"page {it['page']}: two consecutive fragments")
            if it["first"] and rows and not it["last"]:
                prev = rows[-1]["cells"]
                for i in (1, 2, 3):
                    if cells[i].strip():
                        prev[i] = (prev[i] + "\n" + cells[i]).strip()
            elif it["last"] and not it["first"]:
                pending = it
            else:
                raise EditionError(f"page {it['page']}: fragment not at a page break: {cells!r}")
            continue
        if pending:
            if not it["first"]:
                raise EditionError(f"page {pending['page']}: fragment at page foot not followed by a new page")
            frag = pending["cells"]
            for i in (1, 2, 3):
                cells[i] = (frag[i] + "\n" + cells[i]).strip()
            pending = None
        rows.append({"cells": cells, "page": it["page"]})
    if pending:
        raise EditionError(f"trailing unattached fragment {pending['cells']!r}")
    return tables


def rows_from_tables(tables: list[dict]) -> list[dict]:
    if len(tables) != 3:
        raise EditionError(f"expected 3 tables, found {len(tables)}")
    out = []
    for tno, table in zip(("1", "2", "3"), tables):
        if not table["rows"]:
            raise EditionError(f"TABLE-{tno} is empty")
        for expected, row in enumerate(table["rows"], start=1):
            c = row["cells"]
            serial = int(re.sub(r"\D", "", c[0]))
            if serial != expected:
                raise EditionError(f"TABLE-{tno}: serial {serial} where {expected} expected")
            amount, no_change, rest = parse_amount_cell(c[3])
            unit_text, uqc, per = unit_from_text(rest, tno, table["header"])
            out.append({
                "table": tno, "serial": serial, "cthText": squash(c[1]),
                "include": include_from_cth(c[1]), "description": join_lines(c[2]),
                "amount": amount, "currency": "USD" if "$" in table["header"] or "डालर" in table["header"] else None,
                "unitText": unit_text, "uqc": uqc, "per": per, "page": row["page"],
                "_noChange": no_change,
            })
            if out[-1]["currency"] is None:
                raise EditionError(f"TABLE-{tno}: no currency in header {table['header']!r}")
    return out


def transcribed_rows(t: dict) -> list[dict]:
    out = []
    for tno, table in t["tables"].items():
        for serial, cth, cell in table["rows"]:
            amount, no_change, rest = parse_amount_cell(cell)
            unit_text, uqc, per = unit_from_text(rest, tno, table["header"])
            out.append({
                "table": tno, "serial": serial, "cthText": cth, "include": include_from_cth(cth),
                "description": None, "amount": amount, "currency": "USD",
                "unitText": unit_text, "uqc": uqc, "per": per,
                "page": t["pages"][(tno, serial)], "_noChange": no_change,
            })
    return out


# ---------------------------------------------------------------- build

def label(number: int, year: int) -> str:
    return f"{number:02d}/{year}-Customs (N.T.)"


def candidates() -> list[dict]:
    records = json.loads(INDEX.read_text())
    out = []
    for r in records:
        name = (r.get("notificationName") or "").lower()
        if r.get("notificationCategory") != "Non Tariff" or "tariff value" not in name:
            continue
        # The edition in force on COVER_FROM was issued at most a fortnight or so before it.
        if (r.get("notificationDt") or "")[:10] < (COVER_FROM - timedelta(days=45)).isoformat():
            continue
        files = list(NOTIFICATIONS.glob(f"Non_Tariff__*__{r['id']}.pdf"))
        out.append({"record": r, "file": files[0] if files else None})
    return sorted(out, key=lambda c: (c["record"]["notificationDt"], c["record"]["id"]))


def main() -> None:
    parsed, failed, notes = [], [], []

    for c in candidates():
        rec, path = c["record"], c["file"]
        if path is None:
            failed.append({"indexNo": rec["notificationNo"], "id": rec["id"], "indexDate": rec["notificationDt"][:10], "reason": "PDF not in corpus"})
            continue
        try:
            text = "".join(p.get_text() for p in fitz.open(path))
            extraction = "pdf-table"
            if squash(text):
                head = header_fields(text)
                rows = rows_from_tables(read_tables(path))
                if head["language"] == "hi":
                    extraction = "pdf-table-hindi"
            elif path.name in TRANSCRIPTIONS:
                t = TRANSCRIPTIONS[path.name]
                digest = sha256(path)
                if digest != t["sha256"]:
                    raise EditionError(f"transcribed PDF changed on disk (sha256 {digest} != pinned {t['sha256']})")
                head = {k: t[k] for k in ("number", "year", "notificationDate", "effectiveFrom", "lastAmendedVide")}
                head.update(language="en", substitutesAllTables=True)
                rows = transcribed_rows(t)
                extraction = "transcribed"
            else:
                raise EditionError("image-only PDF with no transcription")
            if not head["substitutesAllTables"]:
                raise EditionError("operative clause does not substitute all three tables")
        except EditionError as exc:
            failed.append({"indexNo": rec["notificationNo"], "id": rec["id"], "indexDate": rec["notificationDt"][:10], "file": path.name, "reason": str(exc)})
            continue
        idx_date = rec["notificationDt"][:10]
        if idx_date != head["notificationDate"]:
            notes.append(f"{label(head['number'], head['year'])}: index date {idx_date}, PDF says {head['notificationDate']}")
        if re.match(r"0*(\d+)/(\d{4})", rec["notificationNo"]).groups() != (str(head["number"]), str(head["year"])):
            notes.append(f"{label(head['number'], head['year'])}: CBIC index calls it {rec['notificationNo']!r} (id {rec['id']})")
        parsed.append({"head": head, "rows": rows, "file": path.name, "id": rec["id"], "extraction": extraction})

    parsed.sort(key=lambda p: (p["head"]["effectiveFrom"], p["head"]["notificationDate"]))

    # Scope: the edition in force on COVER_FROM onwards.
    start = max((i for i, p in enumerate(parsed) if p["head"]["effectiveFrom"] <= COVER_FROM.isoformat()), default=0)
    parsed = parsed[start:]

    # Chain, no-change and description checks; build editions.
    editions, problems, contradictions = [], [], []
    for i, p in enumerate(parsed):
        h, prev = p["head"], (parsed[i - 1] if i else None)
        name = label(h["number"], h["year"])
        edition_notes = []
        if prev:
            want = (prev["head"]["number"], prev["head"]["year"])
            if h["lastAmendedVide"] != want:
                problems.append(f"{name}: says last amended vide {label(*h['lastAmendedVide'])}, but previous parsed edition is {label(*want)}")
            if h["effectiveFrom"] <= prev["head"]["effectiveFrom"]:
                problems.append(f"{name}: effectiveFrom {h['effectiveFrom']} not after previous {prev['head']['effectiveFrom']}")
        prev_rows = {(r["table"], r["serial"]): r for r in (editions[-1]["rows"] if editions else [])}
        for r in p["rows"]:
            key = (r["table"], r["serial"])
            before = prev_rows.get(key)
            if r["_noChange"] and before is not None:
                if before["amount"] != r["amount"] or before["uqc"] != r["uqc"] or before["per"] != r["per"]:
                    msg = (f"TABLE-{r['table']} S.No. {r['serial']} is printed as {r['amount']} {r['unitText']} "
                           f"\"(i.e., no change)\", but the previous edition {editions[-1]['notification']} fixed "
                           f"{before['amount']} {before['unitText']}. The printed figure is kept.")
                    if p["extraction"] == "transcribed":
                        # For a transcription the marker is the only check; a miss means a misreading.
                        problems.append(f"{name}: {msg}")
                    else:
                        # CBIC's own text contradicts itself; the substituted figure is the law.
                        edition_notes.append(msg)
                        contradictions.append(f"{name}: {msg}")
            if p["extraction"] != "pdf-table":
                if before is None or before["include"] != r["include"]:
                    raise SystemExit(f"{name}: cannot carry description for TABLE-{r['table']} S.No. {r['serial']}: no matching previous row")
                if before["uqc"] != r["uqc"] or before["per"] != r["per"]:
                    raise SystemExit(f"{name}: TABLE-{r['table']} S.No. {r['serial']} unit {r['uqc']}/{r['per']} differs from previous {before['uqc']}/{before['per']}")
                r["description"] = before["description"]
                r["cthText"] = before["cthText"]
                if r["table"] in ("1", "3"):
                    r["unitText"] = before["unitText"]
        if p["extraction"] == "pdf-table-hindi":
            edition_notes.append("Source PDF is the Hindi text (CBIC filed it as the English document). Serial, CTH and amount parsed from it; descriptions, CTH text and TABLE-1/3 unitText carried from the previous edition where table, serial, CTH and unit all match.")
        if p["extraction"] == "transcribed":
            edition_notes.append("Source PDF is image-only. Values transcribed by eye from the page rendered at 300 dpi (pinned by SHA-256 in TRANSCRIPTIONS); rows marked '(i.e., no change)' verified against the previous edition. Descriptions carried from the previous edition.")
        editions.append({
            "notification": name,
            "notificationDate": h["notificationDate"],
            "effectiveFrom": h["effectiveFrom"],
            "effectiveUntil": None,
            "source": {"file": p["file"], "cbicId": p["id"], "extraction": p["extraction"]},
            **({"notes": edition_notes} if edition_notes else {}),
            "rows": [{k: v for k, v in r.items() if not k.startswith("_")} for r in p["rows"]],
        })
    for a, b in zip(editions, editions[1:]):
        a["effectiveUntil"] = (date.fromisoformat(b["effectiveFrom"]) - timedelta(days=1)).isoformat()

    if problems:
        print("\n".join("  PROBLEM " + x for x in problems))
        raise SystemExit(f"{len(problems)} consistency problems; nothing written")

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "baseNotification": BASE["notification"],
        "base": BASE,
        "generatedBy": "packages/core/scripts/build-tariff-values.py",
        "uqcNote": "Tariff value applies per `per` units of `uqc`: quantity in tariff-value units = quantity in uqc / per.",
        "editions": editions,
    }
    (OUT / "tariff-values.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    scope_from = editions[0]["notificationDate"]
    in_scope = [f for f in failed if f.get("indexDate", "") >= scope_from]
    write_report(editions, in_scope, notes, contradictions)
    print(f"  wrote {len(editions)} editions, {sum(len(e['rows']) for e in editions)} rows; {len(failed)} failed")
    for f in failed:
        print(f"  FAILED {f}")


# ---------------------------------------------------------------- report

def spot_checks(editions: list[dict]) -> list[str]:
    """Find each picked row's value in the PDF's own reading-order text, after its description."""
    by_name = {e["notification"]: e for e in editions}
    picks = [
        ("95/2023-Customs (N.T.)", "1", 8),
        ("72/2026-Customs (N.T.)", "2", 1),
        ("11/2026-Customs (N.T.)", "2", 3),
        ("46/2025-Customs (N.T.)", "3", 1),
    ]
    lines = []
    for name, table, serial in picks:
        e = by_name[name]
        row = next(r for r in e["rows"] if r["table"] == table and r["serial"] == serial)
        text = squash(" ".join(p.get_text() for p in fitz.open(NOTIFICATIONS / e["source"]["file"])))
        head = row["description"][-40:] if table == "2" else row["description"]
        at = text.find(head)
        window = text[at: at + len(head) + 40] if at >= 0 else ""
        unit = row["unitText"] if table == "2" else ""
        ok = bool(re.search(rf"{re.escape(head)}\s*{row['amount']}\b\s*{re.escape(unit)}", window))
        lines.append(
            f"- **{name}, TABLE-{table} S.No. {serial}** (CTH {row['cthText']}, page {row['page']}): "
            f"JSON `{row['amount']} {row['currency']} {row['unitText']}` (uqc `{row['uqc']}`, per `{row['per']}`). "
            f"PDF text: \"…{window}…\" — {'MATCH' if ok else 'MISMATCH'}"
        )
        if not ok:
            raise SystemExit(f"spot-check failed: {lines[-1]}")
    return lines


def write_report(editions: list[dict], failed: list[dict], notes: list[str], contradictions: list[str]) -> None:
    rows = sum(len(e["rows"]) for e in editions)
    by_table = {t: sum(1 for e in editions for r in e["rows"] if r["table"] == t) for t in "123"}
    units = sorted({(r["table"], r["unitText"], r["uqc"], r["per"]) for e in editions for r in e["rows"]})
    L = [
        "# Tariff values (Section 14(2)) — build report",
        "",
        "Generated by `packages/core/scripts/build-tariff-values.py` from `data/customs-corpus/notifications/`.",
        "",
        f"- Base notification: 36/2001-Customs (N.T.) dated 03.08.2001 (S.O. 748(E)); Logi-Sys `Tariff_Value_Notn` = `036/2001`.",
        f"- Editions parsed: **{len(editions)}**, {editions[0]['notification']} (effective {editions[0]['effectiveFrom']}) "
        f"to {editions[-1]['notification']} (effective {editions[-1]['effectiveFrom']}, open-ended).",
        f"- Rows: **{rows}** (TABLE-1 {by_table['1']}, TABLE-2 {by_table['2']}, TABLE-3 {by_table['3']}).",
        f"- Every edition substitutes TABLE-1, TABLE-2 and TABLE-3 in full; every \"last amended vide\" note names the preceding edition (chain unbroken); every \"(i.e., no change)\" marker was compared with the previous edition (contradictions listed below).",
        "",
        "## Units as printed",
        "",
        "| Table | unitText | uqc | per |",
        "|---|---|---|---|",
        *[f"| {t} | {u} | {q} | {p} |" for t, u, q, p in units],
        "",
        "TABLE-1 and TABLE-3 carry the unit in the column header (\"US $ Per Metric Tonne\" / \"US $ Per Metric Ton\"); "
        "TABLE-2 prints it in each value cell. Quantity for `Tarrif_Value_Qty` = declared quantity in `uqc` ÷ `per` "
        "(e.g. 1 kg gold = 1000 GMS ÷ 10 = 100 units at the per-10-grams value).",
        "",
        "## Editions",
        "",
        "| Notification | Dated | Effective from | Until | Extraction | Rows |",
        "|---|---|---|---|---|---|",
        *[f"| {e['notification']} | {e['notificationDate']} | {e['effectiveFrom']} | {e['effectiveUntil'] or '—'} | {e['source']['extraction']} | {len(e['rows'])} |" for e in editions],
        "",
        "## Failed / not parsed",
        "",
        *([f"- {f}" for f in failed] or ["- None among the in-scope editions."]),
        "",
        "## Caveats",
        "",
        "- **80/2024-Customs (N.T.)**: the corpus copy (and CBIC's English download) is the Hindi text. Amounts/serials/CTH parsed from it; descriptions carried from 79/2024.",
        "- **01/2026-Customs (N.T.)**: image-only PDF, no OCR available. Values transcribed by eye at 300 dpi and pinned by SHA-256; TABLE-1 and TABLE-3 are marked \"no change\" and verified against 80/2025. The two changed values (gold 1485 per 10 grams, silver 2724 per kilogram) rest on the visual reading alone.",
        "- **12/2024-Customs** (CBIC id 1010013, category Tariff) is byte-identical to 12/2024-Customs (N.T.); ignored.",
        "- TABLE-2 S.No. 1–2 reference serials of the BCD exemption notification: 356/357 of 50/2017-Customs until the switch to 194/195 of 45/2025-Customs. The description text is kept verbatim so the reference is visible.",
        "- `include` is the CTH column only; TABLE-2 S.No. 1–2 apply to chapter 71 or 98 **and** only when the named exemption serial is availed.",
        "",
        "## \"(i.e., no change)\" markers that CBIC's own text contradicts",
        "",
        "The substituted figure is what the notification enacts, so it is kept; the stale marker is recorded on the edition's `notes`.",
        "",
        *([f"- {c}" for c in contradictions] or ["- None."]),
        "",
        "## Index discrepancies (PDF wins)",
        "",
        *([f"- {n}" for n in notes] or ["- None."]),
        "",
        "## Spot-checks against PDF text",
        "",
        *spot_checks(editions),
        "",
    ]
    (OUT / "tariff-values.REPORT.md").write_text("\n".join(L))


if __name__ == "__main__":
    main()
