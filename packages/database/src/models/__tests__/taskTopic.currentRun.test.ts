// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { topics, users, workspaceMembers, workspaces } from '../../schemas';
import { TaskModel } from '../task';
import { TaskTopicModel } from '../taskTopic';

const db = await getTestDB();
const owner = 'task-current-run-owner';
const other = 'task-current-run-other';

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
});
afterEach(async () => {
  await db.delete(users);
});

describe('TaskTopicModel current run metadata', () => {
  it('returns only the topic the task currently names, even when an older topic looks running', async () => {
    const model = new TaskModel(db, owner);
    const runs = new TaskTopicModel(db, owner);
    const task = await model.create({ instruction: 'Own the result, not a topic title' });
    await db.insert(topics).values([
      { id: 'old-current-run', userId: owner },
      { id: 'new-current-run', userId: owner },
    ]);
    await runs.add(task.id, 'old-current-run', { operationId: 'op-old', seq: 1 });
    await runs.add(task.id, 'new-current-run', { operationId: 'op-new', seq: 2 });
    await runs.updateStatus(task.id, 'new-current-run', 'completed');
    await model.updateCurrentTopic(task.id, 'new-current-run');
    const rows = await runs.findCurrentByTaskIds([task.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: task.id,
      topicId: 'new-current-run',
      operationId: 'op-new',
      status: 'completed',
    });
    expect(rows[0]).not.toHaveProperty('handoff');
    const facts = await model.findExecutionFactsByIds([task.id]);
    expect(Object.keys(facts[0]).sort()).toEqual(['currentTopicId', 'id', 'startedAt', 'status']);
    expect(facts[0].currentTopicId).toBe('new-current-run');
    expect(await runs.findCurrentByTaskIds([])).toEqual([]);
  });

  it('does not infer a current run, or read another user’s topic from an id', async () => {
    const task = await new TaskModel(db, owner).create({ instruction: 'Private current run' });
    await db.insert(topics).values({ id: 'owned-current-run', userId: owner });
    const runs = new TaskTopicModel(db, owner);
    await runs.add(task.id, 'owned-current-run', { operationId: 'op-owned', seq: 1 });
    expect(await runs.findCurrentByTaskIds([task.id])).toEqual([]);
    await new TaskModel(db, owner).updateCurrentTopic(task.id, 'owned-current-run');
    expect(await new TaskTopicModel(db, other).findCurrentByTaskIds([task.id])).toEqual([]);
  });

  it('keeps personal and workspace scopes separate for the same user', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Fixture', slug: randomUUID(), primaryOwnerId: owner })
      .returning();
    await db
      .insert(workspaceMembers)
      .values({ role: 'owner', userId: owner, workspaceId: workspace.id });
    const model = new TaskModel(db, owner, workspace.id);
    const task = await model.create({ instruction: 'Workspace current run' });
    await db
      .insert(topics)
      .values({ id: 'workspace-current-run', userId: owner, workspaceId: workspace.id });
    const runs = new TaskTopicModel(db, owner, workspace.id);
    await runs.add(task.id, 'workspace-current-run', { operationId: 'op-workspace', seq: 1 });
    await model.updateCurrentTopic(task.id, 'workspace-current-run');
    expect(await runs.findCurrentByTaskIds([task.id])).toHaveLength(1);
    expect(await new TaskTopicModel(db, owner).findCurrentByTaskIds([task.id])).toEqual([]);
  });
});
