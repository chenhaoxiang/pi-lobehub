/** @vitest-environment happy-dom */
import type { TaskCurrentUsage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { taskService } from '@/services/task';
import { initialState } from '@/store/task/initialState';
import { useTaskStore } from '@/store/task/store';

import { taskCurrentUsageResource } from './projection';

const sample = (taskId: string): TaskCurrentUsage => ({
  taskId,
  operationId: `op-${taskId}`,
  topicId: `topic-${taskId}`,
  source: 'current-operation-messages',
  coverage: 'partial',
  observedAt: 1000,
  observedMessages: 1,
  measuredMessages: 1,
  messageLimit: 500,
  tokens: { input: 12, output: 3, cacheRead: 7, cacheWrite: 2 },
  totalTokens: 24,
  truncated: false,
  reasons: ['not-a-bill', 'auxiliary-usage-not-covered'],
});
let scope = '';
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    {
      value: { dedupingInterval: 0, errorRetryCount: 0, provider: () => new Map() },
    },
    children,
  );
const useUsage = (id: string | undefined, login = true) =>
  useTaskStore((s) => s.useFetchCurrentTaskUsage)(id, login, false);

beforeEach(() => {
  scope = `usage-user-${Math.random()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  act(() => useTaskStore.setState({ ...initialState }));
});
afterEach(() => vi.restoreAllMocks());

describe('current-task usage original-source replica', () => {
  it('is memory-only and disabled with no task or no login', () => {
    const fetch = vi.spyOn(taskService, 'getCurrentUsage');
    renderHook(() => useUsage(undefined), { wrapper });
    renderHook(() => useUsage('task-a', false), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
    expect(taskCurrentUsageResource.storage).toBeUndefined();
  });

  it('keeps first failure distinct from unknown or measured-zero telemetry and retries', async () => {
    vi.spyOn(taskService, 'getCurrentUsage')
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(sample('task-a'));
    const { result } = renderHook(() => useUsage('task-a'), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(useTaskStore.getState().taskCurrentUsageMap['task-a']).toBeUndefined();
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() =>
      expect(useTaskStore.getState().taskCurrentUsageMap['task-a']?.tokens.input).toBe(12),
    );
  });

  it('retains last observed records on a background failure and removes inaccessible records', async () => {
    const fetch = vi
      .spyOn(taskService, 'getCurrentUsage')
      .mockResolvedValueOnce(sample('task-a'))
      .mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useUsage('task-a'), { wrapper });
    await waitFor(() =>
      expect(useTaskStore.getState().taskCurrentUsageMap['task-a']).toBeDefined(),
    );
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(useTaskStore.getState().taskCurrentUsageMap['task-a']?.observedAt).toBe(1000);
    fetch.mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() =>
      expect(useTaskStore.getState().taskCurrentUsageMap['task-a']).toBeUndefined(),
    );
  });

  it.each(['FORBIDDEN', 'UNAUTHORIZED'])(
    'removes a prior observation after an explicit %s read denial',
    async (code) => {
      const fetch = vi
        .spyOn(taskService, 'getCurrentUsage')
        .mockResolvedValueOnce(sample('task-a'))
        .mockRejectedValue({ data: { code } });
      const { result } = renderHook(() => useUsage('task-a'), { wrapper });
      await waitFor(() =>
        expect(useTaskStore.getState().taskCurrentUsageMap['task-a']).toBeDefined(),
      );
      await act(async () => {
        await result.current.revalidate();
      });
      await waitFor(() =>
        expect(useTaskStore.getState().taskCurrentUsageMap['task-a']).toBeUndefined(),
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('reconciles final usage when the Task settles and its running poll stops', async () => {
    const id = 'task_usage_end';
    const detail = {
      id,
      identifier: 'T-1',
      instruction: 'Synthetic task',
      status: 'running',
      updatedAt: '2026-11-11T00:00:00Z',
    };
    const readDetail = vi
      .spyOn(taskService, 'getDetail')
      .mockResolvedValue({ data: detail, success: true });
    const readUsage = vi.spyOn(taskService, 'getCurrentUsage').mockResolvedValue(sample(id));
    const { result } = renderHook(
      () => {
        const sync = useTaskStore((s) => s.useFetchTaskDetail)(id);
        useUsage(id);
        return sync;
      },
      { wrapper },
    );
    await waitFor(() => expect(useTaskStore.getState().taskCurrentUsageMap[id]).toBeDefined());
    await waitFor(() => expect(useTaskStore.getState().taskDetailMap[id]?.status).toBe('running'));
    readDetail.mockResolvedValue({
      data: { ...detail, status: 'completed', updatedAt: '2026-11-11T00:01:00Z' },
      success: true,
    });
    readUsage.mockResolvedValue({
      ...sample(id),
      tokens: { ...sample(id).tokens, output: 30 },
      totalTokens: 51,
    });
    const before = readUsage.mock.calls.length;
    await act(async () => {
      await result.current.mutate();
    });
    await waitFor(() => expect(readUsage.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(useTaskStore.getState().taskCurrentUsageMap[id]?.tokens.output).toBe(30),
    );
  });

  it('does not display or apply a late response under a different task or identity', async () => {
    let resolveOld!: (value: TaskCurrentUsage) => void;
    vi.spyOn(taskService, 'getCurrentUsage').mockImplementation((id) =>
      id === 'task-a'
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(sample(id)),
    );
    const { rerender } = renderHook(({ id }) => useUsage(id), {
      initialProps: { id: 'task-a' },
      wrapper,
    });
    await waitFor(() => expect(resolveOld).toBeDefined());
    scope = `another-user:${Math.random()}`;
    rerender({ id: 'task-b' });
    await waitFor(() =>
      expect(useTaskStore.getState().taskCurrentUsageMap['task-b']?.taskId).toBe('task-b'),
    );
    await act(async () => {
      resolveOld(sample('task-a'));
    });
    expect(useTaskStore.getState().taskCurrentUsageMap['task-a']).toBeUndefined();
    expect(useTaskStore.getState().taskCurrentUsageMap['task-b']?.taskId).toBe('task-b');
  });
});
