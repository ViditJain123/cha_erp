#!/usr/bin/env python3
"""
Regenerates src/masters/generated/ices-errors.ts.

The list of reasons ICES rejects a Bill of Entry.

## Why this is the vendor lock

Every validation rule this system owns was learned by uploading a workbook to
Logi-Sys and reading the ErrorList it handed back — 43 messages, transcribed by
hand into `packages/exporter/test/logisys-validator.test.ts`. That makes
**Logi-Sys' uploader our validator**. While that is true we cannot file
anywhere else, and, worse, we cannot know how wrong we are: the only feedback
loop runs through a vendor we are trying to leave.

ICES publishes its own list. `BE_fresh_filing_error_codes_24032026.pdf` is 13
pages of clean tabular text — no OCR needed — and nothing read it until now.

## What the source actually contains

617 rows, every one `CACHI01` / `BE` / `F`: the fresh-filing message, the Bill
of Entry module, fatal. So `MESG_ID`, `MODULE_ID` and `MESG_TYP` carry no
information *in this document* and are kept only because a later one (amendment,
ex-bond) will not be so uniform.

**Descriptions are clipped in the source.** The PDF was rendered from a report
with a fixed column width, so a long `ERR_DESC` simply stops -- "Problem in
Duty related parameters. Check ". The text layer keeps the trailing space,
which is what `truncated` is detected from. Clipped text is kept verbatim and
marked; completing it by guesswork would put words in ICES' mouth, and these
strings are the thing an operator reads when a filing is rejected.

Source:
  data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf

Run:  python3 packages/core/scripts/build-ices-errors.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent
PDF = (
    REPO
    / "data"
    / "customs-corpus"
    / "icegate-specs"
    / "BE_fresh_filing_error_codes_24032026.pdf"
)
OUT = ROOT / "src" / "masters" / "generated" / "ices-errors.ts"


def main() -> None:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.exit("PyMuPDF is required: pip3 install pymupdf")
    if not PDF.exists():
        sys.exit(f"{PDF} is missing — run packages/core/scripts/fetch-corpus.py")

    with fitz.open(PDF) as doc:
        raw = "\n".join(page.get_text() for page in doc)
        rows = []
        for page in doc:
            for table in page.find_tables():
                rows += [r for r in table.extract() if r and r[0] == "CACHI01"]

    # The same rows read straight off the text layer, as a completeness check.
    # Two routes that disagree mean the table detection moved, and a silently
    # short ruleset is worse than none — it would read as "ICES has no rule
    # about this".
    text_codes = set(re.findall(r"^CACHI01\s+(\d+)\s*$", raw, re.M))
    if {r[1] for r in rows} != text_codes:
        sys.exit(
            f"table extraction found {len({r[1] for r in rows})} codes, the text layer "
            f"{len(text_codes)} — the parse needs a look before it is trusted"
        )

    # A description the PDF clipped keeps its trailing space in the text layer.
    clipped = {
        line[:-1].strip()
        for line in raw.splitlines()
        if line.endswith(" ") and line.strip()
    }

    entries = []
    seen = set()
    for mesg_id, err_cd, err_desc, module_id, mesg_typ in rows:
        code = (err_cd or "").strip()
        desc = " ".join((err_desc or "").split())
        if not code or code in seen:
            continue
        seen.add(code)
        entries.append(
            {
                "code": code,
                "description": desc,
                "message": (mesg_id or "").strip(),
                "module": (module_id or "").strip(),
                "severity": (mesg_typ or "").strip(),
                "truncated": desc in clipped,
            }
        )
    entries.sort(key=lambda e: int(e["code"]))

    truncated = sum(1 for e in entries if e["truncated"])
    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Source: data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf",
        "// Regenerate: python3 packages/core/scripts/build-ices-errors.py",
        "",
        "/** One reason ICES rejects a Bill of Entry. */",
        "export interface IcesError {",
        "  /** `ERR_CD`, as ICES reports it. Unique within the message. */",
        "  code: string;",
        "  /** `ERR_DESC`, verbatim — see `truncated`. */",
        "  description: string;",
        "  /** `MESG_ID`. Every row of this document is `CACHI01`, the fresh BE filing. */",
        "  message: string;",
        "  /** `MODULE_ID`. Every row here is `BE`. */",
        "  module: string;",
        "  /** `MESG_TYP`. Every row here is `F` — fatal. */",
        "  severity: string;",
        "  /**",
        "   * The source PDF clipped this description at its column width, so it stops",
        "   * mid-sentence. Kept verbatim rather than completed by guesswork.",
        "   */",
        "  truncated: boolean;",
        "}",
        "",
        f"/** {len(entries)} rejection codes, {truncated} of them with a description the source clipped. */",
        "export const ICES_ERRORS: IcesError[] = [",
    ]
    for e in entries:
        lines.append(
            "  { "
            + ", ".join(
                f"{k}: {json.dumps(v) if isinstance(v, str) else str(v).lower()}"
                for k, v in e.items()
            )
            + " },"
        )
    lines.append("];")
    lines += [
        "",
        "const BY_CODE = new Map(ICES_ERRORS.map((e) => [e.code, e]));",
        "",
        "/** The rejection ICES means by a code, or `undefined` for one it does not publish. */",
        "export function icesError(code: string): IcesError | undefined {",
        "  return BY_CODE.get(code.replace(/^0+(?=\\d)/, '')) ?? BY_CODE.get(code);",
        "}",
    ]

    OUT.write_text("\n".join(lines) + "\n")
    print(f"{len(entries)} codes -> {OUT.relative_to(ROOT)}")
    print(f"  clipped descriptions : {truncated}")
    print(f"  code range           : {entries[0]['code']} .. {entries[-1]['code']}")


if __name__ == "__main__":
    main()
