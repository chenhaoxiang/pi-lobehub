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

export interface TaskEngineeringSnapshot {
  checkLimit: number;
  /** No prepared owner Gate readback has been connected by this read. */
  gate: 'not-observed';
  observedAt: number;
  prLimit: number;
  pullRequests: TaskEngineeringPullRequest[];
  source: 'existing-scm-and-acceptance-links';
  taskId: string;
  truncated: boolean;
}
