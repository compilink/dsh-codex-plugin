import {randomUUID} from 'node:crypto';
import {PROVIDER, UserError, discover} from './catalog.mjs';

export function modelManager(ctx, signal, fetchCatalog = discover) {
  const previews = new Map();
  function config() {
    const route = ctx.llm.listConfigurableProviders().find(row => row.provider === PROVIDER);
    if (!route || route.declared || route.settingsPath.join('/') !== 'providers/openai-codex') {
      throw new UserError(409, '当前 DSH 配置需要启用支持 openai-codex 的 llm-pi-ai。');
    }
    const view = ctx.settings.describe({redactSecrets:true}).find(row => row.ns === route.settingsNs);
    if (!view) throw new UserError(409, 'DSH 的模型配置当前不可用。');
    const at = layer => layer?.providers?.[PROVIDER] ?? {};
    const explicit = {...at(view.base), ...at(view.user)};
    return {ns:route.settingsNs, view, profile:at(view.value), explicit, base:at(view.base)};
  }
  async function rows(c) {
    if (c.explicit.models?.length) return c.explicit.models;
    if (!ctx.llm.listProviders().some(row => row.id === PROVIDER)) return [];
    const inherited = await ctx.llm.listModels(PROVIDER);
    return inherited.map(({id}) => ({id, ...c.explicit.modelOverrides?.[id]}));
  }
  return {
    async status() {
      const c = config();
      return {configured:(await rows(c)).map(row => row.id)};
    },
    async refresh() {
      const c = config();
      const candidates = await fetchCatalog(ctx.credentials, c.profile, signal);
      const configured = (await rows(c)).map(row => row.id);
      for (const [key, entry] of previews) if (entry.expires < Date.now()) previews.delete(key);
      if (previews.size >= 16) previews.delete(previews.keys().next().value);
      const preview = randomUUID();
      previews.set(preview,{revision:c.view.revision, ns:c.ns, expires:Date.now()+600_000, candidates});
      return {preview, candidates, configured};
    },
    async save(preview, ids) {
      const snapshot = previews.get(preview);
      if (!snapshot || snapshot.expires < Date.now()) throw new UserError(409,'本次目录已过期，请刷新后再保存。');
      if (!Array.isArray(ids) || !ids.length || ids.length > 512) throw new UserError(400,'请选择要添加的模型。');
      const byId = new Map(snapshot.candidates.map(row => [row.id,row]));
      if (ids.some(id => !byId.has(id))) throw new UserError(400,'所选模型不在本次目录中。');
      const c = config();
      if (c.ns !== snapshot.ns || c.view.revision !== snapshot.revision) throw new UserError(409,'模型配置已变更，请重新刷新。');
      const existing = await rows(c);
      const known = new Set(existing.map(row => row.id));
      const added = [...new Set(ids)].filter(id => !known.has(id));
      if (!added.length) return {added:[]};
      const path = ['providers', PROVIDER];
      const ops = [];
      if (Object.keys(c.explicit.modelOverrides ?? {}).length) {
        if (Object.keys(c.base.modelOverrides ?? {}).length) throw new UserError(409,'基础配置含有模型覆盖项。请先在 DSH 模型设置中将覆盖项合入模型列表。');
        if (Object.keys(c.explicit.modelOverrides).some(id => !known.has(id))) throw new UserError(409,'存在缺少关联模型的覆盖项，请先检查 DSH 模型设置。');
        ops.push({op:'unset',path:[...path,'modelOverrides']});
      }
      ops.push({op:'set',path:[...path,'models'],value:existing.concat(added.map(id => byId.get(id)))});
      try { await ctx.settings.mutate(c.ns,ops,snapshot.revision); }
      catch (error) {
        if (error?.code === 'SETTINGS_CONFLICT' || error?.name === 'SettingsConflictError') throw new UserError(409,'模型配置已变更，请重新刷新。');
        throw new UserError(409,'DSH 拒绝保存该配置，请检查提供商设置后刷新。');
      }
      previews.delete(preview);
      return {added};
    }
  };
}
