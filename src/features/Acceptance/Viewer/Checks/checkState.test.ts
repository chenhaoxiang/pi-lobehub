import { describe, expect, it } from 'vitest';

import { checkRowPresentation } from './checkState';
import type { AcceptanceCheck } from './types';

const makeCheck = (
  state: AcceptanceCheck['state'],
  options: {
    evidence?: AcceptanceCheck['evidence'];
    result?: AcceptanceCheck['result'];
    userReview?: AcceptanceCheck['userReview'];
  } = {},
) =>
  ({
    evidence: options.evidence ?? [],
    result: options.result,
    state,
    userReview: options.userReview,
  }) as AcceptanceCheck;

const settledReview = (action: 'accept' | 'ignore'): AcceptanceCheck['userReview'] => ({
  action,
  createdAt: '2026-07-16T00:00:00.000Z',
  roundIndex: 1,
  stale: false,
});

const rejectedReview: AcceptanceCheck['userReview'] = {
  action: 'reject',
  comment: 'needs another pass',
  createdAt: '2026-07-16T00:00:00.000Z',
  roundIndex: 1,
  stale: false,
};

describe('checkRowPresentation', () => {
  it.each([
    ['pending', makeCheck('passed')],
    ['needsFix', makeCheck('passed', { userReview: rejectedReview })],
    ['accepted', makeCheck('passed', { userReview: settledReview('accept') })],
    ['ignored', makeCheck('failed', { userReview: settledReview('ignore') })],
  ] as const)(
    'projects the %s review state without using the verifier state',
    (reviewState, check) => {
      expect(checkRowPresentation(check)).toMatchObject({
        evidenceCount: 0,
        reviewState,
      });
    },
  );

  it('projects a waived check as its own review state', () => {
    const check = makeCheck('failed', {
      result: {
        metadata: {
          dispute: { arbitration: { outcome: 'upheld' }, kind: 'invalid_criterion' },
        },
      } as AcceptanceCheck['result'],
    });

    expect(checkRowPresentation(check).reviewState).toBe('waived');
  });

  it('reports no evidence and one or many evidence items explicitly', () => {
    expect(checkRowPresentation(makeCheck('not_executed'))).toMatchObject({
      evidenceCount: 0,
    });
    expect(
      checkRowPresentation(
        makeCheck('passed', {
          evidence: [{ id: 'one', type: 'markdown' }] as AcceptanceCheck['evidence'],
        }),
      ),
    ).toMatchObject({ evidenceCount: 1 });
    expect(
      checkRowPresentation(
        makeCheck('passed', {
          evidence: [
            { id: 'one', type: 'markdown' },
            { id: 'two', type: 'screenshot' },
          ] as AcceptanceCheck['evidence'],
        }),
      ),
    ).toMatchObject({ evidenceCount: 2 });
  });
});
