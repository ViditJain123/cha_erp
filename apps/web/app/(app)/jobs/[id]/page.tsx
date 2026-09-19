import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ChecklistDraft } from '@checklist/extraction';
import { missingScopes } from '@checklist/graph';
import { requireCompany } from '@/lib/auth';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { serviceClient } from '@/lib/supabase/admin';
import {
  DOCUMENTS_STAGES,
  DOC_TYPE_LABELS,
  EVENT_LABELS,
  IDENTIFIER_LABELS,
  relativeTime,
} from '@/lib/jobs';
import { BeHeaderPanel } from './be-header-panel';
import { BondPanel } from './bond-panel';
import { ContainersPanel } from './containers-panel';
import { EsanchitReference } from './esanchit-reference';
import { SecuritiesPanel } from './securities-panel';
import { ItemsPanel } from './items-panel';
import { BOND_CODES, CERTIFICATE_TYPES, END_USE_CODES, EXIM_SCHEME } from '@checklist/core';
import { ftaBenefitQuestion, itemRowView } from '@/lib/items';
import { ChecklistUpload } from './checklist-upload';
import { DeleteJob } from './delete-job';
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
    { data: beHeader },
    { data: operatorContainers },
    { data: firstMail },
    { data: hssChainRows },
    { data: securityRows },
    { data: esanchitRows },
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
    // What the operator has decided about the Bill of Entry header. Read
    // separately from the draft because the form has to round-trip their
    // entries even before there is a draft to resolve them into.
    db
      .from('job_boe_header')
      .select('*')
      .eq('job_id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle(),
    // The operator's own container list, read separately from the draft for the
    // same reason as the header: the panel has to show what was typed even
    // before there is a draft to resolve it into.
    db
      .from('job_containers')
      .select('*')
      .eq('job_id', id)
      .eq('company_id', ctx.companyId)
      .order('sr_no'),
    // Who sent the job in: the importer to ask about an unclaimed preferential rate.
    db
      .from('mail_messages')
      .select('from_address')
      .eq('job_id', id)
      .eq('company_id', ctx.companyId)
      .order('received_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // The three operator-held sheet sources, read for the same reason as the
    // header: the panel must show what was typed even before there is a draft.
    db
      .from('job_hss_chain')
      .select('*')
      .eq('job_id', id)
      .eq('company_id', ctx.companyId)
      .order('level'),
    db
      .from('job_bonds_certificates')
      .select('*')
      .eq('job_id', id)
      .eq('company_id', ctx.companyId)
      .order('seq'),
    db
      .from('job_document_esanchit')
      .select('*')
      .eq('job_id', id)
      .eq('company_id', ctx.companyId),
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
                      {/* SUPPORTING_DOCS references a document by the number
                          eSanchit issued for it, so a document with no IRN is
                          left off the workbook and warned about instead. */}
                      <div className="mt-0.5">
                        {(() => {
                          const ref = (esanchitRows ?? []).find((e) => e.document_id === doc.id);
                          return (
                            <EsanchitReference
                              jobId={job.id}
                              documentId={doc.id}
                              irn={ref?.irn ?? ''}
                              uploadedAt={ref?.uploaded_at?.slice(0, 16) ?? ''}
                              referenceNo={ref?.reference_no ?? ''}
                            />
                          );
                        })()}
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

          <BeHeaderPanel
            jobId={job.id}
            header={draft?.boe ?? null}
            entries={{
              igmNo: beHeader?.igm_no ?? '',
              igmDate: beHeader?.igm_date ?? '',
              inwardDate: beHeader?.inward_date ?? '',
              beFilingDate: beHeader?.be_filing_date ?? '',
              igmChecked: beHeader?.igm_checked ?? false,
              lineNo: beHeader?.line_no ?? '',
              gatewayIgmNo: beHeader?.gateway_igm_no ?? '',
              gatewayIgmDate: beHeader?.gateway_igm_date ?? '',
              gatewayInwardDate: beHeader?.gateway_inward_date ?? '',
              packageUnitCode: beHeader?.package_unit_code ?? '',
              marksAndNos: beHeader?.marks_and_nos ?? '',
              customsHouseCode: beHeader?.customs_house_code ?? '',
              beType: beHeader?.be_type ?? '',
              dutyPaymentStatus: beHeader?.duty_payment_status ?? '',
              adCode: beHeader?.ad_code ?? '',
              importerRefNo: beHeader?.importer_ref_no ?? '',
              sec46OverrideReason: beHeader?.sec46_override_reason ?? '',
              flags: {
                firstCheck: beHeader?.is_first_check ?? false,
                greenChannel: beHeader?.is_green_channel ?? false,
                kachchaBe: beHeader?.is_kachcha_be ?? false,
                hss: beHeader?.is_hss ?? false,
                bondsCertificates: beHeader?.is_bonds_certificates ?? false,
                transhipment: beHeader?.is_transhipment ?? false,
                itcLicDetails: beHeader?.itc_lic_details ?? false,
                provisionalAssessment: beHeader?.is_under_provisional_assessment ?? false,
              },
            }}
          />

          <ContainersPanel
            jobId={job.id}
            fromOperator={(operatorContainers ?? []).length > 0}
            containers={
              (operatorContainers ?? []).length > 0
                ? (operatorContainers ?? []).map((c) => ({
                    containerNo: c.container_no,
                    sealNo: c.seal_no ?? '',
                    sizeType: c.size_type ?? '',
                  }))
                : (draft?.shipment.containers ?? []).map((c) => ({
                    containerNo: c.number,
                    sealNo: c.sealNo ?? '',
                    sizeType: c.sizeType ?? '',
                  }))
            }
            {...(draft?.shipment.containerCountStated !== undefined
              ? { statedCount: draft.shipment.containerCountStated }
              : {})}
          />

          {draft && (
            <ItemsPanel
              jobId={job.id}
              items={draft.items.map((_, i) => itemRowView(draft, i))}
              endUseCodes={Object.entries(END_USE_CODES).map(([code, label]) => ({ code, label }))}
              eximSchemes={Object.entries(EXIM_SCHEME).map(([code, label]) => ({ code, label }))}
              {...(() => {
                const q = ftaBenefitQuestion(draft, job.job_number ?? null);
                return q ? { ftaQuestion: { ...q, to: firstMail?.from_address ?? '' } } : {};
              })()}
            />
          )}

          {/* Only for a bonded filing: a home-consumption BE has no warehouse. */}
          {draft?.boe && draft.boe.beType.value !== 'Home Consumption' && (
            <BondPanel
              jobId={job.id}
              beType={draft.boe.beType.value}
              block={draft.inbondExbond ?? null}
              packing={draft.items
                .filter((i) => i.packing)
                .map((i) => ({
                  slNo: i.slNo,
                  description: i.description,
                  packages: i.packing!.packages,
                  ...(i.packing!.packageType ? { packageType: i.packing!.packageType } : {}),
                  ...(i.packing!.perPackageGrossKg !== undefined
                    ? { perPackageGrossKg: i.packing!.perPackageGrossKg }
                    : {}),
                }))}
              entries={{
                warehouseCode: beHeader?.warehouse_code ?? '',
                inbondBeNo: beHeader?.inbond_be_no ?? '',
                inbondBeDate: beHeader?.inbond_be_date ?? '',
                bondNo: beHeader?.bond_no ?? '',
                bondDate: beHeader?.bond_date ?? '',
                bondExpiryDate: beHeader?.bond_expiry_date ?? '',
                isWarehouseSale: beHeader?.is_warehouse_sale ?? false,
                isSec65ManufacturingWh:
                  beHeader?.is_sec65_manufacturing_wh ??
                  draft.inbondExbond?.isSec65ManufacturingWh ??
                  false,
                exbondClearanceKind: beHeader?.exbond_clearance_kind ?? '',
                releasedPackages: beHeader?.released_packages?.toString() ?? '',
                releasedPackageCode: beHeader?.released_package_code ?? '',
                releasedGrossWeightKg: beHeader?.released_gross_weight_kg?.toString() ?? '',
                releasedUom: beHeader?.released_uom ?? '',
              }}
              // Off the resolved draft rather than the table, so a re-read that
              // proposed them from a GST invoice shows up here too.
              finishedGoods={(draft.inbondExbond?.sec65FinishedGoods?.value ?? []).map((g) => ({
                gstInvoiceNo: g.gstInvoiceNo,
                gstInvoiceDate: g.gstInvoiceDate,
                cth: g.cth,
                description: g.description,
                quantity: String(g.quantity),
                uqc: g.uqc,
                itemSrNos: g.itemSrNos?.join(', ') ?? '',
              }))}
              itemSrNos={draft.items.map((i) => i.slNo)}
            />
          )}

          <SecuritiesPanel
            jobId={job.id}
            isHss={beHeader?.is_hss ?? draft?.boe?.flags?.hss ?? false}
            chain={(hssChainRows ?? []).map((p) => ({
              iec: p.iec,
              branchSrNo: p.branch_sr_no?.toString() ?? '',
              name: p.name ?? '',
              branchName: p.branch_name ?? '',
              adCode: p.ad_code ?? '',
              address: p.address ?? '',
              city: p.city ?? '',
              country: p.country ?? '',
              postalCode: p.postal_code ?? '',
            }))}
            // Off the resolved draft where the operator has keyed nothing, so a
            // warehouse bond the INBOND_EXBOND block already holds shows here
            // too — marked as proposed, because it has not been confirmed.
            securities={
              (securityRows ?? []).length > 0
                ? (securityRows ?? []).map((b) => ({
                    kind: b.kind,
                    type: b.type,
                    number: b.number,
                    date: b.cert_date ?? '',
                    commissionerate: b.commissionerate ?? '',
                    division: b.division ?? '',
                    range: b.range_office ?? '',
                    registrationPort: b.registration_port ?? '',
                    proposed: b.proposed,
                  }))
                : (draft?.bonds ?? []).map((b) => ({
                    kind: b.kind,
                    type: b.type,
                    number: b.number,
                    date: b.date ?? '',
                    commissionerate: b.commissionerate ?? '',
                    division: b.division ?? '',
                    range: b.range ?? '',
                    registrationPort: b.registrationPortCode ?? '',
                    proposed: b.proposed ?? false,
                  }))
            }
            bondCodes={Object.entries(BOND_CODES).map(([code, label]) => ({ code, label }))}
            certificateTypes={Object.entries(CERTIFICATE_TYPES).map(([code, label]) => ({
              code,
              label,
            }))}
          />

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

          {/* Owners and admins only, and last on the page: it is the one action
              here that cannot be undone. The API re-checks the role. */}
          {COMPANY_MANAGER_ROLES.includes(ctx.role) && (
            <DeleteJob
              jobId={job.id}
              // A job opened by hand may have neither a number nor a title; the
              // id is always there and is on screen in the address bar.
              label={job.job_number ?? job.title ?? job.id}
              counts={{
                documents: (documents ?? []).length,
                drafts: latestDraft?.version ?? 0,
                exports: (exports ?? []).length,
              }}
            />
          )}
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
