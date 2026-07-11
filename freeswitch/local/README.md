# 本机 FreeSWITCH 呼叫联调

1. 启动本机 FreeSWITCH：`pnpm freeswitch:local:start`。脚本只停止
   `ai-call-freeswitch` 容器，不影响 PostgreSQL、Redis 等依赖。
   首次启动会复制官方配置到 `freeswitch/runtime/conf`，并在副本中关闭
   本地联调不需要的 WSS，避免缺少 WSS 证书导致 IPv4 SIP profile 启动失败。
2. 在两个 SIP 软电话中分别注册 `1000`、`1001`：服务器为本机局域网 IP，
   SIP 端口 `5060`。**注意密码来源**：本文件描述的是「原生 Windows FreeSWITCH.exe」
   启动路径（`start.ps1` 直接复制官方安装目录下的 `conf`），配置未经改写，沿用
   官方安装包 `vars.xml` 里的默认 `default_password`，即分机默认密码仍为 `1234`。
   这与 `pnpm freeswitch:up`（Docker 编排，`scripts/microsip-local-setup.ps1`）
   不同——该路径会通过 `Get-OrCreateOutboundSipSecret` 随机生成密码并写入
   `.runtime/microsip.env`（`MICROSIP_SIP_PASSWORD`），MicroSIP 账号密码也会被
   脚本同步改写为该随机值，此时 `1234` 不再有效。若不确定当前用的是哪条路径，
   看 `.runtime/microsip.env` 是否存在且被最近使用即可判断。
3. 执行 `pnpm freeswitch:local:check`，确认两个分机均出现在 registrations 中。
4. 执行 `pnpm freeswitch:local:call -- 1001`，1001 应振铃；接听后通道保持在 park。
5. `.env` 使用 `FREESWITCH_DIAL_STRING=user/{to}` 和
   `FREESWITCH_AUDIO_FORK_ENABLED=false`，启动 API/outbox worker 后派发到 `1001`。

Windows 安装包未包含 `mod_audio_fork.dll`，所以第一阶段只验收 ESL originate、
SIP 振铃、接听、保持与挂断。基础电话跑通后，再安装该模块或切到含模块的构建，
开启 `FREESWITCH_AUDIO_FORK_ENABLED=true` 验证 Voice Agent 双向音频。
