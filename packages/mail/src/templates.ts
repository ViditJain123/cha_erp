import { APP, TEAMS, type TeamKey } from '@checklist/config/app';
import { button, esc, layout } from './layout.js';
import type { OutboundEmail } from './send.js';

export interface CredentialsEmailInput {
  to: string;
  fullName?: string | null;
  tempPassword: string;
  loginUrl: string;
  companyName: string;
  /** Absent for the company owner, who is not on a delivery team. */
  team?: TeamKey | null;
  /** Who added them — "Vidit has added you" reads better than "You were added". */
  invitedByName?: string | null;
}

/**
 * The credentials email. This is the only place a temporary password is ever
 * shown, so it has to be unambiguous: monospace, generous letter spacing, and a
 * clear instruction that it must be changed.
 */
export function credentialsEmail(input: CredentialsEmailInput): OutboundEmail {
  const greeting = input.fullName ? `Hi ${esc(input.fullName)},` : 'Hi,';
  const inviter = input.invitedByName
    ? `${esc(input.invitedByName)} has set up an account for you`
    : `An account has been created for you`;
  const teamLine = input.team
    ? `<p style="margin:0 0 16px;">You are on the <strong>${esc(TEAMS[input.team].label)}</strong> team.</p>`
    : '';

  const body = `
<p style="margin:0 0 16px;">${greeting}</p>
<p style="margin:0 0 16px;">${inviter} on ${esc(APP.name)} for <strong>${esc(input.companyName)}</strong>.</p>
${teamLine}
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;">
  <tr><td style="padding:16px 18px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:4px;">Email</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;margin-bottom:14px;">${esc(input.to)}</div>
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:4px;">Temporary password</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;letter-spacing:0.08em;">${esc(input.tempPassword)}</div>
  </td></tr>
</table>
<p style="margin:0 0 20px;">${button(input.loginUrl, 'Sign in')}</p>
<p style="margin:0;font-size:13px;color:#475569;">You will be asked to choose your own password the first time you sign in. If you did not expect this email, you can ignore it.</p>`;

  const text = [
    input.fullName ? `Hi ${input.fullName},` : 'Hi,',
    '',
    `${input.invitedByName ? `${input.invitedByName} has set up an account for you` : 'An account has been created for you'} on ${APP.name} for ${input.companyName}.`,
    ...(input.team ? ['', `You are on the ${TEAMS[input.team].label} team.`] : []),
    '',
    `Email:              ${input.to}`,
    `Temporary password: ${input.tempPassword}`,
    '',
    `Sign in: ${input.loginUrl}`,
    '',
    'You will be asked to choose your own password the first time you sign in.',
    'If you did not expect this email, you can ignore it.',
  ].join('\n');

  return {
    to: input.to,
    subject: `Your ${APP.name} account for ${input.companyName}`,
    html: layout({ previewText: `Your sign-in details for ${APP.name}`, body }),
    text,
  };
}

export interface PasswordResetEmailInput {
  to: string;
  fullName?: string | null;
  tempPassword: string;
  loginUrl: string;
}

/** Sent when an admin resets someone's password back to a generated one. */
export function passwordResetEmail(input: PasswordResetEmailInput): OutboundEmail {
  const greeting = input.fullName ? `Hi ${esc(input.fullName)},` : 'Hi,';
  const body = `
<p style="margin:0 0 16px;">${greeting}</p>
<p style="margin:0 0 16px;">Your ${esc(APP.name)} password has been reset by an administrator. Use the temporary password below to sign in, then choose a new one.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;">
  <tr><td style="padding:16px 18px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:4px;">Temporary password</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;letter-spacing:0.08em;">${esc(input.tempPassword)}</div>
  </td></tr>
</table>
<p style="margin:0 0 20px;">${button(input.loginUrl, 'Sign in')}</p>
<p style="margin:0;font-size:13px;color:#475569;">If you did not request this, contact <a href="mailto:${esc(APP.supportEmail)}" style="color:#475569;">${esc(APP.supportEmail)}</a> — someone else may have changed your account.</p>`;

  const text = [
    input.fullName ? `Hi ${input.fullName},` : 'Hi,',
    '',
    `Your ${APP.name} password has been reset by an administrator.`,
    '',
    `Temporary password: ${input.tempPassword}`,
    '',
    `Sign in: ${input.loginUrl}`,
    '',
    `If you did not request this, contact ${APP.supportEmail}.`,
  ].join('\n');

  return {
    to: input.to,
    subject: `Your ${APP.name} password has been reset`,
    html: layout({ previewText: `A temporary password for ${APP.name}`, body }),
    text,
  };
}

