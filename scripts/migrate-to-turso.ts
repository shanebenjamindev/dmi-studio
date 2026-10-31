// Copies application rows into an EMPTY Turso database. Source stays read-only.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { DATA_DIR } from '../server/config';
import { migrateData } from './migrate-data';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('Đặt TURSO_DATABASE_URL và TURSO_AUTH_TOKEN trong .env trước khi chuyển dữ liệu');
}
const sourcePath = path.resolve(process.argv[2] || path.join(DATA_DIR, 'studio.db'));
if (!fs.existsSync(sourcePath)) throw new Error('Không tìm thấy file SQLite nguồn');
// Import only after checking credentials and the source file.
const { db: target } = await import('../server/db');
const source = createClient({ url: pathToFileURL(sourcePath).href });
try {
  const counts = await migrateData(source, target);
  console.log('Đã chuyển dữ liệu:', counts);
  console.log('Hãy đăng nhập lại và chọn thư mục Google Drive trên bản cloud. File video local không được chuyển.');
} finally {
  source.close();
  target.close();
}
