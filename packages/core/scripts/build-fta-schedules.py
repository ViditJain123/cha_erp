#!/usr/bin/env python3
"""
Builds the per-agreement preferential-duty schedules in
src/masters/generated/items/fta-schedules/<KEY>.json from the CBIC notification
PDFs in data/customs-corpus/notifications/.

    pip install pymupdf
    python3 packages/core/scripts/build-fta-schedules.py [--only KEY ...]

The agreement master itself (fta-agreements.json) is hand-verified and not
generated; this script only produces the schedules it points at, plus a build
log (fta-schedules/_build.json) that fta.REPORT.md is written from.

## What a schedule is

A preferential-duty notification is a table: S.No. | tariff spec | description
| rate(s). The serial is what goes on the Bill of Entry (Basic_NotnSrNo or
SAPTA_NotnSrNo), so the serial must be the one printed in the *current* text of
the notification, not the one in the 2011 original.

## Why the current text is rebuilt, not read from the compilation

CBIC's Customs Tariff Vol. II prints "as amended" versions of most of these
notifications and it is tempting to parse those. They are not reliable enough to
file from: G.E. 121 (DFTP, 96/2008) as on 30.06.2024 still says clause (i)
exempts duty "in excess of 20 per cent. of the applied rate" — the words
56/2012-Customs replaced with "whole of the duty" in 2012. So every schedule is
rebuilt from primary text:

  1. a *base* table — the principal notification, or the most recent amending
     notification that substituted the whole Table (tranche notifications do
     this every year);
  2. every later notification that cites the concession notification, found by
     full-text search of the corpus, read instruction by instruction.

Instructions of a known form (substitute an entry in a column, insert a serial,
substitute a serial, omit a serial, substitute a whole table) are applied and
asserted: the serial they name must exist. Anything else is recorded on the
build log as unapplied, with the text, so a person reads it — the schedule never
silently carries an amendment it did not understand.

## Tariff specs

Column (2) is parsed into digit-only prefixes, like build-masters.py does.
Ranges ("390110 to 390320") are expanded against the tariff item list in
data/customs-corpus/index/tariff-first-schedule.json and compressed back into
the shortest set of prefixes, so a matcher only needs a prefix test. The raw
spec text is kept on every row.
"""

from __future__ import annotations

import argparse
import bisect
import json
import re
import sys
from datetime import date
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF is required: pip install pymupdf")

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
CORPUS = REPO / "data" / "customs-corpus"
NOTIFICATIONS = CORPUS / "notifications"
INDEX = CORPUS / "index" / "cbic-notifications.json"
TARIFF = CORPUS / "index" / "tariff-first-schedule.json"
OUT = ROOT / "src" / "masters" / "generated" / "items" / "fta-schedules"

AS_OF = "2026-09-13"

# --------------------------------------------------------------------------- #
# Configuration — one block per concession notification.
#
#   base       the PDF whose table is taken as the starting text
#   columns    logical column names per table label ("" = the only table)
#   rateKind   "effective"  column holds the preferential BCD rate (BASIC slot)
#              "reduction"  column holds the % of applied duty forgone (SAPTA slot)
#              "whole"      no rate column; the clause exempts the whole duty
#   fixed      rows that are clauses of the notification, not table rows
# --------------------------------------------------------------------------- #

STD4 = ["serial", "spec", "description", "rate"]

