import { Injectable, Logger } from '@nestjs/common';
import { Socket, connect } from 'node:net';

/**
 * FreeSWITCH ESL (Event Socket Library) 客户端
 *
 * 通过 TCP 连接 FreeSWITCH 的 mod_event_socket，发送 originate 命令发起外呼。
 *
 * ESL 协议（文本行 + 空行分隔）：
 *   1. 连接后服务端发 Content-Type: auth/request
 *   2. 客户端发 auth <password>
 *   3. 服务端回 Content-Type: command/reply / Reply-Text: +OK
 *   4. 客户端发 api <command> <args>
 *   5. 服务端回 Content-Type: api/response + Content-Length + body
 *
 * 配置（环境变量）：
 *   FREESWITCH_ESL_HOST - FreeSWITCH 主机（默认 localhost）
 *   FREESWITCH_ESL_PORT - ESL 端口（默认 8021）
 *   FREESWITCH_ESL_PASSWORD - 密码（默认 ClueCon）
 *   FREESWITCH_GATEWAY - SIP 网关名（默认 default）
 *   FREESWITCH_CONTEXT - 拨号上下文（默认 default）
 *
 * originate 呼叫流程：
 *   API dispatch() → ESL originate → FreeSWITCH 拨号 → 应答后执行 dialplan
 *   → dialplan 触发 mod_audio_fork → Voice Agent WebSocket
 */
@Injectable()
export class FreeSwitchService {
  private readonly logger = new Logger(FreeSwitchService.name);
  private readonly host: string;
  private readonly port: number;
  private readonly password: string;
  private readonly gateway: string;
  private readonly context: string;

  constructor() {
    this.host = process.env.FREESWITCH_ESL_HOST ?? 'localhost';
    this.port = Number(process.env.FREESWITCH_ESL_PORT ?? 8021);
    this.password = process.env.FREESWITCH_ESL_PASSWORD ?? 'ClueCon';
    this.gateway = process.env.FREESWITCH_GATEWAY ?? 'default';
    this.context = process.env.FREESWITCH_CONTEXT ?? 'default';
  }

  /**
   * 发起外呼
   *
   * @param to 被叫号码（E.164 或本地号码）
   * @param callId 通话 UUID（用于 FreeSWITCH channel 和后续状态追踪）
   * @returns FreeSWITCH originate 命令的响应
   */
  async originate(to: string, callId: string): Promise<string> {
    // originate 命令格式：
    //   originate {gateway}/{number} &xml({context}) inline
    // 通过 &xml 触发 dialplan 中的 audio_fork 扩展
    const callerId = process.env.FROM_NUMBER ?? '+10000000000';
    const target = `{origination_uuid=${callId},origination_caller_id_number=${callerId}}sofia/gateway/${this.gateway}/${to}`;
    const cmd = `originate ${target} &xml(${this.context}) inline`;

    this.logger.log(`originate callId=${callId} to=${to} via ${this.gateway}`);
    return this.sendApiCommand(cmd);
  }

  /**
   * 挂断通话
   *
   * @param callId 通话 UUID
   */
  async hangup(callId: string): Promise<string> {
    this.logger.log(`hangup callId=${callId}`);
    return this.sendApiCommand(`uuid_kill ${callId} NORMAL_CLEARING`);
  }

  /**
   * 转接到指定分机（如转人工 9000）
   *
   * @param callId 通话 UUID
   * @param extension 目标分机号
   */
  async transfer(callId: string, extension: string): Promise<string> {
    this.logger.log(`transfer callId=${callId} to ${extension}`);
    return this.sendApiCommand(
      `uuid_transfer ${callId} ${extension} XML ${this.context}`,
    );
  }

  /**
   * 发送 ESL api 命令并等待响应
   *
   * 每次调用建立独立连接（简化实现，避免连接状态管理）。
   * 高并发场景可改为连接池。
   */
  private sendApiCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket: Socket = connect(this.port, this.host);
      let buffer = '';
      let authenticated = false;
      let commandSent = false;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`ESL command timeout: ${command}`));
      }, 5000);

      socket.on('data', (data: Buffer) => {
        buffer += data.toString();

        // 阶段 1：等待 auth/request
        if (!authenticated) {
          if (buffer.includes('auth/request')) {
            socket.write(`auth ${this.password}\n\n`);
            buffer = '';
            authenticated = true;
          }
          return;
        }

        // 阶段 2：等待 auth 成功
        if (!commandSent) {
          if (buffer.includes('+OK')) {
            socket.write(`api ${command}\n\n`);
            buffer = '';
            commandSent = true;
          } else if (buffer.includes('-ERR')) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`ESL auth failed`));
          }
          return;
        }

        // 阶段 3：等待 api 响应
        // 响应格式：Content-Type: api/response\nContent-Length: N\n\n<body>
        const bodyMatch = buffer.match(
          /Content-Type:\s*api\/response[\s\S]*?Content-Length:\s*(\d+)\n\n([\s\S]*)/,
        );
        if (bodyMatch) {
          clearTimeout(timeout);
          const expectedLen = Number(bodyMatch[1]);
          const body = bodyMatch[2];
          if (body.length >= expectedLen) {
            socket.destroy();
            resolve(body.slice(0, expectedLen).trim());
          }
        } else if (buffer.includes('-ERR')) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`ESL command failed: ${buffer}`));
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`ESL connection error: ${err.message}`));
      });
    });
  }
}
