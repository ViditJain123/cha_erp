import { CUSTOM_HOUSES, type CustomHouseMaster } from './data.js';

/**
 * Which kind of customs station a code names, and what that implies for the
 * transport mode on the Bill of Entry.
 *
 * The station's *kind* is carried by the sixth character of its ICES site code,
 * not by its name. That is worth stating plainly because the name is what the
 * generated master guesses from, and the name lies:
 *
 *   - `INPAV1` "Pipavav" and `INPAV6` "Pipavav (Victor) Port" are two different
 *     stations; the one whose name says PORT is the inland one.
 *   - `INGGV1` "Gangavaram ICD" is a sea station whose name says ICD.
 *   - 65 of the 296 stations have names the pattern list cannot classify at all
 *     — "Pithampur", "Moradabad", "GIFT CITY", "Jalandhar" — and every one of
 *     them is an inland station that a bill of lading can name as its place of
 *     delivery.
 *
 * The suffix classifies all 296 with no exceptions:
 *
 * | Suffix | Station | Transport mode |
 * |---|---|---|
 * | `1` | sea port | `S` |
 * | `4` | air cargo complex | `A` |
 * | `6` | ICD / CFS / SEZ — inland | `L` |
 * | `2` | rail cargo | `L` |
 * | `B` | land customs station | `L` |
 */
export type StationKind = 'sea' | 'air' | 'inland';

const SUFFIX_KIND: Record<string, StationKind> = {
  '1': 'sea',
  '4': 'air',
  '6': 'inland',
  '2': 'inland',
  B: 'inland',
};

/**
 * The kind of station an ICES code names, from its suffix.
 *
 * Falls back to the master's name-derived `mode` for a code shaped unlike the
 * five known suffixes, and returns undefined when neither can say.
 */
export function stationKind(codeOrStation: string | CustomHouseMaster): StationKind | undefined {
  const station = typeof codeOrStation === 'string' ? undefined : codeOrStation;
  const code = (typeof codeOrStation === 'string' ? codeOrStation : codeOrStation.code)
    .trim()
    .toUpperCase();

  const bySuffix = SUFFIX_KIND[code.slice(-1)];
  if (bySuffix) return bySuffix;

  const mode = station?.mode ?? CUSTOM_HOUSES.find((h) => h.code === code)?.mode;
  if (mode === 'sea') return 'sea';
  if (mode === 'air') return 'air';
  if (mode === 'icd' || mode === 'land' || mode === 'sez') return 'inland';
  return undefined;
}

/** The GENERAL sheet's `TransportModeCode` for a station. */
export function transportModeForStation(
  codeOrStation: string | CustomHouseMaster,
): 'S' | 'A' | 'L' | undefined {
  const kind = stationKind(codeOrStation);
  if (kind === 'sea') return 'S';
  if (kind === 'air') return 'A';
  if (kind === 'inland') return 'L';
  return undefined;
}

/**
 * Noise words that appear in a station's name but not in the place a bill of
 * lading prints, or the other way round. Stripped from both sides before the
 * names are compared, so "ICD TUGHLAKABAD" and "Tuglakabad ICD" reduce to the
 * same token — which is the entire problem this function exists to solve.
 */
const NOISE =
  /\b(ICD|CFS|SEZ|FTWZ|ACC|AIR|CARGO|COMPLEX|SEA|PORT|PORTS|TERMINAL|TERMINALS|DEPOT|CONTAINER|INLAND|DRY|STATION|RAIL|RAILWAY|LCS|LAND|CUSTOMS?|HOUSE|PVT|PRIVATE|LTD|LIMITED|CO|COMPANY|INDIA|THE|OF|AND)\b/g;

/**
 * A place name reduced to the letters that identify it.
 *
 * Vowel-insensitive, because the master spells Tughlakabad "Tuglakabad" and a
 * bill of lading types it either way.
 *
 * Note what this deliberately throws away: the words ICD, SEA, PORT and AIR
 * CARGO. Those are what make "Tuglakabad ICD" and "ICD TUGHLAKABAD" the same
 * place — and also what tells "Mundra Sea" apart from "MUNDRA PORT & SEZ LTD",
 * which are two different custom houses with opposite transport modes. So the
 * stripped key is never the first thing tried, and when it collides the mode
 * words are put back to break the tie.
 */
function placeKey(name: string): string {
  const stripped = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.replace(/[AEIOU]/g, '');
}

