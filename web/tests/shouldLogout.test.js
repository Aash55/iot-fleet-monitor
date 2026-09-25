// web/tests/shouldLogout.test.js  -> ye f-step P9-e pe daalni hai (NAYI file)
// /me fail hone pe logout sirf 401 pe. Network error / 5xx / cold start pe NAHI (App.jsx retry karta hai).
// api.js import NAHI (usko Vite ka import.meta.env chahiye) - ApiError jaisa object: sirf .status matter karta hai.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldLogout } from '../src/auth.js'

const apiError = (status) => Object.assign(new Error(`Session check failed: HTTP ${status}`), { status })

test('401 (token thukraya) -> logout', () => {
  assert.equal(shouldLogout(apiError(401)), true)
})

test('5xx ya network error (API so rahi / down) -> logout NAHI', () => {
  assert.equal(shouldLogout(apiError(503)), false)
  assert.equal(shouldLogout(new TypeError('Failed to fetch')), false) // fetch ka network error: status hi nahi
})
