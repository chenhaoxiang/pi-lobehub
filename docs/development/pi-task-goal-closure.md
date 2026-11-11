---
doc_type: runbook
project: workspace
owner_repository: chenhaoxiang/pi-lobehub
status: active
truth_mode: maintained
created: 2026-11-11
verified: 2026-11-11
verification_scope: P3 source, isolated database and real Pi RPC deterministic fixtures plus authenticated localhost Web observations; not business-model acceptance, production, release or persistent operation
---

# Task、Goal 与 Pi 的交付路径

本页对应同一 Change `adopt-pi-workspace` 的第三批 P3。LobeHub 继续拥有业务
Task、Goal、负责人、依赖和验收；Pi 继续执行原生运行，不另建任务库或调度器。
P4–P6、Desk 能力迁移 / 卸载、真实模型业务验收及生产发布均未由本页完成。

## 身份与开工

- Goal 为图节点建立普通 Task，保留业务负责人和执行 Agent。人类负责人不因
  inbox Agent 代为执行而被替换。
- 手动、依赖、周期和 Goal 派发继续进入同一个 TaskRunner。普通调用必须赢得
  Task 的条件状态更新；Goal 调用携带自己赢得的 `startedAt` 代际，不以 “已是
  running” 视为另一调用的开工许可。
- Operation 持久化后、执行调度 / 原生进程开工前，在同一 Task 行锁下绑定
  `Task → TaskTopic → Operation`，随后才交调用者的准备回调。快速结束的运行
  不再被派发返回后的写入重新标成 running。
- 同一 Task 可以有多个运行；继续话题必须确属该 Task。原生 session、运行与
  Operation 的精确关联沿已有 Pi RPC 适配器，不从 cwd、显示名或 Pi Todo 反推归属。
- 依赖重复解锁与检查点使用条件更新，不因另一调用的 CONFLICT 把已启动的任务
  暂停。开工失败的回滚只释放自己的代际；已接受的活跃运行不会因后续心跳写失败
  被伪装成已停止。

## 运行、交付和签收分别判断

| 原件                            | 能说明什么                     | 不能推导什么                      |
| ------------------------------- | ------------------------------ | --------------------------------- |
| Operation / Pi 原生回执         | 哪次运行开始、结束、等待或失败 | Task 的交付是否合格               |
| TaskTopic / Task                | 运行关联与业务任务进度         | Verify 必定通过、用户已签收       |
| Verify round / check / evidence | 哪轮标准被检查，结果与证据     | 用户业务签收、PR 已合并或部署上线 |
| Acceptance / 用户决定           | 已交付、退回、签收及历史轮次   | Git、CI、安装、发布等独立工程结果 |

普通 Task 可以 “已经交付但检查失败”，由 Acceptance 明示结果并等待用户决定。
Goal 失败轮次交回其协调器返工；周期 tick 的一次检查结果不解除整条计划。
未检查不写通过，旧轮次不得改变新的 Task 运行。

完成回调和 Verify 收敛检查当前话题及 Operation 的取代关系。验收审阅可能等待
独立判断，因此判断结束后再次核对归属。已被用户退回的旧轮次不重新完成任务。
给创建者的结果卡按 Task + Operation 去重：同一话题再次交付有自己的卡片，
同一 Operation 的重复回调不再新增一张。

## 退回与下游影响

用户明确选择的默认行为：**已有下游开工或交付时先暂停推进，确认返工范围，
不自动重复整条付费依赖链**。

1. 没有下游已开工：重开原 Task 和原图节点，负责人不变。下一轮读取原 Acceptance
   的退回反馈与标准，不由执行 Agent 降低标准。
2. 有下游已开工或交付：在既有 Goal 用户决策入口进入 `review`，列出受影响任务，
   保留历史结果。`review` 在这里表示等待用户决定、禁止新协调派发；它不意味着
   所有已运行进程均被取消。
3. 用户先对需要返工的下游交付提出修改，说明哪些结果可以复用，再确认范围。
   范围说明必填；中文和英文提示均沿现有 GoalDecision 组件，不增加第二工作台。
   已暂停等待时的新退回仍被接续，其余未回答的决策不会被一次确认清空。
4. 确认在同一 Goal/Task 锁下落盘：原 Task 回到 backlog，范围说明留在该 Task 的
   评论中；其他决策仍 pending 时 Goal 保持 review。不会自动重复执行未明确重做
   的下游，也不自动停止其在途进程。
5. 未签收的最终验收重新排队，并依赖返工 Task。为它追加未执行的草稿轮次，
   防止旧报告在重验前被直接签收或被 recompute 恢复成可签收；真实最终运行开工
   时复用 / 折入该草稿。草稿不重新声明已签收检查，真实重验计划排除已签收项，
   从原 Acceptance 复用其证据，只更新剩余检查。旧标准、结果、证据和签收原件不覆盖。
