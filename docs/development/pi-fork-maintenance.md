---
doc_type: runbook
project: workspace
owner_repository: chenhaoxiang/pi-lobehub
status: active
truth_mode: maintained
created: 2026-11-10
verified: 2026-11-11
verification_scope: 维护分支、工作流隔离与 P3 范围 CI 的源码/本地检查；不代表发布或真实模型业务验收
---

# Pi LobeHub fork maintenance

## Source and branches

`chenhaoxiang/pi-lobehub` maintains a fork of `lobehub/lobehub`. Our `main` is a
reviewed integration branch, not upstream's release branch. `upstream/canary`
is the community development input; `upstream/main` is its release input.
The initial fork source is `01665ddf425ff824b554993115e969c51bd1f4c5`.

Keep `origin` on this fork and upstream's push URL `DISABLED`. Refresh and select
upstream changes in a dedicated worktree; review the delta and run applicable
checks before a regular-merge PR into our main. Never replace fork history,
force-push shared refs or use one-click Sync Fork. Existing tags, licence and
attribution remain intact. Physical main checkouts remain read-only.

## 2026-11-14 upstream/canary audit

The first sync audit was performed from fork `main` `cdd731c721c54274665ae8b7c4822fb8dfac5a12`
against read-only `upstream/canary` `a8424d204a7ed1eb36985ebdfa6eac8041615392`.
The common base remains `01665ddf425ff824b554993115e969c51bd1f4c5`; the fork is
47 commits ahead and 191 commits behind the community canary. A dry-run merge
was started in the dedicated `sync/upstream-canary-20261114` worktree and then
aborted without writing `main` or the remote. It exposed five semantic conflicts:

- `packages/heterogeneous-agents/src/rpc/piRpcClient.test.ts` — upstream's
  supported-version test versus the fork's maintained Pi-version/fork-version
  rejection matrix;
- `src/features/AgentGoals/ProcessControl/Graph/batchModel.ts` and
  `BatchGroups.tsx` — upstream's `pending/held/accepted` batch phase model versus
  the fork's `unknown/waiting` and existing acceptance presentation;
- `src/features/AgentTasks/AgentTaskDetail/TaskDetailSections.tsx` — upstream
  layout versus the fork's Task Engineering and scoped current-usage sections;
- `src/features/GlobalApprovalNotification/index.tsx` — upstream goal-island
  changes versus the fork's task-input and dismissal handling.

The delta is broad: 2,893 changed paths on each side of the shared base, including
Goal/Task/Verify, Pi RPC, CLI, database, desktop, workflows and SPA state. The
first wave must therefore be selective rather than a blind 191-commit merge.
Candidate review order is: (1) server/runtime correctness fixes that preserve the
fork's Goal/Task/Verify/Pi contracts; (2) narrowly related CLI and Web fixes with
focused tests; (3) unrelated channels, music, LobeBench and desktop features only
when explicitly selected. `.github` workflow/release changes remain excluded from
an upstream merge unless the fork contract is audited separately; upstream Actions
must not be enabled by synchronization.

The audit is not a sync completion, release, installation or production result.
A later sync PR must bind the selected commit set, conflict decisions, affected
checks and a fresh fork-contract/task-goal-closure result before changing `main`.

## 2026-11-14 core execution/task wave

The first selective candidate wave is `sync/upstream-core-wave-20261114` and
contains six upstream fixes, cherry-picked in dependency order:

- `5c81da51a746` — tell Goal planning which Tasks already passed verification;
- `211e7466e2c5` — settle a Goal stranded on a planning turn that never ran;
- `580c3e82097e` — settle an Agent Runtime operation whose first step failed to dispatch;
- `976b02dff59e` — classify mid-stream provider socket drops as interruption;
- `1c4ee6ba2fc1` — remove the non-existent CLI Task `pending` status;
- `408c7d60438d` — keep the Goal supervision panel bound to its record.

The wave deliberately excludes the larger batch/acceptance UI changes (`2e8ad9ff70`,
`0003e726ea`) because they conflict with the fork's existing `unknown/waiting`
and Acceptance presentation, and excludes the broad Verify replica refactors,
Router refactors, Channels, Desktop, Music, LobeBench, provider and workflow
changes. No upstream workflow or release automation is enabled or merged.

