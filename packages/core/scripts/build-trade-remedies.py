#!/usr/bin/env python3
"""
Builds the trade-remedy master — anti-dumping duty (ADD), safeguard duty and
countervailing duty (CVD) rows — from the CBIC notification PDFs in the customs
corpus.

    pip install pymupdf
    python3 packages/core/scripts/build-trade-remedies.py

Writes
    src/masters/generated/items/trade-remedies.json
    src/masters/generated/items/trade-remedies.REPORT.md

It feeds the Logi-Sys ITEMS columns ADD_Notn, ADD_NotnSrNo, CTHSrNo, SuppSrNo,
ADD_Basis, ADD_%Rate, ADD_Currency, ADD_AmountPerUnit, ADD_AmountUnit,
Safeguard_Duty_Notn/NotnSrNo and CVD_Notn/NotnSrNo/Rate/... .

## How a notification becomes rows

1. Every PDF in data/customs-corpus/notifications/ whose category is
   "Anti Dumping Duty", "Safeguards" or "CVD" is joined to its record in
   index/cbic-notifications.json by the numeric id at the end of the filename.
   The index supplies number, date and category; the PDF supplies everything
   else. Index records with no PDF are reported.

2. Each document is classified by its operative words, not its title:
   "hereby imposes / continues / levies" -> an imposing notification
   "hereby rescinds"                     -> a rescission
   "following amendment(s)"              -> an amendment (incl. extensions)
   CORRIGENDUM                           -> an erratum, applied ab initio
   Fourteen PDFs are page images; on macOS they are OCR'd with Vision (a small
   Swift program compiled into the temp dir, output cached there) so their
   validity / extension / supersession prose can be read. OCR text never feeds
   a duty table: a scanned imposing notification goes to `unparsed`.

3. Base validity comes from the notification's own paragraph: "for a period of
   five years ... from the date of publication", "... from the date of
   imposition of the provisional duty (i.e. <date>)", "shall remain in force up
   to and inclusive of <date>", "co-terminus with notification No. X". Failing
   that, a period stated in the CBIC index title; failing that, the statutory
   default (5 years; 6 months when provisional) with validityInferred: true.
   Safeguard notifications take their window from their dated rate periods.

4. Later documents move that window, in date order:
   - an amendment inserting "shall remain in force up to and inclusive of X"
     (or substituting that date) sets validUntil = X;
   - a rescission ends the notification the day before it takes effect;
   - an imposing notification "in supersession of" an older one ends the older
     one the day before; a final duty that runs from the provisional duty's
     date ends that provisional notification the day before the final one.

5. The duty table is read with PyMuPDF's ruled-table finder (house style of
   build-masters.py). Column roles come from the header words (matched with
   spaces removed, because narrow cells break words) and are cross-checked
   against the operative paragraph's own "column (N)" references, so a header
   misread that swaps two country columns is refused. Cells are placed by
   x-overlap; "-do-" repeats the cell above; a cell merged down from the row
   above is inherited; a row without a serial continues the row above, or is a
   specification sub-row when it carries its own duty. A table on a later page
   continues the previous one. Serials must run 1..n; a gap is accepted only
   when the page text shows the notification itself skips the number. Every
   row must yield a tariff code, countries, a party and a duty whose basis,
   unit and currency are understood — otherwise the row is refused and listed
   in `unparsed` with the reason. Tariff codes are stored digits-only.

6. Amendments and corrigenda that change the table are applied as dated
   versions: the old row keeps its window to the day before the change takes
   effect ("shall come into force from ..."), a copy carries the new value.
   Handled forms: a substituted Table (parsed from the amending PDF);
   "for the figures 'A' [or 'A2'] ... the figures 'B' shall be substituted /
   shall be omitted" (tariff codes, incl. omnibus Finance-Act/HSN alignments);
   "against S. No. n, in column (k), for the entry/words 'A', the entry 'B'";
   corrigenda "for 'A' read 'B'" and "omit '...'" in a column; a corrigendum
   that turns the duty into a landed-value reference price. Inserted notes,
   excluded products and prose-only edits are recorded as `scopeAmendments`.
   Anything else is listed as `unappliedAmendments` on the affected rows and in
   `unparsed`, so a stale value is never silent.

Only rows whose window overlaps 2024-01-01 .. AS_OF are written; older
notifications are counted as skipped.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import re
import sys
from collections import Counter, defaultdict
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
OUT = ROOT / "src" / "masters" / "generated" / "items"

AS_OF = dt.date(2026, 9, 13)
WINDOW_FROM = dt.date(2024, 1, 1)

CATEGORIES = {"Anti Dumping Duty": "ADD", "Safeguards": "SAFEGUARD", "CVD": "CVD"}
SUFFIX = {"ADD": "ADD", "SAFEGUARD": "SG", "CVD": "CVD"}


# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #

PUNCTUATION = {
    "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
    "‘": "'", "’": "'", "‚": "'", "′": "'", "`": "'",
    "“": '"', "”": '"', "„": '"', "″": '"', "‟": "'", "‛": "'",
    " ": " ", "Â": "", "": " ", "​": "",
    "ﬁ": "fi", "ﬂ": "fl",
}


def prose(value: str | None) -> str:
    value = value or ""
    for bad, good in PUNCTUATION.items():
        value = value.replace(bad, good)
    return re.sub(r"\s+", " ", value).strip()


MONTHS = {
    m: i + 1
    for i, names in enumerate(
        [
            ("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"),
            ("may",), ("june", "jun"), ("july", "jul"), ("august", "aug"),
            ("september", "sept", "sep"), ("october", "oct"), ("november", "nov"),
            ("december", "dec"),
        ]
    )
    for m in names
}
MONTH_RE = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?"
DATE_WORDS = (
    r"(?P<d>\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?,?\s*(?P<m>" + MONTH_RE + r")\s*,?\s*(?P<y>\d{4})"
)
DATE_US = r"(?P<m2>" + MONTH_RE + r")\s+(?P<d2>\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(?P<y2>\d{4})"
DATE_NUM = r"(?P<d3>\d{1,2})\s*[./-]\s*(?P<m3>\d{1,2})\s*[./-]\s*(?P<y3>\d{4})"
DATE_RE = re.compile(r"(?:" + DATE_WORDS + r"|" + DATE_US + r"|" + DATE_NUM + r")", re.I)


def to_date(match: re.Match) -> dt.date | None:
    g = match.groupdict()
    try:
        if g.get("d"):
            return dt.date(int(g["y"]), MONTHS[g["m"].lower().rstrip(".")], int(g["d"]))
        if g.get("d2"):
            return dt.date(int(g["y2"]), MONTHS[g["m2"].lower().rstrip(".")], int(g["d2"]))
        if g.get("d3"):
            return dt.date(int(g["y3"]), int(g["m3"]), int(g["d3"]))
    except (ValueError, KeyError):
        return None
    return None


def first_date(text: str) -> dt.date | None:
    for m in DATE_RE.finditer(text):
        d = to_date(m)
        if d:
            return d
    return None


def add_period(start: dt.date, n: int, unit: str) -> dt.date:
    """Last day of a period of n units that begins on `start` (inclusive)."""
    unit = unit.lower()
    if unit.startswith("day"):
        return start + dt.timedelta(days=n - 1)
    months = n * 12 if unit.startswith("year") else n
    y, m = divmod(start.month - 1 + months, 12)
    y += start.year
    m += 1
    day = min(start.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return dt.date(y, m, day) - dt.timedelta(days=1)


NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "eighteen": 18, "twenty four": 24,
    "twenty-four": 24, "thirty": 30, "two hundred": 200, "one hundred and eighty": 180,
}


def number_word(value: str) -> int | None:
    value = value.lower().strip()
    if value.isdigit():
        return int(value)
    return NUMBER_WORDS.get(value)


# --------------------------------------------------------------------------- #
# Notification references
# --------------------------------------------------------------------------- #

REF_RE = re.compile(
    r"(?<![\d/])(\d{1,3})\s*/\s*((?:19|20)\d{2})\s*[-– ]*\s*(?:Customs|Cus|Cs)\.?\s*[\(\[]?\s*(ADD|CVD|SG)\b",
    re.I,
)


def key_of(kind: str, no: int, year: int) -> str:
    return f"{kind}:{no}/{year}"


def ref_keys(text: str) -> list[str]:
    out = []
    for m in REF_RE.finditer(text):
        kind = {"ADD": "ADD", "CVD": "CVD", "SG": "SAFEGUARD"}[m.group(3).upper()]
        k = key_of(kind, int(m.group(1)), int(m.group(2)))
        if k not in out:
            out.append(k)
    return out


def notification_label(kind: str, no: int, year: int) -> str:
    return f"{no}/{year}-Customs ({SUFFIX[kind]})"


def notification_short(no: int, year: int) -> str:
    return f"{no:03d}/{year}"


# --------------------------------------------------------------------------- #
# Documents
# --------------------------------------------------------------------------- #


class Doc:
    def __init__(self, path: Path, record: dict):
        self.path = path
        self.file = path.name
        self.record = record
        self.kind = CATEGORIES[record["notificationCategory"]]
        self.date = dt.date.fromisoformat(record["notificationDt"][:10])
        self.title = prose(record.get("notificationName"))
        m = re.match(r"\s*(\d{1,3})\s*/\s*(\d{4})", record["notificationNo"] or "")
        self.no = int(m.group(1)) if m else None
        self.year = int(m.group(2)) if m else None
        self.key = key_of(self.kind, self.no, self.year) if m else f"{self.kind}:{self.file}"
        self.label = notification_label(self.kind, self.no, self.year) if m else record["notificationNo"]
        self.corrigendum = "corrigendum" in (record["notificationNo"] or "").lower() or "Corrigendum" in self.file
        self._doc = None
        self.pages: list[str] = []
        try:
            self._doc = fitz.open(path)
            self.pages = [prose(p.get_text()) for p in self._doc]
        except Exception as exc:  # empty or broken download
            self.error = f"PDF could not be opened: {exc}"
        self.text = " ".join(self.pages)
        self.scan = self._doc is not None and len(self.text) < 200
        self.ocr = False
        if self.scan:
            pages = ocr_pages(path)
            if pages:
                self.pages = [ocr_clean(p) for p in pages]
                self.text = " ".join(self.pages)
                self.ocr = True

    @property
    def fitz(self):
        return self._doc

    def operative(self) -> str:
        """The operative part: from 'Now, therefore' (or the exercise of powers) on."""
        t = self.text
        m = re.search(r"Now,?\s*therefore", t, re.I)
        if m:
            return t[m.start():]
        m = re.search(r"In exercise of the powers", t, re.I)
        return t[m.start():] if m else t

    def body(self) -> str:
        """Operative text without the trailing publication 'Note'."""
        t = self.operative()
        m = re.search(r"\bNote\s*[:.-]+\s*(?:1\.\s*)?The principal notification", t, re.I)
        return t[: m.start()] if m else t


# --------------------------------------------------------------------------- #
# Scanned notifications
#
# Fourteen PDFs in the corpus are page images. On macOS the Vision framework
# reads them well enough to recover the operative prose (which notification is
# extended or rescinded, and to when). OCR text is never used for a duty table:
# a scanned notification's rows go to `unparsed`.
# --------------------------------------------------------------------------- #

OCR_SWIFT = r'''
import Foundation
import PDFKit
import Vision
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
for i in 0..<doc.pageCount {
    let page = doc.page(at: i)!
    let b = page.bounds(for: .mediaBox)
    let s: CGFloat = 3.0
    let ctx = CGContext(data: nil, width: Int(b.width * s), height: Int(b.height * s), bitsPerComponent: 8,
                        bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: b.width * s, height: b.height * s))
    ctx.scaleBy(x: s, y: s)
    page.draw(with: .mediaBox, to: ctx)
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: ctx.makeImage()!, options: [:]).perform([req])
    print("<<<PAGE>>>")
    let obs = (req.results ?? []).sorted { a, b in
        abs(a.boundingBox.midY - b.boundingBox.midY) > 0.008 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
    }
    for o in obs { if let t = o.topCandidates(1).first { print(t.string) } }
}
'''

_OCR_BIN: Path | None = None
OCR_AVAILABLE: bool | None = None


def ocr_pages(path: Path) -> list[str] | None:
    """Page texts of a scanned PDF via macOS Vision, cached in the temp dir."""
    global _OCR_BIN, OCR_AVAILABLE
    import hashlib
    import shutil
    import subprocess
    import tempfile

    cache = Path(tempfile.gettempdir()) / "trade-remedies-ocr"
    cache.mkdir(exist_ok=True)
    key = hashlib.sha1((path.name + str(path.stat().st_size)).encode()).hexdigest()[:16]
    cached = cache / f"{key}.txt"
    if cached.exists():
        return cached.read_text().split("<<<PAGE>>>")[1:]
    if OCR_AVAILABLE is False:
        return None
    if _OCR_BIN is None:
        swiftc = shutil.which("swiftc")
        if sys.platform != "darwin" or not swiftc:
            OCR_AVAILABLE = False
            return None
        src = cache / "ocr.swift"
        src.write_text(OCR_SWIFT)
        _OCR_BIN = cache / "ocr"
        if not _OCR_BIN.exists():
            r = subprocess.run([swiftc, "-O", str(src), "-o", str(_OCR_BIN)], capture_output=True)
            if r.returncode != 0:
                OCR_AVAILABLE = False
                return None
        OCR_AVAILABLE = True
    r = subprocess.run([str(_OCR_BIN), str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    cached.write_text(r.stdout)
    return r.stdout.split("<<<PAGE>>>")[1:]


def ocr_clean(text: str) -> str:
    # OCR renders superscript ordinals as quote marks: "9* March", "8' June", "24" June"
    text = re.sub(r"(\b\d{1,2})\s*(?:['*\"`]+\s*h?|'h)\s+(?=" + MONTH_RE + r")", r"\1th ", text)
    return prose(text)


def load_docs() -> list[Doc]:
    index = {r["id"]: r for r in json.loads(INDEX.read_text())}
    docs = []
    for path in sorted(NOTIFICATIONS.glob("*.pdf")):
        m = re.search(r"_(\d+)\.pdf$", path.name)
        record = index.get(int(m.group(1))) if m else None
        if not record or record["notificationCategory"] not in CATEGORIES:
            continue
        docs.append(Doc(path, record))
    docs.sort(key=lambda d: (d.date, d.no or 0))
    return docs


# --------------------------------------------------------------------------- #
# What a document does
# --------------------------------------------------------------------------- #

RESCIND_RE = re.compile(r"hereby\s+rescinds?\b", re.I)
AMEND_RE = re.compile(
    r"following\s+(?:further\s+)?amendments?|hereby\s+(?:directs|makes)[^.]{0,200}?amended|shall\s+be\s+amended|hereby\s+amends",
    re.I,
)
IMPOSE_RE = re.compile(r"hereby\s+(?:imposes?|continues?|extends?|levies|directs\s+that\s+the\s+anti-dumping)", re.I)


def classify(doc: Doc) -> str:
    if doc.corrigendum:
        return "CORRIGENDUM"
    body = doc.body()
    if RESCIND_RE.search(body):
        return "RESCIND"
    if AMEND_RE.search(body):
        return "AMEND"
    if re.search(r"provisional\s+assessment", doc.title, re.I) or re.search(
        r"hereby\s+(?:orders|directs)[^.]{0,120}provisional(?:ly)?\s+assess", body, re.I
    ):
        return "PROVISIONAL_ASSESSMENT"
    if IMPOSE_RE.search(body):
        return "IMPOSE"
    if doc.ocr and re.search(r"duty\s+imposed\s+under\s+this\s+notification\s+shall\s+be\s+(?:levied|effective)", body, re.I):
        return "IMPOSE"  # OCR lost the operative verb; the validity paragraph still says it imposes
    return "OTHER"


def is_omnibus(doc: Doc) -> bool:
    return bool(re.search(r"each\s+of\s+the\s+notifications|notifications?\s+(?:of\s+the\s+Government[^.]{0,80})?specified\s+in\s+column\s*\(2\)", doc.text, re.I))


def targets_of(doc: Doc) -> list[str]:
    """The notifications an amendment, rescission or corrigendum acts on.

    The publication note ("The principal notification No. X ...") names them
    reliably; failing that, the first notification cited after the operative
    verb. Only an omnibus amendment (a table of notifications) has several.
    """
    own = doc.key
    note = re.findall(r"principal\s+notification\s*(?:No\.?|number)?\s*([^,;]{0,60})", doc.text, re.I)
    keys = list(dict.fromkeys(k for n in note for k in ref_keys(n) if k != own))
    if keys and (len(keys) == 1 or is_omnibus(doc)):
        return keys
    body = doc.body() if not doc.corrigendum else doc.text
    m = re.search(r"(?:amendments?\s+in|rescinds?|In\s+the\s+notification|to\s+the\s+notification|amend(?:ed)?\s+the)\b(.*)", body, re.I | re.S)
    found = [k for k in ref_keys(m.group(1) if m else body) if k != own]
    if is_omnibus(doc):
        return list(dict.fromkeys(found))
    return found[:1]


PERIOD_RE = re.compile(
    r"(?:for\s+a\s+(?:further\s+)?period\s+of|for)\s+(?P<n>\d+|[a-z]+(?:[ -](?:hundred(?:\s+and\s+[a-z]+)?|four))?)\s*(?:\(\s*\d+\s*\)\s*)?(?P<unit>years?|months?|days)\b"
    r"(?P<mid>.{0,200}?)\bfrom\s+(?:the\s+)?(?:aforesaid\s+)?(?P<from>date\s+of\s+(?:the\s+|its\s+)?(?:publication|issue|issuance|notification|imposition)[^,;]{0,160}?(?=,|;|\.|\s+and\s+shall|\s+unless|$)|"
    + DATE_WORDS.replace("?P<", "?P<f_")
    + r")",
    re.I,
)
INFORCE_RE = re.compile(
    r"(?:remain\s+in\s+force|be\s+in\s+force|be\s+effective|be\s+levied|continue\s+to\s+be\s+in\s+force)\s+(?:up\s*to|upto|till|until)\s*(?:and\s+)?(?:including|inclusive\s+of)?\s*(?:the\s+)?("
    + DATE_WORDS
    + r")",
    re.I,
)


def provisional_start(doc: Doc, phrase: str, docs_by_key: dict) -> tuple[dt.date | None, str | None]:
    """Start date of 'the date of imposition of the provisional duty'.

    Read from an explicit "i.e. <date>" when the notification gives one;
    otherwise the provisional notification it cites is looked up in the index.
    """
    explicit = None
    m = re.match(r"[^,;:]{0,120}?,?\s*(?:i\.\s*e\.?|that\s+is|viz\.?|namely)\s*,?\s*(?:the\s+)?(" + DATE_WORDS + ")", phrase, re.I)
    if m:
        explicit = first_date(m.group(1))
    cited = [
        docs_by_key[k] for k in ref_keys(doc.text)
        if k != doc.key and k in docs_by_key and docs_by_key[k].date < doc.date
        and re.search(r"provisional", docs_by_key[k].title + " " + docs_by_key[k].text[:3000], re.I)
        and not re.search(r"provisional\s+assessment", docs_by_key[k].title, re.I)
    ]
    if explicit:
        same = [d for d in cited if d.date == explicit]
        return explicit, (same[0].key if same else None)
    if cited:
        prov = max(cited, key=lambda d: d.date)
        return prov.date, prov.key
    return None, None


def own_validity(doc: Doc, docs_by_key: dict) -> dict:
    """validFrom / validUntil from the notification's own words."""
    body = doc.body()
    provisional = bool(
        re.search(r"provisional\s+(?:anti-dumping|countervailing|safeguard)\s+duty", body[:1500], re.I)
        and re.search(r"imposes?\s+(?:on\s+the\s+subject\s+goods[^.]{0,80})?\s*(?:a\s+)?provisional", body, re.I)
    ) or bool(re.search(r"\bprovisional\b", doc.title, re.I) and not re.search(r"\bfinal\b|definitive", doc.title, re.I))
    result = {"validFrom": doc.date, "validUntil": None, "validityInferred": False, "provisional": provisional,
              "validityText": None, "provisionalOf": None, "coterminousWith": None}

    m = INFORCE_RE.search(body)
    if m and not re.search(r"notwithstanding", body[max(0, m.start() - 300): m.start()], re.I):
        d = first_date(m.group(1))
        if d:
            result["validUntil"] = d
            result["validityText"] = m.group(0)
            return result

    for m in PERIOD_RE.finditer(body):
        n = number_word(m.group("n"))
        if not n:
            continue
        frm = m.group("from")
        if re.match(r"date\s+of", frm, re.I):
            if re.search(r"provisional", body[m.start("from"): m.start("from") + 120], re.I):
                start, prov_key = provisional_start(doc, body[m.start("from"): m.start("from") + 260], docs_by_key)
                result["provisionalOf"] = prov_key
                if not start:
                    continue
            else:
                start = doc.date
        else:
            start = first_date(frm)
        if not start:
            continue
        result["validFrom"] = start
        result["validUntil"] = add_period(start, n, m.group("unit"))
        result["validityText"] = m.group(0)
        return result

    m = re.search(r"co-?\s*terminus|coterminous", body, re.I)
    if m:
        keys = [k for k in ref_keys(body[m.start(): m.start() + 400]) if k != doc.key]
        if keys:
            result["coterminousWith"] = keys[0]
            result["validityText"] = body[max(0, m.start() - 120): m.start() + 200]
            fm = re.search(r"effective\s+from\s+the\s+date\s+of\s+initiation[^.]{0,300}?dated\s+the\s+(" + DATE_WORDS + ")", body, re.I)
            if fm:
                result["validFrom"] = first_date(fm.group(1))
            return result

    # The CBIC index title sometimes states the period ("... for a period of thirty months").
    m = re.search(r"for\s+(?:a\s+period\s+of\s+)?(\d+|[a-z]+)\s*(years?|months?)\b", doc.title, re.I)
    if m and number_word(m.group(1)):
        result["validUntil"] = add_period(doc.date, number_word(m.group(1)), m.group(2))
        result["validityText"] = "index title: " + m.group(0)
        result["validitySource"] = "index title"
        return result

    # Nothing readable: the statutory default, marked as inferred.
    result["validityInferred"] = True
    if provisional:
        result["validUntil"] = add_period(doc.date, 6, "months")
    else:
        result["validUntil"] = add_period(doc.date, 5, "years")
    return result


