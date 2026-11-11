import type { TaskEngineeringOwnerObservation } from '@lobechat/types';

const PHASE_KEYS = {
  'pull-request': 'taskDetail.engineering.owner.phase.pull-request',
  'head-checks': 'taskDetail.engineering.owner.phase.head-checks',
  'owner-gate': 'taskDetail.engineering.owner.phase.owner-gate',
  'postmerge-checks': 'taskDetail.engineering.owner.phase.postmerge-checks',
  'source-delivery': 'taskDetail.engineering.owner.phase.source-delivery',
} as const;

const REASON_KEYS = {
  none: 'taskDetail.engineering.owner.noWait',
  pr_not_ready: 'taskDetail.engineering.owner.reason.pr_not_ready',
  required_checks_pending: 'taskDetail.engineering.owner.reason.required_checks_pending',
  required_checks_failed: 'taskDetail.engineering.owner.reason.required_checks_failed',
  required_checks_missing: 'taskDetail.engineering.owner.reason.required_checks_missing',
  owner_delivery_pending: 'taskDetail.engineering.owner.reason.owner_delivery_pending',
  postmerge_workflows_pending: 'taskDetail.engineering.owner.reason.postmerge_workflows_pending',
  postmerge_workflows_failed: 'taskDetail.engineering.owner.reason.postmerge_workflows_failed',
  postmerge_workflows_missing: 'taskDetail.engineering.owner.reason.postmerge_workflows_missing',
  owner_gate_unavailable: 'taskDetail.engineering.owner.reason.owner_gate_unavailable',
  source_binding_mismatch: 'taskDetail.engineering.owner.reason.source_binding_mismatch',
  source_original_unavailable: 'taskDetail.engineering.owner.reason.source_original_unavailable',
} as const;

export const engineeringOwnerReasonKey = (value: TaskEngineeringOwnerObservation) =>
  value.status === 'observed' && Object.hasOwn(REASON_KEYS, value.waitReason)
    ? REASON_KEYS[value.waitReason as keyof typeof REASON_KEYS]
    : 'taskDetail.engineering.owner.phase.unknown';

/** A display label only; even source-delivery cannot accept the business Task. */
export const engineeringOwnerPhaseKey = (value: TaskEngineeringOwnerObservation) =>
  value.status === 'observed' && Object.hasOwn(PHASE_KEYS, value.phase)
    ? PHASE_KEYS[value.phase as keyof typeof PHASE_KEYS]
    : 'taskDetail.engineering.owner.phase.unknown';
