/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAskUserForm } from './useAskUserForm';

afterEach(() => vi.useRealTimers());

describe('explicit-answer runtime dialogs', () => {
  it.each([false, true])(
    'does not auto-submit a pending text request (has draft: %s)',
    (hasDraft) => {
      vi.useFakeTimers();
      const submit = vi.fn();
      const hook = renderHook(() =>
        useAskUserForm({
          args: {
            autoSubmitOnTimeout: false,
            questions: [{ header: 'Pi input', question: 'Type a value', options: [] }],
          },
          countdownMs: 4000,
          onInteractionAction: submit,
          writeDraft: vi.fn(),
        }),
      );
      if (hasDraft)
        act(() =>
          hook.result.current.handleCustomChange(
            { header: 'Pi input', question: 'Type a value', options: [] },
            'not submitted yet',
          ),
        );
      act(() => vi.advanceTimersByTime(5000));
      expect(submit).not.toHaveBeenCalled();
      expect(hook.result.current.expired).toBe(true);
      hook.unmount();
    },
  );
});