def extension_date(text: str) -> tuple[dt.date | None, str | None]:
    m = INFORCE_RE.search(text)
    if m:
        return first_date(m.group(1)), m.group(0)
    m = re.search(
        r"(?:extend|extended|extension)[^.;]{0,200}?(?:up\s*to|upto|till|until)\s*(?:and\s+)?(?:inclusive\s+of|including)?\s*(?:the\s+)?(" + DATE_WORDS + ")",
        text, re.I,
    )
    if m:
        return first_date(m.group(1)), m.group(0)
    return None, None


def effective_date(doc: Doc) -> dt.date:
    m = re.search(
        r"(?:shall\s+come\s+into\s+(?:force|effect)|shall\s+be\s+effective)\s+(?:on|from|with\s+effect\s+from)\s+(?:the\s+)?(" + DATE_WORDS + ")",
        doc.text, re.I,
    )
    d = first_date(m.group(1)) if m else None
    return d or doc.date


# --------------------------------------------------------------------------- #
# Cell vocabularies: countries, units, currencies, tariff codes
# --------------------------------------------------------------------------- #


def existing_countries() -> dict[str, str]:
    """ISO alpha-2 -> name, read back out of codes.ts (the authority)."""
    src = (ROOT / "src" / "masters" / "codes.ts").read_text()
    block = src.split("export const COUNTRIES: Record<string, string> = {")[1].split("};")[0]
    pairs = re.findall(r"([A-Z]{2}):\s*(?:'((?:[^'\\]|\\.)*)'|\"([^\"]*)\")", block)
    return {code: (single or double).replace("\\'", "'") for code, single, double in pairs}


COUNTRIES = existing_countries()

# The names the notifications actually use, beyond the ISO short names.
COUNTRY_ALIASES = {
    "china pr": "CN", "china p.r.": "CN", "china p r": "CN", "people's republic of china": "CN",
    "peoples republic of china": "CN", "people republic of china": "CN", "pr china": "CN", "p.r. china": "CN",
    "china people's republic": "CN", "the people's republic of china": "CN", "chinese pr": "CN", "chaina pr": "CN",
    "chine pr": "CN", "chian pr": "CN",
    "korea rp": "KR", "korea r.p.": "KR", "korea republic": "KR", "republic of korea": "KR", "korea": "KR",
    "korea, republic of": "KR", "korea rep": "KR", "korea (rp)": "KR", "south korea": "KR",
    "chinese taipei": "TW", "taiwan": "TW", "taiwan, province of china": "TW",
    "european union": "EU", "eu": "EU",
    "usa": "US", "u.s.a.": "US", "u.s.a": "US", "united states of america": "US", "united states": "US", "us": "US",
    "uae": "AE", "u.a.e.": "AE", "united arab emirates": "AE",
    "russia": "RU", "russian federation": "RU",
    "iran": "IR", "islamic republic of iran": "IR", "iran, islamic republic of": "IR",
    "vietnam": "VN", "viet nam": "VN", "socialist republic of vietnam": "VN",
    "hong kong": "HK", "hong kong sar": "HK", "hongkong": "HK", "hong kong, china": "HK",
    "saudi arabia": "SA", "kingdom of saudi arabia": "SA", "ksa": "SA",
    "uk": "GB", "united kingdom": "GB", "macau": "MO", "macao": "MO",
    "the netherlands": "NL", "netherlands": "NL", "czech republic": "CZ", "turkey": "TR", "turkiye": "TR",
    "south africa": "ZA", "brasil": "BR", "brazil": "BR", "thailand": "TH", "indonesia": "ID",
    "malaysia": "MY", "singapore": "SG", "japan": "JP", "qatar": "QA", "oman": "OM", "nepal": "NP",
    "bangladesh": "BD", "pakistan": "PK", "sri lanka": "LK", "ukraine": "UA", "kazakhstan": "KZ",
    "belarus": "BY", "switzerland": "CH", "norway": "NO", "mexico": "MX", "canada": "CA", "australia": "AU",
    "colombia": "CO", "egypt": "EG", "kuwait": "KW", "bahrain": "BH", "israel": "IL", "philippines": "PH",
}
for code, name in COUNTRIES.items():
    COUNTRY_ALIASES.setdefault(name.lower(), code)


