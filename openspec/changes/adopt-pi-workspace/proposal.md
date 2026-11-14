---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-lobehub
status: active
truth_mode: maintained
created: 2026-11-10
release_scope: P0–P6本机范围已交付；生产部署、Electron发布、用户日常安装和历史数据迁移未执行
---

# Proposal

## Why

用户需要围绕持续存在的目标、任务和负责人组织一人公司的工作，而不是管理许多会话。选择基于 LobeHub 的现有工作产品保留 Pi 执行和原治理能力，结束 Pi Desk 独立产品扩张，避免同时建设两套工作台。

## What Changes

- 建立上游优先的 `pi-lobehub` 维护合同、安全验证路径和可追溯的小范围兼容改动；不复制社区发布身份。
- 首版采用用户明确选择的**全本机验证版**：本机隔离 LobeHub 后端/数据、Web 工作入口和独立 CLI 设备执行端；本阶段不承诺长期在线或跨服务端重启自动接续。
- 打通维护版 Pi 的版本识别、原配置来源、运行身份、结构化提问、消息/停止及未知结果处理，而不是只证明能显示聊天。
- 复用 Goal/Task/Acceptance 组织工作，分别呈现业务状态、执行事实、检查结论和用户接受，不从 Todo 勾选推导交付。
- 按需吸收 Desk 的运行可信度、工作关注与基本用量能力；现有 LobeHub 功能足够时直接复用，不重建 Desk 页面。
- **BREAKING（已执行受控切换）**：Pi Desk 不再承担独立产品演进；2026-11-14 已在用户授权下将 App/当前 bridge/自动发现入口和 manifest 移入用户域可逆归档，保留历史用量/配置/会话/旧 bridge，不强制 reload 日常 Pi。

## Capabilities

### New Capabilities

- `pi-runtime-integration`：维护 Pi 运行时的真实身份、配置、交互、控制和失败边界。
- `task-workspace`：统一业务任务与执行关联、负责人工作闭环、验收/关注和有来源用量展示。

### Modified Capabilities

无。`openspec list --specs` 在本仓返回空；不虚构已存在或已交付的规范。

## Impact

- 主要涉及 `packages/heterogeneous-agents/src/rpc/`、桌面/CLI Pi 工厂、已有服务端运行及任务事件路径和必要的任务详情消费者。
- `rpiv-ask-user-question` 当前只支持 TUI；若要保留同名工具的完整问答合同，须在原 owner 仓增加公开 RPC 路径并回归，不在 LobeHub 假冒答案。其他 Pi 仓只补经确认的具体缺口，不全量重构。
- Pi Desk/Vista 的已有源、协议与测试是参考；是否复用代码按模块、许可和来源逐项核对，不全量复制 SwiftUI 或历史数据。
- 第一批现已授权准备必要本机测试依赖、隔离数据服务和 provider-free 基线；真实模型调用须匹配实际测试配置与费用范围，不以本地环境许可推导生产或发布许可。
- 依赖运行环境、真实模型配置和费用上限的动作，在实际执行前核对其已有授权；阶段不是逐项人工审批流程。

## 当前状态与授权边界

本仓初始化已完成；本 Change 以 `01665ddf425ff824b554993115e969c51bd1f4c5` 为设计核查基线。GitHub 默认 `main`、本地 `main` 对齐、只读 `upstream` 和暂停 Actions 的状态已回读。

用户已选择全本机验证，并明确要求将第一批、第二批纳入计划并实施：第一批对应 P0/P1 的 fork 合同、安全 CI、正常 PR 交付和隔离本机环境；第二批对应 P2 的 Pi 版本、配置、结构化问答和运行控制。第一、二批已按仓内证据交付；用户随后授权 P3–P6，完成 Task/Goal/负责人/依赖/Pi/Verify/Acceptance 闭环及 Pi Desk 受控退出。P0–P6 当前本机范围已交付；不发布生产、不做 Electron 发布、不安装用户日常软件、不迁移历史数据。实现、验证、PR/合并、归档与运行结果分别记录，文件存在或 OpenSpec 校验成功不等于生产或用户版完成。

[设计与取舍](design.md)维护具体做法；[实施任务](tasks.md)维护依赖和完成条件。本文不另列一份重复任务账本。
