import { isAgentOperationSettled } from '@lobechat/types';

import {
  goalExecutionCopyKey,
  type GoalExecutionState,
} from '@/features/AgentGoals/ProcessControl/goalExecutionState';
import {
  type GoalNodeView,
  isRunningNode,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

/** The All-tasks glyph, label and clock use the same current-run contract as the graph. */
export type TaskRowState =
  | GoalExecutionState
  | 'decision'
  | 'done'
  | 'queued'
  | 'retired'
  | 'stalled'
  | 'waiting'
  | 'waitingQuota';

export const taskRowState = (view: GoalNodeView): TaskRowState => {
  if (view.halted) return 'unknown';
  if (view.isStale) return 'stalled';
  if (view.quotaRetryAt) return 'waitingQuota';
  if (view.decision?.authority === 'user' && view.decision.status === 'pending') return 'decision';
  if (isRunningNode(view)) return 'running';
  if (view.node.status === 'resolved') return 'done';
  if (view.node.status === 'rejected' || view.node.status === 'retired') return 'retired';
  if (view.node.status === 'active') return view.executionState ?? 'unknown';
  if (view.node.status === 'waiting') return 'waiting';
  return 'queued';
};

export const taskRowStateLabelKey = (view: GoalNodeView, state: TaskRowState) => {
  switch (state) {
    case 'stalled': {
      return 'goalProcess.tag.stalled' as const;
    }
    case 'waitingQuota': {
      return 'goalProcess.tag.waitingQuota' as const;
    }
    case 'decision': {
      return 'goalProcess.tag.needsDecision' as const;
    }
    case 'waiting': {
      return 'goalBatch.cell.waiting' as const;
    }
    case 'done':
    case 'queued':
    case 'retired': {
      return `goalProcess.nodeStatus.${view.node.status}` as const;
    }
    default: {
      return goalExecutionCopyKey(state);
    }
  }
};

export interface TaskRowSpan {
  /** Absent only for a recorded, currently running Operation. */
  endedAt?: Date;
  startedAt: Date;
}

/** A current Operation span, never a duration manufactured from graph activations. */
export const taskRowSpan = (
  view: GoalNodeView,
  state: TaskRowState = taskRowState(view),
): TaskRowSpan | undefined => {
  const operation = view.execution?.operation;
  if (!operation?.startedAt) return undefined;
  if (state === 'running') return { startedAt: operation.startedAt };
  if (!isAgentOperationSettled(operation.status) || !operation.completedAt) return undefined;
  return { endedAt: operation.completedAt, startedAt: operation.startedAt };
};

/** A Task metric opens its real Task; other kinds keep the node drill-down. */
export const metricRowTaskId = (view: GoalNodeView): string | undefined =>
  view.node.kind === 'task' ? (view.node.taskId ?? undefined) : undefined;
