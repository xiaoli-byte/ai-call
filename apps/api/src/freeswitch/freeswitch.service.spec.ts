import { Logger } from '@nestjs/common';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createServer, type Socket } from 'node:net';
import {
  FreeSwitchError,
  FreeSwitchService,
} from './freeswitch.service.js';

const ATTEMPT_ID = '52ccf8b0-6b2c-4c77-95e3-d10685443db8';
const TASK_ID = '663f2f5d-3b6e-4f82-991d-40151467eaee';
const JOB_ID = '410a1e24-bd0f-479f-aa39-2f13c056860c';
const OTHER_JOB_ID = '9caf9491-4f07-4c47-8e55-456c5049c70a';

const ENV_KEYS = [
  'FREESWITCH_ESL_HOST',
  'FREESWITCH_ESL_PORT',
  'FREESWITCH_ESL_PASSWORD',
  'FREESWITCH_ESL_COMMAND_TIMEOUT_MS',
  'FREESWITCH_DIAL_STRING',
  'FREESWITCH_AUDIO_FORK_ENABLED',
  'FREESWITCH_AUDIO_FORK_URL',
  'FREESWITCH_AUDIO_MODULE',
  'VOICE_AGENT_WS_TOKEN',
  'FROM_NUMBER',
] as const;
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('FreeSwitchService originate', () => {
  it('parses a fragmented Reply-Text Job UUID and sends correlation variables', async () => {
    await withEslServer(
      {
        fragmentWrites: true,
        respond: () => ({
          type: 'command/reply',
          replyText: `+OK Job-UUID: ${JOB_ID}`,
        }),
      },
      async (port, commands) => {
        configureEnv(port);
        const service = new FreeSwitchService();

        const result = await service.originate('1001', ATTEMPT_ID, TASK_ID);

        assert.deepEqual(result, {
          accepted: true,
          jobId: JOB_ID,
          replyText: `+OK Job-UUID: ${JOB_ID}`,
        });
        assert.equal(commands.length, 1);
        assert.match(commands[0], /^bgapi originate /);
        assert.match(commands[0], /user\/1001/);
        assert.match(commands[0], new RegExp(`origination_uuid=${ATTEMPT_ID}`));
        assert.match(commands[0], new RegExp(`attempt_id=${ATTEMPT_ID}`));
        assert.match(commands[0], new RegExp(`task_id=${TASK_ID}`));
        assert.match(commands[0], /ai_call_managed=true/);
      },
    );
  });

  it('prefers an independent Job-UUID header', async () => {
    await withEslServer(
      {
        respond: () => ({
          type: 'command/reply',
          replyText: `+OK Job-UUID: ${OTHER_JOB_ID}`,
          headers: { 'Job-UUID': JOB_ID },
        }),
      },
      async (port) => {
        configureEnv(port);
        const result = await new FreeSwitchService().originate(
          '1001',
          ATTEMPT_ID,
          TASK_ID,
        );
        assert.equal(result.jobId, JOB_ID);
      },
    );
  });

  it('rejects +OK without a Job UUID as a non-retryable typed error', async () => {
    await withEslServer(
      {
        respond: () => ({ type: 'command/reply', replyText: '+OK accepted' }),
      },
      async (port) => {
        configureEnv(port);
        await assert.rejects(
          () => new FreeSwitchService().originate('1001', ATTEMPT_ID, TASK_ID),
          (error) => error instanceof FreeSwitchError
            && error.code === 'MISSING_JOB_UUID'
            && error.retryable === false,
        );
      },
    );
  });

  it('classifies deterministic command rejection without exposing the raw reply', async () => {
    await withEslServer(
      {
        respond: () => ({
          type: 'command/reply',
          replyText: '-ERR USER_NOT_REGISTERED destination=1001',
        }),
      },
      async (port) => {
        configureEnv(port);
        let caught: unknown;
        try {
          await new FreeSwitchService().originate('1001', ATTEMPT_ID, TASK_ID);
        } catch (error) {
          caught = error;
        }
        assert(caught instanceof FreeSwitchError);
        assert.equal(caught.code, 'COMMAND_REJECTED');
        assert.equal(caught.providerCode, 'USER_NOT_REGISTERED');
        assert.equal(caught.retryable, false);
        assert.doesNotMatch(caught.message, /destination=1001/);
      },
    );
  });

  it('does not promote arbitrary reply text into a public provider code', async () => {
    await withEslServer(
      {
        respond: () => ({
          type: 'command/reply',
          replyText: '-ERR VOICE_AGENT_SECRET_VALUE',
        }),
      },
      async (port) => {
        configureEnv(port);
        let caught: unknown;
        try {
          await new FreeSwitchService().originate('1001', ATTEMPT_ID, TASK_ID);
        } catch (error) {
          caught = error;
        }
        assert(caught instanceof FreeSwitchError);
        assert.equal(caught.providerCode, 'UNKNOWN');
        assert.doesNotMatch(caught.message, /VOICE_AGENT_SECRET_VALUE/);
      },
    );
  });

  it('keeps audio metadata and rejected reply details out of errors and logs', async () => {
    const token = 'voice-agent-secret';
    const rejectedDetail = 'do-not-leak-reply-detail';
    const logs: unknown[][] = [];
    const loggerPrototype = Logger.prototype as unknown as {
      log: (...args: unknown[]) => void;
    };
    const originalLog = loggerPrototype.log;
    loggerPrototype.log = (...args: unknown[]) => { logs.push(args); };

    try {
      await withEslServer(
        {
          respond: () => ({
            type: 'command/reply',
            replyText: `-ERR UNKNOWN ${rejectedDetail}`,
          }),
        },
        async (port) => {
          configureEnv(port);
          process.env.FREESWITCH_AUDIO_FORK_ENABLED = 'true';
          process.env.FREESWITCH_AUDIO_FORK_URL =
            'ws://127.0.0.1:8090/audio-stream-private';
          process.env.VOICE_AGENT_WS_TOKEN = token;
          let caught: unknown;
          try {
            await new FreeSwitchService().originate('1001', ATTEMPT_ID, TASK_ID);
          } catch (error) {
            caught = error;
          }

          assert(caught instanceof FreeSwitchError);
          const observable = `${caught.message}\n${JSON.stringify(logs)}`;
          assert.doesNotMatch(observable, new RegExp(token));
          assert.doesNotMatch(observable, new RegExp(rejectedDetail));
          assert.doesNotMatch(observable, /audio-stream-private/);
          assert.doesNotMatch(observable, /base64:/);
        },
      );
    } finally {
      loggerPrototype.log = originalLog;
    }
  });
});

