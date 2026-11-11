import { Button, Flexbox, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Time from '@/features/Home/components/Time';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

/** A task's explicit engineering links, not a second ship/merge authority. */
export const TaskEngineering = () => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const isLogin = useUserStore(authSelectors.isLogin);
  const fetch = useTaskStore((s) => s.useFetchTaskEngineering);
  const { error, isValidating, revalidate } = fetch(taskId, expanded && isLogin === true);
  const snapshot = useTaskStore(taskDetailSelectors.activeTaskEngineering);
  if (!taskId || !isLogin) return null;
  const retryable =
    !error || (normalizeAsyncError(error).retryable && !isTrpcErrorCode(error, 'NOT_FOUND'));
  const refresh = (
    <Button
      loading={isValidating}
      style={{ minHeight: 44 }}
      type="text"
      onClick={() => void revalidate()}
    >
      {t('taskDetail.engineering.refresh')}
    </Button>
  );
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" justify="space-between" wrap="wrap">
        <Button
          aria-expanded={expanded}
          style={{ minHeight: 44 }}
          type="text"
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? 'taskDetail.engineering.collapse' : 'taskDetail.engineering.expand')}
        </Button>
        {expanded && !error && refresh}
      </Flexbox>
      {expanded && (
        <>
          {!!error && (
            <AsyncError
              action={retryable ? refresh : undefined}
              description={t(
                !retryable
                  ? 'taskDetail.engineering.accessUnavailable'
                  : snapshot
                    ? 'taskDetail.engineering.stale'
                    : 'taskDetail.engineering.retryHint',
              )}
              error={error}
              retrying={isValidating}
              title={t('taskDetail.engineering.error')}
              variant="inline"
            />
          )}
          {!snapshot && !error && (
            <Text type="secondary">{t('taskDetail.engineering.loading')}</Text>
          )}
          {snapshot && (
            <>
              <Text fontSize={12} type="secondary">
                {t('taskDetail.engineering.sourceHint')}
              </Text>
              {snapshot.pullRequests.length === 0 && (
                <Text type="secondary">{t('taskDetail.engineering.empty')}</Text>
              )}
              {snapshot.pullRequests.map((pr) => (
                <Flexbox gap={6} key={`${pr.repository.toLowerCase()}#${pr.number}`}>
                  <a
                    href={pr.url}
                    rel="noopener noreferrer"
                    style={{ overflowWrap: 'anywhere' }}
                    target="_blank"
                  >
                    {pr.repository}#{pr.number}
                  </a>
                  <Text fontSize={12} type="secondary">
                    {t(
                      pr.source === 'manual-link'
                        ? 'taskDetail.engineering.manual'
                        : 'taskDetail.engineering.provider',
                    )}{' '}
                    · {t(`taskDetail.engineering.binding.${pr.binding}`)}
                  </Text>
                  <Text fontSize={12} style={{ overflowWrap: 'anywhere' }}>
                    {t('taskDetail.engineering.head', { sha: pr.headSha ?? '--' })}
                  </Text>
                  <Text fontSize={12}>
                    {t('taskDetail.engineering.state', {
                      state: pr.state
                        ? t(`taskDetail.engineering.prState.${pr.state}`)
                        : t('taskDetail.engineering.unknown'),
                    })}{' '}
                    ·{' '}
                    {t('taskDetail.engineering.ci', {
                      status: t(`taskDetail.engineering.ciState.${pr.ciStatus}`),
                    })}
                  </Text>
                  {pr.ciHeadSha && pr.ciHeadSha !== pr.headSha && (
                    <Text fontSize={12} type="secondary">
                      {t('taskDetail.engineering.headMismatch')}
                    </Text>
                  )}
                  {pr.checks.length === 0 ? (
                    <Text fontSize={12} type="secondary">
                      {t('taskDetail.engineering.noChecks')}
                    </Text>
                  ) : (
                    pr.checks.map((check, i) => (
                      <Text
                        fontSize={12}
                        key={`${check.appId}:${check.name}:${i}`}
                        style={{ overflowWrap: 'anywhere' }}
                        type="secondary"
                      >
                        {check.name} ·{' '}
                        {t('taskDetail.engineering.checkSource', {
                          appId: check.appId ?? '--',
                          status: check.status,
                          conclusion: check.conclusion ?? '--',
                        })}
                      </Text>
                    ))
                  )}
                  {pr.checksTruncated && (
                    <Text fontSize={12} type="secondary">
                      {t('taskDetail.engineering.checkLimit', {
                        limit: snapshot.checkLimit,
                        count: pr.recordedCheckCount,
                      })}
                    </Text>
                  )}
                  {pr.recordedAt && (
                    <Flexbox horizontal align="center" gap={8} wrap="wrap">
                      <Text fontSize={12} type="secondary">
                        {t('taskDetail.engineering.recordedAt')}
                      </Text>
                      <Time date={pr.recordedAt} />
                    </Flexbox>
                  )}
                </Flexbox>
              ))}
              {snapshot.truncated && (
                <Text fontSize={12} type="secondary">
                  {t('taskDetail.engineering.prLimit', { limit: snapshot.prLimit })}
                </Text>
              )}
              <Text fontSize={12} type="secondary">
                {t('taskDetail.engineering.gateUnknown')}
              </Text>
              <Flexbox horizontal align="center" gap={8} wrap="wrap">
                <Text fontSize={12} type="secondary">
                  {t('taskDetail.engineering.observedAt')}
                </Text>
                <Time date={snapshot.observedAt} />
              </Flexbox>
            </>
          )}
        </>
      )}
    </Flexbox>
  );
};
