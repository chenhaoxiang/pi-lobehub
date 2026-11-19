import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { taskDependencies, tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { seqOwnership, type TaskModelContext } from './context';

/**
 * Locks every task row whose parent/dependency relation can invalidate a
 * project move. Relation writers acquire the same deterministic set before
 * checking or inserting a link, so a move and a relation write serialize.
 */
export const lockProjectRelations = async (
  ctx: TaskModelContext,
  taskId: string,
  parentTaskId?: string | null,
  relatedTaskIds: string[] = [],
): Promise<void> => {
  const ids = new Set([taskId, ...(parentTaskId ? [parentTaskId] : []), ...relatedTaskIds]);
  const [current] = await ctx.db
    .select({ parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), seqOwnership(ctx)))
    .limit(1);
  if (current?.parentTaskId) ids.add(current.parentTaskId);

  const children = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), seqOwnership(ctx)));
  for (const child of children) ids.add(child.id);

  const linked = await ctx.db
    .select({ dependsOnId: taskDependencies.dependsOnId, taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .where(
      and(
        or(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnId, taskId)),
        ctx.workspaceId
          ? eq(taskDependencies.workspaceId, ctx.workspaceId)
          : and(eq(taskDependencies.userId, ctx.userId), isNull(taskDependencies.workspaceId)),
      ),
    );
  for (const relation of linked) {
    ids.add(relation.taskId);
    ids.add(relation.dependsOnId);
  }

  if (ids.size === 0) return;
  await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, [...ids]), seqOwnership(ctx)))
    .orderBy(asc(tasks.id))
    .for('update');
};

/** Convenience wrapper for callers that only have a database and scope. */
export const lockProjectRelationsFor = async (
  db: LobeChatDatabase,
  scope: Omit<TaskModelContext, 'db'>,
  taskId: string,
  parentTaskId?: string | null,
  relatedTaskIds: string[] = [],
): Promise<void> => lockProjectRelations({ db, ...scope }, taskId, parentTaskId, relatedTaskIds);
