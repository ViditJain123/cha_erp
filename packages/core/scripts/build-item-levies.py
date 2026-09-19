#!/usr/bin/env python3
"""
Builds the per-item levy/exemption master the Logi-Sys ITEMS sheet needs:
for an 8-digit CTH and a Bill of Entry date, which notification number and
serial to write against AIDC, Social Welfare Surcharge, Health Cess, IGST
exemption and compensation-cess exemption.

    pip install pymupdf
    python3 packages/core/scripts/build-item-levies.py            # build
    python3 packages/core/scripts/build-item-levies.py --discover # + full-text amendment scan

Outputs (both generated, both committed):

    src/masters/generated/items/levies.json
    src/masters/generated/items/levies.REPORT.md

## Sources

Everything is read from the CBIC corpus in data/customs-corpus/ (see
data/customs-corpus/index/cbic-notifications.json), never typed in:

  AIDC            11/2021-Customs (id 1000045) — the effective-rate Table and
                  its ANNEXURE of BCD-exemption notifications, plus every
                  amendment listed in AMENDMENTS below.
  SWS exemption   11/2018-Customs (id 1000405) — "whole of SWS" exemption.
  Health Cess     8/2020-Customs (id 1000232). NOT 6/2020: 06/2020-Customs in
                  the corpus is a 24/2005 amendment about copper. The Health
                  Cess exemption is 8/2020, which 44/2025 amends as "8/2020".
  IGST "C"        45/2025-Customs, reusing build-masters.py's own parse
                  (amendments applied there), keeping rows with an IGST cell.
  IGST "G"        10/2025-Integrated Tax (Rate) (id 1010432), which supersedes
                  2/2017-IT(R): whole exemption for the goods it schedules.
  Comp cess "C"   45/2025-Customs, rows with a compensation-cess cell.

## How amendments are applied

A notification is the base PDF plus every amendment since. The amendments are
prose ("against Sl. No. 15A, in column (4), for the entry, the entry "1.4%"
shall be substituted"), so they are read as a sequence of instructions:

  * every "shall be substituted|inserted|omitted|added" in the part of the
    amendment that addresses our notification is one instruction, and must be
    classified by one of INSTRUCTION_FORMS or the build stops — so nothing is
    skipped silently;
  * the serial and column an instruction acts on come from the nearest
    "against Sl. No. X, in column (N)" before it;
  * a text edit asserts that the text it replaces is really in that cell. When
    it is not, the edit is NOT applied, the entry is marked `staleBy`, and the
    report lists it;
  * rows an amendment inserts or substitutes are read from its ruled tables
    (PyMuPDF find_tables + build-masters' logical_rows), matched by serial and
    column count, never by position alone.

Amendments are applied in date order, each at its own effective date
("come into force on…", or a per-clause "with effect from…"). Every change
closes the old version (validUntil = day before) and opens a new one
(validFrom), so a lookup can be made as at the BE date. Versions that ended
before HISTORY_FROM are dropped.

## Traps (each cost a wrong answer once)

  * Multi-notification amendments (44/2025, 16/2025, 03/2026, 16/2026…) are a
    3-column table; its text is laid out so a row's column (2) sometimes lands
    *after* its column (3) instructions. Segments are cut at the "N. 11/2021-
    Customs, dated" row headers, which must number 1..n.
  * 20/2024-Customs's PDF also contains 19/2024 (Hindi and English) first.
  * 1009038 is the same corrigendum file as 1008973 (cs11-2021-corr.pdf).
  * Inserted rows are quoted “…”; a block ends at the row whose last cell
    closes the quote. 44/2025 prints its rows unquoted, one per instruction.
  * The AIDC serial is not a function of the CTH alone. 17 is the residual
    "all other goods"; 18/19/20/17A/15L apply when BCD exemption is *claimed*
    under a named notification (advance authorisation, the ANNEXURE list,
    45/2025 serials…). See the report's validation section.
  * SWS and Health Cess tables have no code column: codes are pulled from the
    description prose, and qualifiers ("other than…", "covered under…") are
    kept as `conditions` because they cannot be expressed as prefixes.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF is required: pip install pymupdf")

ROOT = Path(__file__).resolve().parent.parent          # packages/core
REPO = ROOT.parent.parent                              # checklist-app
CORPUS = REPO / "data" / "customs-corpus"
NOTIFICATIONS = CORPUS / "notifications"
OUT = ROOT / "src" / "masters" / "generated" / "items"

# Versions that stopped applying before this date are not published. A BE
# filed today can still be re-assessed a year back; nothing older matters.
HISTORY_FROM = "2025-04-01"

# The house helpers — the same ruled-table reader and code-spec grammar the
# BCD/IGST masters use, so a CTH spec means the same thing everywhere.
_spec = importlib.util.spec_from_file_location("build_masters", ROOT / "scripts" / "build-masters.py")
bm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bm)

INDEX = {r["id"]: r for r in json.loads((CORPUS / "index" / "cbic-notifications.json").read_text())}

MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october november december".split())}
DATE = r"(\d{1,2})\s?(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(\d{4})"


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #

AIDC_BASE, SWS_BASE, HC_BASE, IGST_G_BASE = 1000045, 1000405, 1000232, 1010432

TARGETS = {
    # key: (base corpus id, printed number regex, column names after S.No.)
    "aidc": (AIDC_BASE, r"11\s*/\s*2021", ["spec", "description", "rateText"]),
    "sws": (SWS_BASE, r"11\s*/\s*2018", ["description"]),
    "healthCess": (HC_BASE, r"0?8\s*/\s*2020", ["description"]),
}

# Every corpus notification that amends one of the three, with the targets it
# amends. Found by searching index names AND the full text of every Tariff PDF
# since Feb 2018 (run with --discover to repeat that scan).
AMENDMENTS = [
    (1000375, {"sws"}),                        # 41/2018 — preamble (Bill -> Act)
    (1000243, {"sws"}),                        # 39/2019
    (1000231, {"sws"}),                        # 09/2020
    (1000221, {"healthCess"}),                 # 19/2020 — preamble
    (1000042, {"sws"}),                        # 14/2021
    (1000050, {"healthCess"}),                 # 06/2021
    (1008973, {"aidc"}),                       # Corrigendum 05.02.2021
    (1000038, {"aidc"}),                       # 18/2021
    (1000034, {"healthCess"}),                 # 22/2021
    (1000030, {"aidc"}),                       # 26/2021 — preamble
    (1000016, {"aidc"}),                       # 38/2021
    (1000012, {"aidc"}),                       # 42/2021
    (1008955, {"sws"}),                        # 58/2021
    (1009191, {"sws"}),                        # 03/2022
    (1009203, {"healthCess"}),                 # 15/2022
    (1009297, {"sws"}),                        # 24/2022
    (1009310, {"aidc"}),                       # 27/2022
    (1009527, {"aidc"}),                       # 53/2022
    (1009555, {"aidc"}),                       # 60/2022
    (1009621, {"aidc"}),                       # 03/2023
    (1009622, {"sws"}),                        # 04/2023
    (1009671, {"healthCess"}),                 # 18/2023
    (1009724, {"aidc"}),                       # 36/2023 — HSN alignment, S.No. 11
    (1009761, {"aidc"}),                       # 42/2023
    (1009766, {"aidc"}),                       # 45/2023
    (1009841, {"aidc"}),                       # 51/2023
    (1009995, {"sws"}),                        # 04/2024
    (1009996, {"aidc"}),                       # 05/2024
    (1010016, {"aidc"}),                       # 11/2024
    (1010042, {"sws"}),                        # 20/2024 (PDF also carries 19/2024)
    (1010124, {"aidc"}),                       # 32/2024
    (1010127, {"healthCess"}),                 # 35/2024
    (1010155, {"aidc"}),                       # 43/2024
    (1010293, {"aidc"}),                       # 06/2025
    (1010294, {"sws"}),                        # 07/2025
    (1010315, {"aidc"}),                       # 14/2025
    (1010323, {"sws", "aidc"}),                # 16/2025
    (1010339, {"sws", "aidc"}),                # 20/2025
    (1010493, {"sws", "healthCess", "aidc"}),  # 44/2025
    (1010565, {"sws", "aidc"}),                # 03/2026
    (1010638, {"sws"}),                        # 14/2026 — S.No. 1 HSN alignment
    (1010650, {"sws", "aidc"}),                # 16/2026
]

# Corpus records that mention a target but do not amend it.
NOT_AMENDMENTS = {
    1009038: "duplicate of 1008973 (same cs11-2021-corr.pdf)",
    1010294: "07/2025 cites 11/2021 and 8/2020 only inside new SWS entries 8A/8F/56C",
    1010616: "11/2026 (SEZ DTA clearance) cites 8/2020 inside its own table",
    1000040: "16/2021 amends 96/2008 etc. for AIDC, not 11/2021",
    1009196: "08/2022 amends other notifications to exempt AIDC/Health Cess",
}

# Stand-alone AIDC exemption notifications (not amendments of 11/2021). Where
# one applies, Logi-Sys cites it instead of 11/2021. Only these three are read;
# older time-bound ones (48/2021, 49/2021, 21/2022, 30/2022, 37/2023, 64/2023)
# are listed in the report as not parsed.
AIDC_STANDALONE = [1010420, 1010618, 1010663]  # 35/2025, 13/2026, 19/2026

IGST_G_CORRIGENDA = [1010470]

# Why a failure is a fact about the source rather than a parser bug. Keyed by
# the text the instruction could not find; shown next to the failure.
SOURCE_INCONSISTENCIES = {
    "5802 19,": "58/2021 (in force 01.01.2022) had already replaced \"5802 19\" with 5802 10 20-90, so 03/2022's "
                "\"after 5802 19, insert 5802 30 00,\" cannot be carried out as written. 5802 30 00 is NOT in S.No. 1 "
                "here; whether CBIC treats it as inserted needs a consolidated copy",
}


# --------------------------------------------------------------------------- #
# Corpus access
# --------------------------------------------------------------------------- #

def pdf_path(rid: int) -> Path:
    found = list(NOTIFICATIONS.glob(f"*__{rid}.pdf"))
    if len(found) != 1:
        raise SystemExit(f"corpus id {rid}: expected one PDF, found {found}")
    return found[0]


def open_doc(rid: int):
    return fitz.open(pdf_path(rid))


def doc_text(doc) -> str:
    return bm.prose(" ".join(page.get_text() for page in doc))


def label(number: str | int, year: str | int) -> str:
    """'011/2021' — the way Logi-Sys writes a notification number."""
    y = int(year)
    if y < 100:
        y += 1900 if y > 30 else 2000
    return f"{int(number):03d}/{y}"


def index_label(rid: int) -> str:
    m = re.match(r"\s*(\d+)\s*/\s*(\d{2,4})", INDEX[rid]["notificationNo"] or "")
    return label(m.group(1), m.group(2)) if m else (INDEX[rid]["notificationNo"] or str(rid)).strip()


def published(rid: int) -> str:
    return INDEX[rid]["notificationDt"][:10]


def parse_date(text: str) -> str | None:
    m = re.search(DATE, text, re.I)
    if not m:
        return None
    return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"


def day_before(iso: str) -> str:
    return (dt.date.fromisoformat(iso) - dt.timedelta(days=1)).isoformat()


def effective_date(rid: int, text: str) -> str:
    m = re.search(r"come into (?:force|effect)\s*(?:on|from|with effect from)?\s*(?:the\s*)?" + DATE, text, re.I)
    if m:
        return parse_date(m.group(0))
    return published(rid)  # "with immediate effect", or silent


# --------------------------------------------------------------------------- #
# Ruled tables
# --------------------------------------------------------------------------- #

SERIAL_CELL = re.compile(r'"?\s*(\d+)\s?([A-Z]{0,2})\s*\.?\s*')


def norm_serial(s: str) -> str:
    return re.sub(r"\s+", "", s).rstrip(".").upper()


def serial_key(s: str) -> tuple:
    m = re.fullmatch(r"(\d+)([A-Z]*)", s)
    return (int(m.group(1)), m.group(2)) if m else (10**9, s)


def closes_quote(cells: list[str]) -> bool:
    last = next((c for c in reversed(cells) if c), "")
    return bool(re.search(r'"\s*[;.,]?\s*$', last))


def strip_quotes(cells: list[str]) -> list[str]:
    out = list(cells)
    if out and out[0].startswith('"'):
        out[0] = out[0][1:].strip()
    for i in range(len(out) - 1, -1, -1):
        if out[i]:
            out[i] = re.sub(r'"\s*[;.,]?\s*$', "", out[i]).strip()
            break
    return out


def table_rows(doc, width: int) -> list[dict]:
    """Serial-led rows of every ruled table `width` columns wide, in page order.

    A row with an empty S.No. cell is the previous row carried over a ruling or
    a page break, and is folded into it — the 17A list of 06/2025 finishes on
    the next page that way.
    """
    rows: list[dict] = []
    for pno, page in enumerate(doc, start=1):
        for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
            cells_list = bm.logical_rows(table)
            if not cells_list or len(cells_list[0]) != width:
                continue
            for cells in cells_list:
                first = cells[0].strip()
                if first in ("(1)",) or re.match(r"(?:S|Sl|Sr)\.?\s*N\s*o", first, re.I):
                    continue
                m = SERIAL_CELL.fullmatch(first)
                if m:
                    rows.append({
                        "serial": m.group(1) + m.group(2),
                        "opens": first.startswith('"'),
                        "cells": cells,
                        "page": pno,
                        "used": False,
                    })
                elif not first and rows and any(cells):
                    prev = rows[-1]["cells"]
                    rows[-1]["cells"] = [f"{a} {b}".strip() for a, b in zip(prev, cells)]
    for r in rows:
        r["closes"] = closes_quote(r["cells"])
        r["cells"] = strip_quotes(r["cells"])
        r["cells"][0] = norm_serial(r["serial"])
    return rows


# --------------------------------------------------------------------------- #
# The notification model
# --------------------------------------------------------------------------- #

class Table:
    """One notification table, with every version of every serial."""

    def __init__(self, key: str, columns: list[str], notification: str):
        self.key = key
        self.columns = columns
        self.notification = notification
        self.live: dict[str, dict] = {}
        self.closed: list[dict] = []

    def add(self, serial: str, values: dict, valid_from: str, source: str, page: int | None, amended_by=None):
        serial = norm_serial(serial)
        if serial in self.live:
            raise SystemExit(f"{self.key}: serial {serial} inserted twice")
        self.live[serial] = {"serial": serial, **values, "validFrom": valid_from, "validUntil": None,
                             "amendedBy": list(amended_by or []), "source": source, "page": page}

    def revise(self, serial: str, changes: dict, effective: str, note: str, source=None, page=None):
        old = self.live[serial]
        if effective < old["validFrom"]:
            raise SystemExit(f"{self.key} S.No. {serial}: {note} takes effect {effective}, before the "
                             f"version it amends ({old['validFrom']}); amendments must apply in effective order")
        new = {**old, **changes, "validFrom": effective, "amendedBy": old["amendedBy"] + [note]}
        if source:
            new["source"], new["page"] = source, page
        if effective == old["validFrom"]:  # two edits on one day are one version
            self.live[serial] = new
            return
        old["validUntil"] = day_before(effective)
        self.closed.append(old)
        self.live[serial] = new

    def omit(self, serial: str, effective: str, note: str):
        old = self.live.pop(serial)
        if effective <= old["validFrom"]:
            raise SystemExit(f"{self.key} S.No. {serial}: {note} omits it with effect {effective}, "
                             f"not after its current version ({old['validFrom']})")
        old["validUntil"] = day_before(effective)
        old["amendedBy"] = old["amendedBy"] + [note]
        self.closed.append(old)

    def seen(self, serial: str) -> bool:
        return serial in self.live or any(v["serial"] == serial for v in self.closed)

    def versions(self) -> list[dict]:
        keep = [v for v in self.closed if v["validUntil"] >= HISTORY_FROM] + list(self.live.values())
        return sorted(keep, key=lambda v: (serial_key(v["serial"]), v["validFrom"]))


def read_base(rid: int, key: str, columns: list[str], expect_last: str) -> tuple[Table, Table | None, str]:
    doc = open_doc(rid)
    text = doc_text(doc)
    start = effective_date(rid, text)
    notification = index_label(rid)
    table = Table(key, columns, notification)
    width = len(columns) + 1
    rows = table_rows(doc, width)
    serials = []
    for r in rows:
        values = dict(zip(columns, r["cells"][1:]))
        table.add(r["serial"], values, start, notification, r["page"])
        serials.append(r["serial"])
    bm.check_serials(f"{key} base {notification}", serials)
    if serials[-1] != expect_last:
        raise SystemExit(f"{key}: base table should end at S.No. {expect_last}, ends at {serials[-1]}")

    proviso = re.search(r"Provided that in case of goods specified.*?(?:therein|thereto)\.", text)
    table.proviso = proviso.group(0) if proviso else None
    table.proviso_amended_by = []

    annexure = None
    if key == "aidc":
        # The 2-column ANNEXURE follows the 4-column table.
        annexure = Table("aidc-annexure", ["text"], notification)
        ann = table_rows(doc, 2)
        for r in ann:
            annexure.add(r["serial"], {"text": r["cells"][1]}, start, notification, r["page"])
        bm.check_serials("aidc annexure", [r["serial"] for r in ann])
    return table, annexure, text


# --------------------------------------------------------------------------- #
# Amendment instructions
# --------------------------------------------------------------------------- #

SN = r"(?:the\s+)?(?:S(?:l|r)?\s*\.?\s*No\.?|serial\s+number)\s*"
SNS = r"(?:S(?:l|r)?\s*\.?\s*Nos?\.?|serial\s+numbers?)\s*"
SER = r"\d+\s?[A-Z]{0,2}"
FIELD = r"(?:figures?|words?|letters?|brackets?)"
FIELDS = rf"{FIELD}(?:\s*,\s*{FIELD})*(?:\s*and\s*{FIELD})?"

# Most specific first; each must match the instruction window up to its verb.
INSTRUCTION_FORMS = [
    ("add-at-end", rf"the following {SN}shall be added$"),  # "… added at the end"
    ("proviso-omit", r"(?:the first and the second )?provisos? after the Table shall be omitted$"),
    ("proviso-insert", r"after the TABLE\s*,?\s*the following provisos?\s*,?\s*shall be inserted$"),
    ("row-omit-range", rf"{SNS}(?P<a>{SER})\s*to\s*(?P<b>{SER})\s*and the entries relating (?:thereto|hereto)\s*,?\s*shall be omitted$"),
    ("row-omit", rf"{SNS}(?P<list>{SER}(?:\s*,\s*{SER})*(?:\s*,?\s*and\s*{SER})?)\s*,?\s*and the entries relating (?:thereto|hereto)\s*,?\s*shall be omitted$"),
    ("item-insert", r'after item \((?P<item>[ivx]+)\)(?:\s*and the entries relating thereto)?\s*,?\s*(?:and before the words\s*"(?P<before>[^"]+)"\s*,?\s*)?the following items?(?: and entries)?\s*shall be inserted$'),
    ("item-subst", r"for item \((?P<item>[ivx]+)\)\s*and the entries relating thereto\s*,?\s*the following item(?: and entries)?\s*shall be substituted$"),
    ("item-omit", r"item \((?P<item>[ivx]+)\)\s*shall be omitted$"),
    ("row-insert", rf"(?:after|against)\s+{SN}(?P<after>{SER})\.?\s*,?\s*(?:and (?:the )?entries relating thereto\s*,?\s*)?the following .{{0,80}}?shall be inserted$"),
    ("row-subst", rf"for\s+{SN}(?P<serial>{SER})\.?\s*and the entries relating thereto\s*,?\s*the following .{{0,80}}?shall be substituted$"),
    ("cell-entry", r'(?:for the entry(?:\s*in column \((?P<col>\d)\))?\s*(?:"(?P<old>[^"]*)")?\s*,?\s*)?the (?:following )?entry\s*,?\s*(?:"(?P<new>[^"]*)"\s*,?\s*)?shall be substituted$'),
    ("text-insert", rf'after the {FIELDS}\s*,?\s*"(?P<anchor>[^"]+)"\s*,?\s*the {FIELDS}\s*,?\s*"(?P<new>[^"]+)"\s*,?\s*shall be inserted$'),
    ("text-subst", rf'for the {FIELDS}\s*,?\s*"(?P<old>[^"]+)"\s*,?\s*the {FIELDS}\s*,?\s*"(?P<new>[^"]*)"\s*,?\s*shall be (?:substituted|inserted)$'),
    ("text-omit", rf'the {FIELDS}\s*,?\s*"(?P<old>[^"]+)"\s*,?\s*shall be omitted$'),
]

VERB = re.compile(r"shall\s+be\s+(?:substituted|inserted|omitted|added)")
HEADER = re.compile(
    r"(?<![\w/(])(\d{1,2})\.\s+(?:Notification\s+(?:No\.?|number)\s*)?(\d{1,3})\s*/\s*(\d{4})\s*-?\s*Customs\s*,?\s*(?:dated|\[)",
    re.I,
)
END_MARK = re.compile(r"\b2\.\s*(?:This notification|Save as otherwise)|\[\s*F\.?\s*No|\(\s*F\.?\s*No|\bNote\s*[:.-]", re.I)


def segment(text: str, key: str) -> str:
    """The part of an amendment that addresses notification `key`."""
    number = TARGETS[key][1]
    headers = []
    for m in HEADER.finditer(text):
        if int(m.group(1)) == len(headers) + 1:
            headers.append(m)
    if len(headers) >= 2:
        for i, h in enumerate(headers):
            if re.fullmatch(number, f"{h.group(2)}/{h.group(3)}"):
                if i + 1 < len(headers):
                    end = headers[i + 1].start()
                else:
                    tail = END_MARK.search(text, h.end())
                    end = tail.start() if tail else len(text)
                return text[h.start():end]
        raise SystemExit(f"{key}: no row of the amendment table addresses it")
    m = re.search(number + r"\s*-?\s*Cus", text)
    if not m:
        raise SystemExit(f"{key}: amendment does not name the notification")
    start = m.end()
    end = END_MARK.search(text, start)
    return text[start:end.start() if end else len(text)]


def instructions(seg: str) -> list[dict]:
    out = []
    prev = 0
    ctx = {"serial": None, "col": None, "target": "table"}
    for v in VERB.finditer(seg):
        if seg.count('"', 0, v.start()) % 2:  # inside quoted row content
            continue
        window = seg[prev:v.end()]
        bare = re.sub(r'"[^"]*"', '""', window)
        markers = [(m.start(), m.group(1).lower()) for m in re.finditer(r"in the (TABLE|Annexure|proviso)\b", bare, re.I)]
        if markers:
            ctx["target"] = {"table": "table", "annexure": "annexure", "proviso": "proviso"}[max(markers)[1]]
        against = list(re.finditer(rf"against\s+{SN}({SER})", bare))
        if against:
            ctx["serial"] = norm_serial(against[-1].group(1))
            ctx["col"] = None
        cols = list(re.finditer(r"in column \((\d)\)", bare))
        if cols and (not against or cols[-1].start() > against[-1].start()):
            ctx["col"] = int(cols[-1].group(1))

        kind, fields = None, {}
        for name, pattern in INSTRUCTION_FORMS:
            m = re.search(pattern, window, re.I | re.S)
            if m:
                kind, fields = name, {k: v for k, v in m.groupdict().items() if v is not None}
                break
        if not kind:
            raise SystemExit(f"unclassified instruction: …{window[-240:]!r}")

        after = seg[v.end():v.end() + 4000]
        eff = re.match(r"\s*with effect from\s*(?:the\s*)?" + DATE, after, re.I)
        content = re.match(
            r'\s*(?:with effect from[^,]*?\d{4}\s*)?,?\s*namely\s*:?\s*[-–—]*\s*(?:\(\d\)\s*)*"(?P<c>.*?)"\s*(?:[;.,]|$)',
            after, re.S)
        out.append({
            "kind": kind,
            **fields,
            "ctxSerial": ctx["serial"],
            "ctxCol": ctx["col"],
            "target": ctx["target"],
            "effective": parse_date(eff.group(0)) if eff else None,
            "content": content.group("c").strip() if content else None,
            "raw": window[-300:].strip(),
        })
        if kind.startswith("row-"):
            ctx["serial"], ctx["col"] = None, None
        prev = v.end()
    return out


def read_corrigendum_reads(text: str) -> list[tuple[str, str]]:
    return [(m.group(3), m.group(4)) for m in re.finditer(
        r"at page (\d+),?\s*(?:in )?lines?\s*(\d+),?\s*for\s*['\"]([^'\"]+)['\"]\s*,?\s*read\s*['\"]([^'\"]+)['\"]", text)]


ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv"]


def item_span(text: str, item: str) -> tuple[int, int] | None:
    """Where item (iv) of an enumerated cell starts and ends."""
    m = re.search(rf"\({item}\)", text)
    if not m:
        return None
    nxt = ROMAN[ROMAN.index(item) + 1] if item in ROMAN[:-1] else None
    ends = [len(text)]
    if nxt:
        n = re.search(rf"\({nxt}\)", text[m.end():])
        if n:
            ends.append(m.end() + n.start())
    stop = re.search(r",\s*on which exemption", text[m.end():])
    if stop:
        ends.append(m.end() + stop.start())
    return m.start(), min(ends)


def squash(text: str) -> str:
    """Whitespace and comma spacing only — "1006 ,1502 ," reads as "1006, 1502,".

    Leading and trailing commas are kept: in "after the figures "1502,"" the
    comma is part of the anchor, and dropping it splices the new codes in
    front of the comma instead of after it.
    """
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*,\s*(?:,\s*)*", ", ", text)   # also ",," left by an edit
    text = re.sub(r"\.\s*,", ",", text)
    return re.sub(r"\s+([.;])", r"\1", text).strip()


def tidy(text: str) -> str:
    return squash(text).strip(" ,")


def splice(left: str, new: str, right: str) -> str:
    return tidy(f"{left.rstrip()} {new.strip()} {right.lstrip()}")


class Applier:
    def __init__(self, tables: dict[str, Table]):
        self.tables = tables
        self.applied: list[dict] = []
        self.recorded: list[dict] = []   # understood, deliberately not modelled
        self.failed: list[dict] = []     # could not be applied — entries marked stale

    def fail(self, table: Table | None, serial, note, why, ins):
        self.failed.append({"note": note, "serial": serial, "why": why, "raw": ins["raw"][-200:]})
        if table and serial in table.live:
            table.live[serial].setdefault("staleBy", []).append(note)

    def column(self, table: Table, col: int | None) -> str | None:
        if table.key in ("sws", "healthCess", "aidc-annexure"):
            return table.columns[0]
        return {2: "spec", 3: "description", 4: "rateText"}.get(col)

    def apply(self, rid: int, key: str, seg: str, rows_by_width: dict[int, list[dict]], doc_effective: str):
        notification = index_label(rid)
        if INDEX[rid]["notificationNo"].lower().startswith("corrigendum"):
            notification = f"Corrigendum {published(rid)}"
        for ins in instructions(seg):
            eff = ins["effective"] or doc_effective
            kind = ins["kind"]
            target = ins["target"]
            table = self.tables["aidc-annexure"] if (key == "aidc" and target == "annexure") else self.tables[key]
            note = f"{notification} ({kind})"
            width = len(table.columns) + 1

            def take_rows(first_serial: str | None) -> list[dict]:
                queue = rows_by_width.get(width, [])
                i = next((i for i, r in enumerate(queue) if not r["used"] and
                          (first_serial is None or r["serial"] == first_serial)), None)
                if i is None:
                    return []
                taken = [queue[i]]
                if queue[i]["opens"] and not queue[i]["closes"]:
                    j = i + 1
                    while j < len(queue):
                        taken.append(queue[j])
                        if queue[j]["closes"]:
                            break
                        j += 1
                for r in taken:
                    r["used"] = True
                return taken

            if kind in ("row-omit", "row-omit-range"):
                if kind == "row-omit":
                    serials = [norm_serial(s) for s in re.split(r"\s*,\s*|\s+and\s+", ins["list"]) if s.strip()]
                else:
                    lo, hi = serial_key(norm_serial(ins["a"])), serial_key(norm_serial(ins["b"]))
                    serials = [s for s in table.live if lo <= serial_key(s) <= hi]
                for s in serials:
                    if s not in table.live:
                        self.fail(table, s, note, "omits a serial that is not live", ins)
                        continue
                    table.omit(s, eff, note)
                self.applied.append({"note": note, "table": table.key, "serials": serials, "effective": eff})

            elif kind in ("row-insert", "row-subst", "add-at-end"):
                expected = norm_serial(ins["serial"]) if kind == "row-subst" else None
                if kind == "row-insert" and not table.seen(norm_serial(ins["after"])):
                    self.fail(table, None, note, f"inserts after S.No. {ins['after']}, which this table never had", ins)
                    continue
                rows = take_rows(expected)
                if not rows and width == 2 and ins["content"]:
                    rows = [{"cells": [norm_serial(m.group(1)), m.group(2).strip()], "page": None}
                            for m in [re.match(r"(\d+\s?[A-Z]{0,2})\.\s*(.*)", ins["content"], re.S)] if m]
                if not rows:
                    self.fail(table, expected, note, "no inserted/substituted row found in the amendment's tables", ins)
                    continue
                done = []
                for r in rows:
                    serial = r["cells"][0]
                    values = dict(zip(table.columns, r["cells"][1:]))
                    src = (notification, r["page"])
                    if kind == "row-subst":
                        if serial != expected:
                            self.fail(table, expected, note, f"substitute row reads S.No. {serial}", ins)
                            continue
                        if serial not in table.live:
                            self.fail(table, serial, note, "substitutes a serial that is not live", ins)
                            continue
                        table.revise(serial, values, eff, note, *src)
                    else:
                        if serial in table.live:
                            self.fail(table, serial, note, "inserts a serial that is already live", ins)
                            continue
                        table.add(serial, values, eff, notification, r["page"], amended_by=[note])
                    done.append(serial)
                self.applied.append({"note": note, "table": table.key, "serials": done, "effective": eff})

            elif kind == "cell-entry":
                serial, col = ins["ctxSerial"], int(ins.get("col") or ins["ctxCol"] or 0) or None
                field = self.column(table, col)
                new = ins.get("new") if ins.get("new") is not None else ins["content"]
                if not serial or serial not in table.live or not field or new is None:
                    self.fail(table, serial, note, f"cell edit without a live serial/column/value (col {col})", ins)
                    continue
                old = ins.get("old")
                if old and old not in table.live[serial][field]:
                    self.fail(table, serial, note, f"expects {old!r} in column {col}, which reads {table.live[serial][field]!r}", ins)
                    continue
                table.revise(serial, {field: tidy(new)}, eff, note)
                self.applied.append({"note": note, "table": table.key, "serials": [serial], "effective": eff})

            elif kind in ("text-subst", "text-insert", "text-omit", "item-insert", "item-subst", "item-omit"):
                serial = ins["ctxSerial"]
                if target == "proviso":
                    base = self.tables[key]
                    old, new = ins.get("old"), ins.get("new")
                    if kind == "text-subst" and base.proviso and old and old in base.proviso:
                        base.proviso = base.proviso.replace(old, new, 1)
                        base.proviso_amended_by.append(f"{note} w.e.f. {eff}")
                        self.applied.append({"note": note, "table": f"{key}-proviso", "serials": [], "effective": eff})
                    else:
                        self.fail(None, None, note, "proviso edit that does not match the proviso text", ins)
                    continue
                if serial is None:
                    words = f"{ins.get('old', '')} {ins.get('new', '')}"
                    if re.search(r"Finance (?:Bill|Act)|clause|section", words):
                        self.recorded.append({"note": note, "what": "preamble wording (no table effect)", "raw": ins["raw"][-160:]})
                    else:
                        self.fail(None, None, note, "table edit with no serial in context", ins)
                    continue
                if serial not in table.live:
                    self.fail(table, serial, note, "edits a serial that is not live", ins)
                    continue
                field = self.column(table, ins["ctxCol"])
                if not field:
                    self.fail(table, serial, note, "edit without a column", ins)
                    continue
                cell = squash(table.live[serial][field])
                if kind == "text-subst":
                    old, new = squash(ins["old"]), squash(ins["new"])
                    if old not in cell:
                        self.fail(table, serial, note, f"expects {old!r} in the cell", ins)
                        continue
                    cell = cell.replace(old, new, 1)
                elif kind == "text-insert":
                    anchor, new = squash(ins["anchor"]), ins["new"]
                    at = cell.find(anchor)
                    if at < 0:
                        self.fail(table, serial, note, f"insert anchor {anchor!r} not in the cell", ins)
                        continue
                    at += len(anchor)
                    cell = splice(cell[:at], new, cell[at:])
                elif kind == "text-omit":
                    old = squash(ins["old"])
                    if old not in cell:
                        self.fail(table, serial, note, f"omits {old!r}, not in the cell", ins)
                        continue
                    cell = cell.replace(old, "", 1)
                else:
                    span = item_span(cell, ins["item"])
                    content = ins["content"]
                    if span is None or (kind != "item-omit" and not content):
                        self.fail(table, serial, note, f"item ({ins['item']}) not found / no content", ins)
                        continue
                    a, b = span
                    if kind == "item-omit":
                        cell = cell[:a] + cell[b:]
                    elif kind == "item-subst":
                        cell = f"{cell[:a]}{content} {cell[b:]}"
                    else:
                        if ins.get("before"):
                            at = cell.find(ins["before"], a)
                            if at < 0:
                                self.fail(table, serial, note, f"'before' anchor {ins['before']!r} not found", ins)
                                continue
                            cell = f"{cell[:at]}{content} {cell[at:]}"
                        else:
                            cell = f"{cell[:b].rstrip()} {content} {cell[b:]}"
                table.revise(serial, {field: tidy(cell)}, eff, note)
                self.applied.append({"note": note, "table": table.key, "serials": [serial], "effective": eff})

            elif kind in ("proviso-insert", "proviso-omit"):
                self.recorded.append({"note": note, "what": f"{kind} after the Table", "raw": (ins["content"] or ins["raw"])[-200:]})
            else:  # pragma: no cover
                raise SystemExit(f"unhandled kind {kind}")


# --------------------------------------------------------------------------- #
# Reading codes and qualifiers out of prose
# --------------------------------------------------------------------------- #

CITATION_NOISE = [
    r"notification No\.?\s*\d+\s*/\s*\d{2,4}\s*-?\s*Customs[^;]*?\d{4}(?:\s*\))?",
    r"G\.?\s*S\.?\s*R\.?\s*\d+\s*\(?E\)?",
    r"S(?:l|r)?\.?\s*Nos?\.?\s*[\dA-Z]+(?:\s*(?:,|and)\s*[\dA-Z]+)*",
    r"serial numbers?\s*[\dA-Z]+(?:\s*(?:,|and|to)\s*[\dA-Z]+)*",
    DATE,
    r"item\s*\(\d\)|column\s*\(\d\)",
    r"\d+(?:[.,]\d+)?\s*(?:mm|kg|Hz|KHz|khz|hz|V|volts?|amps?|amperes?|Amp|%|mA)\b",
    r"US\s*\$\s*[\d,]+",
    r"TABLE\s+[IVX]+",
    r"\b(?:19|20)\d\d\b(?!\s?\d\d)",
]
# 4 digits, then up to two space-separated pairs — "1502 1509 90" is two codes.
CODE = re.compile(r"(?<![\w/.$])(\d{4}(?:\s\d{2}(?!\d)){0,2}|\d{8}|\d{6})(?![\w/])")
CHAPTER = re.compile(r"\bchapters?\s+(\d{1,2})\b", re.I)
QUALIFIER = re.compile(r"\((?:except|other than)\s+[^()]*\)", re.I)
CLAUSE = re.compile(
    r"(?:other than|covered under|on which exemption|if imported|for use|imported by|Provided (?:further )?that|Explanation)[^;()]*",
    re.I)


def prose_codes(text: str) -> dict:
    """Include/exclude prefixes and the qualifiers a code list cannot express."""
    # "for use in the manufacture of X-ray machines (9022 14 20 …), namely" names
    # the product the goods go into, not the goods.
    clean = re.sub(r"for use in (?:the )?manufacture of[^;]*?(?=namely|$)", " ", text, flags=re.I)
    for pattern in CITATION_NOISE:
        clean = re.sub(pattern, " ", clean, flags=re.I)
    excludes: list[str] = []
    qualified: list[dict] = []
    for q in QUALIFIER.finditer(clean):
        inside = [c.replace(" ", "") for c in CODE.findall(q.group(0))]
        before = re.search(r"(\d{4}(?:\s\d{2}(?!\d)){0,2}|\d{8}|\d{6})\s*$", clean[:q.start()])
        if inside:
            excludes += inside
        elif before:
            # "6207 99 (other than goods of man-made fibres)" qualifies one code
            qualified.append({"code": before.group(1).replace(" ", ""), "qualifier": q.group(0)})
    body = QUALIFIER.sub(" ", clean)
    # "other than goods covered under …" outside brackets names no codes of its
    # own once citations are gone; codes after a bare "other than" are exclusions.
    split = re.search(r"\bother than\b", body, re.I)
    head, tail = (body[:split.start()], body[split.end():]) if split else (body, "")
    includes = [c.replace(" ", "") for c in CODE.findall(head)] + CHAPTER.findall(head)
    excludes += [c.replace(" ", "") for c in CODE.findall(tail)]
    includes = [c for c in dict.fromkeys(includes) if len(c) in (2, 4, 6, 8)]
    excludes = [c for c in dict.fromkeys(excludes) if len(c) in (2, 4, 6, 8)]
    out = {"include": includes, "exclude": excludes}
    if qualified:
        out["qualifiedCodes"] = qualified
    return out


# Serial letters are capitals — with re.I, "439 and 440" would read as "439AN".
REF_GROUP = re.compile(
    r"(?i:S(?:l|r)?\.?\s*Nos?\.?)\s*(?P<serials>\d+\s?[A-Z]{0,2}(?:\s*(?:,|and)\s*\d+\s?[A-Z]{0,2})*)"
    r"(?=\s*(?i:of|in)\s*(?i:the\s*)?(?i:TABLE|notification))(?:\s*(?i:of|in)\s*(?i:the\s*)?(?i:TABLE)\s*(?P<table>[IVX]+)?)?")
REF_NOTIFICATION = re.compile(r"notification No\.?\s*(\d+)\s*/\s*(\d{2,4})\s*-?\s*Customs", re.I)


def references(text: str) -> list[dict]:
    """Notifications (and their serials) an entry turns on, with polarity.

    `except` when "other than" appears anywhere before the citation in the
    entry, else `only` — a heuristic, right for every entry published today.
    Serial groups with no notification of their own belong to the next one
    cited — "(i) S.Nos. 105, 181 of TABLE I, (ii) S.Nos. 6… of TABLE II …
    under notification No. 45/2025-Customs".
    """
    refs: list[dict] = []
    pending: list[dict] = []
    events = sorted([(m.start(), "g", m) for m in REF_GROUP.finditer(text)] +
                    [(m.start(), "n", m) for m in REF_NOTIFICATION.finditer(text)], key=lambda e: e[0])
    for pos, kind, m in events:
        if kind == "g":
            pending.append({"serials": [norm_serial(s) for s in re.split(r"\s*,\s*|\s+and\s+", m.group("serials")) if s.strip()],
                            "table": m.group("table"), "pos": pos})
            continue
        number = label(m.group(1), m.group(2))
        if pending:
            for g in pending:
                refs.append({"notification": number, "table": g["table"], "serials": g["serials"],
                             "relation": "except" if re.search(r"other than", text[:g["pos"]], re.I) else "only"})
            pending = []
        else:
            refs.append({"notification": number, "table": None, "serials": [],
                         "relation": "except" if re.search(r"other than", text[:pos], re.I) else "only"})
    return [{k: v for k, v in r.items() if v not in (None, [])} for r in refs]


def conditions_of(text: str, attached: list[str] = ()) -> list[str]:
    for a in attached:  # qualifiers already pinned to one code
        text = text.replace(a, " ")
    found = [m.group(0).strip(" ,;.") for m in QUALIFIER.finditer(text)]
    found += [m.group(0).strip(" ,;.") for m in CLAUSE.finditer(text)]
    found = list(dict.fromkeys(f for f in found if len(f) > 8))
    return [f for f in found if not any(f != g and f.strip("()") in g for g in found)]


def normalize_spec(spec: str) -> str:
    """Spec spellings parse_spec does not read: "4802 / 4907", "50 to 55",
    "Any Chapter except 71"."""
    spec = re.sub(r"\s*/\s*", ", ", spec)
    spec = re.sub(r"(?i)^any chapter except\s+(.+)$", r"Any Chapter (except \1)", spec.strip())
    span = re.fullmatch(r"(\d{2})\s*to\s*(\d{2})", spec)
    if span and int(span.group(1)) <= int(span.group(2)):
        spec = ", ".join(f"{i:02d}" for i in range(int(span.group(1)), int(span.group(2)) + 1))
    return re.sub(r"(?i)\b(?:tariff items?|sub-?headings?|headings?)\b", " ", spec)


def shape(v: dict, rate_for_exempt: float | None = None) -> dict:
    """One published version, in the levies.json entry shape."""
    description = v.get("description", "")
    out = {"serial": v["serial"]}
    if "spec" in v:
        spec = bm.parse_spec(normalize_spec(v["spec"]))
        out.update({"include": spec["include"], "exclude": spec["exclude"]})
        if spec["anyChapter"] or re.fullmatch(r"(?i)any chapter", v["spec"].strip()):
            out["anyChapter"] = True
        out["spec"] = v["spec"]
        if spec["unread"]:
            out["unreadSpec"] = spec["unread"]
    else:
        codes = prose_codes(description)
        out.update(codes)
    out["description"] = description
    if "rateText" in v:
        out["rateText"] = v["rateText"]
        out["rate"] = bm.rate_value(v["rateText"])
    else:
        out["rateText"] = "Nil"
        out["rate"] = rate_for_exempt
    out["conditions"] = conditions_of(description, [q["qualifier"] for q in out.get("qualifiedCodes", [])])
    refs = references(description)
    if refs:
        out["refs"] = refs
    # True when the entry covers every good under its codes — no description
    # limit, no qualifier, no claim. Anything else is a candidate for a person.
    out["allGoods"] = bool(re.match(r"All (?:the )?goods\b", description, re.I)) and not out["conditions"] and not refs
    until = v["validUntil"]
    sunset = bm.sunset_date(description)
    if sunset and (until is None or sunset < until):
        until = sunset
    out["validFrom"] = v["validFrom"]
    if until:
        out["validUntil"] = until
    out["amendedBy"] = v["amendedBy"]
    if v.get("staleBy"):
        out["staleBy"] = v["staleBy"]
    out["source"] = v["source"]
    out["page"] = v["page"]
    return out


def aidc_kind(e: dict) -> str:
    d = e["description"]
    if re.search(r"claimed and allowed", d, re.I) and not re.search(r"other than goods on which exemption", d, re.I):
        return "claim-based"
    if e.get("anyChapter") and re.search(r"other than goods mentioned against serial", d, re.I):
        return "residual"
    return "specific"


# --------------------------------------------------------------------------- #
# IGST / compensation cess exemptions
# --------------------------------------------------------------------------- #

def igst_g_entries() -> tuple[list[dict], list[str]]:
    doc = open_doc(IGST_G_BASE)
    text = doc_text(doc)
    notification = index_label(IGST_G_BASE)
    entries: list[dict] = []
    for pno, page in enumerate(doc, start=1):
        for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
            rows = bm.logical_rows(table)
            if not rows or len(rows[0]) != 3:
                continue
            for serial, spec, description in rows:
                if serial.lower().startswith("s.") or serial == "(1)":
                    continue
                if re.fullmatch(r"\d+\.?", serial):
                    entries.append({"serial": serial.rstrip("."), "spec": spec, "description": description, "page": pno})
                elif not serial and entries:
                    if spec:
                        entries[-1]["spec"] = f"{entries[-1]['spec']} {spec}".strip()
                    entries[-1]["description"] = f"{entries[-1]['description']} {description}".strip()
    bm.check_serials(f"IGST exemption {notification}", [e["serial"] for e in entries])
    notes = []
    for rid in IGST_G_CORRIGENDA:
        for old, new in read_corrigendum_reads(doc_text(open_doc(rid))):
            hits = [e for e in entries if re.search(rf"(?<![\w.]){re.escape(old)}(?![\w])", e["description"])]
            if len(hits) == 1:
                hits[0]["description"] = hits[0]["description"].replace(old, new, 1)
                hits[0].setdefault("amendedBy", []).append(f"Corrigendum {published(rid)} (read {old!r} as {new!r})")
                notes.append(f"Corrigendum {published(rid)}: {old!r} -> {new!r} applied to S.No. {hits[0]['serial']}")
            else:
                notes.append(f"Corrigendum {published(rid)}: {old!r} -> {new!r} NOT applied "
                             f"({len(hits)} candidate rows; it cites a printed page/line, and the change is to the Annexure list numbering or is ambiguous)")
    out = []
    for e in entries:
        spec = bm.parse_spec(normalize_spec(e["spec"]))
        row = {"type": "G", "notification": notification, "serial": e["serial"],
               "include": spec["include"], "exclude": spec["exclude"]}
        if spec["anyChapter"] or re.match(r"(?i)any chapter", e["spec"]):
            row["anyChapter"] = True
        row.update({"spec": e["spec"], "description": e["description"], "igstRateText": "Nil", "igstRate": 0.0,
                    "conditions": conditions_of(e["description"])})
        if spec["unread"]:
            row["unreadSpec"] = spec["unread"]
        if e.get("amendedBy"):
            row["amendedBy"] = e["amendedBy"]
        row["page"] = e["page"]
        out.append(row)
    return out, notes


def customs_c_entries() -> tuple[list[dict], list[dict], dict]:
    entries, conditions, unapplied = bm.build_bcd_exemptions()
    cond_text = {(c["table"], c["no"]): c["text"] for c in conditions}
    igst, cess = [], []
    for e in entries:
        common = {
            "type": "C", "notification": "045/2025", "table": e["table"], "serial": e["serial"],
            "include": e["include"], "exclude": e["exclude"],
        }
        if e["anyChapter"]:
            common["anyChapter"] = True
        tail = {
            "conditions": [f"Condition {n}: {cond_text.get((e['table'], n), '')[:400]}" for n in bm.cited_conditions(e["condition"])],
        }
        sunset = bm.sunset_date(e["description"])
        if sunset:
            tail["validUntil"] = sunset
        if e.get("amendedBy"):
            tail["amendedBy"] = e["amendedBy"]
        if e.get("staleBy"):
            tail["staleBy"] = e["staleBy"]
        tail["page"] = e["page"]
        if e["igstRateText"] and e["igstRateText"].strip("- "):
            igst.append({**common, "description": e["description"], "igstRateText": e["igstRateText"],
                         "igstRate": bm.rate_value(e["igstRateText"]), **tail})
        if e.get("compCessRateText") and e["compCessRateText"].strip("- "):
            cess.append({**common, "description": e["description"], "compCessRateText": e["compCessRateText"],
                         "compCessRate": bm.rate_value(e["compCessRateText"]), **tail})
    stats = {"bcdEntries": len(entries), "unappliedInstructions": len(unapplied)}
    return igst, cess, stats


def aidc_standalone() -> list[dict]:
    out = []
    for rid in AIDC_STANDALONE:
        doc = open_doc(rid)
        text = doc_text(doc)
        whole = bool(re.search(r"whole of the Agriculture Infrastructure and Development Cess", text, re.I))
        start = effective_date(rid, text)
        until = re.search(r"up to and inclusive of\s*(?:the\s*)?" + DATE, text, re.I)
        for pno, page in enumerate(doc, start=1):
            for table in page.find_tables().tables:
                for cells in bm.logical_rows(table):
                    if not re.fullmatch(r"\d+\.?", cells[0]):
                        continue
                    rate_text = cells[3] if len(cells) > 3 else ("Nil" if whole else "")
                    spec = bm.parse_spec(cells[1])
                    out.append({"notification": index_label(rid), "serial": cells[0].rstrip("."),
                                "include": spec["include"], "exclude": spec["exclude"], "spec": cells[1],
                                "description": cells[2], "rateText": rate_text, "rate": bm.rate_value(rate_text),
                                "conditions": [], "validFrom": start,
                                **({"validUntil": parse_date(until.group(0))} if until else {}),
                                "page": pno})
    return out


# --------------------------------------------------------------------------- #
# Lookups used for validation
# --------------------------------------------------------------------------- #

def in_force(e: dict, date: str) -> bool:
    return e.get("validFrom", "0000") <= date and (not e.get("validUntil") or date <= e["validUntil"])


def prefix_match(e: dict, cth: str) -> bool:
    if e.get("anyChapter"):
        return not any(cth.startswith(x) for x in e["exclude"])
    return any(cth.startswith(p) for p in e["include"]) and not any(cth.startswith(x) for x in e["exclude"])


def aidc_serial(aidc: dict, cth: str, date: str, bcd_claim: str | None, annexure_as_at: str | None = None) -> tuple[str, list[str]]:
    live = [e for e in aidc["entries"] if in_force(e, date)]
    specific = [e["serial"] for e in live if e["kind"] == "specific" and prefix_match(e, cth)]
    annexure = {a["notification"] for a in aidc["annexure"] if in_force(a, annexure_as_at or date)}
    if bcd_claim and bcd_claim in annexure:
        return "19", specific
    return "17", specific


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def discover() -> list[str]:
    """Full-text scan of Tariff PDFs since Feb 2018 for unregistered amendments."""
    known = {rid for rid, _ in AMENDMENTS} | set(NOT_AMENDMENTS) | {AIDC_BASE, SWS_BASE, HC_BASE}
    hits = []
    pattern = re.compile(r"(?<![\d/])(11\s*/\s*2021|11\s*/\s*2018|0?8\s*/\s*2020)\s*-?\s*Cus", re.I)
    for rid, r in INDEX.items():
        if r["notificationCategory"] != "Tariff" or (r["notificationDt"] or "") < "2018-02":
            continue
        try:
            text = doc_text(open_doc(rid))
        except SystemExit:
            continue
        if pattern.search(text) and rid not in known:
            hits.append(f"{rid} {r['notificationNo']} {r['notificationDt'][:10]}")
    return hits


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tables: dict[str, Table] = {}
    aidc, annexure, _ = read_base(AIDC_BASE, "aidc", TARGETS["aidc"][2], "19")
    tables["aidc"], tables["aidc-annexure"] = aidc, annexure
    tables["sws"], _, sws_text = read_base(SWS_BASE, "sws", TARGETS["sws"][2], "52")
    tables["healthCess"], _, _ = read_base(HC_BASE, "healthCess", TARGETS["healthCess"][2], "3")

    applier = Applier(tables)
    ledger = []
    ordered = sorted(AMENDMENTS, key=lambda a: (published(a[0]), index_label(a[0])))
    for rid, keys in ordered:
        doc = open_doc(rid)
        text = doc_text(doc)
        doc_eff = effective_date(rid, text)
        rows = {w: table_rows(doc, w) for w in (2, 4)}
        before = (len(applier.applied), len(applier.recorded), len(applier.failed))
        for key in ("sws", "healthCess", "aidc"):
            if key not in keys:
                continue
            seg = segment(text, key)
            applier.apply(rid, key, seg, rows, doc_eff)
        # A corrigendum's "for 'X' read 'Y'" edits the printed page.
        for old, new in read_corrigendum_reads(text):
            hits = [s for s, v in tables["aidc"].live.items() if re.search(rf"(?<!\d){re.escape(old)}(?!\d)", v["spec"])]
            note = f"Corrigendum {published(rid)} (read)"
            if len(hits) == 1:
                # Dated at the version it corrects: the text as it was always meant to print.
                v = tables["aidc"].live[hits[0]]
                tables["aidc"].revise(hits[0], {"spec": v["spec"].replace(old, new, 1)}, tables["aidc"].live[hits[0]]["validFrom"], note)
                applier.applied.append({"note": note, "table": "aidc", "serials": hits, "effective": published(rid)})
            else:
                applier.failed.append({"note": note, "serial": None, "why": f"{old!r} matches {len(hits)} spec cells", "raw": ""})
        after = (len(applier.applied), len(applier.recorded), len(applier.failed))
        unused = [r["serial"] for w in rows for r in rows[w] if not r["used"]]
        ledger.append({
            "id": rid, "notification": index_label(rid) if not INDEX[rid]["notificationNo"].lower().startswith("corr") else f"Corrigendum {published(rid)}",
            "date": published(rid), "effective": doc_eff, "targets": sorted(keys),
            "applied": after[0] - before[0], "recorded": after[1] - before[1], "failed": after[2] - before[2],
            "unusedRows": unused, "file": pdf_path(rid).name,
        })

    aidc_entries = [shape(v) for v in tables["aidc"].versions()]
    for e in aidc_entries:
        e["kind"] = aidc_kind(e)
    annexure_rows = []
    for v in tables["aidc-annexure"].versions():
        m = re.search(r"Notification No\.?\s*(\d+)\s*/\s*(\d{2,4})", v["text"], re.I)
        annexure_rows.append({"serial": v["serial"], "notification": label(m.group(1), m.group(2)) if m else None,
                              "text": v["text"], "validFrom": v["validFrom"],
                              **({"validUntil": v["validUntil"]} if v["validUntil"] else {}),
                              "amendedBy": v["amendedBy"], "source": v["source"]})
    sws_entries = [shape(v, 0.0) for v in tables["sws"].versions()]
    hc_entries = [shape(v, 0.0) for v in tables["healthCess"].versions()]

    igst_g, igst_notes = igst_g_entries()
    igst_c, cess_c, c_stats = customs_c_entries()
    standalone = aidc_standalone()

    sources = sorted({AIDC_BASE, SWS_BASE, HC_BASE, IGST_G_BASE, *IGST_G_CORRIGENDA, *AIDC_STANDALONE,
                      *[rid for rid, _ in AMENDMENTS]}, key=lambda r: (published(r), r))
    levies = {
        "_generated": "do not edit by hand — python3 packages/core/scripts/build-item-levies.py",
        "historyFrom": HISTORY_FROM,
        "generatedFrom": [{"id": r, "notification": INDEX[r]["notificationNo"].strip(), "date": published(r),
                           "file": pdf_path(r).name} for r in sources]
                         + [{"id": None, "notification": "45/2025-Customs",
                             "file": "packages/core/masters-source/bcd-exemption-notification-45-2025.pdf (+ amendments, via build-masters.py)"}],
        "aidc": {
            "notification": "011/2021",
            "levy": {"basis": "Agriculture Infrastructure and Development Cess, section 124 of the Finance Act, 2021; "
                              "11/2021-Customs prescribes the effective rate", "notificationOrAct": "Finance Act, 2021 s.124"},
            "entries": aidc_entries,
            "annexure": annexure_rows,
            "otherExemptions": standalone,
        },
        "swsExemption": {
            "notification": "011/2018",
            "levy": {"basis": "Social Welfare Surcharge at 10% of the aggregate duties of customs", "notificationOrAct": "Finance Act, 2018 s.110"},
            "notificationProviso": {"text": tables["sws"].proviso, "amendedBy": tables["sws"].proviso_amended_by},
            "entries": sws_entries,
        },
        "healthCess": {
            "levy": {"basis": "Health Cess on medical devices of headings 9018 to 9022 (rate is set by the Act's Schedule; "
                              "not present in the corpus and not stated here)",
                     "notificationOrAct": "Finance Act, 2020 s.141"},
            "exemptionNotification": "008/2020",
            "notificationProviso": {"text": tables["healthCess"].proviso, "amendedBy": tables["healthCess"].proviso_amended_by},
            "entries": hc_entries,
        },
        "igstExemptions": igst_c + igst_g,
        "compCessExemptions": cess_c,
    }
    (OUT / "levies.json").write_text(json.dumps(levies, indent=1, ensure_ascii=False) + "\n")

    extra = discover() if "--discover" in sys.argv else None
    write_report(levies, ledger, applier, igst_notes, c_stats, extra)
    print(f"  AIDC {len(aidc_entries)} versions, annexure {len(annexure_rows)}, SWS {len(sws_entries)}, "
          f"Health Cess {len(hc_entries)}, IGST C {len(igst_c)} / G {len(igst_g)}, comp cess C {len(cess_c)}")
    print(f"  amendments: {len(applier.applied)} applied, {len(applier.recorded)} recorded, {len(applier.failed)} failed")


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #

# (cth, BE/print date, BCD exemption claimed on that line, filed AIDC serial, evidence)
GOLDEN_AIDC = [
    ("34039900", "2026-07-02", None, "17", "ex_job1 checklist I-13841"),
    ("17021110", "2026-08-04", "096/2008", "17", "ex_job2 checklist I-13811 (SAPTA/LDC 96/2008 claimed)"),
    ("12074090", "2026-06-22", None, "17", "ex_job3 checklist I-13592 (re-import)"),
    ("39046100", "2026-07-27", None, "17", "ex_job4 checklist I-14075 (re-import)"),
    ("85322990", "2026-06-09", "024/2005", "17", "ex_job5 checklist I-30239 (BCD 024/2005 S.No. 20)"),
    ("85411000", "2026-06-09", "024/2005", "17", "ex_job5 checklist I-30239 (BCD 024/2005 S.No. 23)"),
    ("29171400", "2026-08-24", None, "17", "liv_job1 JobData I-10793 ITEMS"),
    ("39021000", "2026-08-08", "069/2011", "19", "ex_job6 checklist I-13844 (BCD 069/2011 S.No. 295, India-Japan CEPA)"),
]


def sws_cross_check(entries: list[dict]) -> list[str]:
    """Compare against the BDP 2026-27 tariff book, an independent source.

    The book prints SWS per line; a line with effective BCD > 0 and SWS 0 is
    surcharge-exempt. Only checksum-`verified` rows are used.
    """
    path = ROOT / "src" / "masters" / "generated" / "tariff-book" / "schedule.json"
    if not path.exists():
        return []
    rows = [r for r in json.loads(path.read_text())["rows"]
            if r.get("confidence") == "verified" and (r.get("effectiveBcdRate") or 0) > 0 and len(r.get("cth", "")) == 8]
    L = ["### Cross-check: SWS exemption vs the BDP 2026-27 tariff book", "",
         "Lines the book prints with effective BCD > 0 (checksum-verified rows only). `exempt in book` = SWS printed 0. "
         "`unconditional` = a live 11/2018 entry with `allGoods` matches the CTH (not via a qualified code); "
         "`conditional` = only a description-limited or qualified entry matches.", "",
         "| As at | book rows | exempt in book | agree | book exempt, master conditional | book exempt, master silent | book levies, master unconditional |",
         "|---|---:|---:|---:|---:|---:|---:|"]
    examples = {}
    for date in ("2026-04-01", "2026-05-13"):
        live = [e for e in entries if in_force(e, date) and e["include"]]
        counts = Counter()
        for r in rows:
            cth = r["cth"]
            hits = [e for e in live if prefix_match(e, cth)]
            uncond = [e for e in hits if e["allGoods"] and not any(cth.startswith(q["code"]) for q in e.get("qualifiedCodes", []))]
            book_exempt = (r.get("swsRate") or 0) == 0
            counts["exempt"] += book_exempt
            if book_exempt and uncond or (not book_exempt and not uncond):
                counts["agree"] += 1
            elif book_exempt and hits:
                counts["conditional"] += 1
            elif book_exempt:
                counts["silent"] += 1
                examples.setdefault((date, "silent"), []).append(cth)
            else:
                counts["over"] += 1
                examples.setdefault((date, "over"), []).append(f"{cth} (S.No. {uncond[0]['serial']})")
        L.append(f"| {date} | {len(rows)} | {counts['exempt']} | {counts['agree']} | {counts['conditional']} | {counts['silent']} | {counts['over']} |")
    L.append("")
    for (date, kind), items in sorted(examples.items()):
        what = "book exempt, master silent" if kind == "silent" else "book levies SWS, master says exempt"
        L.append(f"- {date} {what} ({len(items)}): {', '.join(items[:15])}{' …' if len(items) > 15 else ''}")
    L.append("")
    return L


def write_report(levies, ledger, applier, igst_notes, c_stats, discovered):
    aidc = levies["aidc"]
    today = "2026-09-13"
    live = lambda rows: [r for r in rows if in_force(r, today)]
    L = []
    L.append("# Item levies master — build report")
    L.append("")
    L.append("Generated by `packages/core/scripts/build-item-levies.py`; do not edit by hand. "
             f"Entry counts include every version still in force on or after {HISTORY_FROM}; "
             f"\"live\" = in force on {today}.")
    L.append("")
    L.append("## Counts")
    L.append("")
    L.append("| Section | Notification | Versions | Live |")
    L.append("|---|---|---:|---:|")
    L.append(f"| AIDC effective-rate table | 011/2021 | {len(aidc['entries'])} | {len(live(aidc['entries']))} |")
    L.append(f"| AIDC ANNEXURE (BCD-exemption notifications for S.No. 19) | 011/2021 | {len(aidc['annexure'])} | {len(live(aidc['annexure']))} |")
    L.append(f"| AIDC stand-alone exemptions | 35/2025, 13/2026, 19/2026 | {len(aidc['otherExemptions'])} | {len(live(aidc['otherExemptions']))} |")
    L.append(f"| SWS exemption | 011/2018 | {len(levies['swsExemption']['entries'])} | {len(live(levies['swsExemption']['entries']))} |")
    L.append(f"| Health Cess exemption | 008/2020 | {len(levies['healthCess']['entries'])} | {len(live(levies['healthCess']['entries']))} |")
    ig = levies["igstExemptions"]
    L.append(f"| IGST exemptions, type C | 045/2025 | {sum(1 for e in ig if e['type'] == 'C')} | — |")
    L.append(f"| IGST exemptions, type G | 010/2025-IT(R) | {sum(1 for e in ig if e['type'] == 'G')} | — |")
    L.append(f"| Comp. cess exemptions, type C | 045/2025 | {len(levies['compCessExemptions'])} | — |")
    L.append("| Comp. cess exemptions, type G | — | 0 | — |")
    L.append("")
    L.append("Notification numbers are written `NNN/YYYY` as Logi-Sys writes them. **Health Cess is 008/2020, not "
             "006/2020**: corpus 06/2020-Customs (id 1000234) is an amendment of 24/2005 about copper; 8/2020-Customs "
             "(id 1000232) is the Health Cess exemption and is what 44/2025 amends.")
    L.append("")

    L.append("## AIDC serial — golden validation")
    L.append("")
    L.append("`predicted` = the rule this master supports: 19 when the line's BCD exemption is claimed under a "
             "notification in the live ANNEXURE, else 17 (residual \"all goods other than S.Nos. 1 to 16G\"). "
             "`CTH-only` ignores the BCD claim. `specific` lists CTH-matching specific serials (none should match).")
    L.append("")
    L.append("`pre-06/2025` applies the same rule with the ANNEXURE as it stood on 2025-02-01, before 06/2025 added "
             "S.Nos. 12-178.")
    L.append("")
    L.append("| CTH | BE date | BCD claimed under | specific | CTH-only | predicted | pre-06/2025 | filed | match (predicted / pre-06/2025) | evidence |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for cth, date, claim, filed, evidence in GOLDEN_AIDC:
        predicted, specific = aidc_serial(aidc, cth, date, claim)
        cth_only, _ = aidc_serial(aidc, cth, date, None)
        legacy, _ = aidc_serial(aidc, cth, date, claim, annexure_as_at="2025-02-01")
        ok = f"{'yes' if predicted == filed else '**no**'} / {'yes' if legacy == filed else '**no**'}"
        L.append(f"| {cth} | {date} | {claim or '—'} | {', '.join(specific) or '—'} | {cth_only} | {predicted} | {legacy} | {filed} | {ok} | {evidence} |")
    L.append("")
    ann = {a["notification"]: a for a in aidc["annexure"] if in_force(a, today)}
    s19 = next(e for e in aidc["entries"] if e["serial"] == "19" and in_force(e, today))
    L.append("**Why 17 vs 19 is not a CTH question.** 11/2021 has no row for chapters 12, 17, 29, 34, 39 or 85. S.No. 17 "
             "is the residual, and S.No. 19 reads: *" + s19["description"] + "* — i.e. it is chosen by the BCD "
             "exemption claimed on the line, not by the CTH. Polypropylene 39021000 in ex_job6 claimed BCD under "
             f"069/2011 (India-Japan CEPA), which is ANNEXURE S.No. {ann['069/2011']['serial'] if '069/2011' in ann else '?'}; "
             "the same CTH without an FTA claim would be 17. A CTH-only lookup therefore cannot reproduce 19; the "
             "exporter must pass the BCD exemption notification in.")
    L.append("")
    if "024/2005" in ann:
        a = ann["024/2005"]
        L.append(f"**Open discrepancy (ask Sandesh).** 024/2005-Customs is ANNEXURE S.No. {a['serial']}, inserted by "
                 f"{', '.join(a['amendedBy']) or a['source']} and not among the serials 44/2025 or 16/2026 omit. Read "
                 "literally, an ex_job5 line exempt under 024/2005 is S.No. 19, but Logi-Sys filed 17 on all of them. "
                 "Both are Nil, so no duty turns on it; Logi-Sys's own master may pre-date 06/2025's annexure list. "
                 "The `pre-06/2025` column — the ANNEXURE as it stood before 06/2025 — reproduces all eight filed "
                 "serials, which supports that. Until confirmed, reproduce the filed behaviour: evaluate S.No. 19 "
                 "against the ANNEXURE as at 2025-02-01 (S.Nos. 1-11: 74/2005, 10/2008, 152/2009, 46/2011, 53/2011, "
                 "69/2011, 52/2003, 3/57, 99/2011, 56/2000, 57/2000).")
        L.append("")

    L.extend(sws_cross_check(levies["swsExemption"]["entries"]))

    L.append("## Amendments")
    L.append("")
    L.append("Applied in date order at each amendment's effective date (per-clause \"with effect from\" wins). "
             "`applied` = table changes made; `recorded` = understood but outside the table (preamble wording, "
             "provisos); `failed` = could not be applied, entry marked `staleBy`.")
    L.append("")
    L.append("| Notification | Published | In force | Targets | applied | recorded | failed | unused table rows |")
    L.append("|---|---|---|---|---:|---:|---:|---|")
    for r in ledger:
        L.append(f"| {r['notification']} (id {r['id']}) | {r['date']} | {r['effective']} | {', '.join(r['targets'])} | "
                 f"{r['applied']} | {r['recorded']} | {r['failed']} | {(', '.join(r['unusedRows']) if len(r['unusedRows']) <= 6 else str(len(r['unusedRows'])) + ' rows') or '—'} |")
    L.append("")
    L.append("Unused table rows belong to other notifications amended by the same document (e.g. 24/2005 rows in "
             "15/2022) unless listed under failures.")
    L.append("")
    L.append("### Could not be applied")
    L.append("")
    if applier.failed:
        for f in applier.failed:
            known = next((v for k, v in SOURCE_INCONSISTENCIES.items() if k in f["why"]), None)
            L.append(f"- {f['note']} S.No. {f['serial']}: {f['why']}. Source: `…{f['raw'][-140:]}`"
                     + (f" **Source inconsistency:** {known}." if known else ""))
    else:
        L.append("- None.")
    L.append("")
    L.append("### Recorded, not modelled")
    L.append("")
    for r in applier.recorded:
        L.append(f"- {r['note']}: {r['what']} — `…{r['raw'][-120:]}`")
    L.append("")
    L.append("### Not amendments / not parsed")
    L.append("")
    for rid, why in NOT_AMENDMENTS.items():
        L.append(f"- id {rid}: {why}.")
    L.append("- Stand-alone AIDC exemptions not parsed (older, time-bound): 48/2021, 49/2021, 21/2022, 30/2022, "
             "37/2023, 64/2023. Stand-alone SWS notifications not parsed: 12/2018 (SWS above 3%), 13/2018 (SWS on "
             "IGST/cess), 14/2021 was an amendment; 36/2024 (critical minerals, BCD+SWS).")
    L.append("- 28/2021-Customs (COVID oxygen, Health Cess) expired 31.07.2021.")
    L.append("- IGST type C: only 45/2025 is per-CTH. Claim-based customs notifications that also exempt IGST "
             "(e.g. 64/2017 SEZ, 52/2003 EOU, advance authorisation 21/2023…) are not modelled.")
    L.append("- Comp. cess type G: no Compensation Cess (Rate) notification in the corpus exempts imports of goods "
             "(04/2017 intra-State second-hand, 1/2019 airport departure retail, 01/2024 URC supplies, 01/2025 "
             "merchant export at 0.1%). The only per-CTH comp. cess exemption is 45/2025 Table III (type C).")
    for n in igst_notes:
        L.append(f"- 10/2025-IT(R) {n}.")
    L.append(f"- 45/2025 (via build-masters.py): {c_stats['bcdEntries']} entries after amendments; "
             f"{c_stats['unappliedInstructions']} amendment instructions there are unapplied and their entries carry `staleBy`.")
    if discovered is not None:
        L.append("")
        L.append("### Full-text discovery scan")
        L.append("")
        L.append("- " + ("; ".join(discovered) if discovered else "No unregistered Tariff notification cites 11/2021, 11/2018 or 8/2020."))
    L.append("")
    L.append("## Caveats")
    L.append("")
    L.append("- SWS and Health Cess have no code column. `include`/`exclude` are pulled from the description and "
             "`conditions`/`refs` keep the qualifiers (\"other than goods covered under S. No. 67 of TABLE I of "
             "045/2025\"). Treat an entry with conditions as a candidate, not an automatic exemption.")
    L.append("- `refs[].relation` (`only`/`except`) is a heuristic on the surrounding \"other than\".")
    L.append("- AIDC `kind`: `specific` (CTH row), `residual` (17), `claim-based` (17A, 15L, 18, 19, 20 — apply only "
             "when the named BCD exemption is claimed).")
    L.append("- Health Cess levy rate is not stated: the Finance Act 2020 schedule is not in the corpus.")
    (OUT / "levies.REPORT.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
