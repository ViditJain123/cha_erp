# Phase 1 — ICES encoding conventions

**Done, 19 September 2026**, on branch `phase-1-ices-conventions`. The plan
this file used to hold was to fill nine blank columns with Logi-Sys' screen
defaults. **It was inverted before any code was written**, and what follows is
what was done instead and why. The headline results:

- **ICES rejections fall from 8 across 2 codes to 2 across 1.** Error 207,
  terms of invoice, is gone from all six jobs that drew it. The Logi-Sys
  workbook is byte-identical where it matters — the upload is untouched.
- **No default is written anywhere.** The nine columns stay blank, and so do
  two more that used to carry one.
- **Removing them uncovered a wrong duty and a missing one**: four
  compensation-cess serials that need `H` and shipped blank, and five jobs
  filing a Calc. Method their notification does not state.
- Same 26 folders export, same 6 block.

---

## Why the plan was inverted

Three things, found while planning:

1. **The spec does not want them.** BE Message format 2.25, Part 4:
   `<TABLE>SBEDUTY` is an **optional** segment of a final BE, and its field 15,
   "Customs Notn exempting IGST flag (G/C)", is **optional** within it. ICES
   asks for none of these columns. Only Logi-Sys' dropdown does.
2. **`06-items.md` already refused them**, deliberately, in §18/§19/§21 —
   *"liv_job1 writes both on a consignment with no duty — the screen defaults
   leaking into the export"* — and three tests pinned that refusal. The plan
   would have reversed four documented decisions to match a vendor artefact.
3. **The default was hiding a wrong duty.** `items-resolve.ts` seeded
   `igstLevyFlag = '+'` and `compCessLevyFlag = '+'` on every line, and the
   mapper then suppressed `+` as noise. So a line that genuinely needs `H`
   could not produce one.

The instruction that settled it: *"remove all the default values, there is
nothing default as such."* So the phase became **derive or write nothing** —
and the two functions to derive with were already in the tree with no callers.

## What was done

### 1. The flags and types are derived, not defaulted

`notnFlagFromRateText()` answers `undefined` for a purely ad valorem rate
instead of the screen's `+`, and `resolveItems` runs it over the schedule entry
it actually chose. 9/2025-IT(R) states every IGST rate as a bare percentage, so
IGST never carries a flag. 1/2017-Compensation Cess states four tobacco serials
— 8, 9 (cigars, cigarillos), 17, 18 — as *"21% or Rs. 4170 per thousand,
whichever is higher"*, which is **`H`**, and those had been shipping blank.

A compound rate the duty engine cannot compute now raises an **error** flag:
`computeDuty` prices compensation cess ad valorem only, so the cess on such a
line has to be worked out by hand. That is the honest state; computing it is a
duty-engine change and is not in this phase.

`exemptionNotnType()` types the `C`/`G` exemption off the notification's own
suffix rather than the operator's keystroke, and **warns** when the two
disagree — a GST notification cannot grant a `C` exemption.

`ADD_Basis` and `CVD_CalculatedOn` follow the basis the remedy line already
carried and both mappers ignored. See §3 below for what that turned up.

### 2. Terms of invoice: ICES' spelling in the draft, Logi-Sys' in the workbook

Handed here by Phase 0. `TOI_CODE` now carries ICES' spelling (`CF`, `CI` —
field 42), `VENDOR_TOI_CODE` spells `C&F`/`C&I` where the workbook cell is
written, and `icesToi()` reads the term back out for the rule. **Error 207 is
gone from ex_job1, 3, 6, 12, 20 and 21 without the rule being loosened**: it
still refuses `CFR`, and the vendor rule still refuses `CF`.

The trap worth recording: `TOI_INCLUDES`, the gate deciding whether freight and
insurance are already in the price, was keyed on the *emitted* string. Renaming
without re-keying it would have fallen through to the `CIF` branch and declared
freight twice.

### 3. What removing the defaults uncovered

Five jobs were writing a Calc. Method their notification does not state:

- **ex_job5**, CVD `002/2026`, thirteen lines: the duty is a percentage of the
  CIF value; `1` means "%age of Landed Value".
- **liv_job1, ex_job8, ex_job9, ex_job15**, ADD `004/2023`: the rows are a
  **reference price** — the duty is the shortfall of the landed value below it,
  which is neither a percentage of the assessable value nor an amount per unit.
  We wrote `AV`.

All six now leave the column blank and warn, naming the basis the notification
does state. The reference-price rows are operator-chosen, and an operator's row
is kept verbatim, so nothing had ever said the duty amount was still missing;
the operator branch now raises the same "work it out and enter it on the item"
the automatic branch always has.

