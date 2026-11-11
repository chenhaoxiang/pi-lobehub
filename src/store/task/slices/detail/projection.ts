import type { TaskCurrentUsage, TaskDetailData } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** Current-run metadata is an ephemeral read view, never a second usage ledger. */
export const taskCurrentUsageResource = defineReplica<string, TaskCurrentUsage>({
  key: (id) => id,
  name: 'taskCurrentUsage',
  storage: 'memory',
  version: 1,
});

/** Canonical task ids only. Display aliases live in the in-memory ref index. */
export const taskDetailResource = defineReplica<string, TaskDetailData>({
  key: (id) => id,
  name: 'taskDetail',
  storage: 'indexedDB',
  version: 2,
});