CONFIG: list[dict] = [
    # ---- India-Japan CEPA ------------------------------------------------- #
    {
        "key": "IN-JP-CEPA",
        "notification": "069/2011",
        "cites": ("69", "2011"),
        "date": "2011-07-29",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__20_2021-Cus__1000036.pdf", "20/2021-Customs", "2021-03-30", "2021-04-01"),
        "columns": {"": STD4},
    },
    # ---- India-Korea CEPA ------------------------------------------------- #
    {
        "key": "IN-KR-CEPA",
        "notification": "152/2009",
        "cites": ("152", "2009"),
        "date": "2009-12-31",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__66_2016-Cus__1002590.pdf", "66/2016-Customs", "2016-12-31", "2017-01-01"),
        "columns": {"": STD4},
    },
    {
        "key": "IN-KR-CEPA",
        "notification": "151/2009",
        "cites": ("151", "2009"),
        "date": "2009-12-31",
        "slot": "BASIC",
        "rateKind": "whole",
        "base": ("Tariff__122_2011_-_Customs__1002888.pdf", "122/2011-Customs", "2011-12-30", "2012-01-01"),
        "columns": {"": ["serial", "spec", "description"]},
    },
    # ---- ASEAN-India FTA -------------------------------------------------- #
    {
        "key": "AIFTA",
        "notification": "046/2011",
        "cites": ("46", "2011"),
        "date": "2011-06-01",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__41_2019-Cus__1000241.pdf", "41/2019-Customs", "2019-12-31", "2020-01-01"),
        # col (4): countries in APPENDIX I; col (5): countries in APPENDIX II.
        "columns": {"": ["serial", "spec", "description", "rate", "rateAppendixII"]},
    },
    # ---- India-Singapore CECA --------------------------------------------- #
    {
        "key": "IN-SG-CECA",
        "notification": "010/2008",
        "cites": ("10", "2008"),
        "date": "2008-01-15",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__53_2015-Cus__1002664.pdf", "53/2015-Customs", "2015-11-23", "2015-11-23"),
        "columns": {"": STD4},
    },
    {
        "key": "IN-SG-CECA",
        "notification": "073/2005",
        "cites": ("73", "2005"),
        "date": "2005-07-22",
        "slot": "BASIC",
        "rateKind": "whole",
        "base": ("Tariff__33_2012-Cus__1002848.pdf", "33/2012-Customs", "2012-05-14", "2012-05-14"),
        "columns": {"": ["serial", "spec", "description"]},
    },
    {
        "key": "IN-SG-CECA",
        "notification": "074/2005",
        "cites": ("74", "2005"),
        "date": "2005-07-22",
        # "in excess of 90 per cent. of the applied rate": a 10% reduction.
        "slot": "SAPTA",
        "rateKind": "reduction-fixed",
        "fixedRate": 10.0,
        "fixedRateText": "duty in excess of 90% of the applied rate exempted (10% of applied rate forgone)",
        "base": ("Tariff__34_2012-Cus__1002847.pdf", "34/2012-Customs", "2012-05-14", "2012-05-14"),
        "columns": {"": ["serial", "spec", "description"]},
    },
    {
        "key": "IN-SG-CECA",
        "notification": "075/2005",
        "cites": ("75", "2005"),
        "date": "2005-07-22",
        "slot": "SAPTA",
        "rateKind": "reduction-fixed",
        "fixedRate": 5.0,
        "fixedRateText": "duty in excess of 95% of the applied rate exempted (5% of applied rate forgone)",
        "base": ("Tariff__35_2012-Cus__1002846.pdf", "35/2012-Customs", "2012-05-14", "2012-05-14"),
        "columns": {"": ["serial", "spec", "description"]},
    },
    # ---- India-Malaysia CECA ---------------------------------------------- #
    {
        "key": "IN-MY-CECA",
        "notification": "053/2011",
        "cites": ("53", "2011"),
        "date": "2011-07-01",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__65_2016-Cus__1002591.pdf", "65/2016-Customs", "2016-12-31", "2017-01-01"),
        "columns": {"": STD4},
    },
    # ---- India-Thailand Early Harvest Scheme ------------------------------ #
    {
        "key": "IN-TH-EHS",
        "notification": "085/2004",
        "cites": ("85", "2004"),
        "date": "2004-08-31",
        "slot": "BASIC",
        # 86/2006: whole duty from 1.9.2006, and column (4) omitted.
        "rateKind": "whole",
        "handledInConfig": {
            "79/2005": "preamble: 50% -> 25% of the column (4) rate (superseded by 86/2006)",
            "86/2006": "preamble: whole of the duty from 2006-09-01; column (4) omitted — rows carry rate 0",
        },
        "base": ("Tariff__85_2004-Customs__1003831.pdf", "85/2004-Customs", "2004-08-31", "2006-09-01"),
        "columns": {"": ["serial", "spec", "description", "omittedRate"]},
    },
    # ---- India-UAE CEPA --------------------------------------------------- #
    {
        "key": "IN-AE-CEPA",
        "notification": "022/2022",
        "cites": ("22", "2022"),
        "date": "2022-04-30",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__09_2026-Customs__1010614.pdf", "09/2026-Customs", "2026-03-31", "2026-04-01"),
        "columns": {
            "I": STD4,
            "II": ["serial", "spec", "description", "rate", "aidcRate"],
            "III": ["serial", "spec", "description", "trq", "rate", "aidcRate", "condition"],
        },
    },
    # ---- India-Australia ECTA --------------------------------------------- #
    {
        "key": "IN-AU-ECTA",
        "notification": "062/2022",
        "cites": ("62", "2022"),
        "date": "2022-12-26",
        "slot": "BASIC",
        "rateKind": "effective",
        # 50/2025 substitutes TABLE I and TABLE II; TABLES III and IV are
        # still the 62/2022 text (amendments to them are applied on top).
        "base": ("Tariff__50_2025-Customs__1010528.pdf", "50/2025-Customs", "2025-12-30", "2026-01-01"),
        "extraTables": [
            {"file": "Tariff__62_2022-Customs__1009583.pdf", "notification": "62/2022-Customs", "date": "2022-12-26",
             "validFrom": "2022-12-29", "tables": ["III", "IV"]},
        ],
        "columns": {
            "I": STD4,
            "II": ["serial", "spec", "description", "rate", "aidcRate"],
            # Table III is a %-of-applied-rate TRQ table (column 4 is a reduction).
            "III": ["serial", "spec", "description", "reduction", "trq", "condition"],
            "IV": ["serial", "spec", "description", "trq", "rate", "aidcRate", "condition"],
        },
        "tableSlot": {"III": "SAPTA"},
    },
    # ---- India-Mauritius CECPA -------------------------------------------- #
    {
        "key": "IN-MU-CECPA",
        "notification": "025/2021",
        "cites": ("25", "2021"),
        "date": "2021-03-31",
        "slot": "BASIC",
        "rateKind": "effective",
        # 10/2026 substitutes TABLE 1; 22/2025 last substituted TABLE 2;
        # TABLES 3 and 4 are the 25/2021 text.
        "base": ("Tariff__10_2026-Customs__1010615.pdf", "10/2026-Customs", "2026-03-31", "2026-04-01"),
        "extraTables": [
            {"file": "Tariff__22_2025-Customs__1010346.pdf", "notification": "22/2025-Customs", "date": "2025-03-28",
             "validFrom": "2025-04-01", "tables": ["II"]},
            {"file": "Tariff__25_2021-Cus__1000031.pdf", "notification": "25/2021-Customs", "date": "2021-03-31",
             "validFrom": "2021-04-01", "tables": ["III"]},
            {"file": "Tariff__51_2021-Cus__1000003.pdf", "notification": "51/2021-Customs", "date": "2021-10-22",
             "validFrom": "2021-10-22", "tables": ["IV"]},
        ],
        "columns": {
            "I": STD4,
            "II": ["serial", "spec", "description", "reduction"],
            "III": ["serial", "spec", "condition"],
            "IV": ["serial", "spec", "description", "trq", "rate", "aidcRate", "condition"],
        },
        "tableSlot": {"II": "SAPTA"},
        "tableFixedRate": {"III": ("whole of the duty of customs, within the tariff rate quota (conditions in the Annexure)", 0.0, "preferential BCD rate %")},
    },
    # ---- India-Oman CEPA -------------------------------------------------- #
    {
        "key": "IN-OM-CEPA",
        "notification": "020/2026",
        "cites": ("20", "2026"),
        "date": "2026-05-31",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__20_2026-Customs__1010664.pdf", "20/2026-Customs", "2026-05-31", "2026-06-01"),
        "columns": {
            "I": STD4,
            "II": ["serial", "spec", "description", "rate", "aidcRate"],
            "III": ["serial", "spec", "description", "trq", "rate", "aidcRate"],
        },
    },
    # ---- India-UK CETA ---------------------------------------------------- #
    {
        "key": "IN-UK-CETA",
        "notification": "029/2026",
        "cites": ("29", "2026"),
        "date": "2026-07-14",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__29_2026-Customs__1010722.pdf", "29/2026-Customs", "2026-07-14", "2026-07-15"),
        "columns": {
            "I": ["serial", "spec", "description", "rate", "aidcRate", "healthCessRate"],
            "II": ["serial", "spec", "description", "rate", "aidcRate"],
            "III": ["serial", "spec", "description", "rate", "aidcRate", "trq", "outOfQuotaRate", "outOfQuotaAidcRate"],
        },
    },
    # ---- India-EFTA TEPA -------------------------------------------------- #
    {
        "key": "IN-EFTA-TEPA-CH",
        "notification": "041/2025",
        "partner": "CH",
        "cites": ("41", "2025"),
        "date": "2025-09-30",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__51_2025-Customs__1010529.pdf", "51/2025-Customs", "2025-12-30", "2026-01-01"),
        "columns": {
            "I": ["serial", "spec", "description", "rate", "aidcRate", "healthCessRate"],
            "II": ["serial", "spec", "description", "rate", "aidcRate"],
        },
    },
    {
        "key": "IN-EFTA-TEPA-NO",
        "notification": "042/2025",
        "partner": "NO",
        "cites": ("42", "2025"),
        "date": "2025-09-30",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__52_2025-Customs__1010530.pdf", "52/2025-Customs", "2025-12-30", "2026-01-01"),
        "columns": {"": ["serial", "spec", "description", "rate", "aidcRate", "healthCessRate"]},
    },
    {
        "key": "IN-EFTA-TEPA-IS",
        "notification": "043/2025",
        "partner": "IS",
        "cites": ("43", "2025"),
        "date": "2025-09-30",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__53_2025-Customs__1010531.pdf", "53/2025-Customs", "2025-12-30", "2026-01-01"),
        "columns": {"": ["serial", "spec", "description", "rate", "aidcRate", "healthCessRate"]},
    },
    # ---- SAFTA ------------------------------------------------------------ #
    {
        "key": "SAFTA",
        "notification": "068/2012",
        "cites": ("68", "2012"),
        "date": "2012-12-31",
        "slot": "BASIC",
        "rateKind": "effective",
        "base": ("Tariff__68_2012-Cus__1002813.pdf", "68/2012-Customs", "2012-12-31", "2013-01-01"),
        "columns": {"I": STD4, "II": STD4, "III": ["serial", "spec", "description"]},
        # Paragraph 2: nothing in the notification applies to TABLE III goods.
        "tableRole": {"III": "excluded"},
    },
    {
        "key": "SAFTA",
        "notification": "099/2011",
        "cites": ("99", "2011"),
        "date": "2011-11-09",
        "slot": "BASIC",
        "rateKind": "whole",
        "base": ("Tariff__99_2011_-_Customs__1002911.pdf", "99/2011-Customs", "2011-11-09", "2011-11-09"),
        "columns": {"ANNEXURE": ["serial", "spec", "description"]},
        "fixed": [
            {
                "serial": None,
                "table": "opening paragraph",
                "specText": "all goods other than those mentioned in the ANNEXURE",
                "allGoods": True,
                "excludeTable": "ANNEXURE",
                "description": "All goods other than those in the ANNEXURE, imported from a country in the APPENDIX (Bangladesh, Bhutan, Maldives, Nepal, Afghanistan)",
                "rateText": "whole of the duty of customs leviable under the First Schedule",
                "rate": 0.0,
            }
        ],
        "tableRole": {"ANNEXURE": "excluded"},
    },
    # ---- APTA ------------------------------------------------------------- #
    {
        "key": "APTA",
        "notification": "050/2018",
        "cites": ("50", "2018"),
        "date": "2018-06-30",
        "slot": "SAPTA",
        "rateKind": "reduction",
        "base": ("Tariff__50_2018-Cus__1000366.pdf", "50/2018-Customs", "2018-06-30", "2018-07-01"),
        # Part A: countries in APPENDIX I (Bangladesh, China, Korea, Sri Lanka);
        # Part B: countries in APPENDIX II (Bangladesh, Lao PDR).
        "columns": {"PART A": STD4, "PART B": STD4},
    },
    # ---- India-Sri Lanka FTA ---------------------------------------------- #
    {
        # 26/2000 is a pre-HS-2007 list notification (LIST 1..5 inside one
        # unruled table, plus a negative-list ANNEXURE) amended seventeen times
        # in prose. Its primary text cannot be rebuilt by instruction, so the
        # schedule is read from CBIC's compilation (G.E. 78, as on 30.06.2024,
        # "as amended by ... 36/23") and every row says so.
        "key": "ISFTA",
        "notification": "026/2000",
        "cites": ("26", "2000"),
        "date": "2000-03-01",
        "slot": "SAPTA",
        "rateKind": "compilation-isfta",
        "compilation": "Tariff(ason30.06.2024)__CUSTOMS_TARIFF_VOL-II__G.E.-78.pdf",
        "base": ("Tariff__26_2000-Customs__1004484.pdf", "26/2000-Customs", "2000-03-01", "2000-03-01"),
        "columns": {},
    },
    # ---- DFTP for LDCs ---------------------------------------------------- #
    {
        "key": "DFTP",
        "notification": "096/2008",
        "cites": ("96", "2008"),
        "date": "2008-08-13",
        "slot": "SAPTA",
        "rateKind": "reduction",
        "base": ("Tariff__08_2014-Cus__1002748.pdf", "08/2014-Customs", "2014-04-01", "2014-04-01"),
        # 08/2014 prints "in Appendix I, for the Table, the following Table":
        # the first table's own heading is a bare "Table".
        "labelAlias": {"": "APPENDIX I"},
        "columns": {"APPENDIX I": STD4, "APPENDIX II": ["serial", "spec", "description"]},
        "fixed": [
            {
                "serial": "(i)",
                "table": "opening paragraph",
                "specText": "goods falling under the First Schedule, other than those specified in Appendix I and Appendix II",
                "allGoods": True,
                "excludeTable": ["APPENDIX I", "APPENDIX II"],
                "description": "All goods other than those in Appendix I and Appendix II",
                "rateText": "whole of the duty of customs as specified in the First Schedule and whole of AIDC (56/2012-Customs; 16/2021-Customs)",
                "rate": 100.0,
                "amendedBy": ["56/2012-Customs (clause (i): whole of duty, from 2012-10-01)", "16/2021-Customs (clause (i): and whole of AIDC)"],
            }
        ],
        "tableRole": {"APPENDIX II": "excluded"},
        "serialPrefix": {"APPENDIX I": "(ii)"},
    },
    # ---- India-Chile PTA -------------------------------------------------- #
    {
        "key": "IN-CL-PTA",
        "notification": "101/2007",
        "cites": ("101", "2007"),
        "date": "2007-09-11",
        "slot": "SAPTA",
        "rateKind": "reduction",
        "base": ("Tariff__19_2017-Cus__1002569.pdf", "19/2017-Customs", "2017-05-16", "2017-05-16"),
        "columns": {"": STD4},
    },
    # ---- India-MERCOSUR PTA ----------------------------------------------- #
    {
        "key": "IN-MERCOSUR-PTA",
        "notification": "057/2009",
        "cites": ("57", "2009"),
        "date": "2009-05-30",
        "slot": "SAPTA",
        "rateKind": "reduction",
        "base": ("Tariff__57_2009_-_Customs__1003242.pdf", "57/2009-Customs", "2009-05-30", "2009-06-01"),
        "columns": {"": STD4},
    },
    # ---- India-Afghanistan PTA -------------------------------------------- #
    {
        "key": "IN-AF-PTA",
        "notification": "076/2003",
        "cites": ("76", "2003"),
        "date": "2003-05-13",
        "slot": "SAPTA",
        "rateKind": "reduction",
        "base": ("Tariff__76_2003-Cus__1004004.pdf", "76/2003-Customs", "2003-05-13", "2003-05-13"),
        "columns": {"": STD4},
    },
    # ---- Nepal: Treaty of Trade ------------------------------------------- #
    {
        "key": "IN-NP-TREATY",
        "notification": "104/2010",
        "cites": ("104", "2010"),
        "date": "2010-10-01",
        "slot": "BASIC",
        "rateKind": "description",
        "base": ("Tariff__104_2010_-_Customs__1003042.pdf", "104/2010-Customs", "2010-10-01", "2010-10-01"),
        "columns": {},
    },
    # ---- Bhutan ----------------------------------------------------------- #
    {
        "key": "IN-BT-TRADE",
        "notification": "040/2017",
        "cites": ("40", "2017"),
        "date": "2017-06-30",
        "slot": "BASIC",
        "rateKind": "description",
        "base": ("Tariff__40_2017-Cus__1002548.pdf", "40/2017-Customs", "2017-06-30", "2017-07-01"),
        "columns": {},
    },
]

