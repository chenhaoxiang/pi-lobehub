# Spec Delta

## Purpose

让用户以持续存在的业务目标、任务和负责人管理工作，在同一入口理解执行、等待、交付、检查和反馈，并只在确有需要时介入。该能力复用现有任务机制和真实执行来源，不制造与 Pi 并行写入的第二份任务事实。

## ADDED Requirements

### Requirement: Durable task identity across runs

系统 SHALL 使用 LobeHub 现有业务任务身份关联多次执行、负责人、输入、产出与反馈；Pi 的执行计划不是业务任务副本，运行结束或换会话不能使工作责任无声丢失。

#### Scenario: Continue after feedback

- **WHEN** 用户对既有任务的产出追加纠偏或退回要求
- **THEN** 后续执行仍关联该任务、已知背景与准确反馈，不要求用户自行找回旧会话

#### Scenario: No declared association

- **WHEN** 一个原生运行没有明确业务任务关联
- **THEN** 系统显示未关联，不从目录、名字或 Todo 数量猜测其任务和负责人

### Requirement: Explicit responsibility and bounded coordination

系统 SHALL 区分目标负责人、执行 Agent、群组协作和故障处理职责；自动推进依照当前依赖、运行状态与预算，不把配置了 Agent 描述为保证最优岗位匹配。

#### Scenario: Independent ready work

- **WHEN** 当前目标内有满足依赖且在并发与预算范围内的独立任务
- **THEN** 原协调器可派发并准确记录实际开始的执行，而非只修改显示状态

#### Scenario: Waiting for external work

- **WHEN** 任务等待已声明的外部结果且未获得新事实
- **THEN** 系统保持准确等待，不以反复无进展模型回合冒充推进

### Requirement: Distinct delivery and verification states

系统 SHALL 分别呈现执行状态、检查结论、交付及用户接受，保留普通 Task、Goal 内任务和周期执行的原有差别；不能从 completed 或运行结束推导检查、CI、合并、安装或上线成功。

#### Scenario: Delivered output with failed checks

- **WHEN** 普通 Task 已交付但相关检查结论为失败
- **THEN** 用户能同时看到已交付、失败原因与接受/退回入口，而不是单一成功标记

#### Scenario: Goal work fails verification

- **WHEN** Goal 内任务未通过检查
- **THEN** 系统保留失败并按原协调器进入修复、受控重试或升级，不能直接认定目标达成

#### Scenario: Recurring tick without verification

- **WHEN** 周期任务的一次执行没有运行对应检查
- **THEN** 系统说明未检查，不以该次完成冒充通过验收

### Requirement: Actionable attention with provenance

系统 SHALL 将真实问题、待决定事项、未读产出和普通运行等待区分；所有需用户处理的对象必须关联准确来源，已读/静音不能回答问题、批准动作或继续执行。

#### Scenario: Real input is required

- **WHEN** 运行中的准确问题等待用户输入
- **THEN** 工作入口展示其所属任务和有效处理入口，并只将答案交回原问题

#### Scenario: CI is pending or a result is unread

- **WHEN** 只是外部检查等待或结果尚未查看而无真实输入请求
- **THEN** 系统不将其伪装成必须由用户批准才能继续的问题

### Requirement: Scoped and deduplicated usage

系统 SHALL 对展示的 Token/用量标明来源、时间和覆盖范围并避免重复计数；未采集、订阅未计价和缺失成本不能记作零或冒充完整账单。

#### Scenario: Partial current-run coverage

- **WHEN** 只采集了当前接入运行而没有旧会话和全部附加模型消耗
- **THEN** 界面明确显示局部范围或下界，不声称全部 Pi 总用量或零额外成本

#### Scenario: Replay of the same usage record

- **WHEN** 相同来源的用量记录被重复递送或刷新
- **THEN** 合计不重复增加，原范围与来源仍可核对

### Requirement: Selective Desk transition without data loss

系统 SHALL 复用既有工作页面吸收必要能力，而不是复制完整 Desk；实际退出旧 App/bridge 前，必须确认替代范围、数据保全和无冲突控制，不强制停止旧 Pi 或默认搬运历史正文/凭据。

#### Scenario: Required capability is not yet available

- **WHEN** 统一入口尚不能满足已确认的必要运行/提问/数据能力
- **THEN** 系统如实保留缺口，停止 Desk 新功能扩张不被描述为旧运行和数据已经安全迁移

#### Scenario: Controlled legacy removal

- **WHEN** 必要替代能力已验证且原工具拥有的入口可以退出
- **THEN** 只处理该入口，保留原会话、用量数据和其他扩展，并确认没有另一个控制者写同一运行

### Requirement: Honest local-validation scope

系统 SHALL 将全本机验证、长期持久运行和正式部署区别展示；本阶段只在选定本机环境与进程存活范围内作出可验证承诺，后续能力不能反向标成已交付。

#### Scenario: Local validation succeeds

- **WHEN** 本机隔离任务完成端到端验证
- **THEN** 报告区分已验证流程与尚未验证的重启、长期在线、正式发布和生产能力
