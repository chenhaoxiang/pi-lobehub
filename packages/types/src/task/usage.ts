/** Four disjoint Pi buckets: input excludes both cache buckets; output includes reasoning. */
export interface TaskRunTokenBuckets {
  cacheRead: number | null;
  cacheWrite: number | null;
  input: number | null;
  output: number | null;
}

export type TaskRunUsageReason =
  | 'auxiliary-usage-not-covered'
  | 'current-run-unavailable'
  | 'incomplete-turn-usage'
  | 'message-window-truncated'
  | 'not-a-bill'
  | 'pi-source-unconfirmed'
  | 'usage-not-recorded';

/** A read projection of the current operation's message rows, not another ledger or bill. */
export interface TaskCurrentUsage {
  coverage: 'partial' | 'unavailable';
  measuredMessages: number;
  messageLimit: number;
  observedAt: number;
  observedMessages: number;
  operationId?: string;
  reasons: TaskRunUsageReason[];
  source: 'current-operation-messages';
  taskId: string;
  tokens: TaskRunTokenBuckets;
  topicId?: string;
  totalTokens: number | null;
  truncated: boolean;
}