# Description-only notifications carry no tariff spec; their rows are
# transcribed here from the PDF (page 1) rather than parsed, because there is
# no column (2) to parse.
DESCRIPTION_ROWS = {
    "104/2010": [
        {
            "serial": "1",
            "description": "(i) Agricultural, horticultural, floricultural and forest produce; (ii) minerals which have not undergone any processing; (iii) rice, pulses, flour, atta, bran and husk; (iv) timber; (v) jaggery; (vi) livestock, poultry bird and fish; (vii) bees, bees-wax and honey; (viii) raw wool, goat hair, bristles and bones used for bone-meal; (ix) milk, home-made products of milk and eggs; (x) ghani-produced oil and oil-cakes; (xi) herbs, Ayurvedic and herbal medicines including essential oils and extracts; (xii) articles produced by village artisans mainly used in villages; (xiii) akra; (xiv) yak tail; (xv) stone aggregate, boulder, sand and gravel",
            "conditions": ["1"],
        },
        {
            "serial": "2",
            "description": "All manufactured goods other than (i) alcoholic liquors or beverages and their concentrates except industrial spirits; (ii) perfumes and cosmetics with non-Nepalese or non-Indian brand names; (iii) cigarettes and tobacco; (iv) vegetable fats (Vanaspati); (v) acrylic yarn; (vi) copper products of Chapter 74 and heading 8544; (vii) zinc oxide",
            "conditions": ["2"],
        },
        {
            "serial": "3",
            "description": "(i) Vegetable fats (Vanaspati); (ii) acrylic yarn; (iii) copper products of Chapter 74 and heading 8544; (iv) zinc oxide",
            "conditions": ["2", "3"],
        },
    ],
    "040/2017": [
        {"serial": "1", "description": "Goods of Bhutanese or Indian origin imported from Bhutan into India.", "conditions": []},
    ],
}

# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #

PUNCTUATION = {"–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', " ": " ", "​": ""}


def prose(value: str | None) -> str:
    value = value or ""
    for bad, good in PUNCTUATION.items():
        value = value.replace(bad, good)
    return re.sub(r"\s+", " ", value).strip()


def column_bounds(table) -> list[tuple[float, float]]:
    layouts: dict[tuple, int] = {}
    for row in table.rows:
        cells = tuple((round(c[0], 1), round(c[2], 1)) for c in row.cells if c)
        if cells:
            layouts[cells] = layouts.get(cells, 0) + 1
    if not layouts:
        return []
    return list(max(layouts, key=lambda k: layouts[k]))


def logical_rows(table, expected: int | None = None, fallback: list | None = None) -> tuple[list[list[str]], list]:
    """One string per logical column, empty sliver columns dropped.

    A page holding only a few long, multi-line entries can make a spanning
    layout the most common one (UAE 09/2026 p249: three cells where the table
    has five). When that happens the previous page's column bounds — same
    table, same typesetting — are used instead.
    """
    bounds = column_bounds(table)
    if not bounds:
        return [], [], []
    if expected and fallback and len([b for b in bounds]) < expected <= len(fallback):
        bounds = fallback
    out = []
    for row, values in zip(table.rows, table.extract()):
        cells = [""] * len(bounds)
        for cell, value in zip(row.cells, values):
            value = prose(value)
            if not cell or not value:
                continue
            mid = (cell[0] + cell[2]) / 2
            index = next((i for i, (a, b) in enumerate(bounds) if a <= mid <= b), None)
            if index is None:
                index = min(range(len(bounds)), key=lambda i: abs((bounds[i][0] + bounds[i][1]) / 2 - mid))
            cells[index] = f"{cells[index]} {value}".strip()
        out.append(cells)
    keep = [i for i in range(len(bounds)) if any(r[i] for r in out)]
    if expected and len(keep) < expected <= len(bounds):
        # Dropping empty slivers would lose a real column that happens to be
        # blank on this page (a description column of one merged cell).
        keep = list(range(len(bounds)))
    ys = [row.bbox[1] if row.bbox else 0.0 for row in table.rows]
    return [[r[i] for i in keep] for r in out], bounds, ys


ROMAN = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V"}
HEADING = re.compile(
    r'^"?\s*(TABLE|Table|APPENDIX|Appendix|ANNEXURE|Annexure|SCHEDULE|Schedule|PART|Part)\s*[-:]?\s*([IVX]+|\d|[A-D])?\s*"?\s*$'
)


def label_of(kind: str, num: str | None) -> str:
    kind = kind.upper()
    num = ROMAN.get(num or "", num or "")
    if kind == "TABLE":
        return num or ""
    return f"{kind} {num}".strip()


def headings(page) -> list[tuple[float, str]]:
    found = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = prose("".join(span["text"] for span in line["spans"]))
            m = HEADING.match(text)
            if m:
                found.append((line["bbox"][1], label_of(m.group(1), m.group(2))))
    return sorted(found)


SERIAL = re.compile(r"^\(?(\d{1,5}(?:\s?[A-Z]{1,2})?)\s*[.)]?$")


def norm_serial(text: str) -> str | None:
    m = SERIAL.match(prose(text))
    return m.group(1).replace(" ", "") if m else None


# --------------------------------------------------------------------------- #
# Tariff specs
# --------------------------------------------------------------------------- #

TARIFF_BOOK = ROOT / "src" / "masters" / "generated" / "tariff-book" / "schedule.json"


def tariff_items() -> list[str]:
    """Every 8-digit tariff item either tariff source knows.

    The corpus index is the CBIC 2024 edition; the tariff book is the 2026-27
    edition. Ranges in a 2011 notification cover whatever items sit between
    their end-points today, so the union is the safer list to expand against.
    """
    items = {row["cth"] for row in json.loads(TARIFF.read_text())}
    if TARIFF_BOOK.exists():
        items |= {row["cth"] for row in json.loads(TARIFF_BOOK.read_text())["rows"]}
    return sorted(i for i in items if re.fullmatch(r"\d{8}", i))


TARIFF_ITEMS: list[str] = tariff_items()
TARIFF_SET = set(TARIFF_ITEMS)
BY_PREFIX: dict[str, list[str]] = {}
for _item in TARIFF_ITEMS:
    for _n in (2, 4, 6):
        BY_PREFIX.setdefault(_item[:_n], []).append(_item)


def digits(token: str) -> str | None:
    token = re.sub(r"[\s.]", "", token)
    if not re.fullmatch(r"\d+", token):
        return None
    # The source spreadsheets these tables were typeset from dropped leading
    # zeros ("3023900" for 0302 39 00); a code is always an even number of digits.
    if len(token) in (1, 3, 5, 7):
        token = "0" + token
    return token


def with_prefix(prefix: str) -> list[str]:
    lo = bisect.bisect_left(TARIFF_ITEMS, prefix)
    hi = bisect.bisect_left(TARIFF_ITEMS, prefix + "~")
    return TARIFF_ITEMS[lo:hi]


def expand_range(low: str, high: str) -> list[str]:
    lo = bisect.bisect_left(TARIFF_ITEMS, low)
    hi = bisect.bisect_left(TARIFF_ITEMS, high + "~")
    return TARIFF_ITEMS[lo:hi]


def compress(items: set[str]) -> list[str]:
    """Shortest prefix set covering exactly `items` (as of the tariff index)."""
    out: list[str] = []
    done: set[str] = set()
    for item in sorted(items):
        if item in done:
            continue
        for n in (2, 4, 6, 8):
            members = BY_PREFIX.get(item[:n], [item]) if n < 8 else [item]
            if all(m in items for m in members):
                out.append(item[:n])
                done.update(members)
                break
    return out


CHAPTER = re.compile(r"(?i)\bchapters?\s*(\d{1,2})(?:\s*(?:to|-)\s*(?:chapter\s*)?(\d{1,2}))?")
EXCLUSION = re.compile(r"[\[(]\s*(?:other than|except|excluding)\s*(.*?)(?:[\])]|$)", re.I | re.S)


def parse_codes(text: str) -> tuple[set[str], list[str], list[dict], list[str]]:
    """(tariff items covered, literal prefixes, ranges, unread tokens)."""
    covered: set[str] = set()
    literal: list[str] = []
    ranges: list[dict] = []
    unread: list[str] = []

    def chapters(m: re.Match) -> str:
        low = int(m.group(1))
        high = int(m.group(2) or m.group(1))
        return ", ".join(f"{c:02d}" for c in range(low, high + 1))

    text = CHAPTER.sub(chapters, text)
    text = re.sub(r"(?i)(?<![a-z])(?:or|and)(?![a-z])", ",", text)
    text = text.replace(";", ",").replace("&", ",")
    for token in text.split(","):
        token = token.strip().strip(".:")
        if not token:
            continue
        span = re.fullmatch(r"([\d .]+?)\s*(?:to|-)\s*([\d .]+)", token, re.I)
        if span:
            low, high = digits(span.group(1)), digits(span.group(2))
            if low and high:
                found = expand_range(low, high)
                ranges.append({"from": low, "to": high})
                if not found:
                    unread.append(token)
                covered.update(found)
                continue
            unread.append(token)
            continue
        code = digits(token)
        if code is None:
            unread.append(token)
            continue
        if len(code) > 8 and len(code) % 8 == 0:
            parts = [code[i : i + 8] for i in range(0, len(code), 8)]
        elif len(code) in (2, 4, 6, 8):
            parts = [code]
        else:
            unread.append(token)
            continue
        for part in parts:
            literal.append(part)
            covered.update(with_prefix(part))
    return covered, literal, ranges, unread


def parse_spec(spec: str) -> dict:
    spec = prose(spec).strip("\"' ;")
    excluded: set[str] = set()
    ex_literal: list[str] = []
    unread: list[str] = []

    def take(match: re.Match) -> str:
        cov, lit, rng, bad = parse_codes(match.group(1))
        excluded.update(cov)
        ex_literal.extend(lit + [f"{r['from']}-{r['to']}" for r in rng])
        unread.extend(bad)
        return " "

    body = EXCLUSION.sub(take, spec)
    body = re.sub(r"[\[(].*?[\])]", " ", body)
    covered, literal, ranges, bad = parse_codes(body)
    unread += bad
    items = covered - excluded
    include = compress(items) if items else sorted(set(literal))
    # Codes the current tariff no longer has (renumbered since the entry was
    # written) cannot be expanded; keep them literally so nothing is lost.
    for code in literal:
        if not with_prefix(code) and code not in include:
            include.append(code)
    exclude = compress(excluded) if excluded else []
    return {
        "specText": spec,
        "include": sorted(include),
        "exclude": sorted(exclude),
        **({"ranges": ranges} if ranges else {}),
        **({"unread": unread} if unread else {}),
    }


def rate_value(text: str) -> float | None:
    t = prose(text).lower().strip(" .;,\"'")
    if t in ("nil", "free", "0", "0%"):
        return 0.0
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*%?", t)
    return float(m.group(1)) if m else None


# --------------------------------------------------------------------------- #
# Base tables
# --------------------------------------------------------------------------- #


def read_tables(filename: str, cfg: dict) -> tuple[list[dict], list[str]]:
    """Entries of every configured table in `filename`, in document order.

    Headings are tracked per row, not per table: APTA 50/2018 prints "Part B"
    half way down a ruled page, and prints "Part A" as a row inside the table.
    Rows that fall just below a page's last ruling (DFTP 08/2014 p2, S.Nos.
    102-103) are recovered from the text layer and flagged.
    """
    doc = fitz.open(NOTIFICATIONS / filename)
    columns: dict = cfg["columns"]
    alias = cfg.get("labelAlias", {})
    single = list(columns) == [""]
    entries: list[dict] = []
    warnings: list[str] = []
    label: str | None = "" if single else None
    started = False
    last_bounds: dict[str, list] = {}

    def add_row(cells: list[str], names: list[str], number: int, recovered: bool = False) -> None:
        nonlocal started
        serial = norm_serial(cells[0])
        if len(cells) < len(names) and len(cells) >= 2 and not re.search(r"(?i)omitted", " ".join(cells[1:])):
            parsed = split_rows(" ".join(cells), names)
            if len(parsed) == 1 and parsed[0]["serial"] == serial and parsed[0].get("spec"):
                cells = [parsed[0].get(n, "") for n in names]
        if len(cells) != len(names):
            if len(cells) >= 2 and re.search(r"(?i)omitted", " ".join(cells[1:])):
                entries.append({"table": label, "serial": serial, "omitted": True, "page": number, "_cells": {}})
                return
            prev = entries[-1] if entries and entries[-1]["table"] == label else None
            if len(cells) == 2 and prev and re.fullmatch(r"[\d ,]+", cells[1]):
                # A vertically merged description/rate cell (EFTA 51/2025
                # TABLE II): the row inherits them from the row above.
                row = dict(prev["_cells"], serial=cells[0], spec=cells[1])
                entries.append({"table": label, "serial": serial, "page": number, "_cells": row, "inheritedCells": True})
                return
            warnings.append(f"{filename} p{number} table {label or '-'}: {len(cells)} cells, expected {len(names)}: {cells}")
            if len(cells) < 2:
                return
        started = True
        entry = {"table": label, "serial": serial, "page": number, "_cells": dict(zip(names, cells))}
        if recovered:
            entry["recoveredFromText"] = True
        entries.append(entry)

    for number, page in enumerate(doc, start=1):
        heads = headings(page)
        tables = sorted(page.find_tables().tables, key=lambda t: t.bbox[1])
        for table in tables:
            while heads and heads[0][0] < table.bbox[1] + 2 and not single:
                label = alias.get(heads[0][1], heads[0][1])
                heads.pop(0)
            probe = columns.get(alias.get(label, label) if label is not None else "", None)
            expected = len(probe) if probe else None
            rows, bounds, ys = logical_rows(table, expected, last_bounds.get(label) if label is not None else None)
            for cells, y in zip(rows, ys):
                while heads and heads[0][0] < y + 2 and not single:
                    label = alias.get(heads[0][1], heads[0][1])
                    heads.pop(0)
                joined = " ".join(c for c in cells if c)
                inline = HEADING.match(joined) if not single and norm_serial(cells[0] if cells else "") is None else None
                if inline:
                    label = alias.get(label_of(inline.group(1), inline.group(2)), label_of(inline.group(1), inline.group(2)))
                    continue
                current = alias.get(label, label) if label is not None else None
                if current is None or current not in columns or not cells:
                    continue
                label = current
                names = columns[label]
                if len(bounds) >= len(names):
                    last_bounds[label] = bounds
                serial = norm_serial(cells[0])
                if serial is None or (len(cells) > 1 and re.fullmatch(r"\(\d\)(?:\s*\(\d\))*|\d(?:\s+\d){2,}", cells[1] or "")):
                    if entries and entries[-1]["table"] == label and not cells[0] and started:
                        prev = entries[-1]
                        for name, value in zip(names, cells):
                            if value and name != "serial":
                                prev["_cells"][name] = f"{prev['_cells'].get(name, '')} {value}".strip()
                    continue
                add_row(cells, names, number)
            while heads and heads[0][0] < table.bbox[3] and not single:
                label = alias.get(heads[0][1], heads[0][1])
                heads.pop(0)
        # Rows set just below the last ruling on the page.
        if tables and label is not None and label in columns:
            bottom = tables[-1].bbox[3]
            lines: dict[int, list] = {}
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    y0 = line["bbox"][1]
                    if y0 >= bottom - 20 and line["bbox"][3] <= page.rect.height - 5:
                        lines.setdefault(round(y0), []).append((line["bbox"][0], "".join(sp["text"] for sp in line["spans"])))
            for y0 in sorted(lines):
                text = prose(" ".join(t for _, t in sorted(lines[y0])))
                if re.match(r"^\d{1,5}[A-Z]?\.?\s+\d{4}", text) and not heads:
                    parsed = split_rows(text, columns[label])
                    for r in parsed:
                        if any(e["table"] == label and e["serial"] == r["serial"] for e in entries[-60:]):
                            continue
                        add_row([r.get(n, "") for n in columns[label]], columns[label], number, recovered=True)
                        warnings.append(f"{filename} p{number}: S.No. {r['serial']} recovered from text below the ruled table")
    return entries, warnings


def check_serials(entries: list[dict], label: str) -> list[str]:
    problems = []
    by_table: dict[str, list[str]] = {}
    for e in entries:
        by_table.setdefault(e["table"], []).append(e["serial"])
    for table, serials in by_table.items():
        numbers = [int(re.match(r"\d+", s).group()) for s in serials]
        plain = sorted({n for n, s in zip(numbers, serials) if s.isdigit()})
        if plain:
            missing = sorted(set(range(1, max(plain) + 1)) - set(plain))
            if missing:
                problems.append(f"{label} table {table or '-'}: serials missing {missing[:15]}{'…' if len(missing) > 15 else ''}")
        dups = sorted({s for s in serials if serials.count(s) > 1})
        if dups:
            problems.append(f"{label} table {table or '-'}: serials repeated {dups[:15]}")
    return problems


# --------------------------------------------------------------------------- #
# Amendments
# --------------------------------------------------------------------------- #

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}


def in_force_date(text: str) -> str | None:
    m = re.search(
        r"(?i)come into force (?:on|with effect from|w\.e\.f\.)\s*(?:the\s*)?(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:day of\s*)?([A-Za-z]+),?\s*(\d{4})",
        text,
    )
    if m and m.group(2).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    return None


def load_corpus_text(since: str) -> list[dict]:
    index = json.loads(INDEX.read_text())
    files = {p.name.rsplit("__", 1)[1][:-4]: p.name for p in NOTIFICATIONS.glob("*.pdf")}
    out = []
    for rec in index:
        if rec.get("notificationCategory") != "Tariff" or (rec.get("notificationDt") or "") < since:
            continue
        name = files.get(str(rec["id"]))
        if not name:
            continue
        try:
            doc = fitz.open(NOTIFICATIONS / name)
        except Exception:  # an empty download
            continue
        # Whole-table substitutions run to hundreds of pages; the citation and
        # every instruction that is not a table sit in their first pages.
        pages = range(doc.page_count) if doc.page_count <= 60 else range(4)
        text = prose(" ".join(doc[i].get_text() for i in pages))
        out.append({"no": rec["notificationNo"], "date": rec["notificationDt"][:10], "file": name, "pages": doc.page_count, "text": text})
    return out