Conflict resolution kept the upstream GoalChatProvider reconnect/bound-topic fix
and its tests. The five-file dry-run conflict set is otherwise not silently
resolved in this wave. The candidate's narrow validation currently records 37
selected tests passing, full TypeScript type-check passing, and changed-file lint
with one existing `set-state-in-effect` warning. The full lifecycle file has one
pre-existing archive-order assertion failure reproduced on both the candidate and
clean `origin/main`; it is not claimed as a green new sync signal and remains a
separate follow-up. The candidate is not `main` until its exact PR checks pass.

## 2026-11-15 Batch/Acceptance UI wave

The second selective wave is limited to two upstream changes:

- `2e8ad9ff70e8` — distinguish a gate-held batch round as `held`/waiting for
  release instead of in progress;
- `0003e726ea34` — mark an accepted delivery on batch squares and the Task
  Acceptance checklist title.

The conflict resolution deliberately preserves fork semantics: `unknown` and
`waiting` remain distinct from `held`, Task Engineering and Current Usage are
not removed, and the task-input/goal-dismissal island remains authoritative in
this fork. The upstream Verify replica refactor and the broader Task detail
layout/project picker are excluded because they require additional dependent
commits and would otherwise create an unreviewed state-layer migration.

The wave currently has 31 batch-model tests and 50 Batch/Acceptance/island tests
passing, full TypeScript type-check passing, and changed-file lint with one
existing `set-state-in-effect` warning. It is still a candidate PR until the
fork-contract and task-goal-closure checks pass.

## Workflow boundary

Every inherited workflow job is restricted to the exact upstream repository.
This includes publishing, production deploys, generated-content pushes, automatic
fork synchronization, previews and the original broad test matrix. The original
conditions remain conjunctive inside that owner restriction.

`pi-fork-check.yml` is the fork's only enabled validation workflow. Its original
`fork-contract` job uses isolated tools for provider-free workflow/RPC checks.
P3 adds `task-goal-closure`: root-workspace installation without lifecycle
scripts, scoped server/UI/database regressions, and application/new-test types.
Neither job borrows repository secrets, installs the standalone CLI, publishes
artifacts or proves production/business-model acceptance. The upstream root
still has no lockfile; this registry installation is not an immutable build.
Required check names are bound only after their exact-head runs exist and pass.

To verify locally without executing dependency lifecycle scripts:

```sh
npm install --ignore-scripts --no-audit --no-fund --prefix tmp/fork-ci-tools yaml@2.9.0
NODE_PATH="$PWD/tmp/fork-ci-tools/node_modules" node --test .github/scripts/forkWorkflowPolicy.test.mjs
NODE_PATH="$PWD/tmp/fork-ci-tools/node_modules" node .github/scripts/forkWorkflowPolicy.mjs
```

The policy tests reject a missing workflow/job guard, a guard bypassed by `||`,
broadened validation events, write permissions and repository secrets in the
validation workflow. Changes to the validation's actual commands still need
normal independent review; this is not a general shell security analyser.

Keep repository Actions disabled until the owner-guarded workflows have landed
on main through the bootstrap PR. Only then enable repository Actions, disable
the inherited workflow entries at the platform, and dispatch the reviewed fork
check. The source owner guards fence effects during workflow registration and
remain a second boundary against later accidental enablement. Do not configure upstream app credentials,
registry identity, signing keys, update channels or production endpoints.

## Toolchain and installation

Use the version in `packageManager` and retain the workspace configuration. The
upstream root deliberately has no lockfile; do not claim a registry install is
fully immutable or silently alter the upstream dependency policy as bootstrap.

On macOS, pnpm's auto-version launcher can hit `ENOEXEC` on the official
shebang-less shell entry if the native installer was skipped. A per-process
invocation of that version's shell entry with
`npm_config_manage_package_manager_versions=false` preserves the selected version
without editing global tooling or allowing project lifecycle scripts. Verify
`--version` in the target worktree before install.

## Delivery and scope

Follow [the single change](../../openspec/changes/adopt-pi-workspace/proposal.md)
and its task evidence. Shared changes use independent read-only review, exact
head validation and normal PR merge; self-review is not independent review.
Deployment, release assets, package publication, app installation and source
merge are distinct stages. No published version is created by this bootstrap.
Do not remove Desk or reload active Pi merely because fork setup succeeds.
