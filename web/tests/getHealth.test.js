// web/tests/getHealth.test.js  -> ye f-step P6.3-f4 pe daalni hai (getHealth: sirf asli JSON "ok" = ok)
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Nakli API: har path ka jawab yahan se aata hai. Test badal-badal ke jawab set karta hai.
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
  // Vite ko pehle se set env milti hai to wo .env.development se upar rehti hai.
  process.env.VITE_API_URL = `http://127.0.0.1:${fake.address().port}`

  // Vite hi api.js ko load kare, taaki import.meta.env.VITE_API_URL asli jaisa bhare.
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

test('T1 asli API jaisa JSON {status:"ok"} (Express header) -> "API ok, database ok"', async () => {
  reply = {
    status: 200,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({ status: 'ok', db: 'up', redis: 'up' }),
  }
  assert.equal(await getHealth(), 'API ok, database ok')
  assert.equal(lastPath, '/status') // sahi URL pe gaya, /health pe nahi
})

test('T2 HTML page 200 (jaise Vercel ka index.html) -> "API error..." , "ok" nahi', async () => {
  reply = { status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><html><body>app</body></html>' }
  const msg = await getHealth()
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API error/)
})

test('T3 JSON 200 lekin status "ok" nahi (koi aur JSON service) -> "API error..."', async () => {
  reply = { status: 200, type: 'application/json', body: JSON.stringify({ hello: 'world' }) }
  const msg = await getHealth()
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API error/)
})

test('T4 header JSON bolta hai par body tooti hai -> "API error...", throw NAHI', async () => {
  reply = { status: 200, type: 'application/json', body: 'not json{' }
  const msg = await getHealth() // throw hua to test yahin fail
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API error/)
})

test('T5 503 degraded -> "ok" kabhi nahi', async () => {
  reply = {
    status: 503,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({ status: 'degraded', db: 'down', redis: 'up' }),
  }
  const msg = await getHealth()
  assert.notEqual(msg, 'API ok, database ok')
  assert.match(msg, /^API/)
})
