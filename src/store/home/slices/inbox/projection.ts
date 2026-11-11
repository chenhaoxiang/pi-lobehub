import type { TaskPendingInteractions } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { HomeDailyBriefResponse } from '@/services/home';
import type { TopicListItem } from '@/services/topic';

/** The inbox feed and the daily brief are one entry per scope (user + workspace). */
export const HOME_INBOX_KEY = 'inbox';
export const HOME_DAILY_BRIEF_KEY = 'today';
export const HOME_TASK_INTERACTIONS_KEY = 'pending-task-input';

/** Ephemeral locators, not persisted questions or a second approval ledger. */
export const homeTaskInteractionsResource = defineReplica<HomeFeedParams, TaskPendingInteractions>({
  key: () => HOME_TASK_INTERACTIONS_KEY,
  name: 'homeTaskInteractions',
  storage: 'memory',
  version: 1,
});

export type HomeFeedParams = Record<string, never>;

/**
 * Running and unread topics of the home inbox, each with its last assistant
 * reply. Up to a few hundred rows with ~2 KB previews, so IndexedDB rather than
 * localStorage.
 */
export const homeInboxTopicsResource = defineReplica<HomeFeedParams, TopicListItem[]>({
  key: () => HOME_INBOX_KEY,
  name: 'homeInboxTopics',
  storage: 'indexedDB',
  version: 1,
});

/** Welcome line + input hint pairs from the daily generator: a few short strings. */
export const homeDailyBriefResource = defineReplica<HomeFeedParams, HomeDailyBriefResponse>({
  key: () => HOME_DAILY_BRIEF_KEY,
  name: 'homeDailyBrief',
  storage: 'localStorage',
  version: 1,
});
