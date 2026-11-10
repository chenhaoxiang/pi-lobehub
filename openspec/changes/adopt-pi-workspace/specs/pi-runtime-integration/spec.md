# Spec Delta

## Purpose

让维护版 Pi 在统一任务入口中保留真实运行身份、配置、交互与操作边界，使用户能够把任务交给 AI 并可靠地跟进、纠偏和停止，而不因接入界面而丢失原有约束，或把消息送达与运行结果混为一谈。

## ADDED Requirements

### Requirement: Maintained fork identity

系统 SHALL 支持经过能力核验的维护 Pi 版本，保留其原始版本与来源；不能通过伪装社区版本或静默替换安装来绕过接入检查。

#### Scenario: Recognised maintenance release

- **WHEN** 已选维护版具有受支持的版本格式和必要运行能力
- **THEN** 系统允许接入并展示实际版本、来源和原生运行身份

#### Scenario: Unsupported runtime

- **WHEN** 版本或必要能力不受支持
- **THEN** 系统返回具体兼容错误，不自动安装另一渠道或以假版本继续

### Requirement: Explicit configuration provenance

系统 SHALL 在运行前明确模型、服务商、思考配置及必要扩展的来源；原 CLI 配置与托管配置必须区分，切换配置根不能被描述为无损继承。

#### Scenario: Native CLI configuration

- **WHEN** 用户选择沿原 CLI 配置执行测试任务
- **THEN** 系统核对实际加载的必要配置且不复制凭据或静默改变模型

#### Scenario: Managed profile differs

- **WHEN** 接入模式使用独立配置根而缺少必要扩展
- **THEN** 系统明确显示差异或拒绝所需能力，不假报全兼容

### Requirement: Exact run ownership

系统 SHALL 将任务执行、原生运行和定向控制关联到准确身份；名称、目录或时间相近不能替代身份。旧运行的迟到结果不得覆盖新运行。

#### Scenario: Late result after a successor

- **WHEN** 同一任务的新一次执行已取得状态归属后旧执行返回结果
- **THEN** 旧结果仅保留其原归属，不推进或结束新执行

#### Scenario: Missing saved session

- **WHEN** 请求恢复的原生会话不存在或上下文未确认恢复
- **THEN** 系统明确告知新建或不可恢复，不以复用 ID 声称已接续历史

### Requirement: Structured question continuity

系统 SHALL 在所支持的 Pi 问答路径中保留单选、多选、自定义文本、Chat 和取消结果，并把答案交回发起它的准确问题；现有 TUI 行为不得因 RPC 接入退化。

#### Scenario: Answer a work-bound question

- **WHEN** 准确任务运行发出结构化问题且用户提交选择或文本
- **THEN** 系统只向该问题提交一次结构化结果并保留相应语义

#### Scenario: Cancel or expired answer

- **WHEN** 用户取消、运行中止或问题已失效后答案才到达
- **THEN** 系统不将其解释为批准，也不把它交给后续问题

#### Scenario: Unavailable interaction

- **WHEN** 所需交互不能被当前宿主呈现
- **THEN** 系统明确返回不可用或可理解的等待状态，不猜答案或显示假完成

### Requirement: Scoped management outcomes

系统 SHALL 区分提交请求、原 owner 受理、实际执行和最终结果；停止当前回合、停止子运行及暂停未来计划不得互相替代。结果未知时不能盲目重发潜在副作用。

#### Scenario: Lost control reply

- **WHEN** 控制请求可能已进入执行但回复丢失
- **THEN** 系统保留未知与原请求关联，先向原 owner 对账而不是自动重复执行

#### Scenario: Stop one run

- **WHEN** 用户定向停止一个运行
- **THEN** 系统只对准确目标请求停止并观察终态，不推导其他运行或计划都已停止

### Requirement: Interface and execution lifecycle separation

系统 SHALL 明确显示客户端、后端和执行端的不同存活范围；在本机验证支持范围内，关闭工作页面不能停止仍由后端与独立执行端持有的工作。

#### Scenario: Close the Web page

- **WHEN** 页面关闭而本机后端和执行端持续在线
- **THEN** 已授权任务继续执行，重新打开后读回相同任务及真实运行结果

#### Scenario: Execution host exits

- **WHEN** 后端或执行宿主退出且不能确认运行终态
- **THEN** 系统如实标记中断或未知，不直接启动替代 writer 冒充自动恢复

### Requirement: Preserve execution authority

系统 SHALL 服从当前任务授权、原工程规则和平台权限；Agent 指派、工具启用、历史成功或界面按钮不得创造额外权限，也不得关闭原有安全边界。

#### Scenario: Task asks for an unauthorised effect

- **WHEN** 工作需要原范围外的账号、资金、发布或实际环境动作
- **THEN** 系统只停受影响动作并说明必要决定，其余独立授权工作可以继续

### Requirement: Upstream-safe maintenance

维护 fork SHALL 保留可追溯的社区来源和自身改动，通过既有评审及适用验证整合更新；验证、发布与部署必须分开，不能启用继承自动化就视为维护验收完成。

#### Scenario: Validate a fork change

- **WHEN** 对集成边界提交维护变更
- **THEN** 仅运行已审计的适用验证，不调用上游发布身份、真实模型或生产部署作为默认检查
