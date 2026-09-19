'use server';

import { revalidatePath } from 'next/cache';
import {
  END_USE_CODES,
  describeWarehouseCodeError,
  parseWarehouseCodeResult,
} from '@checklist/core';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import type { AppRole, TeamKind } from '@checklist/db';
import { partyNameKey } from '@checklist/core';
import { requireCompany, requireCompanyManager } from '@/lib/auth';
import { searchOrganizations } from '@/lib/parties';
import { serviceClient } from '@/lib/supabase/admin';
import { provisionUser } from '@/lib/provision';
import { parseCcrCsv } from '@/lib/ccr-csv';

export interface SettingsActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  tempPassword?: string;
  /**
   * Repository names a typed party could have meant.
   *
   * A relationship is keyed on two organizations, so binding the wrong one
   * would put an SVB order against a party that has none. When a typed name
   * does not resolve to exactly one row, the action hands back what it found
   * instead of choosing.
   */
  candidates?: { field: string; names: string[] };
}

const INVITABLE_ROLES: readonly AppRole[] = ['company_admin', 'member'];
const TEAM_KINDS: readonly TeamKind[] = ['scrutiny', 'do', 'customs', 'cfs', 'customer_support'];

export async function updateCompany(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Enter the company name.' };

  // Scoped by id as well as by RLS — the service role bypasses policies.
  const { error } = await serviceClient()
    .from('companies')
    .update({ name })
    .eq('id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/company');
  revalidatePath('/');
  return { ok: true, message: 'Company details saved.' };
}

