import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { modelManager } from './models.mjs';
import { UserError } from './catalog.mjs';
export const inject = ['authorization', 'credentials', 'webServer', 'connection', 'llm', 'settings'];

function routeAuth({transport, method, url, headers}) {
  if (transport !== 'http' || method !== 'GET' || !['/local/chatgpt', '/local/chatgpt/api'].includes(url.pathname)) return 'required';
  const get = name => typeof headers.get === 'function' ? headers.get(name) : headers[name];
  const host = get('host');
  return typeof host === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) &&
    get('origin') == null ? 'anonymous' : 'required';
}

function isBrowserOwner(ctx, peer, req) {
  if (!peer) return false;
  const browser = ctx.get?.('dshLocalBrowserOwner');
  if (browser?.matches(peer)) return true;
  const authentication = ctx.get?.('connection.authentication');
  if (!authentication) return peer === ctx.connection.browserPeer;
  // Modern DSH gives its browser, desktop shell, and API operators separate owner peers.
  // Reauthenticate just the supported UI cookie so an unrelated API credential cannot admit it.
  if (peer.principal?.kind !== 'owner' || typeof authentication.authenticate !== 'function') return false;
  const cookies = (req.headers.cookie ?? '').split(';').map(cookie => cookie.trim());
  for (const cookie of cookies) {
    if (!/^dsh-desktop-session=[A-Za-z0-9_-]{43}$/.test(cookie) &&
        !/^dsh-auth-[A-Za-z0-9_-]{43}=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cookie)) continue;
    const result = authentication.authenticate({ headers: { host: req.headers.host, cookie } });
    if (result.peer === peer) return true;
  }
  return false;
}

/** Local browser surface for the existing provider-owned OAuth flow. */
export function apply(ctx) {
  if (ctx.get?.('connection.authentication') !== undefined) {
    ctx.inject(['connection.authentication'], scoped => mount(scoped))
    return;
  }
  return mount(ctx);
}

