# Phase 1 — ICES encoding conventions

**The cheapest phase on the list.** Duty and notification columns account for
**175 of 1,429** column misses. Almost none of them are wrong *answers* — the
tariff code itself misses 3 times across the whole corpus, and the basic
exemption notification 4 times. What is wrong is how the claim is **spelled**.

We pick the right notification and then fail to say how we are claiming it.

---

## What is actually missing

Logi-Sys fills these from screen defaults on every filing. We write them only
when something upstream happened to set them, so they come out blank.

| Column | Misses | What it should be |
|---|---|---|
| `IGST_LevyNotnFlag` | 10 | `+` |
| `IGST_ExemptionNotnType` | 10 | `C` |
| `IGST_ExemptionNotnFlag` | 10 | `+` |
| `IGST_CompCessNotnFlag` | 10 | `+` |
| `IGST_CompCessExemptionNotnType` | 10 | `G` |
| `IGST_CompCessExemptionNotnFlag` | 10 | `+` |
| `CVD_CalculatedOn` | 10 | `1` |
| `AIDC_ExemptionNotn` / `SrNo` | 10 each | 011/2021 + serial |
| `ADD_Basis` | 9 | `AV` |
| `Exim_Notn` / `SrNo` / `Code` | 7 each | scheme slot |

## The grammar, already settled

Read off the Logi-Sys product screens in `logi-sys-screenshots/`
(`15.04.07`–`15.07.00`), not guessed:

- **`*_NotnFlag` is `+ - H L`** — the Plus/Minus/Higher/Lower dropdown beside
  every duty line. It says how a notification's **% rate** combines with its
  **per-unit amount**. Screen default is Plus → `+`; Other Duties defaults to
  Higher.
- **`*_ExemptionNotnType` is `C` or `G`** — "Customs Notn." vs "GST Notn.",
  the ICES SBEDUTY "Customs Notn exempting IGST flag". Defaults `C` for IGST,
  `G` for compensation cess. `liv_job1` exports exactly that **even with no
  exemption notification present**, which is the tell: these are UI defaults,
  not decisions.
- **`ADD_Basis` = `AV`** ("%age of Assessable Value"),
  **`CVD_CalculatedOn` = `1`** ("%age of Landed Value"). Also defaults.
- **AIDC serial follows the BCD claim, not the CTH.** 11/2021 S.No. 19 when the
  BCD exemption is claimed under an ANNEXURE notification, else S.No. 17
  (residual). This rule is already implemented and reproduced via
  `AIDC_ANNEXURE_AS_AT` — the gap is that the *exemption* columns are not
  written at all.

## The work

1. **Write the defaults unconditionally.** In
   `packages/exporter/src/map/items.ts`, `ADD_Basis` and `CVD_CalculatedOn` are
   currently written only inside the trade-remedy row builders, so a line with
   no ADD/CVD gets nothing. Logi-Sys writes them on every line. Same for the six
   IGST/cess flag and type columns: give them their defaults, and let an
   upstream value override.
2. **Fill the AIDC exemption pair.** `AIDC_LevyNotn`/`SrNo` are written;
   `AIDC_ExemptionNotn`/`SrNo` are only written when `item.aidcExemption` is
   set. The levies master already knows the answer.
3. **Record each default as a `constant` source with its evidence.** The field
   contract in `docs/boe-mapping/` forbids a bare constant in code: every one of
   these needs a comment naming the screenshot or the vendor export that proves
   it. `docs/boe-mapping/06-items.md` is the file to update.
4. **Pin them.** `packages/exporter/test/items.test.ts` should fail if a default
   changes silently.

## Deliberately not in this phase

**`Exim_Code`** — the full ICES scheme-code list is not settled. We know the
shape (01 Advance Licence actual user, 11/12 EPCG, 20 Jobbing) and that it is
blank on every golden we hold, but the complete list is an open question with
Sandesh. Fill what is proven; leave the rest raising a warning. Do not guess a
scheme code onto a Bill of Entry.

Note also the **SAPTA slot oddity**: Logi-Sys' SAPTA Notn. field takes DFTP too
(`ex_job2` files `096/2008 (i)` there), while Japan CEPA goes in `Basic_Notn`
with flag `P`. Handle the slot, do not rename it.

## Watch for

These are conventions, not truths. If a default ever contradicts what a
document says, the document wins — the precedence in
`docs/boe-mapping/README.md` is `document < master < mail < operator`, and a
constant sits below all of them.

## Done when

- The nine default-valued columns above are written on every item line.
- `corpus-compare.py` shows duty/notification misses well below 175.
- `docs/boe-mapping/06-items.md` names the evidence for every new constant.
- No new blockers; no job that exported before stops exporting.
