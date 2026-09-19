# Phase 6 — The filing channel

This is the phase that actually removes Logi-Sys from the loop. Everything
before it makes the data right; this sends it.

**Do not start here.** Filing a wrong Bill of Entry directly is worse than
filing it through an intermediary that catches mistakes.

---

## The headline: we are not building a new Bill of Entry

The direct-filing declaration is **CACHI01**, and its JSON schema is already on
disk at
`data/customs-corpus/icegate-specs/BE_CACHI01_Inbound_JSON_Schema_v1.2.pdf` —
57 pages of literal, parseable JSON Schema. 23 models:

```
beModel exchangeModel permissionModel invoiceModel misc_chModel itemsModel
licenseModel rspModel depbModel bondModel certModel hssModel reimportModel
sbedutyModel igmsModel containerModel ctxModel infoTypeModel sw_ConstModel
sw_ProdModel ctrlModel statementModel supportingDocsModel
```

plus `headerField`, `master` and `digSign`.

**Those are Logi-Sys' 19 sheets under different names.** `bondModel` +
`certModel` is our BONDS_CERTIFICATES. `ctrlModel` is the single ICES segment
that our SEC65_EXBOND_INFO, SW_CONTROL and SEZ_INFO sheets each render a slice
of. The whole `docs/boe-mapping/` field contract transfers with the names
changed.

A few models have no sheet and so no mapper yet: `permissionModel`, `rspModel`
(retail sale price, for MRP-based valuation), `depbModel`, `sbedutyModel`,
`ctxModel`. Check each against our actual trade before building it.

---

## 6.1 Settle DSC — the long pole, and a design decision

`digSign` is a **required** property, and API response code 12 is "Digital
Signature (DSC) validation failed". The submitted file is literally named
`BE_SB_Json_Signed.json` in the vendor's own curl example.

**Signing is browser/USB-token bound, so a cloud ERP cannot sign server-side.**
This is the one genuine architectural blocker on the entire roadmap. There are
zero hits for DSC or digital signature anywhere in the repo.

Options, in rough order of preference:

1. A **local signing agent** on the CHA's machine — our server prepares the
   payload, a small local service signs it with the token and submits.
2. An **HSM or e-Sign arrangement**, if the CHA's licence permits it.
3. Keep a human in the loop for the signature only.

**Spike this before committing to any date for this phase.** Everything else
here is ordinary engineering; this one may change the architecture.

## 6.2 Registration and credentials

Better news than expected: filing is **open and self-service — no RES-vendor
approval and no fee**. The API key is generated from the CHA's own ICEGATE
login: My Profile → Personal Details → Generate API Key. Kuberr already holds
ICEGATE ID `KUBERR007`.

`CHA_PROFILE` in `packages/core/src/masters/data.ts` is a **hardcoded
single-tenant constant** (`kuberr`, `KUBERR007`, the licence number and
address). Direct filing keys off the filer's ICEGATE identity, so this must
become per-company before a second tenant can file. Credentials are per-company
secrets — treat them like the OAuth tokens in `mail_connections`, not like
masters.

## 6.3 The round trip

```
POST  /authentication/v1.0/api/authenticate   -> accessToken (15 min)
POST  /jsonfiling/v1.0/api/fileSubmit         -> uniqueId     (multipart, <=10 MB)
POST  /jsonfiling/v1.0/api/outbound/getAck    -> CHCAI02_ACK_*.json
```

UAT hosts exist under `apiwso2uat.icegate.gov.in` — **prove the whole loop there
before any production filing.** The contract itself warns that URLs should be
re-checked before go-live, so verify rather than trust the PDF.

Token is reusable until it expires; do not regenerate per request.

## 6.4 The work

1. **Parse the JSON Schema** out of the PDF into a real schema we validate
   against. This is the same trick as the error-code table in Phase 0, and it
   means a malformed payload fails on our side, not theirs.
2. **Write the CACHI01 serialiser** as a second output over the same
   `ChecklistDraft` — not a rewrite of the mappers. The values are already
   computed; this is a different shape for the same answers.
3. **Submit and poll.** `getAck` is a poll, and the contract has explicit
   "validation in progress, retry later" responses. Treat a pending ACK as
   normal, not as failure.
4. **Ingest the response.** `job_clearance` already models BE number, date, RMS
   route, assessed duty, challan and out-of-charge. Today a person types them
   in. Feed them from the ACK instead — the tables need no change, only a
   source.
5. **Our own checklist PDF.** Today scrutiny depends on the checklist Logi-Sys
   prints, uploaded by hand, with its duty figure keyed in as
   `jobs.checklist_duty` — which is also what the whole duty-variance control
   compares against. `apps/web/lib/checklist-html.ts` already renders a
   Logi-Sys-shaped checklist in the legacy path. Revive it for the ERP, or the
   scrutiny loop keeps a Logi-Sys dependency after filing has left.

## Watch for

**The duty engine has never been tested against ICES.** It computes the full
cascade at 40-digit precision and is pinned against vendor exports, but today it
feeds the checklist and the licence debit — the filing itself carries
notification *claims*, and ICES does the arithmetic. Direct filing does not
change that, but it does remove the vendor's sanity check. Phase 7 is where that
gets proven.

## Done when

- DSC signing works, by whatever route was chosen.
- A corpus job round-trips in UAT: submitted, acknowledged, parsed.
- BE number and assessed duty land on `job_clearance` without anyone typing.
- We print our own checklist.
- `CHA_PROFILE` is per-company.
