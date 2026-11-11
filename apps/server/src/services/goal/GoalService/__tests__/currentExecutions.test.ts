// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { topics, users } from '@/database/schemas';

import { registerGoalServiceTestCleanup } from '../../testUtils';
import { collectCurrentExecutions } from '../currentExecutions';
import { GoalService } from '../index';
import type { GoalServiceContext } from '../types';

const db = await getTestDB();
const userId = 'goal-execution-original-owner';
registerGoalServiceTestCleanup(db, userId);

const prepare = async () => {
  const service = new GoalService(db, userId);
  const graph = await service.create({
    tasks: ['Prepare report'],
    title: 'Execution original fixture',
  });
  const prepared = await service.tick(graph.goal.id);
  return {
    service,
    graph,
    prepared,
    model: new TaskModel(db, userId),
    runs: new TaskTopicModel(db, userId),
    operations: new AgentOperationModel(db, userId),
  };
};

describe('Goal current execution metadata', () => {
  it('reports backlog without manufacturing an Operation from activation', async () => {
    const { service, graph, prepared } = await prepare();
    const read = await service.graph(graph.goal.id);
    expect(read.executions?.[prepared.nodeId!]).toMatchObject({
      taskId: prepared.taskId,
      taskStatus: 'backlog',
    });
    expect(read.executions?.[prepared.nodeId!].operation).toBeUndefined();
    expect(read.executions?.[prepared.nodeId!].operationId).toBeUndefined();
  });

  it('returns only the exact current Operation, not an older still-running topic', async () => {
    const { service, graph, prepared, model, runs, operations } = await prepare();
    await db.insert(topics).values([
      { id: 'goal-exec-old-topic', userId },
      { id: 'goal-exec-current-topic', userId },
    ]);
    await operations.recordStart({
      operationId: 'op-goal-old',
      taskId: prepared.taskId,
      topicId: 'goal-exec-old-topic',
    });
    await operations.recordStart({
      operationId: 'op-goal-current',
      taskId: prepared.taskId,
      topicId: 'goal-exec-current-topic',
      metadata: { privatePrompt: 'do-not-project-fixture-payload' },
    });
    await runs.add(prepared.taskId!, 'goal-exec-old-topic', { operationId: 'op-goal-old', seq: 1 });
    await runs.add(prepared.taskId!, 'goal-exec-current-topic', {
      operationId: 'op-goal-current',
      seq: 2,
    });
    await model.updateCurrentTopic(prepared.taskId!, 'goal-exec-current-topic');
    await model.updateStatus(prepared.taskId!, 'running');
    const read = await service.graph(graph.goal.id);
    expect(read.executions?.[prepared.nodeId!]).toMatchObject({
      taskStatus: 'running',
      topicId: 'goal-exec-current-topic',
      operation: { id: 'op-goal-current', status: 'running' },
    });
    expect(JSON.stringify(read.executions)).not.toContain('op-goal-old');
    expect(JSON.stringify(read.executions)).not.toContain('do-not-project-fixture-payload');
    await operations.recordCompletion('op-goal-current', { status: 'done' });
    const ended = await service.graph(graph.goal.id);
    expect(ended.executions?.[prepared.nodeId!].operation?.status).toBe('done');
  });

  it('keeps a missing operation explicit and rejects an operation attached to another Task', async () => {
    const { service, graph, prepared, model, runs, operations } = await prepare();
    await db.insert(topics).values({ id: 'goal-exec-missing', userId });
    await runs.add(prepared.taskId!, 'goal-exec-missing', { operationId: 'op-missing', seq: 1 });
    await model.updateCurrentTopic(prepared.taskId!, 'goal-exec-missing');
    let read = await service.graph(graph.goal.id);
    expect(read.executions?.[prepared.nodeId!]).toMatchObject({ operationId: 'op-missing' });
    expect(read.executions?.[prepared.nodeId!].operation).toBeUndefined();
    const other = await model.create({
      instruction: 'Another Task, same visible topic is not ownership',
    });
    await operations.recordStart({
      operationId: 'op-missing',
      taskId: other.id,
      topicId: 'goal-exec-missing',
    });
    read = await service.graph(graph.goal.id);
    expect(read.executions?.[prepared.nodeId!].operation).toBeUndefined();
  });

  it('does not mistake an old Operation for a later start claim before the new topic is bound', async () => {
    const { service, graph, prepared, model, runs, operations } = await prepare();
    await db.insert(topics).values({ id: 'goal-exec-prior-generation', userId });
    await operations.recordStart({
      operationId: 'op-prior-generation',
      taskId: prepared.taskId,
      topicId: 'goal-exec-prior-generation',
    });
    await runs.add(prepared.taskId!, 'goal-exec-prior-generation', {
      operationId: 'op-prior-generation',
      seq: 1,
    });
    await model.updateCurrentTopic(prepared.taskId!, 'goal-exec-prior-generation');
    await model.updateStatus(prepared.taskId!, 'running', {
      startedAt: new Date(Date.now() + 1000),
    });
    const read = await service.graph(graph.goal.id);
    expect(read.executions?.[prepared.nodeId!].operation).toBeUndefined();
  });

  it('does not expose another user’s explicitly supplied Task reference', async () => {
    const { service, graph, prepared } = await prepare();
    await db.insert(users).values({ id: 'goal-exec-other-user' });
    const ctx = {
      db,
      userId: 'goal-exec-other-user',
      taskModel: new TaskModel(db, 'goal-exec-other-user'),
      taskTopicModel: new TaskTopicModel(db, 'goal-exec-other-user'),
    } as GoalServiceContext;
    expect(await collectCurrentExecutions(ctx, await service.graph(graph.goal.id))).toEqual({});
    expect(prepared.taskId).toBeTruthy();
  });
});