### 4. The AIDC serial, and the scheme it follows

11/2021-Customs chooses the serial by the BCD relief claimed, and two of its
four cases were implemented. **S.No. 18** — *"all goods on which exemption from
basic customs duty is claimed and allowed under the advance authorisation"* —
was unreachable: it names the instrument in words and carries no notification
refs, so nothing could match it.

So `BcdClaim` carries the scheme, and `EXIM_SCHEME_NOTIFICATION` derives the
scheme from the notification that implements it — each Foreign Trade Policy is
a family of Customs notifications, one per scheme, and the CBIC title names the
scheme exactly. `021/2023` → `03`, `026/2023` → `12`, `025/2023` → `26`, which
is what the three Logi-Sys workbooks that fill the column write.

`024/2023` is left out on purpose: the directory has no code for an advance
authorisation for prohibited goods, so a line claiming it warns rather than
borrowing `03`. So does an unrecognised code — an operator's answer is never
replaced by a guess.

§10 is enforced for the first time: the scheme's own notification in
`Basic_Notn` as well as the Exim slot claims the relief twice and is a
**blocker**; a different relief beside it warns and still files.

> **This does not move the corpus yet.** `Exim_Code` is still blank on all four
> licence jobs, and ex_job25 still files AIDC `17` where Logi-Sys files `18`,
> because **nothing tells us a scheme is being claimed**. The scheme lives on
> the licence — `ex_job26/EPCG-831018385.pdf` is sitting in the folder — and
> there is no `licence` document type, so it classifies as `other` and is
> discarded. That is Phase 4. The rule, the master and the wiring are done and
> tested; an operator who keys the scheme on the job gets all of it today.
>
> ex_job26 is the same story from the other end: it files AIDC `20` because we
> put a 45/2025 claim in `Basic_Notn` whose serial S.No. 20 names. The relief is
> really under EPCG, and once the scheme is known §10 moves the claim to the
> Exim slot and the serial falls to the residual `17` Logi-Sys files.

### 5. A NUL byte

`items-resolve.ts` carried a literal `\x00` inside a string. `file` called the
source `data` and **grep silently printed nothing for it**, which had already
made one search conclude that `aidcLevyFor` was dead code.

## How it was measured

The nightly corpus run needs real model calls over a real customer's documents,
so it was not run. Instead each folder's **stored draft** was replayed through
`applyItemResolution` and `buildLogisysWorkbook` — the same entry points the
job screen and the corpus run use — and every cell of the result diffed against
the workbook the last full run left on disk. No model call, so **it cannot
catch an extraction regression**; nothing in this phase is one.

- 26 export, 6 block — `ex_job17, 19, 23, 24, 30, 31`, exactly the baseline.
- ICES: **24 of 26 clean**, 2 rejections, one code — `203` (blank
  `Invoice_Date`, ex_job4 and ex_job10), which is Phase 2's.
- Of the eight jobs with a vendor workbook, **only liv_job1 changes**, by the
  one `ADD_Basis` cell in §3.

## What this does to the scorecard

The nine columns stay blank, so they stay misses. **That was the decision, not
a shortfall** — the phase doc's old target of "misses well below 175" is void.

`corpus-gate.mts` **will fail on the next nightly run**, and should: liv_job1's
agreement goes from 77.1% to about 76.5% (137 of 179 rather than 138), past the
0.1-point tolerance, because it no longer writes `AV` where Logi-Sys does.
Refresh the baseline with `--update` and record the reason — the cell is a
screen default we now refuse. The ICES side only improves, and improvements
never fail the gate.

Worth doing, and not done here: `corpus-compare.py` classifies differences only
by sheet and by kind, so a column we deliberately refuse and a column we simply
missed are indistinguishable in `SCORECARD.md`. Splitting *"we refuse, they
default"* out would stop the scorecard reporting this phase as a regression
every night.

## Still open

- **The licence, and with it `Exim_Code` and the AIDC serial on the four
  licence jobs** — Phase 4.
- **`AIDC_ANNEXURE_AS_AT`** — unchanged, still a question for Sandesh.
- **The specific-part arithmetic.** `combineNotnRate()` has no production
  caller and `duty.ts` prices compensation cess ad valorem only, so a
  "whichever is higher" entry computes as zero. The line now warns; computing
  it is a duty-engine change.
- **`DUTY_ExemptionType`**. Logi-Sys writes `N` on every line of four of its
  exports. Not written here, and `06-items.md` §22 says why: SBEDUTY is
  optional and its entry is "mandatory if 'Other duties' is chosen as 'Y'", so
  a line with no other duty has no row for the field to belong to.
