// Builds the React front-end into web/dist with esbuild. `--watch` rebuilds on change.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const dist = path.join(web, 'dist');
const watch = process.argv.includes('--watch');

fs.mkdirSync(dist, { recursive: true });
// Bundle the report stylesheet so HTML reports also render in Workers (no filesystem).
const reportCssModule = path.join(root, 'server/reports/template-css.ts');
const reportCssSource = '// Generated from template.css by scripts/build.mjs.\nexport default ' + JSON.stringify(fs.readFileSync(path.join(root,'server/reports/template.css'),'utf8')) + ';\n';
if (!fs.existsSync(reportCssModule) || fs.readFileSync(reportCssModule,'utf8') !== reportCssSource) fs.writeFileSync(reportCssModule,reportCssSource);

const copyStatic = () => {
  fs.cpSync(path.join(web, 'public'), dist, { recursive: true });
  fs.copyFileSync(path.join(web, 'index.html'), path.join(dist, 'index.html'));
};

const options = {
  entryPoints: { app: path.join(web, 'src', 'main.tsx') },
  outdir: dist,
  bundle: true,
  format: 'esm',
  // Heavy code used by one page only (the Tools page's media converters) loads when it is needed.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: ['chrome110', 'safari16', 'firefox115'],
  jsx: 'automatic',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
  plugins: [{ name: 'static', setup(b) {
    // Chunk names change with their content: start from an empty folder so old ones do not pile up.
    b.onStart(() => fs.rmSync(path.join(dist, 'chunks'), { recursive: true, force: true }));
    b.onEnd(() => copyStatic());
  } }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('  ↻ Đang theo dõi thay đổi giao diện…');
} else {
  await esbuild.build(options);
}
