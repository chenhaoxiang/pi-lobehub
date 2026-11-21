// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  files,
  tasks,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceReviewModel } from '@/database/models/acceptanceReview';
import { ProjectModel } from '@/database/models/project';
import { ProjectMemberModel } from '@/database/models/projectReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { ProjectReviewService } from '@/server/services/projectReview';

let serverDB: LobeChatDatabase;

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  verifyAcceptanceReviewJWT: async (token: string) => {
    const [userId, kind, id, origin] = token.split('|');
    if (kind === 'site')
      return {
        clientId: 'lobehub-acceptance',
        expiresAt: 2_000_000_000,
        site: { origin, siteId: id },
        userId,
      };
    return { acceptanceId: id, expiresAt: 2_000_000_000, userId };
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (url: string) => `https://cdn.example.com/${url}`;
    removeUnreferencedFile = vi.fn();
    uploadFromBuffer = vi.fn();
  },
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));
vi.mock('@/envs/app', async (importOriginal) => {
  const original = await importOriginal<{ appEnv: Record<string, unknown> }>();
  return { ...original, appEnv: { ...original.appEnv, APP_URL: 'https://app.lobehub.test/' } };
});

const { default: app } = await import('../index');

const BASE = 'http://localhost/api/acceptance-review/v1';
const ORIGIN = 'https://fieldnotes.app';

let ownerId: string;
let memberId: string;
let site: { acceptanceId: string | null; id: string };
let reviewId: string;
let deliveryId: string;
let taskId: string;
let runId: string;
let marks: { id: string }[];

const siteCall = (userId: string, path: string, init: { json?: unknown; method?: string } = {}) =>
  app.request(`${BASE}${path}`, {
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    headers: {
      'authorization': `Bearer ${userId}|site|${site.id}|${ORIGIN}`,
      'content-type': 'application/json',
      'origin': ORIGIN,
    },
    method: init.method ?? 'GET',
  });

const deliveryCall = (
  userId: string,
  path: string,
  init: { json?: unknown; method?: string } = {},
) =>
  app.request(`${BASE}${path}`, {
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    headers: {
      'authorization': `Bearer ${userId}|acceptance|${deliveryId}`,
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const geometry = (clientId: string, content: string) => ({
  clientId,
  content,
  kind: 'region' as const,
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  routeKey: '/notebook',
  scroll: { x: 0, y: 800 },
  url: `${ORIGIN}/notebook`,
  viewport: { dpr: 2, height: 800, width: 1280 },
});

beforeEach(async () => {
  serverDB = await getTestDB();
  ownerId = await createTestUser(serverDB);
  memberId = await createTestUser(serverDB);
  const [workspace] = await serverDB
    .insert(workspaces)
    .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: ownerId })
    .returning();
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId: workspace.id },
    { role: 'member', userId: memberId, workspaceId: workspace.id },
  ]);
  const projectId = (
    await new ProjectModel(serverDB, ownerId, workspace.id).create({
      identifier: 'SITE',
      name: 'Site',
    })
  ).id;
  await new ProjectMemberModel(serverDB).add({ projectId, role: 'member', userId: memberId });
  site = await new ProjectReviewService(serverDB, ownerId).createSite(projectId, {
    name: 'Marketing site',
    origins: [ORIGIN],
  });

  const model = new AcceptanceReviewModel(serverDB);
  const review = await model.createDraft({
    projectId,
    siteId: site.id,
    userId: memberId,
    workspaceId: workspace.id,
  });
  reviewId = review.id;
  marks = [
    (await model.addMark(reviewId, geometry('a', 'Title is too small')))!,
    (await model.addMark(reviewId, geometry('b', 'Button looks disabled')))!,
  ];
  await model.markSubmitted(reviewId);
  taskId = randomUUID();
  await serverDB.insert(tasks).values({
    createdByUserId: memberId,
    id: taskId,
    identifier: 'T-REVIEW',
    instruction: 'review round',
    seq: 1,
    status: 'completed',
    workspaceId: workspace.id,
  });
  await model.linkTask(reviewId, taskId);
  const [delivery] = await serverDB
    .insert(acceptances)
    .values({
      projectId,
      status: 'delivered',
      subjectId: taskId,
      subjectType: 'task',
      userId: memberId,
      visibility: 'private',
      workspaceId: workspace.id,
    })
    .returning();
  deliveryId = delivery.id;

  const plan = marks.map((mark, index) => ({
    description: 'check',
    id: mark.id,
    index,
    onFail: 'manual' as const,
    required: true,
    title: `#${index + 1}`,
    verifierConfig: {},
    verifierType: 'agent' as const,
  }));
  const [run] = await serverDB
    .insert(verifyRuns)
    .values({
      acceptanceId: deliveryId,
      plan,
      planConfirmedAt: new Date(),
      roundIndex: 1,
      userId: memberId,
      workspaceId: workspace.id,
    })
    .returning();
  runId = run.id;
  const [passed] = await serverDB
    .insert(verifyCheckResults)
    .values([
      {
        checkItemId: marks[0].id,
        status: 'passed' as const,
        toulmin: { reasoning: 'Title is 40px now' },
        userId: memberId,
        verdict: 'passed' as const,
        verifierType: 'agent' as const,
        verifyRunId: runId,
        workspaceId: workspace.id,
      },
      {
        checkItemId: marks[1].id,
        status: 'failed' as const,
        userId: memberId,
        verdict: 'failed' as const,
        verifierType: 'agent' as const,
        verifyRunId: runId,
        workspaceId: workspace.id,
      },
    ])
    .returning();
  const [file] = await serverDB
    .insert(files)
    .values({
      fileType: 'image/png',
      name: 'after',
      size: 1,
      url: 'evidence/after.png',
      userId: memberId,
    })
    .returning();
  await serverDB.insert(verifyEvidence).values({
    checkResultId: passed.id,
    fileId: file.id,
    type: 'screenshot',
    userId: memberId,
    workspaceId: workspace.id,
  });
});

