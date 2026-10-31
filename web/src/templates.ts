// Car edit templates: one AI clip each, written as a full text-to-video prompt.
// "{car}" is replaced by the car the user types on the Templates page.
import type { Aspect } from './types';

export type TplCategory = 'camera' | 'ramp' | 'vfx' | 'light' | 'world' | 'morph' | 'detail';
export interface CarTemplate {
  id: string;
  name: string;
  en: string;
  category: TplCategory;
  duration: number;
  aspect: Aspect;
  tags: string[];
  colors: [string, string];
  prompt: string;
  tip?: string;
}

export const CATEGORIES: [TplCategory | 'all', string][] = [
  ['all', 'Tất cả'],
  ['camera', 'Chuyển động máy quay'],
  ['ramp', 'Speed ramp'],
  ['vfx', 'Hiệu ứng VFX'],
  ['light', 'Ánh sáng & Neon'],
  ['world', 'Bối cảnh & Thời tiết'],
  ['morph', 'Biến hình'],
  ['detail', 'Detailing'],
];

// AI video websites the user generates on with their own account (they block iframes, so we open a new tab).
export interface AiSite { name: string; url: string; note: string }
export const AI_SITES: AiSite[] = [
  { name: 'Higgsfield', url: 'https://higgsfield.ai/create/video', note: 'Hiệu ứng xe, camera motion' },
  { name: 'Kling', url: 'https://app.klingai.com/global/text-to-video/new', note: 'Chân thực, có credit miễn phí hằng ngày' },
  { name: 'Hailuo', url: 'https://hailuoai.video/create', note: 'Chuyển động mạnh, có gói free' },
  { name: 'Dreamina', url: 'https://dreamina.capcut.com/ai-tool/video/generate', note: 'Seedance của CapCut' },
  { name: 'Google Flow', url: 'https://labs.google/fx/tools/flow', note: 'Veo, có âm thanh' },
  { name: 'Sora', url: 'https://sora.chatgpt.com', note: 'Cần tài khoản ChatGPT' },
  { name: 'Runway', url: 'https://app.runwayml.com', note: 'Gen-4, chỉnh sửa mạnh' },
  { name: 'Pika', url: 'https://pika.art', note: 'Hiệu ứng vui, nhanh' },
];

export const DEFAULT_CAR = 'a glossy black sports coupe';

