// `npm run dev`: rebuild the UI on change and restart the API on change.
import { spawn } from 'node:child_process';

const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [
  run(process.execPath, ['scripts/build.mjs', '--watch']),
  run('npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts']),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
