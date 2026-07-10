export type FreeSwitchOperation =
  | 'connect'
  | 'hangup'
  | 'list-active-channels'
  | 'originate'
  | 'transfer';

export type FreeSwitchErrorCode =
  | 'AUTH_FAILED'
  | 'COMMAND_REJECTED'
  | 'CONNECTION_CLOSED'
  | 'CONNECTION_FAILED'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'INVALID_RESPONSE'
  | 'MISSING_JOB_UUID'
  | 'PROTOCOL_ERROR'
  | 'TIMEOUT';

export interface FreeSwitchErrorOptions {
  operation: FreeSwitchOperation;
  code: FreeSwitchErrorCode;
  retryable: boolean;
  providerCode?: string;
}

/**
 * Public-safe FreeSWITCH failure. It intentionally never embeds an ESL reply,
 * wire command, credential, or audio-fork metadata in its message.
 */
export class FreeSwitchError extends Error {
  readonly name = 'FreeSwitchError';
  readonly operation: FreeSwitchOperation;
  readonly code: FreeSwitchErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(options: FreeSwitchErrorOptions) {
    const providerSuffix = options.providerCode
      ? ` (${options.providerCode})`
      : '';
    super(`FreeSWITCH ${options.operation} failed: ${options.code}${providerSuffix}`);
    this.operation = options.operation;
    this.code = options.code;
    this.retryable = options.retryable;
    this.providerCode = options.providerCode;
  }
}

const RETRYABLE_PROVIDER_CODES = new Set([
  'DESTINATION_OUT_OF_ORDER',
  'GATEWAY_DOWN',
  'NETWORK_OUT_OF_ORDER',
  'NORMAL_TEMPORARY_FAILURE',
  'RECOVERY_ON_TIMER_EXPIRE',
  'REQUESTED_CHAN_UNAVAIL',
  'SERVICE_UNAVAILABLE',
  'SWITCH_CONGESTION',
]);

/**
 * `-ERR Duplicate [Call] UUID` — a re-`originate` with the same
 * `origination_uuid` while the first call is still live. It is NOT a dispatch
 * failure: the call already exists, so callers must treat it as already-placed
 * (never re-dial, never mark the task FAILED). Recognizing it as a distinct,
 * safe code is what lets the outbox tell "already dialing" apart from a real
 * rejection.
 */
export const CALL_ALREADY_ACTIVE_PROVIDER_CODE = 'DUPLICATE';

const SAFE_PROVIDER_CODES = new Set([
  ...RETRYABLE_PROVIDER_CODES,
  CALL_ALREADY_ACTIVE_PROVIDER_CODE,
  'CALL_REJECTED',
  'INVALID_NUMBER_FORMAT',
  'NO_ANSWER',
  'NO_ROUTE_DESTINATION',
  'NORMAL_CLEARING',
  'ORIGINATOR_CANCEL',
  'SUBSCRIBER_ABSENT',
  'UNALLOCATED_NUMBER',
  'USER_BUSY',
  'USER_NOT_REGISTERED',
]);

export function rejectedCommandError(
  operation: FreeSwitchOperation,
  replyText: string,
): FreeSwitchError {
  const providerCode = safeProviderCode(replyText);
  return new FreeSwitchError({
    operation,
    code: 'COMMAND_REJECTED',
    retryable: RETRYABLE_PROVIDER_CODES.has(providerCode),
    providerCode,
  });
}

/**
 * True when `error` reports that a call for this `origination_uuid` is already
 * active on FreeSWITCH. The outbox treats this as an idempotent success rather
 * than dialing again or failing the task.
 */
export function isCallAlreadyActiveError(error: unknown): boolean {
  return (
    error instanceof FreeSwitchError
    && error.operation === 'originate'
    && error.providerCode === CALL_ALREADY_ACTIVE_PROVIDER_CODE
  );
}

function safeProviderCode(replyText: string): string {
  const text = replyText.replace(/^\s*-ERR\b/i, '').toUpperCase();
  const candidate = text.match(/[A-Z][A-Z0-9_]{1,63}/)?.[0];
  return candidate && SAFE_PROVIDER_CODES.has(candidate) ? candidate : 'UNKNOWN';
}
