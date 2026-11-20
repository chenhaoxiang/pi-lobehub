// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectRepository } from '../../repositories/project';
import { acceptanceReviews, tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceReviewModel } from '../acceptanceReview';
import { ProjectSiteModel } from '../projectReview';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'acceptance-review-owner';
const reviewer = 'acceptance-review-reviewer';
const model = new AcceptanceReviewModel(serverDB);

let siteId: string;
let projectId: string;

const markInput = (
  clientId: string,
  content = 'Cards are too tight',
  page = { routeKey: '/notebook', url: 'https://preview.example.com/notebook?tab=1' },
) => ({
  clientId,
  content,
  kind: 'region' as const,
  pageMeta: { title: 'Fieldnotes' },
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  scroll: { x: 0, y: 800 },
  viewport: { dpr: 2, height: 800, width: 1280 },
  ...page,
});

const settings = { routeKey: '/settings', url: 'https://preview.example.com/settings' };

const draftOf = (userId: string) => model.createDraft({ projectId, siteId, userId });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: reviewer }]);
  const project = await new ProjectRepository(serverDB, owner).create({
    identifier: 'FNT',
    name: 'Fieldnotes',
  });
  projectId = project.id;
  const site = await new ProjectSiteModel(serverDB).create({
    name: 'Preview',
    origins: ['https://preview.example.com'],
    projectId,
  });
  siteId = site.id;
});

describe('AcceptanceReviewModel drafts', () => {
  it('keeps one draft per user per site and preserves ownership fields', async () => {
    const first = await draftOf(reviewer);

    expect(first).toMatchObject({
      projectId,
      siteId,
      status: 'draft',
      userId: reviewer,
      workspaceId: null,
    });
    await expect(draftOf(reviewer)).rejects.toThrow();

    const other = await draftOf(owner);
    expect(other.id).not.toBe(first.id);
    expect((await model.findDraft(siteId, reviewer))?.id).toBe(first.id);
  });

  it('frees the draft slot once the draft is discarded', async () => {
    const first = await draftOf(reviewer);
    await model.discard(first.id);

    expect(await model.findDraft(siteId, reviewer)).toBeUndefined();
    expect((await draftOf(reviewer)).status).toBe('draft');
  });
});