function mount(ctx) {
  const key = 'llm-pi-ai/openai-codex';
  const csrf = randomUUID();
  let state = { status: 'idle', notices: [], prompt: null };
  let pending, attempt;
  const controller = new AbortController();
  const html = readFileSync(new URL('./login.html', import.meta.url), 'utf8').replaceAll('__CSRF__', csrf);
  const models = modelManager(ctx, controller.signal);
  const modelHtml = readFileSync(new URL('./models.html', import.meta.url), 'utf8').replaceAll('__CSRF__', csrf);
  const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${csrf}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`};
  const send = (res, code, value) => {
    res.writeHead(code, { ...headers, 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/local/chatgpt', auth: routeAuth, async handler(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return send(res,400,{error:'invalid-url'}); }
    const loginPage = url.pathname === '/local/chatgpt';
    const loginApi = url.pathname === '/local/chatgpt/api';
    const panelSession = url.pathname === '/local/chatgpt/panel-session';
    const modelPage = url.pathname === '/local/chatgpt/models';
    const modelApi = url.pathname === '/local/chatgpt/models/api';
    if (!(loginPage || loginApi || panelSession || modelPage || modelApi)) return send(res,404,{error:'not-found'});
    const admission = ctx.connection.admit(req);
    const rejection = 'rejection' in admission ? admission.rejection
      : isBrowserOwner(ctx, admission.peer, req) ? undefined : 403;
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '');
    const passive = rejection === 401 && local && req.method === 'GET' && (loginPage || loginApi) && !req.headers.origin;
    if (rejection !== undefined && !passive) return send(res,rejection,{error:'请先从 DSH 的已登录页面打开 Codex。'});
    if (panelSession && req.method === 'GET') return send(res, 200, { csrf });
    if ((loginPage || modelPage) && req.method === 'GET') {
      res.writeHead(200, { ...headers, 'content-type':'text/html; charset=utf-8' });
      res.end(loginPage ? html : modelHtml); return;
    }
    if (!(loginApi || modelApi)) return send(res,405,{error:'method'});
    const supplied = Buffer.from(req.headers['x-dsh-login'] ?? '');
    const expected = Buffer.from(csrf);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(res, 403, { error: 'forbidden' });
    try {
      if (modelApi && req.method === 'GET') return send(res,200,await models.status());
      if (req.method === 'GET') return send(res, 200, { ...(rejection === undefined ? state : {status: state.status, notices:[], prompt:null}),
        available: !!ctx.authorization.describe(key), configured: (await ctx.credentials.describeRecord(key)).configured });
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) return send(res, 413, { error: 'too-large' }); }
      let body;
      try { body = JSON.parse(raw); } catch { return send(res,400,{error:'无效的 JSON。'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res,400,{error:'无效的请求。'});
      if (modelApi) {
        if (body.action === 'refresh') return send(res,200,await models.refresh());
        if (body.action === 'save') return send(res,200,await models.save(body.preview,body.ids));
        return send(res,400,{error:'unknown-action'});
      }
      if (body.action === 'begin') {
        if (attempt) return send(res, 409, { error: 'already-running' });
        const method = body.method;
        if (method !== undefined && !['device_code', 'browser'].includes(method))
          return send(res, 400, { error: '请选择浏览器登录或设备码登录。' });
        let methodChosen = false;
        state = { status: 'running', notices: [], prompt: null, ...(method && { method }) };
        attempt = ctx.authorization.begin({ key, method: 'oauth', signal: controller.signal,
          interaction: {
            notify: notice => {
              if (method === 'device_code' && !methodChosen && notice.url && !notice.code) {
                state.error = '当前提供商未提供设备码登录，请改选浏览器登录。';
                ctx.authorization.cancel(key);
                return;
              }
              state.notices.push(notice);
            },
            prompt: prompt => new Promise((resolve, reject) => {
              if (method && !methodChosen && prompt.kind === 'select' &&
                  prompt.options?.some(option => ['browser', 'device_code'].includes(option.id))) {
                if (prompt.options.some(option => option.id === method)) {
                  methodChosen = true;
                  resolve(method);
                } else {
                  state.error = '当前提供商不支持所选登录方式，请重新选择。';
                  reject(new Error('unsupported-login-method'));
                }
                return;
              }
              const id = randomUUID();
              state.prompt = { id, kind: prompt.kind, message: prompt.message, options: prompt.options, placeholder: prompt.placeholder };
              const cancel = () => { if (state.prompt?.id === id) state.prompt = null; pending = null; reject(new Error('prompt-cancelled')); };
              if (prompt.signal?.aborted) { cancel(); return; }
              prompt.signal?.addEventListener('abort', cancel, { once: true });
              pending = { id, resolve: value => { prompt.signal?.removeEventListener('abort', cancel); state.prompt = null; pending = null; resolve(value); } };
            }),
          },
        }).then(result => { state.status = state.error ? 'failed' : result.status; }, () => {
          state.status = 'failed';
          state.error ??= '授权没有完成。请检查网络、账号权限或验证信息，然后重试。';
        })
          .finally(() => { attempt = null; pending = null; state.prompt = null; state.notices = []; });
      } else if (body.action === 'answer') {
        if (!pending || body.id !== pending.id || typeof body.value !== 'string') return send(res, 409, { error: 'stale-prompt' });
        pending.resolve(body.value);
      } else if (body.action === 'cancel') { if (attempt) ctx.authorization.cancel(key); }
      else return send(res, 400, { error: 'unknown-action' });
      send(res, 200, { ok: true });
    } catch (error) { if (error instanceof UserError) return send(res,error.status,{error:error.message}); send(res,500,{error:'Codex 请求未完成。'}); }
  } }));
  ctx.effect(() => () => { controller.abort(); if (attempt) ctx.authorization.cancel(key); });
}
