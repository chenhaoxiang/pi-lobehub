import type { TaskPendingInteraction, TaskPendingInteractions } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import type { GlobalApprovalGroup } from './useGlobalPendingApprovals';
import { selectTaskInteractionAttention } from './usePendingTaskInteractions';

const item = (id: string): TaskPendingInteraction => ({
  agentId: `agent-${id}`,
  kind: 'question',
  operationId: `op-${id}`,
  taskId: `task-${id}`,
  taskIdentifier: `T-${id}`,
  taskTitle: 'Original task',
  toolCallId: `call-${id}`,
  toolMessageId: `msg-${id}`,
  topicId: `topic-${id}`,
});
const data = (items: TaskPendingInteraction[]): TaskPendingInteractions => ({
  items,
  observedAt: 1000,
  truncated: false,
});
const contextKey = (row: TaskPendingInteraction) =>
  messageMapKey({ agentId: row.agentId, scope: 'main', topicId: row.topicId });

describe('task interaction attention locators', () => {
  it('deduplicates only the same exact original locator, not a reused tool call id in another run', () => {
    const a = item('a');
    const b = { ...item('b'), toolCallId: a.toolCallId };
    expect(selectTaskInteractionAttention(data([a, a, b]), [], null, undefined, 1000)).toEqual([
      a,
      b,
    ]);
  });

  it('leaves active and portal questions to their original controls', () => {
    const a = item('a');
    const b = item('b');
    const c = item('c');
    expect(
      selectTaskInteractionAttention(data([a, b, c]), [], contextKey(a), contextKey(b), 1000),
    ).toEqual([c]);
  });

  it('does not count an already loaded local question a second time', () => {
    const a = item('a');
    const local = [
      { interventions: [{ toolMessageId: a.toolMessageId }] },
    ] as GlobalApprovalGroup[];
    expect(selectTaskInteractionAttention(data([a]), local, null, undefined, 1000)).toEqual([]);
  });

  it('removes expired or malformed deadlines without producing any answer or continuation', () => {
    const a = item('a');
    expect(
      selectTaskInteractionAttention(
        data([
          { ...a, deadline: 1000 },
          { ...item('bad'), deadline: Number.NaN },
          { ...item('future'), deadline: 1001 },
          item('no-deadline'),
        ]),
        [],
        null,
        undefined,
        1000,
      ).map((row) => row.taskId),
    ).toEqual(['task-future', 'task-no-deadline']);
    expect(selectTaskInteractionAttention(undefined, [], null, undefined, 1000)).toEqual([]);
  });
});
