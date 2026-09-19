"""Compare the workbooks we generated against the ones Logi-Sys filed.

    python3 corpus-compare.py [folder ...]

For each corpus folder it looks for our export in
`corpus-exports/<folder>/logisys-*.xlsx` and Logi-Sys' own in the folder itself
(`JobData_*.xlsx`, or `logisys-*.xlsx` for `ex_job6`). Both are the same
nineteen sheets in the same order, so the comparison is column by column with no
mapping in between.

It prints, and writes to `corpus-exports/comparison/`:
  - `<folder>.md`   every column that differs, with both values
  - `SCORECARD.md`  the tally per job, and the columns that are wrong most often

What counts as a difference is deliberately narrow. Numbers are compared as
numbers (`14800` and `14800.00` are the same figure), dates as dates, and text
case- and whitespace-insensitively — a Bill of Entry is not wrong because a
column is padded differently. Everything else is reported, including a column we
left blank that they filled, which is the most common way for our export to be
short rather than wrong.

One kind of blank is not a gap: a column Logi-Sys fills from a **screen
default** and we deliberately refuse to write, because the notification does not
say it and ICES does not ask for it. Those are counted apart (`VENDOR_DEFAULTS`
below) so the scorecard stops reporting a decision as a defect. The headline
`agreement` still counts them, so the number stays comparable with
`corpus-baseline.json`; the figure beside it does not.
"""
import glob
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime

import openpyxl

ERP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
OUT_ROOT = os.path.join(ERP_ROOT, "corpus-exports")
REPORT_DIR = os.path.join(OUT_ROOT, "comparison")

# How a sheet's rows line up between the two files. A Bill of Entry's invoice 2
# is invoice 2 in both, but only if both files agree on the order — keying on
# the serial rather than the position says so instead of assuming it.
ROW_KEYS = {
    "INVOICES": ["InvSrNo"],
    "ITEMS": ["InvSrNo", "ItemSrNo"],
    "CONTAINERS": ["Container No"],
    "EXCHANGE_RATE": ["CURRENCY_CODE"],
    "SUPPORTING_DOCS": ["Inv_SrNo", "Item_SrNo", "Doc_Type"],
    "BONDS_CERTIFICATES": ["Bond_Cert_No"],
    "STATEMENT": ["Inv_SrNo", "Item_SrNo", "StatementCode"],
    "RE-IMPORT": ["Inv_SrNo", "Item_SrNo"],
    "SW_ADDL_INFO": ["Inv_SrNo", "Item_SrNo", "Info_Code_Description"],
    "SW_PRODUCTION": ["Inv_SrNo", "Item_SrNo", "Prod_Batch_ID"],
    "SEC65_EXBOND_INFO": ["Inv_SrNo", "Item_SrNo", "GSTInvoiceNo"],
    "LICENSE": ["Inv_SrNo", "Item_SrNo", "License_No"],
}

# Logi-Sys writes some columns as the code ICES wants and some as the word a
# person reads, depending on which of its two exports produced the file. The
# same value in two spellings is not a difference; these are the pairs seen
# across the corpus, and anything else is reported.
SYNONYMS = [
    {"S", "SEA"},
    {"A", "AIR"},
    {"L", "LAND"},
    {"H", "HOME", "HOME CONSUMPTION"},
    {"W", "WAREHOUSING", "INTO BOND"},
    {"X", "EX-BOND", "EX BOND"},
    # Logi-Sys spells the term with an ampersand, ICES as `CF`; our workbook
    # carries the vendor's spelling, but a hand-corrected reference may not.
    {"C&F", "CFR", "CF"},
    {"C&I", "CI"},
    {"N", "NORMAL"},
    {"P", "PRIOR"},
]


def equivalent(a, b):
    return any(a in group and b in group for group in SYNONYMS)


def mirrors(column):
    """A default that repeats another column of the same row rather than a literal."""
    return ("mirror", column)


