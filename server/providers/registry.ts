// Catalog of every AI platform DM Studio can talk to.
// Model lists are defaults only — every provider accepts a custom model / endpoint ID from the UI,
// because vendors ship new model IDs faster than this file changes.
import { MOCK } from '../config';
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
    id: 'anthropic', name: 'Claude', vendor: 'Anthropic', kind: 'llm', keyEnv: 'ANTHROPIC_API_KEY',
    keyHint: 'sk-ant-…', docs: 'https://console.anthropic.com',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'nhanh, cân bằng' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'sáng tạo nhất' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'siêu nhanh' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    ],
  },
  {
    id: 'openai', name: 'GPT', vendor: 'OpenAI', kind: 'llm', keyEnv: 'OPENAI_API_KEY',
    keyHint: 'sk-…', docs: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', note: 'rẻ' },
    ],
  },
  {
    id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter (Gemini, DeepSeek, Llama…)', kind: 'llm', keyEnv: 'OPENROUTER_API_KEY',
    keyHint: 'sk-or-…', docs: 'https://openrouter.ai/models',
    note: 'Một key dùng được hàng trăm model — dán model ID từ openrouter.ai/models.',
    models: [],
  },

  // ---------------------------------------------------------------- video clips
  {
    id: 'seedance', name: 'Seedance', vendor: 'ByteDance · BytePlus ModelArk', kind: 'video', keyEnv: 'ARK_API_KEY',
    docs: 'https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api',
    note: 'Đổi vùng bằng ARK_BASE_URL. Seedance 2.x: dán model ID từ console ModelArk.',
    models: [
      { id: 'seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro' },
      { id: 'seedance-1-0-lite-t2v-250428', label: 'Seedance 1.0 Lite' },
    ],
  },
  {
    id: 'higgsfield', name: 'Higgsfield', vendor: 'Higgsfield AI', kind: 'video', keyEnv: 'HIGGSFIELD_API_KEY',
    keyHint: 'KEY_ID:KEY_SECRET', docs: 'https://docs.higgsfield.ai',
    note: 'Model = endpoint ID trong docs Higgsfield (vd. alibaba/happy-horse/text-to-video).',
    models: [{ id: 'alibaba/happy-horse/text-to-video', label: 'Happy Horse 1.0 (text→video)' }],
  },
  {
    id: 'fal', name: 'fal.ai', vendor: 'fal.ai (Kling, Veo, Seedance, Hailuo…)', kind: 'video', keyEnv: 'FAL_KEY',
    docs: 'https://fal.ai/models',
    note: 'Một key cho nhiều model video — dán endpoint ID từ fal.ai/models.',
    models: [
      { id: 'fal-ai/kling-video/v2.1/master/text-to-video', label: 'Kling 2.1 Master' },
      { id: 'fal-ai/bytedance/seedance/v1/pro/text-to-video', label: 'Seedance 1 Pro (qua fal)' },
      { id: 'fal-ai/veo3', label: 'Google Veo 3' },
    ],
  },

  // ---------------------------------------------------------------- still images
  {
    id: 'openai-image', name: 'GPT Image', vendor: 'OpenAI', kind: 'image', keyEnv: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-image-2', label: 'GPT Image 2' },
      { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
    ],
  },
  {
    id: 'fal-image', name: 'fal.ai Image', vendor: 'fal.ai (Flux…)', kind: 'image', keyEnv: 'FAL_KEY',
    models: [{ id: 'fal-ai/flux/dev', label: 'FLUX.1 dev' }],
  },

  // ---------------------------------------------------------------- voice-over
  {
    id: 'openai-tts', name: 'OpenAI TTS', vendor: 'OpenAI', kind: 'tts', keyEnv: 'OPENAI_API_KEY',
    models: [{ id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' }],
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'],
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
    configured: p.mock ? true : !!await getKey(p.keyEnv),
    models: [...p.models, ...(custom[p.id] || []).filter((id) => !p.models.some((m) => m.id === id)).map((id) => ({ id, label: id, custom: true }))],
  })));
}
