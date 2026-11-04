/**
 * Settings → Models card routes for the Antigravity pool.
 *
 * These routes ride the shared `/api` channel, so they sit behind the same
 * Host/Origin fence and browser authentication as every other DSH API: the
 * card works on any origin DSH serves, including ones where the standalone
 * `/antigravity` page is not exposed. The page route stays untouched.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  ANTIGRAVITY_AUTH_URL,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_TOKEN_URL,
  addOrUpdateAccount,
  handshakeCount,
  rememberHandshake,
  takeHandshake,
  getActiveValidAccount,
  loadPool,
  fetchModelCatalogue,
  fetchAccountTier,
  getFetch,
  getSanitizedPoolView,
  isConfigured,
  readAntigravityEnv,
  removeAccount,
  resetAccountQuota,
  setActiveAccount,
  testAccountQuota,
  updatePoolConfig,
  probeQuota,
} from './pool-core.mjs'

export const POOL_PATH = '/api/antigravity.pool'
export const AUTH_URL_PATH = '/api/antigravity.authUrl'
export const EXCHANGE_PATH = '/api/antigravity.exchange'
export const ACTION_PATH = '/api/antigravity.action'
export const MODELS_PATH = '/api/antigravity.models'
export const QUOTA_PATH = '/api/antigravity.quota'

const JSON_HEADERS = { 'cache-control': 'no-store' }

/**
 * Pull `code` and `state` out of a pasted redirect URL, a query string, or a
 * bare authorization code.
 * @param {unknown} input - what the user pasted.
 * @returns {{ code?: string, state?: string }} parsed pieces.
 */
export function parseRedirect(input) {
  const value = String(input ?? '').trim()
  if (value.length === 0) return {}
  try {
    const url = new URL(value)
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    }
  } catch {
    // not an absolute URL — fall through to query/bare-code handling
  }
  const queryStart = value.indexOf('?')
  if (queryStart >= 0) {
    const query = new URLSearchParams(value.slice(queryStart + 1))
    return { code: query.get('code') ?? undefined, state: query.get('state') ?? undefined }
  }
  // A bare authorization code is URL-safe and contains no whitespace. Text
  // with spaces (or a suspiciously short token) is prose pasted by mistake,
  // so report "no code" instead of sending garbage to Google.
  if (/\s/.test(value) || value.length < 8) return {}
  return { code: value }
}

/**
 * Read the Google account email behind an access token.
 * @param {string} accessToken - OAuth access token.
 * @returns {Promise<string | undefined>} the email when userinfo succeeds.
 */
async function fetchEmail(accessToken) {
  try {
    const response = await getFetch()('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return undefined
    const data = await response.json()
    return typeof data?.email === 'string' ? data.email : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the Cloud Code Assist project bound to a fresh access token.
 * @param {string} accessToken - OAuth access token.
 * @returns {Promise<string | undefined>} the project id, when discovery succeeds.
 */
async function discoverProject(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'X-Goog-Api-Client': 'gl-node/22.17.0',
    'Client-Metadata': JSON.stringify({ ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }),
  }
  for (const endpoint of ['https://daily-cloudcode-pa.sandbox.googleapis.com', 'https://cloudcode-pa.googleapis.com']) {
    try {
      const response = await getFetch()(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
        }),
      })
      if (!response.ok) continue
      const data = await response.json()
      if (typeof data?.cloudaicompanionProject === 'string' && data.cloudaicompanionProject.length > 0) {
        return data.cloudaicompanionProject
      }
    } catch {
      // try the next endpoint
    }
  }
  return undefined
}

/**
 * Read a JSON body, answering an empty object for anything unusable.
 * @param {Request} request - incoming Fetch request.
 * @returns {Promise<Record<string, unknown>>} parsed body.
 */
