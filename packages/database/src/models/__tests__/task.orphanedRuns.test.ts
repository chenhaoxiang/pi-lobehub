// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { TaskRunClaimRepo } from '../../repositories/taskRunClaim';
import { agentOperations, tasks, taskTopics, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'orphaned-runs-test-user-id';

/** Every fixture ends before this, so the grace window never hides one. */
const staleBefore = new Date('2026-10-02T15:00:00Z');
const longAgo = new Date('2026-10-02T14:00:00Z');

let seq = 0;

interface SeedOptions {
  /** When the operation ended. Defaults to well before the window. */
  endedAt?: Date;
  operationStatus?:
    'abandoned' | 'done' | 'error' | 'interrupted' | 'running' | 'waiting_for_human';
  /** Set to make the operation a sub-agent child. */
  parentOperationId?: string;
  /** The run row's status; `running` is the one this net looks for. */
  runStatus?: string;
  taskStatus?: string;
  /** Omit to seed a run row with no operation behind it. */
  withOperation?: boolean;
}

/** One Task with one run of it, plus the operation behind that run. */
const seed = async (options: SeedOptions = {}) => {
  seq += 1;
  const taskId = `task-${seq}`;
  const topicId = `tpc-${seq}`;
  const operationId = `op-${seq}`;

  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: taskId,
    identifier: `T-${seq}`,
    currentTopicId: topicId,
    instruction: 'do the thing',
    seq,
    status: options.taskStatus ?? 'running',
  });
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB.insert(taskTopics).values({
    operationId: options.withOperation === false ? undefined : operationId,
    seq: 1,
    status: options.runStatus ?? 'running',
    taskId,
    topicId,
    userId,
  });

  if (options.withOperation !== false) {
    await serverDB.insert(agentOperations).values({
      completedAt: options.endedAt ?? longAgo,
      id: operationId,
      parentOperationId: options.parentOperationId,
      status: options.operationStatus ?? 'error',
      taskId,
      topicId,
      userId,
      updatedAt: options.endedAt ?? longAgo,
    });
  }

  return { operationId, taskId, topicId };
};

const find = () => TaskModel.findOrphanedRunningTopics(serverDB, { staleBefore });

const readRun = async (topicId: string) =>
  (await serverDB.select().from(taskTopics).where(eq(taskTopics.topicId, topicId)).limit(1))[0];

const readTopic = async (topicId: string) =>
  (await serverDB.select().from(topics).where(eq(topics.id, topicId)).limit(1))[0];

