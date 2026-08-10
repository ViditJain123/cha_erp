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
const TEAM_KINDS: readonly TeamKind[] = ['scrutiny', 'do'];

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

/** Read model for the team page. */
export async function listTeam() {
  const ctx = await requireCompany();
  const { data } = await serviceClient()
    .from('profiles')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: true });
  return { ctx, members: data ?? [] };
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
