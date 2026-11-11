import type { TaskPendingInteraction, TaskPendingInteractions } from '@lobechat/types';

import { useDeadlineClock } from '@/features/Conversation/hooks/useDeadlineClock';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useHomeStore } from '@/store/home';
import { homeInboxSelectors } from '@/store/home/slices/inbox/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import type { GlobalApprovalGroup } from './useGlobalPendingApprovals';

/** One source locator, once; visible original question controls keep ownership. */
export const selectTaskInteractionAttention = (
  data: TaskPendingInteractions | undefined,
  localGroups: GlobalApprovalGroup[],
  activeKey: string | null,
  portalKey: string | undefined,
  now: number,
): TaskPendingInteraction[] => {
  const covered = new Set(
    localGroups.flatMap((group) => group.interventions.map((item) => item.toolMessageId)),
  );
  const seen = new Set<string>();
  return (data?.items ?? []).filter((item) => {
    const key = messageMapKey({ agentId: item.agentId, scope: 'main', topicId: item.topicId });
    const identity = `${item.operationId}:${item.toolMessageId}:${item.toolCallId}`;
    if (
      key === activeKey ||
      key === portalKey ||
      covered.has(item.toolMessageId) ||
      seen.has(identity)
    )
      return false;
    if (item.deadline !== undefined && (!Number.isFinite(item.deadline) || item.deadline <= now))
      return false;
    seen.add(identity);
    return true;
  });
};

export const usePendingTaskInteractions = (localGroups: GlobalApprovalGroup[]) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetch = useHomeStore((s) => s.useFetchPendingTaskInteractions);
  const { error, isValidating, revalidate } = useFetch(isLogin);
  const data = useHomeStore(homeInboxSelectors.pendingTaskInteractions);
  const activeKey = useChatStore(displayMessageSelectors.currentDisplayChatKey);
  const portalTopicId = useChatStore(chatPortalSelectors.portalTopicId);
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const portalKey =
    activeAgentId && portalTopicId
      ? messageMapKey({ agentId: activeAgentId, scope: 'main', topicId: portalTopicId })
      : undefined;
  const now = useDeadlineClock(data?.items.map((item) => item.deadline) ?? []);
  return {
    error: isLogin ? error : undefined,
    isValidating,
    items: isLogin
      ? selectTaskInteractionAttention(data, localGroups, activeKey, portalKey, now)
      : [],
    observedAt: data?.observedAt,
    retry: () => {
      void revalidate();
    },
    truncated: isLogin ? (data?.truncated ?? false) : false,
  };
};
