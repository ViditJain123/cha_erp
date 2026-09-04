import tls from 'node:tls';
import { Agent, fetch as undiciFetch } from 'undici';
import { getDoc, saveDoc, type LibraryDocMeta } from './store.js';

/**
 * taxinformation.cbic.gov.in serves an incomplete TLS chain (the Sectigo
 * "OV R36" intermediate is missing), which Node's fetch rejects while
 * browsers repair via AIA fetching. Fix: append the official Sectigo
 * intermediate (from crt.sectigo.com) to the default trust store —
 * certificate verification stays fully enabled.
 */
const SECTIGO_OV_R36_PEM = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----`;
const taxinfoDispatcher = new Agent({
  connect: { ca: [...tls.rootCertificates, SECTIGO_OV_R36_PEM] },
});

/**
 * Fetchers for official CBIC documents.
 *
 * Working tariff chapters used to be reachable as static files:
 *   https://www.cbic.gov.in/CONTENTREPO/Customs/Tariff/Tariff(ason<EDITION>)/CUSTOMS_TARIFF_VOL-I/chap-<N>.pdf
 * CBIC rebuilt cbic.gov.in as a single-page app and **every one of those URLs
 * now 404s**, for every edition. The PDFs are still published at those same
 * repository paths; they are just no longer served directly. They come back
 * through the site's own JSON API:
 *
 *   GET /api/cbic-content-msts/<base64(contentId)>
 *       -> a content node; its cbicDocMsts[] carry filePathEn
 *   GET /content/pdf/<filePathEn>
 *       -> {"data": "<base64 pdf>", "fileName": "..."}
 *
 * The id in that first URL is base64 of the decimal id — the API rejects the
 * bare number. Content id 172462 is "Tariff (as on 30.06.2025)", the root of
 * the whole Customs Tariff; PART II under it is the Import Tariff, whose
 * sections hold the 98 chapters of the First Schedule.
 *
 * **The path is read off the node, never constructed.** A chapter routinely
 * points at an older edition folder than its parent, because CBIC republishes
 * a chapter only when it changes — so "the current edition" is a property of
 * each chapter, not of the tariff. Probing editions newest-first was the old
 * approach and it is what the edition list below is now only kept for: naming
 * archived copies when the live API is unreachable.
 */

/** Editions the static repo used to publish under. Wayback fallback only. */
export const TARIFF_EDITIONS = [
  '30.06.2025',
  '30.06.2024',
  '31.03.2024',
  '31.12.2023',
  '30.09.2023',
] as const;

const UA = 'Mozilla/5.0 (compatible; checklist-app-library/1.0)';

const CBIC = 'https://www.cbic.gov.in';

/** "Tariff (as on 30.06.2025)" — the root of the three-volume Customs Tariff. */
const TARIFF_ROOT_CONTENT_ID = 172462;

/** PART II, the Import Tariff: the sections that hold the First Schedule. */
const IMPORT_TARIFF_TITLE = /PART\s*-?\s*II\b/i;

function chapterUrl(edition: string, chapter: number): string {
  return `${CBIC}/CONTENTREPO/Customs/Tariff/Tariff(ason${edition})/CUSTOMS_TARIFF_VOL-I/chap-${chapter}.pdf`;
}

interface ContentNode {
  id: number;
  titleEn?: string;
  childContentList?: ContentNode[];
  cbicDocMsts?: { filePathEn?: string }[];
}

async function contentNode(id: number): Promise<ContentNode | null> {
  try {
    const encoded = Buffer.from(String(id)).toString('base64');
    const res = await fetch(`${CBIC}/api/cbic-content-msts/${encoded}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? ((await res.json()) as ContentNode) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a document CBIC addresses by repository path. The endpoint answers with
 * the PDF base64-encoded inside a JSON envelope, and answers 200 with an empty
 * body for a path that does not exist — so absence is length, not status.
 */
async function fetchRepoPdf(filePath: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${CBIC}/content/pdf/${filePath}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    const body = JSON.parse(text) as { data?: string };
    if (!body.data) return null;
    const pdf = Buffer.from(body.data, 'base64');
    return pdf.length > 1000 && pdf.subarray(0, 5).toString() === '%PDF-' ? pdf : null;
  } catch {
    return null;
  }
}

/**
 * chapter number -> repository path, resolved once per process.
 *
 * Walking PART II costs one request for the part plus one per section, ~22 in
 * all, so it is cheap enough to do eagerly and wrong to do per chapter.
 */
let chapterPathCache: Promise<Map<number, string>> | null = null;

/**
 * chapter number -> the repository path CBIC currently publishes it at.
 *
 * Exported so `cli/check-tariff-source.ts` can assert the tree still resolves.
 * CBIC has moved this once already; the next time it moves, the failure mode
 * without that check is a tariff master that silently stops updating.
 */