def compact(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


COMPACT_COUNTRIES: dict[str, str] = {}

# Phrases that stand for "the countries this notification names as subject countries".
SUBJECT_COMPACT = re.compile(
    r"(?:the)?(?:subjectcountr(?:y|ies)|above(?:countr(?:y|ies))?|"
    r"(?:those)?(?:countr(?:y|ies))?(?:subjectto|attracting)(?:the)?(?:antidumping|countervailing|add|cvd)(?:dut(?:y|ies))?)"
)


def _compact_aliases() -> dict[str, str]:
    if not COMPACT_COUNTRIES:
        for name, code in COUNTRY_ALIASES.items():
            COMPACT_COUNTRIES.setdefault(compact(name), code)
    return COMPACT_COUNTRIES


def segment_countries(c: str) -> list[str] | None:
    """Split a compacted list ('russiaorchinapr', 'indonesiamalaysiathailand') into codes.

    Every character must be covered by a known country name or a connector
    ('and', 'or'); otherwise None. Fewest pieces wins.
    """
    table = _compact_aliases()
    best: list[list[str] | None] = [None] * (len(c) + 1)
    best[0] = []
    for i in range(1, len(c) + 1):
        for j in range(max(0, i - 45), i):
            if best[j] is None:
                continue
            piece = c[j:i]
            if piece in table:
                cand = best[j] + [table[piece]]
            elif piece in ("and", "or", "the"):
                cand = best[j] + [""]
            else:
                continue
            if best[i] is None or len(cand) < len(best[i]):
                best[i] = cand
    if best[len(c)] is None:
        return None
    return list(dict.fromkeys(x for x in best[len(c)] if x)) or None


def split_country_names(text: str) -> list[str] | None:
    return segment_countries(compact(text))


def parse_countries(text: str, subject: list[str] | None = None) -> dict | None:
    """'China PR', 'Any country including China PR', 'Any country other than X and Y'.

    Returns {"countries": [...], "except": [...]} or None when a name is not
    recognised — the caller refuses the row rather than dropping a country.
    Matching runs on the text with spaces removed, because narrow cells break
    words ("includin g", "Hong Kon g").
    """
    c = compact(re.sub(r"[*#]+", " ", prose(text)))
    if not c:
        return None
    c = re.sub(r"^the", "", c)
    if re.fullmatch(r"(?:any|all)(?:other)?(?:countr(?:y|ies))?(?:includ.*)?", c):
        return {"countries": ["ANY"], "except": []}
    m = re.fullmatch(r"(?:any|all)(?:other)?(?:countr(?:y|ies))?(?:otherthan|except|excluding|butnot|not)(.*)", c) or re.fullmatch(r"(?:otherthan|except)(.*)", c)
    if m:
        rest = m.group(1)
        excepted: list[str] = []
        if SUBJECT_COMPACT.search(rest):
            if not subject:
                return None
            excepted += subject
            rest = SUBJECT_COMPACT.sub("", rest)
            rest = re.sub(r"^(?:and|or)|(?:and|or)$", "", rest)
        if rest:
            named = segment_countries(rest)
            if named is None:
                return None
            excepted += [n for n in named if n not in excepted]
        return {"countries": ["ANY"], "except": excepted}
    named = segment_countries(c)
    if named is None:
        return None
    return {"countries": named, "except": []}


UNITS = [
    (r"^(?:mt|m\.t\.?|mts|metric\s*tons?|metric\s*tonnes?|metric\s*tonne\s*\(mt\)|tonnes?|tons?|per\s+mt|pmt|tne)$", "MT"),
    (r"^(?:kgs?|kg\.|kilograms?|kilo\s*grams?|per\s+kg|kilogram)$", "KG"),
    (r"^(?:sqm|sq\.?\s*m\.?|sq\.?\s*mtrs?\.?|square\s*met(?:er|re)s?|m2|sq\.?\s*meters?)$", "SQM"),
    (r"^(?:cbm|cubic\s*met(?:er|re)s?|m3|cu\.?\s*m\.?)$", "CBM"),
    (r"^(?:nos?\.?|numbers?|pieces?|pcs\.?|piece|per\s+piece|units?|each)$", "NOS"),
    (r"^(?:pairs?)$", "PAIR"),
    (r"^(?:lakh\s*(?:pcs|pieces|nos)\.?)$", "LAKH_PCS"),
    (r"^(?:kfkm|thousand\s+fib(?:er|re)\s+(?:km|kilomet(?:er|re)s?))$", "KFKM"),
    (r"^(?:sets?)$", "SET"),
    (r"^(?:litres?|liters?|ltrs?\.?|l)$", "LTR"),
    (r"^(?:kilo\s*litres?|kl)$", "KL"),
    (r"^(?:gms?|grams?)$", "GM"),
    (r"^(?:met(?:er|re)s?|mtrs?\.?|running\s*met(?:er|re)s?)$", "MTR"),
]
CURRENCIES = [
    (r"^(?:usd|us\s*\$|us\s*dollars?|u\.?s\.?\s*dollars?|\$|us\s*\$\s*dollar|dollars?|usd\s*\(\$\)|united\s+states\s+dollars?|us\s*d)$", "USD"),
    (r"^(?:eur|euro?s?|€)$", "EUR"),
    (r"^(?:jpy|yen|japanese\s*yen|¥)$", "JPY"),
    (r"^(?:inr|rs\.?|rupees?|indian\s*rupees?|₹)$", "INR"),
    (r"^(?:cny|rmb|yuan)$", "CNY"),
    (r"^(?:gbp|pounds?\s*sterling|£)$", "GBP"),
]


def norm_unit(text: str) -> str | None:
    t = prose(text).lower().strip(" .,\"';")
    t = re.sub(r"^per\s+", "", t)
    for pat, code in UNITS:
        if re.match(pat, t, re.I):
            return code
    return None


def norm_currency(text: str) -> str | None:
    t = prose(text).lower().strip(" .,\"';")
    for pat, code in CURRENCIES:
        if re.match(pat, t, re.I):
            return code
    return None


def split_currency_unit(text: str) -> tuple[str | None, str | None]:
    """'USD/MT', 'US$ per KG', '$/Metric Ton' -> ('USD', 'MT')."""
    t = prose(text).strip(" ()")
    m = re.match(r"^(.*?)\s*(?:/|per|\bp\.)\s*(.*)$", t, re.I)
    if not m:
        return norm_currency(t), None
    return norm_currency(m.group(1)), norm_unit(m.group(2))


def parse_cth(text: str) -> dict | None:
    """Tariff codes in a cell -> digits-only prefixes.

    '7610 9010, 7610 9030 or 7616 9990' -> 76109010, 76109030, 76169990
    'Chapter 70' -> 70; '2914 69 30' -> 29146930; '3907.30' -> 390730
    Returns None when a token holds digits that do not form a 2/4/6/8-digit code.
    """
    t = prose(text)
    if not t:
        return None
    any_chapter = bool(re.search(r"\bany\s+(?:other\s+)?chapter\b", t, re.I))
    t = re.sub(r"\bany\s+(?:other\s+)?chapter\b", " ", t, flags=re.I)
    t = re.sub(r"\b(?:chapters?|headings?|sub-?\s*headings?|tariff\s+items?|tariff\s+headings?|cth|hs\s*codes?|hsn|items?|of\s+the\s+first\s+schedule|under|falling|the|and\s+its\s+sub-?headings)\b", " ", t, flags=re.I)
    t = re.sub(r"[*#@]+", " ", t)
    tokens = re.split(r"\s*(?:,|;|/|\bor\b|\band\b|&|\n)\s*", t, flags=re.I)
    codes: list[str] = []
    for tok in tokens:
        tok = tok.strip(" .()[]:-")
        if not tok:
            continue
        if not re.search(r"\d", tok):
            if re.fullmatch(r"[A-Za-z. ]{0,12}", tok):
                continue
            return None
        # a token may hold two codes separated only by spaces: "7610 9010 7616 9990"
        digits_groups = re.findall(r"\d+", tok)
        if re.search(r"[A-Za-z]", tok):
            return None
        joined = "".join(digits_groups)
        if len(joined) in (2, 4, 6, 8):
            codes.append(joined)
            continue
        # several codes printed without separators. Two readings are unambiguous:
        # every code is 8 digits ("7610 9010 7616 9990"), or every code starts
        # with a 4-digit group followed by 2-digit groups ("3901 30 3920 10").
        sizes = [len(g) for g in digits_groups]
        if all(x == 8 for x in sizes):
            codes += digits_groups
            continue
        if sizes and sizes[0] == 4 and all(x in (2, 4) for x in sizes) and all(
            sizes[i] == 2 or (i > 0 and sizes[i - 1] == 2) for i in range(1, len(sizes))
        ):
            cur = ""
            for g in digits_groups:
                if len(g) == 4 and cur:
                    codes.append(cur)
                    cur = g
                else:
                    cur += g
            codes.append(cur)
            if all(len(c) in (6, 8) for c in codes):
                continue
            return None
        buf, ok = "", True
        for g in digits_groups:
            buf += g
            if len(buf) == 8:
                codes.append(buf)
                buf = ""
            elif len(buf) > 8:
                ok = False
                break
        if not ok or buf:
            return None
    if not codes and not any_chapter:
        return None
    return {"include": list(dict.fromkeys(codes)), "anyChapter": any_chapter}


def parse_amount(text: str) -> tuple[float | None, str]:
    """Number in a duty cell; 'Nil' is 0. Returns (value, leftover text)."""
    t = re.sub(r"[*#]+|\(\s*\d\s*\)$", " ", prose(text)).strip()
    if re.fullmatch(r"(?:nil|zero|0|-|--|—)\.?", t, re.I):
        return 0.0, ""
    m = re.search(r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)", t)
    if not m:
        return None, t
    rest = (t[: m.start()] + " " + t[m.end():]).strip()
    if re.search(r"\d", rest):
        return None, t
    return float(m.group(1).replace(",", "")), rest


def num(value: float | None):
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


# --------------------------------------------------------------------------- #
# Duty tables
#
# PyMuPDF's table finder gives cells with their x-extent. A duty table's columns
# are taken from its most common row layout; each header cell and each data cell
# is placed in the column it overlaps most. The header words decide the column
# roles, so column order and the presence of Specification / Exporter columns
# do not matter. A table on a later page with no header of its own continues the
# previous one, column by column, by x-overlap.
# --------------------------------------------------------------------------- #

SERIAL_RE = re.compile(r"^\s*(\d{1,3})\s*(?:\.|\))?\s*(\(?[a-z]\)?)?\s*\.?\s*$", re.I)
NUMBERING_RE = re.compile(r"^\s*\(\s*\d{1,2}\s*\)\s*$")
DITTO_RE = re.compile(r"^\s*[-–(]*\s*do\s*\.?\s*[-–)]*\s*$|^\s*\"+\s*$|^\s*ditto\s*$", re.I)


def role_of(header: str) -> str | None:
    """A column's role from its header words.

    Narrow header cells break words ("Uni t", "Amo unt", "Countr y of origin"),
    so everything but the serial test runs on the header with spaces removed.
    """
    spaced = re.sub(r"\(\s*\d+\s*\)", " ", prose(header).lower()).strip()
    if not spaced:
        return None
    h = re.sub(r"[^a-z%$]", "", spaced)
    if re.match(r"^(?:s\.?\s*no|sl\b|sl\.|sr\b|sr\.|s\.?\s*n\b|s\.?\s*n\.|serial|sno|s\.|s$|sn$|no\.?$|sl\s*no|sr\s*no)", spaced) or h in ("sno", "slno", "srno", "sn", "s"):
        return "serial"
    if "curr" in h and "unit" in h:
        return "currency_unit"
    if "curr" in h:
        return "currency"
    if ("unit" in h or "uom" in h or "measur" in h) and not re.search(r"amount|amou|duty|price", h):
        return "unit"
    if "descri" in h or "productcateg" in h or "nameofgoods" in h or "nameofthegoods" in h:
        return "description"
    if "specif" in h:
        return "specification"
    if "origin" in h and "export" in h:
        return "origin_export"
    if "origin" in h:
        return "origin"
    if "produc" in h and "export" in h:
        return "producer_exporter"
    if "produc" in h:
        return "producer"
    if "exporter" in h:
        return "exporter"
    if "countr" in h and "export" in h:
        return "export"
    if re.search(r"heading|headin|tariff|tarif|tarrif|hscode|hsn|chapter|cth|subhead|itc|classification", h) or spaced.startswith("hs"):
        return "cth"
    if re.search(r"amount|amou|duty|rate|price|%|value", h):
        return "amount"
    return None


JOIN_STOP = {"and", "or", "of", "the", "in", "for", "to", "at", "by", "de", "del", "la", "sa", "ag", "co", "ltd", "inc",
             "llc", "pvt", "plc", "bhd", "tbk", "gmbh", "nv", "bv", "spa", "kg", "mt", "pr", "rp", "as", "on", "per", "any", "other", "than", "all", "no", "sn"}


def join_cell_lines(value: str) -> str:
    """Cell text with its line breaks resolved.

    A narrow cell wraps long words without a hyphen ("Zhejian|g", "includin|g"),
    so a line that ends in a lowercase letter joins the next line without a
    space when that line opens with a short lowercase fragment that is not a
    word of its own. A line ending in a hyphen joins without a space too.
    """
    lines = [l.strip() for l in value.split("\n")]
    out = ""
    for line in lines:
        if not line:
            continue
        if not out:
            out = line
            continue
        first = re.match(r"[a-z]+", line)
        if out.endswith("-") and not out.endswith(" -") and not re.search(r"(?i)\bdo\s*-$", out):
            out += line
        elif re.search(r"[a-z]$", out) and first and len(first.group(0)) <= 4 and first.group(0) not in JOIN_STOP \
                and (len(line) == len(first.group(0)) or not line[len(first.group(0))].isalpha()):
            out += line
        else:
            out += " " + line
    return out


def cell_list(table) -> list[list[tuple[float, float, str | None]]]:
    rows = []
    texts = table.extract()
    for row, values in zip(table.rows, texts):
        cells = []
        for cell, value in zip(row.cells, values):
            if cell is None:
                continue
            cells.append((cell[0], cell[2], None if value is None else prose(join_cell_lines(value))))
        rows.append(cells)
    return rows


def layout_columns(rows) -> list[tuple[float, float]]:
    """Column extents: the fullest row layout, with sliver cells folded in.

    The fullest layout is used rather than the most common one because merged
    cells (a description spanning several producers) make short rows the
    majority in some tables.
    """
    layouts: dict[tuple, int] = {}
    for cells in rows:
        key = tuple((round(a, 0), round(b, 0)) for a, b, _ in cells)
        if len(key) >= 3:
            layouts[key] = layouts.get(key, 0) + 1
    if not layouts:
        return []
    best = list(max(layouts, key=lambda k: (len([1 for a, b in k if b - a >= 6]), layouts[k])))
    cols: list[list[float]] = []
    for a, b in best:
        if cols and b - a < 6:
            cols[-1][1] = b
        else:
            cols.append([a, b])
    return [(a, b) for a, b in cols]


def overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def place(cells, columns) -> dict[int, list[str]]:
    """Cell texts by column index; a cell goes to the column it overlaps most."""
    out: dict[int, list[str]] = defaultdict(list)
    for a, b, text in cells:
        if not columns:
            break
        scores = [overlap(a, b, c0, c1) for c0, c1 in columns]
        best = max(range(len(columns)), key=lambda i: scores[i])
        if scores[best] <= 0:
            mid = (a + b) / 2
            best = min(range(len(columns)), key=lambda i: abs((columns[i][0] + columns[i][1]) / 2 - mid))
        out[best].append(text if text is not None else None)
    return out


def span_count(cell, columns) -> int:
    a, b, _ = cell
    return sum(1 for c0, c1 in columns if overlap(a, b, c0, c1) > 0.5 * (c1 - c0))


class Segment:
    """One logical duty table: its column roles and its assembled rows."""

    def __init__(self, columns, roles, headers, page):
        self.columns = columns
        self.roles = roles
        self.headers = headers
        self.page = page
        self.rows: list[dict] = []
        self.ended = False
        self.notes: list[str] = []

    def role_index(self, role):
        return [i for i, r in enumerate(self.roles) if r == role]


def header_roles(header_rows, columns):
    texts = [""] * len(columns)
    for cells in header_rows:
        for a, b, text in cells:
            if not text:
                continue
            for i, (c0, c1) in enumerate(columns):
                if overlap(a, b, c0, c1) > 0.3 * min(c1 - c0, b - a):
                    texts[i] = (texts[i] + " " + text).strip()
    roles = [role_of(t) for t in texts]
    return roles, texts


def usable(roles) -> bool:
    rs = set(r for r in roles if r)
    return (
        "serial" in rs
        and ({"description", "cth"} & rs)
        and ({"origin", "origin_export"} & rs)
        and ("amount" in rs or "currency_unit" in rs)
    )


def specification_key(doc: Doc) -> dict[str, str]:
    """A two-column 'Specification | Description' table printed after the duty table."""
    out: dict[str, str] = {}
    for page in doc.fitz:
        try:
            tables = page.find_tables().tables
        except Exception:
            continue
        for table in tables:
            rows = cell_list(table)
            if not rows or len(rows[0]) != 2:
                continue
            if [role_of(t or "") for _, _, t in rows[0]] == ["specification", "description"]:
                body = rows[1:]
            elif out and all(len(r) == 2 for r in rows):
                body = rows  # continuation on the next page
            else:
                continue
            for r in body:
                if len(r) == 2 and r[0][2] and r[1][2]:
                    out[r[0][2]] = r[1][2]
    return out


def extract_segments(doc: Doc) -> list[Segment]:
    segments: list[Segment] = []
    active: Segment | None = None
    for pno, page in enumerate(doc.fitz):
        try:
            tables = page.find_tables().tables
        except Exception:
            tables = []
        for table in tables:
            rows = cell_list(table)
            if not rows:
                continue
            first_data = next(
                (i for i, cells in enumerate(rows) if cells and cells[0][2] is not None and SERIAL_RE.match(cells[0][2] or "")),
                None,
            )
            columns = layout_columns(rows[first_data:] if first_data is not None else rows)
            if not columns:
                continue
            # header: the rows just above the first serial, back to the first
            # prose-like row (a cell spanning three or more columns)
            header_rows = []
            for cells in reversed(rows[: first_data if first_data is not None else len(rows)]):
                if all(NUMBERING_RE.match(t or "") or not t for _, _, t in cells):
                    continue
                if any(t and span_count(c, columns) >= 3 for c in cells for t in [c[2]]) or len(header_rows) >= 5:
                    break
                header_rows.insert(0, cells)
            roles, texts = header_roles(header_rows, columns) if header_rows else ([None] * len(columns), [""] * len(columns))
            if usable(roles):
                active = Segment(columns, roles, texts, pno + 1)
                segments.append(active)
                body_rows = rows[first_data:] if first_data is not None else []
            elif active is not None and not active.ended and first_data is not None and first_data <= 1:
                # continuation on a new page: re-express the active columns by overlap
                body_rows = rows[first_data:]
                cont = []
                for cells in rows[:first_data]:
                    cont.append(cells)
                body_rows = cont + body_rows
                columns = active.columns
            elif active is not None and not active.ended and first_data is None and len(rows) <= 3:
                body_rows = rows
            else:
                continue
            seg = active
            for cells in body_rows:
                texts_by_col = place(cells, seg.columns)
                serial_cols = seg.role_index("serial")
                serial_text = " ".join(t for i in serial_cols for t in texts_by_col.get(i, []) if t) if serial_cols else ""
                non_empty = [(i, t) for i, ts in texts_by_col.items() for t in ts if t]
                if not non_empty:
                    continue
                if all(NUMBERING_RE.match(t) for _, t in non_empty):
                    continue
                ints = [t.strip(" .") for _, t in sorted(non_empty)]
                if len(ints) >= 4 and all(x.isdigit() for x in ints) and [int(x) for x in ints] == list(range(1, len(ints) + 1)):
                    continue  # the (1) (2) (3) column-number row printed without brackets
                wide = [c for c in cells if c[2] and span_count(c, seg.columns) >= 3]
                sm = SERIAL_RE.match(serial_text) if serial_text else None
                if sm:
                    row = {"serial": sm.group(1) + (sm.group(2).strip("()") if sm.group(2) else ""), "page": pno + 1, "cells": {}, "missing": set()}
                    present = set()
                    for i, role in enumerate(seg.roles):
                        if role in (None, "serial"):
                            continue
                        ts = texts_by_col.get(i)
                        if ts is None:
                            row["missing"].add(role)
                            continue
                        present.add(role)
                        val = " ".join(t for t in ts if t)
                        row["cells"][role] = (row["cells"].get(role, "") + " " + val).strip()
                    row["missing"] -= present
                    seg.rows.append(row)
                elif wide or re.match(r"^\s*(?:\*|note|explanation|provided)", non_empty[0][1], re.I):
                    seg.ended = True
                    seg.notes.append(" ".join(t for _, t in non_empty))
                    break
                elif seg.rows:
                    prev = seg.rows[-1]
                    vals = {}
                    for i, role in enumerate(seg.roles):
                        if role in (None, "serial"):
                            continue
                        val = " ".join(t for t in texts_by_col.get(i, []) if t)
                        if val:
                            vals[role] = (vals.get(role, "") + " " + val).strip()
                    amount_like = [r for r in vals if r in ("amount", "currency_unit")]
                    if amount_like and all(prev["cells"].get(r) for r in amount_like) and "producer" not in vals and "origin" not in vals:
                        # a sub-row: its own specification and duty under the same serial
                        sub = {"serial": prev["serial"], "page": pno + 1, "cells": dict(vals), "missing": set(), "subRowOf": prev}
                        seg.rows.append(sub)
                        continue
                    for role, val in vals.items():
                        prev["cells"][role] = (prev["cells"].get(role, "") + " " + val).strip()
                        prev["missing"].discard(role)
    return segments


# The operative paragraph names each column: "originating in the countries as
# specified in the corresponding entry in column (4), exported from ... column (5)".
# Those references are checked against the roles read from the header, so a
# table whose header was misread (origin and export swapped, say — both hold
# country names and would pass every value check) is refused.
PROSE_ROLE = [
    (r"exported\s+by\s+(?:the\s+)?exporters|exporters?\b", "exporter"),
    (r"produced\s+by|producers?\b", "producer"),
    (r"originating|origin\b", "origin"),
    (r"exported\s+(?:from|by)|export\b|exports\b", "export"),
    (r"specification", "specification"),
    (r"description", "description"),
    (r"tariff\s+items?|headings?|sub-?\s*headings?|chapter", "cth"),
]
CHECKED_ROLES = {"origin", "export", "producer", "exporter", "specification", "description", "cth"}
COMPATIBLE = {"origin_export": {"origin", "export"}, "producer_exporter": {"producer", "exporter"}}


def prose_columns(body: str) -> dict[int, str]:
    m = re.search(r"hereby\s+(?:imposes|continues|levies)(.{0,2500}?)(?:namely|$)", body, re.I | re.S)
    if not m:
        return {}
    text = m.group(1)
    out: dict[int, str] = {}
    last = 0
    for cm in re.finditer(r"columns?\s*\(?\s*(\d{1,2})\s*\)?", text, re.I):
        chunk = text[last:cm.start()][-160:]
        last = cm.end()
        best, pos = None, -1
        for pat, role in PROSE_ROLE:
            for km in re.finditer(pat, chunk, re.I):
                if km.start() > pos:
                    pos, best = km.start(), role
        if best:
            out.setdefault(int(cm.group(1)), best)
    return out


def column_disagreements(body: str, roles: list[str | None]) -> list[str]:
    out = []
    for k, role in prose_columns(body).items():
        if role not in CHECKED_ROLES or k - 1 >= len(roles):
            continue
        actual = roles[k - 1]
        if actual is None or actual == role or role in COMPATIBLE.get(actual, ()):
            continue
        if actual in CHECKED_ROLES or actual in COMPATIBLE:
            out.append(f"column ({k}) is '{role}' in the operative paragraph but '{actual}' in the table header")
    return out


def duty_notes(body: str) -> list[str]:
    """Sentences outside the table that change how the duty is computed or applied."""
    notes = []
    tail = re.split(r"namely\s*:?\s*-", body, maxsplit=1)[-1]
    for sent in re.split(r"(?<=[.;])\s+(?=[*(\dA-Z])", tail):
        if re.search(r"rate\s+of\s+exchange|shall\s+be\s+(?:effective|levied)\s+for\s+a\s+period|payable\s+in\s+Indian\s+currency|F\.\s*No\.|Under\s+Secretary|Deputy\s+Secretary|principal\s+notification", sent, re.I):
            continue
        if re.search(r"hereby|-do-", sent, re.I) or len(re.findall(r"\d(?:\.\d+)?\s*%", sent)) >= 2:
            continue
        if re.search(r"difference\s+between|\bminus\b|shall\s+not\s+(?:apply|be\s+(?:levied|applicable|imposed))|will\s+not\s+be\s+applicable|shall\s+apply\s+in\s+such\s+cases|less\s+than\s+the\s+(?:amount|value)", sent, re.I):
            notes.append(prose(sent)[:500])
    return notes[:4]


INHERITABLE = {"cth", "description", "specification", "origin", "export", "origin_export", "unit", "currency", "currency_unit", "amount"}


def serials_absent_from_text(text_pages, pages, missing, present) -> bool:
    """True when the page text between the table's first and last serial shows no
    line holding one of the missing serials — i.e. the source numbering skips it,
    rather than the table finder having dropped a row."""
    if not text_pages:
        return False
    lines = [l.strip() for p in pages for l in text_pages[p - 1].split("\n")]
    ints = [(i, int(re.match(r"\d+", l).group(0))) for i, l in enumerate(lines) if re.fullmatch(r"\d{1,3}\s*\.?", l)]
    # drop the column-number row (1, 2, 3 ... on consecutive lines)
    drop = set()
    run: list[int] = []
    for k, (i, v) in enumerate(ints):
        if run and i == ints[run[-1]][0] + 1 and v == ints[run[-1]][1] + 1:
            run.append(k)
        else:
            if len(run) >= 4:
                drop.update(run)
            run = [k]
    if len(run) >= 4:
        drop.update(run)
    ints = [x for k, x in enumerate(ints) if k not in drop]
    first, last = min(present), max(present)
    start = next((i for i, v in ints if v == first), None)
    end = next((i for i, v in reversed(ints) if v == last), None)
    if start is None or end is None:
        return False
    seen = {v for i, v in ints if start <= i <= end}
    return not (set(missing) & seen) and (min(missing) > first or first == min(present))


def resolve_rows(segments: list[Segment], text_pages: list[str] | None = None, gaps: list[str] | None = None) -> tuple[list[dict], list[str]]:
    """Segments -> rows with ditto marks and merged cells resolved.

    Returns (rows, structural problems). Rows keep the header text of the
    column each value came from, which the duty-basis reader needs.
    """
    problems: list[str] = []
    gaps = gaps if gaps is not None else []
    # A bilingual notification prints the table twice; identical segments collapse.
    unique: list[Segment] = []
    seen = set()
    for seg in segments:
        sig = tuple((r["serial"], tuple(sorted(r["cells"].items()))) for r in seg.rows)
        if sig in seen or not seg.rows:
            continue
        seen.add(sig)
        unique.append(seg)
    rows: list[dict] = []
    tno = 0
    prev: dict[str, str] = {}
    for seg in unique:
        # A segment that does not start at serial 1 continues the table before it
        # (the header is repeated on each page of some notifications).
        first = int(re.match(r"\d+", seg.rows[0]["serial"]).group(0))
        if tno == 0 or first == 1:
            tno += 1
            prev = {}
        sub_index = 0
        for r in seg.rows:
            values: dict[str, str] = {}
            is_sub = "subRowOf" in r
            sub_index = sub_index + 1 if is_sub else 0
            for role in set(seg.roles) - {None, "serial"}:
                text = r["cells"].get(role)
                if is_sub and not text:
                    if role in prev:
                        values[role] = prev[role]
                    continue
                if role in r["missing"]:
                    # no cell at all under this column: a cell merged down from the row above
                    if role in prev:
                        values[role] = prev[role]
                    continue
                if not text:
                    # an empty cell: a merged cell restarting on a new page, for the columns that span
                    if role in INHERITABLE and role != "amount" and role in prev:
                        values[role] = prev[role]
                    continue
                if DITTO_RE.match(text) or re.fullmatch(r"(?i)\s*same\s+as\s+above\s*", text):
                    if role in prev:
                        values[role] = prev[role]
                        continue
                    problems.append(f"S.No. {r['serial']}: '-do-' in {role} with nothing above it")
                    continue
                values[role] = text
            prev = dict(values)
            headers = {role: seg.headers[i] for i, role in enumerate(seg.roles) if role}
            rows.append({"serial": r["serial"], "page": r["page"], "table": tno, "values": values, "headers": headers,
                         "sub": sub_index})
    # Serial check: per table, 1..n without gaps or repeats (sub-serials like 3a allowed).
    tables = defaultdict(list)
    for r in rows:
        if not r["sub"]:
            tables[r["table"]].append(r["serial"])
    for tno, serials in tables.items():
        base = [int(re.match(r"\d+", s).group(0)) for s in serials]
        plain = [s for s in serials if s.isdigit()]
        if len(set(serials)) != len(serials):
            dup = [s for s, c in Counter(serials).items() if c > 1]
            problems.append(f"table {tno}: serial numbers repeat ({', '.join(dup[:5])})")
        expected = list(range(1, max(base) + 1)) if base else []
        if sorted(set(base)) != expected:
            missing = sorted(set(expected) - set(base))
            pages = sorted({r["page"] for r in rows if r["table"] == tno})
            if not serials_absent_from_text(text_pages, pages, missing, base):
                problems.append(f"table {tno}: serial numbers not contiguous (missing {missing[:8]})")
            else:
                gaps.append(f"table {tno}: the notification itself skips serial(s) {missing[:8]}")
        if plain and [int(s) for s in plain] != sorted(int(s) for s in plain):
            problems.append(f"table {tno}: serial numbers out of order")
    return rows, problems


def duty_basis(doc_text: str, header: str, cell: str) -> str | None:
    h = prose(header).lower()
    c = prose(cell).lower()
    if "reference price" in h or "reference price" in c or re.search(r"difference\s+between\s+the\s+landed\s+value", doc_text, re.I):
        return "REFERENCE_PRICE"
    pct = bool(re.search(r"%|per\s*cent|percent|ad\s*valorem", h + " " + c))
    if not pct:
        return "SPECIFIC"
    for text in (h, c, doc_text.lower()):
        m = re.search(r"(?:%|per\s*cent|percent(?:age)?|ad\s*valorem)[^.;]{0,40}?\b(cif|c\.i\.f\.|landed|assessable)\s*(?:value|price)?", text)
        if m:
            word = m.group(1).replace(".", "")
            return {"cif": "CIF_PCT", "landed": "LANDED_PCT", "assessable": "AV"}[word]
    return None


def build_entries(doc: Doc, rows: list[dict], kind: str, notification: str, short: str,
                  date: dt.date, basis_override: str | None = None) -> tuple[list[dict], list[str]]:
    """Resolved rows -> master entries. Rows that fail a check are refused."""
    entries, errors = [], []
    body = doc.body() if doc is not None else ""
    subject = []
    for r in rows:
        v = r["values"].get("origin") or r["values"].get("origin_export") or ""
        parsed = parse_countries(v) if not re.match(r"(?i)^\s*any", v) else None
        for c in (parsed or {}).get("countries", []):
            if c != "ANY" and c not in subject:
                subject.append(c)
    for r in rows:
        v, hd = r["values"], r["headers"]
        tag = f"S.No. {r['serial']}"
        problems = []

        if "_include" in v:
            cth = {"include": v["_include"], "anyChapter": False}
        else:
            cth = parse_cth(v.get("cth", "")) if v.get("cth") else None
        if not cth:
            problems.append(f"tariff code {v.get('cth')!r} not understood")

        both = v.get("origin_export")
        origin_text = v.get("origin", both)
        export_text = v.get("export", both)
        origin = parse_countries(origin_text or "", subject) if origin_text else None
        if not origin:
            problems.append(f"country of origin {origin_text!r} not understood")
        export = None
        if export_text:
            export = parse_countries(re.sub(r"(?i)\bother\s+than\s+(?:the\s+)?above\b", "other than subject countries", export_text), subject)
            if not export:
                problems.append(f"country of export {export_text!r} not understood")
        if origin_text and origin is None and re.search(r"(?i)other\s+than\s+(?:the\s+)?above", origin_text):
            origin = parse_countries(re.sub(r"(?i)\bother\s+than\s+(?:the\s+)?above\b", "other than subject countries", origin_text), subject)
            if origin:
                problems = [p for p in problems if not p.startswith("country of origin")]

        prod_text = v.get("producer") or v.get("producer_exporter")
        exp_text = v.get("exporter") or v.get("producer_exporter")
        if not prod_text and not exp_text:
            problems.append("no producer or exporter")

        amount_header = hd.get("amount", "") or hd.get("currency_unit", "")
        amount_cell = v.get("amount", "")
        amount, leftover = parse_amount(amount_cell)
        if amount is None:
            problems.append(f"duty {amount_cell!r} not understood")
        basis = basis_override or duty_basis(body, amount_header, amount_cell)
        if basis is None:
            problems.append(f"percentage duty with no stated base ({amount_header!r})")
        currency = unit = None
        if basis in ("SPECIFIC", "REFERENCE_PRICE"):
            if v.get("currency"):
                currency = norm_currency(v["currency"])
                if not currency:
                    cu = split_currency_unit(v["currency"])
                    currency, unit = cu[0], unit or cu[1]
            if v.get("unit"):
                unit = norm_unit(v["unit"])
                if not unit:
                    cu = split_currency_unit(v["unit"])
                    currency, unit = currency or cu[0], cu[1]
            if v.get("currency_unit"):
                cu = split_currency_unit(v["currency_unit"])
                currency, unit = currency or cu[0], unit or cu[1]
            if leftover:
                cu = split_currency_unit(leftover)
                currency, unit = currency or cu[0], unit or cu[1]
            if (not currency or not unit) and amount_header:
                m = re.search(r"(?:\(|in\s+|\b)((?:us\s*\$|usd|\$|us\s*dollars?|euro?|jpy|yen|inr|rs\.?)\s*(?:/|per)\s*[a-z. ]+?)\s*(?:\)|$)", amount_header, re.I)
                if m:
                    cu = split_currency_unit(m.group(1))
                    currency, unit = currency or cu[0], unit or cu[1]
            if amount not in (None, 0.0):
                if not currency:
                    problems.append(f"currency not understood ({v.get('currency') or v.get('currency_unit') or amount_header!r})")
                if not unit:
                    problems.append(f"unit not understood ({v.get('unit') or v.get('currency_unit') or amount_header!r})")

        if problems:
            errors.append(f"{tag}: " + "; ".join(problems))
            continue

        def party(text):
            if not text:
                return "ANY", None
            if re.match(r"(?i)^\s*(?:m/s\.?\s*)?(?:any\b|all\s+others?\b|others?\s*$|other\s+(?:producers?|exporters?)\b)", text):
                return "ANY", text
            return re.sub(r"(?i)^m/s\.?\s*", "", text).strip(), None

        producer, producer_note = party(prod_text)
        exporter, exporter_note = party(exp_text)
        entry = {
            "kind": kind,
            "notification": notification,
            "notificationShort": short,
            "notificationDate": date.isoformat(),
            "tableSerial": r["serial"],
            "include": cth["include"],
            "description": v.get("description", ""),
            "specification": v.get("specification") or None,
            "originCountries": origin["countries"],
            "exportCountries": export["countries"] if export else ["ANY"],
            "producer": producer,
            "exporter": exporter,
            "supplierSerial": None,
            "basis": basis,
            "rate": num(amount) if basis in ("CIF_PCT", "LANDED_PCT", "AV") else None,
            "amount": num(amount) if basis in ("SPECIFIC", "REFERENCE_PRICE") else None,
            "unit": unit,
            "currency": currency,
            "page": r["page"],
        }
        if cth["anyChapter"]:
            entry["anyChapter"] = True
        if origin["except"]:
            entry["originExcept"] = origin["except"]
        if export and export["except"]:
            entry["exportExcept"] = export["except"]
        if not export and not both:
            entry["exportCountriesNotStated"] = True
        if both:
            entry["originOrExport"] = True
        if producer_note or exporter_note:
            entry["residual"] = producer_note or exporter_note
        if v.get("producer_exporter"):
            entry["producerExporterCombined"] = True
        if r["table"] > 1:
            entry["table"] = r["table"]
        if r.get("sub"):
            entry["subRow"] = r["sub"]
        entry["sourceText"] = {"cth": v.get("cth"), "amount": amount_cell, "origin": origin_text, "export": export_text}
        entries.append(entry)
    return entries, errors


# --------------------------------------------------------------------------- #
# Timeline: validity windows and the instructions later documents give
# --------------------------------------------------------------------------- #


def instructions_by_target(doc: Doc) -> dict[str, str]:
    """An amending document's operative text, split per notification it amends.

    Omnibus amendments (Finance Act / HSN alignment) list several notifications
    in a table; each gets the text between its own reference and the next.
    """
    body = doc.body() if not doc.corrigendum else doc.text
    # cut the trailing publication notes
    body = re.split(r"\[\s*F\.?\s*No|\bNote\s*[:.-]+\s*(?:\d\.\s*)?The principal", body, flags=re.I)[0]
    targets = [t for t in targets_of(doc)]
    if len(targets) <= 1 or not is_omnibus(doc):
        return {t: body for t in targets}
    marks = []
    for m in REF_RE.finditer(body):
        kind = {"ADD": "ADD", "CVD": "CVD", "SG": "SAFEGUARD"}[m.group(3).upper()]
        k = key_of(kind, int(m.group(1)), int(m.group(2)))
        if k in targets:
            marks.append((m.start(), k))
    out: dict[str, str] = {}
    # keep only the first mention of each target after the table starts
    firsts = []
    seen = set()
    for pos, k in marks:
        if k not in seen:
            seen.add(k)
            firsts.append((pos, k))
    for i, (pos, k) in enumerate(firsts):
        end = firsts[i + 1][0] if i + 1 < len(firsts) else len(body)
        out[k] = body[pos:end]
    return out


class Notification:
    def __init__(self, doc: Doc, validity: dict):
        self.doc = doc
        self.key = doc.key
        self.validity = validity
        self.valid_from = validity["validFrom"]
        self.valid_until = validity["validUntil"]
        self.inferred = validity["validityInferred"]
        self.amended_by: list[str] = []
        self.rescinded_by: str | None = None
        self.superseded_by: str | None = None
        self.extended_by: list[str] = []
        self.instructions: list[tuple[Doc, str]] = []  # (amending doc, its text for this notification)
        self.corrigenda: list[tuple[Doc, str]] = []
        self.provisional_assessment: list[str] = []
        self.notes: list[str] = []


def build_timeline(docs: list[Doc]) -> tuple[dict[str, Notification], dict[str, str]]:
    by_key = {d.key: d for d in docs if not d.corrigendum and d.no is not None}
    classes: dict[str, str] = {}
    notifs: dict[str, Notification] = {}
    for d in docs:
        cls = classify(d) if len(d.text) >= 200 else "SCAN"
        classes[d.file] = cls
        if cls == "IMPOSE":
            validity = own_validity(d, by_key)
            if d.kind == "SAFEGUARD":
                spans = [(first_date(a), first_date(b)) for a, b in re.findall(
                    r"during\s+the\s+period\s+from\s+(.{6,40}?)\s+to\s+(.{6,40}?)(?=\s*\(|\s*;|\s*:|\.\s|\s+and\b|$)", d.body(), re.I)]
                spans = [x for x in spans if x[0] and x[1]]
                if spans:
                    validity.update(validFrom=min(a for a, _ in spans), validUntil=max(b for _, b in spans), validityInferred=False)
            notifs[d.key] = Notification(d, validity)
    for d in docs:
        cls = classes[d.file]
        if cls == "IMPOSE":
            n = notifs[d.key]
            body = d.body()
            for m in re.finditer(r"(?:in\s+)?supersession\s+of", body, re.I):
                for k in ref_keys(body[m.end(): m.end() + 400])[:3]:
                    if k in notifs and k != d.key and notifs[k].doc.date < d.date:
                        old = notifs[k]
                        end = d.date - dt.timedelta(days=1)
                        if old.valid_until is None or old.valid_until > end:
                            old.valid_until = end
                        old.superseded_by = d.label
                    break
            prov = n.validity.get("provisionalOf")
            if prov and prov in notifs:
                old = notifs[prov]
                end = d.date - dt.timedelta(days=1)
                if old.valid_until > end:
                    old.valid_until = end
                old.superseded_by = old.superseded_by or d.label
        elif cls == "RESCIND":
            body = d.body()
            m = RESCIND_RE.search(body)
            seg = body[m.end(): m.end() + 600]
            seg = re.split(r"except\s+as\s+respects", seg, flags=re.I)[0]
            for k in ref_keys(seg):
                if k in notifs:
                    n = notifs[k]
                    end = effective_date(d) - dt.timedelta(days=1)
                    if n.valid_until is None or n.valid_until > end:
                        n.valid_until = end
                    n.rescinded_by = d.label
        elif cls in ("AMEND", "CORRIGENDUM"):
            for k, text in instructions_by_target(d).items():
                if k not in notifs:
                    continue
                n = notifs[k]
                if cls == "CORRIGENDUM":
                    n.corrigenda.append((d, text))
                    continue
                ext, ext_text = extension_date(text)
                if ext:
                    n.valid_until = ext
                    n.inferred = False
                    n.extended_by.append(d.label)
                    n.amended_by.append(d.label)
                    # an extension notification may also carry other changes
                    rest = text.replace(ext_text, " ")
                    if re.search(r"shall\s+be\s+substituted|shall\s+be\s+omitted|shall\s+be\s+inserted", rest, re.I) and not re.search(
                        r"after\s+paragraph\s+\d+[^.]{0,80}following\s+paragraph\s+shall\s+be\s+inserted", rest, re.I
                    ):
                        n.instructions.append((d, rest))
                    continue
                ops, _ = parse_ops(text, False)
                vops = [o for o in ops if o["op"] == "validity"]
                for o in vops:
                    if n.valid_until == o["from"] or (n.valid_until and o["until"] > n.valid_until):
                        n.valid_until = o["until"]
                        n.inferred = False
                        n.extended_by.append(d.label)
                if vops and len(vops) == len(ops):
                    n.amended_by.append(d.label)
                    continue
                n.amended_by.append(d.label)
                n.instructions.append((d, text))
        elif cls == "PROVISIONAL_ASSESSMENT":
            for k in targets_of(d):
                if k in notifs:
                    notifs[k].provisional_assessment.append(d.label)
    # co-terminous notifications end with the one they follow
    for n in notifs.values():
        k = n.validity.get("coterminousWith")
        if k:
            if k in notifs:
                n.valid_until = notifs[k].valid_until
                n.notes.append(f"co-terminous with {notifs[k].doc.label}")
            else:
                n.valid_until = add_period(n.doc.date, 5, "years")
                n.inferred = True
    return notifs, classes


# --------------------------------------------------------------------------- #
# Amendment instructions -> operations on the raw table
# --------------------------------------------------------------------------- #

CLAUSE_SPLIT = re.compile(r"\(\s*(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\s*\)\s*(?=for|in|at|against|after|on|omit)|(?:^|;\s*|\s)(?:i|ii|iii|iv|v|vi)\.\s+(?=for|in|against|after)", re.I)
SERIALS_RE = re.compile(
    r"(?:against|in)\s+(?:the\s+)?(?:S\.?\s*No(?:s)?\.?|SN|Sl\.?\s*No(?:s)?\.?|Sr\.?\s*No\.?|serial\s+numbers?|serial\s+no\.?)\s*((?:\d+\s*(?:,|and|to|&)?\s*)+)",
    re.I,
)
COLUMN_RE = re.compile(r"column\s*(?:no\.?\s*)?\(?\s*(\d{1,2})\s*\)?", re.I)
QUOTED = r"(?:\"([^\"]*)\"|'([^']*)')"


def quoted_values(text: str) -> list[str]:
    return [a if a is not None and a != "" or b is None else b for a, b in re.findall(QUOTED, text)]


def serial_list(text: str) -> list[str] | None:
    m = SERIALS_RE.search(text)
    if not m:
        return None
    out: list[str] = []
    for a, b in re.findall(r"(\d+)\s*(?:to\s*(\d+))?", m.group(1)):
        if b:
            out += [str(i) for i in range(int(a), int(b) + 1)]
        else:
            out.append(a)
    return out


def parse_ops(text: str, corrigendum: bool) -> tuple[list[dict], list[str]]:
    """An amendment's text for one notification -> operations, and clauses it could not read."""
    body = prose(text)
    body = re.sub(r"^.*?In\s+the\s+said\s+notification\s*,?\s*-?", "", body, count=1, flags=re.I | re.S) if re.search(r"In\s+the\s+said\s+notification", body, re.I) else body
    ops: list[dict] = []
    unread: list[str] = []

    # a whole new table
    if re.search(r"for\s+the\s+table(?:\s+and\s+the\s+entries\s+relating\s+thereto)?\s*,?\s*the\s+following\s+(?:table\s+)?shall\s+be\s+substituted", body, re.I) or re.search(
        r"for\s+\"?TABLE[.…\s]*[^\"]{0,40}\"?\s*,?\s*read\s+the\s+following", body, re.I
    ):
        ops.append({"op": "table"})
        body = re.split(r"following\s+(?:table\s+)?shall\s+be\s+substituted|read\s+the\s+following", body, flags=re.I)[0]

    clauses = [c.strip() for c in CLAUSE_SPLIT.split(body) if c and c.strip(" ,;.-")]
    for clause in clauses:
        c = clause.strip()
        if not re.search(r"substitut|omit|read\b|insert|added", c, re.I):
            continue
        if ops and ops[0]["op"] == "table" and re.search(r"following\s*$|table\s*$", c, re.I):
            continue
        # prose-only changes: portions of the operative paragraph, the words "tariff item", lines of text, notes
        if re.search(r"portion\s+beginning\s+with", c, re.I):
            ops.append({"op": "note", "text": c[:300]})
            continue
        dates = [first_date(v) for v in quoted_values(c)]
        if len(dates) == 2 and all(dates) and re.search(r"paragraph", c, re.I):
            ops.append({"op": "validity", "from": dates[0], "until": dates[1]})
            continue
        if re.search(r"shall\s+be\s+inserted|shall\s+be\s+added|following\s+shall\s+be\s+added", c, re.I):
            ops.append({"op": "note", "text": c[:400]})
            continue
        if re.search(r"for\s+the\s+words?\s+\"tariff\s+items?\"", c, re.I):
            ops.append({"op": "note", "text": c[:200]})
            continue
        if re.search(r"explanation", c, re.I) and not re.search(r"column", c, re.I):
            ops.append({"op": "note", "text": c[:300]})
            continue
        unquoted = re.sub(QUOTED, " ", c)
        serials = serial_list(unquoted)
        col = COLUMN_RE.search(unquoted)
        vals = quoted_values(c)
        if any(re.search(r"difference\s+between\s+the\s+landed\s+value", v, re.I) for v in vals):
            ops.append({"op": "basis", "basis": "REFERENCE_PRICE", "text": c[:300]})
            continue
        if corrigendum and re.search(r"\bline\b", unquoted, re.I) and not col:
            ops.append({"op": "note", "text": c[:300]})
            continue
        # tariff codes: for the figures "A" [or "A2"] wherever it occurs, the figures "B" shall be substituted / shall be omitted
        m = re.search(r"for\s+the\s+figures?\s*" + QUOTED + r"(?:\s*or\s*" + QUOTED + r")?.*?(?:the\s+figures?\s*" + QUOTED + r"\s*shall\s+be\s+substituted|shall\s+be\s+omitted)", c, re.I)
        if m:
            g = [x for x in m.groups()]
            old_a = g[0] if g[0] is not None else g[1]
            old_b = g[2] if g[2] is not None else g[3]
            new = g[4] if g[4] is not None else g[5]
            old_codes = parse_cth(old_a or "")
            alt_codes = parse_cth(old_b or "") if old_b else None
            new_codes = parse_cth(new) if new is not None else {"include": [], "anyChapter": False}
            if old_codes and new_codes is not None:
                ops.append({"op": "codes", "from": old_codes["include"], "alt": (alt_codes or {}).get("include"),
                            "to": new_codes["include"], "serials": serials})
                continue
        if re.search(r"\bomit\b", c, re.I) and col and col.group(1) == "2" and vals:
            codes = []
            for v in vals:
                pc = parse_cth(v)
                if pc:
                    codes += pc["include"]
            if codes:
                for code in codes:
                    ops.append({"op": "codes", "from": [code], "alt": None, "to": [], "serials": serials})
                continue
        if col and (vals or re.search(r"for\s+the\s+entry", c, re.I)):
            new_val = old_val = None
            m_read = re.search(r"\bfor\s+" + QUOTED + r"\s*,?\s*read\s+" + QUOTED, c, re.I)
            m_words = re.search(r"for\s+the\s+(?:words?|entry|entries)\s+" + QUOTED + r"\s*,?\s*the\s+(?:following\s+)?(?:words?|entry|entries)\s*(?:shall\s+be\s+substituted\s*,?\s*namely\s*:?\s*-?\s*)?" + QUOTED, c, re.I)
            m_entry = re.search(r"the\s+(?:following\s+)?entr(?:y|ies)\s*(?:shall\s+be\s+substituted\s*,?\s*namely\s*:?\s*-?\s*)?" + QUOTED, c, re.I)
            if m_read:
                old_val = m_read.group(1) if m_read.group(1) is not None else m_read.group(2)
                new_val = m_read.group(3) if m_read.group(3) is not None else m_read.group(4)
            elif m_words:
                old_val = m_words.group(1) if m_words.group(1) is not None else m_words.group(2)
                new_val = m_words.group(3) if m_words.group(3) is not None else m_words.group(4)
            elif m_entry:
                new_val = m_entry.group(1) if m_entry.group(1) is not None else m_entry.group(2)
            if new_val is not None and serials:
                ops.append({"op": "cell", "serials": serials, "column": int(col.group(1)), "from": old_val, "to": new_val})
                continue
            if new_val is not None and old_val is not None:
                ops.append({"op": "cell", "serials": None, "column": int(col.group(1)), "from": old_val, "to": new_val})
                continue
        unread.append(c[:300])
    return ops, unread


def column_role(rows: list[dict], column_roles: list[str | None], k: int) -> str | None:
    if 1 <= k <= len(column_roles):
        return column_roles[k - 1]
    return None


def apply_ops(rows: list[dict], ops: list[dict], column_roles: list[str | None]) -> tuple[list[dict], list[str], bool]:
    """Apply cell/code operations to a copy of the raw rows. Returns (rows, failures, changed)."""
    rows = copy.deepcopy(rows)
    failures: list[str] = []
    changed = False
    for op in ops:
        if op["op"] == "codes":
            hit = False
            for r in rows:
                if op["serials"] and r["serial"] not in op["serials"]:
                    continue
                current = r["values"].get("_include")
                if current is None:
                    pc = parse_cth(r["values"].get("cth", ""))
                    if not pc:
                        continue
                    current = pc["include"]
                for old in (op["from"], op.get("alt")):
                    if old and all(code in current for code in old):
                        pos = current.index(old[0])
                        rest = [x for x in current if x not in old]
                        new = rest[:pos] + [x for x in op["to"] if x not in rest] + rest[pos:]
                        r["values"]["_include"] = new
                        hit = changed = True
                        break
            if not hit:
                failures.append(f"tariff code(s) {', '.join(op['from'])} not found in the table")
        elif op["op"] == "cell":
            role = column_role(rows, column_roles, op["column"])
            if role in (None, "serial"):
                failures.append(f"column ({op['column']}) does not map to a known column of the table")
                continue
            hit = False
            for r in rows:
                if op["serials"] and r["serial"] not in op["serials"]:
                    continue
                cur = r["values"].get(role, "")
                if op["from"] is not None:
                    if compact(op["from"]) and compact(op["from"]) in compact(cur):
                        if prose(op["from"]) in cur:
                            r["values"][role] = cur.replace(prose(op["from"]), prose(op["to"]))
                        elif compact(cur) == compact(op["from"]):
                            r["values"][role] = prose(op["to"])
                        else:
                            continue
                        hit = changed = True
                    elif compact(op["from"]) == "" and op["serials"]:
                        r["values"][role] = prose(op["to"])
                        hit = changed = True
                else:
                    r["values"][role] = prose(op["to"])
                    hit = changed = True
            if not hit:
                failures.append(f"column ({op['column']}) value {op['from']!r} not found for S.No. {op['serials']}")
    return rows, failures, changed


# --------------------------------------------------------------------------- #
# Safeguard duty: prose, not a producer table
# --------------------------------------------------------------------------- #

RATE_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "twenty-five": 25,
}


