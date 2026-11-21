import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  formatAcceptanceCountsText,
  formatAcceptanceDecisionTimeText,
  formatAcceptanceTimeText,
  resolveAcceptanceDecisionTime,
  resolveAcceptanceLastVerifiedAt,
  resolveAcceptanceVerdictMeta,
  resolveAcceptanceVerdictState,
} from './verdict';

const t = ((key: string) => key) as TFunction<'verify'>;

describe('resolveAcceptanceVerdictState', () => {
  it.each(['pending', 'planned', 'verifying', 'repairing'])('treats %s as waiting', (status) => {
    expect(resolveAcceptanceVerdictState(status)).toBe('waiting');
  });

  it.each(['accepted', 'closed', 'rejected', 'errored'])(
    'preserves terminal status %s',
    (status) => {
      expect(resolveAcceptanceVerdictState(status)).toBe(status);
    },
  );

  it.each([undefined, null, '', 'future-status'])('keeps %s neutral', (status) => {
    expect(resolveAcceptanceVerdictState(status)).toBe('neutral');
  });

  it('keeps delivered in the waiting state for the reviewer decision', () => {
    expect(resolveAcceptanceVerdictState('delivered')).toBe('waiting');
  });
});

describe('resolveAcceptanceVerdictMeta', () => {
  it('treats repairing as an in-progress task, not a settled verdict', () => {
    const meta = resolveAcceptanceVerdictMeta('repairing', t);
    expect(meta.label).toBe('acceptance.status.repairing');
    expect(meta.spin).toBe(true);
  });

  it('treats accepted as a terminal success', () => {
    expect(resolveAcceptanceVerdictMeta('accepted', t).label).toBe('acceptance.status.accepted');
  });

  it('keeps unknown statuses neutral', () => {
    expect(resolveAcceptanceVerdictMeta('', t).label).toBe('acceptance.verdict.neutral');
  });

  it('uses the existing decision copy for delivered', () => {
    expect(resolveAcceptanceVerdictMeta('delivered', t).label).toBe('acceptance.status.delivered');
  });
});

describe('acceptance timestamps', () => {
  const rounds = [
    {
      run: {
        completedAt: '2026-11-21T12:00:00.000Z',
        createdAt: '2026-11-21T11:00:00.000Z',
        status: 'passed',
      },
    },
    {
      run: {
        completedAt: null,
        createdAt: '2026-11-21T13:00:00.000Z',
        status: 'verifying',
      },
    },
  ];

  it('uses the latest settled completedAt, never a current run createdAt', () => {
    expect(resolveAcceptanceLastVerifiedAt(rounds)).toBe('2026-11-21T12:00:00.000Z');
  });

  it('does not expose a decision time for a status without a human decision', () => {
    expect(resolveAcceptanceDecisionTime('delivered', '2026-11-21T14:00:00.000Z')).toBeUndefined();
  });

  it('uses acceptance completedAt independently from verification completion', () => {
    expect(resolveAcceptanceDecisionTime('accepted', '2026-11-21T14:00:00.000Z')).toBe(
      '2026-11-21T14:00:00.000Z',
    );
  });
});

describe('formatAcceptanceTimeText', () => {
  it('formats a supplied verification time', () => {
    expect(formatAcceptanceTimeText(t, '2026-11-21T10:20:00.000Z')).toBe(
      'acceptance.verdict.lastVerified',
    );
  });

  it('does not turn an absent time into a placeholder', () => {
    expect(formatAcceptanceTimeText(t, undefined)).toBeUndefined();
  });

  it('formats a decision time with its own label', () => {
    expect(formatAcceptanceDecisionTimeText(t, '2026-11-21T10:20:00.000Z')).toBe(
      'acceptance.verdict.decidedAt',
    );
  });
});

describe('formatAcceptanceCountsText', () => {
  it('joins only the counts that are present', () => {
    expect(
      formatAcceptanceCountsText(t, { failed: 1, notExecuted: 0, passed: 3, uncertain: 0 }),
    ).toBe('acceptance.stats.passed · acceptance.stats.failed');
  });
});
