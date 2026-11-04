window.__ModuleLoader__.load({
  id: '@local/dsh-context-auto',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const NS = 'context-auto-threshold';
    const DICT = {
      vi: {
        title: 'Ngân sách token', input: 'Đầu vào tối đa', output: 'Đầu ra', max: 'MAX',
        model: 'Model: {model}', outputHint: 'Tối đa {tokens} token với ngân sách đầu vào này.',
        capacity: 'Cửa sổ model: {tokens} token.', headroom: 'Dành cho nén: {tokens} token.',
        configuredOutput: 'Dùng giới hạn đầu ra đã cấu hình: {tokens} token; nhà cung cấp chưa công bố mức tối đa.',
        hint: 'Tính cả system prompt, công cụ và tin nhắn. DSH tự nén lịch sử khi chạm ngân sách đầu vào ở bước xử lý kế tiếp.',
        scope: 'Lưu riêng cho model này trong mọi cuộc trò chuyện.',
        automaticOff: 'Tự động nén đang tắt trong DSH. Lưu ngân sách không bật lại chế độ này.',
        adjusted: 'Giới hạn model đã thay đổi. Đang dùng ngân sách hợp lệ mới; hãy lưu để cập nhật.',
        loading: 'Đang đọc giới hạn model…', save: 'Lưu ngân sách', saving: 'Đang lưu…',
        reset: 'Mặc định', saved: 'Đã lưu. Áp dụng ở bước xử lý kế tiếp.',
        failed: 'Chưa cập nhật được: {message}', retry: 'Thử lại',
        conflict: 'Cấu hình vừa thay đổi ở nơi khác. Đã tải lại; hãy chọn và lưu lại.',
        readonly: 'Hồ sơ này chỉ cho phép xem.', noModel: 'Chọn model để chỉnh ngân sách token.',
        invalid: 'Nhập số token nguyên từ {min} đến {max}.', units: 'token',
      },
      en: {
        title: 'Token budget', input: 'Maximum input', output: 'Output', max: 'MAX',
        model: 'Model: {model}', outputHint: 'Up to {tokens} tokens with this input budget.',
        capacity: 'Model context: {tokens} tokens.', headroom: 'Compaction reserve: {tokens} tokens.',
        configuredOutput: 'Using the configured output limit of {tokens} tokens; this provider does not advertise a model maximum.',
        hint: 'Includes the system prompt, tools and messages. DSH compacts history when input reaches this budget at the next processing step.',
        scope: 'Saved for this model across all conversations.',
        automaticOff: 'Native automatic compaction is off. Saving a budget does not enable it.',
        adjusted: 'Model limits changed. A new valid budget is in use; save to update your preference.',
        loading: 'Reading model limits…', save: 'Save budget', saving: 'Saving…',
        reset: 'Default', saved: 'Saved. Applies at the next processing step.',
        failed: 'Could not update: {message}', retry: 'Retry',
        conflict: 'Settings changed elsewhere. Reloaded; select and save again.',
        readonly: 'This profile is read-only.', noModel: 'Select a model to adjust its token budget.',
        invalid: 'Enter a whole token count from {min} to {max}.', units: 'tokens',
      },
    };
    const CSS = `
.dshca{min-width:0;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}
.dshca-head,.dshca-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
.dshca-head{font-weight:600}
.dshca-value{font-variant-numeric:tabular-nums;font-weight:500;white-space:nowrap}
.dshca-range{box-sizing:border-box;display:block;width:100%;height:32px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshca-scale{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.dshca p{margin:6px 0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.dshca-number{box-sizing:border-box;min-width:0;width:120px;max-width:60%;min-height:36px;padding:6px 8px;font:inherit;font-size:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);caret-color:var(--dsw-alias-brand-primary)}
.dshca-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.dshca button{font:inherit;min-height:36px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.dshca button:hover{background:var(--dsw-alias-bg-layer-2)}
.dshca button:disabled,.dshca input:disabled{opacity:.5;cursor:default}
.dshca :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshca .dshca-notice{color:var(--dsw-alias-label-primary)}
@media(pointer:coarse){.dshca-range{height:44px}.dshca button,.dshca-number{min-height:44px}}
`;
    const format = value => Number(value).toLocaleString();

    function TokenEditor({ useProjection, sessionId, rpc, t }) {
      const selection = useProjection('modelSelection');
      const target = selection?.next ?? selection?.lastUsed;
      const key = target?.provider && target?.model && sessionId ? JSON.stringify([sessionId, target.provider, target.model]) : null;
      const [view, setView] = React.useState(null), [draft, setDraft] = React.useState('');
      const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState(null);
      const serial = React.useRef(0), sliderId = React.useId(), numberId = React.useId();
      const load = React.useCallback(async message => {
        const call = ++serial.current;
        setView(null); setNotice(null);
        try {
          const value = await rpc({ action: 'read', sessionId, provider: target.provider, model: target.model });
          if (call !== serial.current) return;
          setView({ ...value, key }); setDraft(String(value.budget.inputTokens));
          if (message) setNotice({ text: message, error: true });
        } catch (error) {
          if (call === serial.current) setNotice({ text: t('failed', { message: error.message }), error: true });
        }
      }, [key, rpc, t]);
      React.useEffect(() => { setBusy(false); if (key) void load(); return () => { serial.current++; }; }, [key, load]);
      const amount = Number(draft), budget = view?.budget;
      const valid = budget && draft !== '' && Number.isSafeInteger(amount) && amount >= budget.minInputTokens && amount <= budget.maxInputTokens;
      const save = async reset => {
        if (!view || view.key !== key || busy || !view.writable || (!reset && !valid)) return;
        const call = ++serial.current; setBusy(true); setNotice(null);
        try {
          const value = await rpc({ action: reset ? 'reset' : 'set', sessionId, provider: target.provider, model: target.model, ...reset ? {} : { inputTokens: amount }, expectedRevision: view.revision });
          if (call !== serial.current) return;
          setView({ ...value, key }); setDraft(String(value.budget.inputTokens));
          setNotice({ text: t('saved'), error: false });
        } catch (error) {
          if (call !== serial.current) return;
          if (/conflict/i.test(error.code ?? '') || /SETTINGS_CONFLICT/.test(error.message)) { setBusy(false); await load(t('conflict')); return; }
          setNotice({ text: t('failed', { message: error.message }), error: true });
        } finally { if (call === serial.current) setBusy(false); }
      };
      const edit = event => { setDraft(event.target.value); setNotice(null); };
      if (!key) return h('section', { className: 'dshca' }, h('style', null, CSS), h('p', null, t('noModel')));
      return h('section', { className: 'dshca', 'aria-label': t('title'), 'aria-busy': busy },
        h('style', null, CSS), h('div', { className: 'dshca-head' }, t('title')),
        !view && !notice && h('p', { role: 'status' }, t('loading')),
        view && h(React.Fragment, null,
          h('div', { className: 'dshca-row' }, h('label', { htmlFor: numberId }, t('input')), h('input', { className: 'dshca-number', id: numberId, type: 'number', inputMode: 'numeric', min: budget.minInputTokens, max: budget.maxInputTokens, step: 1, value: draft, disabled: busy || !view.writable, 'aria-invalid': !valid, 'aria-describedby': numberId + '-hint', onChange: edit })),
          h('input', { className: 'dshca-range', id: sliderId, type: 'range', 'aria-label': t('input'), min: budget.minInputTokens, max: budget.maxInputTokens, step: 1, value: valid ? amount : budget.inputTokens, 'aria-valuetext': format(valid ? amount : budget.inputTokens) + ' ' + t('units'), disabled: busy || !view.writable, onChange: edit }),
          h('div', { className: 'dshca-scale', 'aria-hidden': true }, h('span', null, format(budget.minInputTokens)), h('span', null, format(budget.maxInputTokens))),
          !valid && h('p', { id: numberId + '-hint', role: 'alert' }, t('invalid', { min: format(budget.minInputTokens), max: format(budget.maxInputTokens) })),
          h('div', { className: 'dshca-row' }, h('span', null, t('output')), h('span', { className: 'dshca-value' }, t('max'))),
          h('p', null, t('outputHint', { tokens: format(Math.min(budget.modelMaxOutput, budget.contextWindow - (valid ? amount : budget.inputTokens) - budget.headroomTokens)) })),
          budget.outputLimitSource === 'configured-default' && h('p', null, t('configuredOutput', { tokens: format(budget.modelMaxOutput) })),
          h('p', null, t('model', { model: target.model })), h('p', null, t('capacity', { tokens: format(budget.contextWindow) })),
          h('p', null, t('headroom', { tokens: format(budget.headroomTokens) })), h('p', null, t('hint')), h('p', null, t('scope')),
          !view.nativeAutoEnabled && h('p', { role: 'status' }, t('automaticOff')),
          budget.adjusted && h('p', { role: 'status' }, t('adjusted')),
          !view.writable && h('p', null, t('readonly')),
          h('div', { className: 'dshca-actions' },
            h('button', { type: 'button', disabled: busy || !view.writable || !valid || (amount === budget.requestedInput && !budget.adjusted), onClick: () => void save(false) }, t(busy ? 'saving' : 'save')),
            h('button', { type: 'button', disabled: busy || !view.writable || budget.requestedInput === null, onClick: () => void save(true) }, t('reset')))),
        notice && h('p', { className: 'dshca-notice', role: notice.error ? 'alert' : 'status' }, notice.text),
        !view && notice && h('button', { type: 'button', onClick: () => void load() }, t('retry')));
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'context-auto: locale');
        const t = ctx.locale.bind(NS);
        const rpc = async request => {
          const method = 'contextAutoThreshold/operate';
          const response = await fetch(new URL('api/' + method, document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: { request } } }) });
          if (!response.ok) throw new Error('DSH HTTP ' + response.status);
          const result = (await response.json()).result;
          if (!result?.ok) { const error = new Error(result?.error?.message ?? 'DSH RPC failed'); error.code = result?.error?.code; throw error; }
          return result.value;
        };
        ctx.effect(() => ctx.slots.inject('conversation.context.controls', () => ctx.slots.register({ name: 'conversation.context.controls', id: NS, order: 10 }, props => h(TokenEditor, { ...props, rpc, t }))), 'context-auto: popup token controls');
      },
    };
  },
});