describe('FreeSwitchService command connection', () => {
  it('returns byte-safe API response bodies for call controls', async () => {
    await withEslServer(
      {
        fragmentWrites: true,
        respond: () => ({ type: 'api/response', body: '+OK 已挂断' }),
      },
      async (port, commands) => {
        configureEnv(port);
        const result = await new FreeSwitchService().hangup(ATTEMPT_ID);
        assert.equal(result, '+OK 已挂断');
        assert.match(commands[0], /^api uuid_kill /);
      },
    );
  });

  it('strictly validates auth/request and auth command replies', async () => {
    await withEslServer(
      {
        authContentType: 'command/reply',
        respond: () => ({ type: 'api/response', body: '+OK' }),
      },
      async (port) => {
        configureEnv(port);
        await assert.rejects(
          () => new FreeSwitchService().hangup(ATTEMPT_ID),
          (error) => error instanceof FreeSwitchError
            && error.code === 'PROTOCOL_ERROR'
            && error.retryable === false,
        );
      },
    );

    await withEslServer(
      {
        authReplyText: '-ERR invalid',
        respond: () => ({ type: 'api/response', body: '+OK' }),
      },
      async (port) => {
        configureEnv(port);
        await assert.rejects(
          () => new FreeSwitchService().hangup(ATTEMPT_ID),
          (error) => error instanceof FreeSwitchError
            && error.code === 'AUTH_FAILED'
            && error.retryable === false,
        );
      },
    );
  });

  it('rejects an unexpected target Content-Type', async () => {
    await withEslServer(
      {
        respond: () => ({ type: 'command/reply', replyText: '+OK' }),
      },
      async (port) => {
        configureEnv(port);
        await assert.rejects(
          () => new FreeSwitchService().hangup(ATTEMPT_ID),
          (error) => error instanceof FreeSwitchError
            && error.code === 'PROTOCOL_ERROR',
        );
      },
    );
  });

  it('classifies early disconnect and timeout as retryable', async () => {
    await withEslServer(
      {
        closeAfterAuth: true,
        respond: () => ({ type: 'api/response', body: '+OK' }),
      },
      async (port) => {
        configureEnv(port);
        await assert.rejects(
          () => new FreeSwitchService().hangup(ATTEMPT_ID),
          (error) => error instanceof FreeSwitchError
            && error.code === 'CONNECTION_CLOSED'
            && error.retryable,
        );
      },
    );

    await withEslServer(
      {
        respond: () => ({ type: 'none' }),
      },
      async (port) => {
        configureEnv(port);
        process.env.FREESWITCH_ESL_COMMAND_TIMEOUT_MS = '20';
        await assert.rejects(
          () => new FreeSwitchService().hangup(ATTEMPT_ID),
          (error) => error instanceof FreeSwitchError
            && error.code === 'TIMEOUT'
            && error.retryable,
        );
      },
    );
  });

  it('validates UUID and extension inputs before writing an ESL command', async () => {
    const service = new FreeSwitchService();
    for (const run of [
      () => service.hangup(`${ATTEMPT_ID}\napi status`),
      () => service.transfer(ATTEMPT_ID, '1001\napi status'),
      () => service.transfer('not-a-uuid', '1001'),
    ]) {
      await assert.rejects(
        run,
        (error) => error instanceof FreeSwitchError
          && error.code === 'INVALID_INPUT'
          && error.retryable === false,
      );
    }
  });
});