export async function inviteMember(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const role = String(formData.get('role') ?? 'member') as AppRole;
  const teamRaw = String(formData.get('team') ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (!INVITABLE_ROLES.includes(role)) return { error: 'Choose a valid role.' };
  // Only an owner may mint another admin; admins can add members only.
  if (role === 'company_admin' && ctx.role !== 'company_owner') {
    return { error: 'Only the owner can add administrators.' };
  }
  const team = TEAM_KINDS.includes(teamRaw as TeamKind) ? (teamRaw as TeamKind) : null;
  if (!team) return { error: 'Choose a team.' };

  const db = serviceClient();
  const { data: company } = await db
    .from('companies')
    .select('name')
    .eq('id', ctx.companyId)
    .single();

  try {
    const result = await provisionUser({
      email,
      fullName: fullName || null,
      companyId: ctx.companyId,
      companyName: company?.name ?? 'your company',
      role: role as Exclude<AppRole, 'platform_admin'>,
      team,
      invitedBy: { id: ctx.userId, name: ctx.email },
    });

    revalidatePath('/settings/team');
    return {
      ok: true,
      message:
        result.emailTransport === 'console'
          ? `${email} added. No Resend key is configured, so the credentials were printed to the server console.`
          : `${email} added and sent their credentials.`,
      ...(result.emailTransport === 'console' ? { tempPassword: result.tempPassword } : {}),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add that person.' };
  }
}

export async function setMemberStatus(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const userId = String(formData.get('userId') ?? '');
  const status = String(formData.get('status') ?? '');

  if (status !== 'active' && status !== 'disabled') return { error: 'Unknown status.' };
  if (userId === ctx.userId) return { error: 'You cannot disable your own account.' };

  const db = serviceClient();
  const { data: target } = await db
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', userId)
    .maybeSingle();

  // Both checks matter: the service role would happily edit another tenant's row.
  if (!target || target.company_id !== ctx.companyId) return { error: 'No such team member.' };
  if (target.role === 'company_owner') return { error: 'The owner cannot be disabled here.' };

  const { error } = await db.from('profiles').update({ status }).eq('id', userId);
  if (error) return { error: error.message };

  revalidatePath('/settings/team');
  return { ok: true, message: status === 'disabled' ? 'Member disabled.' : 'Member re-enabled.' };
}

/**
 * Moves a member to another desk, and pins a CFS person to their station.
 *
 * Team was write-once at invite until now, which was survivable with two teams
 * and is not with five — the CFS queue is only useful if someone can be put on
 * it. A CFS member with no station sees an empty queue rather than everyone's,
 * so the station is required for that team and cleared for every other.
 */
export async function updateMemberTeam(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const db = serviceClient();

  const userId = String(formData.get('userId') ?? '');
  const teamRaw = String(formData.get('team') ?? '');
  const cfsId = String(formData.get('cfsId') ?? '').trim();

  const team = TEAM_KINDS.includes(teamRaw as TeamKind) ? (teamRaw as TeamKind) : null;
  if (!team) return { error: 'Choose a team.' };

  const { data: target } = await db
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', userId)
    .maybeSingle();
  // Both checks matter: the service role would happily edit another tenant's row.
  if (!target || target.company_id !== ctx.companyId) return { error: 'No such team member.' };
  if (target.role === 'company_owner') {
    return { error: 'The owner is not on a desk. Their access is not limited by team.' };
  }

  if (team === 'cfs' && !cfsId) return { error: 'Choose which CFS they work.' };
  if (cfsId) {
    const { data: cfs } = await db
      .from('cfs_master')
      .select('id')
      .eq('id', cfsId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (!cfs) return { error: 'No such CFS.' };
  }

  const { error } = await db
    .from('profiles')
    .update({ team, cfs_id: team === 'cfs' ? cfsId : null })
    .eq('id', userId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/team');
  return {
    ok: true,
    // The team is a JWT claim, stamped at login by custom_access_token_hook —
    // it does not change under a session that is already open.
    message: 'Team updated. They will see the change after signing in again.',
  };
}

/** Read model for the team page. */
export async function listTeam() {
  const ctx = await requireCompany();
  const db = serviceClient();
  const [{ data: members }, { data: cfs }] = await Promise.all([
    db
      .from('profiles')
      .select('*')
      .eq('company_id', ctx.companyId)
      .order('created_at', { ascending: true }),
    db
      .from('cfs_master')
      .select('id, name')
      .eq('company_id', ctx.companyId)
      .eq('is_active', true)
      .order('name'),
  ]);
  return { ctx, members: members ?? [], cfsOptions: cfs ?? [] };
}

// ---------------------------------------------------------------- branches --

export async function createBranch(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const name = String(formData.get('name') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  if (name.length < 2) return { error: 'Enter the branch name.' };

  const { error } = await serviceClient()
    .from('branches')
    .insert({ company_id: ctx.companyId, name, code: code || null });
  if (error) {
    return {
      error: error.code === '23505' ? `${name} already exists.` : error.message,
    };
  }

  revalidatePath('/settings/branches');
  return { ok: true, message: `${name} added.` };
}

export async function setBranchActive(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const branchId = String(formData.get('branchId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  // Scoped by company as well as id — the service role bypasses RLS.
  const { error } = await serviceClient()
    .from('branches')
    .update({ is_active: isActive })
    .eq('id', branchId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/branches');
  return { ok: true, message: isActive ? 'Branch re-enabled.' : 'Branch retired.' };
}

/** Read model for the branches page. */
export async function listBranches() {
  const ctx = await requireCompany();
  const { data } = await serviceClient()
    .from('branches')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('name');
  return { ctx, branches: data ?? [] };
}

// -------------------------------------------------------------- CCR master --

export async function importCcrs(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const text = String(formData.get('csv') ?? '');
  if (text.trim().length === 0) return { error: 'Paste the CSV first.' };

  const { rows, errors } = parseCcrCsv(text);
  if (rows.length === 0) {
    return { error: errors[0] ?? 'Nothing to import — check the format.' };
  }

  const { error } = await serviceClient()
    .from('ccr_master')
    .upsert(
      rows.map((r) => ({
        company_id: ctx.companyId,
        hs_code: r.hsCode,
        code: r.code,
        title: r.title,
        requirement_text: r.requirementText,
        is_active: true,
      })),
      { onConflict: 'company_id,hs_code,code' },
    );
  if (error) return { error: error.message };

  revalidatePath('/settings/ccr');
  const skipped = errors.length > 0 ? ` ${errors.length} line(s) skipped: ${errors[0]}` : '';
  return { ok: true, message: `Imported ${rows.length} requirement(s).${skipped}` };
}

export async function setCcrActive(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const ccrId = String(formData.get('ccrId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  const { error } = await serviceClient()
    .from('ccr_master')
    .update({ is_active: isActive })
    .eq('id', ccrId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/ccr');
  return { ok: true, message: isActive ? 'Requirement re-enabled.' : 'Requirement retired.' };
}

/** Read model for the CCR page. */
export async function listCcrs() {
  const ctx = await requireCompany();
  const { data } = await serviceClient()
    .from('ccr_master')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('hs_code')
    .order('code');
  return { ctx, ccrs: data ?? [] };
}

// --------------------------------------------------------------- shippers --

export async function createShipper(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const aliases = String(formData.get('aliases') ?? '')
    .split(/[\n,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);

  if (name.length < 2) return { error: 'Enter the shipper name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };

  const { error } = await serviceClient()
    .from('shippers')
    .upsert(
      { company_id: ctx.companyId, name, email, aliases, is_active: true },
      { onConflict: 'company_id,name' },
    );
  if (error) return { error: error.message };

  revalidatePath('/settings/shippers');
  return { ok: true, message: `${name} saved.` };
}

export async function setShipperActive(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const shipperId = String(formData.get('shipperId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  const { error } = await serviceClient()
    .from('shippers')
    .update({ is_active: isActive })
    .eq('id', shipperId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/shippers');
  return { ok: true, message: isActive ? 'Shipper re-enabled.' : 'Shipper retired.' };
}

/** Read model for the shippers page. */
export async function listShippers() {
  const ctx = await requireCompany();
  const { data } = await serviceClient()
    .from('shippers')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('name');
  return { ctx, shippers: data ?? [] };
}

// --------------------------------------------------------- shipping lines --

/** Splits the comma/newline separated alias fields the master forms use. */
function parseList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '')
    .split(/[\n,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Reads an optional number out of a form field. Returns `undefined` for "leave
 * it blank" and `null` for "not a number", so a typo cannot silently store 0 —
 * a free-day count of 0 and an unknown one mean very different things.
 */
function optionalNumber(raw: FormDataEntryValue | null): number | null | undefined {
  const text = String(raw ?? '').trim();
  if (text.length === 0) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export async function createShippingLine(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const name = String(formData.get('name') ?? '').trim();
  const agentName = String(formData.get('agentName') ?? '').trim();
  const doEmail = String(formData.get('doEmail') ?? '').trim().toLowerCase();
  const issuesDoVia = String(formData.get('issuesDoVia') ?? 'email');
  const aliases = parseList(formData.get('aliases'));
  const freeDays = optionalNumber(formData.get('defaultFreeDays'));

  if (name.length < 2) return { error: 'Enter the shipping line name.' };
  if (doEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(doEmail)) {
    return { error: 'Enter a valid DO email address, or leave it blank.' };
  }
  if (issuesDoVia !== 'email' && issuesDoVia !== 'odex') return { error: 'Choose how the DO is issued.' };
  if (freeDays === null || (freeDays !== undefined && (freeDays < 0 || !Number.isInteger(freeDays)))) {
    return { error: 'Free days must be a whole number of days.' };
  }

  const { error } = await serviceClient()
    .from('shipping_lines')
    .upsert(
      {
        company_id: ctx.companyId,
        name,
        aliases,
        agent_name: agentName || null,
        do_email: doEmail || null,
        issues_do_via: issuesDoVia,
        default_free_days: freeDays ?? null,
        is_active: true,
      },
      { onConflict: 'company_id,name' },
    );
  if (error) return { error: error.message };

  revalidatePath('/settings/shipping-lines');
  return { ok: true, message: `${name} saved.` };
}

export async function setShippingLineActive(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const lineId = String(formData.get('lineId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  const { error } = await serviceClient()
    .from('shipping_lines')
    .update({ is_active: isActive })
    .eq('id', lineId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/shipping-lines');
  return { ok: true, message: isActive ? 'Shipping line re-enabled.' : 'Shipping line retired.' };
}

/**
 * Adds or replaces one cell of a line's deposit matrix. An empty amount deletes
 * the rate rather than storing zero, which would read as "no deposit due".
 */
export async function saveDepositRate(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const db = serviceClient();

  const lineId = String(formData.get('lineId') ?? '');
  const deliveryMode = String(formData.get('deliveryMode') ?? '');
  const containerSize = String(formData.get('containerSize') ?? '').trim().toUpperCase();
  const amount = optionalNumber(formData.get('amount'));

  if (deliveryMode !== 'loaded' && deliveryMode !== 'destuffed') {
    return { error: 'Choose loaded or de-stuffed.' };
  }
  if (containerSize.length === 0) return { error: 'Enter a container size, or * for any.' };
  if (amount === null || (amount !== undefined && amount < 0)) {
    return { error: 'Enter a deposit amount, or leave it blank to remove the rate.' };
  }

  // The line is re-checked against the company: the service role would happily
  // hang a rate off another tenant's shipping line.
  const { data: line } = await db
    .from('shipping_lines')
    .select('id')
    .eq('id', lineId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!line) return { error: 'No such shipping line.' };

  if (amount === undefined) {
    const { error } = await db
      .from('shipping_line_deposit_rates')
      .delete()
      .eq('company_id', ctx.companyId)
      .eq('shipping_line_id', lineId)
      .eq('delivery_mode', deliveryMode)
      .eq('container_size', containerSize);
    if (error) return { error: error.message };

    revalidatePath('/settings/shipping-lines');
    return { ok: true, message: `Removed the ${deliveryMode} rate for ${containerSize}.` };
  }

  const { error } = await db.from('shipping_line_deposit_rates').upsert(
    {
      company_id: ctx.companyId,
      shipping_line_id: lineId,
      delivery_mode: deliveryMode,
      container_size: containerSize,
      amount,
    },
    { onConflict: 'shipping_line_id,delivery_mode,container_size' },
  );
  if (error) return { error: error.message };

  revalidatePath('/settings/shipping-lines');
  return { ok: true, message: `Saved the ${deliveryMode} rate for ${containerSize}.` };
}

/** Read model for the shipping lines page — lines with their deposit matrix. */
export async function listShippingLines() {
  const ctx = await requireCompany();
  const db = serviceClient();

  const [{ data: lines }, { data: rates }] = await Promise.all([
    db.from('shipping_lines').select('*').eq('company_id', ctx.companyId).order('name'),
    db
      .from('shipping_line_deposit_rates')
      .select('*')
      .eq('company_id', ctx.companyId)
      .order('container_size'),
  ]);

  return { ctx, lines: lines ?? [], rates: rates ?? [] };
}

// ------------------------------------------------------------------ CFS --

export async function createCfs(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const name = String(formData.get('name') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const port = String(formData.get('port') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim().toLowerCase();

  if (name.length < 2) return { error: 'Enter the CFS name.' };
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return { error: 'Enter a valid contact address, or leave it blank.' };
  }

  const { error } = await serviceClient()
    .from('cfs_master')
    .upsert(
      {
        company_id: ctx.companyId,
        name,
        code: code || null,
        port: port || null,
        contact_email: contactEmail || null,
        is_active: true,
      },
      { onConflict: 'company_id,name' },
    );
  if (error) return { error: error.message };

  revalidatePath('/settings/cfs');
  revalidatePath('/settings/team');
  return { ok: true, message: `${name} saved.` };
}

export async function setCfsActive(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const cfsId = String(formData.get('cfsId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  const { error } = await serviceClient()
    .from('cfs_master')
    .update({ is_active: isActive })
    .eq('id', cfsId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/cfs');
  return { ok: true, message: isActive ? 'CFS re-enabled.' : 'CFS retired.' };
}

/** Read model for the CFS page, with a head count per station. */
export async function listCfs() {
  const ctx = await requireCompany();
  const db = serviceClient();
  const [{ data: stations }, { data: staff }] = await Promise.all([
    db.from('cfs_master').select('*').eq('company_id', ctx.companyId).order('name'),
    db
      .from('profiles')
      .select('cfs_id')
      .eq('company_id', ctx.companyId)
      .not('cfs_id', 'is', null),
  ]);

  const staffCount = new Map<string, number>();
  for (const row of staff ?? []) {
    if (row.cfs_id) staffCount.set(row.cfs_id, (staffCount.get(row.cfs_id) ?? 0) + 1);
  }

  return { ctx, stations: stations ?? [], staffCount };
}

// --------------------------------------------------- importer securities --

export async function createSecurity(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const db = serviceClient();

  const lineId = String(formData.get('lineId') ?? '');
  const importerName = String(formData.get('importerName') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  const validFrom = String(formData.get('validFrom') ?? '').trim();
  const validTo = String(formData.get('validTo') ?? '').trim();
  const aliases = parseList(formData.get('importerAliases'));
  const amount = optionalNumber(formData.get('amount'));
  const covers = new Set(formData.getAll('covers').map(String));

  if (importerName.length < 2) return { error: 'Enter the importer name.' };
  if (kind !== 'yearly_bond' && kind !== 'standing_deposit') {
    return { error: 'Choose a yearly bond or a standing deposit.' };
  }
  if (amount === null || (amount !== undefined && amount < 0)) {
    return { error: 'Enter a valid amount, or leave it blank.' };
  }
  if (validFrom && validTo && validTo < validFrom) {
    return { error: 'The valid-to date cannot be before the valid-from date.' };
  }

  const { data: line } = await db
    .from('shipping_lines')
    .select('id')
    .eq('id', lineId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!line) return { error: 'Choose a shipping line.' };

  const { error } = await db.from('importer_line_securities').upsert(
    {
      company_id: ctx.companyId,
      shipping_line_id: lineId,
      importer_name: importerName,
      importer_aliases: aliases,
      kind,
      reference: reference || null,
      amount: amount ?? null,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      covers_loaded: covers.has('loaded'),
      covers_destuffed: covers.has('destuffed'),
      is_active: true,
    },
    { onConflict: 'company_id,shipping_line_id,importer_name,kind' },
  );
  if (error) return { error: error.message };

  revalidatePath('/settings/securities');
  return { ok: true, message: `Security for ${importerName} saved.` };
}

export async function setSecurityActive(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const securityId = String(formData.get('securityId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  const { error } = await serviceClient()
    .from('importer_line_securities')
    .update({ is_active: isActive })
    .eq('id', securityId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/securities');
  return { ok: true, message: isActive ? 'Security re-enabled.' : 'Security retired.' };
}

/** Read model for the securities page. */
export async function listSecurities() {
  const ctx = await requireCompany();
  const db = serviceClient();

  const [{ data: securities }, { data: lines }] = await Promise.all([
    db
      .from('importer_line_securities')
      .select('*')
      .eq('company_id', ctx.companyId)
      .order('importer_name'),
    // Every line, not just the active ones: a retired line still has to render
    // its name against the securities already recorded against it.
    db
      .from('shipping_lines')
      .select('id, name, is_active')
      .eq('company_id', ctx.companyId)
      .order('name'),
  ]);

  return { ctx, securities: securities ?? [], lines: lines ?? [] };
}

// --------------------------------------------------- organization repository --

/**
 * Read model for the organizations page.
 *
 * Five thousand parties is not a table anyone scrolls, so the list is a search
 * result rather than the whole master. An empty query still returns rows —
 * seeing something on arrival is what tells the operator the upload worked.
 */
/** How many rows the organizations page shows for one search. */
const ORGANIZATION_PAGE_SIZE = 50;

export async function listOrganizations(query: string) {
  const ctx = await requireCompany();
  const db = serviceClient();

  const [{ data: organizations }, { count }, { data: imports }] = await Promise.all([
    db.rpc('search_organizations', {
      p_company: ctx.companyId,
      p_query: query.trim(),
      p_limit: ORGANIZATION_PAGE_SIZE,
    }),
    db
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', ctx.companyId)
      .eq('is_active', true),
    db
      .from('organization_imports')
      .select('*')
      .eq('company_id', ctx.companyId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  return {
    ctx,
    organizations: organizations ?? [],
    activeCount: count ?? 0,
    lastImport: imports?.[0] ?? null,
    pageSize: ORGANIZATION_PAGE_SIZE,
  };
}

/**
 * The two per-importer settings the repository does not carry.
 *
 * Everything else on an organization comes from Logi-Sys and is overwritten by
 * the next upload, so these are the only editable fields — and they survive an
 * upload because the import never writes them.
 */
export async function updateOrganizationDefaults(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const id = String(formData.get('id') ?? '');
  const endUse = String(formData.get('defaultEndUseCode') ?? '').trim().toUpperCase();
  const rate = optionalNumber(formData.get('marineOpenPolicyRatePercent'));
  const policyNo = String(formData.get('marinePolicyNo') ?? '').trim();
  const sumInsured = optionalNumber(formData.get('marinePolicySumInsuredInr'));
  const perSending = optionalNumber(formData.get('marinePolicyPerSendingLimitInr'));
  const validTill = String(formData.get('marinePolicyValidTill') ?? '').trim();

  if (!id) return { error: 'No organization to update.' };
  if (endUse && !(endUse in END_USE_CODES)) {
    return { error: `End-use code must be one of ${Object.keys(END_USE_CODES).join(', ')}.` };
  }
  if (rate === null) return { error: 'Marine open-policy rate must be a number, or blank.' };
  if (rate !== undefined && (rate < 0 || rate > 100)) {
    return { error: 'Marine open-policy rate is a percentage of C&F value.' };
  }
  for (const [label, value] of [
    ['Sum insured', sumInsured],
    ['Per-sending limit', perSending],
  ] as const) {
    if (value === null) return { error: `${label} must be a number, or blank.` };
    if (value !== undefined && value <= 0) return { error: `${label} must be more than zero.` };
  }
  // A limit larger than the policy is a typo, and it is the limit the export
  // checks against — so it would quietly disable the over-insurance warning.
  if (sumInsured && perSending && perSending > sumInsured) {
    return { error: 'The per-sending limit cannot exceed the sum insured for the whole policy.' };
  }

  const { error } = await serviceClient()
    .from('organizations')
    .update({
      default_end_use_code: endUse || null,
      marine_open_policy_rate_percent: rate ?? null,
      marine_policy_no: policyNo || null,
      marine_policy_sum_insured_inr: sumInsured ?? null,
      marine_policy_per_sending_limit_inr: perSending ?? null,
      marine_policy_valid_till: validTill || null,
    })
    .eq('id', id)
    .eq('company_id', ctx.companyId);

  if (error) return { error: error.message };

  revalidatePath('/settings/organizations');
  return { ok: true, message: 'Saved.' };
}

/* ---------------------------------------------- supplier relationships -- */

/**
 * Every importer-supplier pair this company has recorded something about.
 *
 * Two joins rather than a view, because the party names live on
 * `organizations` and the pair is what the row is keyed on.
 */
export async function listSupplierRelationships() {
  const ctx = await requireCompany();

  const { data } = await serviceClient()
    .from('supplier_relationships')
    .select(
      '*, importer:organizations!supplier_relationships_importer_org_id_fkey(name, branch_name), supplier:organizations!supplier_relationships_supplier_org_id_fkey(name, branch_name)',
    )
    .eq('company_id', ctx.companyId)
    .order('updated_at', { ascending: false });

  return { ctx, relationships: data ?? [] };
}

/**
 * Resolve a typed party name to exactly one repository row.
 *
 * Exact on the normalised name wins outright. Anything else hands back the
 * candidates: this row decides what a Bill of Entry declares about two named
 * parties, and a fuzzy match is not a good enough reason to declare it.
 */
async function resolveOrgByName(
  companyId: string,
  field: string,
  typed: string,
  role: 'consignee' | 'shipper',
): Promise<{ id: string; name: string } | SettingsActionState> {
  const name = typed.trim();
  if (name.length < 2) return { error: `Enter the ${field} name.` };

  const matches = await searchOrganizations(companyId, name, role, 8);
  if (matches.length === 0) {
    return {
      error: `No organization in the repository matches "${name}". Upload the Logi-Sys organization repository first, or check the spelling.`,
    };
  }

  const wanted = partyNameKey(name);
  const exact = matches.filter((m) => partyNameKey(m.name) === wanted);
  if (exact.length === 1) return { id: exact[0]!.id, name: exact[0]!.name };
  if (exact.length > 1) {
    return {
      error: `"${name}" matches ${exact.length} branches. Pick the branch you mean.`,
      candidates: { field, names: exact.map((m) => `${m.name} · ${m.branch_name}`) },
    };
  }

  return {
    error: `"${name}" is not a repository name. Pick one of these, or type it exactly.`,
    candidates: { field, names: matches.map((m) => m.name) },
  };
}

/**
 * Record, or replace, what is known about one importer buying from one supplier.
 *
 * Upserted on the pair, which is what the table is unique on: an SVB order
 * covers a pair, and a second row for the same two parties would be two
 * answers to one question.
 */
export async function saveSupplierRelationship(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();

  const isRelated = formData.get('isRelated') === 'on';
  const base = String(formData.get('base') ?? '').trim();
  const condition = String(formData.get('condition') ?? '').trim();
  const svbRefNo = String(formData.get('svbRefNo') ?? '').trim();
  const svbDate = String(formData.get('svbDate') ?? '').trim();
  const svbCustomHouse = String(formData.get('svbCustomHouse') ?? '').trim().toUpperCase();
  const loadingBasis = String(formData.get('svbLoadingBasis') ?? '').trim().toUpperCase();
  const statusAssessable = String(formData.get('svbStatusAssessable') ?? '').trim().toUpperCase();
  const statusDuty = String(formData.get('svbStatusDuty') ?? '').trim().toUpperCase();
  const rateAssessable = optionalNumber(formData.get('svbRateAssessable'));
  const rateDuty = optionalNumber(formData.get('svbRateDuty'));
  const deposit = optionalNumber(formData.get('revenueDepositPercent'));
  const notes = String(formData.get('notes') ?? '').trim();

  for (const [label, value] of [
    ['SVB load on assessable value', rateAssessable],
    ['SVB load on duty', rateDuty],
    ['Revenue deposit', deposit],
  ] as const) {
    if (value === null) return { error: `${label} must be a percentage, or blank.` };
    if (value !== undefined && (value < 0 || value > 100)) {
      return { error: `${label} is a percentage.` };
    }
  }
  // The same rule the database enforces, said in the operator's language: these
  // three describe a relationship, so they cannot stand without one.
  if (!isRelated && (base || condition || deposit !== undefined)) {
    return {
      error:
        'Basis, condition and the revenue deposit only apply to related parties. Tick "buyer and seller are related", or clear them.',
    };
  }
  if (svbCustomHouse && !/^IN[A-Z0-9]{4}$/.test(svbCustomHouse)) {
    return { error: 'The SVB custom house is a six-character ICES code, e.g. INNSA1.' };
  }

  const importer = await resolveOrgByName(
    ctx.companyId,
    'importer',
    String(formData.get('importerName') ?? ''),
    'consignee',
  );
  if (!('id' in importer)) return importer;
  const supplier = await resolveOrgByName(
    ctx.companyId,
    'supplier',
    String(formData.get('supplierName') ?? ''),
    'shipper',
  );
  if (!('id' in supplier)) return supplier;

  const { error } = await serviceClient()
    .from('supplier_relationships')
    .upsert(
      {
        company_id: ctx.companyId,
        importer_org_id: importer.id,
        supplier_org_id: supplier.id,
        is_related: isRelated,
        base: base || null,
        condition: condition || null,
        svb_ref_no: svbRefNo || null,
        svb_date: svbDate || null,
        svb_custom_house: svbCustomHouse || null,
        svb_loading_basis: loadingBasis === 'A' ? 'A' : null,
        svb_rate_assessable: rateAssessable ?? null,
        svb_status_assessable: statusAssessable || null,
        svb_rate_duty: rateDuty ?? null,
        svb_status_duty: statusDuty || null,
        revenue_deposit_percent: deposit ?? null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'importer_org_id,supplier_org_id' },
    );
  if (error) return { error: error.message };

  revalidatePath('/settings/relationships');
  return {
    ok: true,
    message: `${importer.name} buying from ${supplier.name}: saved as ${isRelated ? 'related' : 'unrelated'}.`,
  };
}

export async function deleteSupplierRelationship(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompanyManager();
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'No record to remove.' };

  const { error } = await serviceClient()
    .from('supplier_relationships')
    .delete()
    .eq('id', id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath('/settings/relationships');
  // Deleting is not the same as recording "not related": with no row, nothing
  // has been said about the pair, and the export says so.
  return { ok: true, message: 'Removed. Nothing is now recorded about that pair.' };
}

/* -------------------------------------------------- bonded warehouses -- */

/**
 * The customs bonded warehouses this company files against.
 *
 * The table fills itself: the first job that names a warehouse code resolves it
 * (offline for the station and licence type, from ICEGATE for the name and
 * address) and caches the row. This page exists for the two cases that leaves —
 * a warehouse ICEGATE could not supply, and one it supplied wrongly.
 */
export async function listBondedWarehouses() {
  const ctx = await requireCompany();
  const db = serviceClient();

  const { data } = await db
    .from('bonded_warehouses')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('code');

  return { ctx, warehouses: data ?? [] };
}

/**
 * Correct or add a bonded warehouse.
 *
 * The code is validated against the custom-house master before anything is
 * written — its first four characters are an ICES site code, so a code naming
 * no real station is a typo we can refuse here rather than let Customs refuse
 * later. Saving marks the row `operator`, so a later ICEGATE lookup does not
 * overwrite a person's correction.
 */
export async function saveBondedWarehouse(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const ctx = await requireCompany();
  if (!COMPANY_MANAGER_ROLES.includes(ctx.role)) {
    return { error: 'Only a manager can change the warehouse list.' };
  }

  const parsed = parseWarehouseCodeResult(String(formData.get('code') ?? ''));
  if (!parsed.ok) return { error: describeWarehouseCodeError(parsed.error) };

  const value = (key: string) => {
    const v = String(formData.get(key) ?? '').trim();
    return v === '' ? null : v;
  };

  const db = serviceClient();
  const { error } = await db.from('bonded_warehouses').upsert(
    {
      company_id: ctx.companyId,
      code: parsed.parsed.code,
      name: value('name'),
      address1: value('address1'),
      address2: value('address2'),
      city: value('city'),
      pin: value('pin'),
      country: 'IN',
      station_code: parsed.parsed.stationCode,
      warehouse_type: parsed.parsed.type,
      licensee_name: value('licenseeName'),
      license_no: value('licenseNo'),
      license_valid_till: value('licenseValidTill'),
      source: 'operator' as const,
      is_active: formData.get('isActive') !== 'off',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,code' },
  );
  if (error) return { error: error.message };

  revalidatePath('/settings/warehouses');
  return {
    ok: true,
    message: `${parsed.parsed.code} saved — a ${parsed.parsed.type} warehouse under ${parsed.parsed.station.name}.`,
  };
}
