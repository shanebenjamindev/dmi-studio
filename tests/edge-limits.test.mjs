import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limited } from '../server/edge-limits.ts';

// A limiter that lets `max` requests through per key, recording the keys it was asked for.
const fake = (max) => { const n = new Map(), keys = []; return { keys, limit: async ({ key }) => { keys.push(key); n.set(key, (n.get(key) || 0) + 1); return { success: n.get(key) <= max }; } }; };

test('edge limits: per address, sign-ins, changes per session and chat messages', async () => {
  assert.equal(await limited({}, 'POST', '/api/auth/login', '1.1.1.1', ''), null, 'no bindings: nothing limited');

  const env = { API_LIMIT: fake(3), AUTH_LIMIT: fake(1), WRITE_LIMIT: fake(100), CHAT_LIMIT: fake(1) };
  assert.equal(await limited(env, 'POST', '/api/auth/login', '1.1.1.1', ''), null);
  assert.match(await limited(env, 'POST', '/api/auth/login', '1.1.1.1', ''), /Thử quá nhiều lần/);
  assert.equal(await limited(env, 'GET', '/api/live', '1.1.1.1', ''), null, 'reads skip the sign-in limit');
  assert.match(await limited(env, 'GET', '/api/live', '1.1.1.1', ''), /Quá nhiều yêu cầu/, 'every request counts per address');
  assert.equal(await limited(env, 'GET', '/api/live', '2.2.2.2', ''), null, 'another address is not affected');

  const chat = { CHAT_LIMIT: fake(1), WRITE_LIMIT: fake(100) };
  assert.equal(await limited(chat, 'POST', '/api/chat/messages', '3.3.3.3', 'a=1; dms_sid=s1'), null);
  assert.match(await limited(chat, 'POST', '/api/chat/messages', '3.3.3.3', 'dms_sid=s1'), /gửi tin quá nhanh/);
  assert.equal(await limited(chat, 'POST', '/api/chat/messages', '3.3.3.3', 'dms_sid=s2'), null, 'per session, not per office');
  assert.deepEqual(chat.CHAT_LIMIT.keys, ['s1', 's1', 's2']);
});
