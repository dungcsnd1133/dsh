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
    const isCodeExchange = String(init?.body || '').includes('grant_type=authorization_code')
    return Promise.resolve(new Response(JSON.stringify({
      access_token: `at_${tokenRefreshCount}`,
      // code exchange always returns a refresh token; refresh grant only
      // rotates it on the first call (mirrors Google's actual behaviour)
      refresh_token: isCodeExchange || tokenRefreshCount === 1 ? `rt_${tokenRefreshCount}` : undefined,
      expires_in: 3600,
    }), { status: 200 }))
  }
  if (url.includes('retrieveUserQuotaSummary')) {
    return Promise.resolve(new Response(JSON.stringify({
      groups: [
        { displayName: 'Gemini Models', description: 'Gemini Flash, Gemini Pro', buckets: [
          { bucketId: 'gemini-weekly', displayName: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 0.42, resetTime: '2026-11-11T12:00:00Z' },
          { bucketId: 'gemini-5h', displayName: 'Five Hour Limit Remaining', window: '5h', remainingFraction: 0.9, resetTime: '2026-11-04T18:00:00Z' },
        ] },
        { displayName: 'Claude and GPT models', description: 'Claude, GPT-OSS', buckets: [
          { bucketId: '3p-weekly', displayName: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 1 },
        ] },
      ],
    }), { status: 200 }))
  }
  if (url.includes('fetchAvailableModels')) {
    if (quotaProbeStatus !== 200) {
      return Promise.resolve(new Response('{"error":"RESOURCE_EXHAUSTED"}', { status: quotaProbeStatus }))
    }
    // Shaped like the real response: the headline comes from the lowest fraction.
    return Promise.resolve(new Response(JSON.stringify({
      models: {
        'gemini-3-flash': { displayName: 'Gemini 3 Flash', quotaInfo: { remainingFraction: 0.42, resetTime: '2026-11-04T14:34:22Z' } },
        'gemini-4-argon': { displayName: 'Gemini 4 Argon', quotaInfo: { remainingFraction: 0.91, resetTime: '2026-11-04T15:00:00Z' } },
        'gemini-3.8-flash': { displayName: 'Gemini 3.8 Flash', quotaInfo: { remainingFraction: 0.88, resetTime: '2026-11-04T15:10:00Z' } },
        'some-unrelated-model': { displayName: 'Unrelated', quotaInfo: { remainingFraction: 0.05 } },
      },
    }), { status: 200 }))
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
core.configureOAuthClientFile(path.join(stateDir, 'oauth-client.json'))

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
// Minimal cordis-like ctx: webServer plus the connection.fetch registry the
// Settings card routes ride, and effect() which runs the callback immediately.
const connRoutes = new Map()
const ctx = {
  webServer: { register: (r) => routes.push(r) },
  connection: {
    fetch: {
      register: (route) => {
        connRoutes.set(route.path, route)
        return () => {}
      },
    },
  },
  effect: (fn) => fn(),
  get: (name) => (name === 'connection' ? ctx.connection : undefined),
}
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
  assert.equal(r.json.refresh, 'rt_1')
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

await test('auth/start defaults to same-origin webflow (no URL copying)', async () => {
  const r = await call('POST', '/antigravity/api/auth/start', {})
  assert.equal(r.status, 200)
  assert.ok(r.json.authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'))
  assert.ok(r.json.authUrl.includes('access_type=offline'))
  assert.ok(r.json.authUrl.includes('code_challenge_method=S256'))
  assert.ok(r.json.codeVerifier.length > 40)
  assert.equal(r.json.mode, 'webflow')
  assert.ok(r.json.redirectUri.endsWith('/antigravity/oauth/callback'), 'redirect về chính host')
  assert.ok(r.json.authUrl.includes(encodeURIComponent('/antigravity/oauth/callback')), 'authUrl mang redirect same-origin')
  assert.ok(r.json.state && r.json.state.length > 20, 'state chống CSRF')
})

await test('auth/start paste mode still offers the loopback redirect', async () => {
  const r = await call('POST', '/antigravity/api/auth/start', { mode: 'paste' })
  assert.equal(r.status, 200)
  assert.equal(r.json.mode, 'paste')
  assert.equal(r.json.redirectUri, 'http://localhost:51121/oauth-callback')
})

await test('oauth callback completes the flow end to end (no paste)', async () => {
  const start = await call('POST', '/antigravity/api/auth/start', {})
  const before = calls.length
  const res = fakeRes()
  await handler(
    fakeReq('GET', `/antigravity/oauth/callback?code=4%2F0AWEBFLOW&state=${encodeURIComponent(start.json.state)}`),
    res,
  )
  assert.equal(res.code, 200)
  assert.match(String(res.body), /Đã kết nối tài khoản/, 'trang kết quả thành công')
  const tokenCalls = calls.slice(before).filter((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))
  assert.equal(tokenCalls.length, 1)
  assert.ok(String(tokenCalls[0].init.body).includes('grant_type=authorization_code'))
  const pool = (await call('GET', '/antigravity/api/pool')).json
  assert.ok(pool.accounts.length >= 1)
})

await test('oauth callback rejects an unknown/expired state', async () => {
  const res = fakeRes()
  await handler(fakeReq('GET', '/antigravity/oauth/callback?code=x&state=bogus-state'), res)
  assert.equal(res.code, 200)
  assert.match(String(res.body), /hết hạn|không khớp/)
})

await test('oauth callback surfaces the Google error param', async () => {
  const start = await call('POST', '/antigravity/api/auth/start', {})
  const res = fakeRes()
  await handler(fakeReq('GET', `/antigravity/oauth/callback?error=access_denied&state=${encodeURIComponent(start.json.state)}`), res)
  assert.match(String(res.body), /access_denied/)
})

await test('auth/exchange pastes callback URL, calls token endpoint, stores account', async () => {
  const start = await call('POST', '/antigravity/api/auth/start', {})
  const before = calls.length
  const r = await call('POST', '/antigravity/api/auth/exchange', {
    callbackUrlOrCode: 'http://localhost:51121/oauth-callback?code=4%2F0ATEST&scope=https://www.googleapis.com/auth/cloud-platform',
    codeVerifier: start.json.codeVerifier,
    email: 'via-link@example.com',
  })
  assert.equal(r.status, 200, 'exchange should succeed: ' + JSON.stringify(r.json))
  assert.equal(r.json.email, 'via-link@example.com')
  // token endpoint hit exactly once with authorization_code grant
  const tokenCalls = calls.slice(before).filter((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))
  assert.equal(tokenCalls.length, 1)
  const sentBody = tokenCalls[0].init.body.toString()
  assert.ok(sentBody.includes('grant_type=authorization_code'))
  assert.ok(sentBody.includes('code_verifier='))
  // account landed in pool
  const pool = (await call('GET', '/antigravity/api/pool')).json
  assert.ok(pool.accounts.some((a) => a.email === 'via-link@example.com'))
})

await test('auth/exchange rejects empty/garbage input before hitting Google', async () => {
  // empty payload → plugin-side 400, no network call
  const before = calls.length
  const r0 = await call('POST', '/antigravity/api/auth/exchange', { callbackUrlOrCode: '' })
  assert.equal(r0.status, 400)
  assert.ok(r0.json.error.includes('code'))
  assert.equal(calls.length, before, 'no token endpoint call for empty input')
  // a string with no code= param is forwarded to Google as-is; with the real
  // Google endpoint it 400s. Under fake fetch we just assert a call happened.
  await call('POST', '/antigravity/api/auth/exchange', { callbackUrlOrCode: 'no-code-here' })
  assert.ok(calls.length > before, 'non-empty garbage forwarded to token endpoint (Google rejects it there)')
})

await test('oauth-client can be saved to file when env is absent', async () => {
  const savedId = process.env.ANTIGRAVITY_CLIENT_ID
  const savedSecret = process.env.ANTIGRAVITY_CLIENT_SECRET
  delete process.env.ANTIGRAVITY_CLIENT_ID
  delete process.env.ANTIGRAVITY_CLIENT_SECRET

  // before saving: not configured
  let st = (await call('GET', '/antigravity/api/status')).json
  assert.equal(st.configured, false)
  assert.equal(st.source, 'none')

  // invalid id rejected
  const bad = await call('POST', '/antigravity/api/oauth-client', { clientId: 'short', clientSecret: 'x' })
  assert.equal(bad.status, 400)

  // valid id+secret persisted
  const ok = await call('POST', '/antigravity/api/oauth-client', {
    clientId: '999999-test.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-test-secret',
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.source, 'file')

  const file = path.join(stateDir, 'oauth-client.json')
  assert.ok(fs.existsSync(file), 'oauth-client.json written')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'file is 0600')
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(stored.clientId, '999999-test.apps.googleusercontent.com')

  // status now reflects file source, secret never echoed
  st = (await call('GET', '/antigravity/api/status')).json
  assert.equal(st.configured, true)
  assert.equal(st.source, 'file')
  assert.ok(!JSON.stringify(st).includes('GOCSPX'), 'status never leaks the secret')

  // auth flow works from the file-stored client
  const start = await call('POST', '/antigravity/api/auth/start', {})
  assert.equal(start.status, 200)
  assert.ok(start.json.authUrl.includes('999999-test.apps.googleusercontent.com'))

  // env overrides file when both exist
  process.env.ANTIGRAVITY_CLIENT_ID = '888888-env.apps.googleusercontent.com'
  process.env.ANTIGRAVITY_CLIENT_SECRET = 'GOCSPX-env-secret'
  st = (await call('GET', '/antigravity/api/status')).json
  assert.equal(st.source, 'env')

  // clearing removes the file
  await call('DELETE', '/antigravity/api/oauth-client')
  assert.ok(!fs.existsSync(file), 'oauth-client.json removed')

  process.env.ANTIGRAVITY_CLIENT_ID = savedId
  process.env.ANTIGRAVITY_CLIENT_SECRET = savedSecret
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
  assert.match(html, /auth\/start/, 'UI có luồng link auth')
  assert.match(html, /oauth-client/, 'UI có form OAuth client')
  assert.match(html, /fClientSecret/, 'UI nhập được client secret')
  assert.ok(!/fAccess|fRefresh|Dán token/.test(html), 'UI không còn nhập token tay')
  assert.match(html, /class="n"/, 'badge bước dùng class riêng (hết chồng chữ)')
  // mobile + a11y checklist
  assert.match(html, /viewport-fit=cover/, 'safe area viewport')
  assert.match(html, /prefers-reduced-motion/, 'tôn trọng reduced motion')
  assert.match(html, /focus-visible/, 'focus ring cho keyboard')
  assert.match(html, /for="fClientId"/, 'label liên kết input')
  assert.match(html, /inputmode/, 'bàn phím mobile phù hợp')
  assert.ok(!/\u23f3|\u26a0|\ud83d\udd17|\ud83d\udcbe|\ud83e\uddf2/.test(html), 'không dùng emoji làm icon cấu trúc')
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

await test('every component client.js renders is defined in the bundle', () => {
  const client = fs.readFileSync(path.join(pluginDir, 'client.js'), 'utf8')
  // Regression: removing AddDialog once deleted AccountCard too, and the slot
  // crashed at runtime with "ReferenceError: AccountCard is not defined" —
  // the card appeared for a frame and vanished.
  const used = new Set([...client.matchAll(/h\(\s*([A-Z][A-Za-z0-9_]*)\s*,/g)].map((m) => m[1]))
  const defined = new Set([...client.matchAll(/function ([a-zA-Z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]))
  for (const name of used) {
    assert.ok(defined.has(name), 'component ' + name + ' được dùng nhưng không định nghĩa')
  }
  assert.ok(defined.has('AntigravityPool'), 'AntigravityPool phải tồn tại')

  // Catch helpers used but never defined. Restricted to component names
  // (capitalised) and the specific helpers that were lost before: scanning all
  // lowercase words would also match CSS keywords inside template strings.
  const usedComponents = new Set([...client.matchAll(/h\(\s*([A-Z][A-Za-z0-9_]*)\s*,/g)].map((m) => m[1]))
  for (const name of usedComponents) {
    assert.ok(defined.has(name), 'component ' + name + ' được dùng nhưng không định nghĩa')
  }
  for (const helper of ['fill', 'call', 'dictionary']) {
    if (client.includes(helper + '(')) {
      assert.ok(defined.has(helper), 'helper ' + helper + ' được gọi nhưng không định nghĩa')
    }
  }
})

await test('the Settings card has exactly one add-account button', () => {
  const client = fs.readFileSync(path.join(pluginDir, 'client.js'), 'utf8')
  const n = (client.match(/t\.addOnPage/g) || []).length
  assert.equal(n, 1, 'chỉ một nút mở trang thêm tài khoản, gặp ' + n)
})

await test('the Settings card links to the page instead of duplicating the add dialog', () => {
  const client = fs.readFileSync(path.join(pluginDir, 'client.js'), 'utf8')
  // One implementation: the card sends people to /antigravity to add an account.
  assert.ok(!/AddDialog/.test(client), 'không còn AddDialog trong card')
  assert.ok(!/setAdding/.test(client), 'không còn state modal thêm tài khoản')
  assert.match(client, /new URL\('antigravity', document\.baseURI\)/, 'nút mở trang /antigravity')
  assert.match(client, /addOnPage/, 'nhãn nút nói rõ là mở trang')
})

await test('the standalone page still owns the add-account flow', () => {
  const ui = fs.readFileSync(path.join(pluginDir, 'ui.html'), 'utf8')
  assert.match(ui, /id="openAuth"/, 'trang có nút đăng nhập Google')
  assert.match(ui, /id="fCallback"/, 'trang có ô dán URL callback')
  assert.match(ui, /id="mConnect"/, 'trang có nút kết nối')
})

await test('quota summary route returns grouped buckets', async () => {
  const r = await call('POST', '/antigravity/api/quota-summary', {})
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.ok, true)
  const gemini = r.json.groups.find((g) => g.name === 'Gemini Models')
  assert.ok(gemini, 'có nhóm Gemini')
  const weekly = gemini.buckets.find((b) => b.id === 'gemini-weekly')
  assert.equal(weekly.percent, 42)
  assert.equal(weekly.window, 'weekly')
  const fiveHour = gemini.buckets.find((b) => b.id === 'gemini-5h')
  assert.equal(fiveHour.percent, 90)
  assert.ok(r.json.groups.some((g) => g.name === 'Claude and GPT models'))
})

await test('probeQuota embeds the grouped summary', async () => {
  const r = await call('POST', '/antigravity/api/quota', {})
  assert.equal(r.status, 200)
  const row = r.json.accounts[0]
  assert.ok(Array.isArray(row.groups) && row.groups.length > 0, 'có groups trong kết quả probe')
  assert.ok(row.groups[0].buckets.length > 0)
})

await test('models route lists models with capabilities', async () => {
  const fakeModels = {
    models: {
      'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6', supportsImages: true, supportsThinking: true, maxTokens: 250000, maxOutputTokens: 64000, modelProvider: 'MODEL_PROVIDER_ANTHROPIC' },
      'gemini-3.8-flash-tiered': { displayName: 'Gemini 3.8 Flash', supportsImages: true, maxTokens: 1000000 },
      'gemini-3.1-flash-image': { displayName: 'Gemini 3.1 Flash Image', supportsImages: true },
    },
    tieredModelIds: { flash: ['gemini-3.8-flash-tiered'] },
  }
  const original = fakeFetch
  core.setFetchImpl((url, init) => (
    url.includes('fetchAvailableModels')
      ? Promise.resolve(new Response(JSON.stringify(fakeModels), { status: 200 }))
      : original(url, init)
  ))
  try {
    const r = await call('GET', '/antigravity/api/models')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.count, 3)
    const claude = r.json.models.find((m) => m.id === 'claude-sonnet-4-6')
    assert.equal(claude.name, 'Claude Sonnet 4.6')
    assert.equal(claude.images, true)
    assert.equal(claude.thinking, true)
    assert.equal(claude.maxOutputTokens, 64000)
    const flash = r.json.models.find((m) => m.id === 'gemini-3.8-flash-tiered')
    assert.equal(flash.tier, 'flash')
  } finally {
    core.setFetchImpl(original)
  }
})

await test('settings models route is registered', () => {
  assert.ok(connRoutes.has('/api/antigravity.models'), 'card có route models')
})

await test('docs/models-and-quota.md documents the UA trap and the two groups', () => {
  const doc = fs.readFileSync(path.join(pluginDir, 'docs', 'models-and-quota.md'), 'utf8')
  assert.match(doc, /retrieveUserQuotaSummary/, 'nêu endpoint đúng')
  assert.match(doc, /antigravity\/hub\/2\.24\.0/, 'UA đúng')
  assert.match(doc, /UA.*quyết định|gates/i, 'cảnh báo UA gating')
  assert.match(doc, /Gemini Models/, 'nhóm Gemini')
  assert.match(doc, /Claude and GPT/, 'nhóm Claude/GPT')
  for (const bucket of ['gemini-weekly', 'gemini-5h', '3p-weekly', '3p-5h']) {
    assert.match(doc, new RegExp(bucket), 'bucket ' + bucket)
  }
  assert.match(doc, /fetchAvailableModels/, 'endpoint model list')
})

// ---- rotation, per-account model support, retry ----
const future = Date.now() + 10 * 60 * 60 * 1000
function seedRotationPool(extra = {}) {
  const base = core.loadPool()
  base.accounts = [
    { id: 'paid1', email: 'paid1@x', access: 'tok-paid1', refresh: 'r', expires: future, status: 'active',
      models: ['gemini-4-argon-high', 'gemini-3.8-flash-tiered', 'claude-sonnet-5-5-high', 'claude-opus-5-5-high'] },
    { id: 'free1', email: 'free1@x', access: 'tok-free1', refresh: 'r', expires: future, status: 'active',
      models: ['gemini-3.8-flash-tiered', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking'],
      disabledModels: ['gemini-4-argon-disabled'] },
    { id: 'paid2', email: 'paid2@x', access: 'tok-paid2', refresh: 'r', expires: future, status: 'active',
      models: ['gemini-4-argon-low', 'gemini-3.8-flash-tiered', 'claude-sonnet-5-5-low', 'claude-opus-5-5-low'] },
  ]
  base.activeIndex = 0
  base.rotationCursor = -1
  base.rotationEnabled = true
  base.retryOnQuota = true
  Object.assign(base, extra)
  core.savePool(base)
}

await test('supportFor tells which account serves which model', () => {
  seedRotationPool()
  const [paid1, free1] = core.loadPool().accounts
  assert.equal(core.supportFor(paid1, 'gemini-4-argon').level, 'full')
  assert.deepEqual(core.supportFor(paid1, 'gemini-4-argon').ids, ['gemini-4-argon-high'])
  // free tier: Argon only as the 3.8 substitute, Claude only as 4.6
  assert.equal(core.supportFor(free1, 'gemini-4-argon').level, 'fallback')
  assert.equal(core.supportFor(free1, 'claude-sonnet-5-5').level, 'fallback')
  assert.deepEqual(core.supportFor(free1, 'claude-sonnet-5-5').ids, ['claude-sonnet-4-6'])
  assert.equal(core.supportFor(free1, 'gemini-3.8-flash').level, 'full')
  assert.equal(core.supportFor({}, 'gemini-4-argon').level, 'unknown')
  assert.equal(core.supportFor({ models: [] }, 'claude-opus-5-5').level, 'none')
})

await test('pool view exposes per-account support and both toggles', () => {
  seedRotationPool()
  const view = core.getSanitizedPoolView()
  assert.equal(view.rotationEnabled, true)
  assert.equal(view.retryOnQuota, true)
  const free = view.accounts.find((a) => a.id === 'free1')
  assert.equal(free.support['claude-opus-5-5'].level, 'fallback')
  assert.equal(free.enabled, true)
  assert.ok(!JSON.stringify(view).includes('tok-paid1'), 'token không lộ ra view')
})

await test('rotation on: requests go round-robin over accounts with the real model', async () => {
  seedRotationPool()
  const order = []
  for (let i = 0; i < 4; i++) order.push((await core.acquireAccount('claude-sonnet-5-5')).id)
  // free1 only has the 4.6 substitute, so the two paid accounts alternate
  assert.deepEqual(order, ['paid1', 'paid2', 'paid1', 'paid2'])
})

await test('rotation off: the active account keeps serving', async () => {
  seedRotationPool({ rotationEnabled: false, activeIndex: 2 })
  const ids = []
  for (let i = 0; i < 3; i++) ids.push((await core.acquireAccount('gemini-3.8-flash')).id)
  assert.deepEqual(ids, ['paid2', 'paid2', 'paid2'])
})

await test('rotation off but active account lacks the model: another one serves it', async () => {
  seedRotationPool({ rotationEnabled: false, activeIndex: 1 })
  const lease = await core.acquireAccount('gemini-4-argon')
  assert.equal(lease.level, 'full')
  assert.notEqual(lease.id, 'free1')
})

await test('disabled account is skipped by rotation', async () => {
  seedRotationPool()
  core.setAccountEnabled('paid1', false)
  const ids = new Set()
  for (let i = 0; i < 4; i++) ids.add((await core.acquireAccount('claude-opus-5-5')).id)
  assert.deepEqual([...ids], ['paid2'])
  assert.equal(core.getSanitizedPoolView().accounts.find((a) => a.id === 'paid1').enabled, false)
})

await test('retry: exclude walks to the next account, substitute only as last resort', async () => {
  seedRotationPool()
  const first = await core.acquireAccount('claude-sonnet-5-5', { exclude: [] })
  const second = await core.acquireAccount('claude-sonnet-5-5', { exclude: [first.id] })
  const third = await core.acquireAccount('claude-sonnet-5-5', { exclude: [first.id, second.id] })
  const none = await core.acquireAccount('claude-sonnet-5-5', { exclude: [first.id, second.id, third.id] })
  assert.equal(first.level, 'full')
  assert.equal(second.level, 'full')
  assert.equal(third.id, 'free1')
  assert.equal(third.level, 'fallback')
  assert.equal(none, null)
})

await test('report 429 cools the account down so rotation routes around it', async () => {
  seedRotationPool()
  await core.reportAccountResult('paid1', { ok: false, status: 429, message: 'RESOURCE_EXHAUSTED' })
  const acc = core.loadPool().accounts.find((a) => a.id === 'paid1')
  assert.ok(acc.quotaExceededUntil > Date.now(), 'paid1 đang nghỉ')
  const ids = new Set()
  for (let i = 0; i < 3; i++) ids.add((await core.acquireAccount('gemini-4-argon')).id)
  assert.ok(!ids.has('paid1'))
})

await test('report 401 parks the account briefly; plain errors only log', async () => {
  seedRotationPool()
  await core.reportAccountResult('paid2', { ok: false, status: 401, message: 'UNAUTHENTICATED' })
  await core.reportAccountResult('paid1', { ok: false, status: 500, message: 'backend' })
  const pool = core.loadPool()
  const paid2 = pool.accounts.find((a) => a.id === 'paid2')
  const paid1 = pool.accounts.find((a) => a.id === 'paid1')
  assert.ok(paid2.quotaExceededUntil > Date.now())
  assert.ok(paid2.quotaExceededUntil < Date.now() + 6 * 60 * 1000, 'chỉ nghỉ 5 phút')
  assert.equal(paid1.quotaExceededUntil, null)
  assert.equal(paid1.failures, 1)
})

await test('report ok counts the request and clears the error', async () => {
  seedRotationPool()
  await core.reportAccountResult('paid1', { ok: false, status: 500, message: 'x' })
  await core.reportAccountResult('paid1', { ok: true })
  const paid1 = core.loadPool().accounts.find((a) => a.id === 'paid1')
  assert.equal(paid1.lastError, null)
  assert.equal(paid1.totalRequests, 1)
})

await test('config route persists rotationEnabled and retryOnQuota', async () => {
  seedRotationPool()
  const r = await call('POST', '/antigravity/api/config', { rotationEnabled: false, retryOnQuota: false })
  assert.equal(r.status, 200)
  assert.equal(r.json.rotationEnabled, false)
  assert.equal(r.json.retryOnQuota, false)
  const view = core.getSanitizedPoolView()
  assert.equal(view.rotationEnabled, false)
  assert.equal(view.retryOnQuota, false)
})

await test('account-toggle route switches one account', async () => {
  seedRotationPool()
  const off = await call('POST', '/antigravity/api/account-toggle', { id: 'free1', enabled: false })
  assert.equal(off.status, 200)
  assert.equal(off.json.enabled, false)
  const missing = await call('POST', '/antigravity/api/account-toggle', { id: 'nope', enabled: false })
  assert.equal(missing.status, 404)
})

await test('runtime hook is installed on globalThis', async () => {
  const hook = globalThis.__dshAntigravityPool
  assert.ok(hook && typeof hook.acquire === 'function' && typeof hook.report === 'function')
  seedRotationPool()
  const lease = await hook.acquire('gemini-4-argon', {})
  assert.equal(lease.token.startsWith('tok-'), true)
  assert.ok(Array.isArray(lease.upstream) && lease.upstream.length > 0)
})

await test('docs/oauth-client.md ships and distinguishes invalid_grant from invalid_client', () => {
  const doc = fs.readFileSync(path.join(pluginDir, 'docs', 'oauth-client.md'), 'utf8')
  // the client-verification trick must be documented with both outcomes
  assert.match(doc, /invalid_grant/, 'nêu invalid_grant = client đúng')
  assert.match(doc, /invalid_client/, 'nêu invalid_client = client sai')
  assert.match(doc, /oauth2\.googleapis\.com\/token/, 'có lệnh curl kiểm chứng')
  assert.match(doc, /localhost:51121/, 'redirect đúng')
  // both routes documented: public client and self-created client
  assert.match(doc, /Cloud Console|console\.cloud\.google\.com/, 'cách B: tự tạo client')
  assert.match(doc, /opencode-antigravity-auth/, 'dẫn nguồn client công khai')
})

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

// apply() already mounted the Settings routes on ctx.connection.fetch above,
// so reuse that registry instead of mounting a second isolated copy.
const fetchRoutes = connRoutes

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

await test('handshake started in the Settings card is completed by the page callback', async () => {
  // Flow that was broken: settings minted a state into its own Map while the
  // callback route read a different one, so the card could never finish.
  const route = fetchRoutes.get('/api/antigravity.authUrl')
  const minted = await route.fetch(new Request('http://x/api/antigravity.authUrl', {
    method: 'POST',
    body: JSON.stringify({ origin: 'https://dsh.example' }),
  }))
  assert.equal(minted.status, 200)
  const { state, redirectUri } = await minted.json()
  assert.equal(redirectUri, 'https://dsh.example/antigravity/oauth/callback')

  const before = calls.length
  const res = fakeRes()
  await handler(fakeReq('GET', `/antigravity/oauth/callback?code=4%2FXSURFACE&state=${encodeURIComponent(state)}`), res)
  assert.match(String(res.body), /Đã kết nối tài khoản/, 'callback hoàn tất phiên do Settings tạo')
  const tokenCalls = calls.slice(before).filter((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))
  assert.equal(tokenCalls.length, 1)
  assert.ok(String(tokenCalls[0].init.body).includes(encodeURIComponent('https://dsh.example/antigravity/oauth/callback')),
    'token exchange replays the same-origin redirect')
})

// ---------- live quota ----------
await test('probeQuota reports the lowest chat-model fraction as the headline', async () => {
  const result = await core.probeQuota()
  assert.equal(result.ok, true)
  const row = result.accounts.find((a) => a.email)
  assert.ok(row, 'an account row is returned')
  // 0.42 is the lowest Gemini chat model; the unrelated 0.05 is ignored.
  assert.equal(row.percent, 42)
  assert.equal(row.bottleneck, 'Gemini 3 Flash')
  assert.equal(row.resetTime, '2026-11-04T14:34:22Z')
})

await test('probeQuota caches the number in the pool view', async () => {
  const view = core.getSanitizedPoolView()
  const withQuota = view.accounts.filter((a) => a.lastQuota)
  assert.ok(withQuota.length > 0, 'at least one account carries a cache')
  assert.equal(typeof withQuota[0].lastQuota.checkedAt, 'number')
  assert.ok(['number', 'object'].includes(typeof withQuota[0].lastQuota.percent))
})

await test('probeQuota reports a probe failure without throwing', async () => {
  quotaProbeStatus = 429
  try {
    const result = await core.probeQuota()
    const row = result.accounts[0]
    assert.equal(row.ok, false)
    assert.equal(row.percent, null)
    assert.ok(row.message.includes('429'))
  } finally {
    quotaProbeStatus = 200
  }
})

await test('settings quota route answers a snapshot and never leaks tokens', async () => {
  if (!fetchRoutes.has('/api/antigravity.quota')) {
    // route registered only by the settings half; mount it if the earlier
    // suite did not (keeps this test independent of ordering)
    settingsMod.registerSettingsRoutes(settingsCtx)
  }
  const route = fetchRoutes.get('/api/antigravity.quota')
  const response = await route.fetch(new Request('http://x/api/antigravity.quota', { method: 'POST', body: '{}' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.accounts))
  const serialized = JSON.stringify(body)
  assert.equal(serialized.includes('"access"'), false)
  assert.equal(serialized.includes('"refresh"'), false)
})

console.log(`\nAll ${passed} tests passed ✅`)
fs.rmSync(tmp, { recursive: true, force: true })
