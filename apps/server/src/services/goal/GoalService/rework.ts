import type { GoalGraphSnapshot } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { TaskModel } from '@/database/models/task';
import { TaskArchiveModel } from '@/database/models/taskArchive';

import { GOAL_ACCEPTANCE_TASK_TITLE } from '../decideNextMove';
import type { GoalServiceContext } from './types';

export const CONFIRM_REWORK_SCOPE = 'confirm_rework_scope';

/** A dependency points from the consumer to its prerequisite. Walk transitively. */
export const startedReworkDependents = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
) => {
  const affected = new Set([nodeId]);
  for (let size = -1; size !== affected.size;) {
    size = affected.size;
    for (const edge of graph.edges) {
      if (edge.kind === 'depends_on' && affected.has(edge.targetNodeId))
        affected.add(edge.sourceNodeId);
    }
  }
  const nodes = graph.nodes.filter(
    (node) =>
      node.id !== nodeId &&
      affected.has(node.id) &&
      node.taskId &&
      !['retired', 'rejected'].includes(node.status),
  );
  const tasks = await ctx.taskModel.findByIds(nodes.map((node) => node.taskId!));
  return nodes.flatMap((node) => {
    const task = tasks.find((item) => item.id === node.taskId);
    return task &&
      ((task.totalTopics ?? 0) > 0 || task.status === 'running' || task.status === 'completed')
      ? [{ node, task }]
      : [];
  });
};

/** Commit the explicit scope answer and requeue under the same Goal/Task locks. */
export const confirmReworkScope = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  sourceNodeId: string,
  taskId: string,
  decisionId: string,
  resolution: string,
) =>
  ctx.db.transaction(async (tx) => {
    const scoped = ctx.inTransaction(tx);
    const goal = await scoped.goalModel.lockById(graph.goal.id);
    if (!goal || !['review', 'running'].includes(goal.status)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Goal is no longer waiting for this scope decision.',
      });
    }
    const current = await scoped.requireGraph(goal.id);
    await scoped.taskModel.lockForUpdate(taskId);
    const task = await scoped.taskModel.findById(taskId);
    if (!task || task.status !== 'completed') {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'The original Task changed while its rework scope was waiting. Do not overwrite its current run or decision.',
      });
    }
    const terminalId = current.nodes.find(
      (node) => node.id !== sourceNodeId && node.title === GOAL_ACCEPTANCE_TASK_TITLE,
    )?.taskId;
    if (terminalId) await scoped.taskModel.lockForUpdate(terminalId);
    await assertFinalReviewCanRework(scoped, current, sourceNodeId);
    const resolved = await scoped.graphModel.resolveDecision(
      goal.id,
      decisionId,
      CONFIRM_REWORK_SCOPE,
      resolution,
    );
    if (!resolved)
      throw new TRPCError({ code: 'CONFLICT', message: 'Decision was already resolved' });
    await requeueFinalReview(scoped, current, sourceNodeId);
    await scoped.taskModel.updateStatusIfCurrent(taskId, 'completed', 'backlog', { error: null });
    await new TaskArchiveModel(tx, ctx.userId, ctx.workspaceId).unarchive(taskId);
    await scoped.graphModel.updateNodeStatus(goal.id, sourceNodeId, 'active', resolution);
    await scoped.taskModel.addComment({
      authorUserId: ctx.userId,
      content: `Owner-confirmed rework scope: ${resolution}`,
      taskId,
      userId: ctx.userId,
    });
    await scoped.transitionStatus(goal, 'running', 'Owner confirmed the rework scope', 'user');
    return resolved;
  });

/** A scope decision never rewrites a signed-off acceptance or interrupts a live reviewer. */
export const assertFinalReviewCanRework = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  sourceNodeId: string,
) => {
  const terminal = graph.nodes.find(
    (node) =>
      node.id !== sourceNodeId &&
      node.kind === 'task' &&
      node.title === GOAL_ACCEPTANCE_TASK_TITLE &&
      node.taskId,
  );
  if (!terminal) return;
  const acceptance = await ctx.acceptanceService.acceptanceModel.findBySubject(
    'task',
    terminal.taskId!,
  );
  if (acceptance?.status === 'accepted' || acceptance?.status === 'closed') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'The final delivery is already signed off. Preserve that decision and arrange a follow-up Goal before resuming this change.',
    });
  }
  const task = await ctx.taskModel.findById(terminal.taskId!);
  if (task?.status === 'running') {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        'The final review is still running. Let it finish or stop it through its Task before confirming rework scope.',
    });
  }
};

/** After an explicit scope decision, unsigned final verification must run again. */
export const requeueFinalReview = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  sourceNodeId: string,
) => {
  const terminal = graph.nodes.find(
    (node) =>
      node.id !== sourceNodeId &&
      node.kind === 'task' &&
      node.title === GOAL_ACCEPTANCE_TASK_TITLE &&
      node.taskId,
  );
  if (!terminal) return;
  const model = new TaskModel(ctx.db, ctx.userId, ctx.workspaceId);
  const task = await model.findById(terminal.taskId!);
  if (task?.status === 'completed') {
    await model.updateStatusIfCurrent(task.id, 'completed', 'backlog', { error: null });
    await new TaskArchiveModel(ctx.db, ctx.userId, ctx.workspaceId).unarchive(task.id);
  }
  await ctx.graphModel.updateNodeStatus(
    graph.goal.id,
    terminal.id,
    'active',
    'Upstream delivery was sent back; final review must be renewed',
  );
  if (
    !graph.edges.some(
      (edge) =>
        edge.kind === 'depends_on' &&
        edge.sourceNodeId === terminal.id &&
        edge.targetNodeId === sourceNodeId,
    )
  ) {
    await ctx.graphModel.createEdge(graph.goal.id, terminal.id, sourceNodeId, 'depends_on');
  }
};
