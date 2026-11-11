// @vitest-environment node
import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { dispatchAcceptanceRepair } from '@/server/routers/lambda/_helpers/acceptanceRepairDispatch';
import { TaskRunnerService } from '@/server/services/taskRunner';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';

import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const db = await getTestDB();
const owner = 'goal-task-rework-owner';
registerGoalServiceTestCleanup(db, owner);

const achievedGoal = async () => {
  const service = new GoalService(db, owner);
  const graph = await service.create({
    requirement: 'A complete result',
    tasks: ['Prepare result'],
    title: 'Review again',
  });
  const model = new TaskModel(db, owner);
  const created = await service.tick(graph.goal.id);
  await model.updateStatus(created.taskId!, 'completed');
  await service.tick(graph.goal.id);
  await service.tick(graph.goal.id);
  const terminal = await service.tick(graph.goal.id);
  await model.updateStatus(terminal.taskId!, 'completed');
  await service.tick(graph.goal.id);
  await service.tick(graph.goal.id);
  expect((await service.graph(graph.goal.id)).goal.status).toBe('achieved');
  return { service, graph, model, created, terminal };
};

const openScope = async () => {
  const fixture = await achievedGoal();
  expect(await fixture.service.reopenForChanges(fixture.created.taskId!, 'Update the source')).toBe(
    fixture.graph.goal.id,
  );
  const held = await fixture.service.graph(fixture.graph.goal.id);
  return { ...fixture, held, decision: held.decisions.find((item) => item.status === 'pending')! };
};

