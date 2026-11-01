import { useState } from 'react';
import { api } from '../api';
import { useStore, choice, setChoice, refreshProviders, toast } from '../store';
import type { Kind } from '../types';
import { Icon, Popup } from './ui';

const SEP = '::';
const KIND_ICON: Record<Kind, string> = { llm: 'sparkle', video: 'film', image: 'photo', tts: 'mic' };

/** One pop-up button listing every platform + model of a kind; “＋ Model khác…” adds any model ID. */
export function ModelPicker({ kind, id }: { kind: Kind; id?: string }) {
  const providers = useStore((s) => s.providers).filter((p) => p.kind === kind);
  useStore((s) => s.defaults);
  const cur = choice(kind);
  const [adding, setAdding] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const curP = providers.find((p) => p.id === cur?.provider);

  const onChange = (v: string) => {
    if (v.startsWith('+')) { setAdding(v.slice(1)); setCustom(''); return; }
    const [provider, model] = v.split(SEP);
    const p = providers.find((x) => x.id === provider);
    setChoice(kind, { provider, model, voice: p?.voices?.includes(cur?.voice || '') ? cur?.voice : p?.voices?.[0] });
  };
  const saveCustom = async () => {
    const mid = custom.trim(); if (!mid || !adding) return;
    try {
      await api.addCustomModel(adding, mid);
      await refreshProviders();
      setChoice(kind, { provider: adding, model: mid, voice: providers.find((p) => p.id === adding)?.voices?.[0] });
      setAdding(null);
    } catch (e: any) { toast(e.message, true); }
  };
  if (!providers.length) return null;

  if (adding) {
    const name = providers.find((p) => p.id === adding)?.name;
    return (
      <div className="picker-add">
        <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`Model ID của ${name}`}
          onKeyDown={(e) => { if (e.key === 'Enter') saveCustom(); if (e.key === 'Escape') setAdding(null); }} />
        <button className="btn btn-primary btn-sm" onClick={saveCustom} disabled={!custom.trim()}>Thêm</button>
        <button className="btn btn-plain btn-sm" onClick={() => setAdding(null)}>Huỷ</button>
      </div>
    );
  }

  return (
    <div className="picker">
      <span className="picker-ico"><Icon name={KIND_ICON[kind]} size={15} /></span>
      <Popup id={id} className="picker-popup" value={cur ? cur.provider + SEP + cur.model : ''} onChange={onChange} title="Chọn nền tảng & model">
        {providers.map((p) => (
          <optgroup key={p.id} label={`${p.name} · ${p.vendor}${p.configured ? '' : ' — chưa sẵn sàng'}`}>
            {p.models.map((m) => (
              <option key={m.id} value={p.id + SEP + m.id}>{p.mock ? m.label : `${p.name} · ${m.label}`}{p.configured ? '' : ' 🔒'}</option>
            ))}
            {!p.mock && <option value={'+' + p.id}>＋ Model khác của {p.name}…</option>}
          </optgroup>
        ))}
      </Popup>
      {curP?.voices && cur && (
        <Popup className="picker-voice" value={cur.voice || curP.voices[0]} onChange={(v) => setChoice(kind, { ...cur, voice: v })} title="Giọng đọc">
          {curP.voices.map((v) => <option key={v} value={v}>{v}</option>)}
        </Popup>
      )}
      {curP && !curP.configured && <span className="tiny">Không tìm thấy lệnh claude trên máy chủ</span>}
    </div>
  );
}
