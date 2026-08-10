import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repo's `.env.local`, found by walking up from this file.
 *
 * Side-effecting — import it first in any script:
 *
 *     import '@checklist/config/load-env';
 *
 * Deliberately not `node --env-file=../../.env.local`: that path is relative to
 * the working directory, which differs between `pnpm run`, `pnpm exec` and a
 * direct invocation. It resolved correctly in practice but `tsx` printed a
 * spurious "not found" on every run, which is exactly the kind of noise that
 * makes you distrust working plumbing.
 *
 * Real environment variables win over the file, matching `--env-file`
 * semantics, so a deployed process is never overridden by a stray checkout.
 */
function loadEnvLocal(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(dir, '.env.local');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  // Absent is fine: in production the environment is supplied by the platform.
  return null;
}

export const envFileLoaded = loadEnvLocal();