describe('Goal rework belongs to the exact responsible Task', () => {
  it('requeues a rejected intermediate delivery when no dependent has started', async () => {
    const service = new GoalService(db, owner);
    const graph = await service.create({
      requirement: 'Deliver a complete result',
      tasks: ['Prepare result'],
      title: 'Rework',
    });
    const created = await service.tick(graph.goal.id);
    const model = new TaskModel(db, owner);
    await model.updateStatus(created.taskId!, 'completed');
    const acceptance = (await new AcceptanceModel(db, owner).findBySubject(
      'task',
      created.taskId!,
    ))!;
    await new AcceptanceModel(db, owner).updateStatus(acceptance.id, 'rejected');

    expect(
      await service.reopenForChanges(created.taskId!, 'Keep the missing source attached'),
    ).toBe(graph.goal.id);
    expect(await model.findById(created.taskId!)).toMatchObject({ status: 'backlog' });
    expect(
      (await service.graph(graph.goal.id)).nodes.find((n) => n.id === created.nodeId),
    ).toMatchObject({ status: 'active', taskId: created.taskId });
  });

  it('holds for an owner scope decision and starts no work while it is pending', async () => {
    const { service, graph, model, terminal, held, decision } = await openScope();
    expect(held.goal.status).toBe('review');
    expect(decision.authority).toBe('user');
    expect(decision.question).toContain('final review');
    expect(await model.findById(terminal.taskId!)).toMatchObject({ status: 'completed' });
    const run = vi.spyOn(TaskRunnerService.prototype, 'runTask');
    await service.tick(graph.goal.id);
    expect(run).not.toHaveBeenCalled();
    await expect(
      service.decide(graph.goal.id, decision.id, 'confirm_rework_scope'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      (await service.graph(graph.goal.id)).decisions.find((d) => d.id === decision.id)?.status,
    ).toBe('pending');
  });

  it('renews unsigned final review only after the owner records the downstream scope', async () => {
    const { service, graph, model, created, terminal, decision } = await openScope();
    await service.decide(
      graph.goal.id,
      decision.id,
      'confirm_rework_scope',
      'Rework the source Task. Reuse its unaffected outputs; renew the final review.',
    );
    const reopened = await service.graph(graph.goal.id);
    expect(reopened.goal.status).toBe('running');
    expect(await model.findById(created.taskId!)).toMatchObject({ status: 'backlog' });
    expect(await model.findById(terminal.taskId!)).toMatchObject({ status: 'backlog' });
    const terminalNode = reopened.nodes.find((n) => n.title === GOAL_ACCEPTANCE_TASK_TITLE)!;
    expect(terminalNode.status).toBe('active');
    expect(reopened.edges).toContainEqual(
      expect.objectContaining({
        kind: 'depends_on',
        sourceNodeId: terminalNode.id,
        targetNodeId: created.nodeId,
      }),
    );
    expect(
      (await model.getComments(created.taskId!)).some((c) =>
        c.content.includes('Reuse its unaffected outputs'),
      ),
    ).toBe(true);
  });

  it('cannot sign the old final report after its review has been requeued', async () => {
    const { service, graph, model, terminal, decision } = await openScope();
    const acceptanceModel = new AcceptanceModel(db, owner);
    const acceptance = (await acceptanceModel.findBySubject('task', terminal.taskId!))!;
    const runs = new VerifyRunModel(db, owner);
    const oldRound = await runs.create({
      acceptanceId: acceptance.id,
      roundIndex: 1,
      status: 'passed',
    });
    await acceptanceModel.updateStatus(acceptance.id, 'delivered');
    await service.decide(
      graph.goal.id,
      decision.id,
      'confirm_rework_scope',
      'Rework the source and repeat final review.',
    );
    const delivery = new AcceptanceService(db, owner);
    await delivery.recomputeStatus(acceptance.id);
    await expect(delivery.accept(acceptance.id)).rejects.toThrow('still in progress');
    expect((await model.findById(terminal.taskId!))?.status).toBe('backlog');
    expect((await runs.findById(oldRound.id))?.status).toBe('passed');
    expect(await runs.listByAcceptance(acceptance.id)).toHaveLength(2);
  });

  it('keeps a second rejection handoff while another scope gate holds the Goal', async () => {
    const service = new GoalService(db, owner);
    const graph = await service.create({
      requirement: 'A complete result',
      tasks: ['Source', { title: 'Report', dependsOn: ['Source'] }],
      title: 'Two rejections',
    });
    const model = new TaskModel(db, owner);
    const acceptanceModel = new AcceptanceModel(db, owner);
    const delivery = new AcceptanceService(db, owner);
    const first = await service.tick(graph.goal.id);
    await model.updateStatus(first.taskId!, 'completed');
    await service.tick(graph.goal.id);
    const second = await service.tick(graph.goal.id);
    await model.updateStatus(second.taskId!, 'completed');
    await service.tick(graph.goal.id);
    const rejectAndHandoff = async (id: string) => {
      const acceptance = (await acceptanceModel.findBySubject('task', id))!;
      await new VerifyRunModel(db, owner).create({
        acceptanceId: acceptance.id,
        roundIndex: 1,
        status: 'passed',
      });
      await acceptanceModel.updateStatus(acceptance.id, 'delivered');
      const rejected = await delivery.reject(acceptance.id, 'Please revise this delivery.');
      await dispatchAcceptanceRepair(
        { serverDB: db, userId: owner } as Parameters<typeof dispatchAcceptanceRepair>[0],
        delivery,
        rejected,
        'Please revise this delivery.',
      );
    };
    await rejectAndHandoff(first.taskId!);
    const firstGate = (await service.graph(graph.goal.id)).decisions.find(
      (d) => d.status === 'pending',
    )!;
    await rejectAndHandoff(second.taskId!);
    expect((await model.findById(second.taskId!))?.status).toBe('backlog');
    expect(
      (await service.graph(graph.goal.id)).nodes.find((n) => n.taskId === second.taskId)?.status,
    ).toBe('active');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('review');
    expect(
      (await service.graph(graph.goal.id)).decisions.find((d) => d.id === firstGate.id)?.status,
    ).toBe('pending');
  });

  it.each(['source', 'final'])(
    'preserves a live %s attempt and the pending decision',
    async (which) => {
      const { service, graph, model, created, terminal, decision } = await openScope();
      const taskId = which === 'source' ? created.taskId! : terminal.taskId!;
      await model.updateStatus(taskId, 'running');
      await expect(
        service.decide(
          graph.goal.id,
          decision.id,
          'confirm_rework_scope',
          'Rework the source; review downstream outputs.',
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await model.findById(taskId))?.status).toBe('running');
      expect(
        (await service.graph(graph.goal.id)).decisions.find((d) => d.id === decision.id)?.status,
      ).toBe('pending');
    },
  );

  it('never rewrites an already signed final delivery to make rework pass', async () => {
    const { service, graph, created, terminal, decision } = await openScope();
    const acceptanceModel = new AcceptanceModel(db, owner);
    const acceptance = (await acceptanceModel.findBySubject('task', terminal.taskId!))!;
    await acceptanceModel.updateStatus(acceptance.id, 'accepted');
    await expect(
      service.decide(graph.goal.id, decision.id, 'confirm_rework_scope', 'Rework the source'),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect((await acceptanceModel.findById(acceptance.id))?.status).toBe('accepted');
    expect((await new TaskModel(db, owner).findById(created.taskId!))?.status).toBe('completed');
    expect((await service.graph(graph.goal.id)).goal.status).toBe('review');
  });
});