/** The whole name, normalised but with every word kept. */
function fullKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What kind of station a place name says it is, from its own words.
 *
 * Seventeen places in the master name both a sea station and an inland one —
 * Mundra, Cochin, Tuticorin, Chennai, Hyderabad — and the only thing separating
 * them is the qualifier the bill of lading prints beside the place.
 */
function kindHint(place: string): StationKind | undefined {
  const upper = place.toUpperCase();
  if (/\b(ICD|CFS|INLAND|DRY PORT|DEPOT)\b/.test(upper)) return 'inland';
  if (/\b(AIR|ACC|AIRPORT)\b/.test(upper)) return 'air';
  if (/\b(SEA|SEAPORT|HARBOUR|HARBOR|DOCK)\b/.test(upper)) return 'sea';
  return undefined;
}

/** Places a bill of lading names that are not the station's name. */
const ALIASES: Record<string, string> = {
  JNPT: 'INNSA1',
  JNPCT: 'INNSA1',
  'NHAVA SHEVA': 'INNSA1',
  NSICT: 'INNSA1',
  BMCT: 'INNSA1',
  'JAWAHARLAL NEHRU': 'INNSA1',
  TUGHLAKABAD: 'INTKD6',
  TUGHLAQABAD: 'INTKD6',
  TKD: 'INTKD6',
  SAHAR: 'INBOM4',
};

/**
 * The Indian customs station a free-text place names — a bill of lading's place
 * of final delivery, or a custom house named in a customer's mail.
 *
 * Resolution order, each step only accepted when it is unambiguous:
 *
 *   1. ICES site code or EDI code, as typed
 *   2. a known alias ("JNPT", "Nhava Sheva")
 *   3. the whole name, normalised — this is what keeps "Mundra Sea" and
 *      "MUNDRA PORT & SEZ LTD" apart
 *   4. the identifying letters only, ignoring ICD/CFS/PORT noise and vowels;
 *      when several stations share those letters, the qualifier in the query
 *      ("Cochin ICD" vs "Cochin Sea") breaks the tie
 *   5. a single station whose key contains the query's
 *
 * Returns undefined rather than a best guess when several stations still match.
 * A Bill of Entry filed at the wrong custom house is rejected outright, so an
 * ambiguous place is a question for the operator, never a coin toss.
 *
 * `kind` is the tie-breaker the *document* supplies rather than the text. A
 * port of discharge read off a bill of lading is a sea station by construction
 * and an airport of destination off an air waybill is an air one, so "KOLKATA"
 * on a B/L is Kolkata Sea even though the city also has an airport and an ICD
 * and the name alone cannot say which. It only ever breaks a tie: a place that
 * resolves to one station on its own ignores it, and a place that stays
 * ambiguous with it still returns undefined.
 */
export function resolveIndianStation(
  place: string | null | undefined,
  kind?: StationKind,
): CustomHouseMaster | undefined {
  if (!place) return undefined;
  const raw = place.trim();
  if (!raw) return undefined;

  const upper = raw.toUpperCase();
  const byCode = CUSTOM_HOUSES.find((h) => h.code === upper || h.ediCode === upper);
  if (byCode) return byCode;

  // Aliases match on a contained phrase: a place of delivery reads
  // "NHAVA SHEVA (JNPT), INDIA" far more often than it reads "NHAVA SHEVA".
  const cleaned = fullKey(upper);
  for (const [alias, code] of Object.entries(ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(cleaned)) {
      const hit = CUSTOM_HOUSES.find((h) => h.code === code);
      if (hit) return hit;
    }
  }

  const exactFull = CUSTOM_HOUSES.filter((h) => fullKey(h.name) === cleaned);
  if (exactFull.length === 1) return exactFull[0];

  const key = placeKey(raw);
  if (key.length < 3) return undefined;

  const exact = CUSTOM_HOUSES.filter((h) => placeKey(h.name) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    // Several stations share a place. The qualifier the document printed beside
    // it is the only thing that can say which, and if it printed none, nothing
    // can.
    const hint = kindHint(raw) ?? kind;
    if (!hint) return undefined;
    const narrowed = exact.filter((h) => stationKind(h) === hint);
    return narrowed.length === 1 ? narrowed[0] : undefined;
  }

  const contains = CUSTOM_HOUSES.filter((h) => {
    const hk = placeKey(h.name);
    return hk.length >= 3 && (hk.includes(key) || key.includes(hk));
  });
  return contains.length === 1 ? contains[0] : undefined;
}
