// @vitest-environment node
import { createAdapter } from '@lobechat/heterogeneous-agents';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TaskUsageModel } from '@/database/models/taskUsage';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { topics, users } from '@/database/schemas';

import { applyMainIntent } from '../applyIntents';
import type { HeterogeneousPersistenceHandlerDeps, OperationState } from '../types';

const db = await getTestDB();
const userId = 'pi-current-usage-persistence';
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(users);
});

const prepare = async () => {
  const taskModel = new TaskModel(db, userId);
  const task = await taskModel.create({
    instruction: 'Only metadata crosses the usage read boundary',
  });
  const topicId = 'pi-usage-persistence-topic';
  const operationId = 'pi-usage-persistence-operation';
  const messageId = 'pi-usage-persistence-assistant';
  const parentId = 'pi-usage-persistence-user';
  await db.insert(topics).values({ id: topicId, userId });
  await new AgentOperationModel(db, userId).recordStart({
    operationId,
    topicId,
    taskId: task.id,
    provider: 'pi',
  });
  await new TaskTopicModel(db, userId).add(task.id, topicId, { operationId, seq: 1 });
  await taskModel.updateCurrentTopic(task.id, topicId);
  const deps: HeterogeneousPersistenceHandlerDeps = {
    messageModel: new MessageModel(db, userId),
    topicModel: new TopicModel(db, userId),
    threadModel: new ThreadModel(db, userId),
    userId,
  };
  const state = {
    operationId,
    topicId,
    main: { turnMetadata: {}, currentMainMessageId: 'native-pi-message' },
  } as OperationState;
  await deps.messageModel.create(
    { role: 'user', content: 'Synthetic metadata-only test', topicId },
    parentId,
  );
  await applyMainIntent(
    deps,
    state,
    {
      kind: 'createAssistant',
      messageId,
      parentId,
      topicId,
      model: 'synthetic-model',
      provider: 'pi',
    },
    0,
  );
  return { task, operationId, messageId, deps, state };
};
const nativeUsage = (usage: unknown) => {
  const adapter = createAdapter('pi');
  adapter.adapt({ type: 'turn_start' });
  return adapter
    .adapt({
      type: 'message_end',
      message: {
        role: 'assistant',
        model: 'synthetic-model',
        stopReason: 'stop',
        content: [],
        usage,
      },
    })
    .find((event) => event.type === 'step_complete')!.data as {
    model: string;
    provider: string;
    usage: unknown;
  };
};

describe('Pi usage event → original message persistence → current Task projection', () => {
  it('retains the exact operation and promoted usage on replay, without a second settlement', async () => {
    const { task, operationId, messageId, deps, state } = await prepare();
    const event = nativeUsage({
      input: 10,
      output: 5,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 20,
    });
    for (let index = 0; index < 2; index++)
      await applyMainIntent(deps, state, { ...event, kind: 'recordUsage', messageId }, 0);
    const original = await deps.messageModel.findById(messageId);
    expect(original?.metadata).toMatchObject({ operationId });
    expect(original?.usage).toMatchObject({
      inputCacheMissTokens: 10,
      inputCachedTokens: 3,
      inputWriteCacheTokens: 2,
      totalInputTokens: 15,
      totalOutputTokens: 5,
      totalTokens: 20,
    });
    expect(await new TaskUsageModel(db, userId).readCurrent(task.id)).toMatchObject({
      operationId,
      observedMessages: 1,
      measuredMessages: 1,
      tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 },
      totalTokens: 20,
    });
  });

  it('does not manufacture a zero-cost or zero-token run when native usage was absent', async () => {
    const { task, messageId, deps, state } = await prepare();
    const event = nativeUsage({ input: 10, output: 5 });
    await applyMainIntent(deps, state, { ...event, kind: 'recordUsage', messageId }, 0);
    expect((await deps.messageModel.findById(messageId))?.usage).toBeFalsy();
    expect(await new TaskUsageModel(db, userId).readCurrent(task.id)).toMatchObject({
      coverage: 'unavailable',
      measuredMessages: 0,
      totalTokens: null,
      tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
    });
  });
});
