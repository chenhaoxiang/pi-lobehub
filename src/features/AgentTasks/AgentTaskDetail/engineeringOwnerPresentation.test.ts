import type { TaskEngineeringOwnerObservation } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  engineeringOwnerPhaseKey,
  engineeringOwnerReasonKey,
} from './engineeringOwnerPresentation';

const source = (phase: string): TaskEngineeringOwnerObservation => ({
  status: 'observed',
  source: 'pi-vista-original-reader',
  sourceType: 'repository-review',
  scope: 'source-shared-delivery-only',
  authorization: 'none',
  readOnly: true,
  repository: 'fixture/public',
  pullRequest: 1,
  headSha: 'a'.repeat(40),
  observedAt: 1000,
  phase,
  waitReason: 'none',
  nextAction: 'inspect_result',
});
describe('owner source phase is a display projection only', () => {
  it.each(['pull-request', 'head-checks', 'owner-gate', 'postmerge-checks', 'source-delivery'])(
    'labels original %s without an accepted Task state',
    (phase) => {
      expect(engineeringOwnerPhaseKey(source(phase))).toBe(
        'taskDetail.engineering.owner.phase.' + phase,
      );
      expect(engineeringOwnerPhaseKey(source(phase))).not.toContain('accepted');
    },
  );
  it.each([
    'pr_not_ready',
    'required_checks_pending',
    'required_checks_failed',
    'required_checks_missing',
    'owner_delivery_pending',
    'postmerge_workflows_pending',
    'postmerge_workflows_failed',
    'postmerge_workflows_missing',
    'owner_gate_unavailable',
    'source_binding_mismatch',
    'source_original_unavailable',
  ])('labels original %s without creating an approval request', (reason) => {
    expect(
      engineeringOwnerReasonKey({
        ...source('owner-gate'),
        status: 'observed',
        waitReason: reason,
      } as TaskEngineeringOwnerObservation),
    ).toBe('taskDetail.engineering.owner.reason.' + reason);
  });
  it('labels no wait and keeps unknown reasons unknown', () => {
    expect(engineeringOwnerReasonKey(source('source-delivery'))).toBe(
      'taskDetail.engineering.owner.noWait',
    );
    expect(
      engineeringOwnerReasonKey({
        ...source('unknown'),
        status: 'observed',
        waitReason: 'future_reason',
      } as TaskEngineeringOwnerObservation),
    ).toBe('taskDetail.engineering.owner.phase.unknown');
  });
  it('keeps unavailable and unknown future phases unknown', () => {
    expect(engineeringOwnerPhaseKey({ status: 'unavailable', reason: 'source-unavailable' })).toBe(
      'taskDetail.engineering.owner.phase.unknown',
    );
    expect(engineeringOwnerPhaseKey(source('new-owner-phase'))).toBe(
      'taskDetail.engineering.owner.phase.unknown',
    );
  });
});
