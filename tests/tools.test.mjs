// The Tools page's text converters (subtitles, tables, zip). Video, audio and pictures need a browser (WebCodecs, canvas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSubtitle, convertTable } from '../web/src/tools/text.ts';
import { unzip, zip } from '../web/src/tools/zip.ts';

const file = (name, text) => new File([text], name);
// Blob.text() drops a BOM; these files must keep it, so decode the bytes as they are.
const raw = async (blob) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());

test('Tools: SRT to VTT and back keeps times and Vietnamese text', async () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nXin chào <i>các bạn</i>\r\n\r\n2\r\n00:00:04,000 --> 00:01:06,250\r\nĐánh bóng xe\r\n';
  const vtt = await (await convertSubtitle(file('a.srt', srt), 'vtt')).text();
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nXin chào <i>các bạn</i>\n\n00:00:04.000 --> 00:01:06.250\nĐánh bóng xe\n');
  const back = await (await convertSubtitle(file('a.vtt', vtt), 'srt')).text();
  assert.equal(back, srt.replace(/\r/g, ''));
  assert.equal(await (await convertSubtitle(file('a.srt', srt), 'txt')).text(), 'Xin chào các bạn\nĐánh bóng xe\n');
  await assert.rejects(convertSubtitle(file('a.srt', 'not subtitles'), 'vtt'), /Không thấy dòng phụ đề/);
});

test('Tools: CSV with semicolons, quotes and line breaks to JSON, TSV and Excel', async () => {
  const csv = 'Tên;SĐT;Ghi chú\r\nNguyễn Văn A;0901234567;"Có ; và ""ngoặc"""\r\nB;12;"Hai\ndòng"\r\n';
  const json = JSON.parse(await (await convertTable(file('d.csv', csv), 'csv', 'json')).text());
  assert.deepEqual(json, [
    { 'Tên': 'Nguyễn Văn A', 'SĐT': '0901234567', 'Ghi chú': 'Có ; và "ngoặc"' },
    { 'Tên': 'B', 'SĐT': '12', 'Ghi chú': 'Hai\ndòng' },
  ]);
  const tsv = await raw(await convertTable(file('d.csv', csv), 'csv', 'tsv'));
  assert.ok(tsv.startsWith('\ufeffTên\tSĐT\tGhi chú\r\n'), 'TSV starts with a BOM so Excel reads UTF-8');
  const xlsx = await convertTable(file('Khách hàng.csv', csv), 'csv', 'xlsx');
  const parts = await unzip(await xlsx.arrayBuffer());
  assert.ok(parts.has('[Content_Types].xml') && parts.has('xl/workbook.xml'));
  const sheet = new TextDecoder().decode(parts.get('xl/worksheets/sheet1.xml'));
  // A phone number keeps its leading zero (text); a plain number is a number.
  assert.match(sheet, /<c r="B2" t="inlineStr"><is><t xml:space="preserve">0901234567<\/t>/);
  assert.match(sheet, /<c r="B3"><v>12<\/v><\/c>/);
  assert.match(sheet, /&quot;ngoặc&quot;/);
  assert.match(new TextDecoder().decode(parts.get('xl/workbook.xml')), /name="Khách hàng"/);
});

test('Tools: JSON arrays of objects become rows; bad JSON is reported', async () => {
  const csv = await raw(await convertTable(file('d.json', JSON.stringify([{ a: 1, b: { x: 2 } }, { b: 'y', c: true }])), 'json', 'csv'));
  assert.equal(csv, '\ufeffa,b,c\r\n1,"{""x"":2}",\r\n,y,true\r\n');
  await assert.rejects(convertTable(file('d.json', '{oops'), 'json', 'csv'), /JSON không hợp lệ/);
});

test('Tools: zip round-trips stored entries with UTF-8 names', async () => {
  const blob = zip([{ name: 'ảnh 1.txt', data: new TextEncoder().encode('một') }, { name: 'b.bin', data: new Uint8Array([0, 255, 7]) }]);
  const parts = await unzip(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(parts.get('ảnh 1.txt')), 'một');
  assert.deepEqual([...parts.get('b.bin')], [0, 255, 7]);
});
