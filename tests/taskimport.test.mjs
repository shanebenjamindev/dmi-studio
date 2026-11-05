// Reading the team task app's export (the shape of a real one: grouped by assignee, quoted multi-line cells, entities).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTaskExport, readTaskSheet, parseVnDate, statusKey, normName, decodeEntities } from '../server/taskimport.ts';

const HEAD = 'Tên công việc\tTrạng thái\tThời gian bắt đầu\tThời hạn\tThời gian hoàn thành\tDự án\tCông việc cha\tDanh sách nhãn\tTạo bởi\tGiao cho\tMô tả\tKết quả công việc\tCập nhật gần nhất\tMã công việc (ID)';
const EXPORT = [
  HEAD,
  'Bang Manh (2)\t\t\t\t\t\t\t\t\t\t\t\t\t',
  '[Shop A] Tạo tài khoản admin\tHoàn thành\t\t23:59 30/10/2026\t08:27 30/10/2026\tDev Daily Task\t\t\tNguyễn Đình Duy\tBang Manh\t"Vấn đề: khách không đăng nhập được.\n Nhờ: tạo user mới, role Administrator."\t"user@example.com\nsecret"\t09:45 03/11/2026 \t11722060',
  'Shop B | Theme 5 | Content Workbook\tHoàn thành muộn\t\t23:59 23/07/2026\t09:43 03/11/2026\tDev Daily Task\thttps://template05.example.com/ &#124; Shop B &#124; Theme 5\tWeb, Gấp\tNguyễn Đình Duy\tBang Manh, Ta Tri Dat Maxx\tNhờ xem &#34;file&#34; &amp; cập nhật theme&#039;s content: v&#61;1\t\t09:43 03/11/2026 \t11109341',
  'Nguyen Vu Khanh Duy (1)\t\t\t\t\t\t\t\t\t\t\t\t\t',
  'LSA | Shop C | Setup\tQuá hạn\t\t18:00 03/11/2026\t\tMASTER &#124; Shop C\t\t\tNguyễn Đình Duy\tNguyen Vu Khanh Duy\tMobile only\t\t08:13 03/11/2026 \t11755916',
].join('\n');

test('Tasks: an export grouped by assignee becomes its tasks, with quoted line breaks and entities decoded', () => {
  const { rows, skipped, columns } = readTaskExport(EXPORT);
  assert.equal(rows.length, 3);
  assert.equal(skipped, 2, 'the two "Name (n)" group rows are not tasks');
  assert.equal(columns.length, 14);
  const [a, b, c] = rows;
  assert.equal(a.externalId, '11722060');
  assert.equal(a.description, 'Vấn đề: khách không đăng nhập được.\n Nhờ: tạo user mới, role Administrator.');
  assert.equal(a.result, 'user@example.com\nsecret');
  assert.deepEqual(a.assignees, ['Bang Manh']);
  assert.equal(b.parent, 'https://template05.example.com/ | Shop B | Theme 5');
  assert.equal(b.description, 'Nhờ xem "file" & cập nhật theme\'s content: v=1');
  assert.deepEqual(b.labels, ['Web', 'Gấp']);
  assert.deepEqual(b.assignees, ['Bang Manh', 'Ta Tri Dat Maxx']);
  assert.equal(c.project, 'MASTER | Shop C');
  assert.equal(c.doneAt, null);
});

test('Tasks: times are Vietnam time; bad dates are left out', () => {
  assert.equal(parseVnDate('23:59 30/10/2026'), Date.parse('2026-10-30T23:59:00+07:00'));
  assert.equal(parseVnDate('30/10/2026 08:27'), Date.parse('2026-10-30T08:27:00+07:00'));
  assert.equal(parseVnDate('03/11/2026'), Date.parse('2026-11-03T00:00:00+07:00'));
  assert.equal(parseVnDate(''), null);
  assert.equal(parseVnDate('31/13/2026'), null);
});

test('Tasks: status words sort into kinds; names compare without marks', () => {
  assert.equal(statusKey('Hoàn thành'), 'done');
  assert.equal(statusKey('Hoàn thành muộn'), 'done_late');
  assert.equal(statusKey('Quá hạn'), 'overdue');
  assert.equal(statusKey('Đang thực hiện'), 'doing');
  assert.equal(statusKey('Chưa thực hiện'), 'todo');
  assert.equal(statusKey('Tạm dừng'), 'paused');
  assert.equal(statusKey('Đã hủy'), 'cancelled');
  assert.equal(normName('  Nguyễn  Đình Duy '), 'nguyen dinh duy');
  assert.equal(decodeEntities('a &#124; b &#x3D; c'), 'a | b = c');
});

test('Tasks: a comma-separated file and one without the task column', () => {
  const csv = 'Tên công việc,Trạng thái,Mã công việc (ID)\n"Một, hai",Đang thực hiện,7\n';
  assert.deepEqual(readTaskExport(csv).rows.map((r) => [r.title, r.status, r.externalId]), [['Một, hai', 'Đang thực hiện', '7']]);
  assert.throws(() => readTaskExport('Khách\tGhi chú\nx\ty'), /Tên công việc/);
});

test('source sheets preserve original columns, unknown fields, groups and multiline cells', () => {
  const text='Custom first,Tên công việc,Mã công việc (ID),Result custom,,Giao cho\n,Person (2),,,,\n"A, B",Task one,101,"line 1\nline 2",Extra,Person\nX,Task two,102,&#124;,,Person';
  const sheet=readTaskSheet(text);
  assert.deepEqual(sheet.headers,['Custom first','Tên công việc','Mã công việc (ID)','Result custom','','Giao cho']);
  assert.equal(sheet.titleColumn,1);assert.equal(sheet.rows.length,3);
  assert.equal(sheet.rows[0][1],'Person (2)');assert.equal(sheet.rows[1][0],'A, B');assert.equal(sheet.rows[1][3],'line 1\nline 2');assert.equal(sheet.rows[2][3],'&#124;');
  const parsed=readTaskExport(text);assert.deepEqual(parsed.sourceRows,[1,2]);assert.equal(parsed.skipped,1);
});

test('a generic sheet needs no task schema and retains all columns',()=>{
  const sheet=readTaskSheet('Client ID;Client;Spend 30D;My custom note\nC01;Example;100;"Quoted; value"');
  assert.deepEqual(sheet.headers,['Client ID','Client','Spend 30D','My custom note']);assert.equal(sheet.titleColumn,-1);assert.equal(sheet.rows[0][3],'Quoted; value');
  assert.throws(()=>readTaskExport('Client ID;Client\nC01;Example'),/Tên công việc/);
  const introduction=readTaskSheet('Exported from team app\nCustom\tTên công việc\tID\nValue\tTask\t7');
  assert.deepEqual(introduction.headers,['Custom','Tên công việc','ID']);
});
