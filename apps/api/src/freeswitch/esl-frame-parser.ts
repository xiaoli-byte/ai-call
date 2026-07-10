export type EslHeaderValue = string | readonly string[];

export type EslHeaders = Readonly<Record<string, EslHeaderValue>>;

export interface EslFrame {
  headers: EslHeaders;
  body: Buffer;
}

export interface EslFrameParserOptions {
  maxHeaderBytes?: number;
  maxBodyBytes?: number;
}

export type EslFrameParserErrorCode =
  | 'BODY_TOO_LARGE'
  | 'HEADER_TOO_LARGE'
  | 'INCOMPLETE_FRAME'
  | 'INVALID_CONTENT_LENGTH'
  | 'INVALID_HEADER';

const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
const EMPTY_BUFFER = Buffer.alloc(0);

export class EslFrameParserError extends Error {
  readonly name = 'EslFrameParserError';

  constructor(readonly code: EslFrameParserErrorCode) {
    super(`Invalid ESL frame: ${code}`);
  }
}

/**
 * Incrementally decodes ESL frames without converting an incomplete body to a
 * JavaScript string. Content-Length is therefore always interpreted as bytes.
 */
export class EslFrameParser {
  private readonly maxHeaderBytes: number;
  private readonly maxBodyBytes: number;
  // Unconsumed bytes are staged as-received and only concatenated when a frame
  // can actually make progress (header boundary found, or body fully arrived).
  // Concatenating on every push would recopy the growing residual each time —
  // O(n²) when a large body streams in over many small TCP segments.
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private pending?: { headers: EslHeaders; bodyLength: number };

  constructor(options: EslFrameParserOptions = {}) {
    this.maxHeaderBytes = positiveInteger(
      options.maxHeaderBytes,
      DEFAULT_MAX_HEADER_BYTES,
      'maxHeaderBytes',
    );
    this.maxBodyBytes = positiveInteger(
      options.maxBodyBytes,
      DEFAULT_MAX_BODY_BYTES,
      'maxBodyBytes',
    );
  }

  push(chunk: Buffer | Uint8Array): EslFrame[] {
    if (chunk.byteLength > 0) {
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      // Copy defensively: staged chunks outlive this call until coalesced.
      this.chunks.push(Buffer.from(bytes));
      this.bufferedBytes += bytes.byteLength;
    }

    const frames: EslFrame[] = [];
    while (true) {
      if (!this.pending) {
        const buffer = this.coalesce();
        const boundary = findHeaderBoundary(buffer);
        if (!boundary) {
          if (this.bufferedBytes > this.maxHeaderBytes) {
            throw new EslFrameParserError('HEADER_TOO_LARGE');
          }
          break;
        }
        if (boundary.index > this.maxHeaderBytes) {
          throw new EslFrameParserError('HEADER_TOO_LARGE');
        }

        const headers = parseHeaderBlock(
          buffer.subarray(0, boundary.index),
          false,
        );
        const bodyLength = contentLength(headers, this.maxBodyBytes);
        this.consumeFront(boundary.index + boundary.length);
        this.pending = { headers, bodyLength };
      }

      // Body still incomplete: return without coalescing so subsequent chunks
      // keep accumulating cheaply instead of recopying the partial body.
      if (this.bufferedBytes < this.pending.bodyLength) break;

      const buffer = this.coalesce();
      const { headers, bodyLength } = this.pending;
      const body = Buffer.from(buffer.subarray(0, bodyLength));
      this.consumeFront(bodyLength);
      this.pending = undefined;
      frames.push({ headers, body });
    }

    return frames;
  }

  /** Rejects a connection that ended in the middle of an ESL frame. */
  finish(): void {
    if (this.pending || this.bufferedBytes > 0) {
      throw new EslFrameParserError('INCOMPLETE_FRAME');
    }
  }

  /** Folds staged chunks into a single buffer; amortized O(n) over the stream. */
  private coalesce(): Buffer {
    if (this.chunks.length === 0) return EMPTY_BUFFER;
    if (this.chunks.length > 1) {
      this.chunks = [Buffer.concat(this.chunks, this.bufferedBytes)];
    }
    return this.chunks[0];
  }

  /** Drops `length` leading bytes. Must be called only after `coalesce()`. */
  private consumeFront(length: number): void {
    if (length === 0) return;
    const remainder = this.chunks[0].subarray(length);
    this.chunks = remainder.byteLength > 0 ? [remainder] : [];
    this.bufferedBytes = remainder.byteLength;
  }
}

