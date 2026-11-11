/** @vitest-environment happy-dom */
import type { TaskEngineeringSnapshot } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { taskService } from '@/services/task';
import { initialState } from '@/store/task/initialState';
import { useTaskStore } from '@/store/task/store';

import { taskEngineeringResource } from './projection';

const sample = (taskId: string): TaskEngineeringSnapshot => ({
  taskId,
  source: 'existing-scm-and-acceptance-links',
  observedAt: 1000,
  gate: 'not-observed',
  prLimit: 8,
  checkLimit: 20,
  pullRequests: [],
  truncated: false,
});
let scope = '';
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, errorRetryCount: 0, provider: () => new Map() } },
    children,
  );
const useEngineering = (id: string | undefined, enabled = true) =>
  useTaskStore((s) => s.useFetchTaskEngineering)(id, enabled);
beforeEach(() => {
  scope = `engineering-${Math.random()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  act(() => useTaskStore.setState({ ...initialState }));
});
afterEach(() => vi.restoreAllMocks());

describe('explicit Task engineering observation replica', () => {
  it('does not read while closed, without identity or without a task, and stays memory-only', () => {
    const read = vi.spyOn(taskService, 'getEngineering');
    renderHook(() => useEngineering('task-a', false), { wrapper });
    renderHook(() => useEngineering(undefined), { wrapper });
    expect(read).not.toHaveBeenCalled();
    expect(taskEngineeringResource.storage).toBeUndefined();
  });

  it('distinguishes first error from a settled empty observation and retries read-only', async () => {
    const read = vi
      .spyOn(taskService, 'getEngineering')
      .mockRejectedValueOnce(new Error('source unavailable'))
      .mockResolvedValue(sample('task-a'));
    const { result } = renderHook(() => useEngineering('task-a'), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(useTaskStore.getState().taskEngineeringMap['task-a']).toBeUndefined();
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() =>
      expect(useTaskStore.getState().taskEngineeringMap['task-a']?.pullRequests).toEqual([]),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('preserves a settled empty observation on a technical error', async () => {
    vi.spyOn(taskService, 'getEngineering')
      .mockResolvedValueOnce(sample('task-a'))
      .mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useEngineering('task-a'), { wrapper });
    await waitFor(() => expect(useTaskStore.getState().taskEngineeringMap['task-a']).toBeDefined());
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(useTaskStore.getState().taskEngineeringMap['task-a']?.observedAt).toBe(1000);
  });

  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'])(
    'clears a real settled replica after explicit %s denial',
    async (code) => {
      vi.spyOn(taskService, 'getEngineering')
        .mockResolvedValueOnce(sample('task-a'))
        .mockRejectedValue({ data: { code } });
      const { result } = renderHook(() => useEngineering('task-a'), { wrapper });
      await waitFor(() =>
        expect(useTaskStore.getState().taskEngineeringMap['task-a']).toBeDefined(),
      );
      await act(async () => {
        await result.current.revalidate();
      });
      await waitFor(() =>
        expect(useTaskStore.getState().taskEngineeringMap['task-a']).toBeUndefined(),
      );
    },
  );

  it('opening another task under another identity never adopts an old response', async () => {
    let resolveOld!: (value: TaskEngineeringSnapshot) => void;
    vi.spyOn(taskService, 'getEngineering').mockImplementation((id) =>
      id === 'task-a'
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(sample(id)),
    );
    const { rerender } = renderHook(({ id }) => useEngineering(id), {
      initialProps: { id: 'task-a' },
      wrapper,
    });
    await waitFor(() => expect(resolveOld).toBeDefined());
    scope = `another-${Math.random()}`;
    rerender({ id: 'task-b' });
    await waitFor(() => expect(useTaskStore.getState().taskEngineeringMap['task-b']).toBeDefined());
    await act(async () => {
      resolveOld(sample('task-a'));
    });
    expect(useTaskStore.getState().taskEngineeringMap['task-a']).toBeUndefined();
    expect(useTaskStore.getState().taskEngineeringMap['task-b']?.taskId).toBe('task-b');
  });
});