def citation(no: str, year: str) -> re.Pattern:
    return re.compile(rf"(?<![\d/])0*{no}\s*/\s*(?:{year}|{year[-2:]})\s*-?\s*\(?\s*Cus", re.I)


def own_number(rec: dict) -> tuple[str, str] | None:
    m = re.match(r"\s*0*(\d+)\s*/\s*(\d{4})", rec["no"])
    return (m.group(1), m.group(2)) if m else None


def find_amendments(cfg: dict, corpus: list[dict]) -> list[dict]:
    no, year = cfg["cites"]
    rx = citation(no, year)
    base_file = cfg["base"][0]
    base_date = min([cfg["base"][2]] + [x["date"] for x in cfg.get("extraTables", [])])
    hits = []
    for rec in corpus:
        if rec["file"] == base_file or own_number(rec) == (no, year) or rec["file"] in {x["file"] for x in cfg.get("extraTables", [])}:
            continue
        if rec["date"] < base_date or (rec["date"] == base_date and rec["file"] <= base_file):
            continue
        if rx.search(rec["text"]):
            hits.append(rec)
    return sorted(hits, key=lambda r: (r["date"], r["file"]))


def section_for(rec: dict, cfg: dict) -> str:
    """The part of an amending notification that acts on this notification."""
    no, year = cfg["cites"]
    text = rec["text"]
    matches = list(citation(no, year).finditer(text))
    start = None
    for m in matches:
        tail = text[m.end() : m.end() + 900]
        if re.search(r"(?i)in the said notification", tail):
            start = m.start()
            break
    if start is None:
        return ""
    body = text[start:]
    said = re.search(r"(?i)in the said notification", body)
    body = body[said.start():] if said else body
    # The next numbered notification in an omnibus amendment, or the signature.
    stop = re.search(
        r"(?:\s\(?\d{1,2}[.)]\s*(?:Notification\s*)?(?:No\.?\s*)?\d+\s*/\s*\d{2,4}\s*-?\s*Cus)|\[F\.\s?No|\[F\. ?No|F\.\s?No\.\s?\d|Note\s*[:.-]",
        body[20:],
    )
    return body[: 20 + stop.start()] if stop else body


S_NO = r"(?:S\.\s?Nos?\.?|Sl\.\s?Nos?\.?|serial\s+numbers?|serial\s+nos?\.?)"
SER = r"(\d{1,5}\s?[A-Z]{0,2})"
# A list of serials: "11, 12, 26 and 113". Every repetition needs a separator,
# so the pattern cannot backtrack exponentially on a long run of digits.
SERLIST = r"(?P<serials>\d{1,5}\s?[A-Z]{0,2}\.?(?:\s*(?:,|and|to)\s*\d{1,5}\s?[A-Z]{0,2}\.?){0,300})"
Q = r'"([^"]*)"'

FORMS = [
    ("table", re.compile(r"(?i)for (?:the )?(TABLE\s*[IVX\d]*|Table|Appendix\s*[IVX]*)\s*,?\s*(?:[^.;]{0,60}?)the following (?:Tables?|TABLE|Appendix)[^.;]{0,20}shall be substituted")),
    ("omit", re.compile(rf"(?i){S_NO}\s*{SERLIST}\s*,?\s*and the (?:corresponding )?entries relating thereto,?\s*(?:shall|shal)\s*be omitted")),
    ("insert", re.compile(rf"(?i)after {S_NO}\s*(?P<anchor>\d{{1,5}}\s?[A-Z]{{0,2}})\s*,?\s*(?:and the (?:corresponding )?entr(?:y|ies) relating thereto,?\s*)?the following[^\"]{{0,200}}?(?:inserted|added)[^\"]{{0,120}}?\"(?P<rows>[^\"]*)\"")),
    ("replace", re.compile(rf"(?i)(?:for|against) {S_NO}\s*{SERLIST}\s*,?\s*(?:and|for) the (?:corresponding )?entries (?:relating )?thereto,?\s*(?:the )?following[^\"]{{0,200}}?(?:substituted|inserted)[^\"]{{0,120}}?\"(?P<rows>[^\"]*)\"")),
    ("insert-nq", re.compile(rf"(?i)after {S_NO}\s*(?P<anchor>\d{{1,5}}\s?[A-Z]{{0,2}})\s*,?\s*(?:and the (?:corresponding )?entr(?:y|ies) relating thereto,?\s*)?the following[^\"]{{0,120}}?inserted,?\s*namely\s*:?\s*-?\s*(?:\(\d\)\s*)*(?P<rows>[1-9]\d{{0,4}}[A-Z]{{0,2}}\.?\s*\d[^;\"]{{3,400}}?)(?=;|\[F|\s\(?[ivx]+\)\s|$)")),
    ("replace-nq", re.compile(rf"(?i)(?:for|against) {S_NO}\s*{SERLIST}\s*,?\s*(?:and|for) the (?:corresponding )?entries (?:relating )?thereto,?\s*(?:the )?following[^\"]{{0,120}}?substituted,?\s*namely\s*:?\s*-?\s*(?:\(\d\)\s*)*(?P<rows>[1-9]\d{{0,4}}[A-Z]{{0,2}}\.?\s*\d[^;\"]{{3,400}}?)(?=;|\[F|\s\(?[ivx]+\)\s|$)")),
    ("column-ab", re.compile(
        rf"(?i)against {S_NO}\s*{SERLIST}\s*,?\s*(?:(?:for|in) the entr(?:y|ies)\s*,?\s*)?-?\s*\(?(?:a|I)[.)]\s*in (?:the )?column\s*\(?(?P<c1>\d)\)?\s*,?\s*(?:for the entr(?:y|ies)\s*,?\s*)?the entr(?:y|ies)\s*,?\s*\"(?P<v1>[^\"]*)\"(?:\s*shall be substituted)?\s*[;,]?\s*\(?(?:b|II)[.)]\s*in (?:the )?column\s*\(?(?P<c2>\d)\)?\s*,?\s*(?:for the entr(?:y|ies)\s*,?\s*)?the entr(?:y|ies)\s*,?\s*\"(?P<v2>[^\"]*)\"")),
    ("column-pair", re.compile(
        rf"(?i)against {S_NO}\s*{SERLIST}\s*,?\s*for the (?:respective )?entr(?:y|ies) (?:in|under) columns?\s*\((?P<c1>\d)\)\s*and(?: column)?\s*\((?P<c2>\d)\),?\s*the entr(?:y|ies),?\s*\"(?P<v1>[^\"]*)\"\s*and\s*\"(?P<v2>[^\"]*)\"")),
    ("column", re.compile(
        rf"(?i)(?:against|in|at) {S_NO}\s*{SERLIST}\s*,?\s*-?\s*(?:\([a-z]+\)\s*)?(?:in column\s*\(?(?P<c1>\d)\)?\s*,?\s*)?for (?:the (?:respective )?(?:entr(?:y|ies)|figures?)(?:\s*(?:in|under) column\s*\((?P<c2>\d)\))?|column\s*\((?P<c3>\d)\))(?:\s*,?\s*\"(?P<old>[^\"]*)\")?(?:\s*(?:occurring )?in column\s*\((?P<c4>\d)\))?(?:\s*,?\s*(?:at both the places|wherever it occurs))?\s*,?\s*(?:the )?(?:entry|entries|figures?)\s*,?\s*\"(?P<new>[^\"]*)\"")),
]


def serial_list(text: str) -> list[str]:
    text = text.replace(".", " ")
    out: list[str] = []
    for part in re.split(r"\s*(?:,|and)\s*", text):
        span = re.fullmatch(r"(\d+)\s*to\s*(\d+)", part.strip())
        if span:
            out += [str(n) for n in range(int(span.group(1)), int(span.group(2)) + 1)]
        elif part.strip():
            out.append(part.strip().replace(" ", ""))
    return out


COLUMN_NUMBER = {"spec": 2, "description": 3}


def split_rows(text: str, names: list[str]) -> list[dict]:
    """Rows written inline inside an amendment's quotes, e.g.
    '639A 85017200 Photovoltaic DC Generator of an output exceeding 75kW 0.00 639B 85018000 All goods 0.00'.
    """
    text = prose(re.sub(r"\(\d\)", " ", text))
    # "2202991 0": an 8-digit item split by a stray space in the gazette.
    text = re.sub(r"(?<!\d)(\d{7}) (\d)(?!\d)", r"\1\2", text)
    rate_cols = [n for n in names if n not in ("serial", "spec", "description", "condition", "omittedRate")]
    rate_tok = r"(?:\d+(?:\.\d+)?\s*%?|Nil|Free)"
    starts = [m.start() for m in re.finditer(r"(?:(?<=^)|(?<=\s))([1-9]\d{0,4}[A-Z]{0,2})\.?\s+(?=(?:\d{4}|\d{2} \d{2})(?:\s?\d{2}){0,2}\b|Chapter)", text)]
    rows = []
    # Accept a start only at the beginning or right after a rate-like token.
    cuts = []
    for s in starts:
        before = text[:s].rstrip()
        since_cut = text[cuts[-1]:s] if cuts else ""
        if not before:
            cuts.append(s)
        elif cuts and re.search(r"[A-Za-z]{3,}", since_cut) and (
            (rate_cols and re.search(rf"\s{rate_tok}$", before)) or not rate_cols
        ):
            # A new row starts only once the previous one has had its words
            # (a description) and, when the table has rates, its rate.
            cuts.append(s)
    if not cuts:
        return []
    cuts.append(len(text))
    for a, b in zip(cuts, cuts[1:]):
        chunk = text[a:b].strip().rstrip(";,.\"' ").rstrip(";,.\"' ")
        m = re.match(r"(\d{1,5}[A-Z]{0,2})\.?\s+(.*)$", chunk)
        if not m:
            continue
        serial, rest = m.group(1), m.group(2)
        rates: list[str] = []
        tokens: list[str] = []
        while rate_cols:
            rm = re.search(rf"\s({rate_tok})$", " " + rest)
            if not rm:
                break
            tokens.insert(0, rm.group(1))
            rest = rest[: len(rest) - len(rm.group(1))].rstrip()
            if len(tokens) >= 4 * len(rate_cols):
                break
        if rate_cols and tokens:
            n = len(rate_cols)
            if len(tokens) > n and len(tokens) % n == 0 and re.search(r"[A-Za-z]{3,}", rest):
                # Stacked sub-item rates: "0 0 95 70" is BCD "0 0", AIDC "95 70".
                k = len(tokens) // n
                rates = [" ".join(tokens[i * k:(i + 1) * k]) for i in range(n)]
            else:
                extra, rates = tokens[: max(0, len(tokens) - n)], tokens[-n:]
                rest = f"{rest} {' '.join(extra)}".strip()
        sm = re.match(
            r"((?:(?:\d[\d ]*\d|\d)|Chapter\s*\d+|\s*(?:,|to|or|and)\s*|\s*\((?:except|excluding|other than)[^)]*\))+)(.*)$",
            rest,
            re.I,
        )
        spec, desc = (sm.group(1), sm.group(2)) if sm else ("", rest)
        # A spec ends where words begin; a trailing "or"/"and" belongs to it.
        cells = {"serial": serial, "spec": spec.strip(" ,"), "description": desc.strip()}
        for name, value in zip(rate_cols[-len(rates):] if rates else [], rates):
            cells[name] = value
        rows.append(cells)
    return rows


