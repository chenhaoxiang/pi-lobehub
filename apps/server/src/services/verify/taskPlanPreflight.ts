import { buildCheckReviewOverlay } from '@lobechat/utils/verify/acceptanceReviewOverlay';

import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService, buildAcceptanceCheckUnion } from './acceptanceService';

export class TaskAcceptanceNeedsNewChecksError extends Error {
  constructor() {
    super(
      'Every existing acceptance check is already signed off. Preserve that evidence; declare a new check or arrange a follow-up Goal before starting this rework.',
    );
  }
}

/** No remaining work is not permission to generate a replacement contract. */
export const assertTaskAcceptanceHasRemainingChecks = async (
  db: LobeChatDatabase,
  userId: string,
  taskId: string,
  workspaceId?: string,
): Promise<void> => {
  const service = new AcceptanceService(db, userId, workspaceId);
  const acceptance = await service.acceptanceModel.findBySubject('task', taskId);
  if (!acceptance) return;
  const { results, runs } = await service.loadRounds(acceptance.id);
  const checks = buildAcceptanceCheckUnion(
    runs.map((run) => ({
      run,
      results: results.filter((result) => result.verifyRunId === run.id),
    })),
  );
  if (!checks.length) return;
  const byId = new Map(results.map((result) => [result.id, result]));
  const current = runs.at(-1)?.roundIndex ?? 0;
  const signed = checks.filter((check) => {
    const review = buildCheckReviewOverlay(check, byId, current).userReview;
    return review?.action === 'accept' && !review.stale;
  });
  if (signed.length !== checks.length) return;
  // A user-selected new criterion is explicit new scope, not generated scope.
  const known = new Set(checks.map((check) => check.id));
  if (acceptance.config?.verifyCriteriaIds?.some((id) => !known.has(id))) return;
  throw new TaskAcceptanceNeedsNewChecksError();
};
