import { describe, expect, it } from 'vitest';
import {
  branchNameForExport,
  cellValue,
  isPlaceholderBranch,
  partyNameCell,
  partyNameKey,
} from '../src/masters/party-name.js';

describe('partyNameKey', () => {
  it('matches the two names the exported workbook got wrong', () => {
    // GENERAL.Importer was "M/S. ELITE POLYPLUS"; the repository says
    // "ELITE POLYPLUS".
    expect(partyNameKey('M/S. ELITE POLYPLUS')).toBe(partyNameKey('ELITE POLYPLUS'));

    // INVOICES.Supplier_Name was "ASIA SHIGEN INTERNATIONAL"; the repository
    // says "ASIA SHIGEN INTERNATIONAL CO., LTD".
    expect(partyNameKey('ASIA SHIGEN INTERNATIONAL')).toBe(
      partyNameKey('ASIA SHIGEN INTERNATIONAL CO., LTD'),
    );
  });

  it('drops honorifics and legal suffixes', () => {
    expect(partyNameKey('M/S. ELITE POLYPLUS')).toBe('ELITE POLYPLUS');
    expect(partyNameKey('FUCHS LUBRICANTS (INDIA) PVT. LTD.')).toBe('FUCHS LUBRICANTS INDIA');
    expect(partyNameKey('FUCHS LUBRICANTS (INDIA) PRIVATE LIMITED')).toBe(
      'FUCHS LUBRICANTS INDIA',
    );
    expect(partyNameKey('Messrs Shree Cement Limited')).toBe('SHREE CEMENT');
  });

  it('spells & the way the repository does', () => {
    // The export writes ampersands out: 'TRIVENI ENGINEERING  and  INDUSTRIES LTD'.
    expect(partyNameKey('TRIVENI ENGINEERING & INDUSTRIES LTD')).toBe(
      partyNameKey('TRIVENI ENGINEERING  and  INDUSTRIES LTD'),
    );
  });

  it('does not collapse two different parties', () => {
    expect(partyNameKey('SIEMENS LIMITED')).not.toBe(partyNameKey('SIEMENS HEALTHCARE'));
  });

  it('is empty for nothing', () => {
    expect(partyNameKey('')).toBe('');
    expect(partyNameKey(undefined)).toBe('');
    expect(partyNameKey('   ...   ')).toBe('');
  });
});

describe('cellValue', () => {
  it('treats the export placeholders as absent', () => {
    for (const empty of ['', '   ', 'NULL', 'null', '.', 'NA', 'N/A', '-', 'NIL']) {
      expect(cellValue(empty)).toBeUndefined();
    }
  });

  it('keeps real values, collapsing whitespace', () => {
    expect(cellValue('  GUJARAT  ')).toBe('GUJARAT');
    expect(cellValue('Hong Kong ')).toBe('Hong Kong');
    expect(cellValue('24ABDFA1460G1ZZ')).toBe('24ABDFA1460G1ZZ');
  });

  it('keeps a zero that is not a placeholder branch', () => {
    expect(cellValue('0')).toBe('0');
  });
});

describe('partyNameCell', () => {
  it('drops the stray quote some rows carry', () => {
    expect(partyNameCell('"LIZHU MACHINERY CO., LTD.')).toBe('LIZHU MACHINERY CO., LTD.');
    expect(partyNameCell('AB TINGSTAD PAPPER ')).toBe('AB TINGSTAD PAPPER');
  });
});

describe('branch names', () => {
  it('blanks the placeholders Logi-Sys writes for a single-location party', () => {
    for (const branch of ['0', '.', 'NA', '', '-']) {
      expect(isPlaceholderBranch(branch)).toBe(true);
      expect(branchNameForExport(branch)).toBeUndefined();
    }
  });

  it('keeps MAIN, which is a real branch name in the repository', () => {
    expect(isPlaceholderBranch('MAIN')).toBe(false);
    expect(branchNameForExport('MAIN')).toBe('MAIN');
    expect(branchNameForExport('Main Branch')).toBe('Main Branch');
    expect(branchNameForExport('Bangalore 2')).toBe('Bangalore 2');
  });
});
