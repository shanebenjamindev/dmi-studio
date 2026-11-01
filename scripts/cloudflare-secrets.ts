// Read local backend configuration and send only the required secrets to Cloudflare.
// Never print credentials or write them into the repository.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import '../server/config';

const secrets: Record<string, string> = {
  SETUP_CODE: process.env.SETUP_CODE || crypto.randomBytes(32).toString('hex'),
};
for (const key of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
  const value = process.env[key]?.trim();
  if (value) secrets[key] = value;
}
const result = spawnSync('npx', ['wrangler', 'secret', 'bulk'], {
  input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
if (result.error) throw new Error('Không chạy được Wrangler');
process.exitCode = result.status ?? 1;
