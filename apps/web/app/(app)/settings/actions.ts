'use server';

import { revalidatePath } from 'next/cache';
import type { AppRole, TeamKind } from '@checklist/db';
import { requireCompany, requireCompanyManager } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { provisionUser } from '@/lib/provision';
import { parseCcrCsv } from '@/lib/ccr-csv';

export interface SettingsActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  tempPassword?: string;
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
