import 'server-only';
import {
  filingStatusFrom,
  isUnderSec46,
  isUnderSec48,
  lookupCustomHouse,
  parseWarehouseCode,
  resolveIndianStation,
  transportModeForStation,
  type CustomHouseMaster,
} from '@checklist/core';
import {
  extractMailInstructions,
  NO_INSTRUCTIONS,
  type BoeFlags,
  type BoeHeader,
  type ChecklistDraft,
  type MailInstructions,
  type Resolved,
} from '@checklist/extraction';
import type { Database } from '@checklist/db';
import { organizationById } from '@/lib/parties';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * Resolving the Bill of Entry header — the GENERAL sheet.
 *
 * Thirteen of that sheet's twenty-three columns used to be constants in code.
 * Not because the model could not read them, but because what they state is not
 * on any document a customer sends: which custom house to file at, whether the
 * goods are warehoused, whether duty is deferred, whether an IGM exists yet.
 * Those facts live in the customer's mail, in the importer master, and in the
 * operator's own head.
 *
 * This is where the four sources meet, in one fixed order of precedence:
 *
 *     document  <  master  <  mail  <  operator
 *
 * Every value it produces carries the source that decided it, so the job screen
 * can show *why* a Bill of Entry says what it says, and so a column can never
 * again quietly become a default nobody chose.
 */

type BoeHeaderRow = Database['public']['Tables']['job_boe_header']['Row'];
type InstructionRow = Database['public']['Tables']['job_mail_instructions']['Row'];

const BE_TYPE_FROM_DB = {
  home_consumption: 'Home Consumption',
  warehousing: 'Warehousing',
  ex_bond: 'Ex-Bond',
} as const;

const FILING_FROM_DB = { advance: 'Advance', prior: 'Prior', normal: 'Normal' } as const;
const MODE_FROM_DB = { sea: 'Sea', air: 'Air', land: 'Land' } as const;

function resolved<T>(value: T, source: Resolved<T>['source'], because?: string, quote?: string): Resolved<T> {
  return { value, source, ...(because ? { because } : {}), ...(quote ? { quote } : {}) };
}

function stationValue(station: CustomHouseMaster) {
  return { code: station.code, name: station.name };
}

/**
 * Read the job's instruction thread.
 *
 * Cached in `job_mail_instructions` and re-read only when the thread has grown,
 * because this is a model call and a job's mail is re-read on every draft
 * rebuild. A thread with no bodies stored — every job created before mail
 * bodies were captured — resolves to "no instructions" without a model call.
 */
