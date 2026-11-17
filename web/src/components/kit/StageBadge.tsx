import { FLOW_STAGES, isClosedStage, type FlowStage } from '../../../../shared/task-flow';
import { PROJECT_STAGES, type ProjectStage } from '../../../../shared/projects';
import type { TaskState } from '../../types';
import { Icon } from '../ui';

const FLOW_LABELS = Object.fromEntries(FLOW_STAGES.map((s) => [s.key, s.code])) as Record<FlowStage, string>;
const FLOW_ICONS: Record<FlowStage, string> = {
  account: 'clock',
  execution: 'play',
  review: 'eye',
  completed: 'check',
  rejected: 'x',
};

const STATE_INFO: Record<TaskState, { label: string; tone: string; icon: string }> = {
  done: { label: 'Hoàn thành', tone: 'good', icon: 'check' },
  done_late: { label: 'Hoàn thành muộn', tone: 'warn', icon: 'check' },
  overdue: { label: 'Quá hạn', tone: 'bad', icon: 'clock' },
  doing: { label: 'Đang thực hiện', tone: 'doing', icon: 'play' },
  todo: { label: 'Chưa thực hiện', tone: 'neutral', icon: 'clock' },
  paused: { label: 'Tạm dừng', tone: 'neutral', icon: 'pause' },
  cancelled: { label: 'Đã huỷ', tone: 'neutral', icon: 'x' },
  other: { label: 'Khác', tone: 'neutral', icon: 'info' },
};

const SERVICE_STAGE_LABELS = Object.fromEntries(PROJECT_STAGES) as Record<ProjectStage, string>;
const SERVICE_STAGE_TONE: Record<ProjectStage, string> = {
  not_started: 'neutral',
  in_progress: 'doing',
  paused: 'warn',
  done: 'good',
  cancelled: 'neutral',
};

export interface StageBadgeProps {
  stage?: FlowStage | null;
  state?: TaskState | null;
  status?: string;
  solid?: boolean;
  late?: boolean;
}

/** Unified workflow stage & task state indicator sourced from canonical --stage-* and --st-* CSS tokens. */
export function StageBadge({ stage, state, status, solid = false, late }: StageBadgeProps) {
  if (stage) {
    const isOverdue = late ?? (state === 'overdue' && !isClosedStage(stage));
    const toneClass = isOverdue ? 'tone-bad' : `tf-${stage} ${solid ? 'tf-solid' : 'tf-tint'}`;
    return (
      <span className={`ui-stage-badge ${toneClass}`} title={isOverdue ? 'Quá hạn' : undefined}>
        <Icon name={isOverdue ? 'clock' : FLOW_ICONS[stage]} size={11} />
        <span>{FLOW_LABELS[stage]}</span>
      </span>
    );
  }
  const info = STATE_INFO[state || 'other'] || STATE_INFO.other;
  const label = status && info.label === 'Khác' ? status : info.label;
  return (
    <span className={`ui-stage-badge tone-${info.tone}`}>
      <Icon name={info.icon} size={11} />
      <span>{label || 'Chưa có'}</span>
    </span>
  );
}

/** Semantic status pill for Brand Service lifecycle stage. */
export function BrandServiceStageBadge({ stage }: { stage?: ProjectStage | null }) {
  const key = stage || 'not_started';
  return (
    <span className={`ui-stage-badge tone-${SERVICE_STAGE_TONE[key]}`}>
      <span>{SERVICE_STAGE_LABELS[key] || key}</span>
    </span>
  );
}

