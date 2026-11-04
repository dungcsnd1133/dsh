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
    }

    const DICT = {
      vi: {
        title: 'Tài khoản Google Antigravity',
        subtitle:
          'Xoay vòng nhiều tài khoản Cloud Code Assist cho Gemini 4 Argon và Gemini 3.8 Flash. Token chỉ nằm trên host.',
        loading: 'Đang tải danh sách tài khoản…',
        empty: 'Chưa có tài khoản nào. Bấm "Thêm tài khoản" để đăng nhập Google.',
        add: 'Thêm tài khoản',
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
        notConfigured:
          'This host has no ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET. Add both to the DSH process environment and restart.',
        failed: 'Could not load accounts: {message}',
        actionFailed: 'Action failed: {message}',
        unknownAction: 'Unknown action.',
      },
    }

    const CSS = `
.agp-root{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke,rgba(0,0,0,.12));border-radius:12px;background:var(--dsw-alias-settings-card-fill,transparent);color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px}
.agp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
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
.agp-card{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.10));border-radius:10px}
.agp-card-active{border-color:rgba(22,163,74,.55);box-shadow:inset 0 0 0 .5px rgba(22,163,74,.35)}
.agp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.agp-email{font-weight:600;font-size:13px}
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
    function AddDialog({ t, onClose, onDone }) {
      const [authUrl, setAuthUrl] = useState('')
      const [input, setInput] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [opened, setOpened] = useState(false)

      const mint = useCallback(async () => {
        setError('')
        try {
          const answer = await call(API.authUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          setAuthUrl(answer.authUrl)
          setOpened(true)
          window.open(answer.authUrl, '_blank', 'noopener,noreferrer')
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [])

      useEffect(() => {
        mint()
      }, [mint])

      const submit = useCallback(async () => {
        if (input.trim().length === 0) return
        setBusy(true)
        setError('')
        try {
          const answer = await call(API.exchange, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ input }),
          })
          onDone(answer)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }, [input, onDone])

      return h(
        'div',
        { className: 'agp-backdrop', role: 'presentation', onClick: event => event.target === event.currentTarget && onClose() },
        h(
          'div',
          { className: 'agp-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.addTitle },
          h('h3', null, t.addTitle),
          h('p', null, t.step1),
          h(
            'div',
            { className: 'agp-row', style: { marginBottom: '12px' } },
            h(
              'button',
              { type: 'button', className: 'agp-btn agp-btn-primary', onClick: mint },
              opened ? t.openSignIn : t.openSignIn,
            ),
          ),
          h('p', null, t.step2),
          h(
            'div',
            { className: 'agp-field' },
            h('input', {
              className: 'agp-input',
              type: 'text',
              value: input,
              placeholder: t.pastePlaceholder,
              onChange: event => setInput(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && !busy) submit()
              },
              autoFocus: true,
              spellCheck: false,
            }),
          ),
          error ? h('p', { className: 'agp-err', role: 'alert' }, error) : null,
          authUrl ? h('p', { className: 'agp-log-row', style: { wordBreak: 'break-all', marginTop: '8px' } }, authUrl.slice(0, 160) + '…') : null,
          h(
            'div',
            { className: 'agp-modal-actions' },
            h('button', { type: 'button', className: 'agp-btn', onClick: onClose, disabled: busy }, t.cancel),
            h(
              'button',
              { type: 'button', className: 'agp-btn agp-btn-primary', onClick: submit, disabled: busy || input.trim().length === 0 },
              busy ? h('span', null, h('span', { className: 'agp-spin' }), ' ', t.submitting) : t.submit,
            ),
          ),
        ),
      )
    }

    /**
     * One pool row: identity, health, and per-account actions.
     * @param props - account record, copy, and the action dispatcher.
     * @returns the row element tree.
     */
    function AccountCard({ account, t, running, act }) {
      const badge = account.isActive
        ? h('span', { className: 'agp-badge agp-badge-on' }, t.active)
        : account.status === 'cooldown'
          ? h('span', { className: 'agp-badge agp-badge-off' }, fill(t.cooldown, { n: Math.max(1, Math.round(account.cooldownRemainingSec / 60)) }))
          : account.expired
            ? h('span', { className: 'agp-badge agp-badge-warn' }, t.expired)
            : h('span', { className: 'agp-badge agp-badge-on' }, t.valid)

      return h(
        'div',
        { className: account.isActive ? 'agp-card agp-card-active' : 'agp-card' },
        h(
          'div',
          { className: 'agp-row' },
          h('span', { className: 'agp-email' }, account.email),
          badge,
          account.label ? h('span', { className: 'agp-meta' }, account.label) : null,
        ),
        h(
          'div',
          { className: 'agp-meta' },
          h('span', null, `${t.project}: ${account.projectId}`),
          h('span', null, `${t.expiry}: ${dateText(account.expires)}`),
          h('span', null, `${t.requests}: ${account.totalRequests}`),
          h('span', null, `${t.quotaHits}: ${account.quotaHits}`),
        ),
        account.lastError ? h('div', { className: 'agp-err' }, account.lastError) : null,
        h(
          'div',
          { className: 'agp-actions' },
          account.isActive
            ? null
            : h(
                'button',
                { type: 'button', className: 'agp-btn agp-btn-sm', disabled: running, onClick: () => act('select', account) },
                t.use,
              ),
          h(
            'button',
            { type: 'button', className: 'agp-btn agp-btn-sm', disabled: running, onClick: () => act('test', account) },
            t.test,
          ),
          h(
            'button',
            { type: 'button', className: 'agp-btn agp-btn-sm', disabled: running, onClick: () => act('reset-quota', account) },
            t.reset,
          ),
          h(
            'button',
            { type: 'button', className: 'agp-btn agp-btn-sm agp-btn-danger', disabled: running, onClick: () => act('remove', account) },
            t.remove,
          ),
        ),
      )
    }

    /**
     * Settings → Models card listing the Antigravity pool.
     * @returns the section element tree.
     */
    function AntigravityPool() {
      const t = dictionary()
      const [state, setState] = useState({ status: 'loading', pool: null, configured: true })
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [adding, setAdding] = useState(false)
      const [running, setRunning] = useState(false)
      const [cooldown, setCooldown] = useState(30)
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
            h('button', { type: 'button', className: 'agp-btn', onClick: load, disabled: running }, t.retry),
            h(
              'button',
              { type: 'button', className: 'agp-btn agp-btn-primary', onClick: () => setAdding(true), disabled: !state.configured },
              t.add,
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
                accounts.map(account => h(AccountCard, { key: account.id, account, t, running, act })),
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

        adding
          ? h(AddDialog, {
              t,
              onClose: () => setAdding(false),
              onDone: answer => {
                setAdding(false)
                if (answer?.pool) {
                  setState(current => ({ ...current, status: 'ready', pool: answer.pool }))
                  setCooldown(Number(answer.pool.cooldownMinutes || 30))
                }
                setNotice(answer?.email ? `${answer.email}` : t.saved)
                load()
              },
            })
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.models.footer', () =>
          ctx.slots.register({ name: 'settings.models.footer', id: 'antigravity-pool', order: 40 }, AntigravityPool),
        )
      },
    }
  },
})