async function readJson(request) {
  try {
    const value = await request.json()
    return value !== null && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/**
 * Handles one pool mutation.
 * @param {string} action - action name from the request body.
 * @param {Record<string, unknown>} body - full request body.
 * @returns {Promise<Record<string, unknown>>} response payload.
 */
async function applyAction(action, body) {
  const target = typeof body.id === 'string' && body.id.length > 0 ? body.id : body.email

  if (action === 'select') {
    const account = setActiveAccount(String(target ?? ''))
    return account ? { ok: true, pool: getSanitizedPoolView() } : { ok: false, message: 'Không tìm thấy tài khoản.' }
  }

  if (action === 'remove') {
    const ok = removeAccount(String(target ?? ''))
    return ok ? { ok: true, pool: getSanitizedPoolView() } : { ok: false, message: 'Không tìm thấy tài khoản.' }
  }

  if (action === 'reset-quota') {
    const account = resetAccountQuota(String(target ?? ''))
    return account ? { ok: true, pool: getSanitizedPoolView() } : { ok: false, message: 'Không tìm thấy tài khoản.' }
  }

  if (action === 'test') {
    const result = await testAccountQuota(String(target ?? ''))
    return { ...result, pool: getSanitizedPoolView() }
  }

  if (action === 'config') {
    updatePoolConfig({
      ...(typeof body.strategy === 'string' ? { strategy: body.strategy } : {}),
      ...(typeof body.retryOnQuota === 'boolean' ? { retryOnQuota: body.retryOnQuota } : {}),
      ...(typeof body.cooldownMinutes === 'number' ? { cooldownMinutes: body.cooldownMinutes } : {}),
    })
    return { ok: true, pool: getSanitizedPoolView() }
  }

  return { ok: false, message: `Hành động không hỗ trợ: ${String(action)}` }
}

/**
 * Registers the four Settings-card routes on the authenticated `/api` channel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function registerSettingsRoutes(ctx) {

  let latestVerifier

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: POOL_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: () => {
          const view = getSanitizedPoolView()
          const active = view.accounts.find(account => account.isActive) ?? view.accounts[0] ?? null
          return Promise.resolve(
            Response.json(
              {
                configured: isConfigured(),
                connected: Boolean(active),
                email: active?.email ?? null,
                projectId: active?.projectId ?? null,
                expires: active?.expires ?? null,
                pool: view,
              },
              { headers: JSON_HEADERS },
            ),
          )
        },
      }),
    'antigravity-pool: settings status route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: AUTH_URL_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          const { clientId } = readAntigravityEnv()
          if (!isConfigured()) {
            return Promise.resolve(
              Response.json(
                { error: 'Chưa cấu hình ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET trên host.' },
                { status: 500 },
              ),
            )
          }
          const body = await readJson(request)
          // Same-origin callback keeps the flow inside Settings: Google comes
          // straight back here and no redirect URL has to be copied. The
          // loopback URI stays available for Desktop-app OAuth clients.
          const redirectUri =
            typeof body.origin === 'string' && body.origin && body.mode !== 'paste'
              ? `${String(body.origin).replace(/\/$/, '')}/antigravity/oauth/callback`
              : ANTIGRAVITY_REDIRECT_URI
          const verifier = randomBytes(32).toString('base64url')
          const state = randomBytes(16).toString('hex')
          rememberHandshake(state, { codeVerifier: verifier, redirectUri })
          latestVerifier = verifier
          const params = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: ANTIGRAVITY_SCOPES.join(' '),
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            state,
            access_type: 'offline',
            prompt: 'consent',
          })
          return Promise.resolve(
            Response.json({ authUrl: `${ANTIGRAVITY_AUTH_URL}?${params.toString()}`, state, redirectUri }),
          )
        },
      }),
    'antigravity-pool: settings auth-url route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: EXCHANGE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          const { clientId, clientSecret } = readAntigravityEnv()
          if (!clientId || !clientSecret) {
            return Response.json({ error: 'Server thiếu OAuth client credentials.' }, { status: 500 })
          }
          const body = await readJson(request)
          const parsed = parseRedirect(body.input)
          if (!parsed.code) {
            return Response.json({ error: 'Không tìm thấy mã code trong URL hoặc chuỗi bạn dán.' }, { status: 400 })
          }
          const stateKey = parsed.state ?? (typeof body.state === 'string' ? body.state : undefined)
          const session = takeHandshake(stateKey)
          const verifier = session?.codeVerifier ?? latestVerifier
          const exchangeRedirect = session?.redirectUri ?? ANTIGRAVITY_REDIRECT_URI
          if (!verifier) {
            return Response.json(
              { error: 'Phiên đăng nhập đã hết hạn. Bấm "Add account" để tạo phiên mới.' },
              { status: 400 },
            )
          }
          const tokenResponse = await getFetch()(ANTIGRAVITY_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code: parsed.code,
              grant_type: 'authorization_code',
              redirect_uri: exchangeRedirect,
              code_verifier: verifier,
            }),
          })
          if (!tokenResponse.ok) {
            const detail = await tokenResponse.text().catch(() => '')
            return Response.json(
              { error: `Đổi mã OAuth thất bại (${tokenResponse.status}): ${detail.slice(0, 300)}` },
              { status: 400 },
            )
          }
          const tokens = await tokenResponse.json()
          if (typeof tokens?.access_token !== 'string' || typeof tokens?.refresh_token !== 'string') {
            return Response.json({ error: 'Phản hồi OAuth thiếu access_token hoặc refresh_token.' }, { status: 400 })
          }
          const [email, projectId] = await Promise.all([fetchEmail(tokens.access_token), discoverProject(tokens.access_token)])
          const account = addOrUpdateAccount({
            type: 'oauth',
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + Number(tokens.expires_in || 3600) * 1000 - 5 * 60 * 1000,
            projectId: projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
            ...(email ? { email } : {}),
          })

          if (!account) return Response.json({ error: 'Không lưu được tài khoản.' }, { status: 500 })
          return Response.json({ ok: true, email: account.email, projectId: account.projectId, pool: getSanitizedPoolView() })
        },
      }),
    'antigravity-pool: settings exchange route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ACTION_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          const body = await readJson(request)
          const result = await applyAction(String(body.action ?? ''), body)
          return Response.json(result)
        },
      }),
    'antigravity-pool: settings action route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: QUOTA_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async request => {
          let target
          try {
            const url = new URL(request.url, 'http://x')
            target = url.searchParams.get('id') ?? url.searchParams.get('email') ?? undefined
          } catch {
            target = undefined
          }
          if (!target && request.method === 'POST') {
            const body = await readJson(request)
            target = typeof body.id === 'string' && body.id.length > 0 ? body.id : undefined
          }
          const result = await probeQuota(target)
          return Response.json(result, { headers: JSON_HEADERS })
        },
      }),
    'antigravity-pool: settings quota route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: MODELS_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async request => {
          try {
            const pool = loadPool()
            if (!pool.accounts.length) {
              return Response.json({ ok: false, error: 'pool empty', models: [] }, { status: 404 })
            }
            let scope
            try {
              const query = new URL(request.url, 'http://x').searchParams
              scope = query.get('id') ?? query.get('account') ?? undefined
            } catch {
              scope = undefined
            }
            const account = scope
              ? pool.accounts.find(a => a.id === scope || a.email === scope) ?? null
              : await getActiveValidAccount()
            if (!account) {
              return Response.json({ ok: false, error: 'account not found', models: [] }, { status: 404 })
            }
            const [catalogue, tier] = await Promise.all([
              fetchModelCatalogue(account.access, account.projectId),
              fetchAccountTier(account.access),
            ])
            return Response.json(
              {
                ok: catalogue.ok,
                email: account.email,
                tier,
                count: catalogue.models.length,
                usable: catalogue.usable ?? 0,
                disabled: catalogue.disabled ?? 0,
                models: catalogue.models,
                ...(catalogue.reason ? { reason: catalogue.reason } : {}),
              },
              { status: catalogue.ok ? 200 : 502, headers: JSON_HEADERS },
            )
          } catch (failure) {
            return Response.json(
              { ok: false, error: failure instanceof Error ? failure.message : String(failure), models: [] },
              { status: 503 },
            )
          }
        },
      }),
    'antigravity-pool: settings models route',
  )
}
