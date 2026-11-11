---
doc_type: runbook
project: workspace
owner_repository: chenhaoxiang/pi-lobehub
status: active
truth_mode: maintained
created: 2026-11-11
verified: 2026-11-11
verification_scope: P3 deterministic Pi RPC; P4 bounded usage, attention, explicit SCM and original repository-review owner reads through verified Vista with authenticated localhost Web and isolated DB; no real-model business acceptance, daily Pi reload, installation, production or persistent operation
---

# Task、Goal 与 Pi 的交付路径

本页对应同一 Change `adopt-pi-workspace` 的 P3 及 P4 状态、关注与当前用量切片。
用户已明确选择 Web 端：本轮以本机 Web / 后端与独立 Pi CLI 设备交付，不加入
Electron 打包安装。LobeHub 继续拥有业务 Task、Goal、负责人、依赖和验收；Pi 继续
执行原生运行，不另建任务库或调度器。P4 的既有 SCM 与原 owner 读口已在明确绑定的
本机能力范围内接线；P5 真实模型业务验收与 P6 Desk 退出仍按计划验真，不从源码
交付或原件观察推导整项完成。本人试用暂缓，生产 / 正式发布不执行。

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

“Goal 图节点 active” 不是 Pi 正在执行的证明。P3 浏览器 fixture 中原 Task 已
回到 backlog、Operation 为零，旧图仍可显示进行中或随后显示停滞；P4 下节修正
这一读取路径，不改写历史图事件或把它们当作原生运行原件。

## P4：读取当前运行与原问题

- Goal graph 按显式 Task ID 读取内容无关的 Task 状态、`currentTopicId` 对应的
  TaskTopic 和准确 Operation。Operation 必须同时匹配 Task、当前话题和本轮
  `startedAt` 代际；不按最新话题、旧 running 行、图节点激活或连接状态反推。
  Task / Operation 查询只投影必要字段，不加载提示词、错误正文、配置或 trace 路径。
- 任务待派发、预留、运行记录活跃、等待输入 / 工具 / 客户端、检查、收尾和未知
  分开显示。只有匹配的运行记录可提供计时 / 心跳；新图观察不能刷新旧运行的 lease。
  缺原件显示未知，不从 completed 推导验收通过。Goal review 或有待决策时，可推进数
  为零；批量视图不把心跳陈旧或机器等待变成用户审批。
- 图中的次数、展开记录与生命周期激活文案明确是 “图节点推进记录”；目标总历时
  包括等待，不称原生 Pi 运行时长。这里没有另建原生调用次数或第二份账本。
- 既有全局关注入口新增只读 `task.pendingInteractions`。它仅检查当前范围内，
  当前用户拥有的前 100 个活跃 Task 运行，并从准确话题、Operation、原工具消息及
  Pi 干预状态读取定位符；超出窗口明确提示不完整，不扫描全量历史。
  不返回问题正文、工具参数、凭据或私有路径，不创造批准权。
- 已回答 / 取消 / 会话结束 / 超时、已进入 resolving、旧话题、旧代际或终结 Operation
  不再作为待回答提醒。待回答仅由原工具的 pending 记录说明，单有 waiting_for_human
  不够。提醒按原 Operation + 工具消息 + 调用身份去重；已加载、当前页和门户问题
  留给原控件，Goal 决策 / 签收按各自原 ID 去重。
- 提醒只打开标准原运行页。它不回答、不恢复、不签收，也不把只在首页挂载的
  抽屉当作全局导航。收起只隐藏 UI；读取失败保留上次观察并标明可能变化，提供重试，
  不宣称 “已清空”。客户端沿现有 replica 范围隔离，定位符仅内存缓存，每 15 秒只读
  数据库刷新，查看不触发模型。

本地验证为合成数据：已登录 localhost 重开 Goal 后恢复单条提醒，实际打开准确
原问题页，原 pending 状态未改变；收起显示一项，单独注入读取失败显示明确提示，
恢复后重试成功，原工具改为结束状态后提醒消失。测试种子最初使用错误 renderer key
导致出现通用审批表单，按实际 Pi 桥的 `provider=pi` / `identifier=claude-code` 合同
纠正后才核验原问题；没有把该种子问题写成产品回归。也没有原生生产者或真实模型
在等待这份合成问题，未提交答案，不替代 P5 提问 / 纠偏验收。

