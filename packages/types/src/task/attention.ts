/** A read-only locator for an original, task-bound pending tool interaction. */
export interface TaskPendingInteraction {
  agentId: string;
  deadline?: number;
  kind: 'permission' | 'plan' | 'question';
  operationId: string;
  taskId: string;
  taskIdentifier: string;
  taskTitle: string | null;
  toolCallId: string;
  toolMessageId: string;
  topicId: string;
}

export interface TaskPendingInteractions {
  items: TaskPendingInteraction[];
  /** Database observation time, not a native producer liveness assertion. */
  observedAt: number;
  /** At most 100 current task runs are examined; this is not a history inbox. */
  truncated: boolean;
}
