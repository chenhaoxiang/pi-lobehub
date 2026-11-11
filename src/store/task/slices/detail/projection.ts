import type { TaskCurrentUsage, TaskDetailData, TaskEngineeringSnapshot } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** Explicit engineering records stay an on-demand, memory-only observation. */
export const taskEngineeringResource = defineReplica<string, TaskEngineeringSnapshot>({
  key: (id) => id,
  name: 'taskEngineering',
  storage: 'memory',
  version: 1,
});

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