describe('AcceptanceReviewModel marks', () => {
  it('numbers marks in order and never reuses a deleted number', async () => {
    const review = await draftOf(reviewer);
    const one = await model.addMark(review.id, markInput('a'));
    const two = await model.addMark(review.id, markInput('b'));
    await model.deleteMark(review.id, two!.id);
    const three = await model.addMark(review.id, markInput('c'));

    expect([one?.seq, two?.seq, three?.seq]).toEqual([1, 2, 3]);
    expect((await model.listMarks(review.id)).map((mark) => mark.seq)).toEqual([1, 3]);
  });

  it('returns the stored mark when the same clientId is retried, without using a number', async () => {
    const review = await draftOf(reviewer);
    const first = await model.addMark(review.id, markInput('same'));
    const retried = await model.addMark(review.id, markInput('same', 'changed on retry'));
    const next = await model.addMark(review.id, markInput('next'));

    expect(retried?.id).toBe(first?.id);
    expect(retried?.content).toBe('Cards are too tight');
    expect(next?.seq).toBe(2);
  });

  it('resolves overlapping retries of one clientId to a single mark', async () => {
    const review = await draftOf(reviewer);
    const [a, b] = await Promise.all([
      model.addMark(review.id, markInput('overlap')),
      model.addMark(review.id, markInput('overlap')),
    ]);

    expect(a?.id).toBe(b?.id);
    expect(await model.listMarks(review.id)).toHaveLength(1);
  });

  it('refuses new marks once the review is submitted', async () => {
    const review = await draftOf(reviewer);
    const kept = await model.addMark(review.id, markInput('kept'));
    await model.markSubmitted(review.id);

    expect(await model.addMark(review.id, markInput('late'))).toBeUndefined();
    expect((await model.addMark(review.id, markInput('kept')))?.id).toBe(kept?.id);
    expect(await model.listMarks(review.id)).toHaveLength(1);
  });

  it('stores the page and geometry of each mark as given', async () => {
    const review = await draftOf(reviewer);
    await model.addMark(review.id, {
      ...markInput('geo'),
      context: {
        commit: 'abc123',
        context: { release: 'preview', attempt: 2, stable: true },
        env: { consoleErrors: ['warning'], userAgent: 'test-agent' },
      },
      regionRefs: [
        {
          box: { height: 160, width: 384, x: 448, y: 494 },
          selector: '#cards',
          text: 'Cards',
        },
      ],
      targets: [
        {
          label: 'Cards',
          rect: { height: 160, width: 384, x: 448, y: 494 },
          selector: '#cards',
          text: 'Cards',
        },
      ],
    });
    const [stored] = await model.listMarks(review.id);

    expect(stored.url).toBe('https://preview.example.com/notebook?tab=1');
    expect(stored.routeKey).toBe('/notebook');
    expect(stored.pageMeta).toEqual({ title: 'Fieldnotes' });
    expect(stored.rectDocument).toEqual({ height: 160, width: 384, x: 448, y: 1294 });
    expect(stored.context).toEqual({
      commit: 'abc123',
      context: { release: 'preview', attempt: 2, stable: true },
      env: { consoleErrors: ['warning'], userAgent: 'test-agent' },
    });
    expect(stored.regionRefs?.[0]?.selector).toBe('#cards');
    expect(stored.scroll).toEqual({ x: 0, y: 800 });
    expect(stored.targets?.[0]?.label).toBe('Cards');
    expect(stored.viewport).toEqual({ dpr: 2, height: 800, width: 1280 });
  });

  it('updates content only while the review is a draft', async () => {
    const review = await draftOf(reviewer);
    const mark = await model.addMark(review.id, markInput('edit'));
    const updated = await model.updateMark(review.id, mark!.id, { content: 'Line height 1.9' });
    expect(updated?.content).toBe('Line height 1.9');

    await model.markSubmitted(review.id);
    expect(await model.updateMark(review.id, mark!.id, { content: 'late edit' })).toBeUndefined();
    expect(await model.deleteMark(review.id, mark!.id)).toBe(false);
  });

  it('serializes submission before a concurrent update or delete', async () => {
    const hold = async (reviewId: string, operation: () => Promise<unknown>) => {
      let release!: () => void;
      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const lockReleased = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lock = serverDB.transaction(async (tx) => {
        await tx
          .select({ id: acceptanceReviews.id })
          .from(acceptanceReviews)
          .where(eq(acceptanceReviews.id, reviewId))
          .for('update');
        locked();
        await lockReleased;
      });
      await lockAcquired;
      const submitted = model.markSubmitted(reviewId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const mutation = operation();
      release();
      return { lock, mutation, submitted };
    };

    const updateReview = await draftOf(reviewer);
    const updateMark = await model.addMark(updateReview.id, markInput('race-update'));
    const updateRace = await hold(updateReview.id, () =>
      model.updateMark(updateReview.id, updateMark!.id, { content: 'late update' }),
    );
    await updateRace.lock;
    expect(await updateRace.submitted).toMatchObject({ status: 'submitted' });
    expect(await updateRace.mutation).toBeUndefined();
    expect((await model.findMark(updateReview.id, updateMark!.id))?.content).toBe(
      'Cards are too tight',
    );

    const deleteReview = await draftOf(reviewer);
    const deleteMark = await model.addMark(deleteReview.id, markInput('race-delete'));
    const deleteRace = await hold(deleteReview.id, () =>
      model.deleteMark(deleteReview.id, deleteMark!.id),
    );
    await deleteRace.lock;
    expect(await deleteRace.submitted).toMatchObject({ status: 'submitted' });
    expect(await deleteRace.mutation).toBe(false);
    expect(await model.findMark(deleteReview.id, deleteMark!.id)).toBeDefined();
  });
});

describe('AcceptanceReviewModel listing', () => {
  it('lists only submitted reviews, newest first, on every page they have a mark on', async () => {
    const draft = await draftOf(reviewer);
    await model.addMark(draft.id, markInput('draft'));

    const older = await draftOf(owner);
    await model.addMark(older.id, markInput('older'));
    await model.markSubmitted(older.id);

    const crossPage = await draftOf(owner);
    await model.addMark(crossPage.id, markInput('cross-1'));
    await model.addMark(crossPage.id, markInput('cross-2', 'Empty state', settings));
    await model.markSubmitted(crossPage.id);

    const settingsOnly = await draftOf(owner);
    await model.addMark(settingsOnly.id, markInput('settings', 'Title cut off', settings));
    await model.markSubmitted(settingsOnly.id);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    expect(ids(await model.listSubmitted(siteId, '/notebook'))).toEqual([crossPage.id, older.id]);
    expect(ids(await model.listSubmitted(siteId, '/settings'))).toEqual([
      settingsOnly.id,
      crossPage.id,
    ]);
    expect(ids(await model.listSubmitted(siteId))).not.toContain(draft.id);
    expect(await model.listSubmitted(siteId)).toHaveLength(3);
  });

  it('finds a review from the task it was submitted as', async () => {
    const review = await draftOf(reviewer);
    const [task] = await serverDB
      .insert(tasks)
      .values({
        createdByUserId: reviewer,
        identifier: 'FN-1',
        instruction: 'Fix the marks',
        seq: 1,
      })
      .returning();
    await model.linkTask(review.id, task.id);

    expect((await model.findByTask(task.id))?.id).toBe(review.id);
  });
});
