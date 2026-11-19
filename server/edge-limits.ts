// Floods and spam are turned away at the Worker, before any database work (server/worker.ts), by Cloudflare's rate
// limiters (wrangler.jsonc › ratelimits; counted per Cloudflare location, free). Without the bindings (local, tests)
// nothing is limited.
// As Cloudflare's RateLimit binding, written here so the page's types stay free of the Workers ones.
type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };
export interface Limiters { API_LIMIT?: Limiter; AUTH_LIMIT?: Limiter; WRITE_LIMIT?: Limiter; CHAT_LIMIT?: Limiter }

// Signing in, password resets, a first admin, and Claude's connector registering itself: few per minute from one address.
const AUTH = /^\/api\/(auth\/(login|setup|forgot|reset)|oauth\/(register|token))$/;
const COOKIE = 'dms_sid'; // the session cookie (server/auth.ts)

/** The reason a request is turned away, or null to let it through. */
export async function limited(env: Limiters, method: string, path: string, ip: string, cookie: string): Promise<string | null> {
  const ok = async (l: Limiter | undefined, key: string) => !l || (await l.limit({ key })).success;
  // Every request from one address (an office shares one, so this is generous).
  if (!await ok(env.API_LIMIT, ip)) return 'Quá nhiều yêu cầu từ địa chỉ này, hãy thử lại sau ít phút.';
  if (method === 'GET' || method === 'HEAD') return null;
  if (AUTH.test(path) && !await ok(env.AUTH_LIMIT, ip)) return 'Thử quá nhiều lần, hãy đợi một phút rồi thử lại.';
  // Changes, per signed-in session (or per address without one), and chat messages more tightly.
  const who = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || ip;
  if (!await ok(env.WRITE_LIMIT, who)) return 'Bạn thao tác quá nhanh, hãy đợi một chút rồi thử lại.';
  if (path === '/api/chat/messages' && !await ok(env.CHAT_LIMIT, who)) return 'Bạn gửi tin quá nhanh, hãy đợi vài giây.';
  return null;
}
