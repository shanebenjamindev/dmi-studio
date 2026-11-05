import {BrandLoading} from './BrandLoading';
// Tools: converting files from one format to another, in the browser. Nothing is uploaded, so it works the same on the
// cloud site and on the Mac server, and big videos never leave the machine. Drop files (or pick them), choose each one's
// target, convert them one after another, then download them one by one or together as a .zip.
import { useEffect, useRef, useState } from 'react';
import { toast, goto, useStore } from '../store';
import { Icon, Popup } from './ui';
import { KINDS, label, extOf, kindOf, outputsFor, defaultTarget, outName, convert, imagesToPdf, zipAll, canReadGif, type Kind, type Opts } from '../tools/formats';

type Item = {
  id: number; file: File | null; name: string; size: number; kind: Kind; from: string; to: string;
  status: 'idle' | 'busy' | 'done' | 'error'; progress: number; error?: string; warn?: string;
  out?: { blob: Blob; name: string; url: string };
};
const LS_OPTS = 'dms.tools.opts', LS_LAST = 'dms.tools.last';
const load = <T,>(key: string, fallback: T): T => { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return fallback; } };
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };
const size = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
const ICON = Object.fromEntries(KINDS.map((k) => [k.id, k.icon])) as Record<Kind, string>;
const ACCEPT = (kinds = KINDS) => kinds.flatMap((k) => k.inputs.map((e) => '.' + e)).join(',');
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

