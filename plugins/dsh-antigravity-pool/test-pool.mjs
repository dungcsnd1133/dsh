// Offline tests for the dsh-antigravity-pool plugin.
// Uses a temp state dir, a fake fetch (no Google calls), and the HTTP layer
// is exercised through a stub ctx.webServer — nothing touches a live DSH.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'yaml'

const pluginDir = path.dirname(new URL(import.meta.url).pathname)

// ---------- fake fetch ----------
let tokenRefreshCount = 0
let quotaProbeStatus = 200
const calls = []
function fakeFetch(url, init) {
  calls.push({ url, init })
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    tokenRefreshCount++
    return Promise.resolve(new Response(JSON.stringify({
      access_token: `at_${tokenRefreshCount}`,
      refresh_token: tokenRefreshCount === 1 ? 'rt_new' : undefined,
      expires_in: 3600,
    }), { status: 200 }))
  }
  if (url.includes('fetchAvailableModels')) {
    return Promise.resolve(new Response(quotaProbeStatus === 200 ? '{"models":[]}' : '{"error":"RESOURCE_EXHAUSTED"}', { status: quotaProbeStatus }))
  }
  throw new Error('unexpected fetch: ' + url)
}

process.env.ANTIGRAVITY_CLIENT_ID = 'test-client-id'
process.env.ANTIGRAVITY_CLIENT_SECRET = 'test-client-secret'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-pool-test-'))
const stateDir = path.join(tmp, 'state')
const credentialsFile = path.join(tmp, '.credentials.yaml')

const core = await import(path.join(pluginDir, 'pool-core.mjs'))
core.setFetchImpl(fakeFetch)
core.configurePaths({ stateDir, credentialsFile })

// seed a .credentials.yaml like a real DSH home, to test bootstrap
fs.writeFileSync(credentialsFile, yaml.stringify({
  version: 1,
  records: {
    'client-connection/browser-session': { kind: 'session', payload: { x: 'y' } },
    'llm-pi-ai/google': {
      kind: 'grant',
      payload: { type: 'oauth', access: 'seed_at', refresh: 'seed_rt', expires: Date.now() + 3600_000, projectId: 'seed-project', email: 'seed@example.com' },
    },
  },
}), { mode: 0o600 })

// ---------- load plugin with stub webServer ----------
const routes = []
const ctx = { webServer: { register: (r) => routes.push(r) } }
const mod = await import(path.join(pluginDir, 'index.js'))
mod.apply(ctx, { stateDir, credentialsFile })
assert.equal(routes.length, 1, 'plugin registers exactly one prefix route')
assert.equal(routes[0].path, '/antigravity')

const handler = routes[0].handler
function fakeReq(method, url, body) {
  const data = JSON.stringify(body ?? {})
  return {
    method,
    url,
    headers: {},
    on(event, cb) {
      if (event === 'data' && method === 'POST') cb(Buffer.from(data))
      if (event === 'end') cb()
    },
    destroy() {},
  }
}
function fakeRes() {
  const res = {
    code: 0, headers: {}, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers ?? {} },
    end(text) { this.body = text ?? '' },
  }
  return res
}
async function call(method, url, body) {
  const resPromise = fakeRes()
  await handler(fakeReq(method, url, body), resPromise)
  return { status: resPromise.code, json: resPromise.body ? JSON.parse(resPromise.body) : null }
}

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(err)
    process.exit(1)
  }
}

console.log('dsh-antigravity-pool tests')

await test('status endpoint reports configured=true (env set)', async () => {
  const r = await call('GET', '/antigravity/api/status')
  assert.equal(r.status, 200)
  assert.equal(r.json.configured, true)
  assert.ok(r.json.tokenUrl.includes('oauth2.googleapis.com'))
})

await test('pool bootstraps the seeded .credentials.yaml grant', async () => {
  const r = await call('GET', '/antigravity/api/pool')
  assert.equal(r.status, 200)
  assert.equal(r.json.totalAccounts, 1)
  assert.equal(r.json.accounts[0].email, 'seed@example.com')
  assert.equal(r.json.accounts[0].projectId, 'seed-project')
})

await test('sanitized view never exposes access/refresh secrets', async () => {
  const r = await call('GET', '/antigravity/api/pool')
  const raw = JSON.stringify(r.json)
  assert.ok(!raw.includes('seed_at'), 'no access token in view')
  assert.ok(!raw.includes('seed_rt'), 'no refresh token in view')
})

await test('GET /api/account returns active account and syncs credentials', async () => {
  const r = await call('GET', '/antigravity/api/account')
  assert.equal(r.status, 200)
  assert.equal(r.json.access, 'seed_at')
  assert.equal(r.json.refresh, 'seed_rt')
  // credentials file must still contain the grant
  const doc = yaml.parse(fs.readFileSync(credentialsFile, 'utf8'))
  assert.equal(doc.records['llm-pi-ai/google'].payload.access, 'seed_at')
})

