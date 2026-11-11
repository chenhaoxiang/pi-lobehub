// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, scmChangeRequests, tasks, users, workspaces } from '../../schemas';
import { ScmChangeRequestModel } from '../scm';
import { TaskModel } from '../task';
import { TaskEngineeringModel } from '../taskEngineering';

const db = await getTestDB();
const owner = 'engineering-owner';
const other = 'engineering-other';
const head = 'a'.repeat(40);
const laterHead = 'b'.repeat(40);
const check = {
  externalId: 'check_run:1',
  name: 'source-check',
  appId: '15368',
  status: 'completed',
  conclusion: 'success',
  reportedAt: '2026-11-11T00:00:00Z',
};

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
});
afterEach(async () => {
  await db.delete(users);
});

const task = (workspaceId?: string, userId = owner) =>
  new TaskModel(db, userId, workspaceId).create({
    name: 'Explicit engineering scope',
    instruction: 'No model or mutation',
  });
const pr = async (
  taskId: string | null,
  number: number,
  options: {
    userId?: string;
    workspaceId?: string;
    acceptanceId?: string;
    repoPrivate?: boolean;
  } = {},
) => {
  const row = await ScmChangeRequestModel.upsert(db, {
    userId: options.userId ?? owner,
    workspaceId: options.workspaceId,
    provider: 'github',
    repoFullName: `fixture-${randomUUID().slice(0, 8)}/repo`,
    number,
    url: 'https://github.com/unused/unused/pull/1',
    state: 'open',
    headSha: head,
    links: { taskId, acceptanceId: options.acceptanceId },
    metadata: options.repoPrivate === undefined ? {} : { repoPrivate: options.repoPrivate },
    eventAt: new Date('2026-11-11T00:00:00Z'),
  });
  await ScmChangeRequestModel.applyChecks(db, row.id, { headSha: head, checks: [check] });
  return row;
};

// A real original Acceptance link is enough to name a PR, never enough to vouch for CI/Gate.
const acceptance = async (taskId: string, links: unknown[] = [], workspaceId?: string) => {
  const [row] = await db
    .insert(acceptances)
    .values({
      userId: owner,
      workspaceId,
      subjectType: 'task',
      subjectId: taskId,
      metadata: { pullRequests: links as any },
    })
    .returning();
  return row;
};

