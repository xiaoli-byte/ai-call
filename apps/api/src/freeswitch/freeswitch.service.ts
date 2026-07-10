import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'node:net';
import {
  EslFrameParser,
  getEslHeader,
  getEslHeaderValues,
  type EslFrame,
} from './esl-frame-parser.js';
import {
  FreeSwitchError,
  rejectedCommandError,
  type FreeSwitchOperation,
} from './freeswitch-errors.js';

export { FreeSwitchError } from './freeswitch-errors.js';

export interface FreeSwitchOriginateResult {
  accepted: true;
  jobId: string;
  replyText: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINATION_PATTERN = /^[0-9+*#-]+$/;
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

@Injectable()
export class FreeSwitchService {
  private readonly logger = new Logger(FreeSwitchService.name);
  private readonly host: string;
  private readonly port: number;
  private readonly password: string;
  private readonly gateway: string;
  private readonly context: string;
  private readonly dialString: string;
  private readonly audioForkEnabled: boolean;
  private readonly audioForkUrl: string;
  private readonly audioModule: 'audio_fork' | 'audio_stream';
  private readonly commandTimeoutMs: number;

  constructor() {
    this.host = process.env.FREESWITCH_ESL_HOST ?? 'localhost';
    this.port = Number(process.env.FREESWITCH_ESL_PORT ?? 8021);
    this.password = process.env.FREESWITCH_ESL_PASSWORD ?? 'ClueCon';
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535
      || !safeConfigurationValue(this.password)) {
      throw new FreeSwitchError({
        operation: 'connect',
        code: 'INVALID_CONFIGURATION',
        retryable: false,
      });
    }
    this.gateway = process.env.FREESWITCH_GATEWAY ?? 'default';
    this.context = process.env.FREESWITCH_CONTEXT ?? 'default';
    this.dialString = process.env.FREESWITCH_DIAL_STRING
      ?? `sofia/gateway/${this.gateway}/{to}`;
    this.audioForkEnabled =
      process.env.FREESWITCH_AUDIO_FORK_ENABLED === 'true';
    this.audioForkUrl = process.env.FREESWITCH_AUDIO_FORK_URL
      ?? 'ws://127.0.0.1:8090/audio-stream';
    const audioModule = process.env.FREESWITCH_AUDIO_MODULE ?? 'audio_fork';
    if (audioModule !== 'audio_fork' && audioModule !== 'audio_stream') {
      throw new FreeSwitchError({
        operation: 'originate',
        code: 'INVALID_CONFIGURATION',
        retryable: false,
      });
    }
    this.audioModule = audioModule;
    this.commandTimeoutMs = commandTimeoutMs(
      process.env.FREESWITCH_ESL_COMMAND_TIMEOUT_MS,
    );
  }

  async originate(
    to: string,
    attemptId: string,
    taskId: string,
  ): Promise<FreeSwitchOriginateResult> {
    validateDestination(to, 'originate');
    validateUuid(attemptId, 'originate');
    validateUuid(taskId, 'originate');
    this.validateOriginateConfiguration();

    const callerId = process.env.FROM_NUMBER ?? '+10000000000';
    if (!DESTINATION_PATTERN.test(callerId)) {
      throw new FreeSwitchError({
        operation: 'originate',
        code: 'INVALID_CONFIGURATION',
        retryable: false,
      });
    }

    const channelVariables = [
      `origination_uuid=${attemptId}`,
      `origination_caller_id_number=${callerId}`,
      `attempt_id=${attemptId}`,
      `task_id=${taskId}`,
      'ai_call_managed=true',
    ];

    if (this.audioForkEnabled) {
      const apiCommand = this.audioModule === 'audio_stream'
        ? 'uuid_audio_stream'
        : 'uuid_audio_fork';
      const responseFormat = this.audioModule === 'audio_stream'
        ? 'base64-json'
        : 'esl-file';
      const metadata = Buffer.from(JSON.stringify({
        dialog_id: attemptId,
        audio_response_format: responseFormat,
        ...(process.env.VOICE_AGENT_WS_TOKEN
          ? { token: process.env.VOICE_AGENT_WS_TOKEN }
          : {}),
      })).toString('base64');
      channelVariables.push('STREAM_PLAYBACK=true', 'STREAM_SAMPLE_RATE=16000');
      channelVariables.push(
        `api_on_answer='${apiCommand} ${attemptId} start ${this.audioForkUrl} mono 16k base64:${metadata}'`,
      );
    }

    const endpoint = this.dialString.replace('{to}', to);
    const target = `{${channelVariables.join(',')}}${endpoint}`;
    const command = `originate ${target} &park()`;

    this.logger.log(
      `FreeSWITCH originate taskId=${taskId} attemptId=${attemptId}`,
    );
    const frame = await this.sendEslCommand(
      `bgapi ${command}`,
      'command/reply',
      'originate',
    );
    const replyText = requiredReplyText(frame, 'originate');
    const jobId = jobIdFromReply(frame, replyText);
    if (!jobId) {
      throw new FreeSwitchError({
        operation: 'originate',
        code: 'MISSING_JOB_UUID',
        retryable: false,
      });
    }

    return { accepted: true, jobId, replyText };
  }

  async hangup(callId: string): Promise<string> {
    validateUuid(callId, 'hangup');
    this.logger.log(`FreeSWITCH hangup callId=${callId}`);
    return this.sendApiCommand(
      `uuid_kill ${callId} NORMAL_CLEARING`,
      'hangup',
    );
  }

  async transfer(callId: string, extension: string): Promise<string> {
    validateUuid(callId, 'transfer');
    validateDestination(extension, 'transfer');
    if (!safeConfigurationValue(this.context)) {
      throw new FreeSwitchError({
        operation: 'transfer',
        code: 'INVALID_CONFIGURATION',
        retryable: false,
      });
    }
    this.logger.log(`FreeSWITCH transfer callId=${callId}`);
    return this.sendApiCommand(
      `uuid_transfer ${callId} ${extension} XML ${this.context}`,
      'transfer',
    );
  }

  async listActiveChannelIds(): Promise<Set<string>> {
    const response = await this.sendApiCommand(
      'show channels as json',
      'list-active-channels',
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(response);
    } catch {
      throw invalidResponse('list-active-channels');
    }

    if (!isRecord(parsed)) throw invalidResponse('list-active-channels');
    const rows = parsed.rows;
    if (rows === undefined && parsed.row_count === 0) return new Set();
    if (!Array.isArray(rows)) throw invalidResponse('list-active-channels');

    const ids = new Set<string>();
    for (const row of rows) {
      if (!isRecord(row) || typeof row.uuid !== 'string'
        || !UUID_PATTERN.test(row.uuid)) {
        throw invalidResponse('list-active-channels');
      }
      ids.add(row.uuid);
    }
    return ids;
  }

  private validateOriginateConfiguration(): void {
    if (!this.dialString.includes('{to}')
      || !safeConfigurationValue(this.dialString)
      || !safeConfigurationValue(this.audioForkUrl)
      || this.audioForkUrl.includes("'")) {
      throw new FreeSwitchError({
        operation: 'originate',
        code: 'INVALID_CONFIGURATION',
        retryable: false,
      });
    }
  }

  private async sendApiCommand(
    command: string,
    operation: FreeSwitchOperation,
  ): Promise<string> {
    const frame = await this.sendEslCommand(
      `api ${command}`,
      'api/response',
      operation,
    );
    const response = frame.body.toString('utf8').trim();
    if (/^-ERR\b/i.test(response)) {
      throw rejectedCommandError(operation, response);
    }
    return response;
  }

  private sendEslCommand(
    wireCommand: string,
    responseType: 'api/response' | 'command/reply',
    operation: FreeSwitchOperation,
  ): Promise<EslFrame> {
    return new Promise((resolve, reject) => {
      const parser = new EslFrameParser();
      const socket = new Socket();
      let state: 'auth-request' | 'auth-reply' | 'response' = 'auth-request';
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new FreeSwitchError({
          operation,
          code: 'TIMEOUT',
          retryable: true,
        }));
      }, this.commandTimeoutMs);

      const fail = (error: FreeSwitchError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      };
      const succeed = (frame: EslFrame): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(frame);
      };
      const write = (value: string): boolean => {
        try {
          socket.write(value);
          return true;
        } catch {
          fail(new FreeSwitchError({
            operation,
            code: 'CONNECTION_FAILED',
            retryable: true,
          }));
          return false;
        }
      };

