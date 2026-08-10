export interface CcrCsvRow {
  hsCode: string;
  code: string;
  title: string;
  requirementText: string;
}

export interface CcrCsvResult {
  rows: CcrCsvRow[];
  errors: string[];
}

/**
 * Parses the CCR import format: `hs_code,code,title,requirement_text`.
 *
 * A hand-rolled reader rather than a CSV library, because requirement text
 * routinely contains commas and newlines inside quotes and we need to handle
 * that correctly — but nothing more exotic than RFC 4180.
 */
export function parseCcrCsv(text: string): CcrCsvResult {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      if (record.some((f) => f.trim() !== '')) records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== '')) records.push(record);

  const errors: string[] = [];
  const rows: CcrCsvRow[] = [];

  for (const [index, cells] of records.entries()) {
    const [hsRaw = '', code = '', title = '', requirementText = ''] = cells.map((c) => c.trim());

    // Skip a header row rather than failing on it.
    if (index === 0 && /^hs/i.test(hsRaw) && /code/i.test(code)) continue;

    const hsCode = hsRaw.replace(/\D/g, '');
    const line = index + 1;
    if (!hsCode || hsCode.length < 2 || hsCode.length > 8) {
      errors.push(`Line ${line}: "${hsRaw}" is not an HS code.`);
      continue;
    }
    if (!code) {
      errors.push(`Line ${line}: missing the requirement code.`);
      continue;
    }
    if (!requirementText) {
      errors.push(`Line ${line}: missing the requirement text.`);
      continue;
    }
    rows.push({ hsCode, code, title: title || code, requirementText });
  }

  return { rows, errors };
}
