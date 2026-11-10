// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agents, topics } from '@/database/schemas';
import { GoalService } from '@/server/services/goal';
import { registerGoalServiceTestCleanup } from '@/server/services/goal/testUtils';

import { TaskRunnerService } from '../index';

const m = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent: m.exec, interruptTask: vi.fn().mockResolvedValue({ success: true }) };
  }),
}));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));

const db = await getTestDB();
const userId = 'task-binding-fixture-owner';
registerGoalServiceTestCleanup(db, userId);

beforeEach(async () => {
  m.exec.mockReset();
  await db.insert(agents).values({
    id: 'agt_binding_pi',
    model: 'pi-fixture',
    provider: 'pi',
    userId,
  });
});

describe('Goal → responsible Task → operation binding (provider-free database integration)', () => {
  it('preserves a fast completion, its owner and one operation while the Goal dispatch is returning', async () => {
    const goalService = new GoalService(db, userId);
    const graph = await goalService.create({
      agentId: 'agt_binding_pi',
      criteria: [{ title: 'Owner can inspect the delivered result' }],
      tasks: ['Prepare the result'],
      title: 'A task, not a conversation, owns this delivery',
    });
    const prepared = await goalService.tick(graph.goal.id);
    const taskModel = new TaskModel(db, userId);
    const runModel = new TaskTopicModel(db, userId);
    const operationModel = new AgentOperationModel(db, userId);
    expect(await taskModel.findById(prepared.taskId!)).toMatchObject({
      assigneeAgentId: 'agt_binding_pi',
      assigneeUserId: userId,
      status: 'backlog',
    });

    m.exec.mockImplementation(async (params) => {
      const topicId = `tpc_${randomUUID()}`;
      const operationId = `op_${randomUUID()}`;
      await db.insert(topics).values({ agentId: params.agentId, id: topicId, userId });
      await operationModel.recordStart({
        agentId: params.agentId,
        operationId,
        taskId: params.taskId,
        topicId,
      });
      await params.onOperationCreated(operationId);
      const binding = await runModel.findByTopicId(topicId);
      expect(binding).toMatchObject({ operationId, status: 'running', taskId: params.taskId });
      // A native completion can arrive before the dispatch HTTP response.
      await operationModel.recordCompletion(operationId, { status: 'done' });
      await runModel.updateStatus(params.taskId, topicId, 'completed', {
        reportedOperationId: operationId,
      });
      await taskModel.updateStatusIfCurrent(params.taskId, 'running', 'completed');
      return { operationId, success: true, topicId };
    });

    const dispatched = await goalService.tick(graph.goal.id);
    expect(dispatched.taskId).toBe(prepared.taskId);
    expect(m.exec).toHaveBeenCalledTimes(1);
    const task = await taskModel.findById(prepared.taskId!);
    const runs = await runModel.findByTaskId(prepared.taskId!);
    expect(task).toMatchObject({ assigneeUserId: userId, status: 'completed', totalTopics: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', trigger: 'goal' });
    expect(task?.currentTopicId).toBe(runs[0].topicId);
    expect(await operationModel.findById(runs[0].operationId!)).toMatchObject({
      status: 'done',
      taskId: task?.id,
      topicId: task?.currentTopicId,
    });
    await goalService.tick(graph.goal.id);
    expect(m.exec).toHaveBeenCalledTimes(1);
  });

  it('does not infer another owner’s task from an identifier or cwd', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: 'Private result' });
    await expect(
      new TaskRunnerService(db, 'unrelated-user').runTask({ taskId: task.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(m.exec).not.toHaveBeenCalled();
  });
});