export interface DeliveryPlanEmailInput {
  to: string;
  jobLabel: string;
  cfsName: string;
  plannedFor: string;
  queueUrl: string;
  importerName?: string | null;
}

/**
 * Tells a CFS that a delivery day has been put to them.
 *
 * A nudge, not the channel of record — the answer is given in the app. A
 * plain-text reply to this message would never reach the job: the mailbox
 * poller only processes messages carrying attachments.
 */
export function deliveryPlanEmail(input: DeliveryPlanEmailInput): OutboundEmail {
  const body = `
<p style="margin:0 0 16px;">A delivery has been planned at <strong>${esc(input.cfsName)}</strong> and needs your answer.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;">
  <tr><td style="padding:16px 18px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:4px;">Job</div>
    <div style="font-size:15px;margin-bottom:14px;">${esc(input.jobLabel)}${input.importerName ? ` &middot; ${esc(input.importerName)}` : ''}</div>
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:4px;">Proposed day</div>
    <div style="font-size:17px;font-weight:600;">${esc(input.plannedFor)}</div>
  </td></tr>
</table>
<p style="margin:0 0 20px;">${button(input.queueUrl, 'Confirm or refuse')}</p>
<p style="margin:0;font-size:13px;color:#475569;">Please answer in ${esc(APP.name)} rather than by replying — a reply to this address is not read.</p>`;

  const text = [
    `A delivery has been planned at ${input.cfsName} and needs your answer.`,
    '',
    `Job:          ${input.jobLabel}${input.importerName ? ` (${input.importerName})` : ''}`,
    `Proposed day: ${input.plannedFor}`,
    '',
    `Confirm or refuse it: ${input.queueUrl}`,
    '',
    `Please answer in ${APP.name} rather than by replying — a reply to this address is not read.`,
  ].join('\n');

  return {
    to: input.to,
    subject: `Delivery on ${input.plannedFor} — ${input.jobLabel}`,
    html: layout({ previewText: `${input.cfsName} on ${input.plannedFor}`, body }),
    text,
  };
}

export interface DeliveryRefusedEmailInput {
  to: string;
  jobLabel: string;
  cfsName: string;
  plannedFor: string;
  reason: string | null;
  jobUrl: string;
  importerName?: string | null;
}

/** Tells customer support that a planned delivery is not going ahead. */
export function deliveryRefusedEmail(input: DeliveryRefusedEmailInput): OutboundEmail {
  const body = `
<p style="margin:0 0 16px;"><strong>${esc(input.cfsName)}</strong> will not deliver ${esc(input.jobLabel)} on <strong>${esc(input.plannedFor)}</strong>.</p>
${input.reason ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin:0 0 20px;"><tr><td style="padding:14px 18px;font-size:14px;color:#991b1b;">${esc(input.reason)}</td></tr></table>` : ''}
<p style="margin:0 0 20px;">${button(input.jobUrl, 'Open the job')}</p>
<p style="margin:0;font-size:13px;color:#475569;">The customer is expecting this consignment${input.importerName ? ` for ${esc(input.importerName)}` : ''}. A new day has to be planned.</p>`;

  const text = [
    `${input.cfsName} will not deliver ${input.jobLabel} on ${input.plannedFor}.`,
    ...(input.reason ? ['', `Reason: ${input.reason}`] : []),
    '',
    `Open the job: ${input.jobUrl}`,
    '',
    `The customer is expecting this consignment${input.importerName ? ` for ${input.importerName}` : ''}. A new day has to be planned.`,
  ].join('\n');

  return {
    to: input.to,
    subject: `Delivery not going ahead on ${input.plannedFor} — ${input.jobLabel}`,
    html: layout({ previewText: `${input.cfsName} refused ${input.plannedFor}`, body }),
    text,
  };
}
