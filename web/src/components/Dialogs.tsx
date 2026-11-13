import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, setState, getState, openProject, newProject, startExport, cancelExport, toast } from '../store';
import { Icon, IconButton, Segmented } from './ui';
import type { ProjectItem } from '../types';
import { askConfirm } from './AskDialog';

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
export function ProjectsDialog() {
  const open = useStore((s) => s.dialog === 'projects');
  const current = useStore((s) => s.project?.id);
  const [list, setList] = useState<ProjectItem[]>([]);
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
              <span>{p.clips} clip · {Math.round(p.duration || 0)} giây</span>
            </div>
            <div className="pactions">
              <IconButton icon="copy" label="Nhân bản" size={15} onClick={async () => { await api.duplicateProject(p.id); load(); }} />
              <IconButton icon="trash" label="Xoá dự án" size={15} danger onClick={async () => {
                if (!await askConfirm(`Xoá “${p.title}” cùng mọi file đã tạo?`)) return;
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