export function tariffChapterPaths(): Promise<Map<number, string>> {
  chapterPathCache ??= (async () => {
    const paths = new Map<number, string>();
    const root = await contentNode(TARIFF_ROOT_CONTENT_ID);
    const part = root?.childContentList?.find((c) => IMPORT_TARIFF_TITLE.test(c.titleEn ?? ''));
    if (!part) return paths;

    for (const summary of (await contentNode(part.id))?.childContentList ?? []) {
      const section = await contentNode(summary.id);
      for (const chapterNode of section?.childContentList ?? []) {
        for (const doc of chapterNode.cbicDocMsts ?? []) {
          // The chapter number is in the filename, not in the node — the node
          // is titled by subject ("Plastics and articles thereof.").
          const n = doc.filePathEn?.match(/chap-(\d+)\.pdf$/i);
          if (n && doc.filePathEn) paths.set(Number(n[1]), doc.filePathEn);
        }
      }
    }
    return paths;
  })();
  return chapterPathCache;
}

/** Drop the memoised tree, so a long-lived process can pick up a new edition. */
export function resetTariffChapterCache(): void {
  chapterPathCache = null;
}

async function fetchPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // CBIC serves an HTML error page with 200 sometimes — verify PDF magic
    if (buf.length < 1000 || buf.subarray(0, 5).toString() !== '%PDF-') return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Wayback Machine fallback: CBIC periodically breaks/moves its document repo
 * (the entire CONTENTREPO 404s as of Aug 2026), but archived copies of the
 * official PDFs remain retrievable.
 */
