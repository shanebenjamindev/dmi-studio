// Script writing. Claude Code CLI forces a JSON-schema answer so the result is always a valid storyboard.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { findProvider } from './registry';
import { STORYBOARD_SCHEMA, SYSTEM } from '../storyboard';
import { mockStoryboard } from './mock';
import { CLAUDE_CLI } from '../config';

export class ProviderError extends Error {
  constructor(msg: string, public status = 502) { super(msg); }
}

/** A picture shown to the model right after its text label, e.g. a source thumbnail. */
export interface PromptImage { label: string; mime: string; data: Buffer }

export async function writeStoryboard(providerId: string, model: string, userContent: string,
  o: { images?: PromptImage[]; schema?: any; system?: string } = {}): Promise<any> {
  const p = findProvider(providerId);
  if (!p || p.kind !== 'llm') throw new ProviderError('Không hỗ trợ nhà cung cấp: ' + providerId, 400);
  if (p.mock) return mockStoryboard(userContent);
  return await claudeCli(model || 'sonnet', userContent, o.images || [], o.schema || STORYBOARD_SCHEMA, o.system || SYSTEM);
}

/** Any structured answer from Claude CLI with its own system prompt (e.g. reading a request form). */
export async function askClaude(model: string, system: string, userContent: string, schema: any) {
  return await claudeCli(model, userContent, [], schema, system);
}

// Headless Claude Code with no tools, settings or MCP servers: a single structured answer.
// ANTHROPIC_API_KEY is removed so the CLI uses the signed-in Claude account, never API credit.
// With images the prompt goes in as one stream-json message (text + image blocks) instead of plain stdin.
function claudeCli(model: string, userContent: string, images: PromptImage[], schema: any, system: string): Promise<any> {
  if (!CLAUDE_CLI) return Promise.reject(new ProviderError('Không tìm thấy lệnh claude trên máy chủ. Cài Claude Code hoặc đặt CLAUDE_CLI_PATH.', 400));
  const stream = images.length > 0;
  const args = ['-p', ...(stream ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
    '--json-schema', JSON.stringify(schema), '--system-prompt', system,
    '--model', model, '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence'];
  const { ANTHROPIC_API_KEY: _, ...env } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_CLI, args, { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new ProviderError('Claude CLI quá 8 phút không trả lời.', 504)); }, 8 * 60e3);
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('error', (e) => { clearTimeout(timer); reject(new ProviderError('Không chạy được Claude CLI: ' + e.message)); });
    child.on('close', () => {
      clearTimeout(timer);
      let r: any;
      try { r = stream ? JSON.parse(out.trim().split('\n').reverse().find((l) => l.includes('"type":"result"')) || '') : JSON.parse(out); } catch { return reject(new ProviderError(`Claude CLI: ${(err || out).trim().slice(0, 400) || 'không có kết quả'}`)); }
      if (r.is_error || !r.structured_output) return reject(new ProviderError(`Claude CLI: ${String(r.result || r.subtype || 'không trả về kết quả').slice(0, 400)}`));
      resolve(r.structured_output);
    });
    if (!stream) return child.stdin.end(userContent);
    const content: any[] = [];
    for (const im of images) content.push({ type: 'text', text: im.label }, { type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data.toString('base64') } });
    content.push({ type: 'text', text: userContent });
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  });
}
