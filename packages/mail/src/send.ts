import { Resend } from 'resend';
import { mailEnv } from '@checklist/config/env';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  /** Always supply a plaintext alternative — HTML-only mail lands in spam. */
  text: string;
}

export interface SendResult {
  id: string | null;
  transport: 'resend' | 'console';
}

let resend: Resend | undefined;

/**
 * Sends an email, or prints it when no Resend key is configured.
 *
 * The console transport is not a stub: locally it is how you read a new user's
 * temporary password, since nothing else ever displays it.
 */
export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  const env = mailEnv();

  if (env.MAIL_TRANSPORT === 'console') {
    process.stdout.write(
      [
        '',
        '─'.repeat(72),
        `  EMAIL (not sent — MAIL_TRANSPORT=console)`,
        `  To:      ${email.to}`,
        `  Subject: ${email.subject}`,
        '─'.repeat(72),
        email.text,
        '─'.repeat(72),
        '',
      ].join('\n'),
    );
    return { id: null, transport: 'console' };
  }

  resend ??= new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: env.MAIL_FROM,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (error) {
    throw new Error(`Resend refused the message to ${email.to}: ${error.message}`);
  }
  return { id: data?.id ?? null, transport: 'resend' };
}
