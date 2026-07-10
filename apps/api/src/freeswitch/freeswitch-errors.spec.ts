import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FAILED_HANGUP_CAUSES,
  HANGUP_CAUSE_CLASSIFICATIONS,
  NO_ANSWER_HANGUP_CAUSES,
  RETRYABLE_PROVIDER_CODES,
  SAFE_PROVIDER_CODES,
  TaskStatus,
} from '@ai-call/shared';
import {
  CALL_ALREADY_ACTIVE_PROVIDER_CODE,
  isCallAlreadyActiveError,
  rejectedCommandError,
} from './freeswitch-errors.js';

const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe('freeswitch-errors provider-code classification (derived from shared table)', () => {
  it('derives RETRYABLE_PROVIDER_CODES exactly as before the single-table refactor', () => {
    assert.deepEqual(sorted(RETRYABLE_PROVIDER_CODES), [
      'DESTINATION_OUT_OF_ORDER',
      'GATEWAY_DOWN',
      'NETWORK_OUT_OF_ORDER',
      'NORMAL_TEMPORARY_FAILURE',
      'RECOVERY_ON_TIMER_EXPIRE',
      'REQUESTED_CHAN_UNAVAIL',
      'SERVICE_UNAVAILABLE',
      'SWITCH_CONGESTION',
    ]);
  });

  it('derives SAFE_PROVIDER_CODES exactly as before the single-table refactor', () => {
    assert.deepEqual(sorted(SAFE_PROVIDER_CODES), [
      'CALL_REJECTED',
      'DESTINATION_OUT_OF_ORDER',
      'DUPLICATE',
      'GATEWAY_DOWN',
      'INVALID_NUMBER_FORMAT',
      'NETWORK_OUT_OF_ORDER',
      'NORMAL_CLEARING',
      'NORMAL_TEMPORARY_FAILURE',
      'NO_ANSWER',
      'NO_ROUTE_DESTINATION',
      'ORIGINATOR_CANCEL',
      'RECOVERY_ON_TIMER_EXPIRE',
      'REQUESTED_CHAN_UNAVAIL',
      'SERVICE_UNAVAILABLE',
      'SUBSCRIBER_ABSENT',
      'SWITCH_CONGESTION',
      'UNALLOCATED_NUMBER',
      'USER_BUSY',
      'USER_NOT_REGISTERED',
    ]);
  });

  it('derives NO_ANSWER / FAILED hangup sets exactly as before', () => {
    assert.deepEqual(sorted(NO_ANSWER_HANGUP_CAUSES), [
      'CALL_REJECTED',
      'NORMAL_CLEARING',
      'NO_ANSWER',
      'NO_USER_RESPONSE',
      'ORIGINATOR_CANCEL',
      'SUBSCRIBER_ABSENT',
      'USER_BUSY',
    ]);
    assert.deepEqual(sorted(FAILED_HANGUP_CAUSES), [
      'AUDIO_FORK_ERROR',
      'BACKGROUND_JOB_FAILED',
      'BEARERCAPABILITY_NOTAVAIL',
      'DESTINATION_OUT_OF_ORDER',
      'EVENT_LOSS_RECONCILED',
      'INCOMPATIBLE_DESTINATION',
      'INVALID_NUMBER_FORMAT',
      'MEDIA_ERROR',
      'MEDIA_TIMEOUT',
      'NETWORK_OUT_OF_ORDER',
      'NORMAL_TEMPORARY_FAILURE',
      'NO_ROUTE',
      'NO_ROUTE_DESTINATION',
      'PROTOCOL_ERROR',
      'RECOVERY_ON_TIMER_EXPIRE',
      'REQUESTED_CHAN_UNAVAIL',
      'SWITCH_CONGESTION',
      'UNALLOCATED_NUMBER',
      'USER_NOT_REGISTERED',
    ]);
  });

  it('keeps RETRYABLE ⊆ SAFE and NO_ANSWER ∩ FAILED = ∅ (table invariants)', () => {
    for (const code of RETRYABLE_PROVIDER_CODES) {
      assert.ok(SAFE_PROVIDER_CODES.has(code), `${code} retryable but not safe`);
    }
    for (const code of NO_ANSWER_HANGUP_CAUSES) {
      assert.ok(!FAILED_HANGUP_CAUSES.has(code), `${code} in both NO_ANSWER and FAILED`);
    }
  });

  it('table is internally consistent: retryable rows are safe; terminalStatus matches projections', () => {
    for (const [code, entry] of Object.entries(HANGUP_CAUSE_CLASSIFICATIONS)) {
      if (entry.retryable) assert.ok(entry.safeToExpose, `${code} retryable must be safeToExpose`);
      assert.equal(RETRYABLE_PROVIDER_CODES.has(code), entry.retryable);
      assert.equal(SAFE_PROVIDER_CODES.has(code), entry.safeToExpose);
      assert.equal(NO_ANSWER_HANGUP_CAUSES.has(code), entry.terminalStatus === TaskStatus.NO_ANSWER);
      assert.equal(FAILED_HANGUP_CAUSES.has(code), entry.terminalStatus === TaskStatus.FAILED);
    }
  });
});

describe('rejectedCommandError provider-code scrubbing', () => {
  it('marks a retryable provider code retryable and exposes it', () => {
    const error = rejectedCommandError('originate', '-ERR SWITCH_CONGESTION cause=42');
    assert.equal(error.providerCode, 'SWITCH_CONGESTION');
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /cause=42/);
  });

  it('exposes a safe non-retryable code without marking it retryable', () => {
    const error = rejectedCommandError('originate', '-ERR USER_NOT_REGISTERED destination=1001');
    assert.equal(error.providerCode, 'USER_NOT_REGISTERED');
    assert.equal(error.retryable, false);
  });

  it('scrubs an unlisted (unsafe) code to UNKNOWN', () => {
    const error = rejectedCommandError('originate', '-ERR VOICE_AGENT_SECRET_VALUE');
    assert.equal(error.providerCode, 'UNKNOWN');
    assert.doesNotMatch(error.message, /VOICE_AGENT_SECRET_VALUE/);
  });
});

describe('CALL_ALREADY_ACTIVE / DUPLICATE special case (must survive the refactor)', () => {
  it('DUPLICATE is a safe, non-retryable code in the shared table', () => {
    assert.equal(CALL_ALREADY_ACTIVE_PROVIDER_CODE, 'DUPLICATE');
    assert.ok(SAFE_PROVIDER_CODES.has('DUPLICATE'));
    assert.ok(!RETRYABLE_PROVIDER_CODES.has('DUPLICATE'));
  });

  it('recognises a duplicate originate reject as call-already-active', () => {
    const error = rejectedCommandError('originate', '-ERR DUPLICATE Call UUID');
    assert.equal(error.providerCode, 'DUPLICATE');
    assert.equal(error.retryable, false);
    assert.equal(isCallAlreadyActiveError(error), true);
  });

  it('does not treat a duplicate on a non-originate op, or a non-duplicate, as already-active', () => {
    assert.equal(isCallAlreadyActiveError(rejectedCommandError('hangup', '-ERR DUPLICATE')), false);
    assert.equal(isCallAlreadyActiveError(rejectedCommandError('originate', '-ERR USER_BUSY')), false);
    assert.equal(isCallAlreadyActiveError(new Error('boom')), false);
  });
});
