import type { TaskPendingInteraction, TaskPendingInteractions } from '@lobechat/types';
import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { agentOperations, messagePlugins, messages, tasks, taskTopics, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notShareVisitorTopicRef } from '../utils/shareVisitor';
import { buildWorkspaceWhere } from '../utils/workspace';
import { taskOwnership } from './task/context';

const CURRENT_RUN_LIMIT = 100;

/** Reads original records only. Opening a locator never answers or resumes its producer. */
export class TaskAttentionModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async listPendingInteractions(now = Date.now()): Promise<TaskPendingInteractions> {
    const scope = { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
    const runs = await this.db
      .select({
        agentId: agentOperations.agentId,
        operationId: agentOperations.id,
        taskId: tasks.id,
        taskIdentifier: tasks.identifier,
        taskTitle: tasks.name,
        topicId: topics.id,
      })
      .from(tasks)
      .innerJoin(
        taskTopics,
        and(eq(taskTopics.taskId, tasks.id), eq(taskTopics.topicId, tasks.currentTopicId)),
      )
      .innerJoin(
        agentOperations,
        and(
          eq(agentOperations.id, taskTopics.operationId),
          eq(agentOperations.taskId, tasks.id),
          eq(agentOperations.topicId, tasks.currentTopicId),
        ),
      )
      .innerJoin(topics, eq(topics.id, tasks.currentTopicId))
      .where(
        and(
          taskOwnership(scope),
          eq(tasks.status, 'running'),
          eq(taskTopics.status, 'running'),
          buildWorkspaceWhere(scope, taskTopics),
          buildWorkspaceWhere(scope, topics),
          buildWorkspaceWhere(scope, agentOperations),
          // An original interaction belongs to the running user's producer, not every teammate.
          eq(agentOperations.userId, this.userId),
          isNotNull(agentOperations.agentId),
          notShareVisitorTopicRef(agentOperations.topicId),
          inArray(agentOperations.status, [
            'running',
            'waiting_for_human',
            'waiting_for_client',
            'waiting_for_async_tool',
          ]),
          or(isNull(tasks.startedAt), gte(agentOperations.createdAt, tasks.startedAt)),
        ),
      )
      .orderBy(asc(agentOperations.createdAt), asc(agentOperations.id))
      .limit(CURRENT_RUN_LIMIT + 1);
    const truncated = runs.length > CURRENT_RUN_LIMIT;
    const current = runs.slice(0, CURRENT_RUN_LIMIT);
    const empty = { items: [], observedAt: now, truncated };
    if (!current.length) return empty;

    // Resolve ids through indexed CURRENT TOPICS first. Never join a user-wide JSON history scan.
    const messageRows = await this.db
      .select({
        id: messages.id,
        operationId: sql<string>`${messages.metadata}->>'heterogeneousToolStateOperationId'`,
        topicId: messages.topicId,
      })
      .from(messages)
      .where(
        and(
          buildWorkspaceWhere(scope, messages),
          eq(messages.userId, this.userId),
          isNull(messages.threadId),
          isNull(messages.groupId),
          inArray(
            messages.topicId,
            current.map((run) => run.topicId),
          ),
          inArray(
            sql`${messages.metadata}->>'heterogeneousToolStateOperationId'`,
            current.map((run) => run.operationId),
          ),
        ),
      );
    if (!messageRows.length) return empty;
    const plugins = await this.db
      .select({
        deadline: sql<unknown>`${messagePlugins.state}->'heterogeneousIntervention'->'deadline'`,
        hasDeadline: sql<boolean>`${messagePlugins.state}->'heterogeneousIntervention' ? 'deadline'`,
        id: messagePlugins.id,
        kind: sql<string>`${messagePlugins.state}->'heterogeneousIntervention'->>'interactionKind'`,
        operationId: sql<string>`${messagePlugins.state}->'heterogeneousIntervention'->>'operationId'`,
        toolCallId: messagePlugins.toolCallId,
      })
      .from(messagePlugins)
      .where(
        and(
          buildWorkspaceWhere(scope, messagePlugins),
          eq(messagePlugins.userId, this.userId),
          inArray(
            messagePlugins.id,
            messageRows.map((row) => row.id),
          ),
          sql`${messagePlugins.intervention}->>'status' = 'pending'`,
          sql`COALESCE(${messagePlugins.intervention}->>'resolving', 'false') = 'false'`,
          sql`${messagePlugins.state}->'heterogeneousIntervention'->>'transition' = 'pending'`,
          sql`${messagePlugins.state}->'heterogeneousIntervention'->>'provider' = 'pi'`,
          sql`${messagePlugins.intervention}->>'operationId' = ${messagePlugins.state}->'heterogeneousIntervention'->>'operationId'`,
        ),
      )
      .orderBy(asc(messagePlugins.id));
    const runById = new Map(current.map((run) => [run.operationId, run]));
    const messageById = new Map(messageRows.map((message) => [message.id, message]));
    const items: TaskPendingInteraction[] = [];
    for (const plugin of plugins) {
      const run = runById.get(plugin.operationId);
      const message = messageById.get(plugin.id);
      if (
        !run?.agentId ||
        !plugin.toolCallId ||
        message?.topicId !== run.topicId ||
        message.operationId !== run.operationId
      )
        continue;
      if (!['permission', 'plan', 'question'].includes(plugin.kind)) continue;
      const deadline = plugin.deadline;
      if (
        plugin.hasDeadline &&
        (typeof deadline !== 'number' || !Number.isFinite(deadline) || deadline <= now)
      )
        continue;
      items.push({
        ...run,
        agentId: run.agentId,
        ...(plugin.hasDeadline ? { deadline: deadline as number } : {}),
        kind: plugin.kind as TaskPendingInteraction['kind'],
        toolCallId: plugin.toolCallId,
        toolMessageId: plugin.id,
      });
    }
    return { items, observedAt: now, truncated };
  }
}
