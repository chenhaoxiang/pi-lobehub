import type { GoalGraphSnapshot, GoalTaskExecution } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildGoalGraphView, isRunningNode } from './goalGraphViewModel';

const now = new Date('2026-11-11T12:00:00Z');
const opened = new Date('2026-11-11T11:00:00Z');
const started = new Date('2026-11-11T11:58:00Z');
const facts = (overrides: Partial<GoalTaskExecution> = {}): GoalTaskExecution => ({
  observedAt: now,
  taskId: 'task-1',
  taskStatus: 'running',
  topicId: 'topic-current',
  topicStatus: 'running',
  operationId: 'op-current',
  operation: { id: 'op-current', startedAt: started, status: 'running', updatedAt: now },
  ...overrides,
});
const graph = (execution?: GoalTaskExecution, override: Partial<GoalGraphSnapshot> = {}) =>
  buildGoalGraphView(
    {
      decisions: [],
      edges: [],
      workVersions: [],
      events: [
        {
          id: 'activated',
          entityId: 'node-1',
          entityType: 'node',
          eventType: 'activated',
          createdAt: opened,
        },
      ],
      goal: { id: 'goal-1', status: 'running', updatedAt: now, config: {} },
      nodes: [
        {
          id: 'node-1',
          kind: 'task',
          taskId: 'task-1',
          status: 'active',
          title: 'Task',
          priority: 0,
          createdAt: opened,
          updatedAt: now,
        },
      ],
      ...(execution ? { executions: { 'node-1': execution } } : {}),
      ...override,
    } as GoalGraphSnapshot,
    now.getTime(),
  );

describe('Goal graph uses execution originals, not activation events', () => {
  it('does not call a queued rework running or start its clock from node activation', () => {
    const view = graph(
      facts({
        taskStatus: 'backlog',
        operationId: undefined,
        operation: undefined,
        topicId: undefined,
        topicStatus: undefined,
      }),
    );
    expect(isRunningNode(view.byId['node-1'])).toBe(false);
    expect(view.byId['node-1'].startedAt).toBeUndefined();
    expect(view.frontier[0].kind).toBe('ready');
  });

  it('preserves unknown when execution metadata is absent', () => {
    const view = graph();
    expect(isRunningNode(view.byId['node-1'])).toBe(false);
    expect(view.byId['node-1'].startedAt).toBeUndefined();
    expect(view.frontier[0].kind).toBe('unknown');
  });

  it('starts the clock from the actual operation and keeps its identity', () => {
    const view = graph(facts());
    expect(isRunningNode(view.byId['node-1'])).toBe(true);
    expect(view.byId['node-1'].startedAt).toEqual(started);
    expect(view.byId['node-1'].execution?.operation?.id).toBe('op-current');
  });

  it.each(['waiting_for_human', 'waiting_for_client', 'waiting_for_async_tool', 'idle'] as const)(
    'does not animate %s as executing or manufacture a user decision',
    (status) => {
      const view = graph(
        facts({ operation: { id: 'op-current', startedAt: started, status, updatedAt: now } }),
      );
      expect(isRunningNode(view.byId['node-1'])).toBe(false);
      expect(view.needsYou).toBe(0);
    },
  );

  it('does not treat a different or missing Operation as the current run', () => {
    for (const operation of [
      undefined,
      { id: 'op-old', startedAt: started, status: 'running' as const, updatedAt: now },
    ]) {
      const view = graph(facts({ operation }));
      expect(isRunningNode(view.byId['node-1'])).toBe(false);
      expect(view.frontier[0].kind).toBe('unknown');
    }
  });

  it('shows a recorded state mismatch instead of claiming the queued Task is idle or executing', () => {
    const view = graph(facts({ taskStatus: 'backlog' }));
    expect(isRunningNode(view.byId['node-1'])).toBe(false);
    expect(view.frontier[0].kind).toBe('unknown');
  });

  it('keeps verification separate after execution has ended', () => {
    const view = graph(
      facts({
        topicStatus: 'completed',
        operation: { id: 'op-current', startedAt: started, status: 'done', updatedAt: now },
      }),
      {
        acceptances: { 'node-1': { id: 'acceptance-1', status: 'verifying' } },
      },
    );
    expect(isRunningNode(view.byId['node-1'])).toBe(false);
    expect(view.frontier[0].kind).toBe('verifying');
  });

  it('does not freshen an old Operation heartbeat with a recent graph update', () => {
    const view = graph(
      facts({
        operation: { id: 'op-current', startedAt: opened, status: 'running', updatedAt: opened },
      }),
    );
    expect(view.byId['node-1'].isStale).toBe(true);
    expect(view.byId['node-1'].heartbeatAt).toEqual(opened);
  });

  it('does not count queued work as advanceable while a separate decision holds the Goal', () => {
    const view = graph(
      facts({
        taskStatus: 'backlog',
        operation: undefined,
        operationId: undefined,
        topicId: undefined,
        topicStatus: undefined,
      }),
      {
        goal: {
          id: 'goal-1',
          status: 'review',
          updatedAt: now,
          config: {},
        } as GoalGraphSnapshot['goal'],
        decisions: [
          {
            id: 'decision-1',
            nodeId: 'gate',
            status: 'pending',
            authority: 'user',
          } as GoalGraphSnapshot['decisions'][number],
        ],
      },
    );
    expect(view.advanceable).toBe(0);
  });
});