初始切片适用回归为 server 466、app 365、数据库 32，初始远端 CI 也通过；独审
随后发现漏接的 Goal “全部任务” 消费者，父级实际复现其旧测试变红，不能据原 CI 直接
合并。修正详情的状态 / 标签 / 时钟、补准确 Operation 完成时间，并把 GoalMetric
回归纳入同一 CI。批量分组也从实际单元状态归约，未知 / 等待 / 仅排队不再画运行
动画；原运行导航改为既有 URL builder。补验 app 401、受影响 server 30、数据库 17
及应用 / 新增测试类型均通过；集合有交叉，不相加声称去重总数。

同一暂停的合成 Goal 已实际核到：全部任务的提示从 “进行中” 变为 “执行状态未知”，
无虚构时长；两项未知的试验分组从 “探索中” 变为未知。只切换精确旧客户端 helper
与分组 renderer，后端 / 数据库相同，之后恢复原文件。关注读取窗口仍按运行创建时间
升序保留前 100 个；独审对此提出低概率非阻断建议，当前明确不保证完整或最新优先。

实际 Web 页面和必要图片由主执行者核验，未安排独立 acceptance-checker；独立代码
审查、PR、CI 与合并以精确 head 原件为准，原 BLOCK 不回填为通过。Electron、移动端
和完整键盘 / 辅助技术验收未在本切片执行。

## P4：当前 Pi 用量不是完整账单

- Pi 适配器只接受完整、非负安全整数的输入、输出、缓存读取、缓存写入四桶；
  输入不含缓存，输出已含推理，不把推理再次相加。缺字段、负数、非整数、溢出
  或矛盾合计不补零。核对维护 Pi `1.5.0-fork.4` 与 `1.5.2-fork.2` 所带
  `pi-ai/dist/api/openai-responses-shared.js` 的 Responses usage 归约：缺失
  `total_tokens` 用 `|| 0` 写为零哨兵，因此按四桶求和；非零合计必须吻合。
  真实四桶零值仍保留，但零目录价不作为免费账单。
- 既有 `messages.usage` 是主来源，旧 `metadata.usage` 仅在整份主来源缺失时
  整份回退；不逐字段混合，也不同时相加。持久层按原消息 ID 更新，重复回执不会
  形成第二条计数。没有建立新的用量库、金额估算器或历史扫描。
- 只读 `task.currentUsage` 按用户 / 工作区、Task 当前话题、准确 Operation、
  `startedAt` 代际和 thread 取当前 Pi 主运行。分享访客、他人 Operation、旧话题、
  其他 provider 及子运行不纳入；查询前后代际变化则整份样本失效。SQL 只投影六个
  必要用量字段，不加载消息正文、工具参数、推理或任意 metadata。
- 每次最多观察前 500 条匹配助手消息；超限明确标不完整。只累加具有完整四桶的
  记录，缺回合说明覆盖不足。未采集显示 `--`，已记录显示 `≥` 下界及上次读取时间，
  不把子运行、辅助调用、平台规划 / 验收调用或未知费用说成已经覆盖。
- 同一只读栏目复用在 Task 整页及 Goal 打开的 Task 门户。客户端沿既有 local-replica
  做内存缓存与身份隔离，运行期间每 15 秒只读刷新，Task 收尾后再对账；初次失败
  不显示零，后台技术错误保留上次值并标明可能变化。明确失去访问资格则清除旧值。
  刷新按钮只读用量，不运行模型、不继续任务、不回答问题。
- 原 Goal 预算公式和上限控制未改；标签改为 “已记成本（估算 / 上报）”，并显示
  直接任务、监督 / 管理计数与未覆盖范围。估算金额可能高于或低于实际账单，
  不将其称作真实费用下界。

