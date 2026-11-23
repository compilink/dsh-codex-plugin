export const PROVIDER = 'openai-codex';
export const KEY = 'llm-pi-ai/openai-codex';
const ACCOUNT_CLAIM = 'https://api.openai.com/auth';
const MODEL_URL = 'https://chatgpt.com/backend-api/codex/models';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
// Public OAuth client identifier used by the Codex provider in DSH's pi-ai integration.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export class UserError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJson(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new UserError(502, '服务返回了空响应。');
  let length = 0;
  const pieces = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new UserError(502, '服务响应超过大小限制。');
      }
      pieces.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(pieces).toString('utf8')); }
  catch { throw new UserError(502, '服务返回了无效的 JSON。'); }
}

function accountFor(access) {
  try {
    const payload = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8'));
    const id = payload[ACCOUNT_CLAIM]?.chatgpt_account_id;
    if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) return id;
  } catch { /* A missing or invalid claim needs a new provider login. */ }
  throw new UserError(409, 'DSH 保存的 Codex 授权缺少账号标识，请重新登录。');
}

function grant(record) {
  if (record?.kind !== 'grant' || record.payload?.type !== 'oauth' ||
      typeof record.payload.access !== 'string' || !Number.isFinite(record.payload.expires)) {
    throw new UserError(409, '请先在 DSH 中使用 ChatGPT 登录。');
  }
  return record.payload;
}

async function accessFor(store, fetcher, signal) {
  const first = grant(await store.readRecord(KEY));
  if (first.expires > Date.now()) return first.access;
  // Inference and this page share the DSH store's cross-process rotation lock.
  const updated = await store.modifyRecord(KEY, async current => {
    const before = grant(current);
    if (before.expires > Date.now()) return undefined;
    if (typeof before.refresh !== 'string' || !before.refresh) throw new UserError(409, 'Codex 授权已过期，请重新登录。');
    const account = accountFor(before.access);
    const reply = await fetcher(TOKEN_URL, {
      method: 'POST', signal, redirect: 'error', cache: 'no-store',
      body: new URLSearchParams({grant_type:'refresh_token', client_id:CLIENT_ID, refresh_token:before.refresh}),
    });
    if (!reply.ok) throw new UserError(502, 'Codex 授权续期失败，请检查连接或重新登录。');
    const next = await readJson(reply, 128 * 1024);
    if (typeof next?.access_token !== 'string' || typeof next.refresh_token !== 'string' || !next.refresh_token ||
        !Number.isSafeInteger(next.expires_in) || next.expires_in <= 0 ||
        accountFor(next.access_token) !== account) throw new UserError(502, 'Codex 授权续期未通过账号校验。');
    return {kind:'grant', payload:{...before, access:next.access_token, refresh:next.refresh_token,
      expires:Date.now() + next.expires_in * 1000, accountId:account}};
  });
  return grant(updated).access;
}

export function parseCatalog(body) {
  if (!Array.isArray(body?.models)) throw new UserError(502, '服务返回的内容缺少模型目录。');
  const results = new Map();
  for (const row of body.models) {
    if (row?.visibility !== 'list' || row.supported_in_api === false || typeof row.slug !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(row.slug) || results.has(row.slug)) continue;
    const model = {id:row.slug, name:typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim().slice(0,256) : row.slug};
    if (Number.isSafeInteger(row.context_window) && row.context_window > 0) model.contextWindow = row.context_window;
    const inputs = ['text','image'].filter(input => Array.isArray(row.input_modalities) && row.input_modalities.includes(input));
    if (inputs.length) model.input = inputs;
    const efforts = {};
    for (const item of Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : []) {
      if (item?.effort === 'none') efforts.off = 'none';
      else if (['minimal','low','medium','high','xhigh','max'].includes(item?.effort)) efforts[item.effort] = item.effort;
    }
    if (Object.keys(efforts).some(key => key !== 'off')) model.reasoningEfforts = efforts;
    results.set(row.slug, model);
  }
  return [...results.values()];
}

/** Fetch only on the user's explicit refresh, using this DSH profile's selected account. */
export async function discover(store, profile, lifecycle, fetcher = fetch) {
  if (profile?.apiKeyEnv || (profile?.baseURL &&
      !['https://chatgpt.com/backend-api','https://chatgpt.com/backend-api/codex'].includes(profile.baseURL.replace(/\/+$/, '')))) {
    throw new UserError(409, '该 Codex 配置使用了自定义凭据或地址，无法按官方账号查询。');
  }
  const version = profile?.codexClientVersion || '0.169.1';
  const timeout = profile?.modelDiscoveryTimeoutMs ?? 15_000;
  if (!/^\d+\.\d+\.\d+$/.test(version) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) {
    throw new UserError(409, 'Codex 目录客户端版本或超时设置无效。');
  }
  const signal = AbortSignal.any([lifecycle, AbortSignal.timeout(timeout)]);
  const url = new URL(MODEL_URL);
  url.searchParams.set('client_version', version);
  try {
    const access = await accessFor(store, fetcher, signal);
    signal.throwIfAborted();
    const response = await fetcher(url, {signal, redirect:'error', cache:'no-store', headers:{
      accept:'application/json', authorization:'Bearer ' + access, 'chatgpt-account-id':accountFor(access), originator:'codex_cli_rs',
    }});
    if (!response.ok) throw new UserError(502, 'Codex 模型目录返回 HTTP ' + response.status + '。');
    return parseCatalog(await readJson(response, 2 * 1024 * 1024));
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(502, signal.aborted ? '目录请求已取消或超时。' : 'Codex 目录请求失败，请检查连接和登录状态。');
  }
}
