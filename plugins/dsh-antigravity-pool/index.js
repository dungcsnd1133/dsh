import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  readAntigravityEnv,
  isConfigured,
  ANTIGRAVITY_AUTH_URL,
  ANTIGRAVITY_TOKEN_URL,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
} from './pool-core.mjs'
import { registerSettingsRoutes } from './settings-routes.mjs'

export const name = 'dsh-antigravity-pool'
export const inject = ['webServer']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const UI_FILE = join(PLUGIN_DIR, 'ui.html')

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
            clientIdMasked: env.clientId ? env.clientId.slice(0, 6) + '…' : '',
            authUrl: ANTIGRAVITY_AUTH_URL,
            tokenUrl: ANTIGRAVITY_TOKEN_URL,
            redirectUri: ANTIGRAVITY_REDIRECT_URI,
            scopes: ANTIGRAVITY_SCOPES,
            defaultProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
          })
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

        if (pathName === '/antigravity/api/config' && req.method === 'POST') {
          const body = await readBody(req)
          json(res, 200, updatePoolConfig({
            strategy: body.strategy,
            retryOnQuota: body.retryOnQuota,
            cooldownMinutes: body.cooldownMinutes,
          }))
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

  // Settings → Models card routes. They need the Connection service, which the
  // Web composition always mounts; a headless composition simply skips them
  // and keeps the standalone /antigravity page.
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
  if (connection !== undefined) registerSettingsRoutes(ctx)
}
