import type { AgentOperationStatus, GoalTaskExecution } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { GoalNodeView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

import { metricRowTaskId, taskRowSpan, taskRowState, taskRowStateLabelKey } from './taskRowState';

const STARTED = new Date('2026-09-26T10:00:00Z');
const RUN_STARTED = new Date('2026-09-26T10:05:00Z');
const HEARTBEAT = new Date('2026-09-26T10:20:00Z');
const ENDED = new Date('2026-09-26T10:40:00Z');
const execution = (
  status: AgentOperationStatus = 'running',
  completedAt: Date | null = null,
): GoalTaskExecution => ({
  observedAt: HEARTBEAT,
  taskId: 'task-1',
  taskStatus: 'running',
  topicStatus: 'running',
  operationId: 'op-1',
  operation: { id: 'op-1', status, startedAt: RUN_STARTED, updatedAt: HEARTBEAT, completedAt },
});
const view = (overrides: Partial<GoalNodeView> & { status?: string } = {}): GoalNodeView => {
  const { status = 'active', ...rest } = overrides;
  return {
    attempts: [{ index: 1, outcome: 'running', startedAt: STARTED }],
    heartbeatAt: HEARTBEAT,
    isStale: false,
    node: { kind: 'task', status },
    ...rest,
  } as unknown as GoalNodeView;
};

describe('taskRowState', () => {
  it('keeps missing run originals unknown and never reuses the graph activation clock', () => {
    const missing = view();
    expect(taskRowState(missing)).toBe('unknown');
    expect(taskRowStateLabelKey(missing, 'unknown')).toBe('goalProcess.execution.unknown');
    expect(taskRowSpan(missing)).toBeUndefined();
    const queued = view({ executionState: 'ready' });
    expect(taskRowState(queued)).toBe('ready');
    expect(taskRowStateLabelKey(queued, 'ready')).toBe('goalProcess.execution.ready');
    expect(taskRowSpan(queued)).toBeUndefined();
  });

  it('ticks only the exact current Operation, not an earlier graph activation', () => {
    const running = view({ executionState: 'running', execution: execution() });
    expect(taskRowState(running)).toBe('running');
    expect(taskRowStateLabelKey(running, 'running')).toBe('goalProcess.execution.running');
    expect(taskRowSpan(running)).toEqual({ endedAt: undefined, startedAt: RUN_STARTED });
  });

  it('reads a stale active task as stalled, without inventing an operation end from its heartbeat', () => {
    const stale = view({ executionState: 'running', execution: execution(), isStale: true });
    expect(taskRowState(stale)).toBe('stalled');
    expect(taskRowStateLabelKey(stale, 'stalled')).toBe('goalProcess.tag.stalled');
    expect(taskRowSpan(stale)).toBeUndefined();
  });

  it('reads a usage-window hold without starting a run clock', () => {
    const held = view({ quotaRetryAt: ENDED });
    expect(taskRowState(held)).toBe('waitingQuota');
    expect(taskRowStateLabelKey(held, 'waitingQuota')).toBe('goalProcess.tag.waitingQuota');
    expect(taskRowSpan(held)).toBeUndefined();
  });

  it('reserves the human decision glyph for an original pending user decision', () => {
    const parked = view({
      decision: { id: 'd1', status: 'pending', authority: 'user' } as GoalNodeView['decision'],
    });
    expect(taskRowState(parked)).toBe('decision');
    expect(taskRowStateLabelKey(parked, 'decision')).toBe('goalProcess.tag.needsDecision');
    expect(taskRowSpan(parked)).toBeUndefined();
    const machine = view({
      decision: { id: 'd2', status: 'pending', authority: 'agent' } as GoalNodeView['decision'],
    });
    expect(taskRowState(machine)).not.toBe('decision');
  });

  it.each([
    ['waiting-input', 'waiting_for_human'],
    ['waiting-client', 'waiting_for_client'],
    ['waiting-tool', 'waiting_for_async_tool'],
  ] as const)('keeps %s distinct, without a running clock', (state, status) => {
    const waiting = view({ executionState: state, execution: execution(status) });
    expect(taskRowState(waiting)).toBe(state);
    expect(taskRowStateLabelKey(waiting, state)).toBe(`goalProcess.execution.${state}`);
    expect(taskRowSpan(waiting)).toBeUndefined();
  });

  it('uses the current completed Operation span, not the graph’s first-to-last transition span', () => {
    const done = view({
      attempts: [
        { endedAt: HEARTBEAT, index: 1, outcome: 'failed', startedAt: STARTED },
        { endedAt: ENDED, index: 2, outcome: 'passed', startedAt: HEARTBEAT },
      ],
      execution: execution('done', ENDED),
      status: 'resolved',
    });
    expect(taskRowState(done)).toBe('done');
    expect(taskRowSpan(done)).toEqual({ endedAt: ENDED, startedAt: RUN_STARTED });
    expect(taskRowSpan(view({ status: 'resolved' }))).toBeUndefined();
  });

  it('has no span for a task that was never dispatched', () => {
    const queued = view({ attempts: [], status: 'proposed' });
    expect(taskRowState(queued)).toBe('queued');
    expect(taskRowSpan(queued)).toBeUndefined();
  });
});

describe('metricRowTaskId', () => {
  it('opens the real Task detail for Task rows and the node drill-down otherwise', () => {
    const task = view({ node: { kind: 'task', status: 'resolved', taskId: 'task_1' } } as never);
    expect(metricRowTaskId(task)).toBe('task_1');
    expect(
      metricRowTaskId(view({ node: { kind: 'task', status: 'pending' } } as never)),
    ).toBeUndefined();
    expect(
      metricRowTaskId(
        view({ node: { kind: 'finding', status: 'resolved', taskId: 't' } } as never),
      ),
    ).toBeUndefined();
  });
});
