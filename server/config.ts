// Runtime configuration: paths, .env loading, feature flags.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export const PORT = Number(process.env.PORT || 5173);
/** Public address when deployed behind https (PUBLIC_URL, or the one Render provides). Empty when running locally. */
export const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
export const HOST = process.env.HOST || '127.0.0.1';
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const ASSET_DIR = path.join(DATA_DIR, 'assets');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
export const MOCK = process.env.DMS_MOCK === '1';
export const MAX_UPLOAD = 1024 * 1024 * 800; // 800 MB render uploads

fs.mkdirSync(ASSET_DIR, { recursive: true });

function hasBin(bin: string) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
export const FFMPEG = process.env.FFMPEG_PATH || (hasBin('ffmpeg') ? 'ffmpeg' : '');
