// DMI Studio — zero-dependency Node server
// Serves the web-app and proxies storyboard requests to the Claude API.
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- tiny .env loader -------------------------------------------------------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = process.env.PORT || 5173;
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

// ---- storyboard schema (Claude fills this via a forced tool call) -----------
const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: ['title', 'bullets', 'stat', 'quote', 'split', 'outro'] },
    headline: { type: 'string', description: 'Main on-screen text. Short and punchy (max ~8 words).' },
    subtext: { type: 'string', description: 'Secondary line (max ~14 words). Attribution for quotes, label for CTA, etc.' },
    bullets: { type: 'array', items: { type: 'string' }, description: 'For layout=bullets: 2-4 short items (max ~6 words each).' },
    stat_value: { type: 'string', description: 'For layout=stat: a number with optional prefix/suffix, e.g. "87%", "$2.4M", "10x".' },
    stat_label: { type: 'string' },
    icon: { type: 'string', description: 'A single emoji that represents the scene.' },
    caption: { type: 'string', description: 'Voice-over / subtitle sentence for this scene (natural spoken language).' },
    duration: { type: 'number', description: 'Seconds, 2.5 to 8.' },
    animation: { type: 'string', enum: ['fade', 'slide-up', 'zoom', 'typewriter', 'pop'] },
    background: { type: 'string', enum: ['gradient', 'particles', 'grid', 'waves', 'blobs', 'solid'] },
  },
  required: ['layout', 'headline', 'caption', 'duration', 'animation', 'background', 'icon'],
};

const STORYBOARD_TOOL = {
  name: 'create_storyboard',
  description: 'Return the complete storyboard for a short motion-graphics video.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      palette: {
        type: 'object',
        description: 'Hex colors. bg1/bg2 are background gradient stops; must have strong contrast with text.',
        properties: {
          bg1: { type: 'string' }, bg2: { type: 'string' },
          accent: { type: 'string' }, text: { type: 'string' },
        },
        required: ['bg1', 'bg2', 'accent', 'text'],
      },
      font: { type: 'string', enum: ['sans', 'serif', 'mono', 'display'] },
      music: {
        type: 'object',
        properties: {
          mood: { type: 'string', enum: ['calm', 'upbeat', 'epic', 'none'] },
          bpm: { type: 'number' },
        },
        required: ['mood', 'bpm'],
      },
      scenes: { type: 'array', items: SCENE_SCHEMA, minItems: 2 },
    },
    required: ['title', 'palette', 'font', 'music', 'scenes'],
  },
};

const SYSTEM = `You are the creative director inside DMI Studio, a tool that turns a short brief into a motion-graphics video rendered on an HTML canvas.
Rules:
- Write ALL on-screen text and captions in the same language as the user's brief (Vietnamese brief -> Vietnamese video) unless told otherwise.
- Structure: a hook first (title layout), a body that varies layouts (bullets, stat, quote, split), and an outro with a call-to-action.
- On-screen text must be short; put the fuller sentence in "caption".
- Pick a cohesive palette that fits the topic with readable contrast. Vary backgrounds and animations between scenes, but keep it tasteful.
- Total of scene durations should match the requested length (±10%).
- Never invent precise statistics presented as real facts unless the user provided them; for stats use clearly illustrative or user-given numbers.
Always answer by calling the create_storyboard tool.`;

async function callClaude({ apiKey, model, userContent }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [STORYBOARD_TOOL],
      tool_choice: { type: 'tool', name: 'create_storyboard' },
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude API error ${res.status}`);
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Claude did not return a storyboard.');
  return { storyboard: block.input, usage: data.usage, model: data.model };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return send(res, 200, { serverKey: !!process.env.ANTHROPIC_API_KEY, defaultModel: DEFAULT_MODEL });
  }

  if (req.method === 'POST' && (url.pathname === '/api/generate' || url.pathname === '/api/refine')) {
    try {
      const body = await readBody(req);
      const apiKey = req.headers['x-user-key'] || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return send(res, 400, { error: 'Chưa có Claude API key. Thêm vào file .env hoặc trong Cài đặt.' });

      let userContent;
      if (url.pathname === '/api/generate') {
        const { prompt, seconds = 30, aspect = '16:9', style = '' } = body;
        if (!prompt) return send(res, 400, { error: 'Thiếu nội dung mô tả.' });
        userContent = `Brief: ${prompt}\n\nTarget length: about ${seconds} seconds.\nAspect ratio: ${aspect}${aspect === '9:16' ? ' (vertical — keep headlines very short)' : ''}.\n${style ? `Visual style: ${style}.` : ''}`;
      } else {
        const { storyboard, instruction } = body;
        if (!storyboard || !instruction) return send(res, 400, { error: 'Thiếu storyboard hoặc yêu cầu chỉnh sửa.' });
        userContent = `Here is the current storyboard JSON:\n\n${JSON.stringify(storyboard)}\n\nApply this edit request and return the FULL updated storyboard (keep everything not mentioned unchanged):\n${instruction}`;
      }
      const out = await callClaude({ apiKey, model: body.model, userContent });
      return send(res, 200, out);
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  // static files
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🎬 DMI Studio đang chạy:  http://localhost:${PORT}`);
  console.log(`  Model mặc định: ${DEFAULT_MODEL}  |  API key trên server: ${process.env.ANTHROPIC_API_KEY ? 'có' : 'chưa có (nhập trong Cài đặt)'}\n`);
});
