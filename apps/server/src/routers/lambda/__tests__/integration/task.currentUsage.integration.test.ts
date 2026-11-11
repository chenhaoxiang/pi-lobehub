// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { messages, topics } from '@/database/schemas';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let db: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
let userId: string;
let otherId: string;

beforeEach(async () => {
  db = await getTestDB();
  userId = await createTestUser(db);
  otherId = await createTestUser(db);
});
afterEach(async () => {
  await cleanupTestUser(db, userId);
  await cleanupTestUser(db, otherId);
});

describe('task.currentUsage original read route', () => {
  it('returns an explicit unavailable read for an owned Task without a current run', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: 'No run has started' });
    const caller = taskRouter.createCaller(createTestContext(userId));
    expect(await caller.currentUsage({ taskId: task.id })).toMatchObject({
      taskId: task.id,
      coverage: 'unavailable',
      totalTokens: null,
    });
    await expect(
      taskRouter.createCaller(createTestContext(otherId)).currentUsage({ taskId: task.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.currentUsage({ taskId: 'task_missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reads only the explicitly associated operation without answering or starting anything', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Read-only usage' });
    await db.insert(topics).values({ id: 'current-usage-api-topic', userId });
    await new AgentOperationModel(db, userId).recordStart({
      operationId: 'current-usage-api-op',
      taskId: task.id,
      topicId: 'current-usage-api-topic',
      provider: 'pi',
    });
    await new TaskTopicModel(db, userId).add(task.id, 'current-usage-api-topic', {
      operationId: 'current-usage-api-op',
      seq: 1,
    });
    await model.updateCurrentTopic(task.id, 'current-usage-api-topic');
    await db.insert(messages).values({
      id: 'current-usage-api-message',
      userId,
      topicId: 'current-usage-api-topic',
      role: 'assistant',
      content: 'Private response text',
      metadata: { operationId: 'current-usage-api-op' },
      usage: {
        inputCacheMissTokens: 10,
        inputCachedTokens: 6,
        inputWriteCacheTokens: 2,
        totalInputTokens: 18,
        totalOutputTokens: 3,
        totalTokens: 21,
      },
    });
    const caller = taskRouter.createCaller(createTestContext(userId));
    const first = await caller.currentUsage({ taskId: task.id });
    const second = await caller.currentUsage({ taskId: task.id });
    expect(first).toMatchObject({
      measuredMessages: 1,
      totalTokens: 21,
      tokens: { input: 10, output: 3, cacheRead: 6, cacheWrite: 2 },
    });
    expect(second.tokens).toEqual(first.tokens);
    expect(JSON.stringify(first)).not.toContain('Private response text');
    expect((await model.findById(task.id))?.status).toBe('backlog');
  });
});