describe('Task explicit engineering original projection', () => {
  it('reads the original SCM record bound to the exact Task, without creating an acceptance verdict', async () => {
    const a = await task();
    const b = await task();
    const mine = await pr(a.id, 1, { repoPrivate: false });
    await pr(b.id, 2, { repoPrivate: false });
    const read = await new TaskEngineeringModel(db, owner).read(a.id);
    expect(read?.pullRequests).toHaveLength(1);
    expect(read?.pullRequests[0]).toMatchObject({
      source: 'scm-provider-record',
      binding: 'task',
      number: 1,
      repository: mine.repoFullName,
      headSha: head,
      ciHeadSha: head,
      ciStatus: 'success',
      state: 'open',
      checks: [{ name: 'source-check', appId: '15368', conclusion: 'success' }],
    });
    expect(read?.gate).toBe('not-observed');
    expect(await db.select().from(acceptances)).toEqual([]);
    expect((await new TaskModel(db, owner).findById(a.id))?.status).toBe('backlog');
  });

  it('keeps hand links unverified and prefers a matching original provider row exactly once', async () => {
    const a = await task();
    const row = await pr(a.id, 4, { repoPrivate: false });
    await acceptance(a.id, [
      {
        provider: 'github',
        repoFullName: row.repoFullName.toUpperCase(),
        number: 4,
        url: 'https://example.invalid/not-authority',
      },
      {
        provider: 'github',
        repoFullName: 'fixture/manual',
        number: 9,
        url: 'https://example.invalid/not-authority',
      },
    ]);
    const read = await new TaskEngineeringModel(db, owner).read(a.id);
    expect(read?.pullRequests).toHaveLength(2);
    expect(read?.pullRequests.find((p) => p.number === 4)?.source).toBe('scm-provider-record');
    expect(read?.pullRequests.find((p) => p.number === 9)).toMatchObject({
      source: 'manual-link',
      binding: 'acceptance',
      headSha: null,
      ciStatus: 'unknown',
      state: null,
      checks: [],
      url: 'https://github.com/fixture/manual/pull/9',
    });
  });

  it('uses the Task Acceptance binding but never steals a PR already bound to another Task', async () => {
    const a = await task();
    const b = await task();
    const acc = await acceptance(a.id);
    await pr(null, 1, { acceptanceId: acc.id, repoPrivate: false });
    await pr(b.id, 2, { acceptanceId: acc.id, repoPrivate: false });
    const read = await new TaskEngineeringModel(db, owner).read(a.id);
    expect(read?.pullRequests.map((p) => [p.number, p.binding])).toEqual([[1, 'acceptance']]);
  });

  it('does not expose private, visibility-unknown or another personal scope original', async () => {
    const a = await task();
    await pr(a.id, 1, { repoPrivate: true });
    await pr(a.id, 2);
    await pr(a.id, 3, { repoPrivate: false, userId: other });
    expect((await new TaskEngineeringModel(db, owner).read(a.id))?.pullRequests).toEqual([]);
    expect(await new TaskEngineeringModel(db, other).read(a.id)).toBeUndefined();
  });

  it('enforces workspace, private Task and private Acceptance visibility', async () => {
    const ws = `engineering-ws-${randomUUID()}`;
    await db
      .insert(workspaces)
      .values({ id: ws, slug: ws, name: 'Synthetic workspace', primaryOwnerId: owner });
    const a = await task(ws);
    await pr(a.id, 1, { workspaceId: ws, userId: other, repoPrivate: false });
    expect((await new TaskEngineeringModel(db, owner, ws).read(a.id))?.pullRequests).toHaveLength(
      1,
    );
    const acc = await acceptance(
      a.id,
      [{ provider: 'github', repoFullName: 'fixture/private-link', number: 7 }],
      ws,
    );
    await db
      .update(acceptances)
      .set({ userId: other, visibility: 'private' })
      .where(eq(acceptances.id, acc.id));
    expect((await new TaskEngineeringModel(db, owner, ws).read(a.id))?.pullRequests).toHaveLength(
      1,
    );
    expect(await new TaskEngineeringModel(db, owner).read(a.id)).toBeUndefined();
    await db.update(tasks).set({ visibility: 'private' }).where(eq(tasks.id, a.id));
    expect(await new TaskEngineeringModel(db, other, ws).read(a.id)).toBeUndefined();
    await db.delete(workspaces).where(eq(workspaces.id, ws));
  });

  it('never attaches old-head checks or infers all required checks from an observed green record', async () => {
    const a = await task();
    const row = await pr(a.id, 1, { repoPrivate: false });
    await db
      .update(scmChangeRequests)
      .set({ headSha: laterHead })
      .where(eq(scmChangeRequests.id, row.id));
    const read = (await new TaskEngineeringModel(db, owner).read(a.id))!;
    expect(read.pullRequests[0]).toMatchObject({
      headSha: laterHead,
      ciHeadSha: head,
      ciStatus: 'unknown',
      checks: [],
      recordedCheckCount: 0,
    });
    expect(read.gate).toBe('not-observed');
    expect(JSON.stringify(read)).not.toMatch(/accepted|permission|deploy|installed/);
  });

  it('bounds PR and check windows and excludes arbitrary private metadata and check URLs', async () => {
    const a = await task();
    const first = await pr(a.id, 1, { repoPrivate: false });
    await db
      .update(scmChangeRequests)
      .set({
        checks: Array.from({ length: 25 }, (_, i) => ({
          ...check,
          externalId: `check_run:${i}`,
          name: `check-${i}`,
          url: 'https://private.invalid/secret',
          privateBody: 'never-hydrate',
        })),
        metadata: { repoPrivate: false, privateBody: 'never-hydrate' },
      })
      .where(eq(scmChangeRequests.id, first.id));
    const one = (await new TaskEngineeringModel(db, owner).read(a.id))!.pullRequests[0];
    expect(one.checks).toHaveLength(20);
    expect(one.checksTruncated).toBe(true);
    expect(one.recordedCheckCount).toBe(25);
    for (let i = 2; i <= 10; i++) await pr(a.id, i, { repoPrivate: false });
    const read = (await new TaskEngineeringModel(db, owner).read(a.id))!;
    expect(read.pullRequests).toHaveLength(8);
    expect(read.truncated).toBe(true);
    expect(JSON.stringify(read)).not.toContain('never-hydrate');
    expect(JSON.stringify(read)).not.toContain('private.invalid');
  });

  it('keeps an empty/missing source distinct and rejects invalid manual identities', async () => {
    const a = await task();
    await acceptance(a.id, [
      { provider: 'github', repoFullName: 'bad/../repo', number: 2 },
      { provider: 'github', repoFullName: 'fixture/manual', number: -1 },
    ]);
    expect(await new TaskEngineeringModel(db, owner).read(a.id)).toMatchObject({
      taskId: a.id,
      pullRequests: [],
      gate: 'not-observed',
      truncated: false,
    });
    expect(await new TaskEngineeringModel(db, owner).read('missing-task')).toBeUndefined();
    await db.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, a.id));
    expect(await new TaskEngineeringModel(db, owner).read(a.id)).toBeUndefined();
  });
});