let nextId = 1;
export function ToolsPage() {
  const canEdit = useStore((s) => s.pages.includes('editor'));
  const [items, setItems] = useState<Item[]>([]);
  const list = useRef<Item[]>([]); // the latest list, for the conversion loop between renders
  const set = (next: Item[]) => { list.current = next; setItems(next); };
  const patch = (id: number, p: Partial<Item>) => set(list.current.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const [opts, setOpts] = useState<Opts>(() => load(LS_OPTS, { size: 0, max: 0, quality: 'keep' as Opts['quality'] }));
  const optsNow = useRef(opts); // a change of options applies to the files not converted yet
  optsNow.current = opts;
  const last = useRef<Partial<Record<Kind, string>>>(load(LS_LAST, {}));
  const [running, setRunning] = useState(false);
  const [merging, setMerging] = useState(false);
  const [drag, setDrag] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => () => { stop.current?.abort(); list.current.forEach((i) => i.out && URL.revokeObjectURL(i.out.url)); }, []);

  const setOpt = (p: Partial<Opts>) => { const o = { ...opts, ...p }; setOpts(o); save(LS_OPTS, o); };
  const add = (files: FileList | File[] | null) => {
    const added: Item[] = [], skipped: string[] = [];
    for (const file of Array.from(files || [])) {
      const kind = kindOf(file);
      if (!kind) { skipped.push(file.name); continue; }
      const from = extOf(file.name);
      added.push({ id: nextId++, file, name: file.name, size: file.size, kind, from, to: defaultTarget(kind, from, last.current[kind]), status: 'idle', progress: 0 });
    }
    if (added.length) set([...list.current, ...added]);
    if (skipped.length) toast(`Chưa hỗ trợ: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ` và ${skipped.length - 3} file khác` : ''}`, true);
  };
  const pick = (kinds = KINDS) => { const el = picker.current; if (el) { el.accept = ACCEPT(kinds); el.click(); } };
  const remove = (it: Item) => { if (it.out) URL.revokeObjectURL(it.out.url); set(list.current.filter((i) => i.id !== it.id)); };
  const retarget = (it: Item, to: string) => {
    last.current = { ...last.current, [it.kind]: to };
    save(LS_LAST, last.current);
    if (it.out) URL.revokeObjectURL(it.out.url);
    patch(it.id, { to, status: 'idle', progress: 0, out: undefined, error: undefined, warn: undefined });
  };
  const clear = () => { list.current.forEach((i) => i.out && URL.revokeObjectURL(i.out.url)); set(list.current.filter((i) => i.status === 'busy')); };

  // One file at a time: encoders are heavy, and the order on screen is the order of work.
  const run = async () => {
    if (stop.current) return;
    const ctrl = new AbortController();
    stop.current = ctrl;
    setRunning(true);
    set(list.current.map((i) => (i.status === 'error' ? { ...i, status: 'idle', error: undefined } : i)));
    try {
      for (let it = list.current.find((i) => i.status === 'idle'); it && !ctrl.signal.aborted; it = list.current.find((i) => i.status === 'idle')) {
        const id = it.id;
        patch(id, { status: 'busy', progress: 0, error: undefined, warn: undefined });
        let shown = 0;
        try {
          const r = await convert(it.file!, it.kind, it.to, optsNow.current, (p) => { if (p - shown >= 0.01 || p === 1) { shown = p; patch(id, { progress: p }); } }, ctrl.signal);
          const name = outName(it.name, it.to);
          if (list.current.find((i) => i.id === id)?.status !== 'busy') continue;
          patch(id, { status: 'done', progress: 1, warn: r.warn, out: { blob: r.blob, name, url: URL.createObjectURL(r.blob) } });
        } catch (e: any) {
          patch(id, ctrl.signal.aborted ? { status: 'idle', progress: 0 } : { status: 'error', error: e?.message || 'Không chuyển được file này' });
        }
      }
    } finally {
      stop.current = null;
      setRunning(false);
    }
  };
  const done = items.filter((i) => i.out);
  const images = items.filter((i) => i.kind === 'image' && i.file);
  const todo = items.filter((i) => i.status === 'idle' || i.status === 'error').length;
  const has = (k: Kind) => items.some((i) => i.kind === k);
  const saveAll = async () => {
    try { download(await zipAll(done.map((i) => ({ name: i.out!.name, blob: i.out!.blob }))), 'da-chuyen-doi.zip'); }
    catch (e: any) { toast(e.message, true); }
  };
  const merge = async () => {
    setMerging(true);
    try {
      const blob = await imagesToPdf(images.map((i) => i.file!), opts);
      const name = `gop-${images.length}-anh.pdf`;
      set([...list.current, { id: nextId++, file: null, name, size: blob.size, kind: 'image', from: 'pdf', to: 'pdf', status: 'done', progress: 1, out: { blob, name, url: URL.createObjectURL(blob) } }]);
    } catch (e: any) { toast(e.message, true); } finally { setMerging(false); }
  };

  return (
    <main className={'tools-page' + (drag ? ' drag' : '')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
      {(running||merging)&&<BrandLoading compact label={merging?'Đang gộp file…':'Đang chuyển đổi…'}/>}
      {canEdit && <section className="tools-editor-entry"><div><Icon name="film" size={22} /><div><h2>Trình dựng video</h2><p>Tạo video mới hoặc mở các bản dựng đã lưu.</p></div></div><button className="btn btn-primary" onClick={() => goto('editor')}>Mở trình dựng<Icon name="right" size={15} /></button></section>}
      <input ref={picker} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <header className="tpl-head">
        <div>
          <h1 className="tpl-title">Chuyển đổi định dạng</h1>
          <p className="tpl-lead">Video, âm thanh, ảnh, phụ đề và bảng tính. File được xử lý ngay trên máy bạn, không tải lên server.</p>
        </div>
        <button className="btn btn-primary" onClick={() => pick()}><Icon name="plus" size={15} />Chọn file</button>
      </header>

      {!items.length ? (
        <>
          <button className="an-drop tools-drop" onClick={() => pick()}>
            <Icon name="share" size={30} />
            <b>Kéo thả file vào đây</b>
            <span>hoặc bấm để chọn — được chọn nhiều file cùng lúc</span>
          </button>
          <div className="tools-kinds">
            {KINDS.map((k) => (
              <button key={k.id} className="tools-kind" onClick={() => pick([k])}>
                <span className="tools-kind-h"><Icon name={k.icon} size={18} />{k.label}</span>
                <span><em>Từ</em>{k.inputs.filter((e) => e !== 'jpeg' && e !== 'heif').map(label).join(', ')}</span>
                <span><em>Sang</em>{[...k.outputs, ...(k.audio || [])].map(label).join(', ')}{k.id === 'image' && canReadGif() ? ' · GIF động → MP4' : ''}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="tools-bar">
            <div className="tools-opts">
              {(has('video') || has('audio')) && (
                <label>Chất lượng
                  <Popup value={opts.quality} onChange={(v) => setOpt({ quality: v as Opts['quality'] })}>
                    <option value="keep">Giữ nguyên</option><option value="high">Cao</option><option value="medium">Vừa</option><option value="low">Nhẹ (file nhỏ)</option>
                  </Popup>
                </label>
              )}
              {has('video') && (
                <label>Độ phân giải
                  <Popup value={opts.size} onChange={(v) => setOpt({ size: Number(v) })}>
                    <option value={0}>Giữ nguyên</option><option value={1080}>1080p</option><option value={720}>720p</option><option value={480}>480p</option>
                  </Popup>
                </label>
              )}
              {has('image') && (
                <label>Kích thước ảnh
                  <Popup value={opts.max} onChange={(v) => setOpt({ max: Number(v) })}>
                    <option value={0}>Giữ nguyên</option><option value={3840}>Tối đa 3840 px</option><option value={1920}>Tối đa 1920 px</option><option value={1080}>Tối đa 1080 px</option><option value={512}>Tối đa 512 px</option>
                  </Popup>
                </label>
              )}
            </div>
            <div className="tools-actions">
              {images.length > 1 && <button className="btn btn-gray btn-sm" disabled={merging} onClick={merge}><Icon name="doc" size={14} />{merging ? 'Đang gộp…' : `Gộp ${images.length} ảnh thành 1 PDF`}</button>}
              {done.length > 1 && <button className="btn btn-gray btn-sm" onClick={saveAll}><Icon name="zip" size={14} />Tải tất cả (.zip)</button>}
              {!running && <button className="btn btn-gray btn-sm" onClick={clear}>Xoá danh sách</button>}
              {running
                ? <button className="btn btn-gray btn-sm" onClick={() => stop.current?.abort()}><Icon name="pause" size={13} />Dừng</button>
                : <button className="btn btn-primary btn-sm" disabled={!todo} onClick={run}><Icon name="refresh" size={14} />Chuyển đổi{todo > 1 ? ` ${todo} file` : ''}</button>}
            </div>
          </div>
          <ul className="tools-list">
            {items.map((it) => (
              <li key={it.id} className={'tools-item ' + it.status}>
                <span className="tools-ico"><Icon name={ICON[it.kind]} size={18} /></span>
                <div className="tools-name">
                  <b title={it.name}>{it.name}</b>
                  <span>
                    {size(it.size)}{it.from && it.file ? ` · ${label(it.from)}` : ''}
                    {it.out && it.file && <> → <strong>{size(it.out.blob.size)}</strong></>}
                    {it.warn && <em className="warn"> · {it.warn}</em>}
                    {it.error && <em className="err"> · {it.error}</em>}
                  </span>
                  {it.status === 'busy' && <span className="tools-prog"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></span>}
                </div>
                {it.file && (
                  <label className="tools-to">
                    <Icon name="arrow" size={14} />
                    <Popup value={it.to} onChange={(v) => retarget(it, v)} title="Đổi sang" disabled={it.status === 'busy'}>
                      {outputsFor(it.kind, it.from, canReadGif()).map((g) => {
                        const options = g.list.map((o) => <option key={o} value={o}>{label(o)}</option>);
                        return g.group ? <optgroup key={g.group} label={g.group}>{options}</optgroup> : options;
                      })}
                    </Popup>
                  </label>
                )}
                <div className="tools-act">
                  {it.status === 'busy' && <span className="tools-pct mono">{Math.round(it.progress * 100)}%</span>}
                  {it.out && <a className="btn btn-tinted btn-sm" href={it.out.url} download={it.out.name}><Icon name="download" size={14} />Tải về</a>}
                  <button className="icon-btn" disabled={it.status === 'busy'} onClick={() => remove(it)} title="Bỏ khỏi danh sách" aria-label={`Bỏ ${it.name}`}><Icon name="x" size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
          <button className="tools-more" onClick={() => pick()}><Icon name="plus" size={15} />Thêm file — hoặc kéo thả vào trang</button>
        </>
      )}
    </main>
  );
}
