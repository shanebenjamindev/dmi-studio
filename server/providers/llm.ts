// Script-writing adapters. Every adapter forces a structured "tool" call so the result is valid JSON.
import { getKey, findProvider } from './registry';
import { STORYBOARD_SCHEMA, TOOL_NAME, TOOL_DESC, SYSTEM } from '../storyboard';
import { mockStoryboard } from './mock';

const OPENAI_COMPAT: Record<string, { base: string; extraHeaders?: Record<string, string>; maxField: string }> = {
  openai: { base: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', maxField: 'max_completion_tokens' },
  openrouter: {
    base: 'https://openrouter.ai/api/v1', maxField: 'max_tokens',
    extraHeaders: { 'HTTP-Referer': 'http://localhost', 'X-Title': 'DM Studio' },
  },
};

export class ProviderError extends Error {
  constructor(msg: string, public status = 502) { super(msg); }
}

async function readError(res: Response) {
  const text = await res.text();
  try { const j = JSON.parse(text); return j?.error?.message || j?.message || j?.detail || text; } catch { return text.slice(0, 400); }
}

export async function writeStoryboard(providerId: string, model: string, userContent: string): Promise<any> {
  const p = findProvider(providerId);
  if (!p || p.kind !== 'llm') throw new ProviderError('Không hỗ trợ nhà cung cấp: ' + providerId, 400);
  if (p.mock) return mockStoryboard(userContent);
  const key = await getKey(p.keyEnv);
  if (!key) throw new ProviderError(`Chưa có API key cho ${p.name}. Mở ⚙︎ Cài đặt để thêm ${p.keyEnv}.`, 400);
  if (!model) throw new ProviderError('Chưa chọn model.', 400);

  if (providerId === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 8000, system: SYSTEM,
        tools: [{ name: TOOL_NAME, description: TOOL_DESC, input_schema: STORYBOARD_SCHEMA }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) throw new ProviderError(`Claude: ${await readError(res)}`, res.status);
    const data: any = await res.json();
    const block = (data.content || []).find((b: any) => b.type === 'tool_use');
    if (!block) throw new ProviderError('Claude không trả về storyboard.');
    return block.input;
  }

  const compat = OPENAI_COMPAT[providerId];
  if (compat) {
    const res = await fetch(`${compat.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(compat.extraHeaders || {}) },
      body: JSON.stringify({
        model,
        [compat.maxField]: 8000,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }],
        tools: [{ type: 'function', function: { name: TOOL_NAME, description: TOOL_DESC, parameters: STORYBOARD_SCHEMA } }],
        tool_choice: { type: 'function', function: { name: TOOL_NAME } },
      }),
    });
    if (!res.ok) throw new ProviderError(`${p.name}: ${await readError(res)}`, res.status);
    const data: any = await res.json();
    const msg = data.choices?.[0]?.message;
    const args = msg?.tool_calls?.[0]?.function?.arguments ?? msg?.content;
    if (!args) throw new ProviderError(`${p.name} không trả về storyboard.`);
    try {
      return typeof args === 'string' ? JSON.parse(args.replace(/^```(?:json)?\s*|\s*```$/g, '')) : args;
    } catch {
      throw new ProviderError(`${p.name} trả về JSON không hợp lệ.`);
    }
  }
  throw new ProviderError('Chưa có adapter cho ' + providerId, 400);
}
