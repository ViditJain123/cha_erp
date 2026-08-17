import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRole, Database, TeamKind, UserStatus } from './types.js';

/**
 * The claims our custom access token hook stamps onto every JWT. RLS reads the
 * same values server-side, so what the UI shows and what the database enforces
 * can never drift.
 */
export interface AppClaims {
  userId: string;
  email: string;
  /** null for platform admins, who stand outside every company. */
  companyId: string | null;
  role: AppRole;
  team: TeamKind | null;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  status: UserStatus;
}

interface RawClaims {
  sub?: unknown;
  email?: unknown;
  company_id?: unknown;
  user_role?: unknown;
  user_team?: unknown;
  is_platform_admin?: unknown;
  must_change_password?: unknown;
  user_status?: unknown;
}

const ROLES: readonly AppRole[] = ['platform_admin', 'company_owner', 'company_admin', 'member'];
// Must list every value of the team_kind enum. A team missing here does not
// error — it falls through to `team: null`, and the user silently loses their
// queue. Adding a value to the enum means adding it here in the same change.
const TEAMS: readonly TeamKind[] = ['scrutiny', 'do', 'customs', 'cfs', 'customer_support'];
const STATUSES: readonly UserStatus[] = ['invited', 'active', 'disabled'];

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function shape(raw: RawClaims): AppClaims | null {
  const userId = str(raw.sub);
  if (!userId) return null;
  const role = ROLES.find((r) => r === raw.user_role) ?? 'member';
  const team = TEAMS.find((t) => t === raw.user_team) ?? null;
  const status = STATUSES.find((s) => s === raw.user_status) ?? 'invited';
  return {
    userId,
    email: str(raw.email),
    companyId: str(raw.company_id) || null,
    role,
    team,
    isPlatformAdmin: raw.is_platform_admin === true,
    // Fail closed: an absent claim means the hook did not run, and forcing a
    // password change is the safer of the two wrong answers.
    mustChangePassword: raw.must_change_password !== false,
    status,
  };
}

/**
 * Reads the verified claims off the current session.
 *
 * `getClaims()` verifies the token (JWKS for asymmetric signing keys, a round
 * trip to the auth server otherwise), so the result is trustworthy — unlike
 * decoding `access_token` locally.
 */
export async function getAppClaims(
  supabase: SupabaseClient<Database>,
): Promise<AppClaims | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return shape(data.claims as RawClaims);
}