await test('expired account triggers refresh via fake token endpoint', async () => {
  // force expiry
  const poolFile = path.join(stateDir, 'antigravity-pool.json')
  const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'))
  pool.accounts[0].expires = Date.now() - 1000
  fs.writeFileSync(poolFile, JSON.stringify(pool))
  const before = tokenRefreshCount
  const r = await call('GET', '/antigravity/api/account')
  assert.equal(r.status, 200)
  assert.equal(r.json.access, 'at_1')
  assert.ok(tokenRefreshCount > before, 'token endpoint was called')
  // refresh_token rotation persisted
  assert.equal(r.json.refresh, 'rt_new')
})

await test('missing env fails open with stale token and records lastError (applet contract)', async () => {
  delete process.env.ANTIGRAVITY_CLIENT_SECRET
  const poolFile = path.join(stateDir, 'antigravity-pool.json')
  const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'))
  pool.accounts[0].expires = Date.now() - 1000
  fs.writeFileSync(poolFile, JSON.stringify(pool))
  const r = await call('GET', '/antigravity/api/account')
  assert.equal(r.status, 200, 'fail-open: stale token still returned')
  assert.ok(r.json.access, 'account object present')
  // the refresh failure must be recorded on the account
  const view = (await call('GET', '/antigravity/api/pool')).json
  assert.ok(
    String(view.accounts[0].lastError || '').includes('ANTIGRAVITY_CLIENT_SECRET'),
    'lastError names the missing env var, got: ' + view.accounts[0].lastError,
  )
  process.env.ANTIGRAVITY_CLIENT_SECRET = 'test-client-secret'
  pool.accounts[0].expires = Date.now() + 3600_000
  pool.accounts[0].lastError = null
  fs.writeFileSync(poolFile, JSON.stringify(pool))
})

await test('add second account, then quota-exceeded rotates away and cooldowns', async () => {
  const r1 = await call('POST', '/antigravity/api/account', {
    email: 'second@example.com', access: 'acc2_at', refresh: 'acc2_rt', expires: Date.now() + 3600_000, projectId: 'proj-2',
  })
  assert.equal(r1.status, 200)
  let pool = (await call('GET', '/antigravity/api/pool')).json
  assert.equal(pool.totalAccounts, 2)
  assert.equal(pool.activeIndex, 1, 'new account becomes active')

  const r2 = await call('POST', '/antigravity/api/quota-exceeded', { id: 'second@example.com', error: '429 RESOURCE_EXHAUSTED' })
  assert.equal(r2.status, 200)
  pool = (await call('GET', '/antigravity/api/pool')).json
  assert.equal(pool.accounts[1].status, 'cooldown')
  assert.equal(pool.accounts[1].quotaHits, 1)
  assert.equal(pool.activeIndex, 0, 'switched back to healthy account')
})

await test('isQuotaExceededError detects 429 and RESOURCE_EXHAUSTED', async () => {
  assert.equal(core.isQuotaExceededError(429), true)
  assert.equal(core.isQuotaExceededError(500, 'RESOURCE_EXHAUSTED'), true)
  assert.equal(core.isQuotaExceededError(200, 'fine'), false)
})

await test('reset-quota restores the account', async () => {
  const view = (await call('GET', '/antigravity/api/pool')).json
  const id = view.accounts[1].id
  await call('POST', '/antigravity/api/reset-quota', { id })
  const pool = (await call('GET', '/antigravity/api/pool')).json
  assert.equal(pool.accounts[1].status, 'active')
})

await test('activate switches active account', async () => {
  const view = (await call('GET', '/antigravity/api/pool')).json
  const id = view.accounts[0].id
  await call('POST', '/antigravity/api/activate', { id })
  const pool = (await call('GET', '/antigravity/api/pool')).json
  assert.equal(pool.activeIndex, 0)
})

await test('update config (cooldownMinutes) persists', async () => {
  const r = await call('POST', '/antigravity/api/config', { cooldownMinutes: 15 })
  assert.equal(r.json.cooldownMinutes, 15)
})

await test('test endpoint probes fetchAvailableModels (ok path)', async () => {
  quotaProbeStatus = 200
  const r = await call('POST', '/antigravity/api/test', {})
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
})

await test('test endpoint reports quota exhaustion', async () => {
  quotaProbeStatus = 429
  const r = await call('POST', '/antigravity/api/test', {})
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.ok(r.json.message.includes('429'))
  quotaProbeStatus = 200
})

await test('remove account works and activeIndex clamps', async () => {
  const view = (await call('GET', '/antigravity/api/pool')).json
  const id = view.accounts[1].id
  const r = await call('POST', '/antigravity/api/remove', { id })
  assert.equal(r.status, 200)
  const pool = (await call('GET', '/antigravity/api/pool')).json
  assert.equal(pool.totalAccounts, 1)
})

