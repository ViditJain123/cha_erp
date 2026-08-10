import { z } from 'zod';

/**
 * Environment access.
 *
 * Validated per feature, lazily, at the point of use — never at import time and
 * never as one big schema. Phase A must run before the Azure app registration
 * exists, so a missing MS_CLIENT_ID cannot be allowed to break the login page.
 *
 *   publicEnv()   browser-safe, NEXT_PUBLIC_* only
 *   supabaseEnv() server-side Supabase access, including the service-role key
 *   mailEnv()     Resend (falls back to a console transport in development)
 *   graphEnv()    Microsoft Graph — Phase B only
 *   openaiEnv()   document classification
 */

/** Memoises a parse so repeated reads do not re-validate. */
function once<T>(fn: () => T): () => T {
  let value: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value as T;
  };
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown, scope: string): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid ${scope} environment:\n${issues.join('\n')}\nSee .env.example.`);
  }
  return result.data;
}

function assertServer(scope: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(`${scope}() was called in the browser — this would leak a server secret.`);
  }
}

// ------------------------------------------------------------------ public --

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/**
 * NEXT_PUBLIC_* must be written as static literals. Next.js inlines them into
 * the client bundle at build time, and a computed `process.env[key]` lookup
 * comes back undefined in the browser — the most common env bug in Next apps.
 */
export const publicEnv = once((): PublicEnv =>
  parse(
    publicSchema,
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    },
    'public',
  ),
);

// ---------------------------------------------------------------- supabase --

const supabaseSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export const supabaseEnv = once(() => {
  assertServer('supabaseEnv');
  return { ...publicEnv(), ...parse(supabaseSchema, process.env, 'Supabase') };
});

// -------------------------------------------------------------------- mail --

const mailSchema = z.object({
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default('Acme ERP <onboarding@resend.dev>'),
  /**
   * `console` prints the rendered email (temp password included) to stdout
   * instead of sending it — the normal way to work locally without a verified
   * Resend domain. Defaults to `resend` when an API key is present.
   */
  MAIL_TRANSPORT: z.enum(['resend', 'console']).optional(),
});

export const mailEnv = once(() => {
  assertServer('mailEnv');
  const env = parse(mailSchema, process.env, 'mail');
  const transport = env.MAIL_TRANSPORT ?? (env.RESEND_API_KEY ? 'resend' : 'console');
  if (transport === 'resend' && !env.RESEND_API_KEY) {
    throw new Error('MAIL_TRANSPORT=resend requires RESEND_API_KEY. See .env.example.');
  }
  return { ...env, MAIL_TRANSPORT: transport };
});

// ------------------------------------------------------------------- graph --

/** A base64 key that decodes to exactly 32 bytes (AES-256-GCM). */
const base64Key32 = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  { message: 'must be base64 for exactly 32 bytes — generate with `openssl rand -base64 32`' },
);

const graphSchema = z.object({
  MS_CLIENT_ID: z.string().min(1),
  MS_CLIENT_SECRET: z.string().min(1),
  MS_REDIRECT_URI: z.string().url(),
  /** `organizations` = work/school accounts only, which is what a B2B CHA uses. */
  MS_TENANT_ID: z.string().min(1).default('organizations'),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  /**
   * `console` prints outgoing mail instead of sending it through Graph, the
   * same way MAIL_TRANSPORT works for Resend. Lets the shipper-request loop be
   * driven end to end without a live mailbox.
   */
  GRAPH_TRANSPORT: z.enum(['graph', 'console']).default('graph'),
});

export const graphEnv = once(() => {
  assertServer('graphEnv');
  return parse(graphSchema, process.env, 'Microsoft Graph');
});

/** True when the Azure app registration has been configured — Phase B gate. */
export function isGraphConfigured(): boolean {
  return Boolean(
    process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY,
  );
}

// ------------------------------------------------------------------ openai --

const openaiSchema = z.object({ OPENAI_API_KEY: z.string().min(1) });

export const openaiEnv = once(() => {
  assertServer('openaiEnv');
  return parse(openaiSchema, process.env, 'OpenAI');
});

// ---------------------------------------------------------- worker + misc --

const workerSchema = z.object({
  /** How often the loop wakes. Per-mailbox cadence is stored on each row. */
  WORKER_TICK_SECONDS: z.coerce.number().int().positive().default(60),
  /** The 5-minute mailbox poll interval. */
  WORKER_MAILBOX_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  WORKER_INSTANCE_ID: z.string().min(1).default('local'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const workerEnv = once(() => {
  assertServer('workerEnv');
  return parse(workerSchema, process.env, 'worker');
});

/** Legacy checklist generator paths. Optional — they have working defaults. */
export function legacyEnv() {
  return {
    MASTERS_DIR: process.env.MASTERS_DIR,
    LIBRARY_DIR: process.env.LIBRARY_DIR,
  };
}
