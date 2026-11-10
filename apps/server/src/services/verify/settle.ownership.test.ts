import { beforeEach, describe, expect, it, vi } from 'vitest';

import { driveTaskFromVerify } from './settle';

const m = vi.hoisted(() => ({
  attach: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  deliver: vi.fn(),
  findTask: vi.fn(),
  pause: vi.fn(),
  resolveAcceptance: vi.fn(),
  review: vi.fn(),
  superseded: vi.fn(),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { claimTaskDrive: m.claim, findByOperation: async () => round };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: async () => ({ id: 'op-old', taskId: 'task-1', topicId: 'topic-old' }) };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return { findById: m.findTask, updateStatus: m.pause };
  }),
}));
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return { isSupersededOperation: m.superseded };
  }),
}));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask: async () => undefined };
  }),
}));
vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(function () {
    return { updateStatus: m.complete };
  }),
}));
vi.mock('@/server/services/taskResultBridge', () => ({
  TaskResultBridgeService: vi.fn(function () {
    return { deliver: m.deliver };
  }),
}));
vi.mock('./taskAcceptance', () => ({
  resolveTaskAcceptance: m.resolveAcceptance,
  attachTaskRunToAcceptance: m.attach,
}));
vi.mock('./acceptanceService', () => ({ AcceptanceService: vi.fn() }));
vi.mock('./goalReview', () => ({ reviewGoalDelivery: m.review }));
vi.mock('./repairService', () => ({ maybeAutoRepair: vi.fn(), repairRejectedReview: vi.fn() }));
vi.mock('./reporter', () => ({ VerifyReporterService: vi.fn() }));
vi.mock('./statusService', () => ({ VerifyStatusService: vi.fn() }));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));

let round: Record<string, unknown>;
const db = {} as any;
const task = { currentTopicId: 'topic-old', id: 'task-1', identifier: 'T-1', status: 'running' };

beforeEach(() => {
  vi.clearAllMocks();
  round = { acceptanceId: 'acceptance-1', id: 'round-old', status: 'passed' };
  m.claim.mockResolvedValue(true);
  m.findTask.mockResolvedValue({ ...task });
  m.review.mockResolvedValue(undefined);
  m.superseded.mockResolvedValue(false);
});

const expectNoTaskEffects = () => {
  expect(m.complete).not.toHaveBeenCalled();
  expect(m.pause).not.toHaveBeenCalled();
  expect(m.deliver).not.toHaveBeenCalled();
};

describe('Verify owns only its current Task attempt', () => {
  it.each(['passed', 'failed', 'errored'])(
    'does not let an old %s verdict settle a newer topic',
    async (status) => {
      round.status = status;
      m.findTask.mockResolvedValue({ ...task, currentTopicId: 'topic-new' });
      await driveTaskFromVerify(db, 'owner', 'op-old');
      expectNoTaskEffects();
      expect(m.review).not.toHaveBeenCalled();
      expect(m.claim).not.toHaveBeenCalled();
    },
  );

  it('does not let a replaced operation settle a new continuation in the same topic', async () => {
    m.superseded.mockResolvedValue(true);
    await driveTaskFromVerify(db, 'owner', 'op-old');
    expectNoTaskEffects();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it('does not replay a rejected round over the owner’s request for rework', async () => {
    round.userDecision = 'reject';
    await driveTaskFromVerify(db, 'owner', 'op-old');
    expectNoTaskEffects();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it('rechecks ownership after an asynchronous review before touching the Task', async () => {
    m.review.mockImplementation(async () => {
      m.findTask.mockResolvedValue({ ...task, currentTopicId: 'topic-new' });
      return undefined;
    });
    await driveTaskFromVerify(db, 'owner', 'op-old');
    expectNoTaskEffects();
  });

  it('keeps a failed ownership lookup retryable instead of marking the Task driven', async () => {
    m.superseded.mockRejectedValueOnce(new Error('database temporarily unavailable'));
    await driveTaskFromVerify(db, 'owner', 'op-old');
    expectNoTaskEffects();
    expect(m.claim).not.toHaveBeenCalled();
  });

  it('still completes the current attempt and emits its exact operation identity', async () => {
    await driveTaskFromVerify(db, 'owner', 'op-old');
    expect(m.complete).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
    expect(m.deliver).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-old' }));
  });
});
