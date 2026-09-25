// web/tests/health.test.js  -> ye f-step P8-a pe daalni hai (NAYI file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HEALTH_CHECKING, HEALTH_OK, healthTone } from '../src/health.js'

test('H1 HEALTH_OK wahi string hai jo getHealth lautata hai (getHealth T1 bhi yahi pakadta hai)', () => {
  assert.equal(HEALTH_OK, 'API ok, database ok')
  assert.equal(healthTone(HEALTH_OK), 'ok')
})

test('H2 pehla load (jawab abhi nahi) -> checking', () => {
  assert.equal(healthTone(HEALTH_CHECKING), 'checking')
})

test('H3 baaki har jawab -> warn (amber), kabhi ok nahi', () => {
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
