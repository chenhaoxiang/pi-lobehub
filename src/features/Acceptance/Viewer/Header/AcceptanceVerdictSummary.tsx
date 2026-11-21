'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import {
  type AcceptanceVerdictCounts,
  formatAcceptanceCountsText,
  formatAcceptanceDecisionTimeText,
  formatAcceptanceTimeText,
} from '../verdict';

const styles = stylex.create({
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: '8px',
    columnGap: '12px',
    minHeight: '24px',
    color: cssVar.colorTextSecondary,
    fontSize: '12px',
  },
  detail: {
    color: cssVar.colorTextSecondary,
  },
  separator: {
    color: cssVar.colorTextQuaternary,
  },
});

interface AcceptanceVerdictSummaryProps {
  counts?: AcceptanceVerdictCounts;
  decisionAt?: Date | string | null;
  lastVerifiedAt?: Date | string | null;
}

/**
 * A read-only header summary. Counts and timestamps provide context for the
 * checklist; the acceptance status itself remains in AcceptanceStatusControl.
 */
export const AcceptanceVerdictSummary = ({
  counts,
  decisionAt,
  lastVerifiedAt,
}: AcceptanceVerdictSummaryProps) => {
  const { t } = useTranslation('verify');
  const countsText = counts ? formatAcceptanceCountsText(t, counts) : undefined;
  const verifiedText = formatAcceptanceTimeText(t, lastVerifiedAt);
  const decisionText = formatAcceptanceDecisionTimeText(t, decisionAt);
  if (!countsText && !verifiedText && !decisionText) return null;

  return (
    <Flexbox {...stylex.props(styles.summary)}>
      {countsText && <span {...stylex.props(styles.detail)}>{countsText}</span>}
      {countsText && verifiedText && (
        <span aria-hidden={'true'} {...stylex.props(styles.separator)}>
          ·
        </span>
      )}
      {verifiedText && (
        <time dateTime={String(lastVerifiedAt)} {...stylex.props(styles.detail)}>
          {verifiedText}
        </time>
      )}
      {verifiedText && decisionText && (
        <span aria-hidden={'true'} {...stylex.props(styles.separator)}>
          ·
        </span>
      )}
      {decisionText && (
        <time dateTime={String(decisionAt)} {...stylex.props(styles.detail)}>
          {decisionText}
        </time>
      )}
    </Flexbox>
  );
};
