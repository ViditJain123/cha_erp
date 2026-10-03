#!/usr/bin/env python3
"""
Reads the assessed Bills of Entry ICES printed for the corpus jobs into a JSON
fixture the duty engine is tested against.

    python3 packages/core/scripts/build-processed-be-fixtures.py [ERP_ROOT]

ERP_ROOT defaults to the directory above the repository, where the corpus job
folders live (`ex_job12/Processed BE_I-14214_….pdf`). The PDFs are a customer's
documents and stay outside the repo; the fixture keeps only what the duty
engine needs — codes, quantities, values, rates and amounts — and none of the
names, addresses, IEC or GSTIN printed beside them.

## Why this is the authority

A processed BE is what Customs *assessed*: the assessable value ICES arrived at
and every duty it charged, per item, with the notification and serial it
applied. Our checklist is a prediction of exactly this document, so it is the
test the duty engine has to pass.

## How it is read

`pdftotext -layout` scrambles the duty grid — its columns come out as separate
text runs. PyMuPDF's words carry positions, and every block of the BE is a row
of numbered column headings ("1. BCD 2.CVD_05 3.SWS …") with the values on the
lines beneath it, so a value belongs to the heading whose span its left edge
falls in. Rows are matched by their left-margin label ("Notn No.", "Rate",
"Amount"); the rotated "ASSESSED COPY" watermark and the sideways section
letters are filtered out by what a value in that row may look like.
"""

from __future__ import annotations

import glob
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF is required: pip install pymupdf")

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "packages" / "core" / "test" / "fixtures" / "processed-be.json"

NUMBER = re.compile(r"^-?\d*\.?\d+%?$")
SERIAL = re.compile(r"^[A-Z]{0,4}\d+[A-Z]?(\(\w+\))?$")
NOTIFICATION = re.compile(r"^\d{3}/\d{4}$")


def lines_of(doc) -> list[tuple[int, float, list[tuple[float, str]]]]:
    """Every text line of the document as (page, y, [(x, word)]), in reading order."""
    out = []
    for number, page in enumerate(doc):
        rows: dict[int, list[tuple[float, str]]] = {}
        for x0, y0, _x1, _y1, word, *_ in page.get_text("words"):
            rows.setdefault(round(y0), []).append((x0, word))
        for y in sorted(rows):
            out.append((number, y, sorted(rows[y])))
    return out


def below(lines, i: int, min_x: float = 60) -> list[tuple[float, str]]:
    """The words of the first line after `i` that has any past the margin.

    The sideways section letters ("A.", "C.") sit alone on a line of their own
    between a heading and its values, and are not the values.
    """
    for j in range(i + 1, min(i + 5, len(lines))):
        words = [(x, w) for x, w in lines[j][2] if x > min_x]
        if words:
            return words
    return []


def text(line) -> str:
    return " ".join(w for _, w in line[2])


def columns(header: list[tuple[float, str]], min_x: float = 95) -> list[tuple[float, str]]:
    """Numbered headings → [(left x, name)]: '1.' 'BCD' → (111, 'BCD')."""
    cols: list[list] = []
    for x, w in header:
        if x < min_x:
            continue
        m = re.match(r"^(\d+)\.(.*)$", w)
        if m:
            cols.append([x, m.group(2)])
        elif cols:
            cols[-1][1] = f"{cols[-1][1]} {w}".strip()
    return [(x, name.strip()) for x, name in cols]


def assign(values: list[tuple[float, str]], cols: list[tuple[float, str]], slack: float = 25) -> dict[str, str]:
    """Each value to the heading whose span its left edge falls in.

    A value may start a little left of its heading (right-aligned amounts are
    wider than the heading), so a span opens `slack` points before it.
    """
    out: dict[str, str] = {}
    for x, w in values:
        owner = None
        for i, (cx, name) in enumerate(cols):
            nxt = cols[i + 1][0] if i + 1 < len(cols) else float("inf")
            if cx - slack <= x < nxt - slack:
                owner = name
        if owner is not None:
            out[owner] = f"{out[owner]} {w}" if owner in out else w
    return out


def num(s: str | None) -> float | None:
    if s is None or s == "":
        return None
    s = s.rstrip("%")
    try:
        return float(s)
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# Part I — header and exchange rates
# --------------------------------------------------------------------------- #

def read_header(lines) -> dict:
    header: dict = {"exchangeRates": {}}
    for i, line in enumerate(lines):
        t = text(line)
        if "Port Code" in t and "BE No" in t and "be" not in header:
            words = [w for _, w in below(lines, i, 300)]
            header["be"] = {"port": words[0], "number": words[1], "date": "-".join(reversed(words[2].split("/"))), "type": words[3]}
        for m in re.finditer(r"(\d+)\s*([A-Z]{3})\s*=\s*([\d.]+)\s*INR", t):
            header["exchangeRates"][m.group(2)] = float(m.group(3)) / float(m.group(1))
    return header


# --------------------------------------------------------------------------- #
# Part II — invoices
# --------------------------------------------------------------------------- #

