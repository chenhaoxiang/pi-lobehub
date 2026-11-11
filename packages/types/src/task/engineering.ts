import type { ScmChangeRequestState, ScmCiStatus } from '../scm';

/** Closed read projection of an existing provider record, not an owner acceptance. */
export interface TaskEngineeringCheck {
  appId?: string;
  conclusion?: string;
  name: string;
  status: string;
}

export interface TaskEngineeringPullRequest {
  binding: 'acceptance' | 'task';
  checks: TaskEngineeringCheck[];
  checksTruncated: boolean;
  ciHeadSha: string | null;
  ciStatus: ScmCiStatus;
  headSha: string | null;
  number: number;
  recordedAt: string | null;
  recordedCheckCount: number;
  repository: string;
  source: 'manual-link' | 'scm-provider-record';
  state: ScmChangeRequestState | null;
  url: string;
}

/** A bounded original owner observation, never an acceptance/merge permission. */
export type TaskEngineeringOwnerObservation =
  | { status: 'unavailable'; reason: 'binding-mismatch' | 'not-configured' | 'source-unavailable' }
  | {
      status: 'observed';
      source: 'pi-vista-original-reader';
      sourceType: 'owner-gate' | 'repository-review';
      scope: 'source-shared-delivery-only';
      authorization: 'none';
      readOnly: true;
      repository: string;
      pullRequest: number;
      headSha: string;
      observedAt: number;
      phase: string;
      waitReason: string;
      nextAction: string;
    };

export interface TaskEngineeringSnapshot {
  checkLimit: number;
  /** A source observation may include waiting/failure; it is never Task acceptance. */
  gate: 'not-observed' | 'source-observed';
  observedAt: number;
  ownerObservation?: TaskEngineeringOwnerObservation;
  prLimit: number;
  pullRequests: TaskEngineeringPullRequest[];
  source: 'existing-scm-and-acceptance-links';
  taskId: string;
  truncated: boolean;
}
