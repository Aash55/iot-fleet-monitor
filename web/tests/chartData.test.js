import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toChartData } from '../src/chartData.js'

const reading = (is_attack) => ({ ts: '2026-09-24T10:00:00Z', metrics: { rate: 5 }, is_attack })

test('toChartData: only is_attack === true becomes a red dot', () => {
  const out = toChartData([reading(true), reading(false), reading(null), reading(undefined)], 'rate')
  assert.deepEqual(out.map((p) => p.attack), [true, false, false, false])
})

test('toChartData: t and value are unchanged', () => {
  const [p] = toChartData([reading(true)], 'rate')
  assert.equal(p.t, Date.parse('2026-09-24T10:00:00Z'))
  assert.equal(p.value, 5)
})

// ✕ only when action === 'blocked'. Not for 'allowed', null (detect mode) or a missing field
// (older API). And NOT for 'block' (present tense) either: the DB stores the past tense.
test('toChartData: ✕ only when action === "blocked"', () => {
  const r = (action) => ({ ts: '2026-09-24T10:00:00Z', metrics: { rate: 5 }, is_attack: true, action })
  const out = toChartData([r('blocked'), r('allowed'), r(null), r(undefined), r('block')], 'rate')
  assert.deepEqual(out.map((p) => p.blocked), [true, false, false, false, false])
})
