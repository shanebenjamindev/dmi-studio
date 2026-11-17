import { FLOW_STAGES, isClosedStage, type FlowStage } from '../../../../shared/task-flow';
import { Icon } from '../ui';

export interface StageStepperProps {
  stage: FlowStage;
  onSelect?: (stage: FlowStage, el: HTMLElement) => void;
}

/** Clean horizontal stage progression (ACCOUNT › EXECUTION › REVIEW › COMPLETED or REJECTED). */
export function StageStepper({ stage, onSelect }: StageStepperProps) {
  const order: FlowStage[] = ['account', 'execution', 'review', stage === 'rejected' ? 'rejected' : 'completed'];
  const currentIdx = order.indexOf(stage);
  const closed = isClosedStage(stage);

  return (
    <ol className="ui-stepper" aria-label="Tiến trình công việc">
      {order.map((key, idx) => {
        const meta = FLOW_STAGES.find((x) => x.key === key)!;
        const done = idx < currentIdx || (idx === currentIdx && closed);
        const now = idx === currentIdx;
        const cls = `ui-step tf-${key}${done ? ' is-done' : ''}${now ? ' is-now' : ''}`;
        return (
          <li key={key} className="ui-step-wrap">
            {idx > 0 && <span className="ui-step-sep" aria-hidden="true">›</span>}
            {onSelect ? (
              <button
                type="button"
                className={cls}
                aria-current={now ? 'step' : undefined}
                onClick={(e) => onSelect(key, e.currentTarget)}
                title={meta.vi}
              >
                {done && <Icon name="check" size={11} />}
                <span>{meta.code}</span>
              </button>
            ) : (
              <span className={cls} aria-current={now ? 'step' : undefined} title={meta.vi}>
                {done && <Icon name="check" size={11} />}
                <span>{meta.code}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