async function fetchViaWayback(originalUrl: string): Promise<{ pdf: Buffer; archiveUrl: string } | null> {
  try {
    const api = `http://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
    const res = await fetch(api, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { archived_snapshots?: { closest?: { available: boolean; url: string } } };
    const snap = data.archived_snapshots?.closest;
    if (!snap?.available) return null;
    // "id_" suffix returns the original bytes without the wayback toolbar
    const rawUrl = snap.url.replace(/\/(\d{14})\//, '/$1id_/');
    const pdf = await fetchPdf(rawUrl);
    return pdf ? { pdf, archiveUrl: snap.url } : null;
  } catch {
    return null;
  }
}

export interface FetchResult {
  id: string;
  status: 'downloaded' | 'exists' | 'missing';
  edition?: string;
  bytes?: number;
}

/** The edition a chapter was published under, read out of its repository path. */
function editionOf(filePath: string): string | undefined {
  return filePath.match(/Tariff\(ason([\d.]+)\)/)?.[1];
}

/**
 * Download one tariff chapter.
 *
 * The live path resolves the chapter through CBIC's content tree; the Wayback
 * fallback below still probes the old static URLs, because that is where the
 * archived copies were taken from.
 */
export async function fetchTariffChapter(chapter: number): Promise<FetchResult> {
  const id = `tariff-chap-${String(chapter).padStart(2, '0')}`;
  if (getDoc(id)) return { id, status: 'exists' };

  const filePath = (await tariffChapterPaths()).get(chapter);
  if (filePath) {
    const pdf = await fetchRepoPdf(filePath);
    if (pdf) {
      const edition = editionOf(filePath);
      const meta: LibraryDocMeta = {
        id,
        kind: 'tariff-chapter',
        title: `Customs Tariff — Chapter ${chapter}${edition ? ` (as on ${edition})` : ''}`,
        // The repository path, not the API call: it is the stable identity of
        // the document, and it says which edition this chapter came from.
        sourceUrl: `${CBIC}/content/pdf/${filePath}`,
        chapter,
        // A path CBIC has restructured before could stop carrying the edition;
        // that is worth losing the label over, not the chapter.
        ...(edition ? { edition } : {}),
        fetchedAt: new Date().toISOString(),
      };
      saveDoc(meta, pdf);
      return { id, status: 'downloaded', ...(edition ? { edition } : {}), bytes: pdf.length };
    }
  }
  // live API unreachable → archived copy of the newest edition available
  for (const edition of TARIFF_EDITIONS) {
    const url = chapterUrl(edition, chapter);
    const archived = await fetchViaWayback(url);
    if (archived) {
      const meta: LibraryDocMeta = {
        id,
        kind: 'tariff-chapter',
        title: `Customs Tariff — Chapter ${chapter} (as on ${edition}, archived copy)`,
        sourceUrl: archived.archiveUrl,
        chapter,
        edition,
        fetchedAt: new Date().toISOString(),
      };
      saveDoc(meta, archived.pdf);
      return { id, status: 'downloaded', edition: `${edition} (wayback)`, bytes: archived.pdf.length };
    }
  }
  return { id, status: 'missing' };
}

/**
 * Consolidated working tariff, all chapters in one official PDF
 * (newest consolidated edition confirmed retrievable via the Internet Archive).
 */
export async function fetchConsolidatedTariff(): Promise<FetchResult> {
  const id = 'tariff-consolidated-2023';
  if (getDoc(id)) return { id, status: 'exists' };
  const original =
    'https://old.cbic.gov.in/resources//htdocs-cbec/customs/cst2023-010523/Customs%20Tariff%20(Chap-1%20to%2098)%20on%2001-05-2023.pdf';
  const direct = await fetchPdf(original);
  const got = direct ? { pdf: direct, archiveUrl: original } : await fetchViaWayback(original);
  if (!got) return { id, status: 'missing' };
  const meta: LibraryDocMeta = {
    id,
    kind: 'tariff-chapter',
    title: 'Customs Tariff — Chapters 1–98 (as on 01.05.2023, consolidated)',
    sourceUrl: got.archiveUrl,
    edition: '01.05.2023',
    fetchedAt: new Date().toISOString(),
  };
  saveDoc(meta, got.pdf);
  return { id, status: 'downloaded', edition: '01.05.2023', bytes: got.pdf.length };
}

/** Download a notification PDF from taxinformation.cbic.gov.in (or any direct PDF URL). */
export async function fetchNotification(url: string, label: string): Promise<FetchResult> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'taxinformation.cbic.gov.in') {
      const m = parsed.pathname.match(/^\/view-pdf\/(\d+)/);
      if (m) return fetchTaxinfoNotification(Number(m[1]));
    }
  } catch {
    return { id: 'notn-invalid-url', status: 'missing' };
  }

  const id = `notn-${label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
  if (getDoc(id)) return { id, status: 'exists' };
  const pdf = await fetchPdf(url);
  if (!pdf) return { id, status: 'missing' };
  const meta: LibraryDocMeta = {
    id,
    kind: 'notification',
    title: `Notification ${label}`,
    sourceUrl: url,
    notification: label,
    fetchedAt: new Date().toISOString(),
  };
  saveDoc(meta, pdf);
  return { id, status: 'downloaded', bytes: pdf.length };
}

interface TaxinfoMeta {
  notificationNo?: string;
  notificationName?: string;
  notificationCategory?: string;
  docFilePath?: string;
}

/**
 * taxinformation.cbic.gov.in ingestion by portal id (the number in
 * /view-pdf/<id>/ENG/Notifications). The portal's own anonymous endpoints:
 *   /api/cbic-notification-msts/<id>  -> metadata incl. docFilePath
 *   /content/pdf/<path>               -> {"data": "<base64 pdf>"}
 */
export async function fetchTaxinfoNotification(portalId: number): Promise<FetchResult> {
  const sourceUrl = `https://taxinformation.cbic.gov.in/view-pdf/${portalId}/ENG/Notifications`;
  const headers = { 'User-Agent': UA };
  try {
    const metaRes = await undiciFetch(
      `https://taxinformation.cbic.gov.in/api/cbic-notification-msts/${portalId}`,
      { headers, signal: AbortSignal.timeout(30_000), dispatcher: taxinfoDispatcher },
    );
    if (!metaRes.ok) return { id: `notn-${portalId}`, status: 'missing' };
    const info = (await metaRes.json()) as TaxinfoMeta;
    const label = info.notificationNo ?? String(portalId);
    const id = `notn-${label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
    if (getDoc(id)) return { id, status: 'exists' };
    const path = (info.docFilePath ?? '').replace(/\\/g, '/');
    if (!path) return { id, status: 'missing' };

    const pdfRes = await undiciFetch(`https://taxinformation.cbic.gov.in/content/pdf/${path}`, {
      headers,
      signal: AbortSignal.timeout(60_000),
      dispatcher: taxinfoDispatcher,
    });
    if (!pdfRes.ok) return { id, status: 'missing' };
    const body = (await pdfRes.json()) as { data?: string };
    if (!body.data) return { id, status: 'missing' };
    const pdf = Buffer.from(body.data, 'base64');
    if (pdf.subarray(0, 5).toString() !== '%PDF-') return { id, status: 'missing' };

    saveDoc(
      {
        id,
        kind: 'notification',
        title: `Notification ${label} — ${info.notificationName ?? ''}`.trim(),
        sourceUrl,
        notification: label,
        fetchedAt: new Date().toISOString(),
      },
      pdf,
    );
    return { id, status: 'downloaded', bytes: pdf.length };
  } catch {
    return { id: `notn-${portalId}`, status: 'missing' };
  }
}