afterEach(async () => {
  await cleanupTestUser(serverDB, memberId);
  await cleanupTestUser(serverDB, ownerId);
});

describe('a submitted review with a delivery', () => {
  it('uses the review workspace acceptance when personal and workspace rows coexist', async () => {
    await serverDB.insert(acceptances).values({
      projectId: null,
      status: 'accepted',
      subjectId: taskId,
      subjectType: 'task',
      userId: memberId,
      visibility: 'public',
    });

    const body = await (await siteCall(memberId, `/reviews/${reviewId}`)).json();
    expect(body.phase).toBe('delivered');
    expect(body.reportUrl).toContain(`/acceptance/${deliveryId}`);
  });

  it('shows what the Agent concluded for each mark, with evidence and the report link', async () => {
    const body = await (await siteCall(memberId, `/reviews/${reviewId}`)).json();

    expect(body).toMatchObject({
      counts: { agentPassed: 1, humanPassed: 0, marks: 2 },
      phase: 'delivered',
      reportUrl: `https://app.lobehub.test/acceptance/${deliveryId}`,
    });
    expect(body.marks[0].result).toEqual({
      agent: {
        evidence: [{ url: 'https://cdn.example.com/evidence/after.png' }],
        summary: 'Title is 40px now',
        verdict: 'pass',
      },
      human: null,
      missing: false,
    });
    expect(body.marks[1].result).toMatchObject({ agent: { verdict: 'fail' }, human: null });
  });

  it('rejects a stale verdict after the delivery was accepted without writing a result', async () => {
    await serverDB
      .update(acceptances)
      .set({ status: 'accepted' })
      .where(eq(acceptances.id, deliveryId));

    const response = await siteCall(memberId, `/reviews/${reviewId}/marks/${marks[1].id}/verdict`, {
      json: { reason: 'Late decision', verdict: 'not_fixed' },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
    const [result] = await serverDB
      .select()
      .from(verifyCheckResults)
      .where(eq(verifyCheckResults.checkItemId, marks[1].id));
    expect(result.userDecision).toBeNull();
  });

  it('does not send back after a concurrent aggregate acceptance', async () => {
    await serverDB
      .update(acceptances)
      .set({ status: 'accepted' })
      .where(eq(acceptances.id, deliveryId));

    const response = await siteCall(ownerId, `/reviews/${reviewId}/send-back`, {
      json: { note: 'Late repair request' },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
  });

  it('rejects a final pass after a concurrent aggregate acceptance without writing', async () => {
    await serverDB
      .update(acceptances)
      .set({ status: 'accepted' })
      .where(eq(acceptances.id, deliveryId));

    const response = await siteCall(memberId, `/reviews/${reviewId}/marks/${marks[1].id}/verdict`, {
      json: { verdict: 'pass' },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
    const [result] = await serverDB
      .select()
      .from(verifyCheckResults)
      .where(eq(verifyCheckResults.checkItemId, marks[1].id));
    expect(result.userDecision).toBeNull();
  });

  it('records a not-fixed verdict on the check without closing the delivery', async () => {
    const response = await siteCall(memberId, `/reviews/${reviewId}/marks/${marks[1].id}/verdict`, {
      json: { reason: 'Still grey', verdict: 'not_fixed' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect((await response.json()).marks[1].result.human).toBe('not_fixed');
    const [result] = await serverDB
      .select()
      .from(verifyCheckResults)
      .where(eq(verifyCheckResults.checkItemId, marks[1].id));
    expect(result.userDecision).toBe('rejected');
    const delivery = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, deliveryId),
    });
    expect(delivery?.status).toBe('delivered');
  });

  it('accepts the delivery once the last mark is passed by a person', async () => {
    await siteCall(memberId, `/reviews/${reviewId}/marks/${marks[0].id}/verdict`, {
      json: { verdict: 'pass' },
      method: 'POST',
    });
    let delivery = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, deliveryId),
    });
    expect(delivery?.status).toBe('delivered');

    const response = await siteCall(memberId, `/reviews/${reviewId}/marks/${marks[1].id}/verdict`, {
      json: { verdict: 'pass' },
      method: 'POST',
    });

    expect((await response.json()).phase).toBe('accepted');
    delivery = await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, deliveryId),
    });
    expect(delivery?.status).toBe('accepted');
  });

  it('opens the same review from the delivery acceptance', async () => {
    const session = await (await deliveryCall(memberId, '/session')).json();
    expect(session).toMatchObject({ features: ['review-rounds'], review: { id: reviewId } });

    const body = await (await deliveryCall(memberId, `/reviews/${reviewId}`)).json();
    expect(body.marks.map((mark: { id: string }) => mark.id)).toEqual(marks.map((mark) => mark.id));

    const verdict = await deliveryCall(
      memberId,
      `/reviews/${reviewId}/marks/${marks[0].id}/verdict`,
      {
        json: { verdict: 'pass' },
        method: 'POST',
      },
    );
    expect(verdict.status).toBe(200);
  });

  it('does not open an unrelated review from a delivery acceptance', async () => {
    const other = await new AcceptanceReviewModel(serverDB).createDraft({
      siteId: site.id,
      userId: ownerId,
    });
    expect((await deliveryCall(memberId, `/reviews/${other.id}`)).status).toBe(404);
  });

  it('keeps replies under their mark and out of the page discussion', async () => {
    const created = await siteCall(ownerId, `/reviews/${reviewId}/marks/${marks[1].id}/replies`, {
      json: { clientId: randomUUID(), content: '我这边看还是灰的' },
      method: 'POST',
    });
    expect(created.status).toBe(201);

    const replies = await (
      await siteCall(memberId, `/reviews/${reviewId}/marks/${marks[1].id}/replies`)
    ).json();
    expect(replies.items).toMatchObject([{ content: '我这边看还是灰的', mine: false }]);

    const review = await (await siteCall(memberId, `/reviews/${reviewId}`)).json();
    expect(review.marks[1].replyCount).toBe(1);
    const discussion = await (await siteCall(memberId, '/comments')).json();
    expect(discussion.items).toEqual([]);
  });

  it('forbids a site member from dispatching a send-back', async () => {
    const response = await siteCall(memberId, `/reviews/${reviewId}/send-back`, {
      json: { note: 'Button still grey' },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('refuses an authorized send-back while the Agent is still working on the round', async () => {
    await serverDB.update(tasks).set({ status: 'running' }).where(eq(tasks.id, taskId));
    await serverDB
      .update(acceptances)
      .set({ status: 'verifying' })
      .where(eq(acceptances.id, deliveryId));

    const response = await siteCall(ownerId, `/reviews/${reviewId}/send-back`, {
      json: { note: 'Button still grey' },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_STATE' } });
  });
});
