import 'server-only';
import { parseWarehouseCode, type ParsedWarehouseCode } from '@checklist/core';
import type { WarehouseDetails } from '@checklist/extraction';
import type { Database } from '@checklist/db';
import { fetchWarehouseFromIcegate } from '@/lib/icegate-warehouse';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * Resolving a bonded warehouse from its code.
 *
 * Three layers, in the order they can be trusted and in the order they cost
 * anything:
 *
 *   1. **The code itself.** `MAA1U001` decodes offline into the station that
 *      licensed it and the section it is licensed under. This never fails for
 *      a valid code and needs nothing.
 *   2. **What we already hold.** A warehouse looked up once is kept, so the
 *      second job against it costs a single indexed read.
 *   3. **ICEGATE.** Only on a code we have not seen, and only for the name and
 *      address, which are the parts the code does not carry.
 */

export type WarehouseRow = Database['public']['Tables']['bonded_warehouses']['Row'];

/** A row of the cache, as the draft wants it. */
export function warehouseFromRow(row: WarehouseRow): WarehouseDetails {
  return {
    code: row.code,
    ...(row.name ? { name: row.name } : {}),
    ...(row.address1 ? { address1: row.address1 } : {}),
    ...(row.address2 ? { address2: row.address2 } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(row.pin ? { pin: row.pin } : {}),
    country: row.country || 'IN',
    ...(row.station_code ? { stationCode: row.station_code } : {}),
    ...(row.warehouse_type ? { type: row.warehouse_type } : {}),
  };
}

/** What the code alone says, with no name or address. */
function fromCodeOnly(parsed: ParsedWarehouseCode): WarehouseDetails {
  return {
    code: parsed.code,
    country: 'IN',
    stationCode: parsed.stationCode,
    stationName: parsed.station.name,
    type: parsed.type,
  };
}

export interface WarehouseResolution {
  warehouse: WarehouseDetails;
  /** Where the name and address came from — the code alone answers neither. */
  source: 'cache' | 'icegate' | 'code-only';
  parsed: ParsedWarehouseCode;
  /**
   * Whether this warehouse holds a section 65 (MOOWR) permission to manufacture.
   *
   * Not in the code and not on ICEGATE's enquiry — it is read off the permission
   * and kept on the row. Undefined means nobody has looked, which is different
   * from false: a SEC65 declaration filed against a warehouse ICES does not hold
   * as a section 65 unit is rejected, and so is one omitted from a warehouse it
   * does (errors 868 and 735).
   */
  isSec65?: boolean;
}

/**
 * The warehouse a code names, cached after the first lookup.
 *
 * Returns undefined only when the code is not a warehouse code at all; a code
 * that is valid but unknown still resolves, to what the code itself says. That
 * distinction matters downstream: an unparseable code blocks the export, an
 * un-enriched one only warns.
 */
export async function resolveWarehouse(
  code: string,
  companyId: string,
): Promise<WarehouseResolution | undefined> {
  const parsed = parseWarehouseCode(code);
  if (!parsed) return undefined;

  const db = serviceClient();

  const { data: cached } = await db
    .from('bonded_warehouses')
    .select('*')
    .eq('company_id', companyId)
    .eq('code', parsed.code)
    .maybeSingle();

  if (cached) {
    const row = cached as WarehouseRow;
    const warehouse = warehouseFromRow(row);
    return {
      // The station never comes off the cache — it is a property of the code,
      // and re-deriving it means a stale cached row cannot contradict it.
      warehouse: { ...warehouse, stationCode: parsed.stationCode, stationName: parsed.station.name },
      source: 'cache',
      parsed,
      ...(row.is_sec65 != null ? { isSec65: row.is_sec65 } : {}),
    };
  }

  const fetched = await fetchWarehouseFromIcegate(parsed.code);

  const warehouse: WarehouseDetails = fetched
    ? {
        ...fromCodeOnly(parsed),
        ...(fetched.name ? { name: fetched.name } : {}),
        ...(fetched.address1 ? { address1: fetched.address1 } : {}),
        ...(fetched.address2 ? { address2: fetched.address2 } : {}),
        ...(fetched.city ? { city: fetched.city } : {}),
        ...(fetched.pin ? { pin: fetched.pin } : {}),
      }
    : fromCodeOnly(parsed);

  // Cached either way. A code-only row is still worth keeping: it records that
  // this warehouse exists and is the row the operator edits to add the address,
  // rather than something they have to create from nothing.
  await db.from('bonded_warehouses').upsert(
    {
      company_id: companyId,
      code: parsed.code,
      ...(warehouse.name ? { name: warehouse.name } : {}),
      ...(warehouse.address1 ? { address1: warehouse.address1 } : {}),
      ...(warehouse.address2 ? { address2: warehouse.address2 } : {}),
      ...(warehouse.city ? { city: warehouse.city } : {}),
      ...(warehouse.pin ? { pin: warehouse.pin } : {}),
      country: 'IN',
      station_code: parsed.stationCode,
      warehouse_type: parsed.type,
      source: fetched ? ('icegate' as const) : ('operator' as const),
      ...(fetched ? { fetched_at: new Date().toISOString() } : {}),
    },
    { onConflict: 'company_id,code' },
  );

  return { warehouse, source: fetched ? 'icegate' : 'code-only', parsed };
}
