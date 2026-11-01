// Runtime configuration: paths, .env loading, feature flags.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const IS_CLOUDFLARE = process.env.DMS_RUNTIME === 'cloudflare';
export const ROOT = IS_CLOUDFLARE ? '/tmp/dm-studio' : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(ROOT, '.env');
if (!IS_CLOUDFLARE && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export const PORT = Number(process.env.PORT || 5173);
/** Optional public HTTPS address; otherwise the trusted proxy request determines it. */
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
export const HOST = process.env.HOST || '127.0.0.1';
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const ASSET_DIR = path.join(DATA_DIR, 'assets');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
export const MOCK = process.env.DMS_MOCK === '1';
// Free cloud instances have ephemeral disks: customer files must go to Google Drive.
export const CLOUD_STORAGE_ONLY = IS_CLOUDFLARE || process.env.CLOUD_STORAGE_ONLY === '1';
export const MAX_UPLOAD = 1024 * 1024 * 800; // 800 MB render uploads

if (!IS_CLOUDFLARE) fs.mkdirSync(ASSET_DIR, { recursive: true });

function hasBin(bin: string) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
// ffmpeg: FFMPEG_PATH, then one on PATH, then the copy the ffmpeg-static package downloaded into node_modules.
const bundledFfmpeg = () => { const p = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg'); return fs.existsSync(p) ? p : ''; };
export const FFMPEG = IS_CLOUDFLARE ? '' : process.env.FFMPEG_PATH || (hasBin('ffmpeg') ? 'ffmpeg' : bundledFfmpeg());

// Claude Code CLI: writes scripts with the signed-in Claude account instead of an API key.
// Not on PATH when it only came with the VS Code extension, so look there too (newest version first).
function findClaude() {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  if (hasBin('claude')) return 'claude';
  const home = os.homedir();
  const local = path.join(home, '.claude', 'local', 'claude');
  if (fs.existsSync(local)) return local;
  for (const dir of [path.join(home, '.vscode', 'extensions'), path.join(home, '.cursor', 'extensions')]) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((n) => n.startsWith('anthropic.claude-code-')); } catch { continue; }
    names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const n of names) {
      const bin = path.join(dir, n, 'resources', 'native-binary', 'claude');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return '';
}
export const CLAUDE_CLI = IS_CLOUDFLARE ? '' : findClaude();
