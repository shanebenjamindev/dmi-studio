import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, setState, getState, openProject, newProject, refreshProviders, startExport, cancelExport, toast } from '../store';
import { Icon, IconButton, Segmented } from './ui';
import type { Project } from '../types';

export function Sheet({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: any; wide?: boolean; footer?: any }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={'sheet' + (wide ? ' wide' : '')} onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="sheet-in">
          <header className="sheet-h"><h2>{title}</h2><IconButton icon="x" label="Đóng" size={16} className="close" onClick={onClose} /></header>
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-f">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
const close = () => setState({ dialog: null });
const KIND = { llm: 'Kịch bản', video: 'Video', image: 'Ảnh', tts: 'Giọng đọc' } as const;

export function SettingsDialog() {
  const open = useStore((s) => s.dialog === 'settings');
  const providers = useStore((s) => s.providers);
  const [keys, setKeys] = useState<{ env: string; source: string; masked: string }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => { if (open) api.settings().then((s) => setKeys(s.keys)).catch(() => {}); else setEditing(null); }, [open]);

  const groups = new Map<string, typeof providers>();
  providers.filter((p) => !p.mock).forEach((p) => groups.set(p.keyEnv, [...(groups.get(p.keyEnv) || []), p]));
  const save = async (env: string, value: string) => {
    try {
      await api.setKey(env, value);
      setKeys((await api.settings()).keys);
      await refreshProviders();
      setEditing(null); setDraft('');
      toast(value ? 'Đã lưu' : 'Đã xoá key');
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <Sheet open={open} onClose={close} title="Nền tảng AI" wide footer={<button className="btn btn-primary" onClick={close}>Xong</button>}>
      <p className="sheet-lead">Thêm API key cho nền tảng bạn dùng. Key được lưu trên máy chủ DM Studio của bạn và không bao giờ gửi về trình duyệt.</p>
      <div className="list">
        {[...groups.entries()].map(([env, ps]) => {
          const k = keys.find((x) => x.env === env);
          const ok = k && k.source !== 'none';
          const vendor = [...new Set(ps.map((p) => p.vendor.split(' (')[0]))].join(', ');
          const docs = ps.find((p) => p.docs)?.docs;
          return (
            <div key={env} className="list-row">
              <div className={'status-dot' + (ok ? ' ok' : '')}>{ok ? <Icon name="check" size={13} /> : <Icon name="key" size={13} />}</div>
              <div className="list-main">
                <b>{vendor}</b>
                <span>{ps.map((p) => `${p.name} (${KIND[p.kind]})`).join(' · ')}</span>
                {editing === env && (
                  <div className="key-edit">
                    <input type="password" autoFocus autoComplete="off" placeholder={ps.find((p) => p.keyHint)?.keyHint || 'Dán API key'} value={draft}
                      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft) save(env, draft); if (e.key === 'Escape') setEditing(null); }} />
                    <button className="btn btn-primary btn-sm" disabled={!draft} onClick={() => save(env, draft)}>Lưu</button>
                    <button className="btn btn-plain btn-sm" onClick={() => setEditing(null)}>Huỷ</button>
                  </div>
                )}
                {editing === env && (ps[0].note || docs) && <span className="tiny">{ps[0].note} {docs && <a href={docs} target="_blank" rel="noreferrer">Lấy key ↗</a>}</span>}
              </div>
              {editing !== env && (
                <div className="list-side">
                  {ok && <span className="masked">{k!.source === 'env' ? '.env · ' : ''}{k!.masked}</span>}
                  <button className="btn btn-gray btn-sm" onClick={() => { setEditing(env); setDraft(''); }}>{ok ? 'Đổi' : 'Thêm key'}</button>
                  {k?.source === 'saved' && <IconButton icon="trash" label="Xoá key" size={15} danger onClick={() => save(env, '')} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export function ProjectsDialog() {
  const open = useStore((s) => s.dialog === 'projects');
  const current = useStore((s) => s.project?.id);
  const [list, setList] = useState<Project[]>([]);
  const load = () => api.listProjects().then(setList).catch((e) => toast(e.message, true));
  useEffect(() => { if (open) load(); }, [open]);
  return (
    <Sheet open={open} onClose={close} title="Dự án" wide footer={<button className="btn btn-primary" onClick={() => newProject()}><Icon name="plus" size={16} />Dự án mới</button>}>
      {!list.length && <p className="sheet-lead">Chưa có dự án nào.</p>}
      <div className="grid-projects">
        {list.map((p) => (
          <div key={p.id} className={'pcard' + (p.id === current ? ' cur' : '')}>
            <button className="pthumb" onClick={() => openProject(p.id)} style={{ background: p.palette ? `linear-gradient(135deg, ${p.palette.bg1}, ${p.palette.bg2})` : '#e8e8ed' }}>
              <span>{p.aspect}</span>
            </button>
            <div className="pmeta">
              <button className="pname" onClick={() => openProject(p.id)}>{p.title}</button>
              <span>{p.scenes} cảnh · {Math.round(p.duration || 0)} giây</span>
            </div>
            <div className="pactions">
              <IconButton icon="copy" label="Nhân bản" size={15} onClick={async () => { await api.duplicateProject(p.id); load(); }} />
              <IconButton icon="trash" label="Xoá dự án" size={15} danger onClick={async () => {
                if (!confirm(`Xoá “${p.title}” cùng mọi file đã tạo?`)) return;
                await api.deleteProject(p.id);
                if (p.id === getState().project?.id) setState({ project: null });
                load();
              }} />
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function ExportDialog() {
  const open = useStore((s) => s.dialog === 'export');
  const exp = useStore((s) => s.exp);
  const ffmpeg = useStore((s) => s.ffmpeg);
  const [res, setRes] = useState(1080);
  const busy = exp.phase === 'recording' || exp.phase === 'uploading';
  const onClose = () => { if (busy) cancelExport(); close(); };
  const footer =
    exp.phase === 'setup' ? <><button className="btn btn-gray" onClick={close}>Huỷ</button><button id="exStart" className="btn btn-primary" onClick={() => startExport(res)}>Xuất</button></>
    : exp.phase === 'recording' ? <button className="btn btn-gray" onClick={cancelExport}>Dừng</button>
    : exp.phase === 'done' ? <><button className="btn btn-gray" onClick={close}>Xong</button>{exp.download && <a id="exDownload" className="btn btn-primary" href={exp.download}><Icon name="download" size={16} />Tải xuống</a>}</>
    : exp.phase === 'error' ? <button className="btn btn-gray" onClick={close}>Đóng</button> : null;
  return (
    <Sheet open={open} onClose={onClose} title={exp.phase === 'done' ? 'Video đã sẵn sàng' : 'Xuất video'} footer={footer}>
      {exp.phase === 'setup' && (<>
        <Segmented<number> full value={res} onChange={setRes} options={[[1080, '1080p · Full HD'], [720, '720p · Nhẹ hơn']]} />
        <p className="sheet-lead">Video được ghi theo thời gian thực, gồm hình nền AI, nhạc, giọng đọc và logo, rồi lưu vào dự án{ffmpeg ? ' dưới dạng MP4' : ''}. Giữ cửa sổ này mở cho tới khi xong.</p>
      </>)}
      {busy && (<div className="export-run">
        <div className="ring" style={{ ['--p' as any]: exp.progress }}><span>{Math.round(exp.progress * 100)}%</span></div>
        <p className="sheet-lead">{exp.phase === 'recording' ? `Đang ghi · ${exp.text}` : exp.text}</p>
      </div>)}
      {exp.phase === 'done' && exp.url && <video id="exVideo" src={exp.url + '#t=0.8'} controls playsInline />}
      {exp.phase === 'error' && <p className="note err">{exp.error}</p>}
    </Sheet>
  );
}