def rate_number(text: str) -> float | None:
    t = text.strip().lower()
    if re.fullmatch(r"\d+(?:\.\d+)?", t):
        return float(t)
    m = re.fullmatch(r"([a-z-]+)(?:\s+point\s+([a-z]+))?", t)
    if not m or m.group(1) not in RATE_WORDS:
        return None
    value = float(RATE_WORDS[m.group(1)])
    if m.group(2):
        if m.group(2) not in RATE_WORDS or RATE_WORDS[m.group(2)] > 9:
            return None
        value += RATE_WORDS[m.group(2)] / 10
    return value


def build_safeguard(n: Notification) -> tuple[list[dict], list[str]]:
    d = n.doc
    body = d.body()
    errors: list[str] = []
    m = re.search(r"hereby\s+imposes?\s+on\s+(?:the\s+)?subject\s+goods\s+falling\s+under\s+(?:the\s+)?(?:tariff\s+(?:headings?|items?)|headings?)\s+(.*?)\s+of\s+the\s+First\s+Schedule", body, re.I)
    cth = parse_cth(m.group(1)) if m else None
    if not cth:
        return [], ["tariff headings of the subject goods not found in the operative paragraph"]
    rate_re = r"(\d+(?:\.\d+)?|[a-z-]+(?:\s+point\s+[a-z]+)?)\s*per\s*cent\.?\s*ad\s*valorem"
    periods = []
    for pm in re.finditer(rate_re + r"(.{0,80}?)when\s+imported\s+during\s+the\s+period\s+from\s+(.{6,40}?)\s+to\s+(.{6,40}?)(?=\s*\(|\s*;|\s*:|\.\s|\s+and\b|$)", body, re.I):
        rate = rate_number(pm.group(1))
        start, end = first_date(pm.group(3)), first_date(pm.group(4))
        if rate is None or not start or not end:
            errors.append(f"safeguard period not read: {pm.group(0)[:120]!r}")
            continue
        periods.append({"rate": rate, "from": start, "until": end, "minus": "minus" in pm.group(2).lower(), "text": pm.group(0)})
    if not periods:
        pm = re.search(r"(?:provisional\s+)?safeguard\s+duty\s+at\s+the\s+rate\s+of\s+" + rate_re, body, re.I)
        if pm and rate_number(pm.group(1)) is not None and not n.inferred:
            periods.append({"rate": rate_number(pm.group(1)), "from": n.valid_from, "until": n.valid_until, "minus": False, "text": pm.group(0)})
    if not periods:
        return [], errors or ["safeguard rate and period not found"]
    gap_rule = bool(re.search(r"shall\s+not\s+be\s+levied\s+for\s+the\s+period\s+commencing\s+from\s+the\s+date\s+of\s+the\s+lapse\s+of\s+the\s+provisional", body, re.I))
    floors = []
    for fm in re.finditer(r"(\d{1,2})\.\s+([A-Z][^0-9]{3,200}?)\s+(\d+(?:\.\d+)?)\s+(MT|KG|Tonne)\s+(USD|US\$)", body):
        floors.append({"serial": fm.group(1), "productCategory": fm.group(2).strip(), "cifPrice": num(float(fm.group(3))),
                       "unit": norm_unit(fm.group(4)), "currency": norm_currency(fm.group(5))})
    exempt = re.search(r"Nothing\s+contained\s+in\s+this\s+notification\s+shall\s+apply\s+to\s+imports?\s+(.*?)(?=\s+\d\.\s+[A-Z]|\s+Explanation|$)", body, re.I | re.S)
    excluded = re.search(r"following\s+products\s+are\s+excluded\s+from\s+the\s+scope\s+of\s+subject\s+goods\s*:?\s*(.*?)(?=;\s*\(ii\)|\(ii\)\s+the\s+rate)", body, re.I | re.S)
    entries = []
    for i, p in enumerate(periods, start=1):
        start = p["from"]
        note = None
        if gap_rule and start < d.date:
            start = d.date
            note = "not levied between the lapse of the provisional duty and this notification's publication"
        entry = {
            "kind": "SAFEGUARD",
            "notification": d.label,
            "notificationShort": notification_short(d.no, d.year),
            "notificationDate": d.date.isoformat(),
            "tableSerial": None,
            "include": cth["include"],
            "description": re.search(r"in\s+the\s+matter\s+of\s+(?:import\s+of\s+)?\"([^\"]+)\"", d.text, re.I).group(1) if re.search(r"in\s+the\s+matter\s+of\s+(?:import\s+of\s+)?\"([^\"]+)\"", d.text, re.I) else d.title,
            "specification": None,
            "originCountries": ["ANY"],
            "exportCountries": ["ANY"],
            "producer": "ANY",
            "exporter": "ANY",
            "supplierSerial": None,
            "basis": "AV",
            "rate": num(p["rate"]),
            "amount": None,
            "unit": None,
            "currency": None,
            "validFrom": start.isoformat(),
            "validUntil": p["until"].isoformat(),
            "validityInferred": False,
            "period": i if len(periods) > 1 else None,
            "page": None,
        }
        if p["minus"]:
            entry["minusAntiDumpingDuty"] = True
        if note:
            entry["periodNote"] = note
        if floors:
            entry["notLeviedAtOrAboveCifPrice"] = floors
        if exempt:
            entry["developingCountryExemption"] = prose(exempt.group(1))[:600]
        if excluded:
            entry["excludedProducts"] = prose(excluded.group(1))[:1200]
        entries.append(entry)
    return entries, errors


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #

