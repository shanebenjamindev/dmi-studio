/**
 * CLI for migrating DMI Workspace databases (SQLite local or Cloudflare D1) to the Brand hierarchy.
 *
 * Usage examples:
 *   node --import tsx scripts/migrate-brand-hierarchy.ts --check --from-sql data/backups/d1-latest.sql
 *   node --import tsx scripts/migrate-brand-hierarchy.ts --db data/studio.db
 *   node --import tsx scripts/migrate-brand-hierarchy.ts --from-sql data/backups/d1-latest.sql --emit-sql data/backups/brand-migrate-d1.sql
 *   node --import tsx scripts/migrate-brand-hierarchy.ts --d1-remote --yes
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  buildMigrationStatements,
  inspectMigration,
  migrateToBrandHierarchy,
  snapshotStats,
  type QueryClient,
} from '../server/brand-migration';

export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      cur += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      inLineComment = true;
      cur += ch;
      continue;
    }
    if (!inDouble && ch === "'") {
      cur += ch;
      if (inSingle && next === "'") {
        cur += next;
        i++;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      cur += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === ';') {
      const trimmed = cur.trim();
      if (trimmed) out.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

export function sqliteQueryClient(sqlite: DatabaseSync): QueryClient {
  return {
    async execute(statement) {
      const { sql, args = [] } = typeof statement === 'string' ? { sql: statement } : statement;
      const stmt = sqlite.prepare(sql);
      const norm = args.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v)) as any[];
      if (stmt.columns().length > 0) {
        return { rows: stmt.all(...norm) as any[] };
      }
      const res = stmt.run(...norm);
      return { rows: [], rowsAffected: Number(res.changes) };
    },
  };
}

export function loadDumpIntoSqlite(sqlite: DatabaseSync, dumpPath: string) {
  const raw = fs.readFileSync(dumpPath, 'utf8');
  const stmts = splitSqlStatements(raw).filter((s) => !/^PRAGMA\b/i.test(s));
  const creates = stmts.filter((s) => /^CREATE\s+TABLE\b/i.test(s));
  const inserts = stmts.filter((s) => !/^CREATE\b/i.test(s));
  const indexes = stmts.filter((s) => /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(s));
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    sqlite.exec([...creates, ...inserts, ...indexes].join(';\n') + ';');
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

function d1QueryClient(targetFlag: '--local' | '--remote', persistTo?: string): QueryClient {
  const baseArgs = ['wrangler', 'd1', 'execute', 'dmi-studio-db', targetFlag, '--json'];
  if (persistTo) baseArgs.push('--persist-to', persistTo);
  return {
    async execute(statement) {
      let { sql, args = [] } = typeof statement === 'string' ? { sql: statement } : statement;
      for (const arg of args) {
        const lit =
          arg === null || arg === undefined
            ? 'NULL'
            : typeof arg === 'number' || typeof arg === 'bigint'
              ? String(arg)
              : `'${String(arg).replace(/'/g, "''")}'`;
        sql = sql.replace('?', lit);
      }
      const out = execFileSync('npx', [...baseArgs, '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      return { rows: first?.results || [], rowsAffected: Number(first?.meta?.changes || 0) };
    },
  };
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags.set(a.slice(2), argv[++i]);
    } else {
      flags.set(a.slice(2), true);
    }
  }
  return flags;
}

async function runCli() {
  const flags = parseArgs(process.argv.slice(2));
  const checkOnly = !!flags.get('check') || !!flags.get('dry-run');
  const allowFallback = !!flags.get('allow-fallback');
  const strict = !allowFallback;
  const fromSql = typeof flags.get('from-sql') === 'string' ? String(flags.get('from-sql')) : '';
  const dbPath = typeof flags.get('db') === 'string' ? String(flags.get('db')) : fromSql ? ':memory:' : path.join('data', 'studio.db');
  const emitSql = typeof flags.get('emit-sql') === 'string' ? String(flags.get('emit-sql')) : '';
  const ownerOverride = typeof flags.get('owner') === 'string' ? String(flags.get('owner')) : undefined;
  const anomalyOut = typeof flags.get('anomalies-out') === 'string'
    ? String(flags.get('anomalies-out'))
    : path.join('data', 'backups', 'brand-migration-anomalies.json');

  const useD1Remote = !!flags.get('d1-remote');
  const useD1Local = !!flags.get('d1-local');

  if (useD1Remote && !flags.get('yes')) {
    throw new Error('Refusing --d1-remote without --yes confirmation. Always run npm run db:backup first.');
  }

  let sqlite: DatabaseSync | null = null;
  let client: QueryClient;

  if (useD1Remote || useD1Local) {
    const persistTo = typeof flags.get('persist-to') === 'string' ? String(flags.get('persist-to')) : undefined;
    client = d1QueryClient(useD1Remote ? '--remote' : '--local', persistTo);
  } else {
    if (!fromSql && dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
      throw new Error(`SQLite database not found: ${dbPath}`);
    }
    if (!checkOnly && !emitSql && dbPath !== ':memory:' && !flags.get('no-backup') && fs.existsSync(dbPath)) {
      const bak = `${dbPath}.bak-${Date.now()}`;
      fs.copyFileSync(dbPath, bak);
      console.log(`Backup created: ${bak}`);
    }
    sqlite = new DatabaseSync(dbPath);
    if (fromSql) loadDumpIntoSqlite(sqlite, fromSql);
    sqlite.exec('PRAGMA foreign_keys = ON');
    client = sqliteQueryClient(sqlite);
  }

  try {
    const report = await inspectMigration(client, ownerOverride);
    if (report.anomalies.length > 0) {
      fs.mkdirSync(path.dirname(anomalyOut), { recursive: true });
      fs.writeFileSync(anomalyOut, JSON.stringify(report.anomalies, null, 2));
      console.warn(`Exported ${report.anomalies.length} tj_ anomalies to ${anomalyOut}`);
    }

    if (checkOnly) {
      const stats = await snapshotStats(client);
      console.log(JSON.stringify({ mode: 'check', stats, report }, null, 2));
      if (strict && report.anomalies.length > 0) process.exitCode = 2;
      return;
    }

    if (emitSql) {
      const { statements } = await buildMigrationStatements(client, { strict, allowFallbackService: allowFallback, googleAccountOwnerId: ownerOverride });
      fs.mkdirSync(path.dirname(emitSql), { recursive: true });
      fs.writeFileSync(emitSql, statements.map((s) => `${s};`).join('\n\n') + '\n');
      console.log(`Wrote ${statements.length} migration SQL statements to ${emitSql}`);
      return;
    }

    if (useD1Remote || useD1Local) {
      const before = await snapshotStats(client);
      const { statements } = await buildMigrationStatements(client, { strict, allowFallbackService: allowFallback, googleAccountOwnerId: ownerOverride });
      const tmpSql = path.join('data', 'backups', `d1-brand-migrate-${Date.now()}.sql`);
      fs.mkdirSync(path.dirname(tmpSql), { recursive: true });
      fs.writeFileSync(tmpSql, statements.map((s) => `${s};`).join('\n') + '\n');
      const d1Args = ['wrangler', 'd1', 'execute', 'dmi-studio-db', useD1Remote ? '--remote' : '--local', '--yes', '--file', tmpSql];
      if (typeof flags.get('persist-to') === 'string') d1Args.push('--persist-to', String(flags.get('persist-to')));
      execFileSync('npx', d1Args, { stdio: 'inherit' });
      const after = await snapshotStats(client);
      console.log(JSON.stringify({ mode: useD1Remote ? 'd1-remote' : 'd1-local', statements: statements.length, before, after }, null, 2));
      return;
    }

    sqlite!.exec('BEGIN');
    let result;
    try {
      result = await migrateToBrandHierarchy(client, { strict, allowFallbackService: allowFallback, googleAccountOwnerId: ownerOverride });
      sqlite!.exec('COMMIT');
    } catch (err) {
      try { sqlite!.exec('ROLLBACK'); } catch { /* ignore rollback error */ }
      throw err;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    sqlite?.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate-brand-hierarchy.ts')) {
  runCli().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

