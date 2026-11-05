// Lists the Vietnamese interface text (web, server messages, shared) that has no English in web/src/i18n/en.ts yet,
// as JSON on stdout: literals, JSX text, and templates with their values written {0}, {1}…
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const known = new Set([...fs.readFileSync(path.join(root, 'web/src/i18n/en.ts'), 'utf8').matchAll(/^ {2}("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1])));

const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!['node_modules', 'dist', 'i18n'].includes(f.name)) walk(p); }
    else if (/\.tsx?$/.test(f.name) && !f.name.endsWith('.d.ts')) files.push(p);
  }
};
for (const d of ['web/src', 'server', 'shared']) walk(path.join(root, d));

const missing = new Set();
const add = (s) => {
  s = s.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s && VI.test(s) && s.length <= 600 && !/^(UPDATE|INSERT|SELECT|DELETE|CREATE)\b/.test(s) && !known.has(s)) missing.add(s);
};
// JSX text is drawn with each line trimmed and the lines joined by a space.
const jsx = (t) => (t.includes('\n') ? t.split('\n').map((l) => l.trim()).filter(Boolean).join(' ') : t);
for (const f of files) {
  const src = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
    else if (ts.isTemplateExpression(n)) add(n.templateSpans.reduce((s, sp, i) => `${s}{${i}}${sp.literal.text}`, n.head.text));
    else if (ts.isJsxText(n)) add(jsx(n.text));
    ts.forEachChild(n, visit);
  };
  visit(src);
}
console.log(JSON.stringify([...missing], null, 1));
