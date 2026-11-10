---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-lobehub
status: active
truth_mode: maintained
created: 2026-11-10
verified: 2026-11-11
verification_scope: CLI-device Pi RPC source, provider-free regressions, isolated native Pi/question-package fixture and localhost authenticated Web single/multi callbacks; not business-model, release or production acceptance
---

# Pi CLI-device RPC compatibility

This slice implements P2 of [the existing change](../../openspec/changes/adopt-pi-workspace/tasks.md).
It does not replace Pi with a renamed upstream binary, create a task/question
database or install/reload a user's active extensions.

## Versions, identity and configuration

The RPC client accepts stable Pi >= 0.80.5 and explicit maintained `-fork.N`
revisions of a supported base. A matching version is necessary, not sufficient:
`get_state` must also answer with an actual native session identity. Unsupported
versions and missing identities fail before a business prompt can run.

The CLI's existing command resolution, working directory, HOME,
`PI_CODING_AGENT_DIR`, provider/model arguments and native extension/skill arguments
remain in place. No credential/profile is copied or converted. The optional
`--effort` selector now maps to Pi's native `--thinking`; when absent, Pi keeps its
own default. Other providers' selectors and Pi's unrelated `--speed` behavior
are unchanged. The LobeHub guide remains an explicit native skill, not a fabricated
user message or replacement project rules.

Resume uses `--session <native-id>`, which requires existing context, rather than
`--session-id`, whose open-or-create behavior can silently start with no history.
A missing native session must be surfaced; a source merge does not migrate old
sessions. Operation, topic and native Pi session ids remain distinct.

## Human input and cancellation

The CLI-device server-ingest path passes its existing per-operation AskUserBridge
to the Pi RPC handle. Public `select`, `confirm`, `input` and `editor` requests
become existing durable question cards; their answer travels back to the exact
native request. `provider: pi` preserves producer identity. The `claude-code`
identifier is only the pre-existing shared question renderer key, not a claim
that Claude executed this operation.

Each visible bridge invocation has a unique tool-call correlation, even if a
broken producer reuses a native request id later. Abort, process death, timeout
and settlement release outstanding waits. Replies to a retired question are
ignored. The stdio reader does not await human input, so command ACKs, stop
confirmation and EOF remain readable while a dialog is pending. The prompt/steer/follow-up ACK budget also pauses only during the separately bounded UI wait, then resumes its remaining time; ordinary get_state and truly missing ACKs keep their deadlines. Native extension commands may not ACK until their dialog completes. Missing handlers,
invalid/off-list answers and unavailable UI cancel; they never approve by default.

Native confirm/select choices round-trip stable option ids. Their exact-choice policy hides and rejects custom text/notes; invalid payloads become cancellation before the producer emits any successful terminal ACK. Native input/editor use a raw-text policy that preserves editor prefill, whitespace, newlines and valid empty text without changing the legacy default trim behavior. All Pi question
arguments also set `autoSubmitOnTimeout: false`, preserved through durable
sanitization: neither an untouched first option nor a saved but unsubmitted text
draft becomes an answer at the legacy form countdown. Existing legacy forms keep
their prior behavior. This is not a second approval system.