OUTPUT_ORDER = [
    "kind", "notification", "notificationShort", "notificationDate", "tableSerial", "subRow", "table", "include",
    "anyChapter", "description", "specification", "specificationDescription", "originCountries", "originExcept", "exportCountries",
    "exportExcept", "originOrExport", "exportCountriesNotStated", "producer", "exporter", "residual",
    "producerExporterCombined", "partyIsListReference", "supplierSerial", "basis", "rate", "amount", "unit", "currency", "validFrom",
    "validUntil", "validityInferred", "amendedBy", "rescindedBy", "supersededBy", "unappliedAmendments",
    "scopeAmendments", "dutyNotes", "provisionalAssessment", "period", "periodNote", "minusAntiDumpingDuty",
    "notLeviedAtOrAboveCifPrice", "developingCountryExemption", "excludedProducts", "page", "pageOf", "sourceText",
]


def overlaps(a_from: dt.date, a_until: dt.date) -> bool:
    return a_from <= AS_OF and a_until >= WINDOW_FROM


def doc_ref(d: Doc) -> str:
    return d.label if not d.corrigendum else f"Corrigendum dated {d.date.isoformat()} ({d.file})"


def content_key(e: dict) -> str:
    skip = {"validFrom", "validUntil", "amendedBy", "page", "sourceText", "unappliedAmendments", "scopeAmendments", "pageOf"}
    return json.dumps({k: v for k, v in e.items() if k not in skip}, sort_keys=True, default=str)


