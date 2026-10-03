# Where the duty numbers come from

A question that spans every phase, worth answering once: **if we send the
declaration, who sends back the percentages?**

Short answer: **nobody does, and nobody ever did.**

---

## There is no "calculate my duty" endpoint

ICEGATE has no pre-filing API that takes a declaration and returns a duty
breakdown. No dry run, no preview, no costing service.

The checklist the importer signs off before filing is computed by the **filing
software itself**. That is what Logi-Sys does — it holds its own duty engine,
applies the notifications, and prints "Import CheckList". Nothing came back from
Customs to produce that document.

This is why `packages/core/src/duty.ts` exists, and why it is **load-bearing
rather than a nice-to-have**. Today it feeds the checklist cross-check and the
licence debit. After Phase 6 it *is* the checklist.

## Why the rates do not need to be sent to us

The Bill of Entry declares a **claim**, not a rate: `Basic_Notn` + serial,
`IGST_LevyNotn` + serial, and so on. There is no `BCD_Rate` or `IGST_Rate`
column anywhere on ITEMS.

Both sides then look the rate up in the same published notification. We hold
those notifications as masters — 9/2025-IT(R) for IGST, 45/2025-Cus for BCD
exemptions, 11/2021 for AIDC, the FTA schedules, the trade-remedy tables. So the
percentage on our checklist and the percentage ICES applies come from the same
document. If they disagree, one of us has read it wrong, and that is exactly
what the variance control exists to catch.

## What Customs does send back, after filing

From `BE Message format 2.25`, the full message set:

| Message | Direction | ID | Ext |
|---|---|---|---|
| Bill of Entry | us → Customs | `CACHI01` | |
| BE Amendment | us → Customs | `CACHI01_A` | |
| Acknowledgement | Customs → us | `CHCAI02` | `.ack` |
| **Negative** acknowledgement | Customs → us | `CHCAI02` | `.nak` |
| **Processed BE** | Customs → us | `CHCAI04` | `.chl` |
| Query raised by officer | Customs → us | `CHCAI05` | `.qry` |
| Query reply | us → Customs | `CHCAI06` | |
| Out-of-charge BE | Customs → us | `CHCAI07` | |

**`CHCAI04` is the assessed Bill of Entry, and its extension is literally
`.chl`.** But it is only **seven fields**: message type, custom house code, BE
number, BE date, CHA/IEC user id, **challan number**, and a **BE print file
location**.

So the assessed duty does not arrive as structured data. It arrives as a
**document you fetch** — which is exactly what the `Processed BE_I-*.pdf` files
in the corpus folders are. Those are ICES ground truth, and we already hold 
several of them.

`Challan Enquiry` on the ICEGATE portal (open to IEC and CHA) covers the
payment side.

## What this means for the phases

1. **The duty engine is not optional.** Phase 6 cannot ship without our own
   checklist, because after Logi-Sys there is nothing else that produces one.
   `apps/web/lib/checklist-html.ts` already renders one in the legacy path.

2. **The exchange rate bug is worse than it looks.** Since we compute the
   checklist ourselves, a wrong rate corrupts the figure the importer approves
   *and* the licence debit — not just a cell in a spreadsheet. See
   [Phase 0](phase-0-correctness.md).

3. **There is no way to find out if a filing is valid except by filing it.**
   The `.nak` is the validation response. That is precisely why the 668-row
   rejection table has to become our own pre-flight check — it is the only
   substitute for a dry run that exists. See [Phase 0](phase-0-correctness.md).

4. **The assessed figure is the only real proof the engine is right.** We
   already model the comparison: `job_clearance` checks what Customs assessed
   against the checklist figure with a one-rupee tolerance and sends the job
   back to scrutiny when they differ. Run that against our own filing and it
   becomes the acceptance test for the whole project. See
   [Phase 7](phase-7-cutover.md).
