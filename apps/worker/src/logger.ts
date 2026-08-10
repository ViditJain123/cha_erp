import { workerEnv } from '@checklist/config/env';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < LEVELS[workerEnv().LOG_LEVEL]) return;
  // Structured single-line JSON: Render's log viewer and any aggregator can
  // filter on it, and it stays greppable in a terminal.
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields })}\n`,
  );
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name };
  }
  return { error: String(err) };
}