      socket.on('data', (data: Buffer) => {
        if (settled) return;
        let frames: EslFrame[];
        try {
          frames = parser.push(data);
        } catch {
          fail(new FreeSwitchError({
            operation,
            code: 'PROTOCOL_ERROR',
            retryable: false,
          }));
          return;
        }

        for (const frame of frames) {
          if (settled) return;
          if (state === 'auth-request') {
            if (!hasContentType(frame, 'auth/request')) {
              fail(protocolError(operation));
              return;
            }
            state = 'auth-reply';
            if (!write(`auth ${this.password}\n\n`)) return;
            continue;
          }

          if (state === 'auth-reply') {
            if (!hasContentType(frame, 'command/reply')) {
              fail(protocolError(operation));
              return;
            }
            const replyText = getEslHeader(frame.headers, 'Reply-Text');
            if (!replyText || !/^\+OK\b/i.test(replyText.trim())) {
              fail(new FreeSwitchError({
                operation,
                code: 'AUTH_FAILED',
                retryable: false,
              }));
              return;
            }
            state = 'response';
            if (!write(`${wireCommand}\n\n`)) return;
            continue;
          }

          if (!hasContentType(frame, responseType)) {
            fail(protocolError(operation));
            return;
          }
          if (responseType === 'command/reply') {
            const replyText = getEslHeader(frame.headers, 'Reply-Text');
            if (!replyText) {
              fail(protocolError(operation));
              return;
            }
            if (/^-ERR\b/i.test(replyText.trim())) {
              fail(rejectedCommandError(operation, replyText));
              return;
            }
            if (!/^\+OK\b/i.test(replyText.trim())) {
              fail(protocolError(operation));
              return;
            }
          }
          succeed(frame);
        }
      });