def build_notification(n: Notification, report: dict) -> tuple[list[dict], list[dict]]:
    """Versioned entries for one imposing notification, and its unparsed items."""
    d = n.doc
    unparsed: list[dict] = []
    if d.kind == "SAFEGUARD":
        entries, errors = build_safeguard(n)
        for e in entries:
            e["amendedBy"] = list(n.amended_by)
            e["rescindedBy"] = n.rescinded_by
        for err in errors:
            unparsed.append({"file": d.file, "notification": d.label, "reason": err})
        return entries, unparsed
    if d.ocr or d.scan:
        unparsed.append({"file": d.file, "notification": d.label,
                         "reason": "scanned image without a text layer; OCR used only for validity/amendment text, duty table not read"
                         if d.ocr else "scanned image without a text layer (OCR unavailable); nothing read"})
        return [], unparsed

    segments = extract_segments(d)
    gaps: list[str] = []
    rows, problems = resolve_rows(segments, [pg.get_text() for pg in d.fitz], gaps)
    for g in gaps:
        report.setdefault("gaps", []).append({"notification": d.label, "file": d.file, "note": g})
    if not rows:
        unparsed.append({"file": d.file, "notification": d.label, "reason": "no ruled duty table recognised"})
        return [], unparsed
    base_roles = next((sg.roles for sg in segments if sg.rows), [])
    problems += column_disagreements(d.body(), base_roles)
    if problems:
        unparsed.append({"file": d.file, "notification": d.label, "reason": "duty table structure unreliable: " + "; ".join(problems[:4])})
        return [], unparsed
    notes_text = duty_notes(d.body())
    spec_key = specification_key(d)

    # versions: [effective_from, rows, roles, source doc, basis override]
    versions = [{"from": n.valid_from, "rows": rows, "roles": base_roles, "doc": d, "basis": None, "origin": "base", "by": []}]
    unapplied: list[tuple[dt.date, str]] = []
    scope: list[dict] = []
    applied: list[tuple[dt.date, str]] = []
    events = [(d2, t, True) for d2, t in n.corrigenda] + [(d2, t, False) for d2, t in n.instructions]
    events.sort(key=lambda x: (0 if x[2] else 1, effective_date(x[0])))
    for d2, text, is_corr in events:
        ops, unread = parse_ops(text, is_corr)
        eff = n.valid_from if is_corr else max(effective_date(d2), n.valid_from)
        label = doc_ref(d2)
        failures = [f"clause not understood: {u[:160]}" for u in unread]
        did = False
        for op in ops:
            if op["op"] == "note":
                scope.append({"by": label, "text": op["text"]})
                did = True
            elif op["op"] == "validity":
                did = True  # applied in the timeline
            elif op["op"] == "table":
                segs2 = extract_segments(d2)
                rows2, p2 = resolve_rows(segs2, [pg.get_text() for pg in d2.fitz])
                if not rows2 or p2:
                    failures.append("substituted table could not be read" + (": " + "; ".join(p2[:2]) if p2 else ""))
                    continue
                roles2 = next((sg.roles for sg in segs2 if sg.rows), [])
                disagree = column_disagreements(d2.body(), roles2)
                if disagree:
                    failures.append("substituted table header disagrees with its paragraph: " + "; ".join(disagree[:2]))
                    continue
                if is_corr:
                    versions = [{"from": n.valid_from, "rows": rows2, "roles": roles2, "doc": d2, "basis": None, "origin": label, "by": [label]}]
                else:
                    versions.append({"from": eff, "rows": rows2, "roles": roles2, "doc": d2, "basis": None, "origin": label, "by": [label]})
                did = True
            elif op["op"] == "basis":
                targets = versions if is_corr else [versions[-1]]
                for v in targets:
                    v["basis"] = op["basis"]
                    v["by"].append(label)
                did = True
        cell_ops = [o for o in ops if o["op"] in ("codes", "cell")]
        if cell_ops:
            if is_corr:
                for v in versions:
                    if v["origin"] != "base":
                        continue
                    new_rows, fails, changed = apply_ops(v["rows"], cell_ops, v["roles"])
                    failures += fails
                    if changed:
                        v["rows"] = new_rows
                        v["by"].append(label)
                        did = True
            else:
                last = versions[-1]
                new_rows, fails, changed = apply_ops(last["rows"], cell_ops, last["roles"])
                failures += fails
                if changed:
                    if eff <= last["from"]:
                        last["rows"] = new_rows
                        last["by"].append(label)
                    else:
                        versions.append({"from": eff, "rows": new_rows, "roles": last["roles"], "doc": last["doc"],
                                         "basis": last["basis"], "origin": last["origin"], "by": [label]})
                    did = True
        if failures:
            for f in failures:
                unapplied.append((eff, f"{label}: {f}"))
            unparsed.append({"file": d2.file, "notification": d.label, "reason": f"amendment not fully applied by {label}: " + "; ".join(failures[:3])})
        if did:
            applied.append((eff, label))
            report["applied"].append({"notification": d.label, "by": label, "effective": eff.isoformat(),
                                      "ops": sorted({o["op"] for o in ops}), "partial": bool(failures)})
        elif failures:
            report["unapplied"].append({"notification": d.label, "by": label, "reason": "; ".join(failures[:3])})

    out: list[dict] = []
    for i, v in enumerate(versions):
        v_from = max(v["from"], n.valid_from)
        v_until = versions[i + 1]["from"] - dt.timedelta(days=1) if i + 1 < len(versions) else n.valid_until
        if v_until < v_from or not overlaps(v_from, v_until):
            continue
        entries, errors = build_entries(v["doc"], v["rows"], d.kind, d.label, notification_short(d.no, d.year), d.date, v["basis"])
        for err in errors:
            unparsed.append({"file": v["doc"].file, "notification": d.label,
                             "reason": f"row refused ({'version from ' + v_from.isoformat() if len(versions) > 1 else 'base table'}): {err}"})
        for e in entries:
            if v["doc"] is not d:
                e["pageOf"] = v["doc"].file  # the page number is in the amending document
            e["validFrom"] = v_from.isoformat()
            e["validUntil"] = v_until.isoformat()
            e["validityInferred"] = n.inferred
            by = [lbl for eff, lbl in applied if eff <= v_until] + list(n.extended_by)
            e["amendedBy"] = list(dict.fromkeys(by))
            e["rescindedBy"] = n.rescinded_by
            if n.superseded_by:
                e["supersededBy"] = n.superseded_by
            un = [txt for eff, txt in unapplied if eff <= v_until]
            if un:
                e["unappliedAmendments"] = un
            if scope:
                e["scopeAmendments"] = scope
            if n.provisional_assessment:
                e["provisionalAssessment"] = n.provisional_assessment
            if notes_text:
                e["dutyNotes"] = notes_text
            for f in ("producer", "exporter"):
                if re.search(r"as\s*per\s*(?:the\s*)?list|list(?:ed)?\s*below|annexure", e.get(f, ""), re.I):
                    e["partyIsListReference"] = True
                    unparsed.append({"file": v["doc"].file, "notification": d.label,
                                     "reason": f"S.No. {e['tableSerial']}: {f} is a reference to a list printed outside the table ({e[f][:80]!r}); the list is not parsed, the row is emitted with partyIsListReference"})
            if spec_key and e.get("specification") in spec_key and v["doc"] is d:
                e["specificationDescription"] = spec_key[e["specification"]]
            out.append(e)

    # merge windows where nothing about a row changed
    merged: list[dict] = []
    index: dict[tuple, dict] = {}
    for e in out:
        k = (e["tableSerial"], e.get("subRow"), e.get("table"), content_key(e))
        prev = index.get(k)
        if prev and dt.date.fromisoformat(prev["validUntil"]) + dt.timedelta(days=1) == dt.date.fromisoformat(e["validFrom"]):
            prev["validUntil"] = e["validUntil"]
            prev["amendedBy"] = list(dict.fromkeys(prev["amendedBy"] + e["amendedBy"]))
            if e.get("unappliedAmendments"):
                prev["unappliedAmendments"] = list(dict.fromkeys(prev.get("unappliedAmendments", []) + e["unappliedAmendments"]))
            continue
        index[k] = e
        merged.append(e)
    return merged, unparsed


