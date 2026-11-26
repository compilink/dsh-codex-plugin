window.__ModuleLoader__.load({
  id: 'dsh-bundle-codex-tools',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const button = (label, onClick, disabled = false) => h('button', { type: 'button', onClick, disabled }, label);
    const row = { display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' };
    const column = { display: 'grid', gap: '.75rem' };

    function apiClient(signal) {
      let nonce;
      async function read(path, options) {
        const url = new URL('local/chatgpt/' + path, document.baseURI);
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal, ...options });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(data.error || (response.status === 401 || response.status === 403
          ? '请通过已登录的 DSH 设置面板重试。' : '无法连接 DSH，请稍后重试。'));
        return data;
      }
      return async (path, body) => {
        nonce ??= read('panel-session').then(result => result.csrf).catch(error => { nonce = undefined; throw error; });
        const headers = { 'x-dsh-login': await nonce };
        if (!body) return read(path, { headers });
        return read(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      };
    }

    function officialLink(notices) {
      for (const notice of [...notices].reverse()) {
        if (!notice.url) continue;
        try {
          const url = new URL(notice.url);
          if (url.origin === 'https://auth.openai.com' && !url.username && !url.password)
            return { url: url.href, code: notice.code };
        } catch { /* Other provider notifications can omit a usable verification URL. */ }
      }
      return undefined;
    }

    function Prompt({ prompt, answer, busy }) {
      const [value, setValue] = React.useState(prompt.options?.[0]?.id ?? '');
      const input = prompt.kind === 'select'
        ? h('select', { value, onChange: event => setValue(event.target.value) },
          ...prompt.options.map(option => h('option', { key: option.id, value: option.id }, option.label)))
        : h('input', { type: 'password', autoComplete: 'off', spellCheck: false, value, placeholder: prompt.placeholder,
          onChange: event => setValue(event.target.value) });
      const form = h('form', { onSubmit: event => { event.preventDefault(); if (value.trim()) answer(value.trim()); }, style: column },
        h('label', null, prompt.kind === 'select' ? prompt.message : '提供商要求的验证信息', ' ', input),
        h('div', null, h('button', { type: 'submit', disabled: busy || !value.trim() }, '提交')));
      if (prompt.placeholder?.includes('/auth/callback')) return h('details', null,
        h('summary', null, '浏览器没有自动返回？'), h('p', null, '可粘贴这一次登录的完整回调链接，或取消后改用设备码登录。'), form);
      return form;
    }

    function Account({ api, alive }) {
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [revision, refresh] = React.useReducer(n => n + 1, 0);
      const submitting = React.useRef(false);
      const openBrowserForClick = React.useRef(false);
      React.useEffect(() => {
        let active = true, timer;
        async function read() {
          try {
            const data = await api('api');
            if (!active) return;
            setState(data); setError('');
            const link = officialLink(data.notices ?? []);
            if (openBrowserForClick.current && data.status === 'running' && link && !link.code) {
              openBrowserForClick.current = false;
              window.open(link.url, '_blank', 'noopener,noreferrer');
            }
            if (data.status !== 'running') openBrowserForClick.current = false;
            if (data.status === 'running') timer = setTimeout(read, 1200);
          } catch (error) { if (active) setError(error.message); }
        }
        void read();
        return () => { active = false; clearTimeout(timer); };
      }, [api, revision]);
      async function action(body) {
        if (submitting.current) return;
        submitting.current = true; setBusy(true); setError('');
        try {
          await api('api', body);
          if (body.action === 'begin') openBrowserForClick.current = body.method === 'browser';
          if (body.action === 'cancel') openBrowserForClick.current = false;
          if (alive()) refresh();
        }
        catch (error) { if (alive()) setError(error.message); }
        finally { submitting.current = false; if (alive()) setBusy(false); }
      }
      const running = state?.status === 'running';
      const disabled = busy || running || !state?.available;
      const link = officialLink(state?.notices ?? []);
      return h('div', { style: column },
        h('p', { role: 'status' }, !state ? '正在读取登录状态…' : running ? '正在等待 OpenAI 授权…'
          : state.status === 'failed' ? state.error
          : state.status === 'cancelled' ? (state.configured ? '已取消本次登录，已有凭据仍可使用。' : '已取消本次登录。')
          : state.configured ? '已保存 ChatGPT 登录凭据。' : '尚未登录 ChatGPT。'),
        state && !state.available && h('p', { role: 'status' }, '当前 DSH 配置未启用 Codex 授权提供商。'),
        h('div', null, button('浏览器登录', () => action({ action: 'begin', method: 'browser' }), disabled),
          h('p', null, '适合浏览器与 DSH 服务在同一台电脑上原生运行。打开 OpenAI 完成确认后，面板会自动更新。')),
        h('div', null, button('设备码登录', () => action({ action: 'begin', method: 'device_code' }), disabled),
          h('p', null, '适合 Docker、远程主机或无法接收回调的环境。在 OpenAI 页面输入一次性短码；账号或工作区需要允许设备码登录。')),
        running && link && h('div', { style: row },
          h('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer' }, '打开 OpenAI 授权页'),
          link.code && h('span', null, '一次性短码 ', h('strong', null, link.code))),
        state?.prompt && running && h(Prompt, { key: state.prompt.id, prompt: state.prompt, busy,
          answer: value => action({ action: 'answer', id: state.prompt.id, value }) }),
        running && h('div', null, button('取消本次登录', () => action({ action: 'cancel' }), busy)),
        error && h('div', { role: 'alert', style: row }, error, button('重新读取状态', refresh, busy)));
    }

    function Models({ api, alive }) {
      const [data, setData] = React.useState(null);
      const [selected, setSelected] = React.useState([]);
      const [message, setMessage] = React.useState('');
      const [working, setWorking] = React.useState(false);
      const pending = React.useRef(false), generation = React.useRef(0);
      React.useEffect(() => {
        let active = true;
        const initial = generation.current;
        api('models/api').then(result => {
          if (active && generation.current === initial) setData(result);
        }, error => { if (active && generation.current === initial) setMessage(error.message); });
        return () => { active = false; };
      }, [api]);
      async function change(save) {
        if (pending.current) return;
        pending.current = true; ++generation.current; setWorking(true); setMessage('');
        if (!save) { setData(null); setSelected([]); }
        try {
          const result = await api('models/api', save ? { action: 'save', preview: data.preview, ids: selected } : { action: 'refresh' });
          if (!alive()) return;
          if (save) {
            setData({ ...data, preview: null, configured: [...data.configured, ...result.added] });
            setSelected([]); setMessage('已添加 ' + result.added.length + ' 个模型。');
          } else { setData(result); setMessage('当前账号返回 ' + result.candidates.length + ' 个可用模型。'); }
        } catch (error) { if (alive()) setMessage(error.message); }
        finally { pending.current = false; if (alive()) setWorking(false); }
      }
      return h('div', { style: column },
        h('p', null, '从当前账号获取模型目录，勾选后添加到现有 Codex 提供商。'),
        h('div', null, button('获取最新模型', () => change(false), working)),
        h('p', { role: 'status' }, working ? '正在处理…' : message || (data ? '已配置 ' + data.configured.length + ' 个模型。' : '正在读取配置…')),
        data?.candidates?.map(model => {
          const existing = data.configured.includes(model.id);
          const info = [model.id, model.contextWindow && ('上下文 ' + model.contextWindow.toLocaleString()),
            ...(model.input ?? []), ...Object.keys(model.reasoningEfforts ?? {})].filter(Boolean).join(' · ');
          return h('label', { key: model.id }, h('input', { type: 'checkbox', checked: existing || selected.includes(model.id),
            disabled: existing || working || !data.preview, onChange: event => setSelected(current => event.target.checked
              ? [...current, model.id] : current.filter(id => id !== model.id)) }),
          ' ' + model.name + (existing ? '（已配置）' : ''), h('small', { style: { display: 'block', marginInlineStart: '1.5rem' } }, info));
        }),
        data?.candidates && h('div', null, button('添加选中模型', () => change(true), working || !data.preview || !selected.length)));
    }

    function Panel() {
      const [page, setPage] = React.useState('account');
      const [session, setSession] = React.useState(null);
      React.useEffect(() => {
        const lifetime = new AbortController();
        setSession({ api: apiClient(lifetime.signal), alive: () => !lifetime.signal.aborted });
        return () => lifetime.abort();
      }, []);
      return h('section', { style: { ...column, maxWidth: '44rem' } }, h('h2', null, 'Codex 登录与模型'),
        h('nav', { 'aria-label': 'Codex 设置', style: row },
          ...[['account', '账号登录'], ['models', '模型更新']].map(([id, label]) => h('button',
            { key: id, type: 'button', 'aria-pressed': page === id, onClick: () => setPage(id) }, label))),
        session && h(page === 'account' ? Account : Models, session));
    }
    return { name: 'dsh-bundle-codex-tools', inject: ['slots'],
      apply(ctx) { ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'codex-tools', order: 48, label: () => 'Codex 登录与模型', inject: () => ({}),
      }, Panel))); } };
  },
});
