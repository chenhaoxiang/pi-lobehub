// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmChangeRequestModel } from '@/database/models/scm';
import { TaskModel } from '@/database/models/task';
import { acceptances } from '@/database/schemas';

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

describe('task.engineering read-only original query', () => {
  it('distinguishes a settled unlinked Task from missing or inaccessible Tasks', async () => {
    const task = await new TaskModel(db, userId).create({ instruction: 'Read only' });
    const caller = taskRouter.createCaller(createTestContext(userId));
    expect(await caller.engineering({ taskId: task.id })).toMatchObject({
      taskId: task.id,
      pullRequests: [],
      gate: 'not-observed',
    });
    await expect(
      taskRouter.createCaller(createTestContext(otherId)).engineering({ taskId: task.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.engineering({ taskId: 'missing-task' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns only the exact linked source without auto-accept, wake, comments or importing private metadata', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'No model or owner acceptance' });
    const head = 'a'.repeat(40);
    const row = await ScmChangeRequestModel.upsert(db, {
      userId,
      provider: 'github',
      repoFullName: 'fixture/public',
      number: 1,
      url: 'https://github.com/fixture/public/pull/1',
      headSha: head,
      state: 'merged',
      links: { taskId: task.id },
      metadata: { repoPrivate: false, privateBody: 'not-for-query' },
    });
    await ScmChangeRequestModel.applyChecks(db, row.id, {
      headSha: head,
      checks: [
        {
          externalId: 'check_run:1',
          name: 'source-check',
          appId: '15368',
          status: 'completed',
          conclusion: 'success',
        },
      ],
    });
    const caller = taskRouter.createCaller(createTestContext(userId));
    const first = await caller.engineering({ taskId: task.id });
    const second = await caller.engineering({ taskId: task.id });
    expect(first.pullRequests[0]).toMatchObject({
      repository: 'fixture/public',
      headSha: head,
      state: 'merged',
      ciStatus: 'success',
    });
    expect(second.pullRequests).toEqual(first.pullRequests);
    expect(first.gate).toBe('not-observed');
    expect(JSON.stringify(first)).not.toContain('not-for-query');
    expect(await db.select().from(acceptances)).toEqual([]);
    expect((await model.findById(task.id))?.status).toBe('backlog');
    expect((await ScmChangeRequestModel.findById(db, row.id))?.wakeCount).toBe(0);
  });
});
