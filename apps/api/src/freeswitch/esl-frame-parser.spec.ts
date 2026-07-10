import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EslFrameParser,
  EslFrameParserError,
  getEslHeader,
  getEslHeaderValues,
  parsePlainEventPayload,
} from './esl-frame-parser.js';

describe('EslFrameParser', () => {
  it('decodes LF/CRLF header-only frames, duplicates and sticky packets', () => {
    const parser = new EslFrameParser();
    const frames = parser.push(Buffer.from(
      'Content-Type: auth/request\r\nX-Test: one\r\nx-test: two\r\n\r\n'
      + 'Content-Type: command/reply\nReply-Text: +OK accepted\n\n',
    ));

    assert.equal(frames.length, 2);
    assert.equal(getEslHeader(frames[0].headers, 'content-type'), 'auth/request');
    assert.deepEqual(getEslHeaderValues(frames[0].headers, 'X-Test'), ['one', 'two']);
    assert.equal(getEslHeader(frames[1].headers, 'Reply-Text'), '+OK accepted');
    assert.deepEqual(frames[0].body, Buffer.alloc(0));
    parser.finish();
  });

  it('uses byte lengths for a UTF-8 body split at every byte boundary', () => {
    const body = Buffer.from('你好，FreeSWITCH');
    const wire = Buffer.concat([
      Buffer.from(`Content-Type: api/response\nContent-Length: ${body.length}\n\n`),
      body,
    ]);
    const parser = new EslFrameParser();
    const frames = [];

    for (const byte of wire) frames.push(...parser.push(Buffer.from([byte])));

    assert.equal(frames.length, 1);
    assert.equal(frames[0].body.toString('utf8'), '你好，FreeSWITCH');
    parser.finish();
  });

  it('waits for a split body and then decodes the following frame', () => {
    const parser = new EslFrameParser();
    assert.deepEqual(
      parser.push(Buffer.from('Content-Type: api/response\nContent-Length: 5\n\nhe')),
      [],
    );
    const frames = parser.push(Buffer.from(
      'lloContent-Type: command/reply\nReply-Text: +OK\n\n',
    ));

    assert.equal(frames.length, 2);
    assert.equal(frames[0].body.toString(), 'hello');
    assert.equal(getEslHeader(frames[1].headers, 'Content-Type'), 'command/reply');
  });

  it('reassembles a large body delivered as many small chunks', () => {
    const body = Buffer.alloc(64 * 1024, 0x61);
    const wire = Buffer.concat([
      Buffer.from(`Content-Type: api/response\nContent-Length: ${body.length}\n\n`),
      body,
    ]);
    const parser = new EslFrameParser();
    const frames = [];
    for (let offset = 0; offset < wire.length; offset += 1400) {
      frames.push(...parser.push(wire.subarray(offset, offset + 1400)));
    }

    assert.equal(frames.length, 1);
    assert.equal(frames[0].body.length, body.length);
    assert.ok(frames[0].body.equals(body));
    parser.finish();
  });

  it('rejects oversized headers and bodies', () => {
    assert.throws(
      () => new EslFrameParser({ maxHeaderBytes: 8 }).push(
        Buffer.from('Content-Type: auth/request\n\n'),
      ),
      (error) => error instanceof EslFrameParserError
        && error.code === 'HEADER_TOO_LARGE',
    );
    assert.throws(
      () => new EslFrameParser({ maxBodyBytes: 4 }).push(
        Buffer.from('Content-Type: api/response\nContent-Length: 5\n\n'),
      ),
      (error) => error instanceof EslFrameParserError
        && error.code === 'BODY_TOO_LARGE',
    );
  });

  it('rejects negative, conflicting and unsafe Content-Length values', () => {
    for (const headers of [
      'Content-Length: -1',
      'Content-Length: 1\ncontent-length: 2',
      'Content-Length: 999999999999999999999999',
    ]) {
      assert.throws(
        () => new EslFrameParser().push(
          Buffer.from(`Content-Type: api/response\n${headers}\n\n`),
        ),
        (error) => error instanceof EslFrameParserError
          && error.code === 'INVALID_CONTENT_LENGTH',
      );
    }
  });

  it('reports a half frame when the stream ends', () => {
    const parser = new EslFrameParser();
    parser.push(Buffer.from(
      'Content-Type: api/response\nContent-Length: 5\n\nabc',
    ));
    assert.throws(
      () => parser.finish(),
      (error) => error instanceof EslFrameParserError
        && error.code === 'INCOMPLETE_FRAME',
    );
  });
});

describe('parsePlainEventPayload', () => {
  it('decodes percent-encoded values safely without treating plus as space', () => {
    const body = Buffer.from('正文');
    const event = parsePlainEventPayload(Buffer.concat([
      Buffer.from(
        'Event-Name: CHANNEL%5FANSWER\r\n'
        + 'Caller-Caller-ID-Number: +1001\r\n'
        + 'Malformed: 100%ZZ\r\n'
        + 'X-Repeat: first\r\n'
        + 'x-repeat: second%20value\r\n'
        + `Content-Length: ${body.length}\r\n\r\n`,
      ),
      body,
    ]));

    assert.equal(getEslHeader(event.headers, 'Event-Name'), 'CHANNEL_ANSWER');
    assert.equal(getEslHeader(event.headers, 'Caller-Caller-ID-Number'), '+1001');
    assert.equal(getEslHeader(event.headers, 'Malformed'), '100%ZZ');
    assert.deepEqual(getEslHeaderValues(event.headers, 'X-Repeat'), [
      'first',
      'second value',
    ]);
    assert.equal(event.body.toString('utf8'), '正文');
  });

  it('uses the full remainder as body when the inner event has no length', () => {
    const event = parsePlainEventPayload(Buffer.from(
      'Event-Name: CUSTOM\n\nbody\nwith\nlines',
    ));
    assert.equal(event.body.toString(), 'body\nwith\nlines');
  });
});
