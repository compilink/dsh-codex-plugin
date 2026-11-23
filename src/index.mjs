import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { modelManager } from './models.mjs';
import { UserError } from './catalog.mjs';
export const inject = ['authorization', 'credentials', 'webServer', 'connection', 'llm', 'settings'];

/** Local browser surface for the existing provider-owned OAuth flow. */
export function apply(ctx) {
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
  ctx.on('webserver/index-inject', rows => rows.push({ kind: 'html', placement: 'body',
    html: '<a href="/local/chatgpt" target="_blank" rel="noopener" style="position:fixed;right:16px;bottom:12px;z-index:9999;padding:6px 10px;border:1px solid #888;border-radius:8px;background:#fff;color:#222;font:12px sans-serif">Codex 登录与模型</a>' }));
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/local/chatgpt', async handler(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return send(res,400,{error:'invalid-url'}); }
    const loginPage = url.pathname === '/local/chatgpt';
    const loginApi = url.pathname === '/local/chatgpt/api';
    const modelPage = url.pathname === '/local/chatgpt/models';
    const modelApi = url.pathname === '/local/chatgpt/models/api';
    if (!(loginPage || loginApi || modelPage || modelApi)) return send(res,404,{error:'not-found'});
    const admission = ctx.connection.admit(req);
    const rejection = 'rejection' in admission ? admission.rejection
      : admission.peer === ctx.connection.browserPeer ? undefined : 403;
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '');
    const passive = rejection === 401 && local && req.method === 'GET' && (loginPage || loginApi) && !req.headers.origin;
    if (rejection !== undefined && !passive) return send(res,rejection,{error:'请先从 DSH 的已登录页面打开 Codex。'});
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
        state = { status: 'running', notices: [], prompt: null };
        attempt = ctx.authorization.begin({ key, method: 'oauth', signal: controller.signal,
          interaction: {
            notify: notice => { state.notices.push(notice); },
            prompt: prompt => new Promise((resolve, reject) => {
              const id = randomUUID();
              state.prompt = { id, kind: prompt.kind, message: prompt.message, options: prompt.options, placeholder: prompt.placeholder };
              const cancel = () => { if (state.prompt?.id === id) state.prompt = null; pending = null; reject(new Error('prompt-cancelled')); };
              if (prompt.signal?.aborted) { cancel(); return; }
              prompt.signal?.addEventListener('abort', cancel, { once: true });
              pending = { id, resolve: value => { prompt.signal?.removeEventListener('abort', cancel); state.prompt = null; pending = null; resolve(value); } };
            }),
          },
        }).then(result => { state.status = result.status; }, error => { state.status = 'failed'; state.error = error.code ?? 'authorization-failed'; })
          .finally(() => { attempt = null; pending = null; state.prompt = null; });
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