export interface EslPlainEvent {
  headers: EslHeaders;
  body: Buffer;
}

/** Parses the payload carried by an outer text/event-plain ESL frame. */
export function parsePlainEventPayload(
  payload: Buffer | Uint8Array,
  options: EslFrameParserOptions = {},
): EslPlainEvent {
  const maxHeaderBytes = positiveInteger(
    options.maxHeaderBytes,
    DEFAULT_MAX_HEADER_BYTES,
    'maxHeaderBytes',
  );
  const maxBodyBytes = positiveInteger(
    options.maxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
    'maxBodyBytes',
  );
  const bytes = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const boundary = findHeaderBoundary(bytes);
  if (!boundary) throw new EslFrameParserError('INCOMPLETE_FRAME');
  if (boundary.index > maxHeaderBytes) {
    throw new EslFrameParserError('HEADER_TOO_LARGE');
  }

  const headers = parseHeaderBlock(bytes.subarray(0, boundary.index), true);
  const bodyStart = boundary.index + boundary.length;
  const availableBodyLength = bytes.length - bodyStart;
  const declaredLengthValues = getEslHeaderValues(headers, 'Content-Length');
  const bodyLength = declaredLengthValues.length > 0
    ? contentLength(headers, maxBodyBytes)
    : availableBodyLength;

  if (bodyLength > maxBodyBytes) {
    throw new EslFrameParserError('BODY_TOO_LARGE');
  }
  if (availableBodyLength !== bodyLength) {
    throw new EslFrameParserError('INCOMPLETE_FRAME');
  }

  return {
    headers,
    body: Buffer.from(bytes.subarray(bodyStart, bodyStart + bodyLength)),
  };
}

export function getEslHeader(
  headers: EslHeaders,
  name: string,
): string | undefined {
  return getEslHeaderValues(headers, name)[0];
}

export function getEslHeaderValues(
  headers: EslHeaders,
  name: string,
): readonly string[] {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === lowerName,
  );
  if (!entry) return [];
  return typeof entry[1] === 'string' ? [entry[1]] : entry[1];
}

/** FreeSWITCH percent-encodes plain-event header values, but '+' is literal. */
export function safeDecodeEslHeaderValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHeaderBlock(bytes: Buffer, decodeValues: boolean): EslHeaders {
  if (bytes.length === 0) throw new EslFrameParserError('INVALID_HEADER');

  const headers: Record<string, string | string[]> = Object.create(null) as Record<
    string,
    string | string[]
  >;
  const canonicalNames = new Map<string, string>();
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new EslFrameParserError('INVALID_HEADER');

    const name = line.slice(0, colon).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new EslFrameParserError('INVALID_HEADER');
    }
    const rawValue = line.slice(colon + 1).trimStart();
    const value = decodeValues
      ? safeDecodeEslHeaderValue(rawValue)
      : rawValue;
    const lowerName = name.toLowerCase();
    const canonicalName = canonicalNames.get(lowerName);

    if (!canonicalName) {
      canonicalNames.set(lowerName, name);
      headers[name] = value;
      continue;
    }

    const current = headers[canonicalName];
    headers[canonicalName] = typeof current === 'string'
      ? [current, value]
      : [...current, value];
  }
  return headers;
}

function contentLength(headers: EslHeaders, maxBodyBytes: number): number {
  const values = getEslHeaderValues(headers, 'Content-Length');
  if (values.length === 0) return 0;
  if (values.some((value) => value !== values[0])) {
    throw new EslFrameParserError('INVALID_CONTENT_LENGTH');
  }

  const rawLength = values[0];
  if (!/^\d+$/.test(rawLength)) {
    throw new EslFrameParserError('INVALID_CONTENT_LENGTH');
  }
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length)) {
    throw new EslFrameParserError('INVALID_CONTENT_LENGTH');
  }
  if (length > maxBodyBytes) {
    throw new EslFrameParserError('BODY_TOO_LARGE');
  }
  return length;
}

function findHeaderBoundary(
  bytes: Buffer,
): { index: number; length: 2 | 4 } | undefined {
  const lfIndex = bytes.indexOf(Buffer.from('\n\n'));
  const crlfIndex = bytes.indexOf(Buffer.from('\r\n\r\n'));
  if (lfIndex === -1 && crlfIndex === -1) return undefined;
  if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
    return { index: crlfIndex, length: 4 };
  }
  return { index: lfIndex, length: 2 };
}

function positiveInteger(
  configured: number | undefined,
  fallback: number,
  name: string,
): number {
  const value = configured ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
