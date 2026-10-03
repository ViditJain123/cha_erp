import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, DraftItem } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { text } from '../src/cell.js';
import { MAX_CELL_CHARS, enforceCellLimits } from '../src/limits.js';
import { fillTemplate } from '../src/sheet-writer.js';
import { loadTemplate } from '../src/template.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * No cell may be longer than 120 characters. A hard rule: the build cuts and
 * warns, and the writer refuses anything that gets past it.
 */

function withItem(patch: Partial<DraftItem>): ChecklistDraft {
  const base = structuredClone(EP061126_1_DRAFT);
  return { ...base, items: [{ ...base.items[0]!, ...patch }] };
}

// ex_job13's real description, which the export used to write whole.
const LONG =
  'HYDROGEN PLANT 800 NM3/H INCLUDING: 1.METHANOL REFORMER 2. PSA UNIT 3. METHANOL STORAGE TANK 4. ' +
  'METHANOL PUMP SKID 5. DEMINERALISED WATER UNIT 6. CONTROL SYSTEM 7. INSTRUMENT AIR PACKAGE 8. ' +
  'NITROGEN GENERATOR 9. FLARE STACK 10. PIPING, VALVES AND FITTINGS 11. STRUCTURAL STEEL 12. SPARES';

describe('no cell exceeds MAX_CELL_CHARS', () => {
  it('is 120', () => {
    expect(MAX_CELL_CHARS).toBe(120);
  });

  it('cuts an over-long description in the built workbook and warns by cell', async () => {
    expect(LONG.length).toBeGreaterThan(MAX_CELL_CHARS);
    const { buffer, warnings } = await buildLogisysWorkbook({
      draft: withItem({ description: LONG, generalDescription: LONG }),
      job: EP061126_1_JOB,
    });
    const [row] = await readSheet(buffer, 'ITEMS');
    const written = String(row!['Product_Description']);
    expect(written.length).toBeLessThanOrEqual(MAX_CELL_CHARS);
    expect(written).toBe(LONG.slice(0, MAX_CELL_CHARS).trimEnd());
    expect(String(row!['General_Description']).length).toBeLessThanOrEqual(MAX_CELL_CHARS);

    const cut = warnings.filter((w) => w.includes('cut to 120'));
    expect(cut.some((w) => w.startsWith('ITEMS[1].Product_Description:'))).toBe(true);
    expect(cut.some((w) => w.startsWith('ITEMS[1].General_Description:'))).toBe(true);
    expect(cut.find((w) => w.startsWith('ITEMS[1].Product_Description:'))).toContain(`${LONG.length} characters`);
  });

  it('leaves every cell of the golden job alone', async () => {
    const { warnings } = await buildLogisysWorkbook({ draft: EP061126_1_DRAFT, job: EP061126_1_JOB });
    expect(warnings.some((w) => w.includes('cut to 120'))).toBe(false);
  });

  it('trims a cut that lands on a space', () => {
    const value = `${'A'.repeat(MAX_CELL_CHARS - 1)} BBBB`;
    const data = { ITEMS: [{ Product_Description: text(value) }] };
    const warned: string[] = [];
    enforceCellLimits(data, (path) => warned.push(path));
    const cell = data.ITEMS[0]!.Product_Description;
    expect(cell.kind === 'text' && cell.value).toBe('A'.repeat(MAX_CELL_CHARS - 1));
    expect(warned).toEqual(['ITEMS[1].Product_Description']);
  });

  it('is refused by the writer itself when a long cell reaches it', async () => {
    const template = await loadTemplate();
    await expect(
      fillTemplate(template, { ITEMS: [{ Product_Description: text('x'.repeat(MAX_CELL_CHARS + 1)) }] }),
    ).rejects.toThrow(/no cell may exceed 120/);
  });
});
