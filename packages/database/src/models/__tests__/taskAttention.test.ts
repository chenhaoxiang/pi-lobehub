// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  messagePlugins,
  messages,
  tasks,
  taskTopics,
  topics,
  users,
  workspaces,
} from '../../schemas';
import { AgentOperationModel } from '../agentOperation';
import { TaskModel } from '../task';
import { TaskAttentionModel } from '../taskAttention';
import { TaskTopicModel } from '../taskTopic';

const db = await getTestDB();
const owner = 'task-attention-owner';
const other = 'task-attention-other';
const now = Date.now();

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
});
afterEach(async () => {
  await db.delete(users);
});

const seed = async ({
  userId = owner,
  workspaceId,
}: { userId?: string; workspaceId?: string } = {}) => {
  const suffix = randomUUID();
  const taskModel = new TaskModel(db, userId, workspaceId);
  const task = await taskModel.create({ instruction: 'Test pending input', name: 'Scoped task' });
  const agentId = `agt-${suffix}`;
  const topicId = `tpc-${suffix}`;
  const operationId = `op-${suffix}`;
  const messageId = `msg-${suffix}`;
  await db.insert(agents).values({ id: agentId, userId, workspaceId });
  await db.insert(topics).values({ id: topicId, agentId, userId, workspaceId });
  await new AgentOperationModel(db, userId, workspaceId).recordStart({
    operationId,
    topicId,
    taskId: task.id,
    agentId,
  });
  await new TaskTopicModel(db, userId, workspaceId).add(task.id, topicId, { operationId, seq: 1 });
  await taskModel.updateCurrentTopic(task.id, topicId);
  await taskModel.updateStatus(task.id, 'running');
  await db.insert(messages).values({
    id: messageId,
    agentId,
    topicId,
    userId,
    workspaceId,
    role: 'tool',
    content: 'Private question content is not an inbox payload',
    metadata: { heterogeneousToolStateOperationId: operationId },
  });
  const intervention = {
    operationId,
    batchId: `batch-${suffix}`,
    itemIndex: 0,
    stepIndex: 1,
    status: 'pending' as const,
  };
  const state = {
    heterogeneousIntervention: {
      operationId,
      provider: 'pi',
      interactionKind: 'question',
      transition: 'pending',
      deadline: now + 60_000,
    },
  };
  await db.insert(messagePlugins).values({
    id: messageId,
    toolCallId: `call-${suffix}`,
    intervention,
    state,
    userId,
    workspaceId,
    arguments: 'Private tool arguments',
  });
  return { agentId, task, taskModel, topicId, operationId, messageId, intervention, state };
};

