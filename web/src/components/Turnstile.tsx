import { useEffect, useRef } from 'react';

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
declare global { interface Window { turnstile?: TurnstileApi } }
let loading: Promise<TurnstileApi> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return loading ||= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Không tải được xác minh người dùng.'));
    script.onerror = () => reject(new Error('Không tải được xác minh người dùng. Kiểm tra kết nối và thử lại.'));
    document.head.appendChild(script);
  }).catch((error) => { loading = undefined; throw error; });
}

export function Turnstile({ siteKey, resetKey, onToken, onError }: {
  siteKey: string; resetKey: number; onToken: (token: string) => void; onError: (error: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let widget: string | undefined;
    onToken('');
    loadTurnstile().then((api) => {
      if (disposed || !container.current) return;
      widget = api.render(container.current, {
        sitekey: siteKey, action: 'login', theme: 'auto', size: 'flexible', language: 'vi',
        callback: (token: string) => { if (!disposed) { onToken(token); onError(''); } },
        'expired-callback': () => { if (!disposed) onToken(''); },
        'error-callback': () => { if (!disposed) { onToken(''); onError('Xác minh gặp lỗi. Vui lòng thử lại.'); } },
      });
    }).catch((e) => { if (!disposed) onError(e.message); });
    return () => { disposed = true; if (widget !== undefined) window.turnstile?.remove(widget); };
  }, [siteKey, resetKey, onToken, onError]);
  return <div className="login-turnstile" ref={container} aria-label="Xác minh không phải người máy" />;
}
