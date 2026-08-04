/**
 * Side-effect module: load .env into process.env.
 *
 * Next.js loads .env automatically for the app, but a standalone tsx script gets
 * no such help, and dotenv is only present transitively via Prisma — not declared
 * in package.json — so importing it would be relying on someone else's dependency.
 *
 * Import this FIRST, before anything that reads process.env at module scope:
 *
 *   import './load-env';
 *   import { prisma } from '../lib/prisma';
 *
 * ES module imports are hoisted, so calling a loader function inline would not
 * reliably run before the Prisma import is evaluated. Imported modules are
 * evaluated in source order, which is the guarantee this file relies on.
 *
 * Existing environment values always win, so `DATABASE_URL=... npm run <script>`
 * still overrides the file.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

try {
  const contents = readFileSync(resolve(process.cwd(), '.env'), 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;

    const match = line.match(ENV_LINE);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    // Strip surrounding quotes; leave inner content alone.
    process.env[key] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
} catch (error) {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code !== 'ENOENT') throw error;
  // No .env file. Let the consumer report whatever variable it actually needs.
}
