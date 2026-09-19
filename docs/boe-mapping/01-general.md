# GENERAL

One row. The header of the Bill of Entry — who is importing, at which custom
house, under which section, and in what filing posture.

Implemented by `packages/exporter/src/map/general.ts`, fed by
`apps/web/lib/general.ts` (`applyGeneralResolution`), which runs after
`applyPartyResolution` in `apps/web/lib/draft-pipeline.ts`.

Vendor evidence for the column list and blank-vs-`N` question:
`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx` — a workbook Logi-Sys
exported itself.

## Boolean columns

Nine of the 23 columns are yes/no. On this sheet they are written **`Y` when
true and blank when false** — never `N`. The vendor's own export leaves them
empty, and "no" and "not known" are the same cell to Logi-Sys. Use
`ynBlank()` in `packages/exporter/src/cell.ts`, not `yn()`.

---

## 1. `TransportModeCode` — `S` / `A` / `L`

**Source:** document + master, operator override.

```
air waybill present                                    -> A
bill of lading, place of final delivery is an ICD      -> L
bill of lading, place of final delivery is a sea port  -> S
```

The ICD test resolves the BL's **place of final delivery** (`placeOfDelivery`
on `BlExtractSchema`, falling back to `portOfDischarge`) against the custom
house master, and reads the station's kind.