def ordered(e: dict) -> dict:
    out = {k: e[k] for k in OUTPUT_ORDER if k in e and (e[k] is not None or k in (
        "specification", "supplierSerial", "rate", "amount", "unit", "currency", "rescindedBy", "tableSerial", "page"))}
    for k, v in e.items():
        if k not in out and v is not None and k not in OUTPUT_ORDER:
            out[k] = v
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    docs = load_docs()
    notifs, classes = build_timeline(docs)
    report = {"applied": [], "unapplied": []}
    entries: list[dict] = []
    unparsed: list[dict] = []
    in_window: list[Notification] = []
    skipped = 0
    for n in sorted(notifs.values(), key=lambda n: (n.doc.date, n.doc.no or 0)):
        if not overlaps(n.valid_from, n.valid_until):
            skipped += 1
            continue
        in_window.append(n)
        es, un = build_notification(n, report)
        entries += es
        unparsed += un
    for d in docs:
        if classes[d.file] == "SCAN":
            unparsed.append({"file": d.file, "notification": d.label, "reason": "scanned image, OCR unavailable: not classified"})
        elif classes[d.file] == "OTHER" and d.date >= dt.date(2019, 1, 1):
            unparsed.append({"file": d.file, "notification": d.label, "reason": "operative paragraph not recognised (not an imposition, amendment or rescission)"})

    # index records whose PDF is not in the corpus
    index = json.loads(INDEX.read_text())
    have = {d.record["id"] for d in docs}
    for r in index:
        if r["notificationCategory"] in CATEGORIES and r["id"] not in have and r["notificationDt"][:4] >= "2019":
            unparsed.append({"file": f"(no PDF in corpus; index id {r['id']})", "notification": r["notificationNo"],
                             "reason": "listed in cbic-notifications.json but not downloaded: " + prose(r["notificationName"])[:160]})

    entries = [ordered(e) for e in entries]
    entries.sort(key=lambda e: ({"ADD": 0, "CVD": 1, "SAFEGUARD": 2}[e["kind"]], e["notificationDate"], e["notification"],
                                int(re.match(r"\d+", e["tableSerial"]).group(0)) if e.get("tableSerial") else 0,
                                e.get("subRow") or 0, e["validFrom"]))
    # de-duplicate unparsed reasons
    seen = set()
    unique_unparsed = []
    for u in unparsed:
        k = (u["file"], u["reason"])
        if k not in seen:
            seen.add(k)
            unique_unparsed.append(u)

    master = {
        "asOf": AS_OF.isoformat(),
        "window": {"from": WINDOW_FROM.isoformat(), "to": AS_OF.isoformat()},
        "source": "data/customs-corpus/notifications (CBIC), parsed by packages/core/scripts/build-trade-remedies.py",
        "skippedNotifications": skipped,
        "entries": entries,
        "unparsed": unique_unparsed,
    }
    (OUT / "trade-remedies.json").write_text(json.dumps(master, indent=1, ensure_ascii=False) + "\n")
    write_report(master, in_window, report, docs, classes)
    print(f"entries {len(entries)}; in-window notifications {len(in_window)}; skipped {skipped}; unparsed {len(unique_unparsed)}")


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #

