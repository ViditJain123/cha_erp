# The customs corpus

The primary-source documents behind the tariff, duty and code masters: the CBIC
Customs Tariff, the CBIC notification archive, and the ICEGATE specifications.

Downloaded with `python3 packages/core/scripts/fetch-corpus.py`, which documents
the retrieval routes and why they are what they are. Parsed into masters by
`packages/core/scripts/build-masters.py`.

```
tariff/          370 PDFs, 114 MB   gitignored
notifications/  8951 PDFs, 1.1 GB   gitignored
icegate-specs/    68 docs,  97 MB   gitignored
index/             8 files, 26 MB   COMMITTED
```

Only `index/` is versioned. The PDFs are large, reproducible in one command,
and never edited by hand — but the parsed output has to be in the repo so a
fresh clone can build without a 1.3 GB download first.

## tariff/

The Customs Tariff, in three volumes, as CBIC publishes it. Filenames keep the
publisher's own path, so `Tariff(ason30.06.2024)__CUSTOMS_TARIFF_VOL-I__chap-39.pdf`
says which edition a chapter came from — and chapters *do* differ, because CBIC
republishes one only when it changes. The edition on the folder is not the
edition of every chapter inside it.

| Volume | What it is | Files |
|---|---|---|
| VOL-I | The First Schedule — 98 chapters of CTH, description, standard UQC, standard and preferential BCD | 101 |
| VOL-II | 233 General Exemptions — the effective rates, by scheme and subject | 233 |
| VOL-III | Anti-dumping duty notifications, organised by chapter, plus the master list | 36 |

VOL-I is where `index/tariff-first-schedule.json` comes from. VOL-II and VOL-III
are not parsed yet; they are the sources for the exemption and anti-dumping
masters.

## notifications/

Every CBIC notification in a category that bears on a Bill of Entry, named
`<category>__<number>__<id>.pdf`. GST-only categories (Central Tax, UT Tax and
their rate notifications) are indexed but not downloaded — a different levy.

`index/cbic-notifications.json` is the full index, **all 10,706 records**
including the GST ones, with `notificationNo`, `notificationCategory`,
`notificationDt` and `docFilePath` already structured. Filter it before opening
a single PDF.

```
Non Tariff              4,089    (362 of them are the fortnightly exchange rates)
Tariff                  3,924
Anti Dumping Duty         715
Central Tax               521    indexed, not downloaded
Integrated Tax (Rate)     227
CVD                        38
Compensation Cess (Rate)   23
Safeguards                 22
```

## icegate-specs/

The filing specifications. The ones that matter:

- `BE_CACHI01_Inbound_JSON_Schema_v1.2.pdf` — the Bill of Entry declaration, 23
  models. They are the 19 Logi-Sys sheets under different names.
- `API_Contract_Document_Open_API_v1.4 - Advisory.pdf` — authenticate → fileSubmit
  → getAck, the direct-filing path.
- `BE Message format 2.25 (16Feb2026).pdf` — the ICES 1.5 BE message, 24 parts.
- `BE_fresh_filing_error_codes_24032026.pdf` — 668 rows of
  `MESG_ID | ERR_CD | ERR_DESC | MODULE_ID | MESG_TYP`. Worth ingesting whole:
  it turns an ICEGATE rejection into a sentence that names a field.
- SWIFT/PGA advisories per agency (APEDA, AQCS, ARAI, CBN, CDSCO, DGCA, Coffee
  Board…), which is where a national CCR master would come from.

## index/

| File | Rows | Notes |
|---|---|---|
| `tariff-first-schedule.json` | 11,864 CTH | 11,542 with a BCD rate, 11,382 with a UQC |
| `cbic-notifications.json` | 10,706 | the full notification index |
| `dgft-itchs.json` | 16,024 | 12,571 at 8 digits; policy and UoM come back null from DGFT |
| `ices-locations.json` | 586 | the codes ICES accepts — authoritative over any PDF list |
| `ices-sez-ports.json` | 745 | as `"NAME(INXXX6)"` strings; needs a regex |
| `einvoice-mastercodes.html` | — | 250 countries, 180 currencies, 40 states, 1,061 ports, 45 GST UQCs |
| `unlocode.csv` | 116,213 | 1,336 Indian. ODC-PDDL-1.0 (the mirror's declaration; UNECE's own terms permit free use with attribution) |
| `tariff-documents-raw.json` | 370 | title → publisher path, from the content-tree walk |

Two traps worth stating once:

- **The GST UQC set (45 codes) is not the ICES UQC set (67).** A Bill of Entry
  takes the ICES one. `einvoice-mastercodes.html` carries the GST set.
- **`ices-locations.json` is the list to validate against**, not the 1,061 ports
  in the e-invoice master, which is broader and includes codes ICES will reject.
  Use the e-invoice list for name enrichment only.
