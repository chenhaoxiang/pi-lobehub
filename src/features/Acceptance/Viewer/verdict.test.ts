import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  formatAcceptanceCountsText,
  formatAcceptanceTimeText,
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

  it.each([undefined, null, '', 'delivered', 'future-status'])('keeps %s neutral', (status) => {
    expect(resolveAcceptanceVerdictState(status)).toBe('neutral');
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
});

describe('formatAcceptanceCountsText', () => {
  it('joins only the counts that are present', () => {
    expect(
      formatAcceptanceCountsText(t, { failed: 1, notExecuted: 0, passed: 3, uncertain: 0 }),
    ).toBe('acceptance.stats.passed · acceptance.stats.failed');
  });
});
