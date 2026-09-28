import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Fake API: every path is answered from here. Each test sets the reply it needs.
let reply = { status: 200, type: 'application/json; charset=utf-8', body: '{}' }
let lastPath = null

const fake = http.createServer((req, res) => {
  lastPath = req.url
  res.writeHead(reply.status, { 'Content-Type': reply.type })
  res.end(reply.body)
})

let vite
let getHealth

before(async () => {
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  // An env var already set when Vite starts takes precedence over .env.development.
  process.env.VITE_API_URL = `http://127.0.0.1:${fake.address().port}`

  // Let Vite load api.js, so import.meta.env.VITE_API_URL is filled in as in the real app.
  vite = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  ;({ getHealth } = await vite.ssrLoadModule('/src/api.js'))
})

after(async () => {
  await vite?.close()
  fake.close()
})

test('T1 JSON {status:"ok"} like the real API (Express header) -> "API ok, database ok"', async () => {
  reply = {
    status: 200,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({ status: 'ok', db: 'up', redis: 'up' }),
  }
  assert.equal(await getHealth(), 'API ok, database ok')
  assert.equal(lastPath, '/status') // hit the correct URL, not /health
})

test('T2 HTML page 200 (like the Vercel index.html) -> "API error...", not "ok"', async () => {
  reply = { status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><html><body>app</body></html>' }
  const msg = await getHealth()
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API error/)
})

test('T3 JSON 200 but status is not "ok" (some other JSON service) -> "API error..."', async () => {
  reply = { status: 200, type: 'application/json', body: JSON.stringify({ hello: 'world' }) }
  const msg = await getHealth()
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API error/)
})

test('T4 header says JSON but the body is broken -> "API error...", does NOT throw', async () => {
  reply = { status: 200, type: 'application/json', body: 'not json{' }
  const msg = await getHealth() // if it throws, the test fails here
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API error/)
})

test('T5 503 degraded -> never "ok"', async () => {
  reply = {
    status: 503,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({ status: 'degraded', db: 'down', redis: 'up' }),
  }
  const msg = await getHealth()
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API/)
})
