/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAskUserForm } from './useAskUserForm';

afterEach(() => vi.useRealTimers());

describe('explicit-answer runtime dialogs', () => {
  it('exposes exact choices only and rejects custom/notes mutation', () => {
    const submit = vi.fn();
    const question = { header: 'Pi select', question: 'Choose', options: [{ id: 'one', label: 'A' }] };
    const hook = renderHook(() => useAskUserForm({ args: { answerMode: 'exact-choice', questions: [question] }, persistedDraft: undefined, onInteractionAction: submit, writeDraft: vi.fn() }));
    expect(hook.result.current.allowCustomAnswer).toBe(false);
    act(() => hook.result.current.handleCustomChange(question, 'not offered'));
    act(() => hook.result.current.handleSupplementTextChange('not accepted'));
    expect(hook.result.current.custom).toEqual({});
    expect(hook.result.current.isSubmitDisabled).toBe(true);
    act(() => hook.result.current.handleToggle(question, 'one'));
    act(() => hook.result.current.handleSubmit());
    expect(submit).toHaveBeenCalledWith({ type: 'submit', payload: { Choose: 'one' } });
    hook.unmount();
  });

  it.each(['  leading\\ntrailing\\n', ''])('preserves raw editor prefill and valid empty input %j', (value) => {
    const submit = vi.fn();
    const hook = renderHook(() => useAskUserForm({ args: { answerMode: 'text', textPrefill: value, questions: [{ header: 'Pi editor', question: 'Edit', options: [] }] }, persistedDraft: undefined, onInteractionAction: submit, writeDraft: vi.fn() }));
    expect(hook.result.current.custom.Edit).toBe(value);
    expect(hook.result.current.isSubmitDisabled).toBe(false);
    act(() => hook.result.current.handleSubmit());
    expect(submit).toHaveBeenCalledWith({ type: 'submit', payload: { Edit: value } });
    hook.unmount();
  });
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
      persistedDraft: undefined,
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
