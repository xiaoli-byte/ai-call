import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidTaskDestination } from './task-destination.js';

describe('task destination validation', () => {
  it('allows local SIP extensions for FreeSWITCH development', () => {
    assert.equal(isValidTaskDestination('1001'), true);
  });

  it('allows E.164 style outbound numbers', () => {
    assert.equal(isValidTaskDestination('+8613800138000'), true);
  });

  it('rejects non-numeric destinations', () => {
    assert.equal(isValidTaskDestination('user/1001'), false);
  });
});