本机 Web 使用三个明确合成 Task：两条完整记录与一条缺失记录显示四桶
`10 / 9 / 13 / 2`，合计 34；每个持久化意图重复应用仍只计一次。完整零记录与
尚无运行分别显示 `≥ 0` 和 `--`。初次 / 后台错误及重试、Goal 预算说明和 Task
门户未知态均实际观察；390、768、1440 CSS 像素仅为桌面 DOM 视口核验，不是移动
路由、触屏或真机验收。刷新键盘焦点与 Enter 只触发一次用量 GET，没有提交业务
输入；不据此宣称完整无障碍验收。原始过宽的批量故障注入误伤另一 API 的尝试保留，
有效初次错误证据已限定到 `task.currentUsage` 的单个响应包。

上述数据经真实 Pi adapter 与实际持久化入口写入，原生帧由确定性 fixture 提供，
没有 CLI / 模型生产者；该 fixture 的 provider 请求为零，不是 P5 真实模型任务。
最终适用本地回归分别为 server 607、app 763、数据库 43、Pi adapter 31，以及应用 /
新增测试类型通过。app 测试退出仍有已知 happy-dom AbortError stderr，未伪称控制台
全净；原 GoalMetric 时间线的两项 purity 警告未由本片新增。质量检查不替代产品观察。
实际图片由主执行者检查，缺少独立 acceptance-checker；代码独审、PR、CI 和合并仍须
按本切片精确 head 绑定，不回填旧 P4 审查或绿灯。

## P4：显式工程记录与原 owner 只读读回

工程记录默认折叠，展开才沿原 `taskProcedure` 的只读 `task.engineering` 读取。
它消费原 SCM 提供方写入的 `scm_change_requests` 和本 Task 原 Acceptance 的显式 PR
关联；不从目录、分支、最近话题或模型汇报推断归属。没有另建工作台、工程数据库、
验收判断或任务执行器。

- 原 SCM 行必须在当前用户 / 工作区范围，明确关联该 Task，或无冲突 Task 绑定且
  关联由当前读取者本人创建、属于该 Task 的 Acceptance；其他成员创建的公开验收关联
  暂不纳入本视图，不据空视图声称不存在关联。只展示明确公开的 GitHub 提供方原件；
  私有 / 可见性未知的原件不纳入。父 Task 的私有 / 已删与 scope 规则前后均检查。
- 只投影 repository、PR、head、原 CI 汇总 / `ciHeadSha`、检查名称 / App / 原状态与
  平台更新时间；不读取任意 metadata、审查正文、工具结果或私有 Gate 路径。最多
  8 个 PR、每 PR 20 个检查，截断明示。只构造固定 `github.com` PR 链接。
- 手工关联不冒充提供方原件，head / CI / 生命周期未知；相同 PR 按仓名大小写折叠
  去重。检查只在 `headSha === ciHeadSha` 时展示；缺 head 或不同 head 的旧检查不能
  变成当前绿灯。原 CI 是平台最后收到的汇总，不是必需检查全集或刚刚从 GitHub 读回。
- 此只读路径不调用 SCM 的 hand-link catch-up /control，不评论、不自动签收、不唤醒
  Agent、不 merge，也不新增 GitHub App、OAuth、凭据或网络轮询。现有提供方未接通时
  如实显示无可展示原件，不为演示借用生产配置。视图只在内存中按身份隔离；初次失败、
  成功空态、后台旧观察与失去访问资格分别处理，关闭栏目停止读取。

