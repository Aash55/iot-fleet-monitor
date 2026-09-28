import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HEALTH_CHECKING, HEALTH_OK, healthTone } from '../src/health.js'

test('H1 HEALTH_OK is the same string getHealth returns (getHealth T1 pins it too)', () => {
  assert.equal(HEALTH_OK, 'API ok, database ok')
  assert.equal(healthTone(HEALTH_OK), 'ok')
})

test('H2 first load (no answer yet) -> checking', () => {
  assert.equal(healthTone(HEALTH_CHECKING), 'checking')
})

test('H3 every other answer -> warn (amber), never ok', () => {
  for (const s of [
    'API ok, database down',
    'API error: HTTP 404',
    'API error: HTTP 503',
    'API unreachable. Check the browser console.',
    '',
  ]) {
    assert.equal(healthTone(s), 'warn', s)
  }
})
