import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

// A small floating button that plays the office music (web/public). Nothing plays until someone clicks it — browsers
// block autoplay with sound anyway — and the choice (playing or not) is remembered per person on this device.
const SRC = '/' + encodeURIComponent('anhTaTriDat&AnhMaxx.mp3');
const LS_ON = 'dms.musicOn';

export function MusicButton() {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true), () => setPlaying(false));
      try { localStorage.setItem(LS_ON, '1'); } catch { /* private mode */ }
    } else {
      el.pause();
      setPlaying(false);
      try { localStorage.setItem(LS_ON, '0'); } catch { /* private mode */ }
    }
  };

  // If this person had it on, try to resume; the browser may still refuse until they click, which leaves it paused.
  useEffect(() => {
    let on = false;
    try { on = localStorage.getItem(LS_ON) === '1'; } catch { /* private mode */ }
    if (on && audio.current) audio.current.play().then(() => setPlaying(true), () => setPlaying(false));
  }, []);

  return (
    <>
      <audio ref={audio} src={SRC} loop preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <button
        className={'music-btn' + (playing ? ' is-playing' : '')}
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? 'Tắt nhạc' : 'Phát nhạc'}
        title={playing ? 'Tắt nhạc' : 'Phát nhạc'}
      >
        <Icon name={playing ? 'pause' : 'music'} size={18} />
      </button>
    </>
  );
}