export async function readMailInstructions(
  jobId: string,
  companyId: string,
): Promise<{ instructions: MailInstructions; station?: CustomHouseMaster }> {
  const db = serviceClient();

  const { data: messages } = await db
    .from('mail_messages')
    .select('subject, from_address, received_at, body_text')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .order('received_at', { ascending: true });

  const withBodies = (messages ?? []).filter((m) => m.body_text?.trim());

  const { data: cached } = await db
    .from('job_mail_instructions')
    .select('*')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (cached && cached.message_count === withBodies.length) {
    return fromRow(cached as InstructionRow);
  }

  if (withBodies.length === 0) return { instructions: NO_INSTRUCTIONS };

  const instructions = await extractMailInstructions(
    withBodies.map((m) => ({
      from: m.from_address,
      receivedAt: m.received_at,
      subject: m.subject,
      body: m.body_text as string,
    })),
  );

  // The model returns the custom house as the mail spells it. Coding it is the
  // master's job, never the model's — "Nhava Sheva" becomes INNSA1 here or not
  // at all.
  const station = instructions.customsHouse
    ? resolveIndianStation(instructions.customsHouse)
    : undefined;

  await db.from('job_mail_instructions').upsert(
    {
      job_id: jobId,
      company_id: companyId,
      customs_house: instructions.customsHouse,
      customs_house_quote: instructions.customsHouseQuote,
      customs_house_code: station?.code ?? null,
      be_type: instructions.beType,
      be_type_quote: instructions.beTypeQuote,
      deferred_duty: instructions.deferredDuty,
      deferred_duty_quote: instructions.deferredDutyQuote,
      importer_ref_no: instructions.importerRefNo,
      importer_ref_quote: instructions.importerRefQuote,
      branch_name: instructions.branchName,
      branch_quote: instructions.branchQuote,
      warehouse: instructions.warehouse,
      warehouse_quote: instructions.warehouseQuote,
      // The model gives the warehouse as the mail spells it; coding it is the
      // parser's job, exactly as it is for the custom house.
      warehouse_code: instructions.warehouse
        ? (parseWarehouseCode(instructions.warehouse)?.code ?? null)
        : null,
      inbond_be_no: instructions.inBondBeNo,
      inbond_be_quote: instructions.inBondBeQuote,
      bond_no: instructions.bondNo,
      bond_quote: instructions.bondQuote,
      end_use: instructions.endUse,
      end_use_quote: instructions.endUseQuote,
      claim_fta_benefit: instructions.claimFtaBenefit,
      claim_fta_benefit_quote: instructions.claimFtaBenefitQuote,
      other_instructions: instructions.otherInstructions,
      message_count: withBodies.length,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' },
  );

  return { instructions, ...(station ? { station } : {}) };
}

function fromRow(row: InstructionRow): { instructions: MailInstructions; station?: CustomHouseMaster } {
  const instructions: MailInstructions = {
    customsHouse: row.customs_house,
    customsHouseQuote: row.customs_house_quote,
    beType: row.be_type,
    beTypeQuote: row.be_type_quote,
    deferredDuty: row.deferred_duty,
    deferredDutyQuote: row.deferred_duty_quote,
    importerRefNo: row.importer_ref_no,
    importerRefQuote: row.importer_ref_quote,
    branchName: row.branch_name,
    branchQuote: row.branch_quote,
    warehouse: row.warehouse,
    warehouseQuote: row.warehouse_quote,
    inBondBeNo: row.inbond_be_no,
    inBondBeQuote: row.inbond_be_quote,
    bondNo: row.bond_no,
    bondQuote: row.bond_quote,
    endUse: row.end_use,
    endUseQuote: row.end_use_quote,
    claimFtaBenefit: row.claim_fta_benefit,
    claimFtaBenefitQuote: row.claim_fta_benefit_quote,
    otherInstructions: row.other_instructions ?? [],
  };
  const station = row.customs_house_code ? lookupCustomHouse(row.customs_house_code) : undefined;
  return { instructions, ...(station ? { station } : {}) };
}

/** The operator's row for a job, if they have touched the header at all. */
async function boeHeaderRow(jobId: string, companyId: string): Promise<BoeHeaderRow | null> {
  const db = serviceClient();
  const { data } = await db
    .from('job_boe_header')
    .select('*')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Fill `draft.boe` from the masters, the mail and the operator.
 *
 * Runs after `applyPartyResolution`, because the importer's AEO status, AD
 * codes and reference policy all come off the organization row that step binds.
 */
export async function applyGeneralResolution(
  draft: ChecklistDraft,
  companyId: string,
  jobId: string,
): Promise<ChecklistDraft> {
  const [{ instructions, station: mailStation }, row] = await Promise.all([
    readMailInstructions(jobId, companyId),
    boeHeaderRow(jobId, companyId),
  ]);

  const org = draft.importer.organizationId
    ? await organizationById(companyId, draft.importer.organizationId)
    : null;

  const flags: ChecklistDraft['flags'] = draft.flags.filter((f) => !f.path?.startsWith('boe.'));
  const warn = (path: string, message: string) =>
    flags.push({ severity: 'warning', path: `boe.${path}`, message });
  const info = (path: string, message: string) =>
    flags.push({ severity: 'info', path: `boe.${path}`, message });

  // ---------------------------------------------------- custom house ----
  //
  // The mail is the authority. The importer's standing default is the fallback
  // for a thread that says nothing, and the operator overrides both.
  let customStation: BoeHeader['customStation'];
  if (row?.customs_house_code) {
    const station = lookupCustomHouse(row.customs_house_code);
    if (station) customStation = resolved(stationValue(station), 'operator', 'Chosen on the job');
  }
  if (!customStation && mailStation) {
    customStation = resolved(
      stationValue(mailStation),
      'mail',
      'Named in the customer’s instructions',
      instructions.customsHouseQuote ?? undefined,
    );
  }
  if (!customStation && instructions.customsHouse && !mailStation) {
    warn(
      'customStation',
      `The instruction mail names "${instructions.customsHouse}" as the custom house, but that did not ` +
        'match any ICEGATE station. Pick the station on the job.',
    );
  }
  if (!customStation && org?.default_custom_house) {
    const station = lookupCustomHouse(org.default_custom_house);
    if (station) {
      customStation = resolved(
        stationValue(station),
        'master',
        `${org.name}’s default custom house`,
      );
    }
  }
  if (!customStation) {
    warn(
      'customStation',
      'No custom house: the instruction mail does not name one and the importer has no default. ' +
        'The Bill of Entry cannot be filed without it — set it on the job.',
    );
  }

  // ---------------------------------------------------- transport mode ----
  //
  // The station the BE is filed at settles it whenever we have one: a sea
  // consignment filed at an ICD is L. Falling back to what the merge read off
  // the transport document when we do not.
  let transportMode: Resolved<'Air' | 'Sea' | 'Land'>;
  if (row?.transport_mode) {
    transportMode = resolved(MODE_FROM_DB[row.transport_mode], 'operator', 'Chosen on the job');
  } else if (customStation) {
    const byStation = transportModeForStation(customStation.value.code);
    const asMode = byStation === 'L' ? 'Land' : byStation === 'A' ? 'Air' : 'Sea';
    // An air waybill against a sea station is a contradiction worth naming
    // rather than silently resolving in the station's favour.
    if (draft.transportMode === 'Air' && byStation === 'S') {
      warn(
        'transportMode',
        `This job has an air waybill but is filed at ${customStation.value.name}, a sea station. ` +
          'One of the two is wrong.',
      );
    }
    transportMode = resolved(
      draft.transportMode === 'Air' && byStation !== 'L' ? 'Air' : asMode,
      'master',
      `${customStation.value.name} is ${byStation === 'L' ? 'an inland' : byStation === 'A' ? 'an air' : 'a sea'} station`,
    );
  } else {
    transportMode = resolved(draft.transportMode, 'document', 'From the transport document');
  }

  // ---------------------------------------------------------- BE type ----
  let beType: Resolved<'Home Consumption' | 'Warehousing' | 'Ex-Bond'>;
  if (row?.be_type) {
    beType = resolved(BE_TYPE_FROM_DB[row.be_type], 'operator', 'Chosen on the job');
  } else if (instructions.beType) {
    beType = resolved(
      BE_TYPE_FROM_DB[instructions.beType],
      'mail',
      'From the customer’s instructions',
      instructions.beTypeQuote ?? undefined,
    );
  } else {
    beType = resolved('Home Consumption', 'default', 'Nothing in the thread asks for bonding');
  }

  // --------------------------------------------- duty payment status ----
  //
  // Deferred payment is open only to AEO T2 and T3 importers, so the tier and
  // the instruction are checked together. Silence is not consent: an AEO
  // importer still files T unless someone asks for D.
  const aeoTier = org?.aeo_status ?? 'none';
  const aeoValid =
    !org?.aeo_valid_till || org.aeo_valid_till >= new Date().toISOString().slice(0, 10);
  const aeoQualifies = (aeoTier === 'T2' || aeoTier === 'T3') && aeoValid;

  let dutyPaymentStatus: Resolved<'T' | 'D'>;
  if (row?.duty_payment_status) {
    dutyPaymentStatus = resolved(
      row.duty_payment_status as 'T' | 'D',
      'operator',
      'Chosen on the job',
    );
  } else if (instructions.deferredDuty === true) {
    if (aeoQualifies) {
      dutyPaymentStatus = resolved(
        'D',
        'mail',
        `Requested, and ${org?.name ?? 'the importer'} is AEO ${aeoTier}`,
        instructions.deferredDutyQuote ?? undefined,
      );
    } else {
      dutyPaymentStatus = resolved('T', 'default', 'Deferred requested but not available');
      warn(
        'dutyPaymentStatus',
        'The instruction mail asks for deferred duty, but ' +
          (aeoTier === 'none'
            ? `${org?.name ?? 'this importer'} has no AEO status recorded. `
            : !aeoValid
              ? `${org?.name ?? 'this importer'}’s AEO certificate expired on ${org?.aeo_valid_till}. `
              : `AEO ${aeoTier} does not qualify — deferred payment needs T2 or T3. `) +
          'Filed as T until the AEO status on the importer says otherwise.',
      );
    }
  } else {
    dutyPaymentStatus = resolved('T', 'default', 'Duty paid per transaction');
    if (aeoQualifies && instructions.deferredDuty !== false) {
      info(
        'dutyPaymentStatus',
        `${org?.name ?? 'This importer'} is AEO ${aeoTier} and could file deferred (D). ` +
          'The thread does not ask for it, so this is T — change it on the job if they want deferred.',
      );
    }
  }

  // ------------------------------------------------------ filing status ----
  const timing = {
    ...(row?.igm_no ? { igmNo: row.igm_no } : draft.shipment.igmNo ? { igmNo: draft.shipment.igmNo } : {}),
    ...(row?.inward_date
      ? { inwardDate: row.inward_date }
      : draft.shipment.inwardDate
        ? { inwardDate: draft.shipment.inwardDate }
        : {}),
    ...(row?.be_filing_date ? { beFilingDate: row.be_filing_date } : {}),
    igmChecked: row?.igm_checked ?? false,
  };

  let filingStatus: BoeHeader['filingStatus'];
  if (row?.filing_status) {
    filingStatus = resolved(FILING_FROM_DB[row.filing_status], 'operator', 'Chosen on the job');
  } else {
    const derived = filingStatusFrom(timing);
    if (derived) {
      filingStatus = resolved(
        derived,
        'operator',
        derived === 'Advance'
          ? 'No IGM filed against this BL'
          : derived === 'Prior'
            ? 'IGM filed, entry inwards not yet granted'
            : 'IGM filed and entry inwards granted',
      );
    } else {
      warn(
        'filingStatus',
        'Advance, Prior or Normal cannot be decided: nobody has checked ICEGATE for an IGM against ' +
          'this BL. Key the IGM number and the entry-inwards date on the job.',
      );
    }
  }

  // ----------------------------------------------------------- AD code ----
  const extraAdCodes = org ? await adCodesFor(companyId, org.id) : [];
  const allAdCodes = [
    ...(org?.ad_code ? [{ adCode: org.ad_code, bankName: undefined as string | undefined }] : []),
    ...extraAdCodes.filter((c) => c.adCode !== org?.ad_code),
  ];

  let adCode: BoeHeader['adCode'];
  if (row?.ad_code) {
    adCode = resolved(row.ad_code, 'operator', 'Chosen on the job');
  } else if (allAdCodes.length === 1 && allAdCodes[0]) {
    adCode = resolved(allAdCodes[0].adCode, 'master', `${org?.name ?? 'The importer'}’s AD code`);
  } else if (allAdCodes.length > 1) {
    warn(
      'adCode',
      `${org?.name ?? 'This importer'} banks through ${allAdCodes.length} AD codes ` +
        `(${allAdCodes.map((c) => c.adCode).join(', ')}). Pick the one this shipment is remitted against.`,
    );
  } else {
    warn('adCode', 'No AD code on the importer — Logi-Sys needs it to file.');
  }

  // ---------------------------------------------------- importer ref ----
  let importerRefNo: BoeHeader['importerRefNo'];
  if (row?.importer_ref_no) {
    importerRefNo = resolved(row.importer_ref_no, 'operator', 'Entered on the job');
  } else if (instructions.importerRefNo) {
    importerRefNo = resolved(
      instructions.importerRefNo,
      'mail',
      'The reference the customer asked us to quote',
      instructions.importerRefQuote ?? undefined,
    );
  } else if (org?.importer_ref_required) {
    warn(
      'importerRefNo',
      `${org.name} wants their own reference on the Bill of Entry, and the instruction thread does ` +
        'not give one. Ask them, or enter it on the job.',
    );
  }

  // ------------------------------------------------------------ flags ----
  const derivedSec46 = isUnderSec46(timing);
  const derivedSec48 = isUnderSec48(timing);

  const boeFlags: BoeFlags = {
    ...(row?.is_first_check != null ? { firstCheck: row.is_first_check } : {}),
    ...(row?.is_green_channel != null ? { greenChannel: row.is_green_channel } : {}),
    ...(row?.is_kachcha_be != null ? { kachchaBe: row.is_kachcha_be } : {}),
    ...(row?.is_hss != null ? { hss: row.is_hss } : {}),
    ...(row?.is_bonds_certificates != null
      ? { bondsCertificates: row.is_bonds_certificates }
      : {}),
    ...(row?.is_transhipment != null ? { transhipment: row.is_transhipment } : {}),
    ...(row?.itc_lic_details != null ? { itcLicDetails: row.itc_lic_details } : {}),
    ...(row?.is_under_provisional_assessment != null
      ? { provisionalAssessment: row.is_under_provisional_assessment }
      : {}),
    ...(row?.is_under_sec46 != null
      ? { underSec46: row.is_under_sec46 }
      : derivedSec46 != null
        ? { underSec46: derivedSec46 }
        : {}),
    ...(row?.is_under_sec48 != null
      ? { underSec48: row.is_under_sec48 }
      : derivedSec48 != null
        ? { underSec48: derivedSec48 }
        : {}),
    ...(row?.sec46_override_reason ? { sec46OverrideReason: row.sec46_override_reason } : {}),
  };

  if (derivedSec46 && row?.is_under_sec46 == null) {
    info(
      'flags.underSec46',
      `The Bill of Entry is being filed after entry inwards (${timing.inwardDate} → ` +
        `${timing.beFilingDate}), so it is flagged under Section 46(3) — late presentation charges apply ` +
        'unless waived. Customs holidays are not in this calculation; clear the flag with a reason if it is wrong.',
    );
  }
  if (timing.inwardDate && !timing.beFilingDate) {
    warn(
      'flags.underSec46',
      'Sections 46 and 48 need the date the Bill of Entry is presented. Key the filing date on the job.',
    );
  }

  // Suggestions the operator accepts or rejects — never applied on their own.
  if (boeFlags.hss == null && draft.ftaClaim === undefined && draft.supportingDocs.some((d) => /hss|high\s*seas/i.test(d.fileName))) {
    info('flags.hss', 'A high-seas-sale document is attached — tick IsHSS if this is an HSS consignment.');
  }

  // W and EX both make the INBOND_EXBOND sheet mandatory. It is mapped now, and
  // applyInbondExbondResolution — which runs straight after this — is what
  // fills it and reports what it is missing. Nothing to say here.

  const boe: BoeHeader = {
    transportMode,
    customStation,
    beType,
    dutyPaymentStatus,
    filingStatus,
    adCode,
    importerRefNo,
    ...(allAdCodes.length > 1 ? { adCodeChoices: allAdCodes } : {}),
    flags: boeFlags,
  };

  return {
    ...draft,
    // The top-level fields stay in step with the resolved header: the checklist
    // HTML and the SHIPMENT mapper read them.
    transportMode: transportMode.value,
    beType: beType.value,
    ...(customStation ? { customStation: customStation.value } : {}),
    ...(filingStatus ? { filingStatus: filingStatus.value } : {}),
    shipment: {
      ...draft.shipment,
      ...(timing.igmNo ? { igmNo: timing.igmNo } : {}),
      ...(row?.igm_date ? { igmDate: row.igm_date } : {}),
      ...(timing.inwardDate ? { inwardDate: timing.inwardDate } : {}),
      ...(timing.beFilingDate ? { beFilingDate: timing.beFilingDate } : {}),
      igmChecked: timing.igmChecked,
      // The rest of the ICEGATE block. Nothing the customer sends states these,
      // so the job screen is their only source — see docs/boe-mapping/03-shipment.md.
      ...(row?.line_no ? { lineNo: row.line_no } : {}),
      ...(row?.gateway_igm_no ? { gatewayIgmNo: row.gateway_igm_no } : {}),
      ...(row?.gateway_igm_date ? { gatewayIgmDate: row.gateway_igm_date } : {}),
      ...(row?.gateway_inward_date ? { gatewayInwardDate: row.gateway_inward_date } : {}),
      // The two operator overrides. `document < master < mail < operator`: a
      // person's choice here is not undone by a re-read of the documents, which
      // is why they are applied last and unconditionally.
      ...(row?.package_unit_code ? { packageUnit: row.package_unit_code } : {}),
      ...(row?.marks_and_nos
        ? { marksAndNos: row.marks_and_nos, marksAndNosFromOperator: true }
        : {}),
    },
    importer: {
      ...draft.importer,
      ...(adCode ? { adCode: adCode.value } : {}),
    },
    boe,
    flags,
  };
}

/** The importer's alternative AD codes. */
async function adCodesFor(
  companyId: string,
  organizationId: string,
): Promise<{ adCode: string; bankName?: string }[]> {
  const db = serviceClient();
  const { data } = await db
    .from('organization_ad_codes')
    .select('ad_code, bank_name')
    .eq('company_id', companyId)
    .eq('organization_id', organizationId)
    .order('is_default', { ascending: false });
  return (data ?? []).map((r) => ({
    adCode: r.ad_code,
    ...(r.bank_name ? { bankName: r.bank_name } : {}),
  }));
}
