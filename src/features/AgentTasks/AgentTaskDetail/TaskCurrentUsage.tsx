import type { TaskRunTokenBuckets } from '@lobechat/types';
import { Button, Flexbox, Grid, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Time from '@/features/Home/components/Time';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const BUCKETS: (keyof TaskRunTokenBuckets)[] = ['input', 'output', 'cacheRead', 'cacheWrite'];

/** This is a read of current-operation records, not an estimate of the user's bill. */
export const TaskCurrentUsage = () => {
  const { t, i18n } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetch = useTaskStore((s) => s.useFetchCurrentTaskUsage);
  const { error, isValidating, revalidate } = useFetch(taskId, isLogin, status === 'running');
  const usage = useTaskStore(taskDetailSelectors.activeTaskCurrentUsage);
  if (!taskId || !isLogin) return null;
  const retryable = !error || normalizeAsyncError(error).retryable;
  const refresh = (
    <Button
      loading={isValidating}
      style={{ minHeight: 44 }}
      type="text"
      onClick={() => void revalidate()}
    >
      {t('taskDetail.currentUsage.refresh')}
    </Button>
  );
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" justify="space-between" wrap="wrap">
        <Text weight={500}>{t('taskDetail.currentUsage.title')}</Text>
        {!error && refresh}
      </Flexbox>
      {!!error && (
        <AsyncError
          action={retryable ? refresh : undefined}
          error={error}
          retrying={isValidating}
          title={t('taskDetail.currentUsage.error')}
          variant="inline"
          description={
            retryable
              ? t(usage ? 'taskDetail.currentUsage.stale' : 'taskDetail.currentUsage.retryHint')
              : t('taskDetail.currentUsage.accessUnavailable')
          }
        />
      )}
      {!usage && !error ? (
        <Text type="secondary">{t('taskDetail.currentUsage.loading')}</Text>
      ) : usage ? (
        <>
          <Grid gap={16} maxItemWidth={120} rows={2}>
            {BUCKETS.map((bucket) => (
              <Flexbox gap={2} key={bucket} style={{ minWidth: 0 }}>
                <Text fontSize={12} type="secondary">
                  {t(`taskDetail.currentUsage.${bucket}`)}
                </Text>
                <Text
                  style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
                  weight={500}
                >
                  {usage.tokens[bucket] === null
                    ? '--'
                    : t('taskDetail.currentUsage.lowerBound', {
                        value: usage.tokens[bucket]!.toLocaleString(i18n.language),
                      })}
                </Text>
              </Flexbox>
            ))}
          </Grid>
          <Text fontSize={12} type="secondary">
            {usage.coverage === 'unavailable'
              ? t(
                  usage.reasons.includes('pi-source-unconfirmed')
                    ? 'taskDetail.currentUsage.unsupported'
                    : 'taskDetail.currentUsage.unavailable',
                )
              : t('taskDetail.currentUsage.coverage', {
                  measured: usage.measuredMessages,
                  observed: usage.observedMessages,
                })}
          </Text>
          {usage.truncated && (
            <Text fontSize={12} type="secondary">
              {t('taskDetail.currentUsage.truncated', { limit: usage.messageLimit })}
            </Text>
          )}
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <Text fontSize={12} type="secondary">
              {t('taskDetail.currentUsage.observed')}
            </Text>
            <Time date={usage.observedAt} />
          </Flexbox>
          <Text fontSize={12} type="secondary">
            {t('taskDetail.currentUsage.sourceHint')}
          </Text>
        </>
      ) : null}
    </Flexbox>
  );
};
