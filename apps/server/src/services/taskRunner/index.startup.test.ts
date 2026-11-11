import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InternalExecAgentParams } from '@/server/services/aiAgent/types';

import { TaskRunnerService } from './index';

const m = vi.hoisted(() => ({
  agent: vi.fn(),
  exec: vi.fn(),
  operation: vi.fn(),
  stop: vi.fn(),
  task: vi.fn(),
  taskTopic: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: m.agent }));
vi.mock('@/database/models/agentOperation', () => ({ AgentOperationModel: m.operation }));
vi.mock('@/database/models/task', () => ({ TaskModel: m.task }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: m.taskTopic }));
vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findById: vi.fn().mockResolvedValue({ metadata: {} }) };
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent: m.exec, interruptTask: m.stop };
  }),
}));
vi.mock('@/server/services/taskLifecycle', () => ({ TaskLifecycleService: vi.fn() }));
vi.mock('./buildTaskPrompt', () => ({
  buildTaskPrompt: vi.fn().mockResolvedValue({
    acceptanceEnabled: false,
    fileIds: [],
    prompt: 'Deliver the assigned task',
  }),
}));

describe('TaskRunner startup ownership', () => {
  let task: any;
  let rows: any[];
  let taskModel: Record<string, ReturnType<typeof vi.fn<(...args: any[]) => any>>>;
  let topicModel: Record<string, ReturnType<typeof vi.fn<(...args: any[]) => any>>>;
  const db = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    task = {
      assigneeAgentId: 'agt_pi',
      config: { model: 'pi-fixture', provider: 'pi' },
      id: 'task-1',
      identifier: 'T-1',
      status: 'backlog',
      startedAt: new Date('2026-11-11T00:00:00Z'),
      totalTopics: 0,
    };
    rows = [];
    taskModel = {
      findById: vi.fn(async () => ({ ...task })),
      getCheckpointConfig: vi.fn().mockReturnValue({}),
      getReviewConfig: vi.fn(),
      incrementTopicCount: vi.fn(async () => {
        task.totalTopics += 1;
      }),
      lockForUpdate: vi.fn().mockResolvedValue(true),
      getUnlockedTasksForMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateCurrentTopic: vi.fn(async (_id, id) => {
        task.currentTopicId = id;
      }),
      updateHeartbeat: vi.fn(),
      updateStatus: vi.fn(async (_id, status) => {
        task.status = status;
      }),
      updateStatusIfCurrent: vi.fn(async (_id, from, to) => {
        if (task.status !== from) return null;
        task.status = to;
        return { ...task };
      }),
      updateTaskConfig: vi.fn(),
    };
    topicModel = {
      add: vi.fn(async (_taskId, topicId, options) => {
        rows.push({ ...options, topicId, status: 'running' });
      }),
      findByTaskId: vi.fn(async () => rows.map((row) => ({ ...row }))),
      updateStatus: vi.fn(async (_taskId, topicId, status) => {
        const row = rows.find((r) => r.topicId === topicId);
        if (row) row.status = status;
        return !!row;
      }),
      updateOperationId: vi.fn(async (_taskId, topicId, operationId) => {
        const row = rows.find((r) => r.topicId === topicId);
        if (row) row.operationId = operationId;
      }),
    };
    m.task.mockImplementation(function () {
      return taskModel;
    });
    m.taskTopic.mockImplementation(function () {
      return topicModel;
    });
    m.agent.mockImplementation(function () {
      return { getBuiltinAgent: vi.fn().mockResolvedValue({ id: 'agt_inbox' }) };
    });
    m.operation.mockImplementation(function () {
      return {
        findById: vi.fn().mockResolvedValue({ id: 'op-1', taskId: task.id, topicId: 'topic-1' }),
      };
    });
    m.exec.mockImplementation(async (params: InternalExecAgentParams) => {
      await params.onOperationCreated?.('op-1');
      return { operationId: 'op-1', success: true, topicId: 'topic-1' };
    });
    m.stop.mockResolvedValue({ success: true });
  });

  it('binds the operation and current topic before Pi or an owner callback can run', async () => {
    const owner = vi.fn(async () => {
      expect(task.currentTopicId).toBe('topic-1');
      expect(rows).toEqual([
        expect.objectContaining({ operationId: 'op-1', status: 'running', trigger: 'manual' }),
      ]);
    });
    await new TaskRunnerService(db, 'u1').runTask({ onOperationCreated: owner, taskId: task.id });
    expect(owner).toHaveBeenCalledWith('op-1');
    expect(task.totalTopics).toBe(1);
    expect(topicModel.add).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a run that finishes before execAgent returns', async () => {
    m.exec.mockImplementation(async (params: InternalExecAgentParams) => {
      await params.onOperationCreated?.('op-1');
      // A fast native operation completes synchronously after dispatch.
      await topicModel.updateStatus(task.id, 'topic-1', 'completed');
      task.status = 'completed';
      return { operationId: 'op-1', success: true, topicId: 'topic-1' };
    });
    await new TaskRunnerService(db, 'u1').runTask({ taskId: task.id });
    expect(rows).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(task.status).toBe('completed');
    expect(task.totalTopics).toBe(1);
  });

  it('refuses another kickoff while the first has claimed the task but not created a topic', async () => {
    task.status = 'running';
    await expect(
      new TaskRunnerService(db, 'u1').runTask({ taskId: task.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(m.exec).not.toHaveBeenCalled();
    expect(taskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('allows the Goal coordinator that already won its task claim to dispatch', async () => {
    task.status = 'running';
    await new TaskRunnerService(db, 'u1').runTask({
      goalClaimStartedAt: task.startedAt,
      taskId: task.id,
      trigger: 'goal',
    });
    expect(m.exec).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ operationId: 'op-1', trigger: 'goal' });
  });

  it('does not dispatch a Goal claim that was withdrawn before the runner read it', async () => {
    await expect(
      new TaskRunnerService(db, 'u1').runTask({
        goalClaimStartedAt: task.startedAt,
        taskId: task.id,
        trigger: 'goal',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(m.exec).not.toHaveBeenCalled();
    expect(task.status).toBe('backlog');
  });

  it('does not bind or pause a replacement claim that started while this dispatcher prepared', async () => {
    task.status = 'running';
    task.startedAt = new Date('2026-11-11T00:00:00Z');
    m.exec.mockImplementation(async (params: InternalExecAgentParams) => {
      task.startedAt = new Date('2026-11-11T00:00:05Z');
      await params.onOperationCreated?.('op-1');
      return { operationId: 'op-1', success: true, topicId: 'topic-1' };
    });
    await expect(
      new TaskRunnerService(db, 'u1').runTask({
        goalClaimStartedAt: task.startedAt,
        taskId: task.id,
        trigger: 'goal',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(rows).toEqual([]);
    expect(task.status).toBe('running');
  });

  it('refuses to continue a topic that is not linked to this task', async () => {
    await expect(
      new TaskRunnerService(db, 'u1').runTask({
        continueTopicId: 'other-task-topic',
        taskId: task.id,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(m.exec).not.toHaveBeenCalled();
  });

  it('marks its pre-bound attempt failed when a preparation callback refuses startup', async () => {
    await expect(
      new TaskRunnerService(db, 'u1').runTask({
        onOperationCreated: async () => {
          throw new Error('owner preparation failed');
        },
        taskId: task.id,
      }),
    ).rejects.toThrow('owner preparation failed');
    expect(rows[0]).toMatchObject({ operationId: 'op-1', status: 'failed' });
    expect(task.status).toBe('paused');
  });

  it('does not pause an accepted live Pi run if a later heartbeat write fails', async () => {
    taskModel.updateHeartbeat.mockRejectedValue(new Error('heartbeat unavailable'));
    await expect(new TaskRunnerService(db, 'u1').runTask({ taskId: task.id })).rejects.toThrow(
      'heartbeat unavailable',
    );
    expect(rows[0].status).toBe('running');
    expect(task.status).toBe('running');
  });

  it('keeps a human responsible while the inbox agent executes the task', async () => {
    task.assigneeAgentId = null;
    task.assigneeUserId = 'human-owner';
    await new TaskRunnerService(db, 'u1').runTask({ taskId: task.id });
    expect(m.exec).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agt_inbox' }));
    expect(task.assigneeUserId).toBe('human-owner');
    expect(taskModel.update).not.toHaveBeenCalled();
  });

  it('does not let duplicate dependency unlock pause the winning runner', async () => {
    taskModel.getUnlockedTasksForMany.mockResolvedValue([{ ...task }]);
    const runner = new TaskRunnerService(db, 'u1');
    vi.spyOn(runner, 'runTask').mockRejectedValue(new TRPCError({ code: 'CONFLICT' }));
    const result = await runner.cascadeOnCompletionMany(['upstream']);
    expect(result.failed).toEqual([]);
    expect(taskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent start when a dependency checkpoint holds', async () => {
    const dependent = { ...task, parentTaskId: 'parent' };
    taskModel.getUnlockedTasksForMany.mockResolvedValue([dependent]);
    taskModel.shouldPauseBeforeStart = vi.fn().mockReturnValue(true);
    task.status = 'running';
    await new TaskRunnerService(db, 'u1').cascadeOnCompletionMany(['upstream']);
    expect(task.status).toBe('running');
    expect(taskModel.updateStatus).not.toHaveBeenCalled();
  });
});
