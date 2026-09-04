#!/usr/bin/env python3
"""
Downloads the customs corpus into data/customs-corpus/.

    python3 packages/core/scripts/fetch-corpus.py [tariff|notifications|masters|all]

The corpus is ~1.3 GB and is gitignored; this script is how it comes back. The
parsed output in data/customs-corpus/index/ IS committed, so a fresh clone can
run build-masters.py without downloading anything.

## Where the data comes from, and why these routes

CBIC rebuilt cbic.gov.in as an Angular SPA. The old static repository path
(CONTENTREPO/Customs/Tariff/Tariff(ason<EDITION>)/...) now 404s for every
edition, which is what broke packages/library/src/fetch.ts. The documents are
still there; they are just addressed through the site's own JSON API:

    GET /api/cbic-content-msts/<base64(contentId)>
        -> a content node, whose cbicDocMsts[] carry filePathEn
    GET /content/pdf/<filePathEn>
        -> {"data": "<base64 PDF>", "fileName": ...}

Note the id in the URL is base64 of the decimal id -- the API rejects the bare
number. Content id 172462 is "Tariff (as on 30.06.2025)", the root of the whole
Customs Tariff: PART I general notes, PART II the Import Tariff (98 chapters of
the First Schedule), PART III, PART IV the Export Tariff, PART V anti-dumping.

A chapter node often points at an older edition folder than its parent -- CBIC
republishes a chapter only when it changes -- so the path is taken from the node
rather than constructed from an edition string. That is the mistake the old
scraper made.

taxinformation.cbic.gov.in carries the notifications on a different JHipster
API, where records are enumerable by sequential id from 1000001. A missing id
returns an empty body rather than a 404, so absence is detected by length.
That host serves an incomplete TLS chain (the Sectigo "OV R36" intermediate is
missing); browsers repair it by AIA fetching and so, in practice, does urllib
on macOS. If it fails on your platform, see the pinned intermediate in
packages/library/src/fetch.ts.

Neither API is documented or versioned. Both are polled read-only, one request
at a time per worker, and every failure is reported rather than retried
forever -- a partial corpus that says so is better than a silent one.
"""

from __future__ import annotations

import base64
import concurrent.futures as cf
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CORPUS = ROOT / "data" / "customs-corpus"
UA = "Mozilla/5.0 (compatible; checklist-app-corpus/1.0)"

CBIC = "https://www.cbic.gov.in"
TAXINFO = "https://taxinformation.cbic.gov.in"

# "Tariff (as on 30.06.2025)" -- the root of the three-volume Customs Tariff.
TARIFF_ROOT_ID = 172462

# Customs. The other tax ids (GST, Central Excise, Service Tax) share the table.
CUSTOMS_TAX_ID = 1000002

# Notification ids seen so far run 1000001..1010705. The ceiling is deliberately
# past the end: the scan stops finding records, it does not stop at a boundary.
NOTIFICATION_IDS = range(1000001, 1012000)

# The categories that bear on a Bill of Entry. Central/UT Tax and the GST-only
# rate notifications are skipped -- they are a different levy.
DUTY_CATEGORIES = {
    "Tariff",
    "Non Tariff",
    "Anti Dumping Duty",
    "CVD",
    "Safeguards",
    "Integrated Tax (Rate)",
    "Integrated Tax",
    "Compensation Cess (Rate)",
    "Compensation Cess",
    "Others",
}


