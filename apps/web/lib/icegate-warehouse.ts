import 'server-only';

/**
 * ICEGATE's public warehouse code enquiry.
 *
 * `https://enquiry.icegate.gov.in/enquiryatices/wareHouseCodeEnquiry` takes a
 * warehouse code or name and returns the warehouse's code, name and address.
 * No login and no captcha — it is one of the ICEGATE 2.0 public enquiry
 * services (user manual v1.01, §5.5).
 *
 * Two things shape this client:
 *
 *   - **The host resolves only from India.** A DNS query from outside returns
 *     NOERROR with no answer, which is GeoDNS, not a dead name. So this fails
 *     cleanly and often, and every caller must work without it.
 *   - **A government portal must never sit in the path of a workbook
 *     download.** What it returns is cached in `bonded_warehouses` and read
 *     from there afterwards; this is called once per warehouse, not once per
 *     export.
 *
 * Everything here returns `undefined` rather than throwing. A warehouse we
 * could not look up is a warehouse the operator types in once — an inconvenience
 * — where an exception in the draft pipeline would fail the whole job.
 */

const ENQUIRY_HOST = 'https://enquiry.icegate.gov.in';

/**
 * The enquiry is a JSP-era form behind a single-page front end, and the exact
 * request its Search button issues could not be observed from outside India.
 * These are the shapes worth trying, most likely first; the first one that
 * returns something parseable wins, and the whole thing degrades to the
 * operator entering the warehouse by hand.
 */
const CANDIDATE_PATHS = [
  '/enquiryatices/api/wareHouseCodeEnquiry',
  '/enquiryatices/wareHouseCodeEnquiry',
] as const;

/** How long to wait before deciding the portal is not going to answer. */
const TIMEOUT_MS = 6_000;

export interface IcegateWarehouse {
  code: string;
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  pin?: string;
}

/** The shapes the enquiry might return a row in, reduced to ours. */
function normaliseRow(row: Record<string, unknown>): IcegateWarehouse | undefined {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const found = Object.entries(row).find(
        ([k]) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === key,
      );
      const value = found?.[1];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };

  const code = pick('warehousecode', 'whcode', 'code');
  if (!code) return undefined;

  return {
    code: code.toUpperCase(),
    ...(pick('warehousename', 'whname', 'name') && {
      name: pick('warehousename', 'whname', 'name') as string,
    }),
    ...(pick('warehouseaddress1', 'address1', 'whadd1', 'warehouseaddress') && {
      address1: pick('warehouseaddress1', 'address1', 'whadd1', 'warehouseaddress') as string,
    }),
    ...(pick('warehouseaddress2', 'address2', 'whadd2') && {
      address2: pick('warehouseaddress2', 'address2', 'whadd2') as string,
    }),
    ...(pick('city', 'whcity') && { city: pick('city', 'whcity') as string }),
    ...(pick('pin', 'pincode', 'whpin') && { pin: pick('pin', 'pincode', 'whpin') as string }),
  };
}

/** Rows out of whatever envelope the response wraps them in. */
function rowsOf(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((r): r is Record<string, unknown> => !!r);
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'result', 'results', 'rows', 'warehouseList', 'responseData']) {
      const inner = (payload as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner.filter((r): r is Record<string, unknown> => !!r);
      if (inner && typeof inner === 'object') return [inner as Record<string, unknown>];
    }
  }
  return [];
}

/**
 * Look a warehouse code up on ICEGATE.
 *
 * Returns undefined when the portal cannot be reached, answers with something
 * we cannot read, or does not know the code — the caller cannot tell those
 * apart, and does not need to: all three mean "ask the operator".
 */
export async function fetchWarehouseFromIcegate(
  code: string,
): Promise<IcegateWarehouse | undefined> {
  const wanted = code.trim().toUpperCase();
  if (wanted.length < 3) return undefined;

  for (const path of CANDIDATE_PATHS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `${ENQUIRY_HOST}${path}?warehouseCode=${encodeURIComponent(wanted)}`,
        {
          signal: controller.signal,
          headers: { accept: 'application/json' },
          cache: 'no-store',
        },
      );
      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) continue;

      const rows = rowsOf(await response.json()).map(normaliseRow);
      // Name search returns several; a code search should return the one. Only
      // an exact code match is taken — a near miss is a different warehouse.
      const hit = rows.find((r) => r?.code === wanted);
      if (hit) return hit;
    } catch {
      // DNS failure outside India, a timeout, a redirect to an SPA shell, or
      // HTML where JSON was expected. None of them is worth distinguishing.
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}