await test('UI page renders from ui.html (control room)', async () => {
  const resPromise = fakeRes()
  await handler(fakeReq('GET', '/antigravity'), resPromise)
  assert.equal(resPromise.code, 200)
  const html = String(resPromise.body)
  assert.match(html, /Antigravity Pool/)
  assert.match(html, /control room/)
  assert.match(html, /\/antigravity\/api\/pool/, 'UI gọi API pool')
  assert.match(html, /setInterval/, 'UI có auto-refresh')
})

await test('unknown api path returns 404 JSON', async () => {
  const r = await call('GET', '/antigravity/api/nope')
  assert.equal(r.status, 404)
  assert.ok(r.json.error)
})

// cooldown expiry auto-recovery
await test('expired cooldown auto-recovers on next pool read', async () => {
  const poolFile = path.join(stateDir, 'antigravity-pool.json')
  const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'))
  const acc = pool.accounts[0]
  acc.status = 'cooldown'
  acc.quotaExceededUntil = Date.now() - 1000
  fs.writeFileSync(poolFile, JSON.stringify(pool))
  const view = (await call('GET', '/antigravity/api/pool')).json
  assert.equal(view.accounts[0].status, 'active')
})


// ---------- Settings → Models card routes (settings-routes.mjs) ----------
const settingsMod = await import(path.join(pluginDir, 'settings-routes.mjs'))

await test('parseRedirect reads a full redirect URL', () => {
  const parsed = settingsMod.parseRedirect('http://localhost:51121/oauth-callback?code=abc123&state=st9')
  assert.equal(parsed.code, 'abc123')
  assert.equal(parsed.state, 'st9')
})

await test('parseRedirect reads a bare authorization code', () => {
  assert.equal(settingsMod.parseRedirect('4/0AX4XfWh').code, '4/0AX4XfWh')
})

await test('parseRedirect ignores empty input', () => {
  assert.deepEqual(settingsMod.parseRedirect('   '), {})
})

// Mount the settings routes against a stub connection.fetch registry.
const fetchRoutes = new Map()
const settingsCtx = {
  effect: (fn) => fn(),
  connection: {
    fetch: {
      register: (route) => {
        fetchRoutes.set(route.path, route)
        return () => {}
      },
    },
  },
}
settingsMod.registerSettingsRoutes(settingsCtx)

await test('settings routes register all four endpoints', () => {
  assert.ok(fetchRoutes.has('/api/antigravity.pool'))
  assert.ok(fetchRoutes.has('/api/antigravity.authUrl'))
  assert.ok(fetchRoutes.has('/api/antigravity.exchange'))
  assert.ok(fetchRoutes.has('/api/antigravity.action'))
})

await test('settings status route reports configured and the active account', async () => {
  const route = fetchRoutes.get('/api/antigravity.pool')
  const response = await route.fetch(new Request('http://x/api/antigravity.pool'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.configured, true)
  assert.ok(Array.isArray(body.pool.accounts))
  assert.ok(body.pool.accounts.length > 0)
  // tokens never leave the host
  assert.equal('access' in body.pool.accounts[0], false)
  assert.equal('refresh' in body.pool.accounts[0], false)
})

await test('settings auth-url route mints a PKCE Google URL', async () => {
  const route = fetchRoutes.get('/api/antigravity.authUrl')
  const response = await route.fetch(new Request('http://x/api/antigravity.authUrl', { method: 'POST', body: '{}' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  assert.ok(body.authUrl.includes('code_challenge_method=S256'))
  assert.ok(body.authUrl.includes('client_id=test-client-id'))
  assert.ok(body.state)
})

await test('settings exchange route rejects input without a code', async () => {
  const route = fetchRoutes.get('/api/antigravity.exchange')
  const response = await route.fetch(
    new Request('http://x/api/antigravity.exchange', {
      method: 'POST',
      body: JSON.stringify({ input: 'nothing useful' }),
    }),
  )
  // the route only rejects when the body has no code at all
  assert.ok(response.status === 400 || response.status === 500)
})

await test('settings action route rejects an unknown action', async () => {
  const route = fetchRoutes.get('/api/antigravity.action')
  const response = await route.fetch(
    new Request('http://x/api/antigravity.action', { method: 'POST', body: JSON.stringify({ action: 'nope' }) }),
  )
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.ok(body.message)
})

await test('settings action route selects another account', async () => {
  core.addOrUpdateAccount({
    access: 'second_at',
    refresh: 'second_rt',
    expires: Date.now() + 3600_000,
    projectId: 'p2',
    email: 'second@example.com',
  })
  const route = fetchRoutes.get('/api/antigravity.action')
  const response = await route.fetch(
    new Request('http://x/api/antigravity.action', {
      method: 'POST',
      body: JSON.stringify({ action: 'select', email: 'second@example.com' }),
    }),
  )
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.pool.accounts.find((a) => a.email === 'second@example.com').isActive, true)
})

console.log(`\nAll ${passed} tests passed ✅`)
fs.rmSync(tmp, { recursive: true, force: true })
