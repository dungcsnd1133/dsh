import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  configurePaths,
  getSanitizedPoolView,
  getActiveValidAccount,
  handleAccountQuotaExceeded,
  recordAccountSuccess,
  addOrUpdateAccount,
  removeAccount,
  setActiveAccount,
  resetAccountQuota,
  updatePoolConfig,
  testAccountQuota,
  probeQuota,
  readAntigravityEnv,
  isConfigured,
  buildAuthUrl,
  makePkcePair,
  exchangeCallback,
  rememberHandshake,
  takeHandshake,
  configureOAuthClientFile,
  oauthClientSource,
  saveOAuthClient,
  clearOAuthClient,
  ANTIGRAVITY_AUTH_URL,
  ANTIGRAVITY_TOKEN_URL,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
} from './pool-core.mjs'
import { registerSettingsRoutes } from './settings-routes.mjs'

export const name = 'dsh-antigravity-pool'
// 'connection' supplies the authenticated /api channel used by the Settings card.
// Without it in inject our ctx.get('connection') is always undefined and the
// card's routes are never registered (the card then 404s on every call).
export const inject = ['webServer', 'connection']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const UI_FILE = join(PLUGIN_DIR, 'ui.html')

function randomStateToken() {
  return randomBytes(24).toString('base64url')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Work out the public origin Google should redirect back to.
function publicOriginFrom(req, override) {
  if (override) return String(override).replace(/\/$/, '')
  const envOrigin = process.env.DSH_PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN
  if (envOrigin) return envOrigin.replace(/\/$/, '')
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  if (host) return `${proto}://${host}`
  return 'http://127.0.0.1:3082'
}

function resultPage(ok, message) {
  const color = ok ? '#3ddc84' : '#ff6b6b'
  const title = ok ? 'Đã kết nối tài khoản' : 'Đăng nhập chưa xong'
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e14;color:#e8ecf4;
       font:15px/1.6 -apple-system,'Segoe UI',Roboto,sans-serif;padding:24px;text-align:center}
  .box{max-width:360px}
  .mark{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;
        background:${ok ? 'rgba(61,220,132,.12)' : 'rgba(255,107,107,.12)'};color:${color};font-size:26px;font-weight:700}
  h1{font-size:17px;margin:0 0 8px;color:${color}}
  p{margin:0 0 20px;color:#9aa5b8;font-size:13.5px;word-break:break-word}
  a{display:inline-block;background:#1a2030;border:1px solid #2e3749;color:#e8ecf4;text-decoration:none;
    border-radius:9px;padding:11px 20px;font-size:13.5px}
</style></head><body><div class="box">
  <div class="mark">${ok ? '✓' : '!'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <a href="/antigravity">Quay lại bảng điều khiển</a>
</div></body></html>`
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx, config) {
  const stateDir = config?.stateDir
  if (!stateDir) throw new Error('[dsh-antigravity-pool] stateDir is required in cordis.patch.yml config')
  const credentialsFile = config?.credentialsFile ? String(config.credentialsFile) : undefined
  configurePaths({ stateDir, credentialsFile })
  // OAuth client can be typed into the UI; stored 0600 beside pool state.
  configureOAuthClientFile(join(stateDir, 'oauth-client.json'))

  const json = (res, status, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: '/antigravity',
    async handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathName = url.pathname
      try {
        // UI — read fresh from disk each request so UI updates need no restart
        if (pathName === '/antigravity' || pathName === '/antigravity/' || pathName === '/antigravity/ui') {
          if (!existsSync(UI_FILE)) {
            return json(res, 500, { error: 'ui.html missing next to index.js' })
          }
          const html = readFileSync(UI_FILE, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(req.method === 'HEAD' ? undefined : html)
          return
        }

        if (pathName === '/antigravity/api/status') {
          const env = readAntigravityEnv()
          json(res, 200, {
            configured: isConfigured(),
            source: oauthClientSource(),
            clientIdMasked: env.clientId ? env.clientId.slice(0, 12) + '…' : '',
            authUrl: ANTIGRAVITY_AUTH_URL,
            tokenUrl: ANTIGRAVITY_TOKEN_URL,
            redirectUri: ANTIGRAVITY_REDIRECT_URI,
            scopes: ANTIGRAVITY_SCOPES,
            defaultProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
          })
          return
        }

        // Save / clear the OAuth client from the UI (stored 0600, never echoed back)
        if (pathName === '/antigravity/api/oauth-client' && req.method === 'POST') {
          const body = await readBody(req)
          try {
            saveOAuthClient({ clientId: body.clientId, clientSecret: body.clientSecret })
            json(res, 200, { ok: true, source: oauthClientSource() })
          } catch (err) {
            json(res, 400, { error: err instanceof Error ? err.message : String(err) })
          }
          return
        }

        if (pathName === '/antigravity/api/oauth-client' && req.method === 'DELETE') {
          clearOAuthClient()
          json(res, 200, { ok: true, source: oauthClientSource() })
          return
        }

        if (pathName === '/antigravity/api/pool' && req.method === 'GET') {
          json(res, 200, getSanitizedPoolView())
          return
        }

        if (pathName === '/antigravity/api/activate' && req.method === 'POST') {
          const body = await readBody(req)
          const acc = setActiveAccount(String(body.id || ''))
          if (!acc) return json(res, 404, { error: 'account not found' })
          json(res, 200, { ok: true, email: acc.email })
          return
        }

        if (pathName === '/antigravity/api/remove' && req.method === 'POST') {
          const body = await readBody(req)
          const ok = removeAccount(String(body.id || ''))
          json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'account not found' })
          return
        }

        if (pathName === '/antigravity/api/reset-quota' && req.method === 'POST') {
          const body = await readBody(req)
          const acc = resetAccountQuota(String(body.id || ''))
          json(res, acc ? 200 : 404, acc ? { ok: true } : { error: 'account not found' })
          return
        }

        if (pathName === '/antigravity/api/test' && req.method === 'POST') {
          const body = await readBody(req)
          const result = await testAccountQuota(body.id ? String(body.id) : undefined)
          json(res, 200, result)
          return
        }

        if (pathName === '/antigravity/api/quota') {
          const body = req.method === 'POST' ? await readBody(req) : {}
          const target = body.id ? String(body.id) : (url.searchParams.get('id') || undefined)
          const result = await probeQuota(target)
          json(res, 200, result)
          return
        }

        if (pathName === '/antigravity/api/config' && req.method === 'POST') {
          const body = await readBody(req)
          json(res, 200, updatePoolConfig({
            strategy: body.strategy,
            retryOnQuota: body.retryOnQuota,
            cooldownMinutes: body.cooldownMinutes,
          }))
          return
        }

        // --- OAuth: two modes ---
        // 1) Same-origin callback (webflow): Google redirects straight back to
        //    /antigravity/oauth/callback on this host and we finish the flow —
        //    the user never copies a URL. Needs the public origin registered as
        //    an authorised redirect URI on the OAuth client.
        // 2) Desktop/loopback: Google redirects to localhost:51121 which cannot
        //    reach the server, so the user pastes the callback URL back.
        if (pathName === '/antigravity/api/auth/start' && req.method === 'POST') {
          const body = await readBody(req).catch(() => ({}))
          const pkce = makePkcePair()
          const state = randomStateToken()
          const origin = publicOriginFrom(req, body.origin)
          const mode = body.mode === 'paste' ? 'paste' : 'webflow'
          const redirectUri = mode === 'webflow'
            ? `${origin}/antigravity/oauth/callback`
            : (body.redirectUri ? String(body.redirectUri) : ANTIGRAVITY_REDIRECT_URI)
          const authUrl = buildAuthUrl({
            redirectUri,
            state,
            codeChallenge: pkce.challenge,
          })
          // Remember PKCE verifier + redirect for the callback hop (5 min TTL).
          if (mode === 'webflow') {
            rememberHandshake(state, { codeVerifier: pkce.verifier, redirectUri })
          }
          json(res, 200, {
            authUrl,
            mode,
            redirectUri,
            state,
            codeVerifier: pkce.verifier,
          })
          return
        }

        // Google lands here in webflow mode
        if (pathName === '/antigravity/oauth/callback' && req.method === 'GET') {
          const code = url.searchParams.get('code') || ''
          const state = url.searchParams.get('state') || ''
          const errParam = url.searchParams.get('error') || ''
          const pending = takeHandshake(state)
          if (errParam) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(resultPage(false, `Google từ chối: ${escapeHtml(errParam)}`))
            return
          }
          if (!pending) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(resultPage(false, 'Phiên đăng nhập đã hết hạn (quá 5 phút) hoặc state không khớp. Bấm đăng nhập lại.'))
            return
          }
          try {
            const account = await exchangeCallback({
              callbackUrlOrCode: code,
              redirectUri: pending.redirectUri,
              codeVerifier: pending.codeVerifier,
            })
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(resultPage(true, `Đã thêm tài khoản ${escapeHtml(account.email)} vào pool.`))
          } catch (err) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(resultPage(false, escapeHtml(err instanceof Error ? err.message : String(err))))
          }
          return
        }

        if (pathName === '/antigravity/api/auth/exchange' && req.method === 'POST') {
          const body = await readBody(req)
          try {
            const account = await exchangeCallback({
              callbackUrlOrCode: String(body.callbackUrlOrCode || ''),
              redirectUri: body.redirectUri ? String(body.redirectUri) : undefined,
              codeVerifier: body.codeVerifier ? String(body.codeVerifier) : undefined,
              email: body.email ? String(body.email) : undefined,
              projectId: body.projectId ? String(body.projectId) : undefined,
            })
            json(res, 200, { ok: true, email: account.email, id: account.id })
          } catch (err) {
            json(res, 400, { error: err instanceof Error ? err.message : String(err) })
          }
          return
        }

        // Programmatic API for other plugins / integrations
        if (pathName === '/antigravity/api/account' && req.method === 'GET') {
          try {
            const account = await getActiveValidAccount({ rotateNext: url.searchParams.get('rotate') === 'next' })
            if (!account) return json(res, 404, { error: 'pool empty' })
            json(res, 200, account)
          } catch (err) {
            json(res, 503, { error: err instanceof Error ? err.message : String(err) })
          }
          return
        }

        if (pathName === '/antigravity/api/account' && req.method === 'POST') {
          const body = await readBody(req)
          const acc = addOrUpdateAccount(body)
          json(res, acc ? 200 : 400, acc ? { ok: true, email: acc.email } : { error: 'access & refresh required' })
          return
        }

        if (pathName === '/antigravity/api/quota-exceeded' && req.method === 'POST') {
          const body = await readBody(req)
          const acc = handleAccountQuotaExceeded(String(body.id || ''), String(body.error || ''))
          json(res, acc ? 200 : 404, acc ? { ok: true } : { error: 'account not found' })
          return
        }

        if (pathName === '/antigravity/api/success' && req.method === 'POST') {
          const body = await readBody(req)
          recordAccountSuccess(String(body.id || ''))
          json(res, 200, { ok: true })
          return
        }

        json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    },
  })

  // Settings → Models card routes ride the authenticated /api channel.
  registerSettingsRoutes(ctx)
}
