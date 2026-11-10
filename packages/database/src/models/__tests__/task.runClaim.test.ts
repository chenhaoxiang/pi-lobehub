// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import { TaskModel } from '../task';

const db = await getTestDB();
const owner = 'task-run-claim-owner';
const outsider = 'task-run-claim-outsider';
const first = new Date('2026-11-11T01:00:00.000Z');
const second = new Date('2026-11-11T01:00:05.000Z');

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: outsider }]);
});
afterEach(async () => {
  await db.delete(users);
});

describe('Task running claim generation', () => {
  it('cannot release an earlier running claim over a later attempt', async () => {
    const model = new TaskModel(db, owner);
    const task = await model.create({ instruction: 'Deliver one result' });
    await model.updateStatusIfCurrent(task.id, 'backlog', 'running', { startedAt: first });
    await model.updateStatus(task.id, 'paused');
    await model.updateStatusIfCurrent(task.id, 'paused', 'running', { startedAt: second });

    expect(await model.updateStatusIfCurrent(task.id, 'running', 'paused', {}, first)).toBeNull();
    expect(await model.findById(task.id)).toMatchObject({ startedAt: second, status: 'running' });
    expect(
      await model.updateStatusIfCurrent(task.id, 'running', 'paused', {}, second),
    ).toMatchObject({ status: 'paused' });
  });

  it('retains owner isolation even with the matching claim timestamp', async () => {
    const model = new TaskModel(db, owner);
    const task = await model.create({ instruction: 'Private result' });
    await model.updateStatusIfCurrent(task.id, 'backlog', 'running', { startedAt: first });
    expect(
      await new TaskModel(db, outsider).updateStatusIfCurrent(
        task.id,
        'running',
        'paused',
        {},
        first,
      ),
    ).toBeNull();
    expect((await model.findById(task.id))?.status).toBe('running');
  });
});
