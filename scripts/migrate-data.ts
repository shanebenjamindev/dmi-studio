import type { Client, Transaction } from '@libsql/client';

// Copy rows atomically, refusing to merge into any populated target.
export async function migrateData(source: Client, target: Client) {
  const tables = ['users', 'settings', 'customers', 'projects', 'assets', 'jobs', 'renders', 'ai_calls'];
  let read: Transaction | undefined;
  let write: Transaction | undefined;
  try {
    await source.execute('PRAGMA query_only = ON');
    read = await source.transaction('read');
    write = await target.transaction('write');
    for (const table of [...tables, 'sessions']) {
      const r = await write.execute(`SELECT COUNT(*) AS n FROM ${table}`);
      if (Number(r.rows[0].n)) throw new Error('Database đích đã có dữ liệu; dừng để tránh ghi đè hoặc trộn dữ liệu');
    }
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const exists = await read.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [table] });
      if (!exists.rows.length) continue;
      const data = await read.execute(`SELECT * FROM ${table}`);
      const targetColumns = (await write.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
      const columns = data.columns.filter((c) => targetColumns.includes(c));
      if (!columns.length) continue;
      const sql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
      for (let offset = 0; offset < data.rows.length; offset += 50) {
        await write.batch(data.rows.slice(offset, offset + 50).map((row) => ({ sql, args: columns.map((c) => row[c]) })));
      }
      counts[table] = data.rows.length;
    }
    await write.commit();
    return counts;
  } catch (e) {
    if (write && !write.closed) await write.rollback();
    throw e;
  } finally {
    if (read && !read.closed) await read.rollback();
  }
}