# Columns Logi-Sys fills from a screen default that we deliberately leave blank.
#
# This is not a list of columns to forgive. Each names *the value the dropdown
# pre-selects*, and only that value is a refusal — anything else Logi-Sys wrote
# there is a real answer we are missing. `IGST_ExemptionNotnType` is the case
# that proves it: `C` on nine corpus lines, which is the default, and `G` on
# one, which is a GST notification granting the exemption that we never found.
#
# The classification is also self-correcting: it only ever applies to a cell we
# left blank, so the day we start writing one of these the cell becomes a match
# and never reaches here.
#
# Why each is refused, with the evidence: docs/boe-mapping/06-items.md §16,
# §18-§22, and docs/logisys-exit/phase-1-ices-conventions.md. In short,
# `<TABLE>SBEDUTY` is an optional segment of a final Bill of Entry and its
# exemption-type field is optional within it, so ICES asks for none of them.
VENDOR_DEFAULTS = {
    # §19 — the Plus/Minus/Higher/Lower dropdown. With no specific part in the
    # notification every flag computes the same duty, so the screen shows Plus.
    "ITEMS.IGST_LevyNotnFlag": "+",
    "ITEMS.IGST_ExemptionNotnFlag": "+",
    "ITEMS.IGST_CompCessNotnFlag": "+",
    "ITEMS.IGST_CompCessExemptionNotnFlag": "+",
    # §18 — "Customs Notn." / "GST Notn.", defaulting C for IGST and G for
    # cess. liv_job1 writes both with no exemption notification present at all.
    "ITEMS.IGST_ExemptionNotnType": "C",
    "ITEMS.IGST_CompCessExemptionNotnType": "G",
    # §21 — the two "Calc. Method" dropdowns, written whether or not the
    # notification states that basis. liv_job1 writes both on a line with no
    # trade remedy at all.
    "ITEMS.ADD_Basis": "AV",
    "ITEMS.CVD_CalculatedOn": "1",
    # §22 — the SBEDUTY catch-all's exemption type, on a line that has no
    # SBEDUTY row for it to belong to.
    "ITEMS.DUTY_ExemptionType": "N",
    # §16 — the AIDC levy pair repeated into the exemption pair. The serial is
    # not a constant (17 on seven corpus lines, 18 on three); what makes it the
    # default is that it repeats the levy serial of the same row.
    "ITEMS.AIDC_ExemptionNotn": "011/2021",
    "ITEMS.AIDC_ExemptionNotnSrNo": mirrors("AIDC_LevyNotnSrNo"),
}


def is_refusal(sheet, column, ours, theirs, their_row):
    """True when a blank of ours is Logi-Sys' dropdown rather than a gap."""
    rule = VENDOR_DEFAULTS.get("%s.%s" % (sheet, column))
    if rule is None or ours or not theirs:
        return False
    if isinstance(rule, tuple):
        return theirs == norm(their_row.get(rule[1]))
    return theirs == rule

MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()


def norm(value):
    """A cell as it would be read, not as it was typed."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if not text:
        return ""

    # A date in either file's spelling: Logi-Sys writes DD-MMM-YYYY.
    m = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", text)
    if m and m.group(2).upper() in MONTHS:
        return "%s-%02d-%02d" % (m.group(3), MONTHS.index(m.group(2).upper()) + 1, int(m.group(1)))

    try:
        number = float(text.replace(",", ""))
    except ValueError:
        return " ".join(text.upper().split())
    # Trailing zeros are formatting, not a different figure.
    return ("%.6f" % number).rstrip("0").rstrip(".")


def read_sheet(path, name):
    book = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if name not in book.sheetnames:
        return [], []
    sheet = book[name]
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return [], []
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    body = []
    for row in rows[1:]:
        cells = {header[i]: row[i] for i in range(min(len(header), len(row))) if header[i]}
        if any(norm(v) for v in cells.values()):
            body.append(cells)
    return header, body


def key_of(sheet, row):
    return tuple(norm(row.get(column)) for column in ROW_KEYS.get(sheet, []))


def align(sheet, ours, theirs):
    """Pair our rows with theirs — on the sheet's key where it has one."""
    if sheet not in ROW_KEYS:
        return list(zip(ours + [None] * max(0, len(theirs) - len(ours)),
                        theirs + [None] * max(0, len(ours) - len(theirs))))
    mine = {key_of(sheet, r): r for r in ours}
    yours = {key_of(sheet, r): r for r in theirs}
    return [(mine.get(k), yours.get(k)) for k in list(yours) + [k for k in mine if k not in yours]]


