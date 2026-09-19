#!/usr/bin/env python3
"""
Downloads the customs corpus into data/customs-corpus/.

    python3 packages/core/scripts/fetch-corpus.py <what>

    tariff | masters                      the cbic.gov.in tariff; the reference lists
    notifications | circulars | instructions | orders | regulations |
    regulation-docs | rules | forms       one taxinformation.cbic.gov.in type
    cbic                                  every taxinformation type
    update                                only what is new or amended since the last run
    all                                   everything

    --rescan   also re-probe ids below the highest one already indexed
    CBIC_RPS, CBIC_DOWNLOAD_RPS   metadata / file requests per second to taxinformation (2 / 0.5)

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

taxinformation.cbic.gov.in carries notifications, circulars, instructions,
orders, regulations, rules and forms on a different JHipster API, where records
are enumerable by sequential id from 1000001 (see DOC_TYPES below). A missing id
returns a 404 or an empty body, so both count as absence.
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
import os
import concurrent.futures as cf
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
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


# taxinformation.cbic.gov.in drops every connection from an address that asks
# too fast: on 2026-09-13, 12 metadata workers plus 8 download workers got this
# machine refused outright (TCP timeouts, not HTTP errors) for over half an
# hour, and after that 3 requests a second got it refused again within ~15
# minutes. So every request to it waits its turn: at most REQUESTS_PER_SECOND
# metadata requests (env CBIC_RPS) or DOWNLOADS_PER_SECOND files
# (env CBIC_DOWNLOAD_RPS) start, however many workers are running.
REQUESTS_PER_SECOND = float(os.environ.get("CBIC_RPS", "2"))
# File downloads are what trips the refusal (metadata scans of 3,500 ids ran
# clean; a few hundred PDFs did not), so they are paced separately and slower.
DOWNLOADS_PER_SECOND = float(os.environ.get("CBIC_DOWNLOAD_RPS", "0.5"))
_throttle_lock = threading.Lock()
_next_start = [0.0]


def throttle(url: str, rate: float | None = None) -> None:
    if "taxinformation" not in url:
        return
    rate = rate or (DOWNLOADS_PER_SECOND if ("/download/" in url or "/content/" in url) else REQUESTS_PER_SECOND)
    with _throttle_lock:
        now = time.monotonic()
        wait = _next_start[0] - now
        _next_start[0] = max(now, _next_start[0]) + 1 / rate
    if wait > 0:
        time.sleep(wait)


def get_json(url: str, timeout: int = 60):
    throttle(url)
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
# taxinformation.cbic.gov.in: every document type, one table.
# --------------------------------------------------------------------------
#
# Every type is the same JHipster entity shape: GET /api/cbic-<endpoint>/<id>
# returns one record, ids are sequential from 1000001, a missing id is a 404 or
# an empty body. The list endpoints (?page=&size=) 500 for the big tables, so the
# sequential scan is the only reliable enumeration.
#
# File routes, probed on the first record of each type (2026-09-13):
#   notification, circular, instruction, order, form
#       /api/cbic-<type>-msts/download/<id>/ENG  -> {"data": base64 PDF}
#   rule
#       /api/cbic-rule-msts/download/<id>        -> {"data": base64 PDF}
#       (the /ENG variant returns the SPA shell)
#   regulation
#       one record per *section*; contentFilePath is an .html fragment served at
#       /content/html/<path with forward slashes>. The WAF rejects %5C, so the
#       Windows backslashes must be turned into "/" -- that is what a browser does.
#   anything else
#       /content/pdf/<path with forward slashes>  -> {"data": base64 PDF}, the
#       same route cbic.gov.in uses for the tariff. Used as the fallback.
#
# Every record carries its tax: 1000002 Customs, 1000001 GST, 1000003 Central
# Excise, 1000004 Service Tax (rules call the field cbicTaxMst). The index keeps
# every tax; files are downloaded only for Customs -- except notifications, which
# keep their historical category filter (DUTY_CATEGORIES) because CBIC files
# some customs-relevant IGST/cess notifications under other taxes.

DOC_TYPES: dict[str, dict] = {
    "notification": {
        "endpoint": "cbic-notification-msts",
        "number": "notificationNo", "name": "notificationName",
        "date": "notificationDt", "category": "notificationCategory",
        "file": "docFilePath", "route": "download-eng",
        "keep": lambda r: r.get("notificationCategory") in DUTY_CATEGORIES,
    },
    "circular": {
        "endpoint": "cbic-circular-msts",
        "number": "circularNo", "name": "circularName",
        "date": "circularDt", "category": "circularCategory",
        "file": "docFilePath", "route": "download-eng",
    },
    "instruction": {
        "endpoint": "cbic-instruction-msts",
        "number": "instructionNo", "name": "instructionName",
        "date": "instructionDt", "category": "instructionCategory",
        "file": "docFilePath", "route": "download-eng",
    },
    "order": {
        "endpoint": "cbic-order-msts",
        "number": "orderNo", "name": "orderName",
        "date": "orderDt", "category": "orderCategory",
        "file": "docFilePath", "route": "download-eng",
    },
    "regulation": {
        "endpoint": "cbic-regulation-msts",
        "number": "regulationNo", "name": "regulationName",
        "date": "issueDt", "category": None,
        "file": "contentFilePath", "route": "content",
    },
    # The regulation *documents* ("Export Manifest (Aircraft) Regulations, 1976")
    # that the section records point at. Metadata only: it names the sections,
    # and the consolidated PDF would duplicate their text.
    "regulation-doc": {
        "endpoint": "cbic-regulation-doc-msts",
        "number": "regulationDocNo", "name": "regulationDocName",
        "date": "issueDt", "category": "regulationCategory",
        "file": None, "route": None,
    },
    "rule": {
        "endpoint": "cbic-rule-msts",
        "number": "ruleDocNo", "name": "ruleDocName",
        "date": "issueDt", "category": "ruleCategory",
        "file": "contentFilePath", "route": "download",
    },
    # Blank forms: the metadata is useful ("which form is an appeal to the
    # Commissioner"), the PDFs are empty boxes.
    "form": {
        "endpoint": "cbic-form-msts",
        "number": "formNo", "name": "formName",
        "date": "issueDt", "category": "formCategory",
        "file": None, "route": None,
    },
}

# The scan walks ids in blocks and stops after this many consecutive blocks
# with no record past the highest id already known. Rule ids are sparse (gaps
# of dozens), so two blocks of 100 is the smallest safe stopping distance.
SCAN_BLOCK = 100
SCAN_EMPTY_BLOCKS = 2
ID_START = 1000001

UPDATE_TYPES = {  # fetchUpdatesByTaxId's updateType -> our type
    "Notification": "notification", "Circular": "circular",
    "Instruction": "instruction", "Order": "order",
}


def tax_of(record: dict) -> int | None:
    return (record.get("tax") or record.get("cbicTaxMst") or {}).get("id")


def index_path(kind: str) -> Path:
    return CORPUS / "index" / f"cbic-{kind}s.json"


def files_dir(kind: str) -> Path:
    return CORPUS / f"{kind}s"


def load_index(kind: str) -> dict[int, dict]:
    path = index_path(kind)
    if not path.exists():
        return {}
    return {r["id"]: r for r in json.loads(path.read_text())}


def save_index(kind: str, known: dict[int, dict]) -> None:
    path = index_path(kind)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([known[i] for i in sorted(known)]))


def fetch_record(kind: str, i: int):
    """(record | None, error | None). A 404 or empty body is absence, not error."""
    url = f"{TAXINFO}/api/{DOC_TYPES[kind]['endpoint']}/{i}"
    try:
        record = get_json(url, timeout=30)
        return (record if record and record.get("id") else None), None
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 404):
            return None, None
        return None, f"HTTP {exc.code}"
    except Exception as exc:  # timeouts, resets
        return None, repr(exc)


def scan_ids(kind: str, known: dict[int, dict], ids, workers: int = 4) -> list[int]:
    """Fetch the given ids into `known`; returns the ids that errored."""
    failed: list[int] = []
    with cf.ThreadPoolExecutor(workers) as pool:
        for i, (record, err) in zip(ids, pool.map(lambda i: fetch_record(kind, i), ids)):
            if record:
                known[record["id"]] = record
            elif err:
                failed.append(i)
    return failed


def index_type(kind: str, from_id: int | None = None) -> dict[int, dict]:
    """Sequential, resumable scan. Known ids are skipped; blocks run until
    SCAN_EMPTY_BLOCKS consecutive blocks past the highest known id are empty."""
    known = load_index(kind)
    top = max(known, default=ID_START - 1)
    # Gaps below the highest known id are either absent ids or earlier
    # transient failures. Re-probing them costs a request each (1,300 for
    # notifications), so it happens on a first run or with --rescan only.
    if from_id is None:
        from_id = ID_START if (not known or "--rescan" in sys.argv) else top + 1
    start = from_id
    print(f"  {kind}: {len(known)} already indexed, max id {top}; scanning from {start}")
    failed: list[int] = []
    empty_blocks = 0
    lo = start
    while True:
        ids = [i for i in range(lo, lo + SCAN_BLOCK) if i not in known]
        before = len(known)
        block_failed = scan_ids(kind, known, ids)
        failed += block_failed
        found = len(known) - before
        if len(ids) >= 20 and len(block_failed) == len(ids):
            # Every id errored: the host is refusing us, not running out of
            # records. Stop rather than mistake it for the end of the table.
            if known:
                save_index(kind, known)
            sys.exit(f"  {kind}: every request in ids {lo}..{lo + SCAN_BLOCK - 1} failed -- "
                     "the host is refusing connections; wait and re-run (the scan resumes)")
        if lo + SCAN_BLOCK > top:
            empty_blocks = 0 if found else empty_blocks + 1
            top = max(known, default=top)
            if empty_blocks >= SCAN_EMPTY_BLOCKS:
                break
        lo += SCAN_BLOCK
        save_index(kind, known)
        if found:
            print(f"    ..{lo - 1}: +{found}, {len(known)} indexed")
    if failed:
        # One retry, slower, then report whatever is still failing.
        failed = scan_ids(kind, known, failed, workers=4)
    save_index(kind, known)
    taxes = {}
    for r in known.values():
        taxes[tax_of(r)] = taxes.get(tax_of(r), 0) + 1
    print(f"  {kind}: {len(known)} indexed, max id {max(known, default=0)}, by tax {taxes}")
    if failed:
        print(f"  {kind}: {len(failed)} ids failed to fetch: {failed[:20]}", file=sys.stderr)
    return known


def wanted(kind: str, record: dict) -> bool:
    spec = DOC_TYPES[kind]
    if not spec["route"] or not record.get(spec["file"]):
        return False
    keep = spec.get("keep")
    return keep(record) if keep else tax_of(record) == CUSTOMS_TAX_ID


def dest_for(kind: str, record: dict) -> Path:
    spec = DOC_TYPES[kind]
    ext = ".html" if str(record.get(spec["file"])).lower().endswith((".html", ".htm")) else ".pdf"
    if kind == "notification":  # the historical name, so the 8,951 on disk still match
        return files_dir(kind) / (
            f"{safe(record['notificationCategory'])}__"
            f"{safe(record.get('notificationNo'))}__{record['id']}.pdf"
        )
    label = record.get(spec["number"]) or record.get(spec["name"]) or kind
    return files_dir(kind) / f"{safe(label)[:80]}__{record['id']}{ext}"


# Consecutive download failures across workers. Past REFUSED_AFTER the host is
# refusing this address (it does so after a few hundred PDFs, for ~20-60 min),
# so the rest of the run fails fast instead of timing out file by file.
REFUSED_AFTER = 15
_consecutive_failures = [0]


def download_file(kind: str, record: dict, force: bool = False) -> int:
    """1 downloaded, 0 already present, -1 failed."""
    spec = DOC_TYPES[kind]
    dest = dest_for(kind, record)
    if not force and dest.exists() and dest.stat().st_size > 100:
        return 0
    if _consecutive_failures[0] >= REFUSED_AFTER:
        return -1
    result = _download_file(kind, spec, record, dest)
    _consecutive_failures[0] = 0 if result == 1 else _consecutive_failures[0] + 1
    return result


def _download_file(kind: str, spec: dict, record: dict, dest: Path) -> int:
    path = str(record[spec["file"]]).replace("\\", "/")
    quoted = urllib.parse.quote(path)
    try:
        if dest.suffix == ".html":
            throttle(TAXINFO, DOWNLOADS_PER_SECOND)
            req = urllib.request.Request(f"{TAXINFO}/content/html/{quoted}", headers={"User-Agent": UA})
            body = urllib.request.urlopen(req, timeout=60).read()
            if not body.strip() or b"Request Rejected" in body[:300] or b"<!DOCTYPE html>" in body[:40]:
                return -1
            dest.write_bytes(body)
            return 1
        routes = []
        if spec["route"] == "download-eng":
            routes.append(f"{TAXINFO}/api/{spec['endpoint']}/download/{record['id']}/ENG")
        elif spec["route"] == "download":
            routes.append(f"{TAXINFO}/api/{spec['endpoint']}/download/{record['id']}")
        routes.append(f"{TAXINFO}/content/pdf/{quoted}")
        for url in routes:
            try:
                payload = get_json(url, timeout=120)
            except Exception:
                continue
            if payload and payload.get("data"):
                data = base64.b64decode(payload["data"])
                if data[:4] == b"%PDF":
                    dest.write_bytes(data)
                    return 1
        return -1
    except Exception:
        return -1


def download_type(kind: str, known: dict[int, dict], force_ids: set[int] = frozenset()) -> None:
    if not DOC_TYPES[kind]["route"]:
        print(f"  {kind}: metadata only, no files")
        return
    files_dir(kind).mkdir(parents=True, exist_ok=True)
    todo = [r for r in known.values() if wanted(kind, r)]
    print(f"  {kind}: {len(todo)} files wanted")
    # Three workers under the shared throttle. At eight unthrottled the host
    # started refusing downloads in runs of hundreds (2026-09-13: 1,566 of 1,790
    # circulars failed), so failures also get one slow second pass.
    results = list(cf.ThreadPoolExecutor(3).map(
        lambda r: download_file(kind, r, force=r["id"] in force_ids), todo))
    retry = [r for r, v in zip(todo, results) if v == -1]
    if len(retry) > 20 and len(retry) > len(todo) / 2:
        print(f"  {kind}: {len(retry)} of {len(todo)} failed -- the host is likely refusing "
              "connections; not retrying now, re-run later", file=sys.stderr)
        retry = []
    if retry:
        print(f"  {kind}: {len(retry)} failed; retrying one at a time")
        time.sleep(30)
        again = {r["id"]: download_file(kind, r, force=r["id"] in force_ids) for r in retry}
        results = [again.get(r["id"], v) if v == -1 else v for r, v in zip(todo, results)]
    report(kind, results)
    failed = [r["id"] for r, v in zip(todo, results) if v == -1]
    if failed:
        print(f"  {kind}: failed ids {failed[:30]}", file=sys.stderr)
    if _consecutive_failures[0] >= REFUSED_AFTER:
        sys.exit(f"  {kind}: the host is refusing connections; wait and re-run (downloads resume)")


def fetch_type(kind: str) -> None:
    download_type(kind, index_type(kind))


def fetch_updates() -> None:
    """Pick up what is new since the last run: scan every type forward from its
    highest known id, then re-fetch (and re-download) whatever the live update
    feed lists, since an amended document keeps its id."""
    feed = get_json(f"{TAXINFO}/api/cbic-notification-msts/fetchUpdatesByTaxId/{CUSTOMS_TAX_ID}") or []
    by_type: dict[str, set[int]] = {}
    for item in feed:
        kind = UPDATE_TYPES.get(item.get("updateType"))
        if kind:
            by_type.setdefault(kind, set()).add(item["id"])
        else:
            print(f"  feed: unknown updateType {item.get('updateType')!r} ({item.get('id')})", file=sys.stderr)
    print(f"  feed: {len(feed)} updates {({k: sorted(v) for k, v in by_type.items()})}")
    for kind in DOC_TYPES:
        known = load_index(kind)
        top = max(known, default=ID_START - 1)
        before = set(known)
        known = index_type(kind, from_id=max(ID_START, top + 1))
        refresh = by_type.get(kind, set())
        if refresh:
            scan_ids(kind, known, sorted(refresh), workers=4)
            save_index(kind, known)
        new = set(known) - before
        print(f"  {kind}: {len(new)} new ids, {len(refresh)} from the feed")
        if DOC_TYPES[kind]["route"]:
            files_dir(kind).mkdir(parents=True, exist_ok=True)
            touched = [known[i] for i in sorted(new | refresh) if i in known and wanted(kind, known[i])]
            report(kind, [download_file(kind, r, force=r["id"] in refresh) for r in touched])


def fetch_notifications() -> None:
    fetch_type("notification")


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
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    what = positional[0] if positional else "all"
    types = {f"{k}s": (lambda k=k: fetch_type(k)) for k in DOC_TYPES}
    steps = {"tariff": fetch_tariff, **types, "masters": fetch_masters}
    groups = {"cbic": list(types), "all": list(steps), "update": ["update"]}
    if what not in steps and what not in groups:
        sys.exit(f"usage: {sys.argv[0]} [{'|'.join([*steps, *groups])}]")
    for name in groups.get(what, [what]):
        print(f"== {name}")
        (fetch_updates if name == "update" else steps[name])()


if __name__ == "__main__":
    main()