6. Goal 的签收与退回也在同一 Goal 锁下重查状态。已签收的最终交付保持签收，
   不能自动变成一次重验；需要明确安排后续 Goal。所有单项检查都已签收、仅整体尚未
   签收时，也不能把 “没有剩余检查” 当成 “没有合同” 再调用模型生成新标准：范围决策
   保持 pending，明确增加新检查或安排后续 Goal 后再继续。普通 TaskRunner 同样在
   开工前拒绝自动换合同；防御性直接实例化只记录已确认但 errored 的空计划轮次，
   将仍在运行的 Task 保持人工关注，不把空计划或执行结束当重验通过。
   原 Task 或最终审阅仍在运行时，
   不重置其状态，决策保留，使用已有任务入口处理运行后再确认。

“Goal 图节点 active” 不是 Pi 正在执行的证明。当前上游图中的计时 / 尝试展示也
不能代替 Operation 原件；本轮浏览器 fixture 中原 Task 已回到 backlog、
Operation 为零时，图仍可显示进行中。本页不把它计为已派发，也未扩入 P4 的状态展示迁移。

## 本地复验

根 workspace 安装与服务隔离沿 [本机环境](pi-local-validation.md)。本轮根依赖
与 CLI 运行树分离，不重写共享 peer 链接，不访问日常 profile 或真实模型凭据。

```sh
# 同一 CI 中列出精确范围；不运行根全仓 test。
node node_modules/vitest/vitest.mjs run --project server --maxWorkers=3 \
  apps/server/src/services/taskRunner \
  apps/server/src/services/taskLifecycle \
  apps/server/src/services/taskResultBridge \
  apps/server/src/services/taskGraph \
  apps/server/src/services/goal/GoalService/__tests__/rework.test.ts
bun run type-check
bunx --no-install tsrs --noEmit -p .github/scripts/piTaskGoalTypes.json --checkers 4
```

完整精确范围在 `.github/workflows/pi-fork-check.yml` 的 `task-goal-closure`，
包括负责人、依赖、等待、Goal 恢复、普通 Task/Goal/ 周期状态、证据复用及签收隔离。
数据库回归使用 PGlite 或明确隔离的 PostgreSQL，不向复用的 Web fixture 执行清库测试。

可选真实原生 RPC fixture（显式传入本机已核实 SDK 绝对路径）：

```sh
PI_TASK_GOAL_NATIVE_SDK=/absolute/path/to/reviewed/pi-coding-agent \
PI_TASK_GOAL_NATIVE_DIR="$PWD/tmp/pi-task-goal-native" \
bunx --no-install vitest run --project server \
  apps/server/src/services/taskRunner/__tests__/businessClosure.test.ts
```

该 fixture 使用真实 Goal/Task/ 数据库 / 生命周期 / Acceptance 和真实 Pi RPC 适配器；
网络派发与独立判定被受控替换。原生扩展只写确定性的本机交付原件，并拒绝任何
provider 请求。实测 3 个业务 Task、4 次独立 Operation / 原生 session，最终 Task
被退回后再次交付，反馈、负责人和验收条款保留；四张原生回执均为零 provider 请求。
这不是付费业务模型执行、HTTP 全链路自治或 P5 真实工程任务的验收。

浏览器另用 localhost 的合成账号与数据核验：

- 旧版结果桥实际插入函数执行两次仍只显示第一次；新版同一运行话题两次交付均
  渲染，原结果和返工结果可分辨。前后使用各自明确标记的合成 Task，创建者模型唤醒
  被抑制；不是伪造真实模型消息。
- 范围确认从英文提示变为中文说明，实际空说明提交被拦截；补充范围后原 Task
  收到原文，独立的合成控制决策仍 pending，Goal 不派发新模型。
- 本机 Web、Redis、S3、QStash、数据库与 Gateway 只用于这一测试。可复用配置
  与合成数据不等于后台全局调用数已被统计；只有四次原生 fixture 的 provider 计数
  已直接核验。测试结束停止本轮服务，保留合成数据和原始失败。

质量证据与产品观察分别记录。测试、类型检查和 CI 不作为业务 Acceptance 条目。
初次独审及唯一窄复审的 BLOCK 原件保留；窄复审另发现部分检查已签收时不能复制
整份计划作为草稿，该问题已用真实 DB 先红后绿修正。后续修正未再取得独立 PASS，
不得把后修复 / 本地绿灯回填为旧 head 独审通过。用户随后明确追加一次独立窄复核，
该次又发现 “所有单项都签收后过滤为空会落入模型生成” 的分支；已补先红后绿的
真实 DB 回归，并增加开工前合同预检和明确非通过状态。追加复核及其后续增量
确认的真实结论只按 PR 原件更新，不把旧 BLOCK 改写为 PASS。

首次远端 CI 因误写 pnpm12 的旧 `bin/pnpm.cjs` 路径失败；实际安装探测确认
该版本公开入口为 `bin/pnpm.mjs`，仅修正工具路径，不重试未变输入。离线报告初次
因 CLI 缺少模板失败，按已有 workbench 配置在本地构建模板后渲染；未重装全局 CLI。
本轮本机报告保存在任务树 `tmp/`，PR 引用真实验证范围和独立审查；不上传到上游云端，
不把本地合成验真写成生产上线。