def compare(folder, ours_path, theirs_path):
    book = openpyxl.load_workbook(theirs_path, data_only=True, read_only=True)
    sheets = book.sheetnames
    tally = Counter()
    by_sheet = {}
    differences = []

    for sheet in sheets:
        header, theirs = read_sheet(theirs_path, sheet)
        _, ours = read_sheet(ours_path, sheet)
        if not header or (not ours and not theirs):
            continue
        if len(ours) != len(theirs):
            differences.append(
                {"sheet": sheet, "column": "(row count)", "ours": len(ours), "theirs": len(theirs)}
            )
            tally["rows"] += 1

        for index, (mine, yours) in enumerate(align(sheet, ours, theirs)):
            for column in header:
                a = norm((mine or {}).get(column))
                b = norm((yours or {}).get(column))
                sheet_tally = by_sheet.setdefault(sheet, Counter())
                if a == b or (a and b and equivalent(a, b)):
                    if a:
                        tally["same"] += 1
                        sheet_tally["same"] += 1
                    continue
                refusal = False
                if not a and b:
                    # Counted as a blank as well, so `agreement` below keeps
                    # meaning what it meant before and stays comparable with
                    # corpus-baseline.json. `refused` is a breakdown of it,
                    # never a fourth bucket.
                    tally["blank"] += 1
                    sheet_tally["blank"] += 1
                    refusal = is_refusal(sheet, column, a, b, yours or {})
                    if refusal:
                        tally["refused"] += 1
                        sheet_tally["refused"] += 1
                    kind = "their screen default, refused" if refusal else "we left it blank"
                elif a and not b:
                    tally["extra"] += 1
                    sheet_tally["extra"] += 1
                    kind = "they left it blank"
                else:
                    tally["differ"] += 1
                    sheet_tally["differ"] += 1
                    kind = "different"
                differences.append(
                    {
                        "sheet": sheet,
                        "row": index + 1,
                        "column": column,
                        "kind": kind,
                        "refused": refusal,
                        "ours": (mine or {}).get(column),
                        "theirs": (yours or {}).get(column),
                    }
                )

    return tally, by_sheet, differences