**The station's kind comes from the sixth character of its ICES site code, not
from its name.** The generated master's `mode` field is derived from a name
pattern, and the name lies: `INGGV1` "Gangavaram ICD" is a sea station,
`INPAV6` "Pipavav (Victor) Port" is the inland one, and 65 of the 296 stations
have names the pattern cannot classify at all ("Pithampur", "Jalandhar", "GIFT
CITY") — every one of which is somewhere a bill of lading can deliver to.

| Suffix | Station | Code |
|---|---|---|
| `1` | sea port | `S` |
| `4` | air cargo complex | `A` |
| `6` | ICD / CFS / SEZ | `L` |
| `2` | rail cargo | `L` |
| `B` | land customs station | `L` |

`resolveIndianStation()` in `packages/core/src/masters/stations.ts` does the
name→station match: ICES/EDI code → alias (`JNPT`, `Nhava Sheva`) → whole
normalised name → identifying letters with ICD/CFS/PORT noise and vowels
stripped → unique containment.

**Failure mode 1 — no match.** A place of delivery that resolves to no station
is a `warn`, and the mode falls back to `S` for a BL / `A` for an AWB, with the
unresolved place named so the operator sees exactly what was not recognised.

**Failure mode 2 — an ambiguous place, which is the dangerous one.**
Seventeen places name *both* a sea station and an inland one: Mundra, Cochin,
Tuticorin, Chennai, Hyderabad, Kolkata, Mangalore, Jaipur, Nagpur, Dahej,
Dighi, Bengaluru, Amritsar and more. `MUNDRA` alone cannot say `S` or `L`. The
resolver returns nothing and the operator is asked; a qualifier in the
document ("Cochin ICD", "Mundra Sea") resolves it.

> A sea BL routed to an ICD is `L` because the *carriage into the customs
> station* is inland, even though the ocean leg was sea. This is the case that
> was previously impossible to express: `TRANSPORT_MODE_CODE` had only two keys.

---

## 2. `CustomsHouseCode`

**Source:** mail, then master, then operator. Never a code constant.

```
1. operator's choice on the job                        (wins outright)
2. custom house named in the customer's instruction mail
3. the importer's default_custom_house on the org master
4. nothing -> blocker
```

The mail value arrives as a station **name or code** and is resolved through
`lookupCustomHouse` / `resolveIndianStation`, so "file at Nhava Sheva" becomes
`INNSA1` and never a typed pair.

**Cross-check against `TransportModeCode`:** the chosen station decides the
transport mode, so the two cannot disagree. What can disagree is the station and
the transport *document* — an air waybill on a job filed at a sea station — and
that is a `warn` naming both, because one of the two is wrong.

> Removed in this change: the hardcoded `awb ? 'INBOM4' : 'INNSA1'` in
> `merge.ts`. Which custom house a consignment is filed at is the customer's
> instruction, not a property of the transport mode.

---

## 3. `BETypeCode` — `H` / `W` / `EX`

**Source:** mail keywords, operator override. Default `H`.

| Trigger in the instruction thread | Code | Meaning |
|---|---|---|
| `in bond`, `inbond`, `bond`, `bonding`, `warehouse`, `warehousing` | `W` | Into-bond BE (Section 46 + 59) |
| `ex bond`, `exbond`, `ex-bond`, `clearance from warehouse` | `EX` | Ex-bond BE (Section 68) |
| anything else | `H` | Home consumption — the default |

`EX` and `W` both make the **INBOND_EXBOND** sheet mandatory, and an ex-bond BE
must also say how much of the warehoused consignment it releases — see
[02-inbond-exbond.md](02-inbond-exbond.md). An `EX` job out of a Section 65
warehouse reaches one sheet further still: what it clears decides whether
[SEC65_EXBOND_INFO](08-sec65-exbond-info.md) carries the finished product it was
manufactured into.

---

## 4. `Importer`

**Source:** master (`organizations`), bound by `applyPartyResolution`.

`draft.importer.logisysPartyCode ?? draft.importer.name`. Logi-Sys resolves the
party from its own repository on this string, so an unbound importer — a name
read off a bill of lading — is a `warn`. Unchanged by this work.

## 5. `Branch Name`

**Source:** master. The bound `organizations` row's `branch_name`, through
`branchNameForExport()`, which blanks the repository's three spellings of "no
branch" (`0`, `.`, `NA`). A branch named in the instruction mail overrides it
and re-binds the party to that branch's row.

## 6. `AD_Code`

**Source:** master, operator when ambiguous.

The bound organization's `ad_code`. An importer may bank through more than one
AD code; the extras live in `organization_ad_codes`. When the importer has more
than one and the operator has not chosen, that is a **blocker** — an AD code is
how the bank realises the remittance, and picking one by coin toss is worse
than not exporting.

Also surfaced on the checklist verification mail to the customer: *"AD code
0510226 — confirm."*

## 7. `Importer_RefNo`

**Source:** master flag, then mail.

`organizations.importer_ref_required` says whether this importer wants its own
reference on the BE at all. When it does, the reference is taken from the
instruction thread (a PO number, an indent number). When it does not, the column
is blank.

> Was `job.reference` — our internal job number, which is not the importer's
> reference and had no business on a customs document.

## 8. `CountryOfOriginCode`

**Source:** document. `iso2()` of the invoice's / COO's country of origin.
Unresolvable is a **blocker**: origin drives the duty rate and every FTA claim.

## 9. `PortOfShipmentCode`

**Source:** document + master. UN/LOCODE of the BL's port of loading via
`unlocodeOf()`. Unresolvable is a `warn` naming the port to add to the master.

## 10. `CountryOfShipmentCode`

**Source:** document + master. The load port decides — a UN/LOCODE contains its
country (`CNTAO` is `CN`) where the printed name may resolve to nothing. Falls
back to `iso2(consCountry)`.

## 11. `BE-Heading`

**Source:** constant. Always blank.

---

## 12. `DutyPaymentStatus_T_D` — `T` / `D`

**Source:** master (AEO) + mail, operator confirms.

```
mail says deferred  AND  importer AEO tier is T2 or T3   -> D
mail says deferred  AND  importer is not T2/T3           -> T, and warn loudly
AEO is T2/T3, mail silent                                -> T, and tell the operator
otherwise                                                -> T
```

Deferred duty is only available to AEO T2/T3 importers, so the two conditions
are checked together: `aeo_status` on the organization (and `aeo_valid_till`, an
expired certificate does not qualify), and an explicit instruction in the
thread. Silence is not consent — an AEO importer still files `T` unless someone
says otherwise, but the operator is told the option exists.

A customer asking for deferred duty they are not entitled to is a `warn`, not a
blocker, and the BE goes out as `T`: filing transactionally is always valid,
where filing `D` without the AEO standing behind it is not.

---

## 13. `AdvancePriorNormal` — `A` / `P` / `N`

**Source:** operator-keyed IGM / inward dates.

| IGM filed? | Entry inwards granted? | Code | |
|---|---|---|---|
| no | — | `A` | Advance — no IGM against this BL yet |
| yes | no | `P` | Prior |
| yes | yes | `N` | Normal |

Read from `draft.shipment.igmNo` / `inwardDate`. Neither appears on any
document the customer sends, so both are **operator-keyed** on the job screen
(from ICEGATE or the shipping line) and stored in `job_boe_header`.

**Failure mode:** with no IGM number keyed at all, the code cannot tell "no IGM
exists" (→ `A`) from "nobody has looked yet". It raises a `warn` and writes
nothing rather than guessing, and the job screen shows the field as required.

> Was `transportMode === 'Air' ? 'Prior' : 'Normal'` — a guess with no
> relationship to the actual rule.

---

## 14. `IsUnderSec46`

**Source:** derived from the same two dates.

Section 46(3) requires the Bill of Entry to be presented before the end of the
day preceding the day the vessel arrives. A BE presented later attracts late
presentation charges (₹5,000/day for the first three days, ₹10,000/day after),
which the proper officer may waive on cause shown. This flag marks the BE as
one presented late.

```
beFilingDate > inwardDate  ->  Y
otherwise                  ->  blank
```

**Not modelled:** customs holidays. The statute's clock excludes them, ours does
not, so a BE filed one day late over a holiday weekend may be flagged when it
should not be. The operator can clear the flag on the job screen, and doing so
is recorded. See [open-questions.md](open-questions.md#sec-46-holiday-calendar).

## 15. `IsUnderSec48`

**Source:** derived.

```
beFilingDate > inwardDate + 30 days  ->  Y
otherwise                            ->  blank
```

Section 48 — goods not cleared within thirty days of unloading may be sold by
the custodian, so a BE filed past that window is declared as such.

---

## 16–23. The operator flags

`IsFirstCheck`, `IsGreenChannel`, `IsKachchaBE`, `IsHSS`,
`IsBondsCertificates`, `IsTranshipment`, `ITC_Lic_details`,
`IsUnderProvisionalAssessment`.

**Source:** operator checkboxes on the job screen. Unchecked is blank, checked
is `Y`. Two carry a suggestion the operator can accept or reject:

| Column | Suggested when |
|---|---|
| `IsHSS` | the job has a high-seas-sale agreement document, or `draft.hss` is set |
| `IsBondsCertificates` | the BONDS_CERTIFICATES sheet has rows |

A suggestion is never applied on its own — it pre-ticks the box and says why.
