// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, messages, topics, users, workspaces } from '../../schemas';
import { AgentOperationModel } from '../agentOperation';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';
import { TaskUsageModel } from '../taskUsage';

const db = await getTestDB();
const owner = 'current-usage-owner';
const other = 'current-usage-other';
const usage = {
  inputCacheMissTokens: 10,
  inputCachedTokens: 4,
  inputWriteCacheTokens: 2,
  totalInputTokens: 16,
  totalOutputTokens: 3,
  totalTokens: 19,
};

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
});
afterEach(async () => {
  await db.delete(users);
});

const seed = async (workspaceId?: string) => {
  const suffix = randomUUID();
  const topicId = `usage-topic-${suffix}`;
  const operationId = `usage-op-${suffix}`;
  const taskModel = new TaskModel(db, owner, workspaceId);
  const task = await taskModel.create({
    instruction: 'Only explicit current usage',
    name: 'Usage fixture',
  });
  await db.insert(topics).values({ id: topicId, userId: owner, workspaceId });
  await new AgentOperationModel(db, owner, workspaceId).recordStart({
    operationId,
    taskId: task.id,
    topicId,
    provider: 'pi',
  });
  await new TaskTopicModel(db, owner, workspaceId).add(task.id, topicId, { operationId, seq: 1 });
  await taskModel.updateCurrentTopic(task.id, topicId);
  await taskModel.updateStatus(task.id, 'running');
  return { topicId, operationId, task, taskModel, workspaceId };
};
const addMessage = async (
  fixture: Awaited<ReturnType<typeof seed>>,
  id: string,
  value: unknown = usage,
  extra = {},
) => {
  await db.insert(messages).values({
    id,
    role: 'assistant',
    topicId: fixture.topicId,
    userId: owner,
    workspaceId: fixture.workspaceId,
    content: 'Private message text must not enter the projection',
    metadata: { operationId: fixture.operationId, privatePrompt: 'Do not project this' },
    usage: value as typeof usage,
    ...extra,
  });
};

