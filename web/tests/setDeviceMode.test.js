// web/tests/setDeviceMode.test.js  -> ye f-step P7-f4b pe daalni hai (NAYI file)
// Nakli API (getHealth.test.js jaisa): dekhte hain ki setDeviceMode sahi request bhejta hai
// aur galti pe ApiError (status ke saath) phenkta hai - ModeToggle 401 pe logout isi se karta hai.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let reply = { status: 200, body: '{}' }
let last = null

const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    last = { method: req.method, url: req.url, auth: req.headers.authorization, body }
    res.writeHead(reply.status, { 'Content-Type': 'application/json' })
    res.end(reply.body)
  })
})

let vite
let api

before(async () => {
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  process.env.VITE_API_URL = `http://127.0.0.1:${fake.address().port}`
  vite = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  api = await vite.ssrLoadModule('/src/api.js')
})

after(async () => {
  await vite?.close()
  fake.close()
})

test('setDeviceMode: PATCH /devices/:id, body {mode}, token ke saath; naya device lautata hai', async () => {
  reply = { status: 200, body: JSON.stringify({ device: { id: '22', mode: 'prevent' } }) }
  const device = await api.setDeviceMode('tok', '22', 'prevent')
  assert.deepEqual(device, { id: '22', mode: 'prevent' })
  assert.equal(last.method, 'PATCH')
  assert.equal(last.url, '/devices/22')
  assert.equal(last.auth, 'Bearer tok')
  assert.deepEqual(JSON.parse(last.body), { mode: 'prevent' })
})

test('setDeviceMode: 404 / 401 pe ApiError, status ke saath', async () => {
  for (const status of [404, 401]) {
    reply = { status, body: '{"error":"x"}' }
    await assert.rejects(api.setDeviceMode('tok', '22', 'detect'), (err) => {
      assert.equal(err.name, 'ApiError')
      assert.equal(err.status, status)
      return true
    })
  }
})