def read_invoices(lines) -> list[dict]:
    invoices: list[dict] = []
    current: dict | None = None
    listing: list | bool = False  # the item list's columns, while inside one
    for i, line in enumerate(lines):
        t = text(line)
        if listing and not re.match(r"^\d+ \d{8} ", t):
            listing = False
        if t.startswith("1.S.NO 2.INVOICE NO."):
            words = below(lines, i)
            current = {"sno": int(words[0][1]), "items": []}
            invoices.append(current)
        elif current is None:
            continue
        elif t.startswith("1.INV VALUE"):
            cols = columns(line[2], min_x=55)
            got = assign(below(lines, i, 55), cols)
            current["invoiceValue"] = num(got.get("INV VALUE"))
            for key, name in (("freight", "FREIGHT"), ("insurance", "INSURANCE"), ("hss", "HSS."), ("loading", "LOADING"), ("commission", "COMMN")):
                if got.get(name):
                    current[key] = got[name]
        elif t.startswith("14.Cur"):
            current["currency"] = line[2][1][1]
        elif t.startswith("15.Term"):
            current["terms"] = line[2][1][1]
        elif t.startswith("7.COO") and "14.ASS. VALUE" in t:
            cols = columns(line[2], min_x=55)
            # The values sit a line or two below, after the sideways section letter.
            for j in range(i + 1, min(i + 4, len(lines))):
                vals = [(x, w) for x, w in lines[j][2] if x > 55 and NUMBER.match(w)]
                if vals:
                    got = assign(vals, cols)
                    current["assessableValue"] = num(got.get("ASS. VALUE"))
                    if got.get("MISC CHARGE"):
                        current["miscCharge"] = got["MISC CHARGE"]
                    break
        elif t.startswith("1.S NO. 2.CTH"):
            listing = columns(line[2], min_x=55)
        elif listing and re.match(r"^\d+ \d{8} ", t):
            words = line[2]
            got = assign([(x, w) for x, w in words if NUMBER.match(w) or re.fullmatch(r"[A-Z]{3}", w)], listing, slack=12)
            current["items"].append(
                {
                    "sno": int(words[0][1]),
                    "cth": words[1][1],
                    "unitPrice": num((got.get("UNIT PRICE") or "").split(" ")[-1]),
                    "quantity": num((got.get("QUANTITY") or "").split(" ")[-1]),
                    "uqc": (got.get("UQC") or "").split(" ")[-1] or None,
                    "amount": num((got.get("AMOUNT") or "").split(" ")[-1]),
                }
            )
    return invoices


# --------------------------------------------------------------------------- #
# Part III — duties, per item
# --------------------------------------------------------------------------- #

GRID_ROWS = {"Notn No.": "notification", "Notn SNo.": "serial", "Rate": "rate", "Amount": "amount", "Duty Fg": "foregone"}


def read_items(lines) -> list[dict]:
    items: list[dict] = []
    item: dict | None = None
    grid: tuple[str, list] | None = None
    for i, line in enumerate(lines):
        t = text(line)
        words = line[2]
        if t.startswith("1.INVSNO 2.ITEMSN"):
            vals = [w for x, w in below(lines, i)]
            item = {"invoice": int(vals[0]), "item": int(vals[1]), "cth": vals[2], "duties": {}}
            items.append(item)
            grid = None
        elif item is None:
            continue
        elif t.startswith("11.UPI"):
            got = assign(below(lines, i), columns(words, min_x=60), slack=10)
            item.update(
                {
                    "unitPrice": num(got.get("UPI")),
                    "origin": got.get("COO"),
                    "quantity": num(got.get("C.QTY")),
                    "uqc": got.get("C.UQC"),
                    "endUse": got.get("END USE"),
                }
            )
        elif t.startswith("23.PRODN"):
            vals = [(x, w) for x, w in below(lines, i) if NUMBER.match(w) and x > 380]
            item["assessableValue"] = num(next((w for x, w in vals if x < 500), None))
            item["totalDuty"] = num(next((w for x, w in vals if x >= 500), None))
        elif t.startswith("DUTY ") and columns(words):
            # "DUTY" also sits in the margin of a data row ("DUTY Notn SNo."),
            # so only a line that carries numbered headings opens a grid.
            grid = ("B" if " BCD" in t else "C1" if "SP EXD" in t else "C2", columns(words))
        elif grid is not None:
            label = " ".join(w for x, w in words if 55 < x < 100)
            field = GRID_ROWS.get(label)
            if not field:
                continue
            ok = NOTIFICATION if field == "notification" else SERIAL if field == "serial" else NUMBER
            vals = [(x, w) for x, w in words if x >= 100 and ok.match(w)]
            for name, value in assign(vals, grid[1]).items():
                duty = item["duties"].setdefault(name, {})
                duty[field] = value if field in ("notification", "serial") else num(value)
    # A duty nobody charged, cited or exempted is noise in the fixture.
    for it in items:
        it["duties"] = {k: v for k, v in it["duties"].items() if any(x not in (None, 0, 0.0) for x in v.values())}
    return items


def main() -> None:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO.parent
    fixtures = []
    for path in sorted(glob.glob(str(root / "ex_job*" / "Processed*BE*.pdf"))):
        doc = fitz.open(path)
        lines = lines_of(doc)
        folder = Path(path).parent.name
        job = re.search(r"I-\d+", Path(path).name)
        be = {
            "folder": folder,
            "job": job.group(0) if job else None,
            **read_header(lines),
            "invoices": read_invoices(lines),
            "items": read_items(lines),
        }
        fixtures.append(be)
        print(f"  {folder}: BE {be['be']['number']} type {be['be']['type']}, "
              f"{len(be['invoices'])} invoices, {len(be['items'])} items")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"_generated": "python3 packages/core/scripts/build-processed-be-fixtures.py", "bills": fixtures}, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
