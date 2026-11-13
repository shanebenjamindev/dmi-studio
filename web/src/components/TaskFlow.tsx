// A task's review workflow on its page (shared/task-flow.ts): where it stands (ACCOUNT → EXECUTION → REVIEW → COMPLETED
// or REJECTED), who reviews it, the move this account may make now, and every round handed in with what was handed in,
// how it was graded and the feedback.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { fullDate } from './boardkit';
import { RichView } from './RichText';
import { FLOW_OUTCOMES, FLOW_STAGES, isClosedStage, type FlowAction, type FlowStage } from '../../../shared/task-flow';
import type { TaskDetail, TaskMeta } from '../types';
import { askConfirm, askText } from './AskDialog';

const DONE: Record<string, string> = { start: 'Đã giao việc, chuyển sang EXECUTION', submit: 'Đã nộp duyệt', pass: 'Đã duyệt PASS: công việc hoàn thành', redo: 'Đã trả về REDO để làm lại', fail: 'Đã chấm FAIL: công việc bị từ chối', reopen: 'Đã mở lại công việc', reviewer: 'Đã đổi người duyệt' };

/** The workflow speaks English only: each step shows as its code (ACCOUNT, EXECUTION…), the same in every language. */
const codeOf = (key: FlowStage) => FLOW_STAGES.find((x) => x.key === key)!.code;
export function FlowBadge({ stage }: { stage: FlowStage; stages?: unknown }) {
  return <span className={'tf-badge tf-' + stage}><b>{codeOf(stage)}</b></span>;
}

/** The steps in a row (done, now, to come), each a button that opens the moves in a window by it (`onPick`, the step
 *  picked); `open`: that window is open. The card's window shows only this until a step is picked. */
export function FlowSteps({ stage, open = false, onPick }: { stage: FlowStage; open?: boolean; onPick?: (el: HTMLElement) => void }) {
  const order: FlowStage[] = ['account', 'execution', 'review', stage === 'rejected' ? 'rejected' : 'completed'];
  const at = order.indexOf(stage), closed = isClosedStage(stage);
  return (
    <ol className={'tf-steps' + (onPick ? ' pickable' : '') + (open ? ' open' : '')} aria-label="Quy trình duyệt">
      {order.map((key, i) => [i > 0 && <li key={key + '-sep'} className="tf-sep" aria-hidden="true">›</li>,
        <li key={key} className={'tf-' + key + (i < at || (i === at && closed) ? ' done' : '') + (i === at ? ' now' : '')} aria-current={i === at ? 'step' : undefined}>
          {onPick
            ? <button type="button" onClick={(e) => onPick(e.currentTarget)} aria-expanded={open} aria-haspopup="dialog" title={open ? 'Ẩn quy trình duyệt' : 'Mở người duyệt, ghi chú và thao tác của bước'}>{i < at && <Icon name="check" size={11} />}<b>{codeOf(key)}</b></button>
            : <>{i < at && <Icon name="check" size={11} />}<b>{codeOf(key)}</b></>}
        </li>])}
      {onPick && <li className="tf-sep tf-caret" aria-hidden="true"><Icon name={open ? 'up' : 'chevron'} size={12} /></li>}
    </ol>
  );
}

/** The moves of the review workflow (reviewer, note, submit or grade, past rounds) in a window over a dimmed page; a
 *  click outside it, its × or Esc closes it (Esc only it, not the card's window under it). */
