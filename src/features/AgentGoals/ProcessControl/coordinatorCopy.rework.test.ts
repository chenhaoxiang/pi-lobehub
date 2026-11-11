import { describe, expect, it } from 'vitest';

import { gateAnswerProblem, goalGateCategory } from '../GoalDecision/mapping';
import { coordinatorGateKind, coordinatorReasonCopy, gateOptionLabelKey } from './coordinatorCopy';

const option = { effect: 'retry' as const, id: 'confirm_rework_scope', label: 'Scope confirmed' };

describe('owner rework scope copy', () => {
  it('uses coordinator translations rather than treating the gate as an agent-authored question', () => {
    expect(coordinatorGateKind({ options: [option] })).toBe('reworkScope');
    expect(goalGateCategory({ options: [option] })).toBe('reworkScope');
    expect(gateOptionLabelKey(option)).toBe('goalProcess.gate.option.confirmReworkScope');
  });

  it('extracts task identity and the affected list as localization parameters, not ownership', () => {
    expect(
      coordinatorReasonCopy(
        'Confirm the rework scope for T-3. First arrange which downstream Tasks must be reworked or may be reused.\nT-4 — 整理报告 (completed)',
      ),
    ).toEqual({
      key: 'goalProcess.gate.reworkScopeQuestion',
      params: { task: 'T-3', tasks: 'T-4 — 整理报告 (completed)' },
    });
  });

  it('requires a scope note instead of offering an apparently optional continuation', () => {
    expect(gateAnswerProblem({ optionId: option.id })).toBe('scopeRequired');
    expect(gateAnswerProblem({ optionId: option.id, resolution: '  ' })).toBe('scopeRequired');
    expect(
      gateAnswerProblem({ optionId: option.id, resolution: '保留来源，报告重新交付' }),
    ).toBeUndefined();
  });
});
