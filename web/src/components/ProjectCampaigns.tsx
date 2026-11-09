import { ProjectMembers } from './ProjectMembers';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { TasksPage } from './Tasks';
import { ProjectEditDialog } from './ProjectEditDialog';
import type { TaskMeta } from '../types';

/** `onEdited`: after Chỉnh sửa dự án saved (name, customer, services or status). */
export function ProjectCampaigns({ id, name, displayView = 'list', onEdited, onDeleted, onBack }: { id: string; name: string; displayView?: 'list' | 'grid' | 'table'; onEdited?: () => void; onDeleted?: () => void; onBack?: () => void }) {
  const [manage, setManage] = useState(false), [members, setMembers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<TaskMeta['projects'][number] | null>(null);

  const loadAccess = () => {
    let active = true;
    api.projectMembers(id).then((d) => { if (active) setManage(d.level === 'admin'); }, () => {});
    return () => { active = false; };
  };

  useEffect(() => {
    setManage(false);
    setMembers(false);
    return loadAccess();
  }, [id]);

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <section className="project-campaign-shell">
      <header className="project-compact-header">
        <div className="project-header-left">
          {onBack && (
            <button type="button" className="btn btn-gray btn-sm project-back-btn" onClick={onBack} title="Quay lại danh sách dự án">
              <Icon name="left" size={14} />
              <span>Tất cả dự án</span>
            </button>
          )}
          {onBack && <span className="project-header-sep">/</span>}
          <div className="project-title-badge">
            <span className="project-folder-ico"><Icon name="folder" size={16} /></span>
            <h2 title={name}>{name}</h2>
          </div>
        </div>
        <div className="crm-section-actions">
          <button type="button" className="btn btn-gray btn-sm" onClick={() => setMembers(true)}>
            <Icon name="users" size={14} />
            <span>Thành viên dự án</span>
          </button>
          {manage && (
            <>
              <button
                type="button"
                className="btn btn-gray btn-sm"
                disabled={busy}
                onClick={() => void act(async () => {
                  const project = (await api.taskMeta()).projects.find((p) => p.id === id);
                  if (!project) throw new Error('Không tìm thấy dự án này');
                  setEditing(project);
                })}
              >
                <Icon name="edit" size={14} />
                <span>Sửa</span>
              </button>
              <button
                type="button"
                className="btn btn-sm cm-danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Xoá dự án “${name}”? Các công việc được giữ lại và gỡ khỏi dự án.`)) return;
                  setBusy(true);
                  try {
                    await api.deleteTaskProject(id);
                    toast(`Đã xoá dự án “${name}”.`);
                    onDeleted?.();
                    window.dispatchEvent(new Event('dms:entities-changed'));
                  } catch (e: any) {
                    toast(e.message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="trash" size={14} />
                <span>Xoá dự án</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className="project-campaign-detail">
        <TasksPage
          embedded
          key={id}
          initialProject={id}
          projectName={name}
          forcedView={displayView === 'table' ? 'table' : undefined}
        />
      </div>
      {members && (
        <ProjectMembers
          id={id}
          onClose={() => setMembers(false)}
          onChanged={() => {
            loadAccess();
            window.dispatchEvent(new Event('dms:entities-changed'));
          }}
        />
      )}
      {editing && <ProjectEditDialog project={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onEdited?.(); window.dispatchEvent(new Event('dms:entities-changed')); }} />}
    </section>
  );
}