export function FlowPop({ task, meta, onClose, onChanged }: { task: TaskDetail; meta: TaskMeta | null; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  const title = `Quy trình duyệt · ${codeOf(task.flow!.stage)}`;
  return (
    <dialog ref={ref} className="tf-modal" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tf-modal-in">
        <header><b>{title}</b><button type="button" className="bk-x" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <TaskFlow task={task} meta={meta} bare steps={false} onChanged={onChanged} />
      </div>
    </dialog>
  );
}

/** `bare`: laid inside another card (the task page opens it under the step's badge), so no card of its own; `steps`:
 *  with its own row of steps and title (the card's window has them on top already). */
export function TaskFlow({ task, meta, onChanged, bare = false, steps = true }: { task: TaskDetail; meta: TaskMeta | null; onChanged: () => void; bare?: boolean; steps?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const f = task.flow;
  if (!f) return null;
  const act = async (action: FlowAction, body: { note?: string; feedback?: string; reason?: string; reviewerId?: string | null } = {}) => {
    setBusy(true);
    try { await api.taskFlow(task.id, { action, ...body }); setNote(''); setFeedback(''); toast(DONE[action]); onChanged(); }
    catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  const closed = isClosedStage(f.stage);
  const outcome = (key: string | null) => FLOW_OUTCOMES.find((o) => o.key === key);
  return (
    <section className={(bare ? '' : 'wework-bento-card ') + 'tf-card' + (bare ? ' tf-bare' : '')} aria-label="Quy trình duyệt">
      {steps && <div className="wework-bento-title">
        <Icon name="checklist" size={14} />
        <span>QUY TRÌNH DUYỆT</span>
        {f.revision > 0 && <span className="tf-redo-count" title="Số lần bị trả về làm lại">REDO ×{f.revision}</span>}
      </div>}
      {steps && <FlowSteps stage={f.stage} />}

      <div className="tf-facts">
        <div><span>Người duyệt</span>
          {f.can.reviewer && meta ? (
            <select className="bk-in" disabled={busy} value={f.reviewerChosen ? f.reviewer?.id || '' : ''} aria-label="Người duyệt" onChange={(e) => void act('reviewer', { reviewerId: e.target.value || null })}>
              <option value="">{task.createdBy ? `Người tạo (${task.createdBy.name})` : 'Người tạo'}</option>
              {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          ) : <b>{f.reviewer?.name || 'Chưa có'}</b>}
        </div>
        {f.submittedAt && <div><span>Nộp gần nhất</span><b>{fullDate(f.submittedAt)}</b></div>}
        {f.reviewedAt && <div><span>Duyệt gần nhất</span><b>{fullDate(f.reviewedAt)}</b></div>}
      </div>

      {f.stage === 'account' && (f.can.start
        ? <div className="tf-act"><p className="note">Đã nhận yêu cầu và giao người làm. Bấm để chuyển sang EXECUTION.</p><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act('start')}>Giao việc → EXECUTION</button></div>
        : <p className="note tf-wait">{task.canEdit ? 'Hãy giao việc cho ít nhất một người, rồi chuyển sang EXECUTION.' : 'Đang chờ Account giao việc.'}</p>)}

      {f.can.submit && (
        <div className="tf-act">
          <textarea className="bk-in" rows={2} maxLength={2000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho người duyệt (không bắt buộc)…" aria-label="Ghi chú khi nộp" />
          <p className="note">Kết quả công việc lúc nộp được lưu lại làm phiên bản của lần này.</p>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act('submit', { note })}><Icon name="send" size={14} />Nộp duyệt</button>
        </div>
      )}

      {f.stage === 'review' && (f.can.review ? (
        <div className="tf-act">
          <textarea className="bk-in" rows={3} maxLength={4000} value={feedback} disabled={busy} onChange={(e) => setFeedback(e.target.value)} placeholder="Nhận xét: bắt buộc khi REDO (cần sửa gì) và FAIL (lý do)…" aria-label="Nhận xét" />
          <div className="tf-grade">
            <button className="btn btn-sm tf-pass" disabled={busy} onClick={() => void act('pass', { feedback })}><Icon name="check" size={14} />PASS</button>
            <button className="btn btn-sm tf-redo" disabled={busy || !feedback.trim()} title={feedback.trim() ? undefined : 'Ghi nhận xét trước'} onClick={() => void act('redo', { feedback })}><Icon name="undo" size={14} />REDO</button>
            <button className="btn btn-sm tf-fail" disabled={busy || !feedback.trim()} title={feedback.trim() ? undefined : 'Ghi lý do trước'} onClick={async () => { if (await askConfirm('Chấm FAIL sẽ đóng công việc (REJECTED). Tiếp tục?')) void act('fail', { feedback }); }}><Icon name="x" size={14} />FAIL</button>
          </div>
        </div>
      ) : <p className="note tf-wait">{`Đang chờ ${f.reviewer?.name || 'người duyệt'} duyệt.`}</p>)}

      {closed && (f.can.reopen
        ? <div className="tf-act tf-row"><p className="note">Công việc đã đóng; không quay lại quy trình trừ khi mở lại.</p><button className="btn btn-gray btn-sm" disabled={busy} onClick={async () => { const reason = await askText('Lý do mở lại (không bắt buộc):'); if (reason !== null) void act('reopen', { reason }); }}><Icon name="refresh" size={14} />Mở lại</button></div>
        : <p className="note tf-wait">Công việc đã đóng. Chỉ người duyệt hoặc Admin mở lại được.</p>)}

      {f.rounds.length > 0 && (
        <details className="tf-history" open={f.rounds.length <= 2}>
          <summary>{`Lịch sử nộp và duyệt (${f.rounds.length})`}</summary>
          <ol>
            {f.rounds.map((r) => {
              const o = outcome(r.outcome);
              return <li key={r.id}>
                <header><b>{`Lần ${r.round}`}</b>{o ? <span className={'tf-out tf-' + o.key}>{o.code}</span> : <span className="tf-out tf-review">REVIEW</span>}</header>
                <p className="tf-line">{`Nộp ${r.submittedBy ? `bởi ${r.submittedBy.name} ` : ''}lúc ${fullDate(r.submittedAt)}`}</p>
                {r.note && <p className="tf-quote">{r.note}</p>}
                {r.result ? <details className="tf-version"><summary>Bản đã nộp</summary><RichView text={r.result} /></details>
                  : r.resultHidden && <p className="note">Chỉ người làm hoặc quản lý công việc xem được bản đã nộp.</p>}
                {r.reviewedAt && <p className="tf-line">{`Duyệt ${r.reviewer ? `bởi ${r.reviewer.name} ` : ''}lúc ${fullDate(r.reviewedAt)}`}</p>}
                {r.feedback && <p className="tf-quote tf-feedback">{r.feedback}</p>}
              </li>;
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
