import type { GoalGraphSnapshot, GoalTaskExecution } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';

import type { GoalServiceContext } from './types';

/** Bounded metadata reads for the Tasks this graph explicitly binds, never a history scan. */
export const collectCurrentExecutions = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<Record<string, GoalTaskExecution>> => {
  const nodes = graph.nodes.filter((node) => node.kind === 'task' && node.taskId);
  if (!nodes.length) return {};
  const tasks = await ctx.taskModel.findExecutionFactsByIds(nodes.map((node) => node.taskId!));
  const current = await ctx.taskTopicModel.findCurrentByTaskIds(tasks.map((task) => task.id));
  const operationIds = [
    ...new Set(current.flatMap((run) => (run.operationId ? [run.operationId] : []))),
  ];
  const operations = await new AgentOperationModel(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
  ).findExecutionFactsByIds(operationIds);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const runByTask = new Map(current.map((run) => [run.taskId, run]));
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  const observedAt = new Date();
  const result: Record<string, GoalTaskExecution> = {};
  for (const node of nodes) {
    const task = taskById.get(node.taskId!);
    if (!task) continue; // Unavailable in this scope is unknown, not a guessed task.
    const run = runByTask.get(task.id);
    const operation = run?.operationId ? operationById.get(run.operationId) : undefined;
    const matches =
      operation &&
      operation.taskId === task.id &&
      operation.topicId === task.currentTopicId &&
      run?.topicId === task.currentTopicId &&
      !(task.status === 'running' && task.startedAt && operation.createdAt < task.startedAt);
    result[node.id] = {
      observedAt,
      taskId: task.id,
      taskStatus: task.status,
      ...(task.currentTopicId ? { topicId: task.currentTopicId } : {}),
      ...(run?.topicId === task.currentTopicId
        ? { topicStatus: run.status, operationId: run.operationId ?? undefined }
        : {}),
      ...(matches
        ? {
            operation: {
              id: operation.id,
              startedAt: operation.startedAt,
              status: operation.status,
              updatedAt: operation.updatedAt,
            },
          }
        : {}),
    };
  }
  return result;
};