The current durable renderer accepts at most 16 options, labels of at most 200
characters and a combined question of at most 4000 characters. Unsupported larger
native dialogs cancel rather than truncate exact provider choices. This includes
the question extension's extra Other/Chat/Submit menu entries. The host's bounded
UI wait is at most ten minutes (or the native request's shorter deadline).

The original maintained `rpiv-ask-user-question` owner provides the matching RPC
implementation in maintained **fork.7** ([owner PR #17](https://github.com/chenhaoxiang/rpiv-ask-user-question/pull/17), merged as `573d875`). During this compatibility verification it was an unreleased source candidate; a separate user-authorized local-tool update subsequently published [v0.1.4-fork.7](https://github.com/chenhaoxiang/rpiv-ask-user-question/releases/tag/v0.1.4-fork.7) from that same exact merge. This compatibility slice itself did not publish or install it. It preserves single
choice, editable text, Chat, duplicate-label multi-selection/order and cancellation
without calling `ui.custom` in RPC. The old fork.6 source and live TUI
sessions are preserved; a settings selection does not prove hot reload of an active session. Verify/select the reviewed source or immutable release in an
isolated test profile before installation; do not load two competing copies of
`ask_user_question`. The original TUI custom-component observation channels remain
TUI-only; an RPC request is not proof that a remote page displayed it.

## Control and quiet work

An active RPC session rejects another `run()` until the first has settled.
Abort ACK alone does not release the writer: cancellation waits for settlement or
confirmed process shutdown; a failure to confirm shutdown rejects. Neither lost
command replies nor a timeout prove the command did not execute, and this layer
never automatically replays `steer` or `follow_up` after a missing ACK.

The RPC session supports native steer/follow-up commands. This slice does **not**
claim that the CLI's Claude-specific live-steer queue/replay protocol is already
wired for Pi; ordinary subsequent turns still use the existing run/resume path.
Electron pooling, managed provider profiles and every installed extension are
not covered by the CLI-device fixture.

The ten-minute idle-event watchdog is paused for an identified native tool or a
bounded human-input wait, then resumes after it ends. A long tool with no text is
not misclassified as an idle process. Process-death handling, explicit stop and
outer operation-owner limits still apply. This does not prove a quiet tool is
productive or add a durable execution guarantee across gateway/backend restarts.

## Reproduce checks without model requests

The fork workflow installs only a small isolated runner/parser/debug/React-hook test toolchain
and executes the real RPC framing/client/UI bridge/answer correlation/persistence
sanitization tests. It does not install the whole application or validate all of
its packages:

```sh
npm install --ignore-scripts --no-audit --no-fund --prefix tmp/fork-ci-tools yaml@2.9.0 vitest@5.0.0 debug@4.4.3 react@19.2.7 react-dom@19.2.7 @testing-library/react@16.3.3 @testing-library/dom@10.4.2 happy-dom@20.11.15 es-toolkit@1.50.0
node tmp/fork-ci-tools/node_modules/vitest/vitest.mjs run --config .github/scripts/piRpcChecks.config.mjs
```

After the development dependencies are installed, run the owning package tests
by explicit paths (never the full root suite):

```sh
(cd packages/heterogeneous-agents && bunx vitest run src/rpc/ src/askUser/AskUserBridge.test.ts --maxWorkers=1 --no-file-parallelism)
(cd apps/cli && bunx vitest run src/commands/hetero/index.test.ts src/commands/hetero/index.pi.test.ts src/commands/hetero/index.startup.test.ts src/commands/hetero/selectorArgs.test.ts --maxWorkers=1 --no-file-parallelism)
(cd packages/shared-tool-ui && bunx vitest run src/AskUserQuestion/useAskUserForm.test.ts src/AskUserQuestion/useAskUserForm.explicitAnswer.test.ts --maxWorkers=1 --no-file-parallelism)
bun run type-check
```

The upstream root has no lockfile and CLI is a standalone install. In this local
fixture the second install resolved Zod 4.6.7 while root used 4.6.5; this introduced
an incompatible duplicate type identity. Aligning only this worktree's ignored
CLI/types Zod links to the root's installed 4.6.5 restored the owner root type-check
without changing tracked dependency policy. The standalone CLI TypeScript command
still has 97 normalized diagnostic signatures, identical to the untouched-main
baseline (including its missing server aliases/DOM declarations); it is not
reported as passing. Keep the actual install versions and baseline failures in
future evidence rather than silently changing all dependency ranges.

For the actual Lobe RPC handle → maintained Pi → original question source →
structured answer loop, explicitly select an installed SDK and the other owner's
reviewed `index.ts` or unpacked package entry:

```sh
SDK=/absolute/path/to/pi-coding-agent
QUESTION=/absolute/path/to/reviewed/rpiv-ask-user-question/index.ts
env -i PATH="$PATH" TMPDIR="$TMPDIR" HOME="$PWD/tmp/pi-rpc-native" \
  bun scripts/piRpcSmoke.mts "$SDK" "$QUESTION" "$PWD/tmp/pi-rpc-native"
```

The fixture uses an isolated HOME/agent directory, loads only the selected source,
invokes the actual registered question tool from a native extension command, and
rejects provider requests. On Pi 1.5.0-fork.4 it verified single choice, custom
Chinese text, Chat, duplicate-label multi-selection and cancel through the actual
Lobe handle with native session ids and zero provider requests. A separate run held the first real native question for 31,000ms (observed total 37,003ms), exceeding the ordinary 30s ACK budget without failure, then completed all five cases. This is native
protocol evidence, **not** a real business-model turn, release, installation, or production readiness claim.\n\nThe separate P1 localhost fixture also verified a real authenticated Web → backend → independent CLI device → maintained Pi → original question-tool callback: single choice returned the selected original Chinese label; multi-selection chosen in reverse order returned original indices `[0, 2]` and their original-order labels. Both native fixture results recorded `providerRequests: 0`. The Web run waited several minutes before an explicit submission, offered no additional off-list text box for native select, and displayed the no-automatic-answer countdown. Earlier pre-fix ACK failure and a cancelled stale-frontend run were retained, not rewritten as passed. The fixture invokes the actual tool from a native input hook, not a business-model-issued tool turn; the rest of P3 business/parent-reply acceptance remains separate. Native option rows were verified visually and via the real form event/producer result; no new VoiceOver/keyboard acceptance is claimed.
