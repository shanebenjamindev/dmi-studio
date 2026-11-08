// Builds the React front-end into web/dist with esbuild. `--watch` rebuilds on change.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const dist = path.join(web, 'dist');
const entry = path.join(web, 'src', 'main.tsx');
const watch = process.argv.includes('--watch');

// A build owns web/dist: start from nothing, so files from an older build are neither served nor uploaded.
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
// Bundle the report stylesheet so HTML reports also render in Workers (no filesystem).
const reportCssModule = path.join(root, 'server/reports/template-css.ts');
const reportCssSource = '// Generated from template.css by scripts/build.mjs.\nexport default ' + JSON.stringify(fs.readFileSync(path.join(root,'server/reports/template.css'),'utf8')) + ';\n';
if (!fs.existsSync(reportCssModule) || fs.readFileSync(reportCssModule,'utf8') !== reportCssSource) fs.writeFileSync(reportCssModule,reportCssSource);

/** The files the page needs at once: the entry and what it imports statically (not the pages loaded later). */
function initialFiles(outputs, start) {
  const files = new Set();
  const walk = (file) => {
    if (files.has(file)) return;
    files.add(file);
    for (const i of outputs[file].imports) if (i.kind === 'import-statement' && outputs[i.path]) walk(i.path);
  };
  walk(start);
  return [...files];
}

// index.html names this build's files and asks for the entry's chunks up front, instead of after the entry is read.
function writeIndex(outputs) {
  const url = (file) => '/' + path.relative(dist, path.join(root, file)).split(path.sep).join('/');
  const [js, out] = Object.entries(outputs).find(([, o]) => o.entryPoint === path.relative(root, entry));
  const preloads = initialFiles(outputs, js).filter((f) => f !== js).map((f) => `  <link rel="modulepreload" href="${url(f)}" />\n`).join('');
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8')
    .replace('"/app.css"', `"${url(out.cssBundle)}"`)
    .replace('"/app.js"', `"${url(js)}"`)
    .replace('</head>', preloads + '</head>');
  fs.writeFileSync(path.join(dist, 'index.html'), html);
}

// .br and .gz copies for the Node server to send to browsers that accept them (Cloudflare compresses by itself and
// skips them, see web/public/.assetsignore). Built once here at the best ratio, rather than on every request.
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const precompress = (files) => Promise.all(files.map(async (file) => {
  const data = fs.readFileSync(file);
  const [br, gz] = await Promise.all([brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }), gzip(data, { level: 9 })]);
  fs.writeFileSync(file + '.br', br);
  fs.writeFileSync(file + '.gz', gz);
}));

const options = {
  absWorkingDir: root,
  entryPoints: { app: entry },
  outdir: dist,
  bundle: true,
  format: 'esm',
  // Each page (and heavy code used by one page only, like the Tools page's media converters) loads when it is needed.
  splitting: true,
  // Every file the page loads has its content's hash in its name, so browsers keep it for good; only index.html,
  // which names them, is checked again on each visit.
  entryNames: 'static/[name]-[hash]',
  chunkNames: 'static/[name]-[hash]',
  metafile: true,
  target: ['chrome110', 'safari16', 'firefox115'],
  jsx: 'automatic',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
  plugins: [{ name: 'static', setup(b) {
    // Names change with their content: start from an empty folder so old ones do not pile up.
    b.onStart(() => fs.rmSync(path.join(dist, 'static'), { recursive: true, force: true }));
    b.onEnd(async ({ metafile }) => {
      if (!metafile) return;
      fs.cpSync(path.join(web, 'public'), dist, { recursive: true });
      writeIndex(metafile.outputs);
      if (!watch) await precompress(Object.keys(metafile.outputs).map((f) => path.join(root, f)));
    });
  } }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('  ↻ Đang theo dõi thay đổi giao diện…');
} else {
  await esbuild.build(options);
}
