import type { TaskCurrentUsage, TaskRunTokenBuckets } from '@lobechat/types';
import { and, asc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';

import { agentOperations, messages, tasks, taskTopics, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notShareVisitorTopicRef } from '../utils/shareVisitor';
import { buildWorkspaceWhere } from '../utils/workspace';
import { childOwnership, taskOwnership } from './task/context';

const MESSAGE_LIMIT = 500;
const emptyTokens = (): TaskRunTokenBuckets => ({
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
});
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Read one complete canonical four-bucket report, never mix fields from two sources. */
const readBuckets = (value: unknown): TaskRunTokenBuckets | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const usage = value as Record<string, unknown>;
  const cacheRead = usage.inputCachedTokens;
  const cacheWrite = usage.inputWriteCacheTokens;
  const output = usage.totalOutputTokens;
  if (!isCount(cacheRead) || !isCount(cacheWrite) || !isCount(output)) return;
  const input = usage.inputCacheMissTokens;
  if (!isCount(input)) return;
  const totalInput = input + cacheRead + cacheWrite;
  const total = totalInput + output;
  if (!isCount(totalInput) || !isCount(total)) return;
  if (usage.totalInputTokens !== undefined && usage.totalInputTokens !== totalInput) return;
  if (usage.totalTokens !== undefined && usage.totalTokens !== total) return;
  return { input, output, cacheRead, cacheWrite };
};

/** Existing message rows own the settlements. This class only makes a bounded read projection. */
export class TaskUsageModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private current = async (taskId: string) => {
    const scope = { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
    const [row] = await this.db
      .select({
        taskId: tasks.id,
        claim: tasks.startedAt,
        operationId: agentOperations.id,
        topicId: topics.id,
        provider: agentOperations.provider,
        threadId: agentOperations.threadId,
      })
      .from(tasks)
      .leftJoin(
        taskTopics,
        and(
          eq(taskTopics.taskId, tasks.id),
          eq(taskTopics.topicId, tasks.currentTopicId),
          childOwnership(scope, taskTopics),
        ),
      )
      .leftJoin(
        topics,
        and(eq(topics.id, tasks.currentTopicId), buildWorkspaceWhere(scope, topics)),
      )
      .leftJoin(
        agentOperations,
        and(
          eq(agentOperations.id, taskTopics.operationId),
          eq(agentOperations.taskId, tasks.id),
          eq(agentOperations.topicId, topics.id),
          buildWorkspaceWhere(scope, agentOperations),
          eq(agentOperations.userId, this.userId),
          notShareVisitorTopicRef(agentOperations.topicId),
          or(
            ne(tasks.status, 'running'),
            isNull(tasks.startedAt),
            gte(agentOperations.createdAt, tasks.startedAt),
          ),
        ),
      )
      .where(and(eq(tasks.id, taskId), taskOwnership(scope)))
      .limit(1);
    return row;
  };

  async readCurrent(taskId: string): Promise<TaskCurrentUsage | undefined> {
    const run = await this.current(taskId);
    if (!run) return;
    const unavailable = (): TaskCurrentUsage => ({
      coverage: 'unavailable',
      measuredMessages: 0,
      messageLimit: MESSAGE_LIMIT,
      observedAt: Date.now(),
      observedMessages: 0,
      reasons: ['current-run-unavailable'],
      source: 'current-operation-messages',
      taskId: run.taskId,
      tokens: emptyTokens(),
      totalTokens: null,
      truncated: false,
    });
    if (!run.operationId || !run.topicId) return unavailable();
    if (run.provider !== 'pi') return { ...unavailable(), reasons: ['pi-source-unconfirmed'] };
    const usage = sql`COALESCE(${messages.usage}, ${messages.metadata}->'usage')`;
    // The topic index bounds the JSON predicate to ONE exact current run's topic.
    // Only usage is hydrated: no message text, reasoning, tools or arbitrary metadata.
    const rows = await this.db
      .select({
        usage: sql<unknown>`jsonb_strip_nulls(jsonb_build_object(
        'inputCacheMissTokens', ${usage}->'inputCacheMissTokens',
        'inputCachedTokens', ${usage}->'inputCachedTokens',
        'inputWriteCacheTokens', ${usage}->'inputWriteCacheTokens',
        'totalInputTokens', ${usage}->'totalInputTokens',
        'totalOutputTokens', ${usage}->'totalOutputTokens',
        'totalTokens', ${usage}->'totalTokens'
      ))`,
      })
      .from(messages)
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
          eq(messages.userId, this.userId),
          eq(messages.topicId, run.topicId),
          eq(messages.role, 'assistant'),
          run.threadId ? eq(messages.threadId, run.threadId) : isNull(messages.threadId),
          isNull(messages.groupId),
          sql`${messages.metadata}->>'operationId' = ${run.operationId}`,
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(MESSAGE_LIMIT + 1);
    const after = await this.current(taskId);
    if (!after) return;
    // A run replacement or later start claim invalidates the whole sample, not just its label.
    if (
      after.operationId !== run.operationId ||
      after.topicId !== run.topicId ||
      after.claim?.getTime() !== run.claim?.getTime()
    )
      return unavailable();
    const truncated = rows.length > MESSAGE_LIMIT;
    const sampled = rows.slice(0, MESSAGE_LIMIT);
    let measuredMessages = 0;
    let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const row of sampled) {
      const buckets = readBuckets(row.usage);
      if (!buckets) continue;
      const next = {
        input: tokens.input + buckets.input!,
        output: tokens.output + buckets.output!,
        cacheRead: tokens.cacheRead + buckets.cacheRead!,
        cacheWrite: tokens.cacheWrite + buckets.cacheWrite!,
      };
      if (
        !Object.values(next).every(isCount) ||
        !isCount(Object.values(next).reduce((sum, value) => sum + value, 0))
      )
        continue;
      tokens = next;
      measuredMessages++;
    }
    return {
      coverage: measuredMessages ? 'partial' : 'unavailable',
      measuredMessages,
      messageLimit: MESSAGE_LIMIT,
      observedAt: Date.now(),
      observedMessages: sampled.length,
      operationId: run.operationId,
      reasons: [
        'auxiliary-usage-not-covered',
        'not-a-bill',
        ...(measuredMessages ? [] : ['usage-not-recorded' as const]),
        ...(measuredMessages < sampled.length ? ['incomplete-turn-usage' as const] : []),
        ...(truncated ? ['message-window-truncated' as const] : []),
      ],
      source: 'current-operation-messages',
      taskId: run.taskId,
      tokens: measuredMessages ? tokens : emptyTokens(),
      topicId: run.topicId,
      totalTokens: measuredMessages
        ? Object.values(tokens).reduce((sum, value) => sum + value, 0)
        : null,
      truncated,
    };
  }
}
