// When /me fails, log out only on 401. NOT on a network error / 5xx / cold start (App.jsx retries).
// api.js is NOT imported (it needs Vite's import.meta.env); an ApiError-like object is enough,
// since only .status matters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldLogout } from '../src/auth.js'

const apiError = (status) => Object.assign(new Error(`Session check failed: HTTP ${status}`), { status })

test('401 (token rejected) -> logout', () => {
  assert.equal(shouldLogout(apiError(401)), true)
})

test('5xx or network error (API asleep / down) -> NO logout', () => {
  assert.equal(shouldLogout(apiError(503)), false)
  assert.equal(shouldLogout(new TypeError('Failed to fetch')), false) // fetch network error: no status
})
