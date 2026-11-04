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
  isQuotaExceededError,
  readAntigravityEnv,
  isConfigured,
  ANTIGRAVITY_AUTH_URL,
  ANTIGRAVITY_TOKEN_URL,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
} from './pool-core.mjs'

export const name = 'dsh-antigravity-pool'
export const inject = ['webServer']

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
      } catch (err) {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function htmlPage(title, bodyHtml) {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; font:14px/1.5 system-ui, sans-serif; background:#0f1115; color:#e6e6e6; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:#8b93a1; margin:0 0 20px; font-size:12px; }
  .card { background:#171a21; border:1px solid #262b36; border-radius:10px; padding:16px; margin-bottom:16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  .stat { padding:10px 14px; border-radius:8px; background:#1d222c; }
  .stat b { display:block; font-size:20px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #262b36; font-size:13px; }
  th { color:#8b93a1; font-weight:500; }
  .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; }
  .active { background:#12351f; color:#4ade80; }
  .cooldown { background:#3b2f12; color:#fbbf24; }
  .off { background:#331b1b; color:#f87171; }
  button { background:#2b6cb0; color:#fff; border:0; border-radius:6px; padding:6px 12px; cursor:pointer; font-size:12px; }
  button:hover { background:#2c5282; }
  button.ghost { background:#232936; }
  button.danger { background:#7f1d1d; }
  input { background:#0f1115; border:1px solid #333a47; color:#e6e6e6; border-radius:6px; padding:6px 10px; font-size:13px; }
  .muted { color:#8b93a1; font-size:12px; }
  .log { font-family:ui-monospace, monospace; font-size:12px; color:#a8b3c4; margin:4px 0; }
  .ok { color:#4ade80; } .warn { color:#fbbf24; } .err { color:#f87171; }
</style>
<h1>Antigravity Account Pool</h1>
<p class="sub">Xoay vòng nhiều tài khoản Antigravity, tự nghỉ khi chạm quota</p>
<div id="app"></div>
<script>
const $ = (s) => document.querySelector(s)
async function api(path, opts) {
  const res = await fetch(path, opts)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}
async function refresh() {
  const pool = await api('/antigravity/api/pool')
  const env = await api('/antigravity/api/status')
  const el = $('#app')
  const badge = (s) => s === 'active' ? '<span class="badge active">active</span>'
    : s === 'cooldown' ? '<span class="badge cooldown">cooldown</span>'
    : '<span class="badge off">' + s + '</span>'
  const mins = (ts) => ts ? new Date(ts).toLocaleString() : '—'
  el.innerHTML = \`
  <div class="card">
    <div class="row">
      <div class="stat"><b>\${pool.totalAccounts}</b>tài khoản</div>
      <div class="stat"><b class="ok">\${pool.totalHealthy}</b>hoạt động</div>
      <div class="stat"><b>\${pool.activeIndex + 1}</b>đang dùng</div>
      <div class="stat"><b>\${pool.cooldownMinutes}</b>phút nghỉ</div>
      <span class="muted" style="margin-left:auto">
        OAuth client: \${env.configured ? '<span class="ok">đã cấu hình (env)</span>' : '<span class="err">thiếu env</span>'}
      </span>
    </div>
    <div class="row" style="margin-top:12px">
      <label class="muted">Cooldown (phút)</label>
      <input id="cooldown" type="number" min="1" value="\${pool.cooldownMinutes}" style="width:80px">
      <button id="saveCfg" class="ghost">Lưu cấu hình</button>
      <button id="refreshBtn" class="ghost">Làm mới</button>
    </div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 8px; font-size:14px">Tài khoản</h3>
    \${pool.accounts.length ? \`<table>
      <tr><th>#</th><th>Email</th><th>Trạng thái</th><th>Hết hạn</th><th>Requests</th><th>Quota hits</th><th></th></tr>
      \${pool.accounts.map((a, i) => \`<tr>
        <td>\${a.isActive ? '➜ ' + (i + 1) : i + 1}</td>
        <td>\${a.email}</td>
        <td>\${badge(a.status)}\${a.cooldownRemainingSec > 0 ? ' ' + Math.ceil(a.cooldownRemainingSec / 60) + 'p' : ''}</td>
        <td class="muted">\${mins(a.expires)}</td>
        <td>\${a.totalRequests}</td>
        <td>\${a.quotaHits}</td>
        <td class="row">
          \${a.isActive ? '' : \`<button data-set="\${a.id}" class="ghost">Chọn</button>\`}
          <button data-test="\${a.id}" class="ghost">Test</button>
          <button data-reset="\${a.id}" class="ghost">Reset quota</button>
          <button data-del="\${a.id}" class="danger">Gỡ</button>
        </td>
      </tr>\`).join('')}
    </table>\` : '<p class="muted">Chưa có tài khoản nào trong pool.</p>'}
  </div>
  <div class="card">
    <h3 style="margin:0 0 8px; font-size:14px">Logs gần đây</h3>
    \${pool.logs.map((l) => \`<div class="log"><span class="muted">\${new Date(l.timestamp).toLocaleTimeString()}</span>
      <span class="\${l.type === 'quota' ? 'warn' : l.type === 'error' ? 'err' : 'ok'}">[\${l.type}]</span> \${l.message}</div>\`).join('') || '<p class="muted">—</p>'}
  </div>\`
  $('#refreshBtn').onclick = refresh
  $('#saveCfg').onclick = async () => {
    await api('/antigravity/api/config', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cooldownMinutes: Number($('#cooldown').value) || 30 }) })
    refresh()
  }
  el.querySelectorAll('[data-set]').forEach((b) => b.onclick = async () => {
    await api('/antigravity/api/activate', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: b.dataset.set }) })
    refresh()
  })
  el.querySelectorAll('[data-test]').forEach((b) => b.onclick = async () => {
    b.textContent = '...'
    const r = await api('/antigravity/api/test', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: b.dataset.test }) })
    alert(r.ok ? r.message : 'Lỗi: ' + r.message)
    b.textContent = 'Test'
  })
  el.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
    await api('/antigravity/api/reset-quota', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: b.dataset.reset }) })
    refresh()
  })
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Gỡ tài khoản này khỏi pool?')) return
    await api('/antigravity/api/remove', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: b.dataset.del }) })
    refresh()
  })
}
refresh().catch((err) => { $('#app').innerHTML = '<p class="err">Lỗi: ' + err.message + '</p>' })
</script>
`
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
        // UI
        if (pathName === '/antigravity' || pathName === '/antigravity/' || pathName === '/antigravity/ui') {
          const html = htmlPage('Antigravity Pool')
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
          json(res, acc ? 200 : 404, acc ? { ok: true, cooldownMinutes: Number(body.cooldownMinutes) || undefined } : { error: 'account not found' })
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
}
