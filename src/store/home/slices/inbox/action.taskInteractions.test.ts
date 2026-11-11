/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { taskService } from '@/services/task';
import { useHomeStore } from '@/store/home';

import { initialHomeInboxState } from './initialState';
import { homeTaskInteractionsResource } from './projection';
import { homeInboxSelectors } from './selectors';

const empty = { items: [], observedAt: 1000, truncated: false };
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, errorRetryCount: 0, provider: () => new Map() } },
    children,
  );
let scope = '';
beforeEach(() => {
  scope = `task-attention-${Math.random()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  act(() => useHomeStore.setState({ ...initialHomeInboxState }));
});
afterEach(() => vi.restoreAllMocks());

const useSync = (enabled = true) => useHomeStore((s) => s.useFetchPendingTaskInteractions)(enabled);

describe('task attention original-source replica', () => {
  it('is memory-only and does not read while logged out', () => {
    const fetch = vi.spyOn(taskService, 'getPendingInteractions');
    renderHook(() => useSync(false), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
    expect(homeTaskInteractionsResource.storage).toBeUndefined();
  });

  it('distinguishes first-load failure from a confirmed empty inbox and permits retry', async () => {
    const fetch = vi
      .spyOn(taskService, 'getPendingInteractions')
      .mockRejectedValueOnce(new Error('offline fixture'))
      .mockResolvedValue(empty);
    const { result } = renderHook(() => useSync(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(homeInboxSelectors.pendingTaskInteractions(useHomeStore.getState())).toBeUndefined();
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() =>
      expect(homeInboxSelectors.pendingTaskInteractions(useHomeStore.getState())).toEqual(empty),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last observed scope on a background failure but clears it on an identity switch', async () => {
    vi.spyOn(taskService, 'getPendingInteractions')
      .mockResolvedValueOnce(empty)
      .mockRejectedValue(new Error('background offline'));
    const { result, rerender } = renderHook(() => useSync(), { wrapper });
    await waitFor(() =>
      expect(homeInboxSelectors.pendingTaskInteractions(useHomeStore.getState())).toEqual(empty),
    );
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(homeInboxSelectors.pendingTaskInteractions(useHomeStore.getState())).toEqual(empty);
    scope = `different-user:${Math.random()}`;
    rerender();
    await waitFor(() =>
      expect(homeInboxSelectors.pendingTaskInteractions(useHomeStore.getState())).toBeUndefined(),
    );
  });
});