def get_json(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    body = urllib.request.urlopen(req, timeout=timeout).read()
    return json.loads(body) if body.strip() else None


def b64(n: int) -> str:
    return base64.b64encode(str(n).encode()).decode()


def safe(s: str | None) -> str:
    return "".join(c if c.isalnum() or c in "-._" else "_" for c in (s or ""))


# --------------------------------------------------------------------------
# Tariff: walk the content tree, then pull each document it names.
# --------------------------------------------------------------------------

def tariff_documents() -> list[tuple[str, str]]:
    """(title path, filePathEn) for every document under the tariff root."""
    found: list[tuple[str, str]] = []
    seen: set[int] = set()

    def walk(node, path: str) -> None:
        for child in node.get("childContentList") or []:
            cid = child["id"]
            if cid in seen:
                continue
            seen.add(cid)
            here = f"{path}/{child['titleEn']}"
            for doc in child.get("cbicDocMsts") or []:
                if doc.get("filePathEn"):
                    found.append((here, doc["filePathEn"]))
            # childContentCount is not always set on a summary node, so descend
            # unconditionally; `seen` stops the recursion.
            try:
                walk(get_json(f"{CBIC}/api/cbic-content-msts/{b64(cid)}"), here)
            except Exception as exc:
                print(f"  ! {here}: {exc!r}", file=sys.stderr)

    root = get_json(f"{CBIC}/api/cbic-content-msts/{b64(TARIFF_ROOT_ID)}")
    print(f"  root: {root['titleEn']}")
    walk(root, "")
    return found


def fetch_tariff() -> None:
    out = CORPUS / "tariff"
    out.mkdir(parents=True, exist_ok=True)
    docs = {path: title for title, path in tariff_documents()}
    print(f"  {len(docs)} documents")
    (CORPUS / "index" / "tariff-documents.json").write_text(
        json.dumps([{"title": t, "path": p} for p, t in docs.items()], indent=1)
    )

    def one(path: str) -> int:
        name = path.replace("CONTENTREPO/Customs/Tariff/", "").replace("/", "__")
        dest = out / name
        if dest.exists() and dest.stat().st_size > 2000:
            return 0
        try:
            payload = get_json(f"{CBIC}/content/pdf/{path}", timeout=120)
            if not payload or not payload.get("data"):
                return -1
            dest.write_bytes(base64.b64decode(payload["data"]))
            return 1
        except Exception:
            return -1

    report("tariff", cf.ThreadPoolExecutor(6).map(one, docs))


# --------------------------------------------------------------------------
# Notifications: enumerate metadata by id, then pull the duty-bearing ones.
# --------------------------------------------------------------------------

def fetch_notifications() -> None:
    index_path = CORPUS / "index" / "cbic-notifications.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    known = {}
    if index_path.exists():
        known = {r["id"]: r for r in json.loads(index_path.read_text())}

    def meta(i: int):
        try:
            return get_json(f"{TAXINFO}/api/cbic-notification-msts/{i}", timeout=30)
        except Exception:
            return None

    todo = [i for i in NOTIFICATION_IDS if i not in known]
    print(f"  scanning {len(todo)} ids ({len(known)} already indexed)")
    with cf.ThreadPoolExecutor(12) as pool:
        for n, record in enumerate(pool.map(meta, todo)):
            if record and record.get("id"):
                known[record["id"]] = record
            if n and n % 1000 == 0:
                print(f"    {n} scanned, {len(known)} found")
                index_path.write_text(json.dumps(list(known.values())))
    index_path.write_text(json.dumps(list(known.values())))
    print(f"  {len(known)} notifications indexed")

    out = CORPUS / "notifications"
    out.mkdir(parents=True, exist_ok=True)
    wanted = [r for r in known.values() if r.get("notificationCategory") in DUTY_CATEGORIES]
    print(f"  {len(wanted)} in duty-bearing categories")

    def one(record) -> int:
        dest = out / (
            f"{safe(record['notificationCategory'])}__"
            f"{safe(record.get('notificationNo'))}__{record['id']}.pdf"
        )
        if dest.exists() and dest.stat().st_size > 500:
            return 0
        try:
            payload = get_json(
                f"{TAXINFO}/api/cbic-notification-msts/download/{record['id']}/ENG", timeout=90
            )
            if not payload or not payload.get("data"):
                return -1
            dest.write_bytes(base64.b64decode(payload["data"]))
            return 1
        except Exception:
            return -1

    report("notifications", cf.ThreadPoolExecutor(8).map(one, wanted))


# --------------------------------------------------------------------------
# The small reference lists, straight to disk.
# --------------------------------------------------------------------------

MASTERS = {
    # The locations ICES will actually accept -- authoritative over any PDF list.
    "ices-locations.json": "https://foservices.icegate.gov.in/codename/allGobalLocations",
    "ices-sez-ports.json": "https://foservices.icegate.gov.in/codename/getSezPortPublic",
    # Country, currency, state and port names. Note its UQC set is the GST one
    # (45 codes), which is NOT the ICES set (67) -- do not conflate them.
    "einvoice-mastercodes.html": "https://einvoice1.gst.gov.in/Others/MasterCodes",
    # UNECE's own download sits behind a Cloudflare interstitial no automated
    # client gets past; this is the Frictionless Data mirror, ODC-PDDL-1.0.
    "unlocode.csv": "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv",
}


def fetch_masters() -> None:
    out = CORPUS / "index"
    out.mkdir(parents=True, exist_ok=True)
    for name, url in MASTERS.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            (out / name).write_bytes(urllib.request.urlopen(req, timeout=120).read())
            print(f"  ok   {name}")
        except Exception as exc:
            print(f"  FAIL {name}: {exc!r}", file=sys.stderr)


def report(label: str, results) -> None:
    ok = skipped = failed = 0
    for value in results:
        ok += value == 1
        skipped += value == 0
        failed += value == -1
    print(f"  {label}: {ok} downloaded, {skipped} already present, {failed} failed")
    if failed:
        print(f"  {failed} failed -- re-run to retry; the script resumes.", file=sys.stderr)


def main() -> None:
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    steps = {"tariff": fetch_tariff, "notifications": fetch_notifications, "masters": fetch_masters}
    if what not in steps and what != "all":
        sys.exit(f"usage: {sys.argv[0]} [tariff|notifications|masters|all]")
    for name, run in steps.items():
        if what in (name, "all"):
            print(f"== {name}")
            run()


if __name__ == "__main__":
    main()