# Rows checked by eye against the rendered PDF page. The report prints the
# page text around each row next to the JSON, so a regeneration re-shows the
# evidence; the verdict is the human reading recorded when the check was done.
SPOT_CHECKS: list[dict] = [
    {"notification": "16/2024-Customs (ADD)", "serial": "4", "anchor": "Jiangyin Haihong New",
     "verdict": "Matches. The PDF's single Producer/Exporter cell holds two companies; both are kept in one string "
                "(producerExporterCombined). 418 USD per MT, tariff items 7610 9010, 7610 9030, 7616 9990 via '-do-' from S.No. 1."},
    {"notification": "11/2024-Customs (ADD)", "serial": "6", "anchor": "162.50",
     "verdict": "Matches. 'Any country other than subject countries' is resolved to ANY except the table's named origins "
                "(China PR, Korea RP); duty column header is 'Duty (% of CIF Value in USD)', so basis CIF_PCT, rate 162.5."},
    {"notification": "77/2021-Customs (ADD)", "serial": "2", "validOn": "2025-07-01", "anchor": "Zibo OU",
     "verdict": "Matches the table substituted by 19/2025-Customs (ADD) from 24.06.2025 (S.No. 2 there is Zibo OU-MU, "
                "110 USD/MT). The pre-amendment row (Shandong Boxing Ouhua, from 15/2022's table) is a separate entry ending 23.06.2025."},
    {"notification": "1/2024-Customs (ADD)", "serial": "1", "anchor": "Zhejian",
     "verdict": "The PDF prints 1.50 USD per MT; the corrigendum of 26.03.2024 reads column (9) as KG for S.No. 1-3. "
                "JSON carries KG ab initio and lists the corrigendum in amendedBy. The wrapped name 'Zhejian|g Amino-|Chem' is rejoined."},
    {"notification": "64/2021-Customs (ADD)", "serial": "1", "anchor": "A-1-2",
     "verdict": "Matches. S.No. 1 has eight specification sub-rows (A-1-1..A-1-8); the entry shown is the first. The duty is a "
                "reference price (operative text: 'difference between the landed value ... and the amount in column (8)'), "
                "1,194.60 USD/MT; validity extended to 27.01.2027 by 16/2026-Customs (ADD)."},
    {"notification": "2/2025-Customs (SG)", "serial": None, "validOn": "2026-06-01", "anchor": "11.5 percent",
     "verdict": "Matches clause (b): 11.5 percent ad valorem for imports from 21.04.2026 to 20.04.2027 on headings 7208-7212, 7225, 7226."},
]


def row_snippet(doc: Doc, page: int, serial: str, anchor: str) -> str:
    text = doc.pages[page - 1] if doc and 0 < page <= len(doc.pages) else ""
    text = text.replace("|", "/").replace("`", "'")
    i = text.find(anchor) if anchor else -1
    if i < 0:
        m = re.search(r"(?:^|\s)" + re.escape(serial) + r"\.?\s", text)
        i = m.start() if m else 0
    return text[max(0, i - 60): i + 260]


def write_report(master: dict, in_window: list[Notification], report: dict, docs: list[Doc], classes: dict) -> None:
    entries = master["entries"]
    by_kind = Counter(e["kind"] for e in entries)
    notif_with_rows = defaultdict(set)
    for e in entries:
        notif_with_rows[e["kind"]].add(e["notification"])
    win_by_kind = defaultdict(list)
    for n in in_window:
        win_by_kind[n.doc.kind].append(n)
    lines = [
        "# Trade-remedy master — build report",
        "",
        f"Generated by `packages/core/scripts/build-trade-remedies.py` as of **{master['asOf']}**. "
        f"Window: notifications whose validity overlaps {master['window']['from']} .. {master['window']['to']}.",
        "",
        "## Counts",
        "",
        "| Kind | Notifications in window | with rows emitted | Coverage | Entries |",
        "|---|---:|---:|---:|---:|",
    ]
    total_w = total_r = 0
    for kind in ("ADD", "CVD", "SAFEGUARD"):
        w = len(win_by_kind[kind])
        r = len(notif_with_rows[kind])
        total_w += w
        total_r += r
        lines.append(f"| {kind} | {w} | {r} | {100 * r / w if w else 0:.0f}% | {by_kind[kind]} |")
    lines.append(f"| **All** | **{total_w}** | **{total_r}** | **{100 * total_r / total_w if total_w else 0:.0f}%** | **{len(entries)}** |")
    lines += [
        "",
        f"Older notifications whose validity ended before {master['window']['from']}: **{master['skippedNotifications']}** skipped (count only).",
        f"Entries with `validityInferred: true` (statutory 5-year default, no validity text found): "
        f"{len({e['notification'] for e in entries if e.get('validityInferred')})} notifications "
        f"({', '.join(sorted({e['notification'] for e in entries if e.get('validityInferred')})) or 'none'}).",
        f"Entries carrying `unappliedAmendments`: {sum(1 for e in entries if e.get('unappliedAmendments'))}.",
        "",
        "## Validity changes applied",
        "",
        "| Notification | Base window | Final window | By |",
        "|---|---|---|---|",
    ]
    for n in in_window:
        base = n.validity
        changes = []
        if n.extended_by:
            changes.append("extended by " + ", ".join(dict.fromkeys(n.extended_by)))
        if n.rescinded_by:
            changes.append("rescinded by " + n.rescinded_by)
        if n.superseded_by:
            changes.append("superseded by " + n.superseded_by)
        if n.validity.get("coterminousWith"):
            changes.append("co-terminous with " + n.validity["coterminousWith"].split(":")[1])
        if changes:
            lines.append(f"| {n.doc.label} | {base['validFrom']} .. {base['validUntil'] or 'co-terminous'} | {n.valid_from} .. {n.valid_until} | {'; '.join(changes)} |")
    resc_docs = [d for d in docs if classes.get(d.file) == "RESCIND"]
    resc_hits = [n for n in in_window if n.rescinded_by]
    lines += [
        "",
        f"Rescission notifications read: {len(resc_docs)} (all years). Rescissions ending a notification inside the window: "
        f"{len(resc_hits)}{' (' + ', '.join(n.doc.label + ' by ' + n.rescinded_by for n in resc_hits) + ')' if resc_hits else ''}.",
    ]
    lines += ["", "## Table amendments and corrigenda", "", "| Notification | Amended by | Effective | Operations | Status |", "|---|---|---|---|---|"]
    for a in report["applied"]:
        lines.append(f"| {a['notification']} | {a['by']} | {a['effective']} | {', '.join(a['ops'])} | {'partly applied' if a['partial'] else 'applied'} |")
    for a in report["unapplied"]:
        lines.append(f"| {a['notification']} | {a['by']} | | | **not applied**: {a['reason'][:200]} |")
    if report.get("gaps"):
        lines += ["", "## Source numbering gaps (rows emitted)", ""]
        for g in report["gaps"]:
            lines.append(f"- {g['notification']} (`{g['file']}`): {g['note']}")
    lines += ["", "## Unparsed", "", f"{len(master['unparsed'])} items. A notification listed here may still have rows in the master when only some rows were refused.", "", "| File | Notification | Reason |", "|---|---|---|"]
    for u in master["unparsed"]:
        lines.append(f"| `{u['file']}` | {u.get('notification', '')} | {u['reason'].replace('|', '/')[:400]} |")
    lines += [
        "",
        "## Caveats",
        "",
        "- `supplierSerial` is always null: a notification numbers each row once (`tableSerial`, the CTHSrNo); how ICES derives a separate supplier serial is not stated in any PDF.",
        "- `unit` is the notification's own unit normalised (MT, KG, SQM, NOS, MTR, KFKM, LAKH_PCS); mapping to the Logi-Sys ADD_AmountUnit code list is not verified.",
        "- `basis`: SPECIFIC (amount/unit/currency), CIF_PCT / LANDED_PCT / AV (rate %), REFERENCE_PRICE (duty = amount minus landed value when positive). `dutyNotes` carries sentences that further change the computation (ADD minus CVD, minus safeguard, etc.) — they are not applied to the numbers.",
        "- Residual rows: `producer`/`exporter` = ANY with the printed wording in `residual`; 'Any country other than subject countries / countries attracting ADD / above' is resolved to ANY with `originExcept`/`exportExcept` = the named origin countries of that table.",
        "- `scopeAmendments` (inserted notes, excluded products, footnotes) are recorded but not applied to `description`.",
        "- A final duty that runs from the provisional duty's date ends the provisional notification the day before the final one; an 'in supersession of' notification ends the old one the day before. A rescission ends a notification the day before the rescission.",
        "- Scanned notifications are OCR'd (macOS Vision) only to read validity, extension and supersession text; their duty tables are not emitted. On a machine without Swift/Vision those files are only listed.",
        "- The 2024-01-01 window filter is on final validity; rows of a notification that was table-amended keep one entry per dated version.",
    ]
    lines += ["", "## Spot checks", ""]
    docs_by_label = {d.label: d for d in docs if not d.corrigendum}
    for sc in SPOT_CHECKS:
        match = [e for e in entries if e["notification"] == sc["notification"] and e.get("tableSerial") == sc["serial"]
                 and not e.get("subRow")
                 and (sc.get("validOn") is None or e["validFrom"] <= sc["validOn"] <= e["validUntil"])]
        if not match:
            lines += [f"### {sc['notification']} S.No. {sc['serial']}", "", "**Row not found in the master.**", ""]
            continue
        e = match[0]
        src = docs_by_label.get(sc["notification"])
        src_doc = src if not e.get("pageOf") else next((d for d in docs if d.file == e["pageOf"]), src)
        page_no = e["page"] or next((i + 1 for i, t in enumerate(src_doc.pages) if sc.get("anchor", "") in t), 1)
        snippet = row_snippet(src_doc, page_no, sc["serial"] or "", sc.get("anchor", ""))
        shown = {k: e.get(k) for k in ("include", "originCountries", "exportCountries", "producer", "basis", "rate", "amount", "unit", "currency", "validFrom", "validUntil", "amendedBy")}
        lines += [
            f"### {sc['notification']} — {'S.No. ' + sc['serial'] if sc['serial'] else 'period ' + str(e.get('period'))} (page {page_no}{' of ' + e['pageOf'] if e.get('pageOf') else ''})",
            "",
            f"PDF text: `{snippet}`",
            "",
            f"JSON: `{json.dumps(shown, ensure_ascii=False)}`",
            "",
            f"Check: {sc['verdict']}",
            "",
        ]
    (OUT / "trade-remedies.REPORT.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
