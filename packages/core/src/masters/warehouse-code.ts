import { CUSTOM_HOUSES, type CustomHouseMaster } from './data.js';
import { stationKind, type StationKind } from './stations.js';

/**
 * The eight-character code that identifies a customs bonded warehouse.
 *
 * Structure, per CBIC's warehouse-code allotment circular:
 *
 * ```
 *   M A A 1   U   0 0 1
 *   └──┬──┘   │   └─┬─┘
 *      │      │     └── running serial, three digits
 *      │      └──────── type of warehouse
 *      └─────────────── EDI port of registration
 * ```
 *
 * The port prefix is an ICES site code with its `IN` stripped: `MAA1` is
 * `INMAA1`, Chennai Sea. That is what makes this worth parsing rather than
 * treating as an opaque string — a warehouse code carries, and can be checked
 * against, the station that licensed it, using the master already in this
 * package and no network at all.
 *
 * `MAA1U001` is a real code: M/S APM TERMINAL(I) PVT. LTD, a public warehouse
 * under Chennai Sea. It is the worked example in ICEGATE's own Public Enquiries
 * manual (v1.01, §5.5).
 *
 * What the code does *not* carry is the warehouse's name, address, city or PIN.
 * Those come from ICEGATE's warehouse enquiry or from the operator; nothing
 * here can infer them.
 */

/** Section of the Customs Act the warehouse is licensed under. */
export type WarehouseType = 'public' | 'private' | 'special';

const TYPE_CHAR: Record<string, WarehouseType> = {
  U: 'public', // section 57
  R: 'private', // section 58
  P: 'special', // section 58A
};

/** The section number a licence type is granted under, for messages. */
export const WAREHOUSE_TYPE_SECTION: Record<WarehouseType, string> = {
  public: '57',
  private: '58',
  special: '58A',
};

export interface ParsedWarehouseCode {
  /** The code, normalised to upper case. */
  code: string;
  /** ICES site code of the licensing station — `MAA1` becomes `INMAA1`. */
  stationCode: string;
  station: CustomHouseMaster;
  /** Sea, air or inland, from the station's code suffix. */
  stationKind: StationKind | undefined;
  type: WarehouseType;
  /** The three-digit running serial, leading zeros intact. */
  serial: string;
}

/**
 * Why a code was rejected, so the operator is told which character is wrong
 * rather than "invalid warehouse code".
 */
export type WarehouseCodeError =
  | { reason: 'empty' }
  | { reason: 'length'; length: number }
  | { reason: 'station'; prefix: string }
  | { reason: 'type'; char: string }
  | { reason: 'serial'; serial: string };

export type WarehouseCodeResult =
  | { ok: true; parsed: ParsedWarehouseCode }
  | { ok: false; error: WarehouseCodeError };

/** Parse a warehouse code, reporting precisely what is wrong when it will not. */
export function parseWarehouseCodeResult(
  value: string | null | undefined,
): WarehouseCodeResult {
  const code = (value ?? '').trim().toUpperCase();
  if (!code) return { ok: false, error: { reason: 'empty' } };
  if (code.length !== 8) return { ok: false, error: { reason: 'length', length: code.length } };

  const prefix = code.slice(0, 4);
  const stationCode = `IN${prefix}`;
  const station = CUSTOM_HOUSES.find((h) => h.code === stationCode);
  if (!station) return { ok: false, error: { reason: 'station', prefix } };

  const typeChar = code[4] as string;
  const type = TYPE_CHAR[typeChar];
  if (!type) return { ok: false, error: { reason: 'type', char: typeChar } };

  const serial = code.slice(5);
  if (!/^\d{3}$/.test(serial)) return { ok: false, error: { reason: 'serial', serial } };

  return {
    ok: true,
    parsed: {
      code,
      stationCode,
      station,
      stationKind: stationKind(station),
      type,
      serial,
    },
  };
}

/** Parse a warehouse code, or undefined when it is not one. */
export function parseWarehouseCode(
  value: string | null | undefined,
): ParsedWarehouseCode | undefined {
  const result = parseWarehouseCodeResult(value);
  return result.ok ? result.parsed : undefined;
}

/** A rejection, in the words the operator needs to fix it. */
export function describeWarehouseCodeError(error: WarehouseCodeError): string {
  switch (error.reason) {
    case 'empty':
      return 'No warehouse code.';
    case 'length':
      return `A warehouse code is 8 characters — this one is ${error.length}. The shape is 4-character port, 1 type letter, 3-digit serial, as in MAA1U001.`;
    case 'station':
      return `"${error.prefix}" is not an ICES port code, so the first four characters do not name a customs station. A warehouse code opens with the port that licensed it — MAA1 for Chennai Sea, NSA1 for Nhava Sheva.`;
    case 'type':
      return `"${error.char}" is not a warehouse type. The fifth character is U for a public warehouse (s.57), R for private (s.58) or P for special (s.58A).`;
    case 'serial':
      return `"${error.serial}" is not a three-digit serial — the last three characters of a warehouse code are digits.`;
  }
}
