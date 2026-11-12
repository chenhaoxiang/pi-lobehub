// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, publishJSON } = vi.hoisted(() => ({
  env: { enableQueueAgentRuntime: true },
  publishJSON: vi.fn().mockResolvedValue({ messageId: 'message-local' }),
}));

vi.mock('@/envs/app', () => ({ appEnv: env }));
vi.mock('@/libs/qstash', () => ({ qstashClient: { publishJSON } }));

const advance = { goalId: 'goal_local', userId: 'user_local' };

describe('createGoalSchedulerModule callback address', () => {
  beforeEach(() => {
    vi.resetModules();
    publishJSON.mockClear();
    env.enableQueueAgentRuntime = true;
    vi.stubEnv('APP_URL', 'http://localhost:27173');
    vi.stubEnv('AGENT_RUNTIME_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('delivers queue callbacks to the configured runtime instead of the browser localhost', async () => {
    vi.stubEnv('AGENT_RUNTIME_BASE_URL', 'http://host.docker.internal:27173/');
    const { createGoalSchedulerModule } = await import('./index');

    await createGoalSchedulerModule().scheduleAdvance(advance);

    expect(publishJSON.mock.calls[0][0].url).toBe(
      'http://host.docker.internal:27173/api/workflows/goal/advance',
    );
  });

  it('uses APP_URL when the runtime callback address is not overridden', async () => {
    const { createGoalSchedulerModule } = await import('./index');

    await createGoalSchedulerModule().scheduleAdvance(advance);

    expect(publishJSON.mock.calls[0][0].url).toBe(
      'http://localhost:27173/api/workflows/goal/advance',
    );
  });

  it('can use the runtime address without a browser APP_URL', async () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('AGENT_RUNTIME_BASE_URL', 'https://runtime.example.test');
    const { createGoalSchedulerModule } = await import('./index');

    await createGoalSchedulerModule().scheduleAdvance(advance);

    expect(publishJSON.mock.calls[0][0].url).toBe(
      'https://runtime.example.test/api/workflows/goal/advance',
    );
  });

  it('refuses queue scheduling with neither callback address configured', async () => {
    vi.stubEnv('APP_URL', '');
    const { createGoalSchedulerModule } = await import('./index');

    expect(() => createGoalSchedulerModule()).toThrow(/APP_URL/);
    expect(publishJSON).not.toHaveBeenCalled();
  });

  it('keeps the in-process scheduler singleton without requiring a queue address', async () => {
    env.enableQueueAgentRuntime = false;
    vi.stubEnv('APP_URL', '');
    const { createGoalSchedulerModule, LocalGoalScheduler } = await import('./index');
    const scheduler = createGoalSchedulerModule();

    expect(scheduler).toBeInstanceOf(LocalGoalScheduler);
    expect(createGoalSchedulerModule()).toBe(scheduler);
    expect(publishJSON).not.toHaveBeenCalled();
  });
});