def table_context(section: str, position: int, default: str) -> str:
    before = section[:position]
    found = list(re.finditer(r"(?i)in (?:the )?(TABLE\s*-?\s*[IVX\d]+|APPENDIX\s*-?\s*[IVX]+|PART\s*-?\s*[A-D])\b", before))
    if not found:
        return default
    m = re.match(r"(?i)(TABLE|APPENDIX|PART)\s*-?\s*([IVX\d]+|[A-D])", found[-1].group(1))
    return label_of(m.group(1), m.group(2).upper())


def apply_amendments(cfg: dict, entries: list[dict], amendments: list[dict], log: dict) -> list[dict]:
    columns = cfg["columns"]
    default = "" if list(columns) == [""] else (list(columns)[0] if len(columns) == 1 else None)

    table_base = {label: cfg["base"][2] for label in columns}
    for extra in cfg.get("extraTables", []):
        for label in extra["tables"]:
            table_base[label] = extra["date"]

    def locate(table: str | None, serial: str) -> int | None:
        serial = serial.replace(" ", "")
        for i, e in enumerate(entries):
            if e["serial"] == serial and (table is None or e["table"] == table):
                return i
        return None

    for rec in amendments:
        manual = cfg.get("handledInConfig", {}).get(rec["no"].split(" ")[0].split("-")[0].strip())
        if manual:
            log["amendments"].append({"notification": rec["no"], "date": rec["date"], "effective": in_force_date(rec["text"]) or rec["date"],
                                      "file": rec["file"], "applied": [f"reflected in configuration: {manual}"], "unapplied": []})
            continue
        section = section_for(rec, cfg)
        effective = in_force_date(rec["text"]) or rec["date"]
        label = f"{rec['no'].split(' ')[0].strip()} ({rec['date']})"
        applied: list[str] = []
        unapplied: list[str] = []
        if not section:
            log["referencesOnly"].append({"notification": rec["no"], "date": rec["date"], "file": rec["file"],
                                          "snippet": rec["text"][max(0, citation(*cfg['cites']).search(rec['text']).start() - 200):][:500]})
            continue
        consumed: list[tuple[int, int]] = []
        for kind, rx in FORMS:
            for m in rx.finditer(section):
                if any(a <= m.start() < b for a, b in consumed):
                    continue
                consumed.append((m.start(), m.end()))
                table = table_context(section, m.start(), default) if default is None or len(columns) > 1 else default
                if kind != "table" and rec["date"] <= table_base.get(table if table is not None else "", cfg["base"][2]):
                    # Older than the text this table was taken from, which
                    # already carries it.
                    applied.append(f"{kind} predates base text of table {table or '-'} (already reflected)")
                    continue
                if kind == "table":
                    labels = [label_of("TABLE", n.upper()) for n in re.findall(r"(?i)TABLE\s*([IVX]+|\d)\b", m.group(0))] or [""]
                    stale = [l for l in labels if rec["date"] > table_base.get(l, cfg["base"][2])]
                    if stale:
                        unapplied.append(f"whole-table substitution of table(s) {stale} after the base text — rebase on {rec['file']}")
                    else:
                        applied.append(f"table(s) {labels} substitution superseded by the base text used")
                elif kind == "omit":
                    for serial in serial_list(m.group("serials")):
                        i = locate(table, serial)
                        if i is None:
                            unapplied.append(f"omit S.No. {serial}: not found in table {table or '-'}")
                            continue
                        entries[i]["omitted"] = {"notification": rec["no"], "date": effective}
                        applied.append(f"omit {serial}")
                elif kind in ("insert", "replace", "insert-nq", "replace-nq"):
                    kind = kind.replace("-nq", "")
                    names = columns.get(table or "", STD4) if columns else STD4
                    anchors = [m.group("anchor").replace(" ", "")] if kind == "insert" else serial_list(m.group("serials"))
                    raw = m.group("rows")
                    # "22A3907 70 00All goods": the serial and the code run together.
                    raw = re.sub(rf"^\s*({re.escape(anchors[0])}[A-Z]{{0,2}})(?=\d)", r"\1 ", raw)
                    raw = re.sub(r"(\d)(?=[A-Z][a-z])", r"\1 ", raw)
                    rows = split_rows(raw, names)
                    if not rows:
                        if not re.search(r"\d{4}", m.group("rows")) and re.search(r"[A-Z][a-z]+", m.group("rows")):
                            applied.append(f"country list: {kind} after S.No. {anchors[0]} — {prose(m.group('rows'))[:80]} (see the agreement's partner list)")
                        else:
                            unapplied.append(f"{kind} at S.No. {anchors}: could not read rows from {m.group('rows')[:120]!r}")
                        continue
                    found = [locate(table, a) for a in anchors]
                    if any(i is None for i in found):
                        unapplied.append(f"{kind} at S.No. {anchors}: anchor not found in table {table or '-'}")
                        continue
                    i = found[0]
                    new = [{"table": entries[i]["table"], "serial": r["serial"], "page": None,
                            "_cells": r, "source": rec["no"], "validFrom": effective,
                            "amendedBy": [f"{label} ({kind})"]} for r in rows]
                    if kind == "insert":
                        entries[i + 1 : i + 1] = new
                    else:
                        for j in sorted(found, reverse=True):
                            del entries[j]
                        entries[i:i] = new
                    applied.append(f"{kind} {', '.join(r['serial'] for r in rows)}")
                elif kind in ("column", "column-pair", "column-ab"):
                    names = columns.get(table or "", STD4) if columns else STD4
                    if kind == "column":
                        col = int(m.group("c1") or m.group("c2") or m.group("c3") or m.group("c4") or 0)
                        edits = [(col, m.group("new"))]
                    else:
                        edits = [(int(m.group("c1")), m.group("v1")), (int(m.group("c2")), m.group("v2"))]
                    for serial in serial_list(m.group("serials")):
                        i = locate(table, serial)
                        bad = [c for c, _ in edits if not c or c > len(names)]
                        if i is None or bad:
                            unapplied.append(f"column edit of S.No. {serial}: {'serial not found' if i is None else 'column unknown'} in table {table or '-'} — {m.group(0)[:160]}")
                            continue
                        for col, value in edits:
                            name = names[col - 1]
                            entries[i]["_cells"][name] = value
                            if name not in ("spec", "description"):
                                entries[i]["validFrom"] = effective
                        entries[i].setdefault("amendedBy", []).append(f"{label} (column {','.join(str(c) for c, _ in edits)})")
                        applied.append(f"S.No. {serial} col {','.join(str(c) for c, _ in edits)}")
        # Anything instruction-shaped we did not consume.
        leftovers = []
        for m in re.finditer(rf"(?i)(?:against|after|for)\s+{S_NO}\s*{SER}", section):
            if not any(a <= m.start() < b for a, b in consumed):
                leftovers.append(section[m.start(): m.start() + 220])
        for m in re.finditer(r"(?i)(?:in|after|for|before) (?:the )?(?:first |second |said )?(?:opening paragraph|preamble|provisos?|Explanation|Schedule to|Table,? the following(?! (?:serial|S\. ?No)))", section):
            if not any(a <= m.start() < b for a, b in consumed):
                leftovers.append(section[m.start(): m.start() + 260])
        for text in leftovers:
            unapplied.append(f"not applied: {text}")
            # Mark the entries a skipped instruction names, so the row itself
            # says it may not be the current text.
            for serial in re.findall(r"(?i)(?:serial numbers?|S\.\s?Nos?\.?)\s*(\d{1,5}[A-Z]{0,2})", text):
                i = locate(None, serial)
                if i is not None:
                    entries[i].setdefault("unappliedAmendments", []).append(label)
        if not applied and not unapplied:
            unapplied.append(f"no instruction recognised: {section[:300]}")
        log["amendments"].append({"notification": rec["no"], "date": rec["date"], "effective": effective,
                                  "file": rec["file"], "applied": applied, "unapplied": unapplied})
    return entries


# --------------------------------------------------------------------------- #
# Rows out
# --------------------------------------------------------------------------- #

RATE_NAMES = ("rate", "rateAppendixII", "aidcRate", "healthCessRate", "reduction", "outOfQuotaRate", "outOfQuotaAidcRate")


