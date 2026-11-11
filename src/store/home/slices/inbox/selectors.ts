import { type HomeStore } from '@/store/home/store';

import { HOME_DAILY_BRIEF_KEY, HOME_INBOX_KEY, HOME_TASK_INTERACTIONS_KEY } from './projection';

/** Inbox topics; `undefined` until hydrated or fetched. */
const inboxTopics = (s: HomeStore) => s.homeInboxTopicsMap[HOME_INBOX_KEY];

/** Daily brief; `undefined` until hydrated or fetched. */
const dailyBrief = (s: HomeStore) => s.homeDailyBriefMap[HOME_DAILY_BRIEF_KEY];

const pendingTaskInteractions = (s: HomeStore) =>
  s.homeTaskInteractionsMap[HOME_TASK_INTERACTIONS_KEY];

export const homeInboxSelectors = {
  pendingTaskInteractions,
  dailyBrief,
  inboxTopics,
};
