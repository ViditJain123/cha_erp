import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ChecklistDraft } from '@checklist/extraction';
import { missingScopes } from '@checklist/graph';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import {
  DOCUMENTS_STAGES,
  DOC_TYPE_LABELS,
  EVENT_LABELS,
  IDENTIFIER_LABELS,
  relativeTime,
} from '@/lib/jobs';
import { ChecklistUpload } from './checklist-upload';
import { LogisysExport } from './logisys-export';
import { PartiesPanel, type PartyState } from './parties-panel';
import { ScrutinyPanel } from './scrutiny-panel';
import { DocumentRequests } from './document-requests';
import { ShipperRequest } from './shipper-request';
import { CloseOut } from './close-out';
import { suggestCcrs, suggestShipper } from './actions';

export const metadata: Metadata = { title: 'Job' };
export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  // Scoped by company_id as well as id: the service role bypasses RLS, so this
  // is the only thing stopping a guessed uuid from crossing tenants.
  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) notFound();

  const [
    { data: documents },
    { data: identifiers },
    { data: events },
    { data: exports },
    { data: branches },
    { data: latestDraft },
  ] = await Promise.all([
    db.from('job_documents').select('*').eq('job_id', id).order('created_at'),
    db.from('job_identifiers').select('*').eq('job_id', id).order('kind'),
    db.from('job_events').select('*').eq('job_id', id).order('created_at', { ascending: false }),
    db.from('job_exports').select('*').eq('job_id', id).order('created_at', { ascending: false }),
    db
      .from('branches')
      .select('id, name')
      .eq('company_id', ctx.companyId)
      .eq('is_active', true)
      .order('name'),
    // `draft` as well as `version`: the checklist upload shows the duty the
    // engine computed as a cross-check against what Logi-Sys printed.
    db
      .from('job_drafts')
      .select('version, draft')
      .eq('job_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const hasChecklist = (documents ?? []).some((d) => d.doc_type === 'checklist');

  // The duty engine's own figure, offered as a prefill and a sanity check. It
  // is not what passing compares against — the checklist's printed figure is,
  // because that is what the client was shown.
  const engineDuty =
    ((latestDraft?.draft as { duty?: { dutyPayable?: number } } | null)?.duty?.dutyPayable ?? null);

  // The two parties Logi-Sys resolves from its own repository. Read off the
  // draft rather than off `jobs`, because the draft is what the workbook is
  // built from and so is what has to be right.
  const draft = latestDraft?.draft as unknown as ChecklistDraft | null;
  const parties: PartyState[] = draft
    ? [
        partyState('importer', 'consignee', 'Importer', draft.importer),
        partyState('supplier', 'shipper', 'Supplier', draft.supplier),
      ]
    : [];
  // The documents branch still owns the job until the checklist arrives, and
  // owns it again while a revision is outstanding.
  const inDocumentsBranch = DOCUMENTS_STAGES.includes(job.stage);
  const inScrutiny = !inDocumentsBranch && job.stage !== 'closed';

  const [ccr, shipper, { data: requests }] = await Promise.all([
    inScrutiny ? suggestCcrs(job.id) : Promise.resolve(null),
    inScrutiny ? suggestShipper(job.id) : Promise.resolve(null),
    db
      .from('job_document_requests')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('job_id', job.id)
      .order('created_at'),
  ]);

  const sendBlockedReason = !shipper?.connection
    ? 'Connect your Outlook mailbox before sending.'
    : shipper.connection.status !== 'active'
      ? 'Your mailbox needs reconnecting.'
      : missingScopes(shipper.connection.scopes).includes('Mail.Send')
        ? 'Your mailbox was connected before sending was supported — reconnect to grant permission.'
        : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold">Documents ({(documents ?? []).length})</h2>
              {(documents ?? []).length > 0 && (
                <a
                  href={`/api/jobs/${job.id}/documents`}
                  className="text-xs text-slate-500 hover:text-slate-900 hover:underline"
                >
                  Download all
                </a>
              )}
            </div>
            {(documents ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(documents ?? []).map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <a
                        href={`/api/jobs/${job.id}/documents/${doc.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm font-medium text-indigo-600 hover:underline"
                      >
                        {doc.file_name}
                      </a>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {DOC_TYPE_LABELS[doc.doc_type]}
                        {doc.size_bytes ? ` · ${Math.round(Number(doc.size_bytes) / 1024)} kB` : ''}
                        {doc.source === 'upload' ? ' · uploaded' : ''}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {relativeTime(doc.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DocumentRequests
            jobId={job.id}
            requests={(requests ?? []).map((r) => {
              const settledBy = (documents ?? []).find((d) => d.id === r.received_document_id);
              return {
                id: r.id,
                name: r.name,
                reason: r.reason,
                ccrCode: r.ccr_code,
                status: r.status,
                documentId: settledBy?.id ?? null,
                documentName: settledBy?.file_name ?? null,
              };
            })}
          />

          {inScrutiny && shipper && (
            <ShipperRequest
              jobId={job.id}
              shippers={shipper.shippers.map((s) => ({ id: s.id, name: s.name, email: s.email }))}
              suggestedId={shipper.suggested?.id ?? null}
              defaultEmail={shipper.currentEmail ?? ''}
              draftSubject={shipper.draftSubject}
              draftBody={shipper.draftBody}
              outstanding={(requests ?? []).filter((r) => r.status === 'pending').length}
              canSend={sendBlockedReason === null}
              blockedReason={sendBlockedReason}
              alreadySent={job.stage === 'awaiting_shipper'}
            />
          )}

          {inScrutiny && job.stage !== 'noting' && (
            <CloseOut
              jobId={job.id}
              outstanding={(requests ?? []).filter((r) => r.status === 'pending').length}
              // Closing out without either an applied requirement or a
              // deliberate "none applies" means nobody assessed compliance.
              ccrsAssessed={(ccr?.applied.length ?? 0) > 0 || Boolean(ccr?.waived)}
              hasChecklist={hasChecklist}
              shipperEmail={job.shipper_email ?? shipper?.currentEmail ?? ''}
              canSend={sendBlockedReason === null}
            />
          )}

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">Timeline</h2>
            {(events ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {(events ?? []).map((event) => (
                  <li key={event.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm">{EVENT_LABELS[event.type] ?? event.type}</span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {relativeTime(event.created_at)}
                      </span>
                    </div>
                    <EventDetail payload={event.payload} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {inScrutiny && ccr && (
            <ScrutinyPanel
              jobId={job.id}
              hsCodes={ccr.hsCodes}
              suggestions={ccr.suggestions.map((c) => ({
                id: c.id,
                hsCode: c.hs_code,
                code: c.code,
                title: c.title,
                requirementText: c.requirement_text,
              }))}
              applied={ccr.applied.map((a) => ({
                code: a.code,
                title: a.title,
                applies: a.applies,
                note: a.assessment_note,
              }))}
              waived={ccr.waived}
              remarks={job.remarks}
            />
          )}

          {parties.length > 0 && <PartiesPanel jobId={job.id} parties={parties} />}

          {inDocumentsBranch && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">Export to Logi-Sys</h2>
              <p className="mb-4 text-xs text-slate-500">
                Upload it through <em>Import/Export Data &rarr; XLSX</em> in Logi-Sys (not the XML
                import, which only accepts Visual Impex files), then bring the resulting checklist
                PDF back here.
              </p>
              <LogisysExport
                jobId={job.id}
                hasDraft={Boolean(latestDraft)}
                draftVersion={latestDraft?.version ?? null}
                documentCount={(documents ?? []).length}
              />
              {(exports ?? []).length > 0 && (
                <p className="mt-3 text-xs text-slate-400">
                  Last exported {relativeTime(exports?.[0]?.created_at ?? null)} ·{' '}
                  {exports?.[0]?.template_version}
                </p>
              )}
            </section>
          )}

          {inDocumentsBranch && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">
                {job.stage === 'checklist_revision' ? 'Revised checklist' : 'Checklist PDF'}
              </h2>
              {job.stage === 'checklist_revision' && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Scrutiny has asked for a revision. Upload the updated checklist to send it back.
                </p>
              )}
              {hasChecklist && job.stage !== 'checklist_revision' && (
                <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  A checklist has been uploaded. Uploading again adds a new version.
                </p>
              )}
              <ChecklistUpload
                jobId={job.id}
                branches={branches ?? []}
                isRevision={job.stage === 'checklist_revision'}
                engineDuty={engineDuty}
                currentDuty={job.checklist_duty}
              />
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Identifiers</h2>
            {(identifiers ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">None extracted yet.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {(identifiers ?? []).map((identifier) => (
                  <div key={identifier.id} className="flex justify-between gap-3">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      {IDENTIFIER_LABELS[identifier.kind]}
                    </dt>
                    <dd className="truncate font-mono text-xs" title={identifier.value_raw}>
                      {identifier.kind === 'conversation' ? 'thread' : identifier.value_raw}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function EventDetail({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const bits: string[] = [];

  if (typeof p.subject === 'string') bits.push(`“${p.subject}”`);
  if (typeof p.from === 'string') bits.push(`from ${p.from}`);
  if (typeof p.documentsAdded === 'number') bits.push(`${p.documentsAdded} added`);
  if (typeof p.documentsDuplicate === 'number' && p.documentsDuplicate > 0) {
    bits.push(`${p.documentsDuplicate} already present`);
  }
  if (typeof p.matchScore === 'number') bits.push(`match score ${p.matchScore}`);
  if (typeof p.fileName === 'string') bits.push(p.fileName);
  if (typeof p.templateVersion === 'string') bits.push(p.templateVersion);

  if (bits.length === 0) return null;
  return <div className="mt-0.5 text-xs text-slate-500">{bits.join(' · ')}</div>;
}

/**
 * A draft party flattened for the panel. The draft holds a little more than
 * the panel shows (address lines, PAN); what is here is what tells two
 * repository rows of the same name apart.
 */
function partyState(
  slot: PartyState['slot'],
  role: PartyState['role'],
  label: string,
  party: ChecklistDraft['importer'] | ChecklistDraft['supplier'],
): PartyState {
  const adCode = 'adCode' in party ? party.adCode : undefined;
  return {
    slot,
    role,
    label,
    name: party.name,
    ...(party.branchName ? { branchName: party.branchName } : {}),
    ...(party.city ? { city: party.city } : {}),
    ...(party.iec ? { iec: party.iec } : {}),
    ...(party.gstin ? { gstin: party.gstin } : {}),
    ...(adCode ? { adCode } : {}),
    // A draft written before the repository existed has no status at all,
    // which is different from having been looked for and not found.
    ...(party.matchStatus ? { status: party.matchStatus } : {}),
  };
}