def main(folders):
    os.makedirs(REPORT_DIR, exist_ok=True)
    scorecard = []
    column_misses = Counter()
    refused_columns = Counter()
    sheet_totals = {}

    for folder in folders:
        ours = sorted(glob.glob(os.path.join(OUT_ROOT, folder, "logisys-*.xlsx")))
        theirs = sorted(
            glob.glob(os.path.join(ERP_ROOT, folder, "JobData_*.xlsx"))
            + glob.glob(os.path.join(ERP_ROOT, folder, "logisys-*.xlsx"))
        )
        if not ours or not theirs:
            print("· %-10s %s" % (folder, "no export" if not ours else "no Logi-Sys workbook to compare"))
            continue

        tally, by_sheet, differences = compare(folder, ours[-1], theirs[-1])
        for sheet, counts in by_sheet.items():
            for key, n in counts.items():
                sheet_totals.setdefault(sheet, Counter())[key] += n
        for d in differences:
            name = "%s.%s" % (d["sheet"], d["column"])
            if d.get("refused"):
                refused_columns[name] += 1
            else:
                column_misses[name] += 1

        filled = tally["same"] + tally["differ"] + tally["blank"]
        accuracy = (100.0 * tally["same"] / filled) if filled else 0.0
        sought = filled - tally["refused"]
        apart = (100.0 * tally["same"] / sought) if sought else 0.0
        scorecard.append((folder, accuracy, apart, tally, os.path.basename(theirs[-1])))
        print(
            "%-10s %5.1f%% of their filled columns match  (%d same, %d different, %d blank on our side"
            "%s, %d only ours)"
            % (folder, accuracy, tally["same"], tally["differ"], tally["blank"],
               " of which %d refused" % tally["refused"] if tally["refused"] else "", tally["extra"])
        )

        with open(os.path.join(REPORT_DIR, "%s.md" % folder), "w") as out:
            out.write("# %s\n\n" % folder)
            out.write("Ours: `%s`\nLogi-Sys: `%s`\n\n" % (os.path.basename(ours[-1]), os.path.basename(theirs[-1])))
            out.write("%d columns agree, %d differ, %d they filled and we did not, %d we filled and they did not.\n"
                      % (tally["same"], tally["differ"], tally["blank"], tally["extra"]))
            if tally["refused"]:
                out.write("%d of those blanks are a screen default of theirs that we refuse; they are listed at the end.\n"
                          % tally["refused"])
            out.write("\n")
            sheet = None
            for d in differences:
                if d.get("refused"):
                    continue
                if d["sheet"] != sheet:
                    sheet = d["sheet"]
                    out.write("\n## %s\n\n| row | column | ours | Logi-Sys |\n|---|---|---|---|\n" % sheet)
                out.write("| %s | %s | %s | %s |\n" % (d.get("row", ""), d["column"], d.get("ours", ""), d.get("theirs", "")))
            refusals = [d for d in differences if d.get("refused")]
            if refusals:
                out.write("\n## Their screen defaults, refused\n\n"
                          "Not gaps: Logi-Sys' dropdown pre-selects these and the notification does not "
                          "state them. See docs/boe-mapping/06-items.md.\n\n"
                          "| row | column | Logi-Sys |\n|---|---|---|\n")
                for d in refusals:
                    out.write("| %s | %s.%s | %s |\n" % (d.get("row", ""), d["sheet"], d["column"], d.get("theirs", "")))

    with open(os.path.join(REPORT_DIR, "SCORECARD.md"), "w") as out:
        out.write("# Corpus scorecard\n\nOur export against the workbook Logi-Sys filed for the same job.\n\n")
        out.write("`agreement` counts every column they filled, including the screen defaults we refuse, "
                  "so it stays comparable with `corpus-baseline.json` — it is the number `corpus-gate.mts` "
                  "watches. `refusals apart` is the same figure over the columns we are actually trying to "
                  "fill.\n\n")
        out.write("| job | agreement | refusals apart | same | different | blank on our side | of which refused | only ours | compared against |\n"
                  "|---|---|---|---|---|---|---|---|---|\n")
        for folder, accuracy, apart, tally, reference in scorecard:
            out.write("| %s | %.1f%% | %.1f%% | %d | %d | %d | %d | %d | %s |\n"
                      % (folder, accuracy, apart, tally["same"], tally["differ"], tally["blank"],
                         tally["refused"], tally["extra"], reference))
        # Which sheet the disagreement is on changes what it means. A
        # SUPPORTING_DOCS row carries the eSanchit IRN and the upload time,
        # which exist only once the documents have been lodged — a column blank
        # on our side there is the workbook being filed before the filing, not
        # the export being short.
        out.write("\n## Where the disagreement is\n\n| sheet | agreement | refusals apart | same | different | blank on our side | of which refused | only ours |\n|---|---|---|---|---|---|---|---|\n")
        for sheet in sorted(sheet_totals, key=lambda s: -sum(sheet_totals[s].values())):
            c = sheet_totals[sheet]
            filled = c["same"] + c["differ"] + c["blank"]
            sought = filled - c["refused"]
            out.write("| %s | %s | %s | %d | %d | %d | %d | %d |\n" % (
                sheet,
                ("%.1f%%" % (100.0 * c["same"] / filled)) if filled else "—",
                ("%.1f%%" % (100.0 * c["same"] / sought)) if sought else "—",
                c["same"], c["differ"], c["blank"], c["refused"], c["extra"]))

        out.write("\n## The columns that go wrong most often\n\n"
                  "A to-do list, so the screen defaults below are not in it.\n\n| column | jobs |\n|---|---|\n")
        for column, count in column_misses.most_common(40):
            out.write("| %s | %d |\n" % (column, count))

        out.write("\n## Their screen defaults, refused\n\n")
        if refused_columns:
            out.write("Logi-Sys' dropdown pre-selects these and we do not write them: the notification does "
                      "not state them and `<TABLE>SBEDUTY` is an optional segment whose exemption-type field "
                      "is optional within it. Counted apart so a decision does not read as a defect — see "
                      "docs/boe-mapping/06-items.md and docs/logisys-exit/phase-1-ices-conventions.md.\n\n"
                      "Only the pre-selected value counts as a refusal. The same column carrying anything "
                      "else is a real answer we are missing, and stays in the table above.\n\n"
                      "| column | default | jobs |\n|---|---|---|\n")
            for column, count in refused_columns.most_common():
                rule = VENDOR_DEFAULTS.get(column)
                shown = ("same as %s" % rule[1]) if isinstance(rule, tuple) else "`%s`" % rule
                out.write("| %s | %s | %d |\n" % (column, shown, count))
        else:
            out.write("None in this run.\n")

    with open(os.path.join(REPORT_DIR, "scorecard.json"), "w") as out:
        json.dump(
            {
                "jobs": [
                    # `agreement` is what corpus-gate.mts compares; do not
                    # redefine it. `agreementRefusalsApart` is the same figure
                    # over the columns we are trying to fill.
                    {"folder": f, "agreement": round(a, 1), "agreementRefusalsApart": round(x, 1),
                     **dict(t), "reference": r}
                    for f, a, x, t, r in scorecard
                ],
                "columnMisses": column_misses.most_common(),
                "refusedColumns": refused_columns.most_common(),
            },
            out,
            indent=2,
        )
    print("\nreports → %s" % REPORT_DIR)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        args = sorted(
            (d for d in os.listdir(ERP_ROOT) if re.fullmatch(r"(ex|liv)_job\d+", d)),
            key=lambda d: (d.split("_")[0], int(re.sub(r"\D", "", d))),
        )
    main(args)
