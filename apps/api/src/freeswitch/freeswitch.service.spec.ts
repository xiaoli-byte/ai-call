import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createServer, type Socket } from 'node:net';
import { FreeSwitchService } from './freeswitch.service.js';

const ENV_KEYS = [
  'FREESWITCH_ESL_HOST',
  'FREESWITCH_ESL_PORT',
  'FREESWITCH_ESL_PASSWORD',
  'FREESWITCH_DIAL_STRING',
  'FREESWITCH_AUDIO_FORK_ENABLED',
  'FREESWITCH_AUDIO_FORK_URL',
  'FREESWITCH_AUDIO_MODULE',
  'VOICE_AGENT_WS_TOKEN',
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

describe('FreeSwitchService', () => {
  it('returns successful ESL bgapi command replies for originate', async () => {
    await withEslServer(
      { type: 'command/reply', replyText: '+OK Job-UUID: job-123' },
      async (port, commands) => {
        configureEnv(port);
        const service = new FreeSwitchService();

        const result = await service.originate(
          '1001',
          '52ccf8b0-6b2c-4c77-95e3-d10685443db8',
        );

        assert.equal(result, '+OK Job-UUID: job-123');
        assert.match(commands[0], /^bgapi originate /);
        assert.match(commands[0], /user\/1001/);
      },
    );
  });

  it('returns successful ESL api response bodies for call controls', async () => {
    await withEslServer(
      { type: 'api/response', body: '+OK' },
      async (port, commands) => {
        configureEnv(port);
        const service = new FreeSwitchService();

        const result = await service.hangup('52ccf8b0-6b2c-4c77-95e3-d10685443db8');

        assert.equal(result, '+OK');
        assert.match(commands[0], /^api uuid_kill /);
      },
    );
  });

  it('rejects ESL bgapi command replies that start with -ERR', async () => {
    await withEslServer(
      { type: 'command/reply', replyText: '-ERR NO_ROUTE_DESTINATION' },
      async (port) => {
        configureEnv(port);
        const service = new FreeSwitchService();

        await assert.rejects(
          () => service.originate('1001', '52ccf8b0-6b2c-4c77-95e3-d10685443db8'),
          /ESL command failed: -ERR NO_ROUTE_DESTINATION/,
        );
      },
    );
  });

  it('rejects ESL api response bodies that start with -ERR', async () => {
    await withEslServer({ type: 'api/response', body: '-ERR NO_ROUTE_DESTINATION' }, async (port) => {
      configureEnv(port);
      const service = new FreeSwitchService();

      await assert.rejects(
        () => service.hangup('52ccf8b0-6b2c-4c77-95e3-d10685443db8'),
        /ESL command failed: -ERR NO_ROUTE_DESTINATION/,
      );
    });
  });

  it('includes the Voice Agent token in audio fork metadata when configured', async () => {
    await withEslServer(
      { type: 'command/reply', replyText: '+OK Job-UUID: job-123' },
      async (port, commands) => {
        configureEnv(port);
        process.env.FREESWITCH_AUDIO_FORK_ENABLED = 'true';
        process.env.FREESWITCH_AUDIO_MODULE = 'audio_fork';
        process.env.FREESWITCH_AUDIO_FORK_URL = 'ws://127.0.0.1:8090/audio-stream';
        process.env.VOICE_AGENT_WS_TOKEN = 'ws-secret';
        const service = new FreeSwitchService();

        await service.originate(
          '1001',
          '52ccf8b0-6b2c-4c77-95e3-d10685443db8',
        );

        const encodedMetadata = commands[0].match(/base64:([^'\s]+)/)?.[1];
        assert(encodedMetadata);
        const metadata = JSON.parse(Buffer.from(encodedMetadata, 'base64').toString('utf8'));
        assert.equal(metadata.dialog_id, '52ccf8b0-6b2c-4c77-95e3-d10685443db8');
        assert.equal(metadata.token, 'ws-secret');
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

type EslResponse =
  | { type: 'api/response'; body: string }
  | { type: 'command/reply'; replyText: string };

async function withEslServer(
  response: EslResponse,
  run: (port: number, commands: string[]) => Promise<void>,
): Promise<void> {
  const commands: string[] = [];
  const server = createServer((socket) => handleEslSocket(socket, response, commands));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  try {
    await run(address.port, commands);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function handleEslSocket(socket: Socket, response: EslResponse, commands: string[]): void {
  let stage: 'auth' | 'api' = 'auth';
  let buffer = '';
  socket.write('Content-Type: auth/request\n\n');

  socket.on('data', (data) => {
    buffer += data.toString();
    if (!buffer.includes('\n\n')) return;

    const frame = buffer;
    buffer = '';
    if (stage === 'auth') {
      assert.match(frame, /^auth ClueCon/);
      stage = 'api';
      socket.write('Content-Type: command/reply\nReply-Text: +OK accepted\n\n');
      return;
    }

    if (response.type === 'api/response') {
      assert.match(frame, /^api /);
      commands.push(frame.trim());
      socket.write(
        `Content-Type: api/response\nContent-Length: ${Buffer.byteLength(response.body)}\n\n${response.body}`,
      );
      return;
    }

    assert.match(frame, /^bgapi /);
    commands.push(frame.trim());
    socket.write(
      `Content-Type: command/reply\nReply-Text: ${response.replyText}\n\n`,
    );
  });
}
