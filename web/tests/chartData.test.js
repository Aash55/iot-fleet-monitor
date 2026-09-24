// web/tests/chartData.test.js  -> ye f-step P5-f4 pe daalni hai (NAYI file)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toChartData } from '../src/chartData.js'

const reading = (is_attack) => ({ ts: '2026-09-24T10:00:00Z', metrics: { rate: 5 }, is_attack })

test('toChartData: sirf is_attack === true laal dot banta hai', () => {
  const out = toChartData([reading(true), reading(false), reading(null), reading(undefined)], 'rate')
  assert.deepEqual(out.map((p) => p.attack), [true, false, false, false])
})

test('toChartData: t aur value pehle jaise hi', () => {
  const [p] = toChartData([reading(true)], 'rate')
  assert.equal(p.t, Date.parse('2026-09-24T10:00:00Z'))
  assert.equal(p.value, 5)
})