beforeEach(async () => {
  // `agent_operations.userId` is deliberately not a foreign key, so deleting the
  // user does not cascade it away.
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskTopics);
  await serverDB.delete(topics);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
  seq = 0;
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('TaskModel.findOrphanedRunningTopics', () => {
  it('returns a running Task run whose operation already ended', async () => {
    const { operationId, taskId, topicId } = await seed({ operationStatus: 'abandoned' });

    const rows = await find();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationId,
      operationStatus: 'abandoned',
      taskId,
      taskIdentifier: 'T-1',
      topicId,
      userId,
    });
  });

  it('ignores an operation that has not settled', async () => {
    await seed({ operationStatus: 'running' });
    await seed({ operationStatus: 'waiting_for_human' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run that succeeded and one the user interrupted', async () => {
    // `done` needs the success path's own inputs to settle and `interrupted`
    // belongs to the interrupt path: settling either from here would mislabel
    // the outcome, so this net must not see them at all.
    await seed({ operationStatus: 'done' });
    await seed({ operationStatus: 'interrupted' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores an operation that ended inside the grace window', async () => {
    await seed({ endedAt: new Date('2026-10-02T16:00:00Z') });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run whose Task already left `running`', async () => {
    await seed({ taskStatus: 'paused' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run row that was already settled', async () => {
    await seed({ runStatus: 'failed' });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a run row with no operation behind it', async () => {
    await seed({ withOperation: false });

    expect(await find()).toHaveLength(0);
  });

  it('ignores a sub-agent child operation', async () => {
    await seed({ parentOperationId: 'op-parent' });

    expect(await find()).toHaveLength(0);
  });

  it('lists every orphaned run, oldest first, capped by the limit', async () => {
    // Seeded out of order so the returned order can only come from the query.
    const newest = await seed({ endedAt: new Date('2026-10-02T14:30:00Z') });
    const oldest = await seed({ endedAt: new Date('2026-10-02T14:00:00Z') });
    const middle = await seed({ endedAt: new Date('2026-10-02T14:15:00Z') });

    const all = await TaskModel.findOrphanedRunningTopics(serverDB, { staleBefore });
    expect(all.map((row) => row.operationId)).toEqual([
      oldest.operationId,
      middle.operationId,
      newest.operationId,
    ]);

    const capped = await TaskModel.findOrphanedRunningTopics(serverDB, { limit: 2, staleBefore });
    expect(capped).toHaveLength(2);
  });
});

describe('TaskModel.findInterruptedRunningTopics', () => {
  const findInterrupted = () => TaskModel.findInterruptedRunningTopics(serverDB, { staleBefore });

  /** Another operation on the same topic, e.g. the follow-up that is still going. */
  const seedTopicOperation = (topicId: string, status: 'done' | 'running' | 'waiting_for_human') =>
    serverDB.insert(agentOperations).values({
      completedAt: longAgo,
      id: `op-follow-up-${topicId}-${status}`,
      status,
      topicId,
      userId,
      updatedAt: longAgo,
    });

  it('returns a running run whose interrupted operation nothing took over', async () => {
    const { operationId, taskId, topicId } = await seed({ operationStatus: 'interrupted' });

    const rows = await findInterrupted();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operationId, taskId, taskIdentifier: 'T-1', topicId, userId });
  });

  it('ignores a run whose topic still has an operation in flight', async () => {
    // The conversation is still going: the Task is continuing, not stuck.
    const running = await seed({ operationStatus: 'interrupted' });
    await seedTopicOperation(running.topicId, 'running');
    const parked = await seed({ operationStatus: 'interrupted' });
    await seedTopicOperation(parked.topicId, 'waiting_for_human');

    expect(await findInterrupted()).toHaveLength(0);
  });

  it('still returns it once the other operations on the topic have ended', async () => {
    const { topicId } = await seed({ operationStatus: 'interrupted' });
    await seedTopicOperation(topicId, 'done');

    expect(await findInterrupted()).toHaveLength(1);
  });

  it('ignores runs ended any other way, inside the grace window, or already settled', async () => {
    await seed({ operationStatus: 'error' });
    await seed({ operationStatus: 'done' });
    await seed({ operationStatus: 'running' });
    await seed({ endedAt: new Date('2026-10-02T16:00:00Z'), operationStatus: 'interrupted' });
    await seed({ operationStatus: 'interrupted', taskStatus: 'paused' });
    await seed({ operationStatus: 'interrupted', runStatus: 'canceled' });
    await seed({ operationStatus: 'interrupted', parentOperationId: 'op-parent' });

    expect(await findInterrupted()).toHaveLength(0);
  });
});

describe('TaskTopicModel.settleRunIfCurrent', () => {
  it('rolls back the run status when stamping the topic fails, then allows a retry', async () => {
    const { operationId, taskId, topicId } = await seed();
    const model = new TaskTopicModel(serverDB, userId);
    await serverDB.execute(sql`
      CREATE OR REPLACE FUNCTION settle_run_test_fail_topic_stamp() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'topic stamp failed'; END;
      $$ LANGUAGE plpgsql
    `);
    await serverDB.execute(sql`
      CREATE TRIGGER settle_run_test_fail_topic_stamp BEFORE UPDATE ON topics
      FOR EACH ROW EXECUTE FUNCTION settle_run_test_fail_topic_stamp()
    `);

    try {
      await expect(
        model.settleRunIfCurrent(taskId, topicId, operationId, 'failed'),
      ).rejects.toThrow();
    } finally {
      await serverDB.execute(
        sql`DROP TRIGGER IF EXISTS settle_run_test_fail_topic_stamp ON topics`,
      );
      await serverDB.execute(sql`DROP FUNCTION IF EXISTS settle_run_test_fail_topic_stamp()`);
    }

    expect((await readRun(topicId)).status).toBe('running');
    expect((await readTopic(topicId)).completedAt).toBeNull();

    expect(await model.settleRunIfCurrent(taskId, topicId, operationId, 'failed')).toBe(true);
    expect((await readRun(topicId)).status).toBe('failed');
    expect((await readTopic(topicId)).completedAt).toBeInstanceOf(Date);
  });

  it('keeps the operation CAS fence when a continuation takes over after recovery', async () => {
    const { operationId, taskId, topicId } = await seed();
    const model = new TaskTopicModel(serverDB, userId);

    await model.updateOperationId(taskId, topicId, 'op-continuation');

    expect(await model.settleRunIfCurrent(taskId, topicId, operationId, 'failed')).toBe(false);
    expect(await readRun(topicId)).toMatchObject({
      operationId: 'op-continuation',
      status: 'running',
    });

    expect(await model.settleRunIfCurrent(taskId, topicId, 'op-continuation', 'completed')).toBe(
      true,
    );
    expect(await readRun(topicId)).toMatchObject({
      operationId: 'op-continuation',
      status: 'completed',
    });
    expect((await readTopic(topicId)).completedAt).toBeInstanceOf(Date);
  });
});

describe('TaskRunClaimRepo', () => {
  it('claims only the current generation and transfers to its continuation', async () => {
    const { operationId, taskId, topicId } = await seed();
    const topicModel = new TaskTopicModel(serverDB, userId);

    expect(await topicModel.claimVerifyFinalizer(taskId, topicId, operationId, operationId)).toBe(
      true,
    );
    expect(await topicModel.claimVerifyFinalizer(taskId, topicId, 'op-new', 'op-new')).toBe(false);
    // A repair child can keep the root operation on TaskTopic while claiming
    // the same attempt; a continuation transfers the row to its new generation.
    expect(await topicModel.claimVerifyFinalizer(taskId, topicId, 'op-repair', operationId)).toBe(
      true,
    );

    await topicModel.updateOperationId(taskId, topicId, 'op-new');

    expect(await topicModel.claimVerifyFinalizer(taskId, topicId, 'op-new', 'op-new')).toBe(true);
  });

  it('rejects a repair child when either the root or child attempt is stale-fenced', async () => {
    const { operationId, taskId, topicId } = await seed();
    const topicModel = new TaskTopicModel(serverDB, userId);
    await serverDB
      .update(taskTopics)
      .set({
        staleSettlementFences: [
          {
            attempt: 1,
            operationId,
            settledAt: new Date().toISOString(),
            taskId,
            topicId,
          },
        ],
      })
      .where(eq(taskTopics.topicId, topicId));

    expect(await topicModel.claimVerifyFinalizer(taskId, topicId, 'op-repair', operationId)).toBe(
      false,
    );
  });

  it('flips a run that still names its own operation out of `running`', async () => {
    const { operationId, topicId } = await seed();
    const model = new TaskRunClaimRepo(serverDB, userId);

    expect(await model.claim(topicId, operationId, 'failed')).toBe(true);

    expect((await readRun(topicId)).status).toBe('failed');
    // The run is over, so the topic gets its end stamp too.
    expect((await readTopic(topicId)).completedAt).toBeInstanceOf(Date);
  });

  it('persists a stale-settlement fence with the exact attempt identity', async () => {
    const { operationId, taskId, topicId } = await seed();
    const model = new TaskRunClaimRepo(serverDB, userId);

    expect(
      await model.claimStale(topicId, operationId, 'completed', {
        attempt: 1,
        operationId,
        taskId,
        topicId,
      }),
    ).toBe(true);

    const run = await readRun(topicId);
    expect(run.staleSettlementFences).toEqual([
      expect.objectContaining({ attempt: 1, operationId, taskId, topicId }),
    ]);
  });

  it('leaves the run `running` when the topic end stamp fails', async () => {
    // Regression: the claim committed before the topic stamp, so a failed stamp
    // threw past the caller's rollback and left the run terminal while its Task
    // stayed `running` — invisible to the next sweep, which only looks at
    // `running` rows.
    const { operationId, topicId } = await seed();
    const model = new TaskRunClaimRepo(serverDB, userId);
    await serverDB.execute(sql`
      CREATE OR REPLACE FUNCTION orphaned_runs_test_fail_topic_stamp() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'topic stamp failed'; END;
      $$ LANGUAGE plpgsql
    `);
    await serverDB.execute(sql`
      CREATE TRIGGER orphaned_runs_test_fail_topic_stamp BEFORE UPDATE ON topics
      FOR EACH ROW EXECUTE FUNCTION orphaned_runs_test_fail_topic_stamp()
    `);

    try {
      await expect(model.claim(topicId, operationId, 'failed')).rejects.toThrow();
    } finally {
      await serverDB.execute(
        sql`DROP TRIGGER IF EXISTS orphaned_runs_test_fail_topic_stamp ON topics`,
      );
      await serverDB.execute(sql`DROP FUNCTION IF EXISTS orphaned_runs_test_fail_topic_stamp()`);
    }

    expect((await readRun(topicId)).status).toBe('running');
    expect((await readTopic(topicId)).completedAt).toBeNull();
  });

  it('refuses a run that has already settled', async () => {
    const { operationId, topicId } = await seed({ runStatus: 'failed' });
    const model = new TaskRunClaimRepo(serverDB, userId);

    expect(await model.claim(topicId, operationId, 'failed')).toBe(false);
  });

  it('refuses a run a newer operation has taken over', async () => {
    const { topicId } = await seed();
    const model = new TaskRunClaimRepo(serverDB, userId);

    expect(await model.claim(topicId, 'op-someone-else', 'failed')).toBe(false);
    expect((await readRun(topicId)).status).toBe('running');
  });

  it('hands its own run back when the settle it was claimed for failed', async () => {
    const { operationId, topicId } = await seed();
    const model = new TaskRunClaimRepo(serverDB, userId);
    await model.claim(topicId, operationId, 'failed');

    expect(await model.release(topicId, operationId, 'failed')).toBe(true);
    expect((await readRun(topicId)).status).toBe('running');
    expect((await readTopic(topicId)).completedAt).toBeNull();
  });

  it('never re-opens a run that is no longer the claimed one', async () => {
    const { operationId, topicId } = await seed();
    const model = new TaskRunClaimRepo(serverDB, userId);
    await model.claim(topicId, operationId, 'failed');

    expect(await model.release(topicId, 'op-someone-else', 'failed')).toBe(false);
    expect((await readRun(topicId)).status).toBe('failed');
  });
});
