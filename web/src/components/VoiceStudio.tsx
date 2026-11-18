// Tools › Giọng nói (#voice): VoiceStudio's speech, transcripts, dubbing and voice cloning, run by the VoiceStudio app on this
// computer (tools/voicestudio.ts). Results are downloaded; nothing goes through DMI's server.
import { useEffect, useRef, useState } from 'react';
import { toast } from '../store';
import { Icon, Popup } from './ui';
import * as VS from '../tools/voicestudio';

type Tab = 'speak' | 'transcribe' | 'dub' | 'clone';
const TABS: [Tab, string, string][] = [['speak', 'Đọc chữ', 'mic'], ['transcribe', 'Chép lời & phụ đề', 'text'], ['dub', 'Lồng tiếng video', 'film'], ['clone', 'Nhân bản giọng', 'user']];
const LS_TAB = 'dms.voicestudio.tab';

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
const text = (s: string, type = 'text/plain') => new Blob([s], { type: `${type};charset=utf-8` });

/** Whether VoiceStudio answers, and its voices; asked again on demand. */
function useVoiceStudio() {
  const [state, setState] = useState<{ status: 'checking' | 'ok' | 'off'; voices: VS.Voice[]; error?: string }>({ status: 'checking', voices: [] });
  const check = () => {
    setState((s) => ({ ...s, status: 'checking' }));
    VS.voices().then((voices) => setState({ status: 'ok', voices }), (e) => setState({ status: 'off', voices: [], error: e.message }));
  };
  useEffect(check, []);
  return { ...state, check };
}

export function VoiceStudioPage() {
  const vs = useVoiceStudio();
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem(LS_TAB) as Tab) || 'speak'; } catch { return 'speak'; } });
  const [setup, setSetup] = useState(false);
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem(LS_TAB, t); } catch { /* private mode */ } };
  return (
    <main className="tools-page">
      <header className="tpl-head">
        <div>
          <h1 className="tpl-title">Giọng nói</h1>
          <p className="tpl-lead">Đọc chữ thành giọng, chép lời, lồng tiếng và nhân bản giọng bằng app VoiceStudio chạy trên máy bạn: miễn phí, file không rời máy.</p>
        </div>
        <span className={`vs-status is-${vs.status}`}>
          <i />{vs.status === 'ok' ? 'Đã kết nối VoiceStudio' : vs.status === 'checking' ? 'Đang kết nối…' : 'Chưa kết nối'}
          <button className="icon-btn" onClick={() => setSetup((v) => !v)} title="Cài đặt kết nối" aria-label="Cài đặt kết nối"><Icon name="gear" size={15} /></button>
        </span>
      </header>
      {(setup || vs.status === 'off') && <Setup error={vs.error} onCheck={vs.check} />}
      <nav className="vs-tabs" role="tablist">
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => pick(id)}><Icon name={icon} size={15} />{label}</button>
        ))}
      </nav>
      {tab === 'speak' && <Speak voices={vs.voices} />}
      {tab === 'transcribe' && <Transcribe />}
      {tab === 'dub' && <Dub voices={vs.voices} />}
      {tab === 'clone' && <Clone onMade={vs.check} />}
    </main>
  );
}

function Setup({ error, onCheck }: { error?: string; onCheck: () => void }) {
  const [url, setUrl] = useState(VS.baseUrl());
  const cmd = VS.setupCommand();
  return (
    <section className="vs-card vs-setup">
      <h2>Kết nối VoiceStudio trên máy này</h2>
      {error && <p className="vs-err">{error}</p>}
      <ol>
        <li>Tải và mở <a href="https://github.com/debpalash/VoiceStudio/releases/latest" target="_blank" rel="noopener noreferrer">VoiceStudio</a> (miễn phí). Lần đầu app tải model giọng nói về máy, khoảng vài GB.</li>
        <li>Cho phép DMI gọi tới VoiceStudio: mở Terminal, chạy lệnh dưới đây một lần, rồi <b>thoát hẳn và mở lại</b> VoiceStudio.
          <div className="vs-cmd"><code>{cmd}</code><button className="btn btn-gray btn-sm" onClick={() => navigator.clipboard.writeText(cmd).then(() => toast('Đã chép lệnh'), () => toast('Hãy chọn và chép tay', true))}><Icon name="copy" size={13} />Chép</button></div>
          <small>Máy khởi động lại thì chạy lại lệnh này. Windows: đặt biến môi trường <code>OMNIVOICE_ALLOWED_ORIGINS</code> với giá trị <code>app://voicestudio,{location.origin}</code>.</small>
        </li>
        <li>Khi trình duyệt hỏi cho phép trang truy cập thiết bị trong mạng cục bộ, bấm <b>Cho phép</b>.</li>
      </ol>
      <div className="vs-row">
        <label className="vs-field grow">Địa chỉ VoiceStudio<input className="bk-in" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={VS.DEFAULT_URL} /></label>
        <button className="btn btn-primary btn-sm" onClick={() => { VS.setBaseUrl(url); onCheck(); }}><Icon name="refresh" size={14} />Kết nối lại</button>
      </div>
    </section>
  );
}