def finish(cfg: dict, entries: list[dict], log: dict) -> list[dict]:
    base_file, base_no, base_date, base_valid = cfg["base"]
    kind = cfg["rateKind"]
    rows: list[dict] = []
    excluded_tables: dict[str, set[str]] = {}

    for e in entries:
        if e.get("omitted"):
            log["omittedSerials"].append(f"{e['table'] or '-'}:{e['serial']}")
            continue
        cells = {k: prose(v).strip("\"';") .rstrip(".") if k not in ("description",) else prose(v).strip("\"';")
                 for k, v in e["_cells"].items()}
        if re.fullmatch(r"(?i)\s*(?:-|omitted\.?)?\s*", cells.get("spec", "")) and re.fullmatch(
            r"(?i)\s*(?:-|omitted\.?)\s*", cells.get("description", "")
        ):
            # Printed as a placeholder ("Omitted", or "-" in every column).
            log["omittedSerials"].append(f"{e['table'] or '-'}:{e['serial']} (printed as placeholder)")
            continue
        for name in ("spec", "description"):
            # The signature block or the Note that follows a table's last row
            # is sometimes ruled into it.
            cut = re.search(r"(?i)\[?F\.\s?No\.|\bNote\s*[:.-]|was published in the Gazette|and was last amended|\s\d{4}, and was last", cells.get(name, ""))
            if cut:
                cells[name] = cells[name][: cut.start()].strip()
        if re.search(r"[A-Za-z]{4,}", cells.get("spec", "")) and not cells.get("description"):
            m = re.match(r"((?:\d[\d ]*\d|\d|\s*(?:,|to|or|and)\s*)+)\s+(.*)$", cells["spec"])
            if m:
                cells["spec"], cells["description"] = m.group(1).strip(" ,"), m.group(2)
        spec = parse_spec(cells.get("spec", ""))
        row: dict = {"serial": e["serial"]}
        prefix = cfg.get("serialPrefix", {}).get(e["table"])
        if prefix:
            row["clause"] = prefix
        if e["table"]:
            row["table"] = e["table"]
        role = cfg.get("tableRole", {}).get(e["table"])
        if role:
            row["role"] = role
            excluded_tables.setdefault(e["table"], set()).update(
                i for p in spec["include"] for i in with_prefix(p)
            )
        row.update({k: v for k, v in spec.items()})
        desc = prose(cells.get("description", ""))
        row["description"] = desc
        row["allGoods"] = bool(re.fullmatch(r"(?i)all goods\.?", desc))
        if cfg.get("tableSlot", {}).get(e["table"]):
            row["slot"] = cfg["tableSlot"][e["table"]]
        fixed_rate = cfg.get("tableFixedRate", {}).get(e["table"])
        if fixed_rate:
            row["rateText"], row["rate"], row["rateMeaning"] = fixed_rate
        elif kind in ("effective", "reduction"):
            rate_name = "reduction" if (kind == "reduction" or "reduction" in cells) else "rate"
            text = cells.get(rate_name) or cells.get("rate") or ""
            row["rateText"] = text
            row["rate"] = rate_value(text)
            row["rateMeaning"] = "percent reduction of applied duty" if rate_name == "reduction" else "preferential BCD rate %"
            for extra in RATE_NAMES:
                if extra not in ("rate", "reduction") and cells.get(extra):
                    row[extra + "Text"] = cells[extra]
                    row[extra] = rate_value(cells[extra])
        elif kind == "reduction-fixed":
            row["rateText"] = cfg["fixedRateText"]
            row["rate"] = cfg["fixedRate"]
            row["rateMeaning"] = "percent reduction of applied duty"
        elif kind == "whole":
            row["rateText"] = "whole of the duty of customs"
            row["rate"] = 0.0 if cfg["slot"] == "BASIC" else 100.0
            row["rateMeaning"] = "preferential BCD rate %" if cfg["slot"] == "BASIC" else "percent reduction of applied duty"
        if role == "excluded":
            row.pop("rate", None)
            row.pop("rateText", None)
            row.pop("rateMeaning", None)
        if cells.get("trq"):
            row["trqText"] = cells["trq"]
        if cells.get("condition"):
            row["conditions"] = re.findall(r"\d+|\([a-z]\)", cells["condition"]) or [cells["condition"]]
        row["validFrom"] = e.get("validFrom") or base_valid
        row["source"] = e.get("source") or base_no
        row["page"] = e["page"]
        if e.get("amendedBy"):
            row["amendedBy"] = e["amendedBy"]
        if e.get("unappliedAmendments"):
            row["unappliedAmendments"] = sorted(set(e["unappliedAmendments"]))
        if row.get("unread"):
            log["unreadSpecs"].append(f"{row.get('table') or '-'}:{row['serial']} {row['specText']!r} unread {row['unread']}")
        if row["rate"] is None if "rate" in row else False:
            log["unreadRates"].append(f"{row.get('table') or '-'}:{row['serial']} {row.get('rateText')!r}")
        rows.append(row)

    for fixed in cfg.get("fixed", []):
        row = {k: v for k, v in fixed.items() if k != "excludeTable"}
        tables = fixed.get("excludeTable")
        tables = [tables] if isinstance(tables, str) else (tables or [])
        items = set().union(*(excluded_tables.get(t, set()) for t in tables)) if tables else set()
        if tables:
            # Every tariff item the listed tables name is outside the clause.
            raw = set()
            for r in rows:
                if r.get("table") in tables:
                    raw.update(r["include"])
        row["include"] = []
        row["exclude"] = sorted(raw) if tables else []
        row["rateMeaning"] = "percent reduction of applied duty" if cfg["slot"] == "SAPTA" else "preferential BCD rate %"
        row["validFrom"] = fixed.get("validFrom") or base_valid
        row["source"] = cfg["notification"]
        row["page"] = 1
        rows.insert(0, row)
    return rows


def isfta_rows(cfg: dict, log: dict) -> list[dict]:
    """LIST 2, LIST 3 and LIST 5 of 26/2000 from the CBIC compilation."""
    doc = fitz.open(CORPUS / "tariff" / cfg["compilation"])
    text = prose(" ".join(page.get_text() for page in doc))
    text = re.sub(r"_{5,}|GENERAL EXEMPTION NO\. 78 \d{4}|\(1\) \(2\) \(3\) \(4\)", " ", text)
    text = prose(text)
    source = "26/2000-Customs as compiled in CBIC Customs Tariff Vol. II G.E. 78 (as on 30.06.2024)"
    rows: list[dict] = []

    def row(lst: str, serial: str, spec: str, desc: str, rate: str, **extra) -> dict:
        parsed = parse_spec(spec.replace(".", ""))
        return {"serial": serial, "table": lst, **parsed, "description": desc,
                "allGoods": bool(re.fullmatch(r"(?i)all goods", desc)), "rateText": rate,
                "rate": rate_value(rate), "rateMeaning": "percent reduction of applied duty",
                "validFrom": None, "source": source, "sourceKind": "compilation", "page": None, **extra}

    list2 = text[text.find("LIST-2 1 51"): text.find("LIST-3")]
    for m in re.finditer(r"(?:^|\s)(\d{1,2}) ((?:\d{4} \d{2} or )?\d{2}) (.+?) (\d{2,3}%)", list2.replace("LIST-2", "")):
        desc = m.group(3).strip()
        if re.search(r"(?i)other than|except", desc):
            desc += " [exclusions continue in the source text; see G.E. 78]"
        rows.append(row("LIST 2", m.group(1), m.group(2), desc, m.group(4)))
    list3 = text[text.find("LIST-3"): text.find("LIST-4")]
    first = re.search(r"LIST-3 1\. (.+?) All goods (100%)(.*?)2\. 61 or 62 All goods, other than (75%) those specified in S\.No\.1 above", list3)
    if first:
        spec = re.sub(r"\(except[^)]*\)", "", first.group(1) + first.group(3))
        rows.append(row("LIST 3", "1", spec, "All goods (TRQ: 6 million pieces a calendar year; proviso to condition (2))", first.group(2)))
        rows.append(row("LIST 3", "2", "61, 62", "All goods, other than those specified in S.No.1 above", first.group(4)))
    for m in re.finditer(r"(?:^|\s)(\d{1,3}) ((?:\d{4} ?\d{2}(?: ?\d{2})?,? ?)+) All goods (100%)", list3[first.end() if first else 0:]):
        if int(m.group(1)) >= 3:
            rows.append(row("LIST 3", m.group(1), m.group(2), "All goods (TRQ: S.Nos. 3 to 212 together 3 million pieces a calendar year)", m.group(3)))
    annexure = text[text.find("ANNEXURE S.No Heading No"):]
    neg = re.search(r"LIST-1 (.+?) All goods except Sake (.+?) LIST -1A", annexure)
    neg_codes = []
    if neg:
        neg_codes = [re.sub(r"\D", "", c) for c in re.findall(
            r"\b\d{4}\.\d{2}\b|\b\d{2}\.\d{2}\b|\b\d{4}(?: \d{2}){1,2}\b|\b\d{4}\b", neg.group(1) + " " + neg.group(2))]
    excluded = parse_spec(", ".join(c.replace(".", "") for c in neg_codes))
    list_items = set()
    for r in rows:
        for p in r["include"]:
            list_items.update(with_prefix(p))
    rows.append({
        "serial": "1", "table": "LIST 5", "specText": "All goods other than goods in LISTS 2 and 3, notifications 60/2000 and 2/2007, and the ANNEXURE",
        "include": [], "exclude": sorted(set(excluded["include"]) | set(compress(list_items))),
        "description": "All goods other than (a) goods mentioned in lists 2 and 3 and in notifications 60/2000-Customs and 2/2007-Customs; (b) goods listed in the ANNEXURE (LIST-1 codes excluded here; LIST-1A items are described, not coded, and are NOT excluded by this row)",
        "allGoods": True, "rateText": "100%", "rate": 100.0, "rateMeaning": "percent reduction of applied duty",
        "validFrom": None, "source": source, "sourceKind": "compilation", "page": None,
    })
    log["warnings"].append("ISFTA schedule read from the CBIC compilation, not rebuilt from primary text; ANNEXURE LIST-1A (described goods) is not machine-excluded; LIST 5 also excludes goods of 60/2000 and 2/2007 which are not listed here")
    return rows