PR7 当时仅完成上述原 SCM 消费，Gate 保持 `not-observed`，没有用几项绿灯冒充
原 owner 原件。后续 Vista [PR75](https://github.com/chenhaoxiang/pi-vista/pull/75)
沿其原 Meta Gate 正常合入 `4d63f3d`，合后 CI 成功：原 `repositoryReview` 读口精确
增加本仓的独立 PR / 审查合同，不改变其他仓的 Meta Gate 路径，不伪造本仓不存在的
Meta Gate。Web 的显式本机能力现可直接调用同一 `readCodeStage`，见下节；它只展示
源码阶段原件，不接受模型生成的摘要或状态 JSON 代替真实读取。

实际 localhost 观察将已选 PR6 及其精确 head 检查的两个固定公开 GitHub GET 结果，
经原 SCM 写模型放入隔离 fixture，再显式绑定到合成 Task；另有仅手工关联的 PR5。
这是真实公开元数据与合成 Task 关联，不是新 webhook 投递，也不是该 Task 的模型
工程交付。默认关闭时工程请求计数为零，展开读一次；有效原件 / 未核验关联、初次 /
后台失败与恢复、无关联 Task、Goal 打开的 Task 门户、390 / 1440 桌面 DOM 均核到。
窄屏证据使用用户可关闭的现有侧栏；侧栏展开时主区很窄的原布局也保留，不声称已修复
全局响应式。两次刷新工具返回交互超时，但后续 DOM / GET 计数确认请求已发生、错误
已消失，没有盲目再次提交。一个合成 `ciHeadSha` 不匹配探针核到旧检查隐藏和 CI 未知，
已按精确原值恢复，无 GitHub 写入或模型调用。

本片实际回归：真实数据库 30（含工程 8）、路由 2、应用 404（含工程 hook 7），
应用 / 新测试类型及定向 lint、设计 lint /detail 均通过；app 退出的既有 happy-dom
AbortError stderr 保留。原产品图片由主执行者检查，没有独立 acceptance-checker。
代码独审、远端 CI 与共享交付按本切片实际精确 head 绑定。

PR6 的合后 CI `43066683317` 两项成功，物理 `main` 已无损同步 `0a1866d`。其离线
报告的后续浏览故障已通过准确归属的隔离测试 Chrome 重启恢复；不改变原报告 / 用户
决定，12 张内嵌图片均实际解码，5 项仍待用户签收。初次超时历史不改写成成功。

### 本机原件能力的明确配置与边界

本机 Web 后端可显式配置三项进程环境变量，默认均为空，未配置保持未知：

- `PI_LOBE_CODE_OWNER_READER`：已验证 Vista 原 `scripts/pi-code-stage-reader.mjs`
  的绝对路径。当前验证用支持本仓的 `4d63f3d` 同树源码，不默认更新日常 Pi observer。
- `PI_LOBE_CODE_OWNER_READER_SHA256`：上述已核验入口文件的 SHA-256。入口须为普通
  文件、不允许 symlink 或其他人可写，并且匹配指纹；指纹只约束代码完整性，不认证
  任意插件 / 依赖图，也不是原件接受的替代证明。配置者必须选择已核验的受信代码。
- `PI_LOBE_CODE_OWNER_CONTRACT`：原 owner 的既有私有合同文件，绝对路径、普通文件、
  当前宿主用户持有且无组 / 其他人权限；真实文件只在受限 `keys-local/`。合同保持
  Vista 原闭集结构；其 `binding.workRef` 明确为本仓 owner、`kind:task` 与当前 Task
  数据库 ID，源码阶段与精确 head 齐备。此处没有新审批表或第二份验收库。

页面 / API 只传 Task ID，不能传程序、模块路径、私有文件名、命令或原件正文。Task
可见性先过原 `taskProcedure` / 模型校验，合同还必须匹配该 Task 已有的显式 PR /
head。私有合同与入口每次最多读取 64KiB，拒绝目录、特殊文件与符号链接；文件经
原件读取后再次比对，变化则保持未知。这里只是受信宿主接线，不宣称隔离恶意代码。

宿主以固定 Node 程序调用同一原 reader，合同快照经 stdin 传递，不进命令行。只
允许白名单运行环境，不转发模型 API key、GH token、`NODE_OPTIONS` 或业务 profile；
`gh` 沿现有正常凭据入口读取已选择的公开仓。原 reader 保留公开可见性检查、完整
CI 名称 / App、精确 PR /head/base/merge、合后 workflow / 包含关系与两次审查原件
读取；宿主仍负责选取真正已审阅接受的原评论及完整要求，摘要不能创造接受权。

每次最多原读口既有 8 / 10 个固定公开 GET，55 秒主动 abort、60 秒外层截止，
stdout 上限 16KiB；无重试、无 Gate /merge/ CI / 部署执行。出站只保留原阶段、
等待原因、下一步元数据、公开 PR/head、原件时间与 `authorization:none`，不带私有
路径、合同、审查正文、原生 run/session ID 或真实凭据。等待、失败、未知也是观察，
`source-observed` 不是通过或业务接受。页面默认折叠，只有显式查看 / 刷新才读取；
关闭焦点 / 重连刷新、外部轮询及自动错误重试，仍复用原 replica / API / 任务详情。
原件等待期间 Task 删除 / 私有范围变化或 PR/head 变化，响应再次核对并拒绝旧投影。

实际验证采用原已接受的公开 PR6：精确 `f641f61d`、App15368 的两项原检查、原审查
评论 `6802405443` 的真实全文摘要 / 作者 / 合前时间，以及 merge `0a1866d` 的
`Pi Fork Check`。这些原件经真实 Vista reader / `gh` 与本机 Web 读取，不是 stub。
Task 绑定仍为明确合成场景，私有合同的 run/session 是观察别名，不冒充业务原生执行。
页面实际显示 “源码交付原件已核对”，原业务 Task 仍待办、不签收。故意改错本机固定
审查摘要时，真实原读口降为未知；恢复精确摘要才恢复，未编辑远端评论或推导业务
通过。没有默认扫描历史、生产 / 真实业务模型调用、日常 Pi reload 或用户软件安装。

宿主文件 / 进程边界、合同 /head/ 访问资格变化、错误与闭集投影分别有回归：当前
server 12（宿主 8、真实 DB /middleware 路由 4）、app 25（阶段文案 18、hook 7），
应用与新测试类型、定向 lint 通过。原 Vista reader 53 回归与三 Node CI 属其原仓
证据，不和本仓数量相加。浏览器 / 原始图片仍由主执行者检查，没有独立
acceptance-checker；源码审查、PR 与合并按本切片精确 head 原件交付。

## Desk 来源、许可与实际处置

本次对照来源为 `chenhaoxiang/pi-desk` 的 `bd36b07`，包括其原 owner 合同、
`packages/desk-bridge/src/usage.ts` 及相应用量测试。它们用于核对四桶、未知 / 下界、
去重和准确运行归属语义，**没有复制 Desk 的 SwiftUI、bridge 代码或测试文件**。
本仓实现与回归独立编写，复用的是 LobeHub 已有 Pi adapter、消息持久化、Task /
Operation、local-replica 和界面组件，不声称 “Desk 源码已经集成”。

| 原能力 / 资产                                        | 当前处置                                               |
| ---------------------------------------------------- | ------------------------------------------------------ |
| 工作状态、阻塞、下一步与准确运行身份                 | 已在原 Task / Goal 消费，Desk 仅供语义对照，不双写     |
| 需关注问题                                           | 复用原问题生命周期和现有关注入口，不迁第二审批中心     |
| 当前运行四桶用量及缺失语义                           | 本片独立实现有界投影；不复制 Desk 的采集器或收据集合   |
| Gate / CI 阶段摘要                                   | 原 SCM 与显式受信宿主的原 owner 读口已接线，非业务签收 |
| 旧 UsageLedger、配置和历史原件                       | 原地保留，不扫描 / 导入，不把新 UI 当作迁移完成        |
| SwiftUI / AppKit、菜单栏特效、重复设置和可选 AI 助手 | 不迁，不为沉没成本继续扩张                             |
| App /bridge 运行入口                                 | 未退出；P5、保全与在途安全满足后才按 P6 处理           |

所核 Desk 提交未见 LICENSE / COPYING / NOTICE 授权文件，根及 bridge package 也未
声明 license；不能据公开仓或相同 owner 推断第三方分发许可，本片因此不搬运其代码。
本仓上游 `LICENSE` 仍为 LobeHub Community License，保留原文与来源；其中商业
衍生开发 / 分发条款须在相应外部交付前核对，不把本机验证或 fork 解释为已取得
商业分发许可。本轮没有正式发行、商业分发或重写许可证。

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
