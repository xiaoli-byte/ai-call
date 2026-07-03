# 本机 FreeSWITCH 呼叫联调

1. 启动本机 FreeSWITCH：`pnpm freeswitch:local:start`。脚本只停止
   `ai-call-freeswitch` 容器，不影响 PostgreSQL、Redis 等依赖。
   首次启动会复制官方配置到 `freeswitch/runtime/conf`，并在副本中关闭
   本地联调不需要的 WSS，避免缺少 WSS 证书导致 IPv4 SIP profile 启动失败。
2. 在两个 SIP 软电话中分别注册 `1000`、`1001`：服务器为本机局域网 IP，
   SIP 端口 `5060`，默认密码 `1234`。
3. 执行 `pnpm freeswitch:local:check`，确认两个分机均出现在 registrations 中。
4. 执行 `pnpm freeswitch:local:call -- 1001`，1001 应振铃；接听后通道保持在 park。
5. `.env` 使用 `FREESWITCH_DIAL_STRING=user/{to}` 和
   `FREESWITCH_AUDIO_FORK_ENABLED=false`，启动 API/outbox worker 后派发到 `1001`。

Windows 安装包未包含 `mod_audio_fork.dll`，所以第一阶段只验收 ESL originate、
SIP 振铃、接听、保持与挂断。基础电话跑通后，再安装该模块或切到含模块的构建，
开启 `FREESWITCH_AUDIO_FORK_ENABLED=true` 验证 Voice Agent 双向音频。