def build(cfg: dict, corpus: list[dict]) -> tuple[list[dict], dict]:
    log = {"key": cfg["key"], "notification": cfg["notification"], "base": cfg["base"][1], "baseFile": cfg["base"][0],
           "warnings": [], "amendments": [], "referencesOnly": [], "omittedSerials": [], "unreadSpecs": [], "unreadRates": []}
    if cfg["rateKind"] == "compilation-isfta":
        rows = isfta_rows(cfg, log)
        log["rows"] = len(rows)
        for rec in find_amendments(cfg, corpus):
            if rec["date"] > "2024-06-30":
                log["amendments"].append({"notification": rec["no"], "date": rec["date"], "effective": rec["date"], "file": rec["file"],
                                          "applied": [], "unapplied": ["after the compilation date; not reflected"]})
        return rows, log
    if cfg["rateKind"] == "description":
        rows = []
        for r in DESCRIPTION_ROWS[cfg["notification"]]:
            rows.append({"serial": r["serial"], "include": [], "exclude": [], "anyChapter": True, "allGoods": False,
                         "description": r["description"], "rateText": "whole of the duty of customs", "rate": 0.0,
                         "rateMeaning": "preferential BCD rate %", "conditions": r["conditions"],
                         "validFrom": cfg["base"][3], "source": cfg["base"][1], "page": 1})
        amendments = find_amendments(cfg, corpus)
        for rec in amendments:
            log["referencesOnly"].append({"notification": rec["no"], "date": rec["date"], "file": rec["file"],
                                          "snippet": section_for(rec, cfg)[:400] or rec["text"][:300]})
        log["rows"] = len(rows)
        return rows, log

    entries, warnings = read_tables(cfg["base"][0], cfg)
    for e in entries:
        e["_baseDate"] = cfg["base"][2]
    for extra in cfg.get("extraTables", []):
        sub = dict(cfg, columns={k: v for k, v in cfg["columns"].items() if k in extra["tables"]})
        more, w = read_tables(extra["file"], sub)
        for e in more:
            e.update({"_baseDate": extra["date"], "source": extra["notification"], "validFrom": extra["validFrom"]})
        warnings += w
        entries += more
        log.setdefault("extraBases", []).append({k: extra[k] for k in ("notification", "file", "tables")})
    log["warnings"] += warnings
    log["baseRows"] = len(entries)
    log["warnings"] += check_serials([e for e in entries if not e.get("omitted")], cfg["base"][1])
    amendments = find_amendments(cfg, corpus)
    entries = apply_amendments(cfg, entries, amendments, log)
    rows = finish(cfg, entries, log)
    log["rows"] = len(rows)
    return rows, log


def logisys_notn(value: str) -> str:
    m = re.search(r"(\d{1,3})\s*/\s*(\d{4})", value)
    return f"{m.group(1).zfill(3)}/{m.group(2)}" if m else value


# How a concession notification's rows become schedule files. By default all
# rows go to the agreement's key; these split a notification whose columns or
# parts apply to different partner sets, because a schedule file is read per
# agreement and cannot tell partners apart.
EMIT = {
    "046/2011": [
        {"key": "AIFTA"},
        {"key": "AIFTA-PH", "rateFrom": "rateAppendixII"},
    ],
    # 99/2011 covers the SAFTA LDCs, 68/2012 the non-LDCs: different partner
    # sets, and a 68/2012 line must never be offered for a Bangladesh origin.
    "099/2011": [{"key": "SAFTA-LDC"}],
    "068/2012": [{"key": "SAFTA-NLDC"}],
    "050/2018": [
        {"key": "APTA", "tables": ["PART A"]},
        {"key": "APTA-LDC", "tables": ["PART B"]},
    ],
}

# Misprints in the gazette text whose correction is forced by the table's own
# sequence. The printed spec is kept; `include` is computed from the reading.
SPEC_ERRATA = {
    ("152/2009", "103"): ("200961 to 200990", "printed \"20961 to 200990\" in 66/2016-Customs p4; S.No. 102 ends at 200949 and 104 starts at 210111"),
    ("152/2009", "181A"): ("290382 to 290389", "printed \"290382 to 390389\" in 60/2021-Customs; S.No. 181 ends at 290381 and 182 starts at 290391 — the printed range would sweep in chapters 30-39"),
}

LINE_FIELDS = ("serial", "include", "exclude", "anyChapter", "description", "rateText", "rate", "validFrom", "validUntil",
               "conditions", "page", "notification", "table", "clause", "slot", "rateMeaning", "specText", "allGoods",
               "aidcRateText", "aidcRate", "healthCessRateText", "healthCessRate", "trqText", "reductionText",
               "outOfQuotaRateText", "outOfQuotaRate", "outOfQuotaAidcRateText", "outOfQuotaAidcRate",
               "source", "sourceKind", "amendedBy", "unappliedAmendments", "unread", "specErratum")


def schedule_lines(cfg: dict, rows: list[dict], emit: dict) -> list[dict]:
    """Rows as the consumer reads them: a plain line per concession serial."""
    tables = emit.get("tables")
    rows = [r for r in rows if not tables or r.get("table") in tables]
    excluded = [r for r in rows if r.get("role") == "excluded"]
    lines = []
    for r in rows:
        if r.get("role") == "excluded":
            continue
        line = dict(r)
        if emit.get("rateFrom"):
            line["rateText"] = r.get(emit["rateFrom"] + "Text")
            line["rate"] = r.get(emit["rateFrom"])
        line.pop("rateAppendixIIText", None)
        line.pop("rateAppendixII", None)
        if r.get("table") in ("opening paragraph", "LIST 5") or cfg["rateKind"] == "description":
            # A clause covering all goods other than its exclusions. A table
            # row whose spec could not be expanded is NOT one: it keeps an
            # empty include and matches nothing.
            line["anyChapter"] = True
        else:
            line.pop("anyChapter", None)
        if line.get("serial") is None:
            # 99/2011 prints no serial for its single operative clause.
            line["serial"] = ""
        extra = set()
        for x in excluded:
            for p in x["include"]:
                if line.get("anyChapter") or any(p.startswith(i) or i.startswith(p) for i in line["include"]):
                    extra.add(p)
        if extra:
            line["exclude"] = sorted(set(line.get("exclude") or []) | extra)
        line["notification"] = logisys_notn(cfg["notification"])
        if cfg["rateKind"] == "reduction-fixed":
            line["slot"] = cfg["slot"]
        erratum = SPEC_ERRATA.get((line["notification"], str(line.get("serial"))))
        if erratum:
            fixed = parse_spec(erratum[0])
            line["include"], line["exclude"] = fixed["include"], fixed["exclude"]
            line["specErratum"] = {"readAs": erratum[0], "why": erratum[1]}
        line.setdefault("validUntil", None)
        if not line.get("validFrom"):
            line["validFrom"] = cfg["base"][3] or cfg.get("inForce")
        lines.append({k: line[k] for k in LINE_FIELDS if k in line and line[k] not in (None, [], "") or k in ("include", "exclude", "validUntil", "rate", "description")})
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="agreement keys (or notification numbers) to build")
    args = parser.parse_args()

    configs = [c for c in CONFIG if not args.only or c["key"] in args.only or c["notification"] in args.only]
    since = min(c["base"][2] for c in configs)
    corpus = load_corpus_text(since)
    print(f"corpus: {len(corpus)} tariff notifications since {since}", file=sys.stderr, flush=True)
    OUT.mkdir(parents=True, exist_ok=True)

    files: dict[str, list[dict]] = {}
    logs = []
    for cfg in configs:
        print(f"… {cfg['key']} {cfg['notification']}", file=sys.stderr, flush=True)
        rows, log = build(cfg, corpus)
        log["slot"] = cfg["slot"]
        log["emittedTo"] = []
        for emit in EMIT.get(cfg["notification"], [{"key": cfg["key"]}]):
            lines = schedule_lines(cfg, rows, emit)
            files.setdefault(emit["key"], []).extend(lines)
            log["emittedTo"].append({"key": emit["key"], "lines": len(lines)})
        logs.append(log)
        print(f"{cfg['key']:<16} {cfg['notification']:<9} rows={len(rows):>6} amendments={len(log['amendments'])} "
              f"unapplied={sum(len(a['unapplied']) for a in log['amendments'])} warnings={len(log['warnings'])}", flush=True)

    # A key is rewritten whole, so a partial build must not drop the lines
    # another notification of the same agreement contributed.
    built = {logisys_notn(c["notification"]) for c in configs}
    for key, lines in files.items():
        path = OUT / f"{key}.json"
        keep = []
        if args.only and path.exists():
            old = json.loads(path.read_text())
            if isinstance(old, list):
                keep = [l for l in old if l.get("notification") not in built]
        path.write_text(json.dumps(keep + lines, indent=1, ensure_ascii=False) + "\n")
    build_log = OUT / "_build.json"
    previous = []
    if build_log.exists() and args.only:
        previous = json.loads(build_log.read_text())
    keep = [l for l in previous if l.get("notification") not in {c["notification"] for c in configs}]
    build_log.write_text(json.dumps({"asOf": AS_OF, "generatedBy": "packages/core/scripts/build-fta-schedules.py",
                                     "notifications": keep + logs} if not isinstance(previous, dict) else
                                    {**previous, "notifications": [l for l in previous.get("notifications", []) if l.get("notification") not in {c["notification"] for c in configs}] + logs},
                                    indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
