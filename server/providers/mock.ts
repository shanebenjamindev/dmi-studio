// Offline providers (DMS_MOCK=1) for demos and automated tests. Media is synthesised with ffmpeg.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG } from '../config';
import { BRAND_PALETTES } from '../storyboard';
import type { Done, JobInput } from './media';

const pexec = promisify(execFile);

export function mockStoryboard(userContent: string) {
  const cur = userContent.match(/Current storyboard JSON:\n(.*)\n\nApply/s);
  if (cur) {
    const sb = JSON.parse(cur[1]);
    sb.title = sb.title.replace(/ \(đã chỉnh\)$/, '') + ' (đã chỉnh)';
    sb.palette = BRAND_PALETTES.blue;
    return sb;
  }
  const brief = (userContent.match(/^Brief: (.*)$/m)?.[1] || 'Video mới').slice(0, 60);
  return {
    title: brief,
    palette: BRAND_PALETTES.night, font: 'brand', music: { mood: 'upbeat', bpm: 112 },
    voice_style: 'Energetic, warm Vietnamese narrator.',
    scenes: [
      { layout: 'title', icon: '🚗', headline: 'Xe sạch như mới chỉ với 5 bước', subtext: 'Tự làm tại nhà', caption: 'Muốn xe luôn sạch bóng? Chỉ cần 5 bước đơn giản.', visual_prompt: 'Glossy black car under deep blue studio light, slow dolly in', duration: 4.5, animation: 'zoom', background: 'blobs' },
      { layout: 'bullets', icon: '🧽', headline: 'Chuẩn bị', bullets: ['2 xô nước + lưới lọc', 'Dung dịch pH trung tính', 'Khăn microfiber sạch'], caption: 'Chuẩn bị hai xô nước, dung dịch rửa và khăn microfiber.', visual_prompt: 'Detailing tools on a clean workshop table, cyan rim light', duration: 5, animation: 'slide-up', background: 'grid' },
      { layout: 'stat', icon: '✨', headline: 'Lau khô đúng cách', stat_value: '90%', stat_label: 'vết xoáy đến từ khăn bẩn', caption: 'Phần lớn vết xoáy đến từ khăn bẩn và lau sai. Số liệu minh hoạ.', visual_prompt: 'Macro shot microfiber towel gliding over wet glossy paint', duration: 4.5, animation: 'zoom', background: 'waves' },
      { layout: 'outro', icon: '🤝', headline: 'Tham gia cộng đồng detailer', subtext: 'Theo dõi ngay', caption: 'Owned by you, driven by us. Tham gia ngay hôm nay.', visual_prompt: 'Group of detailers around a shining car at night, blue neon', duration: 5, animation: 'pop', background: 'blobs' },
    ],
  };
}

export async function mockMedia(kind: string, i: JobInput): Promise<Done> {
  if (!FFMPEG) throw new Error('Chế độ demo cần ffmpeg để tạo media giả lập.');
  const [w, h] = i.aspect === '9:16' ? [720, 1280] : i.aspect === '1:1' ? [960, 960] : [1280, 720];
  const tmp = path.join(os.tmpdir(), 'dms-mock-' + Date.now() + Math.random().toString(36).slice(2));
  let out: string, mime: string, args: string[];
  if (kind === 'video') {
    out = tmp + '.webm'; mime = 'video/webm';
    args = ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=25:d=${Math.min(10, i.duration || 5)}`, '-vf', 'hue=h=200:s=0.6,eq=brightness=-0.15', '-c:v', 'libvpx', '-b:v', '1M', '-an', out];
  } else if (kind === 'image') {
    out = tmp + '.png'; mime = 'image/png';
    args = ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}`, '-vf', 'hue=h=220:s=0.5', '-frames:v', '1', out];
  } else {
    const secs = Math.max(1.2, (i.prompt || '').split(/\s+/).length / 2.6);
    out = tmp + '.wav'; mime = 'audio/wav';
    args = ['-f', 'lavfi', '-i', `sine=frequency=330:duration=${secs.toFixed(2)}`, '-af', 'volume=0.15', out];
  }
  await pexec(FFMPEG, ['-y', '-loglevel', 'error', ...args]);
  const buffer = await fs.readFile(out);
  fs.unlink(out).catch(() => {});
  return { buffer, mime };
}