describe('TaskUsageModel explicit current-operation projection', () => {
  it('reads four disjoint buckets once, without adding inclusive totals or legacy copies', async () => {
    const fixture = await seed();
    await addMessage(fixture, 'usage-one', usage, {
      metadata: { operationId: fixture.operationId, usage },
    });
    const model = new TaskUsageModel(db, owner);
    const result = await model.readCurrent(fixture.task.id);
    expect(result).toMatchObject({
      taskId: fixture.task.id,
      operationId: fixture.operationId,
      topicId: fixture.topicId,
      coverage: 'partial',
      observedMessages: 1,
      measuredMessages: 1,
      totalTokens: 19,
      tokens: { input: 10, output: 3, cacheRead: 4, cacheWrite: 2 },
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/Private|privatePrompt|content|arguments/);
    expect(result?.reasons).toContain('not-a-bill');
    // An update or cold re-read sees the current row, not an additional settlement.
    await db
      .update(messages)
      .set({ usage: { ...usage, totalOutputTokens: 5, totalTokens: 21 } })
      .where(eq(messages.id, 'usage-one'));
    expect(await model.readCurrent(fixture.task.id)).toMatchObject({
      observedMessages: 1,
      measuredMessages: 1,
      totalTokens: 21,
      tokens: { output: 5 },
    });
  });

  it('does not attribute another operation, user, role or prior topic to the current run', async () => {
    const fixture = await seed();
    await addMessage(fixture, 'usage-current');
    await addMessage(fixture, 'usage-prior-op', usage, {
      metadata: { operationId: 'previous-operation' },
    });
    await addMessage(fixture, 'usage-wrong-user', usage, { userId: other });
    await addMessage(fixture, 'usage-tool', usage, { role: 'tool' });
    await db.insert(topics).values({ id: 'usage-older-topic', userId: owner });
    await addMessage(fixture, 'usage-prior-topic', usage, { topicId: 'usage-older-topic' });
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      observedMessages: 1,
      totalTokens: 19,
    });
    expect(await new TaskUsageModel(db, other).readCurrent(fixture.task.id)).toBeUndefined();
  });

  it('keeps absent usage unknown even when denormalized operation totals have defaulted to zero', async () => {
    const fixture = await seed();
    await db
      .update(agentOperations)
      .set({ totalTokens: 0, totalCost: 0 })
      .where(eq(agentOperations.id, fixture.operationId));
    await addMessage(fixture, 'usage-absent', null);
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      coverage: 'unavailable',
      measuredMessages: 0,
      tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
      totalTokens: null,
    });
  });

  it('preserves measured zeros and explicitly marks incomplete message coverage as a lower bound', async () => {
    const fixture = await seed();
    const zero = {
      inputCacheMissTokens: 0,
      inputCachedTokens: 0,
      inputWriteCacheTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    };
    await addMessage(fixture, 'usage-zero', zero);
    await addMessage(fixture, 'usage-incomplete', { totalInputTokens: 123, totalOutputTokens: 5 });
    const result = await new TaskUsageModel(db, owner).readCurrent(fixture.task.id);
    expect(result).toMatchObject({
      coverage: 'partial',
      observedMessages: 2,
      measuredMessages: 1,
      totalTokens: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(result?.reasons).toContain('incomplete-turn-usage');
  });

  it('uses the promoted usage object or legacy fallback, never a per-field mixture', async () => {
    const fixture = await seed();
    await addMessage(fixture, 'usage-legacy', null, {
      metadata: { operationId: fixture.operationId, usage },
    });
    await addMessage(
      fixture,
      'usage-bad-promoted',
      { totalTokens: 19 },
      { metadata: { operationId: fixture.operationId, usage } },
    );
    const result = await new TaskUsageModel(db, owner).readCurrent(fixture.task.id);
    expect(result).toMatchObject({ measuredMessages: 1, observedMessages: 2, totalTokens: 19 });
    expect(result?.reasons).toContain('incomplete-turn-usage');
  });

  it('rejects invalid, contradictory and overflowed counts instead of fabricating zeros', async () => {
    const fixture = await seed();
    for (const [index, invalid] of [
      { ...usage, inputCacheMissTokens: -1 },
      { ...usage, inputCachedTokens: 0.5 },
      { ...usage, totalTokens: 999 },
      { ...usage, inputWriteCacheTokens: '2' },
      { ...usage, inputCacheMissTokens: Number.MAX_SAFE_INTEGER },
    ].entries())
      await addMessage(fixture, `invalid-usage-${index}`, invalid);
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      measuredMessages: 0,
      totalTokens: null,
      tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
    });
  });

  it('requires a matching current operation and start generation, not a task status label', async () => {
    const fixture = await seed();
    await addMessage(fixture, 'usage-generation');
    await fixture.taskModel.updateStatus(fixture.task.id, 'running', {
      startedAt: new Date(Date.now() + 10_000),
    });
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      coverage: 'unavailable',
      reasons: ['current-run-unavailable'],
    });
    await fixture.taskModel.updateStatus(fixture.task.id, 'running', { startedAt: new Date(0) });
    await db
      .update(agentOperations)
      .set({ taskId: null })
      .where(eq(agentOperations.id, fixture.operationId));
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      coverage: 'unavailable',
      reasons: ['current-run-unavailable'],
    });
  });

  it('leaves an unconfirmed Pi provider and another owner’s operation unavailable', async () => {
    const fixture = await seed();
    await addMessage(fixture, 'usage-unconfirmed');
    await db
      .update(agentOperations)
      .set({ provider: 'other-runtime' })
      .where(eq(agentOperations.id, fixture.operationId));
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      coverage: 'unavailable',
      reasons: ['pi-source-unconfirmed'],
    });
    await db
      .update(agentOperations)
      .set({ provider: 'pi', userId: other })
      .where(eq(agentOperations.id, fixture.operationId));
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toMatchObject({
      coverage: 'unavailable',
      reasons: ['current-run-unavailable'],
    });
  });

  it('invalidates a sampled old generation when a new start claim lands before the readback', async () => {
    const fixture = await seed();
    await addMessage(fixture, 'usage-during-replacement');
    const model = new TaskUsageModel(db, owner);
    // This schedules an actual DB write before the second actual DB read, not a DAL mock.
    const current = Reflect.get(model, 'current');
    let reads = 0;
    Reflect.set(model, 'current', async (id: string) => {
      if (++reads === 2)
        await fixture.taskModel.updateStatus(fixture.task.id, 'running', {
          startedAt: new Date(Date.now() + 10_000),
        });
      return Reflect.apply(current, model, [id]);
    });
    expect(await model.readCurrent(fixture.task.id)).toMatchObject({
      coverage: 'unavailable',
      observedMessages: 0,
      totalTokens: null,
      reasons: ['current-run-unavailable'],
    });
  });

  it('keeps workspace and personal usage separate and hides a visitor topic', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Usage', slug: randomUUID(), primaryOwnerId: owner })
      .returning();
    const fixture = await seed(workspace.id);
    await addMessage(fixture, 'usage-workspace');
    expect(
      await new TaskUsageModel(db, owner, workspace.id).readCurrent(fixture.task.id),
    ).toMatchObject({ measuredMessages: 1 });
    expect(await new TaskUsageModel(db, owner).readCurrent(fixture.task.id)).toBeUndefined();
    await db
      .update(topics)
      .set({ senderId: 'visitor-fixture' })
      .where(eq(topics.id, fixture.topicId));
    expect(
      await new TaskUsageModel(db, owner, workspace.id).readCurrent(fixture.task.id),
    ).toMatchObject({ coverage: 'unavailable', reasons: ['current-run-unavailable'] });
  });

  it('caps reads inside the exact operation and declares the omitted portion', async () => {
    const fixture = await seed();
    await db.insert(messages).values(
      Array.from({ length: 501 }, (_, index) => ({
        id: `usage-window-${index}`,
        role: 'assistant',
        userId: owner,
        topicId: fixture.topicId,
        metadata: { operationId: fixture.operationId },
        usage,
      })),
    );
    const result = await new TaskUsageModel(db, owner).readCurrent(fixture.task.id);
    expect(result).toMatchObject({
      measuredMessages: 500,
      observedMessages: 500,
      messageLimit: 500,
      truncated: true,
      totalTokens: 9500,
    });
    expect(result?.reasons).toContain('message-window-truncated');
  });
});
