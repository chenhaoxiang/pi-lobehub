'use client';

import { createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import {
  type AcceptanceVerdictCounts,
  formatAcceptanceCountsText,
  formatAcceptanceTimeText,
  resolveAcceptanceVerdictMeta,
  resolveAcceptanceVerdictState,
} from '../verdict';

const styles = createStaticStyles(({ css }) => ({
  summary: css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-height: 24px;
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
  `,
  status: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
  `,
  detail: css`
    color: ${cssVar.colorTextSecondary};
  `,
  separator: css`
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface AcceptanceVerdictSummaryProps {
  acceptance?: Pick<AcceptanceBundle['acceptance'], 'completedAt' | 'status'>;
  counts?: AcceptanceVerdictCounts;
  lastRunAt?: Date | string | null;
}

/**
 * A read-only header summary. Counts and timestamps provide context for the
 * checklist; neither is presented as a gate or as a person's sign-off.
 */
export const AcceptanceVerdictSummary = ({
  acceptance,
  counts,
  lastRunAt,
}: AcceptanceVerdictSummaryProps) => {
  const { t } = useTranslation('verify');
  const status = acceptance?.status;
  const verdictState = resolveAcceptanceVerdictState(status);
  const verdictMeta = resolveAcceptanceVerdictMeta(status ?? '', t);
  const countsText = counts ? formatAcceptanceCountsText(t, counts) : undefined;
  const timeText = formatAcceptanceTimeText(t, acceptance?.completedAt ?? lastRunAt);

  return (
    <Flexbox className={styles.summary} role={'status'}>
      <span className={styles.status} data-verdict-state={verdictState}>
        <Icon icon={verdictMeta.icon} size={14} spin={verdictMeta.spin} />
        <Text>{verdictMeta.label}</Text>
      </span>
      {countsText && (
        <>
          <span aria-hidden={'true'} className={styles.separator}>
            ·
          </span>
          <span className={styles.detail}>{countsText}</span>
        </>
      )}
      {timeText && (
        <>
          <span aria-hidden={'true'} className={styles.separator}>
            ·
          </span>
          <time className={styles.detail} dateTime={String(acceptance?.completedAt ?? lastRunAt)}>
            {timeText}
          </time>
        </>
      )}
    </Flexbox>
  );
};
