// Catalog of AI platforms. Only Claude Code CLI (the signed-in Claude account) is offered: no paid API keys.
// Model lists are defaults only — the UI accepts a custom model ID.
import { MOCK, CLAUDE_CLI } from '../config';
import { getSetting, setSetting } from '../db';

export type Kind = 'llm' | 'video' | 'image' | 'tts';
export interface ModelDef { id: string; label: string; note?: string }
export interface ProviderDef {
  id: string;
  name: string;
  vendor: string;
  kind: Kind;
  keyEnv: string;          // env var / settings key holding the credential
  keyHint?: string;
  docs?: string;
  models: ModelDef[];
  voices?: string[];
  note?: string;
  mock?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  // ---------------------------------------------------------------- script writers (LLM)
  {
    id: 'claude-cli', name: 'Claude (CLI)', vendor: 'Claude Code · tài khoản Claude, không cần API key', kind: 'llm', keyEnv: '',
    note: 'Chạy lệnh claude trên máy chủ bằng tài khoản Claude đã đăng nhập. Đặt CLAUDE_CLI_PATH nếu không tự tìm thấy.',
    models: [
      { id: 'sonnet', label: 'Sonnet', note: 'nhanh, cân bằng' },
      { id: 'opus', label: 'Opus', note: 'sáng tạo nhất' },
      { id: 'haiku', label: 'Haiku', note: 'siêu nhanh' },
    ],
  },
];

// Offline providers used for demos and automated tests (DMS_MOCK=1).
const MOCKS: ProviderDef[] = [
  { id: 'mock-llm', name: 'Demo (offline)', vendor: 'DM Studio', kind: 'llm', keyEnv: '', mock: true, models: [{ id: 'demo', label: 'Kịch bản mẫu' }] },
  { id: 'mock-video', name: 'Demo video', vendor: 'DM Studio (ffmpeg)', kind: 'video', keyEnv: '', mock: true, models: [{ id: 'demo', label: 'Clip thử nghiệm' }] },
  { id: 'mock-image', name: 'Demo image', vendor: 'DM Studio (ffmpeg)', kind: 'image', keyEnv: '', mock: true, models: [{ id: 'demo', label: 'Ảnh thử nghiệm' }] },
  { id: 'mock-tts', name: 'Demo voice', vendor: 'DM Studio (ffmpeg)', kind: 'tts', keyEnv: '', mock: true, models: [{ id: 'demo', label: 'Âm thử' }], voices: ['beep'] },
];

export const allProviders = () => (MOCK ? [...PROVIDERS, ...MOCKS] : PROVIDERS);
export const findProvider = (id: string) => allProviders().find((p) => p.id === id);

// ---------------------------------------------------------------- credentials
export const KEY_ENVS = [...new Set(PROVIDERS.map((p) => p.keyEnv).filter(Boolean))];

export async function getKey(env: string): Promise<string> {
  if (!env) return 'mock';
  return await getSetting<string>('key:' + env, '') || process.env[env] || '';
}
export async function keySource(env: string): Promise<'saved' | 'env' | 'none'> {
  if (await getSetting<string>('key:' + env, '')) return 'saved';
  return process.env[env] ? 'env' : 'none';
}
export async function setKey(env: string, value: string) {
  if (!KEY_ENVS.includes(env)) throw new Error('Không rõ biến khoá: ' + env);
  await setSetting('key:' + env, value?.trim() || null);
}
export const mask = (k: string) => (k ? k.slice(0, 5) + '…' + k.slice(-4) : '');

export async function customModels(): Promise<Record<string, string[]>> { return await getSetting('custom_models', {}); }

export async function publicCatalog() {
  const custom = await customModels();
  return await Promise.all(allProviders().map(async (p) => ({
    id: p.id, name: p.name, vendor: p.vendor, kind: p.kind, keyEnv: p.keyEnv, keyHint: p.keyHint,
    docs: p.docs, note: p.note, voices: p.voices, mock: !!p.mock,
    configured: p.mock ? true : p.id === 'claude-cli' ? !!CLAUDE_CLI : !!await getKey(p.keyEnv),
    models: [...p.models, ...(custom[p.id] || []).filter((id) => !p.models.some((m) => m.id === id)).map((id) => ({ id, label: id, custom: true }))],
  })));
}
