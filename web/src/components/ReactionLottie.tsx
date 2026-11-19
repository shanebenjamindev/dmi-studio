import Lottie from 'lottie-react';
import { useEffect, useState } from 'react';

// The animated reaction faces (Google Noto animated emoji, open-licensed, in web/public/reactions). This file is loaded
// on demand (React.lazy in boardkit.tsx) only when the picker opens, so lottie-web stays out of the first download.
// Each animation's JSON is fetched once and kept, and while it is still coming the picker shows the static glyph.
const cache: Record<string, unknown> = {};

export default function ReactionLottie({ kind, size }: { kind: string; size: number }) {
  const [data, setData] = useState<unknown>(cache[kind] || null);
  useEffect(() => {
    if (cache[kind]) { setData(cache[kind]); return; }
    let live = true;
    fetch(`/reactions/${kind}.json`).then((r) => r.json()).then((j) => { cache[kind] = j; if (live) setData(j); }).catch(() => {});
    return () => { live = false; };
  }, [kind]);
  if (!data) return null; // The button keeps showing the static glyph until this is ready.
  return <Lottie animationData={data} loop autoplay style={{ width: size, height: size }} />;
}
