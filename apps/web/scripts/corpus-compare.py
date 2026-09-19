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
    {"C&F", "CFR"},
    {"N", "NORMAL"},
    {"P", "PRIOR"},
]


def equivalent(a, b):
    return any(a in group and b in group for group in SYNONYMS)

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
                if not a and b:
                    tally["blank"] += 1
                    sheet_tally["blank"] += 1
                    kind = "we left it blank"
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
                        "ours": (mine or {}).get(column),
                        "theirs": (yours or {}).get(column),
                    }
                )

    return tally, by_sheet, differences


def main(folders):
    os.makedirs(REPORT_DIR, exist_ok=True)
    scorecard = []
    column_misses = Counter()
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
            column_misses["%s.%s" % (d["sheet"], d["column"])] += 1

        filled = tally["same"] + tally["differ"] + tally["blank"]
        accuracy = (100.0 * tally["same"] / filled) if filled else 0.0
        scorecard.append((folder, accuracy, tally, os.path.basename(theirs[-1])))
        print(
            "%-10s %5.1f%% of their filled columns match  (%d same, %d different, %d blank on our side, %d only ours)"
            % (folder, accuracy, tally["same"], tally["differ"], tally["blank"], tally["extra"])
        )

        with open(os.path.join(REPORT_DIR, "%s.md" % folder), "w") as out:
            out.write("# %s\n\n" % folder)
            out.write("Ours: `%s`\nLogi-Sys: `%s`\n\n" % (os.path.basename(ours[-1]), os.path.basename(theirs[-1])))
            out.write("%d columns agree, %d differ, %d they filled and we did not, %d we filled and they did not.\n\n"
                      % (tally["same"], tally["differ"], tally["blank"], tally["extra"]))
            sheet = None
            for d in differences:
                if d["sheet"] != sheet:
                    sheet = d["sheet"]
                    out.write("\n## %s\n\n| row | column | ours | Logi-Sys |\n|---|---|---|---|\n" % sheet)
                out.write("| %s | %s | %s | %s |\n" % (d.get("row", ""), d["column"], d.get("ours", ""), d.get("theirs", "")))

    with open(os.path.join(REPORT_DIR, "SCORECARD.md"), "w") as out:
        out.write("# Corpus scorecard\n\nOur export against the workbook Logi-Sys filed for the same job.\n\n")
        out.write("| job | agreement | same | different | blank on our side | only ours | compared against |\n|---|---|---|---|---|---|---|\n")
        for folder, accuracy, tally, reference in scorecard:
            out.write("| %s | %.1f%% | %d | %d | %d | %d | %s |\n"
                      % (folder, accuracy, tally["same"], tally["differ"], tally["blank"], tally["extra"], reference))
        # Which sheet the disagreement is on changes what it means. A
        # SUPPORTING_DOCS row carries the eSanchit IRN and the upload time,
        # which exist only once the documents have been lodged — a column blank
        # on our side there is the workbook being filed before the filing, not
        # the export being short.
        out.write("\n## Where the disagreement is\n\n| sheet | agreement | same | different | blank on our side | only ours |\n|---|---|---|---|---|---|\n")
        for sheet in sorted(sheet_totals, key=lambda s: -sum(sheet_totals[s].values())):
            c = sheet_totals[sheet]
            filled = c["same"] + c["differ"] + c["blank"]
            out.write("| %s | %s | %d | %d | %d | %d |\n" % (
                sheet,
                ("%.1f%%" % (100.0 * c["same"] / filled)) if filled else "—",
                c["same"], c["differ"], c["blank"], c["extra"]))

        out.write("\n## The columns that go wrong most often\n\n| column | jobs |\n|---|---|\n")
        for column, count in column_misses.most_common(40):
            out.write("| %s | %d |\n" % (column, count))

    with open(os.path.join(REPORT_DIR, "scorecard.json"), "w") as out:
        json.dump(
            {
                "jobs": [
                    {"folder": f, "agreement": round(a, 1), **dict(t), "reference": r}
                    for f, a, t, r in scorecard
                ],
                "columnMisses": column_misses.most_common(),
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
