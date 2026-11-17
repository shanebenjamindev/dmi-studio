// The mail itself for Hộp thư (server/mailbox.ts): writing a message to send through Gmail, and reading one Gmail
// returns. No calls out, so tests use it as it is.

export interface MailAttachment { name: string; type: string; data: Buffer }
export interface OutMail {
  from: { email: string; name?: string };
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string;
  /** The same text formatted (bold, lists, signature…); sent beside the plain one, as Gmail does. */
  html?: string;
  /** A reply: the Message-ID it answers and the References that came before it. */
  inReplyTo?: string; references?: string;
  attachments?: MailAttachment[];
}

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
/** Addresses typed as "a@x.com, b@y.com" (or "Name <a@x.com>"); throws on one that is not an address. */
export function parseAddresses(input: unknown): string[] {
  const parts = (Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]/)).map((p) => String(p).trim()).filter(Boolean);
  return [...new Set(parts.map((p) => {
    const email = (p.match(/<([^>]+)>\s*$/)?.[1] ?? p).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error(`Địa chỉ email không hợp lệ: ${p}`);
    return email;
  }))];
}

/** A header value that cannot start another header. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
/** A header word outside ASCII, as RFC 2047 says. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const b64lines = (b: Buffer) => b.toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');

/** The raw message Gmail's messages.send takes (before base64url). */
export function buildMime(m: OutMail, boundary = 'dmi' + Math.random().toString(36).slice(2)): string {
  const name = m.from.name ? oneLine(m.from.name).replace(/"/g, '') : '';
  const head = [
    `From: ${name ? `${word(name)} <${m.from.email}>` : m.from.email}`,
    `To: ${m.to.join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    // Gmail sends to Bcc and takes the header out of what the others get.
    ...(m.bcc?.length ? [`Bcc: ${m.bcc.join(', ')}`] : []),
    `Subject: ${word(oneLine(m.subject))}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${oneLine(m.inReplyTo)}`, `References: ${oneLine([m.references, m.inReplyTo].filter(Boolean).join(' '))}`] : []),
    'MIME-Version: 1.0',
  ];
  const plain = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(m.text))];
  // Formatted: the plain text and the HTML as alternatives of each other (mail apps show the one they can).
  const alt = boundary + 'a';
  const text = m.html ? [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, ...plain, `--${alt}`,
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(m.html)), `--${alt}--`] : plain;
  if (!m.attachments?.length) return [...head, ...text].join('\r\n');
  const parts = m.attachments.map((a) => {
    const file = oneLine(a.name).replace(/"/g, '') || 'file';
    return [`Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.type) ? a.type : 'application/octet-stream'}; name="${word(file)}"`, `Content-Disposition: attachment; filename="${word(file)}"`,
      'Content-Transfer-Encoding: base64', '', b64lines(a.data)].join('\r\n');
  });
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...[text.join('\r\n'), ...parts].map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`].join('\r\n');
}

/** A Gmail message part (format=full). */
export interface GPart { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GPart[] }
export const header = (p: GPart | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

function decode(data: string, contentType: string) {
  const bytes = Buffer.from(data, 'base64url'), charset = contentType.match(/charset="?([\w.:-]+)/i)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return bytes.toString('utf8'); }
}
/** What a message says (its HTML and plain text, the first of each) and the files that come with it. */
export function readParts(root: GPart) {
  let html = '', text = '';
  const attachments: { id: string; name: string; type: string; size: number }[] = [];
  const walk = (p: GPart) => {
    const type = (p.mimeType || '').toLowerCase();
    if (p.filename && p.body?.attachmentId) attachments.push({ id: p.body.attachmentId, name: p.filename, type: type || 'application/octet-stream', size: p.body.size || 0 });
    else if (type === 'text/html' && !html && p.body?.data) html = decode(p.body.data, header(p, 'content-type'));
    else if (type === 'text/plain' && !text && p.body?.data) text = decode(p.body.data, header(p, 'content-type'));
    for (const c of p.parts || []) walk(c);
  };
  walk(root);
  return { html, text, attachments };
}

/** "Name <a@x.com>" as its parts. */
export function person(value: string) {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() } : { name: value.trim(), email: value.trim().toLowerCase() };
}