describe('TaskAttentionModel original pending interaction references', () => {
  it('survives a fresh reader without exporting question bodies or tool arguments', async () => {
    const fixture = await seed();
    const result = await new TaskAttentionModel(db, owner).listPendingInteractions(now);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      agentId: fixture.agentId,
      deadline: now + 60_000,
      kind: 'question',
      operationId: fixture.operationId,
      taskId: fixture.task.id,
      taskIdentifier: fixture.task.identifier,
      taskTitle: 'Scoped task',
      toolCallId: expect.any(String),
      toolMessageId: fixture.messageId,
      topicId: fixture.topicId,
    });
    expect(JSON.stringify(result)).not.toMatch(/Private|arguments|batch-/);
    expect(result.truncated).toBe(false);
    expect(await new TaskAttentionModel(db, other).listPendingInteractions(now)).toMatchObject({
      items: [],
    });
  });

  it.each(['resolved', 'cancelled', 'timed_out', 'session_ended'])(
    'drops %s producer records, without answering anything',
    async (transition) => {
      const fixture = await seed();
      await db
        .update(messagePlugins)
        .set({
          state: {
            heterogeneousIntervention: { ...fixture.state.heterogeneousIntervention, transition },
          },
        })
        .where(eq(messagePlugins.id, fixture.messageId));
      expect((await new TaskAttentionModel(db, owner).listPendingInteractions(now)).items).toEqual(
        [],
      );
    },
  );

  it('drops expired, malformed and resolving requests and never treats waiting_for_human alone as a question', async () => {
    const fixture = await seed();
    const model = new TaskAttentionModel(db, owner);
    await db
      .update(agentOperations)
      .set({ status: 'waiting_for_human' })
      .where(eq(agentOperations.id, fixture.operationId));
    for (const deadline of [now, now - 1, 'future', null]) {
      await db
        .update(messagePlugins)
        .set({
          state: {
            heterogeneousIntervention: { ...fixture.state.heterogeneousIntervention, deadline },
          },
        })
        .where(eq(messagePlugins.id, fixture.messageId));
      expect((await model.listPendingInteractions(now)).items).toEqual([]);
    }
    await db
      .update(messagePlugins)
      .set({ state: fixture.state, intervention: { ...fixture.intervention, resolving: true } })
      .where(eq(messagePlugins.id, fixture.messageId));
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
    await db.delete(messagePlugins);
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
  });

  it('requires exact current task/topic/operation/tool association and an unended run', async () => {
    const fixture = await seed();
    const model = new TaskAttentionModel(db, owner);
    await db
      .update(messagePlugins)
      .set({ intervention: { ...fixture.intervention, operationId: 'different-operation' } })
      .where(eq(messagePlugins.id, fixture.messageId));
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
    await db
      .update(messagePlugins)
      .set({ intervention: fixture.intervention })
      .where(eq(messagePlugins.id, fixture.messageId));
    await fixture.taskModel.updateStatus(fixture.task.id, 'running', {
      startedAt: new Date(Date.now() + 10_000),
    });
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
    await fixture.taskModel.updateStatus(fixture.task.id, 'running', { startedAt: new Date(0) });
    await new AgentOperationModel(db, owner).recordCompletion(fixture.operationId, {
      status: 'done',
    });
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
  });

  it('does not revive a prior topic or a trashed task', async () => {
    const fixture = await seed();
    await db.update(tasks).set({ currentTopicId: null }).where(eq(tasks.id, fixture.task.id));
    expect((await new TaskAttentionModel(db, owner).listPendingInteractions(now)).items).toEqual(
      [],
    );
    await fixture.taskModel.updateCurrentTopic(fixture.task.id, fixture.topicId);
    await db.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, fixture.task.id));
    expect((await new TaskAttentionModel(db, owner).listPendingInteractions(now)).items).toEqual(
      [],
    );
  });

  it('accepts an absent deadline, but never invents a Pi question from another provider or mismatched message', async () => {
    const fixture = await seed();
    const { deadline: _deadline, ...pending } = fixture.state.heterogeneousIntervention;
    const model = new TaskAttentionModel(db, owner);
    await db
      .update(messagePlugins)
      .set({ state: { heterogeneousIntervention: pending } })
      .where(eq(messagePlugins.id, fixture.messageId));
    expect((await model.listPendingInteractions(now)).items[0]).not.toHaveProperty('deadline');
    await db
      .update(messagePlugins)
      .set({ state: { heterogeneousIntervention: { ...pending, provider: 'another-runtime' } } })
      .where(eq(messagePlugins.id, fixture.messageId));
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
    await db
      .update(messagePlugins)
      .set({ state: fixture.state })
      .where(eq(messagePlugins.id, fixture.messageId));
    await db
      .update(messages)
      .set({ metadata: { heterogeneousToolStateOperationId: 'prior-operation' } })
      .where(eq(messages.id, fixture.messageId));
    expect((await model.listPendingInteractions(now)).items).toEqual([]);
  });

  it('reports its bounded current-run window rather than claiming a complete history inbox', async () => {
    const fixture = await seed();
    const entries = Array.from({ length: 100 }, (_, index) => ({
      id: `bounded-task-${index}`,
      topicId: `bounded-topic-${index}`,
      opId: `bounded-op-${index}`,
      seq: index + 2,
    }));
    await db
      .insert(topics)
      .values(
        entries.map((entry) => ({ id: entry.topicId, userId: owner, agentId: fixture.agentId })),
      );
    await db.insert(tasks).values(
      entries.map((entry) => ({
        id: entry.id,
        instruction: 'Bounded status fixture',
        identifier: `T-${entry.seq}`,
        seq: entry.seq,
        createdByUserId: owner,
        status: 'running',
        currentTopicId: entry.topicId,
      })),
    );
    await db.insert(agentOperations).values(
      entries.map((entry) => ({
        id: entry.opId,
        taskId: entry.id,
        topicId: entry.topicId,
        agentId: fixture.agentId,
        userId: owner,
        status: 'running' as const,
      })),
    );
    await db.insert(taskTopics).values(
      entries.map((entry) => ({
        taskId: entry.id,
        topicId: entry.topicId,
        operationId: entry.opId,
        userId: owner,
        seq: 1,
      })),
    );
    const result = await new TaskAttentionModel(db, owner).listPendingInteractions(now);
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('keeps workspace, personal and other members’ original interaction ownership separate', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Attention', slug: randomUUID(), primaryOwnerId: owner })
      .returning();
    await seed({ workspaceId: workspace.id });
    expect(
      (await new TaskAttentionModel(db, owner, workspace.id).listPendingInteractions(now)).items,
    ).toHaveLength(1);
    expect((await new TaskAttentionModel(db, owner).listPendingInteractions(now)).items).toEqual(
      [],
    );
    expect(
      (await new TaskAttentionModel(db, other, workspace.id).listPendingInteractions(now)).items,
    ).toEqual([]);
  });
});
