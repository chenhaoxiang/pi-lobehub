// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type { VerifyCheckItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { agents, topics } from '@/database/schemas';
import { dispatchAcceptanceRepair } from '@/server/routers/lambda/_helpers/acceptanceRepairDispatch';
import { GoalService } from '@/server/services/goal';
import { registerGoalServiceTestCleanup } from '@/server/services/goal/testUtils';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';
import { instantiateVerifyPlanOnStart } from '@/server/services/verify/planInstantiation';
import { driveTaskFromVerify } from '@/server/services/verify/settle';

import { runNativeClosureFixture } from './businessClosure.native';

const m = vi.hoisted(() => ({ exec: vi.fn(), generate: vi.fn() }));
// Only external execution/judging/notification transports are replaced. Goal,
// Task, binding, lifecycle, acceptance decisions and round storage are real.
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent: m.exec, interruptTask: vi.fn().mockResolvedValue({ success: true }) };
  }),
}));
vi.mock('@/server/services/verify/goalReview', () => ({
  reviewGoalDelivery: vi.fn().mockResolvedValue({
    feedback: 'Synthetic fixture verdict',
    predictionIds: [],
    status: 'passed',
  }),
}));
vi.mock('@/server/services/verify/planGenerator', () => ({
  VerifyPlanGeneratorService: vi.fn(function () {
    return { generateDraftPlan: m.generate };
  }),
}));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));
// A prose wrap-up is another model operation, not part of this fixture's scope.
vi.mock('@/server/services/goal/reportService', () => ({
  GoalReportService: vi.fn(function () {
    return { dispatchIfDue: vi.fn() };
  }),
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));
vi.mock('@/server/services/acceptanceReview/events', () => ({ notifyAcceptance: vi.fn() }));

const db = await getTestDB();
const userId = 'task-goal-business-closure-owner';
registerGoalServiceTestCleanup(db, userId);

const fixturePlan: VerifyCheckItem[] = [
  {
    id: 'fixture-delivery',
    index: 0,
    onFail: 'manual',
    required: true,
    title: 'The owner receives the requested report with evidence',
    verifierConfig: { expected: 'Requested content and its evidence are available' },
    verifierType: 'program',
  },
];

describe('Task/Goal delivery and owner rework (provider-free integration)', () => {
  it('keeps dependencies, responsible owner, frozen criteria and both delivery attempts connected', async () => {
    await db
      .insert(agents)
      .values({ id: 'agt_closure_pi', model: 'fixture', provider: 'pi', userId });
    const service = new GoalService(db, userId);
    const taskModel = new TaskModel(db, userId);
    const topicModel = new TaskTopicModel(db, userId);
    const opModel = new AgentOperationModel(db, userId);
    const runModel = new VerifyRunModel(db, userId);
    const acceptanceModel = new AcceptanceModel(db, userId);
    const acceptanceService = new AcceptanceService(db, userId);
    const dispatched: { operationId: string; prompt: string; taskId: string; topicId: string }[] =
      [];
    m.generate.mockRejectedValue(new Error('No model calls are permitted in this fixture'));
    m.exec.mockImplementation(async (params) => {
      expect(params.taskId).toBeTruthy();
      const task = (await taskModel.findById(params.taskId))!;
      expect(task.assigneeUserId).toBe(userId);
      const topicId = `tpc_${randomUUID()}`;
      const operationId = `op_${randomUUID()}`;
      await db.insert(topics).values({ agentId: params.agentId, id: topicId, userId });
      await opModel.recordStart({ agentId: params.agentId, operationId, taskId: task.id, topicId });
      await params.onOperationCreated(operationId);
      await runNativeClosureFixture({ operationId, prompt: params.prompt, taskId: task.id });
      dispatched.push({ operationId, prompt: params.prompt, taskId: task.id, topicId });
      const acceptance = (await acceptanceModel.findBySubject('task', task.id))!;
      const previous = await runModel.listByAcceptance(acceptance.id);
      let run;
      if (previous.length) {
        // Production rework reuses the existing confirmed contract, not a new
        // plan written by the builder to make its own delivery pass.
        await instantiateVerifyPlanOnStart(db, userId, { operationId, taskId: task.id });
        run = (await runModel.findByOperation(operationId))!;
      } else {
        run = await runModel.create({
          operationId,
          plan: fixturePlan,
          planConfirmedAt: new Date(),
          status: 'verifying',
        });
        run = await acceptanceService.attachPolicyRun(run.id, acceptance.id);
      }
      await opModel.recordCompletion(operationId, { status: 'done' });
      await new TaskLifecycleService(db, userId).onTopicComplete({
        operationId,
        reason: 'done',
        runTrigger: 'goal',
        taskId: task.id,
        taskIdentifier: task.identifier,
        topicId,
      });
      // End of execution is NOT proof of a passed delivery.
      expect((await taskModel.findById(task.id))?.status).toBe('running');
      for (const item of run.plan ?? []) {
        await new VerifyCheckResultModel(db, userId).create({
          checkItemId: item.id,
          checkItemTitle: item.title,
          operationId,
          required: true,
          status: 'passed',
          verdict: 'passed',
          verifierType: 'program',
          verifyRunId: run.id,
        });
      }
      // Explicit synthetic judge outcome: not a real-model acceptance claim.
      await runModel.updateStatus(run.id, 'passed');
      await acceptanceService.recomputeStatus(acceptance.id);
      await driveTaskFromVerify(db, userId, operationId);
      expect((await taskModel.findById(task.id))?.status).toBe('completed');
      expect((await acceptanceModel.findById(acceptance.id))?.status).toBe('delivered');
      return { operationId, success: true, topicId };
    });

    const graph = await service.create({
      agentId: 'agt_closure_pi',
      requirement: 'Deliver a source-backed report and an independently inspectable final result.',
      tasks: ['Collect sources', { dependsOn: ['Collect sources'], title: 'Write report' }],
      title: 'Owner-directed report workflow',
    });
    const first = await service.tick(graph.goal.id);
    expect(
      (await service.graph(graph.goal.id)).nodes.find((n) => n.title === 'Write report')?.taskId,
    ).toBeNull();
    expect(dispatched).toHaveLength(0);
    const reachAchieved = async () => {
      for (let tick = 0; tick < 20; tick++) {
        const result = await service.tick(graph.goal.id);
        if (result.outcome === 'achieved') return;
      }
      throw new Error('Goal did not converge within the bounded fixture');
    };
    await reachAchieved();
    expect(dispatched).toHaveLength(3);
    expect(dispatched[0].taskId).toBe(first.taskId);
    const achieved = await service.graph(graph.goal.id);
    const terminal = achieved.nodes.find((n) => n.title === GOAL_ACCEPTANCE_TASK_TITLE)!;
    const taskId = terminal.taskId!;
    const acceptance = (await acceptanceModel.findBySubject('task', taskId))!;
    const originalRound = (await runModel.listByAcceptance(acceptance.id))[0];
    const originalRequirement = acceptance.requirement;
    const ownerComment = 'Add a day-one action list, keeping the original sources and evidence.';
    const rejected = await acceptanceService.reject(acceptance.id, ownerComment);
    expect(rejected.status).toBe('rejected');
    const handoff = await dispatchAcceptanceRepair(
      { serverDB: db, userId } as Parameters<typeof dispatchAcceptanceRepair>[0],
      acceptanceService,
      rejected,
      ownerComment,
    );
    expect(handoff).toEqual({ dispatched: false, reason: 'goal_coordinator' });
    expect((await service.graph(graph.goal.id)).goal.status).toBe('running');
    expect(await taskModel.findById(taskId)).toMatchObject({
      assigneeAgentId: 'agt_closure_pi',
      assigneeUserId: userId,
      status: 'backlog',
    });
    await reachAchieved();
    expect(dispatched).toHaveLength(4);
    expect(dispatched[3].taskId).toBe(taskId);
    expect(dispatched[3].prompt).toContain(ownerComment);
    expect(dispatched[3].operationId).not.toBe(dispatched[2].operationId);
    const rounds = await runModel.listByAcceptance(acceptance.id);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({ id: originalRound.id, userDecision: 'reject' });
    expect(rounds[0].decisionDetail?.comment).toBe(ownerComment);
    // The acceptance union keys materialized criteria by sourceCriterionId.
    // Local snapshot item ids may change; the criteria and their meaning may not.
    const contract = (plan: VerifyCheckItem[] | null) =>
      (plan ?? []).map((item) => ({
        ...item,
        id: item.sourceCriterionId ?? item.id,
      }));
    expect(contract(rounds[1].plan)).toEqual(contract(originalRound.plan));
    expect((await acceptanceModel.findById(acceptance.id))?.requirement).toBe(originalRequirement);
    const attempts = await topicModel.findByTaskId(taskId);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.status === 'completed')).toBe(true);
    expect(new Set(attempts.map((attempt) => attempt.operationId)).size).toBe(2);
    // Delivered and independently verified still awaits the owner's acceptance.
    expect((await acceptanceModel.findById(acceptance.id))?.status).toBe('delivered');
    await acceptanceService.accept(acceptance.id, 'The changes meet the request.');
    expect((await acceptanceModel.findById(acceptance.id))?.status).toBe('accepted');
    expect(m.generate).not.toHaveBeenCalled();
  }, 120_000);
});
