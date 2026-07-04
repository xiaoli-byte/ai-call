# 外呼流程管理业务流程图

本文档基于当前项目实现，梳理外呼流程的配置发布、任务执行和 Python 对话引擎节点执行过程。

## 1. 流程配置与发布

```mermaid
flowchart TD
    A["管理员进入流程编辑器"] --> B{"新建或复制流程"}
    B --> C["创建 Draft 草稿"]
    C --> D["配置流程节点与连线"]

    D --> D1["Start 开始"]
    D --> D2["Dialog 话术 / 提问 / AI"]
    D --> D3["Decision 条件 / 意图判断"]
    D --> D4["Action 转人工 / 短信 / CRM / API"]
    D --> D5["End 完成 / 挂机"]

    D --> E["保存草稿"]
    E --> F{"发布流程"}
    F --> G["校验节点、连线、分支和可达性"]
    G -->|校验失败| D
    G -->|校验通过| H["生成不可变 TaskFlowVersion 快照"]
    H --> I["流程状态变为 Published"]

    I --> J{"后续操作"}
    J -->|修改已发布流程| C
    J -->|归档| K["Archived，不再编辑"]
    J -->|复制| C
```

发布时执行以下结构校验：

- 只能存在一个开始节点。
- 至少存在一个结束节点。
- 非结束节点必须具有出口。
- 判断节点至少具有两个带标签的分支。
- 意图判断节点的分支需要覆盖配置的意图。
- 所有节点必须能够从开始节点到达。

任务创建后绑定具体的 `TaskFlowVersion`，因此后续修改流程不会影响已经创建的外呼任务。

## 2. 外呼任务执行主流程

```mermaid
flowchart TD
    A["运营人员创建外呼任务"] --> B{"是否绑定流程"}
    B -->|是| C["绑定最新 Published 流程版本"]
    B -->|否| D["使用内置 Scenario 兼容模式"]
    C --> E["任务状态 Pending"]
    D --> E

    E --> F["运营人员点击派发"]
    F --> G["NestJS 事务处理"]
    G --> G1["任务状态改为 Calling"]
    G --> G2["创建 CallAttempt"]
    G --> G3["记录 dispatch_requested 事件"]
    G --> G4["写入 OutboxEvent"]

    G4 --> H["Outbox Worker 抢占事件"]
    H --> I["FreeSWITCH ESL originate"]

    I -->|派发失败| J{"达到最大重试次数？"}
    J -->|否| K["指数退避，重新进入 Pending"]
    K --> H
    J -->|是| L["Task / Attempt 标记 Failed"]

    I -->|派发成功| M["记录 dispatch_accepted"]
    M --> N["FreeSWITCH 呼叫用户"]

    N -->|未接听| O["No Answer / Failed"]
    O -->|允许再次派发| F

    N -->|接听| P["状态更新为 In Call"]
    P --> Q["连接 Python Voice Agent"]
    Q --> R["按 attemptId 获取任务上下文"]
    R --> S["加载任务绑定的流程版本快照"]
    S --> T["执行流程节点"]
    T --> U["持续上报转写、状态和事件"]

    U --> V{"流程结果"}
    V -->|正常结束| W["Completed + Outcome"]
    V -->|转人工| X["FreeSWITCH uuid_transfer"]
    V -->|主动挂机| Y["NestJS 挂机并计算时长"]
    V -->|运行异常| Z["Failed / 异常事件"]
```

任务与拨打尝试分开管理：一个 `OutboundTask` 可以产生多个 `CallAttempt`，每次派发都有独立的尝试编号、状态、时长和失败原因。

## 3. Python 对话引擎节点执行

```mermaid
flowchart LR
    A["Start"] --> B{"Dialog"}

    B -->|Script| B1["播放固定话术"]
    B -->|Question| B2["播放问题并等待回答"]
    B -->|AI| B3["等待输入 → LLM → TTS 回复"]

    B1 --> C["下一个节点"]
    B2 --> C
    B3 --> C

    C --> D{"Decision"}
    D -->|Condition| D1["表达式判断"]
    D -->|Intent| D2["关键词匹配"]
    D2 -->|未匹配| D3["LLM 意图分类"]
    D1 --> E["选择对应分支"]
    D2 --> E
    D3 --> E

    E --> F{"Action"}
    F -->|Transfer| F1["NestJS → FreeSWITCH 转人工"]
    F -->|SMS| F2["写 Outbox → 短信网关"]
    F -->|API| F3["写 Outbox → Webhook"]
    F -->|CRM| F4["Python Tool 调用"]

    F1 --> G["End"]
    F2 --> G
    F3 --> G
    F4 --> G

    G -->|Complete| H["结束对话并上报 Outcome"]
    G -->|Hangup| I["播放告别语 → 挂机 → 完成任务"]
```

