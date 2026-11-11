import type { TaskPendingInteraction } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { styles } from './styles';

export const TaskInteractionCard = ({
  item,
  onCollapse,
  readError,
}: {
  item: TaskPendingInteraction;
  onCollapse: () => void;
  readError: boolean;
}) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerMeta}>
          <div className={styles.headerTitle}>{t('globalApproval.taskInput.title')}</div>
        </div>
        <ActionIcon
          aria-label={t('globalApproval.collapse')}
          icon={ChevronUp}
          size="small"
          title={t('globalApproval.collapse')}
          onClick={onCollapse}
        />
      </div>
      <Flexbox className={styles.content} gap={8}>
        <Text>{item.taskTitle || item.taskIdentifier}</Text>
        <Text type="secondary">
          {t(
            readError
              ? 'globalApproval.taskInput.readError'
              : 'globalApproval.taskInput.sourceHint',
          )}
        </Text>
      </Flexbox>
      <div className={styles.goalActions}>
        <Button
          type="primary"
          onClick={() =>
            navigate(
              `/agent/${encodeURIComponent(item.agentId)}/${encodeURIComponent(item.topicId)}`,
            )
          }
        >
          {t('globalApproval.taskInput.open')}
        </Button>
      </div>
    </div>
  );
};

/** A failed read is not an empty inbox and never becomes an approval request. */
export const TaskInteractionReadStatus = ({
  error,
  pending,
  retry,
}: {
  error: boolean;
  pending: boolean;
  retry: () => void;
}) => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox horizontal align="center" className={styles.card} gap={8} padding={12}>
      <Text type="secondary">
        {t(error ? 'globalApproval.taskInput.readError' : 'globalApproval.taskInput.truncated')}
      </Text>
      {error && (
        <Button loading={pending} size="small" onClick={retry}>
          {t('globalApproval.taskInput.retry')}
        </Button>
      )}
    </Flexbox>
  );
};