      const connectionClosed = (): void => {
        if (settled) return;
        try {
          parser.finish();
        } catch {
          // A truncated frame is still surfaced as a retryable closed connection.
        }
        fail(new FreeSwitchError({
          operation,
          code: 'CONNECTION_CLOSED',
          retryable: true,
        }));
      };
      socket.on('end', connectionClosed);
      socket.on('close', connectionClosed);
      socket.on('error', () => {
        fail(new FreeSwitchError({
          operation,
          code: 'CONNECTION_FAILED',
          retryable: true,
        }));
      });
      try {
        socket.connect(this.port, this.host);
      } catch {
        fail(new FreeSwitchError({
          operation,
          code: 'CONNECTION_FAILED',
          retryable: true,
        }));
      }
    });
  }
}

function validateUuid(value: string, operation: FreeSwitchOperation): void {
  if (!UUID_PATTERN.test(value)) {
    throw new FreeSwitchError({
      operation,
      code: 'INVALID_INPUT',
      retryable: false,
    });
  }
}

function validateDestination(
  value: string,
  operation: FreeSwitchOperation,
): void {
  if (!DESTINATION_PATTERN.test(value)) {
    throw new FreeSwitchError({
      operation,
      code: 'INVALID_INPUT',
      retryable: false,
    });
  }
}

function hasContentType(frame: EslFrame, expected: string): boolean {
  const values = getEslHeaderValues(frame.headers, 'Content-Type');
  return values.length === 1 && values[0].trim().toLowerCase() === expected;
}

function requiredReplyText(
  frame: EslFrame,
  operation: FreeSwitchOperation,
): string {
  const replyText = getEslHeader(frame.headers, 'Reply-Text');
  if (!replyText) throw protocolError(operation);
  return replyText.trim();
}

function jobIdFromReply(frame: EslFrame, replyText: string): string | undefined {
  const jobHeaders = getEslHeaderValues(frame.headers, 'Job-UUID');
  if (jobHeaders.length > 0 && jobHeaders.some((value) => value !== jobHeaders[0])) {
    return undefined;
  }
  const candidate = jobHeaders[0]
    ?? replyText.match(/(?:^|\s)Job-UUID:\s*([^\s]+)/i)?.[1];
  return candidate && JOB_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function safeConfigurationValue(value: string): boolean {
  return value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function commandTimeoutMs(value: string | undefined): number {
  const configured = Number(value ?? 5_000);
  if (!Number.isFinite(configured)) return 5_000;
  return Math.min(60_000, Math.max(10, Math.floor(configured)));
}

function protocolError(operation: FreeSwitchOperation): FreeSwitchError {
  return new FreeSwitchError({
    operation,
    code: 'PROTOCOL_ERROR',
    retryable: false,
  });
}

function invalidResponse(operation: FreeSwitchOperation): FreeSwitchError {
  return new FreeSwitchError({
    operation,
    code: 'INVALID_RESPONSE',
    retryable: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