职责边界如下：

- NestJS 是控制面，负责流程版本、任务状态、事件、外呼派发和可靠动作投递。
- Python Voice Agent 是执行面，负责 ASR、LLM、TTS、会话状态和流程节点编排。
- FreeSWITCH 负责呼叫控制、媒体通道、转接和挂机。
- PostgreSQL 保存流程快照、任务、拨打尝试、转写、事件和 Outbox 数据。

## 4. 当前实现注意项

1. `scheduledAt` 会由 API 进程内的 `TaskSchedulerService` 扫描，到点的 `pending` 任务自动进入 `dispatch()`，并写入 `CallAttempt` 与 `OutboxEvent`。可通过 `TASK_SCHEDULER_ENABLED=false` 关闭。
2. 转人工节点中的 `extension` / `queueId` 会经 Python FlowExecutor、WebSocketCallbacks 传递到 NestJS `POST /tasks/:id/transfer`，未配置时才回落到默认分机 `9000`。
3. 流程 `hangup` 结束节点会调用 NestJS `POST /tasks/:id/hangup`；NestJS 尝试执行 FreeSWITCH `uuid_kill`，并在数据库记录 `completed`、时长和 `call.hung_up` 事件。Python 客户端兼容同步 `200` 和异步 `202`。

## 5. 主要代码位置

- 流程管理：`apps/api/src/task-flows/task-flows.service.ts`
- 流程发布校验：`packages/shared/src/flow-validation.ts`
- 外呼任务控制：`apps/api/src/tasks/tasks.service.ts`
- 可靠事件投递：`apps/api/src/tasks/outbox.worker.ts`
- Python 流程执行器：`services/voice-agent/src/voice_agent/flow_executor.py`
- Python 会话入口：`services/voice-agent/src/voice_agent/agent.py`
- 数据模型：`apps/api/prisma/schema.prisma`

## 6. 自动化验证

无真实线路时可先跑控制面闭环 smoke test，验证创建任务、锁定流程版本、到点派发、Outbox 投递、接通状态、转写、转人工和挂机事件：

```bash
pnpm test:outbound-flow
```

或直接运行：

```bash
I:\ai-call\apps\api\node_modules\.bin\tsx.CMD --test I:\ai-call\apps\api\src\tasks\outbound-business-flow.spec.ts
```

完整回归建议同时运行：

```bash
I:\ai-call\node_modules\.bin\tsc.CMD -p I:\ai-call\apps\api\tsconfig.json --noEmit
I:\ai-call\apps\api\node_modules\.bin\tsx.CMD --test I:\ai-call\apps\api\src\**\*.spec.ts
python -m pytest services/voice-agent/tests/test_vad.py services/voice-agent/tests/test_server_callbacks.py services/voice-agent/tests/test_agent.py -q
```

其中 `services/voice-agent/tests/test_server_callbacks.py` 覆盖 FreeSWITCH `attemptId`
进入 `/audio-stream` 后，Voice Agent 拉任务上下文、回写 `in_call`、执行锁定流程并触发
`transfer` / `hangup` 的服务级链路。

服务启动后可运行本机 runtime smoke，检查 PostgreSQL、API、Dashboard、Voice Agent、
FunASR、FreeSWITCH ESL 端口，并通过 API 创建一个绑定已发布流程的 `1001` 外呼任务：

```bash
pnpm smoke:outbound-runtime
```

如果只想检查端口，不创建任务：

```bash
powershell -ExecutionPolicy Bypass -File scripts/outbound-runtime-check.ps1 -SkipTask
```

默认使用 seed 管理员 `admin@ai-call.local` / `admin123` 登录；可通过
`-AdminEmail`、`-AdminPassword`、`-To` 和 `-DispatchNow` 覆盖。
