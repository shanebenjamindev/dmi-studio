import type { IncomingMessage } from 'node:http';
import { IS_CLOUDFLARE } from './config';
import { HttpError, publicOrigin } from './http';

export function turnstileConfig() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || '';
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || '';
  return { siteKey, required: !!siteKey || !!secret || (IS_CLOUDFLARE && process.env.TURNSTILE_REQUIRED !== '0') };
}

export async function verifyTurnstile(req: IncomingMessage, token: unknown, action: 'login' | 'setup') {
  const { required, siteKey } = turnstileConfig();
  if (!required) return; // Local development without Turnstile credentials.
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!siteKey || !secret) throw new HttpError(503, 'Xác minh người dùng chưa được cấu hình. Hãy liên hệ quản trị viên.');
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw new HttpError(400, 'Hãy hoàn thành xác minh không phải người máy.');
  const body = new URLSearchParams({ secret, response: token });
  const ip = req.headers['cf-connecting-ip'];
  if (typeof ip === 'string') body.set('remoteip', ip);
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Verification unavailable');
    result = await response.json() as typeof result;
  } catch { throw new HttpError(503, 'Chưa xác minh được người dùng. Vui lòng thử lại.'); }
  const hostname = new URL(publicOrigin(req)).hostname;
  if (!result.success || result.hostname !== hostname || result.action !== action) {
    throw new HttpError(403, 'Xác minh không hợp lệ hoặc đã hết hạn. Vui lòng xác minh lại.');
  }
}
