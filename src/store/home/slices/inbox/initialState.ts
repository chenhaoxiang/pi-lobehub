import type { TaskPendingInteractions } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { HomeDailyBriefResponse } from '@/services/home';
import type { TopicListItem } from '@/services/topic';

export interface HomeInboxState {
  /** Daily brief, the view of the `homeDailyBrief` replica. */
  homeDailyBriefMap: Record<string, HomeDailyBriefResponse>;
  homeDailyBriefReplica: ReplicaState<HomeDailyBriefResponse>;
  /** Inbox topics (running + unread), the view of the `homeInboxTopics` replica. */
  homeInboxTopicsMap: Record<string, TopicListItem[]>;
  homeInboxTopicsReplica: ReplicaState<TopicListItem[]>;
  homeTaskInteractionsMap: Record<string, TaskPendingInteractions>;
  homeTaskInteractionsReplica: ReplicaState<TaskPendingInteractions>;
}

export const initialHomeInboxState: HomeInboxState = {
  homeTaskInteractionsMap: {},
  homeTaskInteractionsReplica: createReplicaState(),
  homeDailyBriefMap: {},
  homeDailyBriefReplica: createReplicaState(),
  homeInboxTopicsMap: {},
  homeInboxTopicsReplica: createReplicaState(),
};
