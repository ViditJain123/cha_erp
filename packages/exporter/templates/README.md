# Logi-Sys import template

`ImportXLSXTemplate.xlsx` is the **unmodified vendor file** from Softlink
Logi-Sys (`kuberr.liveimpex.pro`), used by the *Import/Export Data → XLSX*
upload on the Import Document screen.

| | |
|---|---|
| Received | 2026-08-05, via the Kuberr operations team |
| Size | 31,673 bytes |
| SHA-256 | `12ecee89db39ec23078f7ca01d898ec1ce3d1d74908558705c65b8382060a024` |
| Authored by | `Raja` (2018-11-27), last saved by `Chetan Parulekar` (2026-01-08) |
| WPS/Excel fingerprint | `docProps/custom.xml` ICV `A5F964A10388460599C7C0ABF42BED48` |

The SHA-256 is pinned in `test/structure.test.ts`. **Replacing this file is a
deliberate act**: the test fails until the new hash is recorded, which forces a
review of what moved before any generated workbook ships against it.

## Why we never re-save it

`src/sheet-writer.ts` treats this file as an opaque zip and rewrites only two
things per sheet — the spliced-in `<row r="2">…` elements and the `<dimension>`
attribute. Every other part is copied through byte-identical.

That is not fussiness. Loading and re-saving it with exceljs was tested and
produces a **structurally dangling workbook**: exceljs drops
`xl/externalLinks/externalLink{1,2}.xml` and their rels, but keeps all five
`definedNames`, which still reference `'[1]Sheet2'!$C$1:$C$21` and
`'[2]Sheet2'!$Z$77:$Z$172`. With no `<externalReferences>` left in the package,
those names point at nothing, which is what triggers Excel's "We found a problem
with some content" repair prompt.

## Things that surprised us, recorded so they are not re-litigated

- **No sheet contains a `<dataValidation>` element.** The `Currency`,
  `CUSTOM_HOUSE` and `SUP_DOC_TYPE_CODE` defined names are inert leftovers from
  the vendor's own authoring workbook — the dropdowns they once fed do not exist
  in this distributed copy. The two external links resolve to dead absolute
  paths on the vendor's machines (`/Sales/Competitors/Royal New
  Template/JOB_IMPORT.xlsx`, `/Users/vishal.k/Downloads/Royal/JOB_IMPORT.xlsx`)
  and cache no values.

  **Consequence:** the template cannot tell us its own allowed code values. Every
  code domain (`TOI`, `TransportModeCode`, `BETypeCode`, `AdvancePriorNormal`,
  `FCL_LCL`, `ContainerTypeCode`, `PkgUnitCode`) is inferred from the Logi-Sys
  UI dropdowns in `../../../../logi-sys-screenshots/` and must be confirmed
  against a real upload.

- **`xl/styles.xml` declares no number formats** — `<numFmts>` is empty and every
  `cellXf` is `numFmtId="0"` (General). There is no vendor hint that date columns
  want Excel serials, which is why `src/format.ts` writes every date as text.

## Sheets

19, in this order. Row 1 of each is the header row; data starts at row 2.

`GENERAL`, `INBOND_EXBOND`, `SHIPMENT`, `CONTAINERS`, `INVOICES`, `ITEMS`,
`STATEMENT`, `SEC65_EXBOND_INFO`, `RE-IMPORT`, `LICENSE`, `SW_ADDL_INFO`,
`SW_CONSTITUENT`, `SW_PRODUCTION`, `SW_CONTROL`, `SEZ_INFO`, `HSS`,
`BONDS_CERTIFICATES`, `SUPPORTING_DOCS`, `EXCHANGE_RATE`