export const TEMPLATES: CarTemplate[] = [
  // ---------------------------------------------------------------- camera moves
  {
    id: 'orbit-360', name: 'Xoay 360° studio', en: '360 Orbit', category: 'camera', duration: 5, aspect: '9:16',
    tags: ['orbit', 'studio', 'showroom'], colors: ['#0f1115', '#3a4250'],
    prompt: `{car} parked in the center of a dark minimalist studio with a glossy black reflective floor. The camera performs one smooth, continuous 360-degree orbit around the car at headlight height, keeping the car perfectly centered. Soft overhead strip lights trace long, clean highlights across the body panels and the reflections slide naturally over the paint as the camera moves. Subtle haze in the air, deep shadows, high contrast. Cinematic commercial look, 35mm lens, shallow depth of field, ultra-sharp detail, no people, no text.`,
    tip: 'Hợp làm cảnh mở đầu. Ghép 2 clip ngược chiều để có vòng xoay liền mạch.',
  },
  {
    id: 'crash-zoom', name: 'Crash zoom vào đèn', en: 'Crash Zoom', category: 'camera', duration: 5, aspect: '9:16',
    tags: ['zoom', 'nhanh', 'beat drop'], colors: ['#1a0d05', '#d9731f'],
    prompt: `Wide shot of {car} standing still on an empty asphalt lot at dusk. After one second the camera does an extremely fast crash zoom straight into the front headlight, stopping in a tight macro close-up as the headlight flicks on with a bright flare. Quick whip-like motion blur during the zoom, then crisp detail of the lens and LED elements. Orange and teal color grade, gritty film grain, energetic music-video edit style, no text.`,
    tip: 'Đặt điểm zoom trùng nhịp drop của nhạc.',
  },
  {
    id: 'fpv-dive', name: 'FPV lao từ trời xuống', en: 'FPV Drone Dive', category: 'camera', duration: 5, aspect: '9:16',
    tags: ['drone', 'fpv', 'núi'], colors: ['#0b2a3a', '#7fb3c9'],
    prompt: `FPV drone shot starting high above a winding mountain road in morning mist. The drone tilts down and dives steeply toward {car} speeding along the road, banking hard and pulling out just above the roof to chase it closely from behind through a tight curve. Fast, fluid, slightly tilted horizon, natural motion blur, dramatic sunlight breaking through clouds, lush green slopes. Hyper-real action cinematography, no text.`,
  },
  {
    id: 'low-tracking', name: 'Tracking sát mặt đường', en: 'Low Tracking', category: 'camera', duration: 5, aspect: '16:9',
    tags: ['tracking', 'bánh xe', 'tốc độ'], colors: ['#111', '#5b5f66'],
    prompt: `Camera mounted inches above the asphalt, tracking alongside {car} as it drives fast on an empty highway. Focus on the front wheel spinning with the brake caliper visible, road surface streaking past in heavy motion blur, the car body perfectly sharp. Late-afternoon sun creates a long rim light along the side skirt. Rumbling, intense, car-commercial style, anamorphic lens flare, no text.`,
  },
  {
    id: 'bullet-time', name: 'Bullet time trên không', en: 'Bullet Time', category: 'camera', duration: 5, aspect: '16:9',
    tags: ['slow motion', 'freeze', 'jump'], colors: ['#2b1a0e', '#c49a6c'],
    prompt: `{car} launches off a desert dune and time freezes mid-air. The camera sweeps in a smooth half-circle arc around the frozen car while sand grains, small rocks and dust hang suspended in the air around it. Wheels slightly drooped, suspension extended. Golden-hour backlight, dust glowing, extreme detail. Matrix-style bullet time, cinematic, no text.`,
    tip: 'Giảm tốc độ 50% khi edit để hiệu ứng đóng băng rõ hơn.',
  },
  {
    id: 'dolly-zoom', name: 'Dolly zoom đường hầm', en: 'Dolly Zoom', category: 'camera', duration: 5, aspect: '9:16',
    tags: ['vertigo', 'tunnel', 'hitchcock'], colors: ['#06121f', '#2c6fb0'],
    prompt: `Front three-quarter view of {car} parked at the entrance of a long concrete tunnel lined with cold white lights. The camera performs a slow dolly zoom: it moves backward while zooming in, so the car stays the same size while the tunnel behind it stretches and warps dramatically. Tense, surreal, symmetrical composition, cool blue grade, light fog, no text.`,
  },
  {
    id: 'top-down', name: 'Top-down đèo cua tay áo', en: 'Top-Down Hairpin', category: 'camera', duration: 5, aspect: '9:16',
    tags: ['drone', 'top-down', 'đèo'], colors: ['#1d2b1a', '#8a9a5b'],
    prompt: `Straight top-down drone view looking directly down on a serpentine mountain pass with tight hairpin turns. {car} drifts through two consecutive hairpins, tires leaving faint dark marks, a small trail of tire smoke. The camera follows smoothly overhead, rotating slightly with the car. Rich autumn colors on the hillside, crisp shadows, graphic composition, no text.`,
  },

  // ---------------------------------------------------------------- speed ramp
  {
    id: 'ramp-pass', name: 'Speed ramp lướt qua', en: 'Speed Ramp Pass', category: 'ramp', duration: 5, aspect: '9:16',
    tags: ['speed ramp', 'slow motion', 'flyby', 'beat'], colors: ['#0d0f14', '#4a5566'],
    prompt: `Speed ramp edit. Low camera beside an empty highway at dusk. {car} rushes toward the camera at full speed in real time, then time dramatically slows to extreme slow motion (about 10% speed) exactly as the car passes the lens: every detail is crisp, wheels visibly turning, light rain drops hanging in the air, headlights flaring. After a beat, time snaps back to hyper speed and the car blasts away into the distance with heavy motion blur and light streaks. Smooth time-remap curve, music-video car edit, cinematic, no text.`,
    tip: 'Nhiều model không tự đổi tốc độ chuẩn. Nếu clip ra tốc độ đều, kéo đường cong tốc độ trong CapCut (Speed → Curve): nhanh, chậm ×0.1 khi xe ngang máy quay, rồi nhanh lại đúng nhịp drop.',
  },
  {
    id: 'ramp-drift', name: 'Speed ramp drift vào cua', en: 'Speed Ramp Drift', category: 'ramp', duration: 5, aspect: '9:16',
    tags: ['speed ramp', 'drift', 'khói'], colors: ['#141414', '#b0b6bf'],
    prompt: `Speed ramp edit of {car} drifting through a tight corner on a racetrack at night. The car enters fast in real time, then slows to dramatic slow motion at the apex: the car fully sideways, front wheels counter-steered, thick white tire smoke curling around the rear, sparks of light in the smoke. Then time ramps back up and the car exits the corner at hyper speed, smoke trail whipping behind. Camera low at the apex, panning with the car. High-contrast floodlights, cinematic, no text.`,
    tip: 'Cắt điểm chậm đúng lúc xe ngang nhất (apex). Đoạn ra cua tăng lên ×2–3 tốc độ.',
  },
  {
    id: 'ramp-launch', name: 'Speed ramp bứt tốc', en: 'Speed Ramp Launch', category: 'ramp', duration: 5, aspect: '16:9',
    tags: ['speed ramp', 'launch', 'burnout'], colors: ['#1c1208', '#c98a3c'],
    prompt: `Speed ramp edit. {car} waits at a start line on an empty desert airstrip, engine revving, exhaust heat shimmer. It launches and time drops into extreme slow motion: rear tires spinning and deforming, dust and small stones exploding off the asphalt, the body squatting under acceleration. Then time snaps to hyper speed and the car rockets out of frame, leaving a dust cloud and light streaks. Side-on tracking camera at wheel height, golden-hour light, cinematic, no text.`,
    tip: 'Khung dọc vẫn dùng được: giữ chiếc xe ở giữa, cho đoạn chậm dài khoảng 1,5 giây.',
  },

  // ---------------------------------------------------------------- VFX
  {
    id: 'drift-smoke', name: 'Drift khói trắng', en: 'Smoke Drift', category: 'vfx', duration: 5, aspect: '9:16',
    tags: ['drift', 'khói', 'đêm'], colors: ['#141414', '#9aa0a6'],
    prompt: `{car} performs a long, controlled drift around the camera in an empty industrial lot at night. Thick white tire smoke billows from the rear wheels and is backlit by a single strong spotlight, glowing volumetrically. The camera stays low and pans to follow the slide, the car emerging from and disappearing into the smoke. Slow motion, wet asphalt reflections, gritty high-contrast look, no text.`,
  },
  {
    id: 'lightning', name: 'Sét đánh khởi động', en: 'Lightning Strike', category: 'vfx', duration: 5, aspect: '9:16',
    tags: ['sét', 'điện', 'bão'], colors: ['#0a0f2b', '#6c7cff'],
    prompt: `{car} parked on an empty road under a violent storm. A massive lightning bolt strikes right behind the car, flooding the scene with white-blue light; the headlights ignite at the same instant and blue electric arcs crawl across the body panels and wheels. Rain streaks, wet reflections, dark clouds, dramatic slow push-in. Epic, high-energy, cinematic VFX, no text.`,
  },
  {
    id: 'fire-trail', name: 'Vệt lửa trên đường', en: 'Fire Trail', category: 'vfx', duration: 5, aspect: '9:16',
    tags: ['lửa', 'đêm', 'tốc độ'], colors: ['#1a0602', '#ff5a1f'],
    prompt: `Night, empty desert highway. {car} accelerates hard toward and past the camera, leaving two burning trails of fire on the asphalt behind its rear wheels. Flames flicker and rise, sparks fly, heat haze distorts the air. Low camera angle, the car passes close and the camera whips around to watch the fiery trail stretch to the horizon. Intense orange glow against deep blue night, cinematic, no text.`,
  },
  {
    id: 'explosion-escape', name: 'Thoát khỏi vụ nổ', en: 'Explosion Escape', category: 'vfx', duration: 5, aspect: '16:9',
    tags: ['action', 'nổ', 'blockbuster'], colors: ['#2a0d00', '#ff9a3c'],
    prompt: `Blockbuster action shot: {car} races straight toward the camera down an abandoned industrial road while a huge fireball explosion erupts behind it. Debris and embers fly outward, shockwave ripples the dust. The car swerves past the camera at the last moment in slow motion. Hollywood action film look, warm explosion light on the car body, heavy contrast, no text, no people.`,
  },
  {
    id: 'speed-warp', name: 'Warp tốc độ ánh sáng', en: 'Light-Speed Warp', category: 'vfx', duration: 5, aspect: '9:16',
    tags: ['warp', 'sci-fi', 'transition'], colors: ['#050a1f', '#16c3f6'],
    prompt: `Rear chase shot of {car} on a straight night highway. The car suddenly accelerates and the world stretches into streaks of light around it, like jumping to hyperspace: streetlights and city lights become long blue and white lines converging to a vanishing point. Taillights glow red, subtle camera shake, chromatic aberration at the edges. Sci-fi, energetic, perfect as a transition, no text.`,
    tip: 'Dùng làm transition giữa 2 cảnh — cắt ngay tại khung hình sáng nhất.',
  },
  {
    id: 'glass-shatter', name: 'Phá kính reveal', en: 'Glass Shatter Reveal', category: 'vfx', duration: 5, aspect: '9:16',
    tags: ['reveal', 'kính vỡ', 'slow motion'], colors: ['#0d0d10', '#c9d6e3'],
    prompt: `A dark studio with a giant pane of glass standing upright. {car} drives slowly through the glass toward the camera, shattering it into thousands of glittering shards that float in extreme slow motion around the car, catching hard white spotlights. Black background, sharp reflections, crystal-clear detail. Premium product reveal, cinematic, no text.`,
  },

  // ---------------------------------------------------------------- light & neon
  {
    id: 'neon-tunnel', name: 'Đường hầm neon', en: 'Neon Tunnel', category: 'light', duration: 5, aspect: '9:16',
    tags: ['neon', 'đêm', 'tunnel'], colors: ['#14002b', '#ff2fd1'],
    prompt: `{car} drives through a futuristic tunnel lined with pulsing magenta and cyan neon light rings. The lights sweep rhythmically over the glossy paint, reflecting like liquid. The camera tracks in front, slowly pulling back as the car follows. Synthwave mood, deep purple atmosphere, light haze, crisp reflections, music-video style, no text.`,
  },
  {
    id: 'light-painting', name: 'Light painting', en: 'Light Painting', category: 'light', duration: 5, aspect: '16:9',
    tags: ['studio', 'light strip', 'premium'], colors: ['#000000', '#e9eef5'],
    prompt: `{car} in a completely dark studio. A single soft white light bar slowly sweeps across the car from front to back, revealing only the sculpted lines and curves of the body one section at a time, the rest staying in black. Long reflections glide over the paint. Static camera at a low three-quarter angle. Ultra-premium automotive launch film, minimal, high contrast, no text.`,
  },
  {
    id: 'headlight-reveal', name: 'Bật đèn trong garage', en: 'Headlight Reveal', category: 'light', duration: 5, aspect: '9:16',
    tags: ['reveal', 'garage', 'khói'], colors: ['#0a0a0a', '#f2f2f2'],
    prompt: `Pitch-black garage filled with light fog. Silence, then the headlights of {car} switch on, two powerful beams cutting through the fog toward the camera. The daytime running lights animate on, then soft ceiling lights flicker on one by one revealing the car's silhouette. Slow push-in from the front, volumetric light, moody, cinematic, no text.`,
  },
  {
    id: 'cyber-rain', name: 'Cyberpunk mưa đêm', en: 'Cyberpunk Rain', category: 'light', duration: 5, aspect: '9:16',
    tags: ['cyberpunk', 'mưa', 'thành phố'], colors: ['#06141f', '#00e0ff'],
    prompt: `Rainy night in a dense futuristic Asian city street with towering neon signs in pink, cyan and yellow. {car} rolls slowly toward the camera, raindrops beading and running off the glossy paint, neon colors reflecting in puddles and on the body. The camera slowly cranes down from above to a low hero angle. Cyberpunk atmosphere, steam rising, cinematic depth, no readable text.`,
  },

  // ---------------------------------------------------------------- world & weather
  {
    id: 'snow-drift', name: 'Drift trên tuyết', en: 'Snow Drift', category: 'world', duration: 5, aspect: '16:9',
    tags: ['tuyết', 'drift', 'mùa đông'], colors: ['#d9e6f2', '#5b7a99'],
    prompt: `{car} drifts sideways across a frozen lake covered in fresh powder snow, throwing a huge rooster tail of sparkling snow into the air. Bright low winter sun backlights the snow crystals. The camera tracks from the side at ground level, then the car slides past close to the lens. Crisp cold blue-white palette, slow motion, epic winter commercial, no text.`,
  },
  {
    id: 'desert-dust', name: 'Sa mạc hoàng hôn', en: 'Desert Golden Hour', category: 'world', duration: 5, aspect: '9:16',
    tags: ['sa mạc', 'bụi', 'golden hour'], colors: ['#3b1f0a', '#f2a65a'],
    prompt: `{car} speeds across a vast desert salt flat at sunset, kicking up a long golden dust cloud behind it. The camera flies alongside at car height, then rises to reveal the endless landscape and distant mountains. Warm orange sun flare, heat shimmer, the car body glowing with golden reflections. Epic, free, cinematic wide-angle, no text.`,
  },
  {
    id: 'coastal-road', name: 'Cung đường ven biển', en: 'Coastal Road', category: 'world', duration: 10, aspect: '16:9',
    tags: ['biển', 'road trip', 'drone'], colors: ['#0d3b5c', '#f4c27a'],
    prompt: `Aerial drone shot following {car} along a winding coastal cliff road at golden hour. Turquoise ocean waves crash against the rocks below, the sun low on the horizon. The camera starts behind the car, then slowly arcs around to a side view as it rounds a bend, revealing the coastline. Smooth, luxurious travel-commercial feeling, warm and cinematic, no text.`,
  },
  {
    id: 'water-splash', name: 'Lao qua vũng nước', en: 'Puddle Splash', category: 'world', duration: 5, aspect: '9:16',
    tags: ['nước', 'slow motion', 'mưa'], colors: ['#0b1a24', '#7fa7c2'],
    prompt: `Extreme slow motion: {car} drives through a deep puddle on a wet city street right next to the camera. A huge crown-shaped splash of water explodes from the front wheel, every droplet sharp and glistening in backlight. Low camera angle at wheel level, overcast moody sky, reflections everywhere. High-speed camera look (1000 fps), cinematic, no text.`,
  },

  // ---------------------------------------------------------------- morph
  {
    id: 'exploded-view', name: 'Tách lớp cơ khí', en: 'Exploded View', category: 'morph', duration: 5, aspect: '16:9',
    tags: ['3D', 'kỹ thuật', 'lắp ráp'], colors: ['#0e1116', '#9fb4c7'],
    prompt: `{car} in a clean dark gray studio. The car smoothly disassembles into an exploded view: body panels, doors, wheels, engine, seats and chassis separate and float apart in perfect alignment, slowly rotating, then reassemble seamlessly into the complete car. The camera orbits slowly. Precise engineering visualization, clean lighting, photoreal materials, no text.`,
  },
  {
    id: 'wireframe-build', name: 'Từ wireframe thành xe thật', en: 'Wireframe to Real', category: 'morph', duration: 5, aspect: '9:16',
    tags: ['hologram', 'sci-fi', 'reveal'], colors: ['#020814', '#16c3f6'],
    prompt: `A glowing cyan holographic wireframe of {car} hovers above a dark tech platform with a grid floor. A scanning line sweeps from front to back and the wireframe fills in with real photoreal paint, glass, rubber and chrome as it passes, until the complete real car stands on the platform. The camera slowly orbits. Futuristic design-studio mood, no text.`,
  },
  {
    id: 'liquid-metal', name: 'Kim loại lỏng', en: 'Liquid Chrome', category: 'morph', duration: 5, aspect: '9:16',
    tags: ['chrome', 'morph', 'art'], colors: ['#1b1b1f', '#c8ccd2'],
    prompt: `A pool of liquid chrome metal on a black reflective floor rises and flows upward, rippling and stretching, until it forms the exact shape of {car} in mirror chrome. Then the chrome surface ripples once more and turns into the car's real glossy paint finish. Slow, smooth camera push-in. Surreal, premium, studio lighting with sharp highlights, no text.`,
  },
  {
    id: 'color-shift', name: 'Đổi màu sơn', en: 'Paint Color Shift', category: 'morph', duration: 5, aspect: '9:16',
    tags: ['wrap', 'màu sơn', 'detailing'], colors: ['#1539e1', '#ff3b6b'],
    prompt: `{car} on a turntable in a bright white studio cyclorama, slowly rotating. A wave of new paint color sweeps across the body from front to back, changing the car from its original color to a vivid satin electric blue, then a second wave turns it glossy candy red. The transitions look like a liquid wrap flowing over the panels. Clean commercial lighting, no text.`,
    tip: 'Đổi màu trong prompt theo bộ wrap bạn muốn quảng cáo.',
  },

  // ---------------------------------------------------------------- detailing
  {
    id: 'snow-foam', name: 'Phủ bọt tuyết', en: 'Snow Foam', category: 'detail', duration: 5, aspect: '9:16',
    tags: ['rửa xe', 'bọt', 'slow motion'], colors: ['#0b1c3d', '#e9f3ff'],
    prompt: `Slow motion close-up inside a detailing studio: a foam cannon blankets {car} in thick white snow foam that slides slowly down the glossy panels. Then a pressure washer rinses a clean line through the foam, revealing a mirror-like wet finish underneath. Cool blue LED ceiling lights reflect in the water. Satisfying, ASMR-like, premium detailing commercial, no text, no faces.`,
  },
  {
    id: 'ceramic-beading', name: 'Hiệu ứng lá sen ceramic', en: 'Ceramic Beading', category: 'detail', duration: 5, aspect: '9:16',
    tags: ['ceramic', 'macro', 'nước'], colors: ['#04122b', '#0b7df2'],
    prompt: `Extreme macro shot of the hood of {car} freshly coated with ceramic. Water is sprayed onto the surface and forms perfectly round beads that roll off instantly, sheeting away and leaving the paint dry and glossy. Shallow depth of field, backlit droplets sparkling, deep paint reflections. Slow motion, crisp detail, satisfying detailing commercial, no text.`,
  },
  {
    id: 'polish-5050', name: 'Đánh bóng 50/50', en: '50/50 Polish', category: 'detail', duration: 5, aspect: '9:16',
    tags: ['đánh bóng', 'before after', 'paint correction'], colors: ['#232323', '#d7d7d7'],
    prompt: `Close-up of a door panel of {car} under a strong swirl-finder LED light. The left half of the panel is dull and covered in fine swirl marks; a dual-action polisher with a foam pad glides across and leaves the right half flawless with a deep mirror reflection of the light. Slow lateral camera slide revealing the before/after line. Professional paint-correction showcase, realistic, no text, hands only.`,
  },
];
