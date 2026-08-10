import type { Metadata } from 'next';
import { TEAMS } from '@checklist/config/app';
import { isGraphConfigured } from '@checklist/config/env';
import { missingScopes } from '@checklist/graph';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export const metadata: Metadata = { title: 'Mailbox' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  not_configured: 'Microsoft Graph is not configured on this server yet.',
  wrong_team: 'Only Scrutiny team members can connect a mailbox.',
  state_failed: 'Could not start the connection. Try again.',
  state_mismatch: 'The sign-in did not match this browser session. Try again.',
  state_unknown: 'That connection attempt has already been used. Start again.',
  state_expired: 'The connection attempt timed out. Start again.',
  missing_code: 'Microsoft did not return an authorisation code.',
  consent_declined: 'You declined the permission request.',
  access_denied: 'You declined the permission request.',
  exchange_failed: 'Microsoft rejected the connection. Check the server logs.',
  save_failed: 'The mailbox connected but could not be saved.',
  disconnect_failed: 'Could not disconnect that mailbox.',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export default async function MailboxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const ctx = await requireCompany();
  const params = await searchParams;
  const configured = isGraphConfigured();

  const { data: connections } = await serviceClient()
    .from('mail_connections')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: true });

  const mine = (connections ?? []).filter((c) => c.profile_id === ctx.userId);
  const others = (connections ?? []).filter((c) => c.profile_id !== ctx.userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Outlook mailbox</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connected mailboxes are checked every 5 minutes. Emails carrying shipment documents open a
          job automatically, or attach to the job they belong to.
        </p>
      </div>

      {params.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {ERRORS[params.error] ?? params.error}
        </div>
      )}
      {params.connected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Mailbox connected. Only mail arriving from now on is processed — nothing already in the
          inbox is read.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {!configured ? (
          <div className="text-sm text-slate-500">
            <div className="font-medium text-slate-700">Not configured yet</div>
            <p className="mt-1">
              Microsoft Graph credentials are missing on the server. Set <code>MS_CLIENT_ID</code>,{' '}
              <code>MS_CLIENT_SECRET</code> and <code>TOKEN_ENCRYPTION_KEY</code>.
            </p>
          </div>
        ) : ctx.team !== 'scrutiny' ? (
          <p className="text-sm text-slate-500">
            Mailbox connections belong to the {TEAMS.scrutiny.label} team. Ask an administrator to
            move you onto that team if you need one.
          </p>
        ) : mine.length === 0 ? (
          <div>
            <p className="mb-4 text-sm text-slate-500">
              Connect the Outlook mailbox that receives shipment documents. You will be asked to
              grant read-only access to your mail.
            </p>
            <a
              href="/api/integrations/microsoft/connect"
              className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Connect Outlook
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {mine.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">{c.email_address}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Last checked {timeAgo(c.last_polled_at)}
                    {c.consecutive_failures > 0 && ` · ${c.consecutive_failures} failed attempts`}
                  </div>
                  {c.status === 'needs_reauth' && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Microsoft revoked access to this mailbox. Reconnect to resume.
                    </div>
                  )}
                  {c.status === 'active' && missingScopes(c.scopes).length > 0 && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      This mailbox was connected before we could send email, so document requests
                      cannot go out from it yet. Reconnect to grant{' '}
                      {missingScopes(c.scopes).join(', ')} — reading carries on either way.
                    </div>
                  )}
                  {c.last_error && c.status !== 'needs_reauth' && (
                    <div className="mt-2 text-xs text-slate-400">{c.last_error}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill status={c.status} />
                  {c.status !== 'active' || missingScopes(c.scopes).length > 0 ? (
                    <a
                      href="/api/integrations/microsoft/connect"
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Reconnect
                    </a>
                  ) : (
                    <form action="/api/integrations/microsoft/disconnect" method="post">
                      <input type="hidden" name="connectionId" value={c.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                      >
                        Disconnect
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Other mailboxes in this company</h2>
          <ul className="space-y-2 text-sm">
            {others.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4">
                <span>{c.email_address}</span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  checked {timeAgo(c.last_polled_at)}
                  <StatusPill status={c.status} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === 'active'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'needs_reauth'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-200 text-slate-700';
  const label = status === 'needs_reauth' ? 'reconnect needed' : status;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
