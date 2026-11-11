import type { GoalTaskExecution } from '@lobechat/types';
import { isAgentOperationInFlight, isAgentOperationSettled } from '@lobechat/types';

export type GoalExecutionState =
  | 'paused'
  | 'ready'
  | 'running'
  | 'scheduled'
  | 'settled'
  | 'settling'
  | 'starting'
  | 'unknown'
  | 'verifying'
  | 'waiting-client'
  | 'waiting-input'
  | 'waiting-tool';

/** Finite locale keys keep every existing status consumer on the same words. */
export const goalExecutionCopyKey = (state: GoalExecutionState): string =>
  `goalProcess.execution.${state}`;

/** A graph activation and a live transport connection are not execution originals. */
export const deriveGoalExecutionState = (
  facts: GoalTaskExecution | undefined,
  verifying: boolean,
): GoalExecutionState => {
  if (!facts) return verifying ? 'verifying' : 'unknown';
  const operation = facts.operation;
  if (facts.operationId && operation?.id !== facts.operationId) return 'unknown';
  if (operation && isAgentOperationInFlight(operation.status)) {
    if (facts.taskStatus !== 'running' || facts.topicStatus !== 'running') return 'unknown';
    switch (operation.status) {
      case 'idle': {
        return 'starting';
      }
      case 'running': {
        return 'running';
      }
      case 'waiting_for_async_tool': {
        return 'waiting-tool';
      }
      case 'waiting_for_client': {
        return 'waiting-client';
      }
      case 'waiting_for_human': {
        return 'waiting-input';
      }
      default: {
        return 'unknown';
      }
    }
  }
  if (operation && !isAgentOperationSettled(operation.status)) return 'unknown';
  switch (facts.taskStatus) {
    case 'backlog': {
      return 'ready';
    }
    case 'paused': {
      return 'paused';
    }
    case 'scheduled': {
      return 'scheduled';
    }
    case 'completed':
    case 'failed':
    case 'canceled': {
      return 'settled';
    }
    case 'running': {
      return verifying ? 'verifying' : operation ? 'settling' : 'unknown';
    }
    default: {
      return 'unknown';
    }
  }
};
