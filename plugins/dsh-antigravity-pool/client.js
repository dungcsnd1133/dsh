window.__ModuleLoader__.load({
  id: '@local/dsh-antigravity-pool',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = {
      pool: '/api/antigravity.pool',
      authUrl: '/api/antigravity.authUrl',
      exchange: '/api/antigravity.exchange',
      action: '/api/antigravity.action',
      quota: '/api/antigravity.quota',
    }

    const DICT = {
      vi: {
        title: 'Tài khoản Google Antigravity',
        subtitle:
          'Xoay vòng nhiều tài khoản Cloud Code Assist cho Gemini 4 Argon và Gemini 3.8 Flash. Token chỉ nằm trên host.',
        loading: 'Đang tải danh sách tài khoản…',
        empty: 'Chưa có tài khoản nào. Bấm "Thêm tài khoản" để đăng nhập Google.',
        add: 'Thêm tài khoản',
        addOnPage: 'Mở trang thêm tài khoản',
        addTitle: 'Thêm tài khoản Antigravity',
        step1: '1. Mở trang đăng nhập Google rồi chọn tài khoản và đồng ý cấp quyền.',
        openSignIn: 'Mở trang đăng nhập',
        step2: '2. Sau khi đồng ý, trình duyệt chuyển tới địa chỉ localhost (trang báo lỗi là bình thường). Sao chép toàn bộ địa chỉ đó và dán vào đây.',
        pastePlaceholder: 'Dán URL chuyển hướng (http://localhost:51121/oauth-callback?code=…) hoặc mã code',
        submit: 'Kết nối tài khoản',
        submitting: 'Đang đổi mã…',
        cancel: 'Huỷ',
        close: 'Đóng',
        retry: 'Thử lại',
        active: 'Đang dùng',
        use: 'Dùng tài khoản này',
        test: 'Kiểm tra',
        reset: 'Đặt lại quota',
        remove: 'Xoá',
        confirmRemove: 'Xoá tài khoản này khỏi pool?',
        expiry: 'Hết hạn',
        expired: 'Đã hết hạn',
        valid: 'Còn hiệu lực',
        project: 'Project',
        requests: 'Lượt gọi',
        quotaHits: 'Lần chạm quota',
        cooldown: 'Tạm nghỉ còn {n} phút',
        healthy: '{healthy}/{total} tài khoản sẵn sàng',
        strategy: 'Chiến lược',
        cooldownLabel: 'Thời gian tạm nghỉ khi hết quota (phút)',
        saveConfig: 'Lưu cấu hình',
        saved: 'Đã lưu.',
        activity: 'Hoạt động gần đây',
        quota: 'Quota',
        quotaLeft: 'Còn {percent}%',
        quotaUnknown: 'Chưa đo',
        quotaChecking: 'Đang đo quota…',
        quotaRefresh: 'Đo lại quota',
        quotaAll: 'Đo tất cả',
        resetAt: 'Đặt lại lúc',
        bottleneck: 'Model thắt cổ chai: {name}',
        quotaHint: 'Phần trăm thấp nhất trong các model chat — model chạm giới hạn trước.',
        measured: 'Đo lúc {time}',
        details: 'Chi tiết tài khoản',
        switchTo: 'Chuyển sang',
        quota: 'Quota',
        quotaLeft: '{percent}% left',
        quotaUnknown: 'Not measured',
        quotaChecking: 'Measuring quota…',
        quotaRefresh: 'Re-measure quota',
        quotaAll: 'Measure all',
        resetAt: 'Resets at',
        bottleneck: 'Bottleneck model: {name}',
        quotaHint: 'Lowest share across chat models — the one that hits the limit first.',
        measured: 'Measured {time}',
        details: 'Account details',
        switchTo: 'Switch to',
        notConfigured:
          'Host chưa có ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET. Thêm hai biến này vào môi trường của tiến trình DSH rồi khởi động lại.',
        failed: 'Không tải được danh sách: {message}',
        actionFailed: 'Thao tác thất bại: {message}',
        unknownAction: 'Thao tác không rõ.',
      },
      en: {
        title: 'Google Antigravity accounts',
        subtitle:
          'Rotate several Cloud Code Assist accounts for Gemini 4 Argon and Gemini 3.8 Flash. Tokens stay on the host.',
        loading: 'Loading accounts…',
        empty: 'No accounts yet. Choose "Add account" to sign in with Google.',
        add: 'Add account',
        addOnPage: 'Open the add-account page',
        addTitle: 'Add an Antigravity account',
        step1: '1. Open the Google sign-in page, pick an account, and consent.',
        openSignIn: 'Open sign-in page',
        step2: '2. After consent the browser lands on a localhost address (the error page is expected). Copy that whole address and paste it here.',
        pastePlaceholder: 'Paste the redirect URL (http://localhost:51121/oauth-callback?code=…) or the code',
        submit: 'Connect account',
        submitting: 'Exchanging code…',
        cancel: 'Cancel',
        close: 'Close',
        retry: 'Retry',
        active: 'In use',
        use: 'Use this account',
        test: 'Test',
        reset: 'Reset quota',
        remove: 'Remove',
        confirmRemove: 'Remove this account from the pool?',
        expiry: 'Expires',
        expired: 'Expired',
        valid: 'Valid',
        project: 'Project',
        requests: 'Requests',
        quotaHits: 'Quota hits',
        cooldown: 'Cooling down for {n} min',
        healthy: '{healthy}/{total} accounts ready',
        strategy: 'Strategy',
        cooldownLabel: 'Cooldown after a quota hit (minutes)',
        saveConfig: 'Save settings',
        saved: 'Saved.',
        activity: 'Recent activity',
        quota: 'Quota',
        quotaLeft: '{percent}% left',
        quotaUnknown: 'Not measured',
        quotaChecking: 'Measuring quota…',
        quotaRefresh: 'Re-measure quota',
        quotaAll: 'Measure all',
        resetAt: 'Resets at',
        bottleneck: 'Bottleneck model: {name}',
        quotaHint: 'Lowest share across chat models — the one that hits the limit first.',
        measured: 'Measured {time}',
        details: 'Account details',
        switchTo: 'Switch to',
        notConfigured:
          'This host has no ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET. Add both to the DSH process environment and restart.',
        failed: 'Could not load accounts: {message}',
        actionFailed: 'Action failed: {message}',
        unknownAction: 'Unknown action.',
      },
    }

    const CSS = `
.agp-root{display:flex;flex-direction:column;gap:12px;min-width:0;max-width:100%;box-sizing:border-box;padding:14px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke,rgba(0,0,0,.12));border-radius:12px;background:var(--dsw-alias-settings-card-fill,transparent);color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.agp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}
.agp-title{font-size:14px;font-weight:600}
.agp-sub{color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:12px;line-height:18px;margin-top:2px;max-width:64ch}
.agp-btn{box-sizing:border-box;height:32px;padding:0 14px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.18));background:transparent;color:inherit;font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}
.agp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.agp-btn:disabled{opacity:.5;cursor:default}
.agp-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#111);color:var(--dsw-alias-label-primary-foreground,#fff)}
.agp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#333)}
.agp-btn-sm{height:28px;padding:0 10px;font-size:12px}
.agp-btn-danger{color:#d92c20;border-color:rgba(217,44,32,.35)}
.agp-list{display:flex;flex-direction:column;gap:8px}
/* ===== quota meter ===== */
.agp-quota{display:flex;flex-direction:column;gap:5px;min-width:0}
.agp-quota-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:12px;min-width:0}
.agp-quota-num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:15px;line-height:18px}
.agp-quota-num.high{color:#16a34a}
.agp-quota-num.mid{color:#d97706}
.agp-quota-num.low{color:#d92c20}
.agp-quota-num.unknown{color:var(--dsw-alias-label-tertiary,#8e8e93);font-weight:500;font-size:12px}
.agp-quota-label{color:var(--dsw-alias-label-tertiary,#8e8e93)}
.agp-bar{position:relative;height:6px;border-radius:99px;background:var(--dsw-alias-bg-skeleton,rgba(0,0,0,.08));overflow:hidden;min-width:0}
.agp-bar-fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px;transition:width .25s ease}
.agp-bar-fill.high{background:#16a34a}
.agp-bar-fill.mid{background:#d97706}
.agp-bar-fill.low{background:#d92c20}
.agp-bar-fill.unknown{background:var(--dsw-alias-border-l3,rgba(0,0,0,.2));width:100% !important;opacity:.35}
.agp-quota-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8e8e93);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;gap:10px;flex-wrap:wrap;overflow-wrap:anywhere}
.agp-details>summary{cursor:pointer;list-style:none;color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:11px}
.agp-details>summary::-webkit-details-marker{display:none}

.agp-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.10));border-radius:10px}
.agp-card-active{border-color:rgba(22,163,74,.55);box-shadow:inset 0 0 0 .5px rgba(22,163,74,.35)}
.agp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.agp-email{font-weight:600;font-size:13px;overflow-wrap:anywhere;min-width:0}
.agp-badge{font-size:11px;padding:1px 7px;border-radius:999px;border:.5px solid currentColor;line-height:16px}
.agp-badge-on{color:#16a34a}
.agp-badge-off{color:#d97706}
.agp-badge-warn{color:#d92c20}
.agp-meta{color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;gap:12px;flex-wrap:wrap}
.agp-actions{display:flex;gap:6px;flex-wrap:wrap}
.agp-empty{color:var(--dsw-alias-label-tertiary,#8e8e93);font-size:12px}
.agp-err{color:#d92c20;font-size:12px}
.agp-ok{color:#16a34a;font-size:12px}
.agp-notice{padding:10px 12px;border-radius:10px;border:.5px solid rgba(217,119,6,.45);color:#b45309;font-size:12px;line-height:18px}
.agp-field{display:flex;flex-direction:column;gap:4px}
.agp-input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.18));background:var(--dsw-alias-bg-skeleton,transparent);color:inherit;font:inherit}
.agp-log{display:flex;flex-direction:column;gap:4px;max-height:132px;overflow:auto}
.agp-log-row{font-size:11px;color:var(--dsw-alias-label-tertiary,#8e8e93);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.agp-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.42);display:grid;place-items:center;z-index:60;padding:16px}
.agp-modal{width:min(560px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;padding:18px;border-radius:14px;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 18px 48px rgba(0,0,0,.28)}
@media (prefers-color-scheme:dark){.agp-modal{background:#1c1c1e;color:#f2f2f7}}
.agp-modal h3{margin:0 0 10px;font-size:15px}
.agp-modal p{margin:0 0 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#636366)}
.agp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.agp-spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:agp-spin .7s linear infinite;vertical-align:-2px}
@keyframes agp-spin{to{transform:rotate(360deg)}}
/* The Settings panel keeps its fixed nav column on phones, leaving the content
   column very narrow. Trim padding, stack the header, and let buttons wrap so
   every control stays reachable instead of overflowing sideways. */
@media (max-width:520px){
  .agp-root{padding:10px 8px;gap:10px;border-left:0;border-right:0;border-radius:0}
  .agp-head{flex-direction:column;align-items:stretch;gap:8px}
  .agp-head .agp-row{gap:6px}
  .agp-sub{max-width:none}
  .agp-title{font-size:13px}
  .agp-btn{height:30px;padding:0 10px;font-size:12px}
  .agp-card{padding:8px}
  .agp-meta{gap:6px;font-size:11px}
  .agp-actions{gap:4px}
  .agp-actions .agp-btn{flex:1 1 auto}
  .agp-modal{padding:14px}
}
`

    /**
     * Resolve the UI language from the browser.
     * @returns dictionary for the active language.
     */
    function dictionary() {
      const language = (typeof navigator === 'object' && navigator.language ? navigator.language : 'en').toLowerCase()
      return language.startsWith('vi') ? DICT.vi : DICT.en
    }

    /**
     * Substitute `{name}` placeholders.
     * @param template - copy carrying placeholders.
     * @param values - replacement values by name.
     * @returns the filled string.
     */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole))
    }

    /**
     * Call one JSON endpoint and surface HTTP failures as thrown errors.
     * @param url - absolute path on this origin.
     * @param init - optional fetch init.
     * @returns the decoded JSON body.
     */
    async function call(url, init) {
      const response = await fetch(url, { credentials: 'same-origin', ...init })
      const text = await response.text()
      let body
      try {
        body = text.length > 0 ? JSON.parse(text) : {}
      } catch {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
      }
      if (!response.ok) throw new Error(body?.error || body?.message || `HTTP ${response.status}`)
      return body
    }

    /**
     * Short `HH:MM` clock for the activity list.
     * @param timestamp - epoch milliseconds.
     * @returns local time text.
     */
    function clock(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    /**
     * `dd/mm` style date for token expiry.
     * @param timestamp - epoch milliseconds.
     * @returns local date text, or an em dash when unset.
     */
    function dateText(timestamp) {
      if (!timestamp) return '—'
      try {
        return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
      } catch {
        return '—'
      }
    }

    /**
     * Sign-in modal: mints the Google URL, then exchanges the pasted redirect.
     * @param props - copy, close callback, and the refresh hook.
     * @returns the modal element tree.
     */
    function AntigravityPool() {
      const t = dictionary()
      const [state, setState] = useState({ status: 'loading', pool: null, configured: true })
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [running, setRunning] = useState(false)
      const [cooldown, setCooldown] = useState(30)
      // Which account's quota is being measured right now ('all' for a sweep).
      const [quotaBusy, setQuotaBusy] = useState(null)
      const mounted = useRef(true)

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const load = useCallback(async () => {
        try {
          const answer = await call(API.pool)
          if (!mounted.current) return
          setState({ status: 'ready', pool: answer.pool, configured: answer.configured !== false })
          setCooldown(Number(answer.pool?.cooldownMinutes || 30))
          setError('')
        } catch (failure) {
          if (!mounted.current) return
          setState(current => ({ ...current, status: 'failed' }))
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const act = useCallback(
        async (action, account) => {
          if (action === 'remove' && !window.confirm(t.confirmRemove)) return
          setRunning(true)
          setNotice('')
          setError('')
          try {
            const answer = await call(API.action, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action, id: account?.id, email: account?.email }),
            })
            if (!mounted.current) return
            if (answer.pool) {
              setState(current => ({ ...current, status: 'ready', pool: answer.pool }))
              setCooldown(Number(answer.pool.cooldownMinutes || 30))
            }
            if (answer.ok === false) setError(answer.message || t.unknownAction)
            else if (answer.message) setNotice(answer.message)
          } catch (failure) {
            if (!mounted.current) return
            setError(fill(t.actionFailed, { message: failure instanceof Error ? failure.message : String(failure) }))
          } finally {
            if (mounted.current) setRunning(false)
          }
        },
        [t],
      )

      /**
       * Measure live quota for one account (or every account when omitted).
       * @param account - account to probe; omitted means the whole pool.
       */
      const refreshQuota = useCallback(
        async account => {
          setQuotaBusy(account ? account.id : 'all')
          setError('')
          try {
            const answer = await call(API.quota, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(account ? { id: account.id } : {}),
            })
            if (!mounted.current) return
            const measured = new Map((answer.accounts || []).map(row => [row.id, row]))
            setState(current => {
              if (!current.pool) return current
              const accounts = current.pool.accounts.map(row => {
                const hit = measured.get(row.id)
                if (!hit) return row
                return {
                  ...row,
                  lastQuota: {
                    percent: typeof hit.percent === 'number' ? hit.percent : null,
                    bottleneck: hit.bottleneck ?? null,
                    resetTime: hit.resetTime ?? null,
                    checkedAt: answer.checkedAt ?? Date.now(),
                    ok: hit.ok !== false,
                    ...(hit.ok === false && hit.message ? { message: hit.message } : {}),
                  },
                }
              })
              return { ...current, pool: { ...current.pool, accounts } }
            })
          } catch (failure) {
            if (!mounted.current) return
            setError(fill(t.actionFailed, { message: failure instanceof Error ? failure.message : String(failure) }))
          } finally {
            if (mounted.current) setQuotaBusy(null)
          }
        },
        [t],
      )

      // Measure once on open when no cached number exists (or it is older than
      // ten minutes). Declared after refreshQuota: a useCallback is not hoisted.
      const autoMeasured = useRef(false)
      useEffect(() => {
        const pool = state.pool
        if (autoMeasured.current || !pool || pool.accounts.length === 0) return
        const stale = pool.accounts.some(
          account => !account.lastQuota || Date.now() - Number(account.lastQuota.checkedAt || 0) > 10 * 60 * 1000,
        )
        if (!stale) return
        autoMeasured.current = true
        refreshQuota()
      }, [state.pool, refreshQuota])

      const persistConfig = useCallback(async () => {
        setRunning(true)
        setError('')
        try {
          const answer = await call(API.action, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'config', cooldownMinutes: Number(cooldown) }),
          })
          if (!mounted.current) return
          if (answer.pool) setState(current => ({ ...current, pool: answer.pool }))
          setNotice(t.saved)
        } catch (failure) {
          if (!mounted.current) return
          setError(fill(t.actionFailed, { message: failure instanceof Error ? failure.message : String(failure) }))
        } finally {
          if (mounted.current) setRunning(false)
        }
      }, [cooldown, t])

      const pool = state.pool
      const accounts = pool?.accounts ?? []

      return h(
        'div',
        { className: 'agp-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'agp-head' },
          h(
            'div',
            null,
            h('div', { className: 'agp-title' }, t.title),
            h('div', { className: 'agp-sub' }, t.subtitle),
            pool
              ? h('div', { className: 'agp-meta', style: { marginTop: '4px' } }, fill(t.healthy, { healthy: pool.totalHealthy, total: pool.totalAccounts }))
              : null,
          ),
          h(
            'div',
            { className: 'agp-row' },
            h(
              'button',
              { type: 'button', className: 'agp-btn', onClick: () => refreshQuota(), disabled: running || quotaBusy === 'all' },
              quotaBusy === 'all' ? t.quotaChecking : t.quotaAll,
            ),
            h('button', { type: 'button', className: 'agp-btn', onClick: load, disabled: running }, t.retry),
            h(
              'button',
              {
                type: 'button',
                className: 'agp-btn agp-btn-primary',
                // Adding an account needs the full-width page (steps, OAuth
                // client form, paste box). Sending people there keeps one
                // implementation instead of a cramped copy in a modal.
                onClick: () => {
                  const target = new URL('antigravity', document.baseURI).toString()
                  window.open(target, '_blank', 'noopener,noreferrer')
                },
              },
              t.addOnPage,
            ),
          ),
        ),

        state.configured === false ? h('div', { className: 'agp-notice' }, t.notConfigured) : null,
        error ? h('div', { className: 'agp-err', role: 'alert' }, error) : null,
        notice ? h('div', { className: 'agp-ok', role: 'status' }, notice) : null,

        state.status === 'loading'
          ? h('div', { className: 'agp-empty' }, h('span', { className: 'agp-spin' }), ' ', t.loading)
          : accounts.length === 0
            ? h('div', { className: 'agp-empty' }, t.empty)
            : h(
                'div',
                { className: 'agp-list' },
                accounts.map(account =>
                  h(AccountCard, {
                    key: account.id,
                    account,
                    t,
                    running,
                    act,
                    quotaBusy,
                    onRefreshQuota: refreshQuota,
                  }),
                ),
              ),

        pool
          ? h(
              'div',
              { className: 'agp-field', style: { maxWidth: '280px' } },
              h('span', { className: 'agp-meta' }, t.cooldownLabel),
              h(
                'div',
                { className: 'agp-row' },
                h('input', {
                  className: 'agp-input',
                  type: 'number',
                  min: 1,
                  value: cooldown,
                  style: { width: '96px' },
                  onChange: event => setCooldown(event.target.value),
                }),
                h('button', { type: 'button', className: 'agp-btn agp-btn-sm', onClick: persistConfig, disabled: running }, t.saveConfig),
              ),
            )
          : null,

        pool && pool.logs && pool.logs.length > 0
          ? h(
              'details',
              null,
              h('summary', { className: 'agp-empty' }, t.activity),
              h(
                'div',
                { className: 'agp-log' },
                pool.logs.map((entry, index) =>
                  h('div', { key: `${entry.timestamp}-${index}`, className: 'agp-log-row' }, `${clock(entry.timestamp)}  ${entry.message}`),
                ),
              ),
            )
          : null,

      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // ctx.effect() ties the registration to this plugin's scope so the slot
        // is mounted when the plugin starts and released when it reloads.
        ctx.effect(
          () =>
            ctx.slots.inject('settings.models.footer', () =>
              ctx.slots.register(
                { name: 'settings.models.footer', id: 'antigravity-pool', order: 40 },
                AntigravityPool,
              ),
            ),
          'antigravity-pool: settings models footer',
        )
      },
    }
  },
})