describe('FreeSwitchService listActiveChannelIds', () => {
  it('returns an empty set for zero active channels', async () => {
    await withEslServer(
      {
        respond: () => ({
          type: 'api/response',
          body: JSON.stringify({ row_count: 0 }),
        }),
      },
      async (port, commands) => {
        configureEnv(port);
        const ids = await new FreeSwitchService().listActiveChannelIds();
        assert.deepEqual([...ids], []);
        assert.equal(commands[0], 'api show channels as json');
      },
    );
  });

  it('returns a de-duplicated set for multiple active channels', async () => {
    const first = '5b04f224-3b6c-4bc9-aae4-55c1ac06f10e';
    const second = 'f2ebff34-f0ee-431d-ab82-830e5ba6ba2d';
    await withEslServer(
      {
        respond: () => ({
          type: 'api/response',
          body: JSON.stringify({
            row_count: 3,
            rows: [{ uuid: first }, { uuid: second }, { uuid: first }],
          }),
        }),
      },
      async (port) => {
        configureEnv(port);
        const ids = await new FreeSwitchService().listActiveChannelIds();
        assert.deepEqual([...ids], [first, second]);
      },
    );
  });

  it('rejects malformed JSON without echoing the response', async () => {
    const sensitiveBody = '{not-json:voice-agent-secret}';
    await withEslServer(
      {
        respond: () => ({ type: 'api/response', body: sensitiveBody }),
      },
      async (port) => {
        configureEnv(port);
        let caught: unknown;
        try {
          await new FreeSwitchService().listActiveChannelIds();
        } catch (error) {
          caught = error;
        }
        assert(caught instanceof FreeSwitchError);
        assert.equal(caught.code, 'INVALID_RESPONSE');
        assert.doesNotMatch(caught.message, /voice-agent-secret/);
      },
    );
  });
});

function configureEnv(port: number): void {
  process.env.FREESWITCH_ESL_HOST = '127.0.0.1';
  process.env.FREESWITCH_ESL_PORT = String(port);
  process.env.FREESWITCH_ESL_PASSWORD = 'ClueCon';
  process.env.FREESWITCH_DIAL_STRING = 'user/{to}';
  process.env.FREESWITCH_AUDIO_FORK_ENABLED = 'false';
}

type EslCommandResponse =
  | { type: 'api/response'; body: string }
  | {
    type: 'command/reply';
    replyText: string;
    headers?: Record<string, string>;
  }
  | { type: 'none' };

interface EslScenario {
  authContentType?: string;
  authReplyText?: string;
  closeAfterAuth?: boolean;
  fragmentWrites?: boolean;
  respond(command: string): EslCommandResponse;
}

async function withEslServer(
  scenario: EslScenario,
  run: (port: number, commands: string[]) => Promise<void>,
): Promise<void> {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handleEslSocket(socket, scenario, commands);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  try {
    await run(address.port, commands);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function handleEslSocket(
  socket: Socket,
  scenario: EslScenario,
  commands: string[],
): void {
  let stage: 'auth' | 'command' = 'auth';
  let buffer = '';
  writeServerFrame(
    socket,
    Buffer.from(`Content-Type: ${scenario.authContentType ?? 'auth/request'}\n\n`),
    scenario.fragmentWrites,
  );

  socket.on('data', (data) => {
    buffer += data.toString('utf8');
    while (true) {
      const end = buffer.indexOf('\n\n');
      if (end === -1) return;
      const command = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 2);

      if (stage === 'auth') {
        assert.equal(command, 'auth ClueCon');
        if (scenario.closeAfterAuth) {
          socket.end();
          return;
        }
        stage = 'command';
        writeServerFrame(
          socket,
          Buffer.from(
            'Content-Type: command/reply\n'
            + `Reply-Text: ${scenario.authReplyText ?? '+OK accepted'}\n\n`,
          ),
          scenario.fragmentWrites,
        );
        continue;
      }

      commands.push(command);
      const response = scenario.respond(command);
      if (response.type === 'none') continue;
      if (response.type === 'api/response') {
        const body = Buffer.from(response.body);
        writeServerFrame(
          socket,
          Buffer.concat([
            Buffer.from(
              'Content-Type: api/response\n'
              + `Content-Length: ${body.length}\n\n`,
            ),
            body,
          ]),
          scenario.fragmentWrites,
        );
        continue;
      }

      const extraHeaders = Object.entries(response.headers ?? {})
        .map(([name, value]) => `${name}: ${value}\n`)
        .join('');
      writeServerFrame(
        socket,
        Buffer.from(
          'Content-Type: command/reply\n'
          + `Reply-Text: ${response.replyText}\n`
          + `${extraHeaders}\n`,
        ),
        scenario.fragmentWrites,
      );
    }
  });
}

function writeServerFrame(
  socket: Socket,
  bytes: Buffer,
  fragmented = false,
): void {
  if (!fragmented) {
    socket.write(bytes);
    return;
  }

  let offset = 0;
  const writeNextByte = (): void => {
    if (offset >= bytes.length || socket.destroyed) return;
    socket.write(bytes.subarray(offset, offset + 1));
    offset += 1;
    setImmediate(writeNextByte);
  };
  writeNextByte();
}
