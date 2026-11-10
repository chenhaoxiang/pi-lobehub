import { describe, expect, it } from 'vitest';

import { resolveAskUserAnswers, resolveQuestionAnswerLabels } from './result';

describe('resolveAskUserAnswers', () => {
  it('shows exact-choice labels without changing the stored native answer ids or raw text', () => {
    const question = {
      header: 'Pi',
      question: 'Choose',
      options: [{ id: 'pi-option-0', label: '保留 Pi' }],
    };
    expect(resolveQuestionAnswerLabels(question, 'pi-option-0')).toEqual(['保留 Pi']);
    expect(resolveQuestionAnswerLabels(question, ['pi-option-0', 'custom'])).toEqual([
      '保留 Pi',
      'custom',
    ]);
    expect(resolveQuestionAnswerLabels(question, '')).toEqual(['']);
    expect(resolveQuestionAnswerLabels(question, undefined)).toEqual([]);
  });
  it('prefers the structured answers persisted in plugin state', () => {
    expect(
      resolveAskUserAnswers(
        {
          askUserAnswers: {
            Scope: ['Chat', 'Settings'],
            __supplement__: 'Keep the existing behavior.',
          },
        },
        'User submitted: {"Scope":"Legacy"}',
      ),
    ).toEqual({
      Scope: ['Chat', 'Settings'],
      __supplement__: 'Keep the existing behavior.',
    });
  });

  it('recovers answers from legacy builtin tool result content', () => {
    expect(
      resolveAskUserAnswers(
        undefined,
        'User submitted: {"Which direction?":"Visual polish","Surfaces":["Chat","Settings"],"__supplement__":"Keep the existing behavior."}',
      ),
    ).toEqual({
      'Which direction?': 'Visual polish',
      'Surfaces': ['Chat', 'Settings'],
      '__supplement__': 'Keep the existing behavior.',
    });
  });

  it('ignores malformed or unsupported answer payloads', () => {
    expect(resolveAskUserAnswers(undefined, 'User submitted: not-json')).toBeUndefined();
    expect(resolveAskUserAnswers(undefined, 'Question(s) presented to the user.')).toBeUndefined();
    expect(resolveAskUserAnswers({ askUserAnswers: { Scope: 42 } as any }, '')).toBeUndefined();
  });
});