const VoicePick = ({ voices, value, onChange }: { voices: VS.Voice[]; value: string; onChange: (v: string) => void }) => (
  <label className="vs-field">Giọng
    <Popup value={value} onChange={onChange}>
      <option value="default">Giọng mặc định</option>
      {voices.filter((v) => v.type === 'profile').map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
    </Popup>
  </label>
);
const LangPick = ({ value, onChange, label = 'Ngôn ngữ', auto }: { value: string; onChange: (v: string) => void; label?: string; auto?: boolean }) => (
  <label className="vs-field">{label}
    <Popup value={value} onChange={onChange}>
      {auto && <option value="">Tự nhận biết</option>}
      {VS.LANGS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </Popup>
  </label>
);
function Progress({ k, label }: { k: number; label: string }) {
  return <div className="vs-progress"><span>{label}</span><i><b style={{ width: `${Math.round(k * 100)}%` }} /></i></div>;
}
function useRun() {
  const [busy, setBusy] = useState(false);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    const c = new AbortController();
    stop.current = c; setBusy(true);
    try { await work(c.signal); } catch (e: any) { if (!c.signal.aborted) toast(e.message, true); } finally { setBusy(false); stop.current = null; }
  };
  return { busy, run, cancel: () => stop.current?.abort() };
}
function FileDrop({ accept, file, onFile, hint }: { accept: string; file: File | null; onFile: (f: File) => void; hint: string }) {
  const pick = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button type="button" className={`an-drop vs-drop${over ? ' over' : ''}`} onClick={() => pick.current?.click()}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <input ref={pick} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      <Icon name={file ? 'check' : 'up'} size={26} />
      <b>{file ? file.name : 'Kéo thả file vào đây hoặc bấm để chọn'}</b>
      <span>{file ? `${(file.size / 1e6).toFixed(1)} MB · bấm để đổi file khác` : hint}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Đọc chữ
function Speak({ voices }: { voices: VS.Voice[] }) {
  const [script, setScript] = useState(''), [voice, setVoice] = useState('default'), [lang, setLang] = useState('vi'), [speed, setSpeed] = useState(1);
  const [k, setK] = useState(0), [out, setOut] = useState<{ blob: Blob; url: string } | null>(null);
  const { busy, run, cancel } = useRun();
  useEffect(() => () => { if (out) URL.revokeObjectURL(out.url); }, [out]);
  const go = () => run(async (signal) => {
    setK(0);
    const blob = await VS.speakAll(script, { voice, language: lang, speed }, setK, signal);
    setOut({ blob, url: URL.createObjectURL(blob) });
  });
  const parts = VS.pieces(script).length;
  return (
    <section className="vs-card">
      <div className="vs-row">
        <VoicePick voices={voices} value={voice} onChange={setVoice} />
        <LangPick value={lang} onChange={setLang} />
        <label className="vs-field">Tốc độ
          <Popup value={speed} onChange={(v) => setSpeed(Number(v))}>
            {[0.8, 0.9, 1, 1.1, 1.2, 1.4].map((s) => <option key={s} value={s}>{s === 1 ? 'Bình thường' : `${s}×`}</option>)}
          </Popup>
        </label>
      </div>
      <textarea className="bk-in vs-script" value={script} onChange={(e) => setScript(e.target.value)} placeholder="Dán kịch bản cần đọc. Kịch bản dài được đọc từng đoạn rồi ghép lại." rows={10} />
      <div className="vs-row end">
        <small className="vs-note">{script.length.toLocaleString('vi')} ký tự{parts > 1 ? ` · ${parts} đoạn` : ''}</small>
        {busy ? <button className="btn btn-gray btn-sm" onClick={cancel}><Icon name="pause" size={13} />Dừng</button>
          : <button className="btn btn-primary" disabled={!script.trim()} onClick={go}><Icon name="mic" size={15} />Đọc thành giọng</button>}
      </div>
      {busy && <Progress k={k} label="Đang tạo giọng đọc…" />}
      {out && !busy && (
        <div className="vs-result">
          <audio controls src={out.url} />
          <button className="btn btn-tinted btn-sm" onClick={() => save(out.blob, 'giong-doc.wav')}><Icon name="download" size={14} />Tải WAV</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Chép lời & phụ đề
function Transcribe() {
  const [file, setFile] = useState<File | null>(null), [lang, setLang] = useState('');
  const [res, setRes] = useState<{ text: string; lines: VS.Line[] } | null>(null);
  const { busy, run, cancel } = useRun();
  const base = (file?.name || 'phu-de').replace(/\.[^.]+$/, '');
  return (
    <section className="vs-card">
      <FileDrop accept="audio/*,video/*" file={file} onFile={(f) => { setFile(f); setRes(null); }} hint="Video hoặc file ghi âm (MP4, MOV, MP3, WAV, M4A…)" />
      <div className="vs-row end">
        <LangPick value={lang} onChange={setLang} label="Ngôn ngữ trong file" auto />
        {busy ? <button className="btn btn-gray btn-sm" onClick={cancel}>Dừng</button>
          : <button className="btn btn-primary" disabled={!file} onClick={() => run(async () => setRes(await VS.transcribe(file!, file!.name, lang)))}><Icon name="text" size={15} />Chép lời</button>}
      </div>
      {busy && <Progress k={0.5} label="Đang nghe và chép lời… (file dài sẽ lâu hơn)" />}
      {res && !busy && (
        <>
          <div className="vs-row">
            <button className="btn btn-tinted btn-sm" onClick={() => save(text(VS.toSrt(res.lines), 'application/x-subrip'), `${base}.srt`)}><Icon name="download" size={14} />Phụ đề SRT</button>
            <button className="btn btn-gray btn-sm" onClick={() => save(text(VS.toVtt(res.lines), 'text/vtt'), `${base}.vtt`)}><Icon name="download" size={14} />VTT</button>
            <button className="btn btn-gray btn-sm" onClick={() => save(text(res.text), `${base}.txt`)}><Icon name="download" size={14} />Văn bản</button>
            <button className="btn btn-gray btn-sm" onClick={() => navigator.clipboard.writeText(res.text).then(() => toast('Đã chép'))}><Icon name="copy" size={14} />Chép</button>
          </div>
          <ol className="vs-lines">{res.lines.map((l, i) => <li key={i}><time>{fmt(l.start)}</time><span>{l.text}</span></li>)}</ol>
        </>
      )}
    </section>
  );
}
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- Lồng tiếng
const STEP: Record<VS.DubStep, string> = { listen: 'Đang nghe và chép lời', translate: 'Đang dịch', speak: 'Đang đọc từng câu bằng giọng mới', mix: 'Đang ghép tiếng theo thời gian', video: 'Đang gắn tiếng vào video' };
function Dub({ voices }: { voices: VS.Voice[] }) {
  const [file, setFile] = useState<File | null>(null), [from, setFrom] = useState(''), [to, setTo] = useState('en'), [voice, setVoice] = useState('default'), [keep, setKeep] = useState(0.15);
  const [step, setStep] = useState<{ s: VS.DubStep; k: number } | null>(null);
  const [out, setOut] = useState<{ media: Blob; name: string; srt: string; url: string } | null>(null);
  const { busy, run, cancel } = useRun();
  useEffect(() => () => { if (out) URL.revokeObjectURL(out.url); }, [out]);
  const go = () => run(async (signal) => {
    setOut(null);
    const r = await VS.dub(file!, { from, to, voice, keepOriginal: keep }, (s, k) => setStep({ s, k }), signal);
    setOut({ ...r, url: URL.createObjectURL(r.media) });
    setStep(null);
  });
  return (
    <section className="vs-card">
      <FileDrop accept="video/*,audio/*" file={file} onFile={(f) => { setFile(f); setOut(null); }} hint="Video MP4/MOV hoặc file ghi âm. Hình giữ nguyên, chỉ thay tiếng." />
      <div className="vs-row">
        <LangPick value={from} onChange={setFrom} label="Tiếng gốc" auto />
        <LangPick value={to} onChange={setTo} label="Lồng sang" />
        <VoicePick voices={voices} value={voice} onChange={setVoice} />
        <label className="vs-field">Tiếng gốc phía sau
          <Popup value={keep} onChange={(v) => setKeep(Number(v))}>
            <option value={0}>Tắt</option><option value={0.15}>Nhỏ</option><option value={0.35}>Vừa</option>
          </Popup>
        </label>
      </div>
      <div className="vs-row end">
        <small className="vs-note">Câu nào dài hơn chỗ trống sẽ được đọc nhanh hơn để khớp thời gian.</small>
        {busy ? <button className="btn btn-gray btn-sm" onClick={cancel}><Icon name="pause" size={13} />Dừng</button>
          : <button className="btn btn-primary" disabled={!file} onClick={go}><Icon name="film" size={15} />Lồng tiếng</button>}
      </div>
      {busy && step && <Progress k={step.k} label={`${STEP[step.s]}…`} />}
      {out && !busy && (
        <div className="vs-result">
          {out.media.type.startsWith('video/') ? <video controls src={out.url} /> : <audio controls src={out.url} />}
          <div className="vs-row">
            <button className="btn btn-tinted btn-sm" onClick={() => save(out.media, out.name)}><Icon name="download" size={14} />Tải {out.media.type.startsWith('video/') ? 'video' : 'âm thanh'}</button>
            <button className="btn btn-gray btn-sm" onClick={() => save(text(out.srt, 'application/x-subrip'), out.name.replace(/\.[^.]+$/, '.srt'))}><Icon name="download" size={14} />Phụ đề bản dịch</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Nhân bản giọng
function Clone({ onMade }: { onMade: () => void }) {
  const [name, setName] = useState(''), [lang, setLang] = useState('vi'), [refText, setRefText] = useState(''), [ok, setOk] = useState(false);
  const [audio, setAudio] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const { busy, run } = useRun();
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);
  const use = (blob: Blob, n: string) => setAudio({ blob, name: n, url: URL.createObjectURL(blob) });
  const record = async () => {
    if (rec) return rec.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream), parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setRec(null); use(new Blob(parts, { type: r.mimeType }), `ghi-am.${r.mimeType.includes('mp4') ? 'm4a' : 'webm'}`); };
      r.start(); setRec(r);
    } catch { toast('Không mở được micro — hãy cho phép trình duyệt dùng micro', true); }
  };
  const make = () => run(async () => {
    const v = await VS.cloneVoice({ name: name.trim(), audio: audio!.blob, fileName: audio!.name, language: lang, refText: refText.trim() });
    toast(`Đã tạo giọng “${v.name}” — chọn được ở Đọc chữ và Lồng tiếng`);
    setName(''); setRefText(''); setAudio(null); setOk(false);
    onMade();
  });
  return (
    <section className="vs-card">
      <p className="vs-note">Ghi âm hoặc chọn một đoạn nói rõ ràng 10–30 giây, không nhạc nền. Giọng mới lưu trong VoiceStudio trên máy bạn.</p>
      <div className="vs-row">
        <label className="vs-field grow">Tên giọng<input className="bk-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Giọng MC Lan" /></label>
        <LangPick value={lang} onChange={setLang} />
      </div>
      <div className="vs-row">
        <button className={`btn btn-sm ${rec ? 'btn-primary vs-recording' : 'btn-gray'}`} onClick={record}><Icon name="mic" size={14} />{rec ? 'Dừng ghi âm' : 'Ghi âm'}</button>
        <label className="btn btn-gray btn-sm">
          <Icon name="up" size={14} />Chọn file
          <input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) use(f, f.name); }} />
        </label>
        {audio && <audio controls src={audio.url} />}
      </div>
      <label className="vs-field">Lời trong đoạn ghi âm (không bắt buộc, giúp giọng giống hơn)<textarea className="bk-in" rows={2} value={refText} onChange={(e) => setRefText(e.target.value)} /></label>
      <label className="vs-consent"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Đây là giọng của tôi, hoặc người có giọng này đã đồng ý cho dùng giọng của họ.</label>
      <div className="vs-row end">
        <button className="btn btn-primary" disabled={busy || !name.trim() || !audio || !ok} onClick={make}><Icon name="user" size={15} />{busy ? 'Đang tạo…' : 'Tạo giọng'}</button>
      </div>
    </section>
  );
}
