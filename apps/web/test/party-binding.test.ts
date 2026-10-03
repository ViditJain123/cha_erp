import { describe, expect, it } from 'vitest';
import { importerFrom, supplierFrom } from '../lib/party-binding';
import type { Database } from '@checklist/db';

type OrganizationRow = Database['public']['Tables']['organizations']['Row'];

/**
 * What binding a party to the repository is allowed to overwrite.
 *
 * The repository's spelling wins, because Logi-Sys resolves its parties on the
 * exact name it holds. But it is a *party* master, not a shipping document:
 * two thirds of its five thousand rows carry no city, most carry no IEC, and
 * plenty carry no postcode. `applyPartyResolution` therefore spreads the bound
 * row over the extracted one rather than replacing it, and that only works
 * while these two omit the fields the row does not have instead of setting
 * them to undefined.
 *
 * Getting it wrong is quiet and wrong in the worst direction: binding a
 * supplier used to drop the city the invoice printed, and the export then
 * warned that the city "was not extracted" — untrue of the documents and true
 * only of us. Eleven suppliers across the corpus.
 */

function org(over: Partial<OrganizationRow> = {}): OrganizationRow {
  return {
    id: 'org-1',
    name: 'CELLMARK AB',
    branch_name: '0',
    branch_sr_no: '0',
    address1: 'BOX 11049',
    address2: null,
    address3: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    country_code: null,
    iec: null,
    pan: null,
    gstin: null,
    ad_code: null,
    ...over,
  } as unknown as OrganizationRow;
}

describe('a repository row that holds less than the documents', () => {
  it('leaves the city it does not have alone', () => {
    const bound = supplierFrom(org({ city: null }), 'exact');
    expect('city' in bound).toBe(false);

    const merged = { ...{ name: 'CELLMARK AB', addressLines: [], city: 'Gothenburg' }, ...bound };
    expect(merged.city).toBe('Gothenburg');
  });

  it('overwrites the city it does have', () => {
    const bound = supplierFrom(org({ city: 'Gothenburg' }), 'exact');
    const merged = { ...{ name: 'x', addressLines: [], city: 'GOTEBORG' }, ...bound };
    expect(merged.city).toBe('Gothenburg');
  });

  it('never states a field as undefined, on either party', () => {
    // `{ ...doc, ...bound }` erases whatever `bound` names, so naming a field
    // it has no value for is the same as deleting the document's.
    for (const bound of [supplierFrom(org(), 'exact'), importerFrom(org(), 'exact')]) {
      for (const [key, value] of Object.entries(bound)) {
        expect(value, `${key} is present but undefined`).toBeDefined();
      }
    }
  });

  it('still takes the repository name and the binding itself', () => {
    const bound = supplierFrom(org({ name: 'BOROUGE PTE LTD' }), 'exact');
    const merged = { ...{ name: 'Borouge Pte Ltd.', addressLines: [] }, ...bound };
    expect(merged.name).toBe('BOROUGE PTE LTD');
    expect(merged.organizationId).toBe('org-1');
    expect(merged.matchStatus).toBe('exact');
  });
});
