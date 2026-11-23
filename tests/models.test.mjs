import test from 'node:test';
import assert from 'node:assert/strict';
import {modelManager} from '../src/models.mjs';
const route={provider:'openai-codex',settingsNs:'llm-pi-ai',settingsPath:['providers','openai-codex']};
const candidates=[{id:'new',name:'New',input:['text'],contextWindow:400_000,reasoningEfforts:{high:'high'}},{id:'old',name:'Different'}];
function host(profile,options={}){
  const value={providers:{'openai-codex':profile,other:{models:[{id:'untouched'}]}}};
  const view={ns:route.settingsNs,revision:0,value,user:value,base:{}};
  const writes=[];let queries=0;
  const plugin=modelManager({llm:{listConfigurableProviders:()=>[route],listProviders:()=>[{id:'openai-codex'}],listModels:async()=>[{id:'old'}]},settings:{describe:()=>[view],mutate:async(...args)=>{writes.push(args);if(options.conflict)throw Object.assign(new Error(),{code:'SETTINGS_CONFLICT'});}}},new AbortController().signal,async()=>{queries++;return candidates;});
  return {plugin,view,writes,queries:()=>queries};
}
test('status is passive; previews preserve custom rows and save only selected candidates to the existing route',async()=>{
  const row={id:'old',name:'Personal',contextWindow:21,compat:{custom:true}};
  const {plugin,view,writes,queries}=host({models:[row]});
  assert.deepEqual(await plugin.status(),{configured:['old']});assert.equal(queries(),0);
  const r=await plugin.refresh();assert.equal(queries(),1);assert.equal(writes.length,0);
  await assert.rejects(plugin.save(r.preview,['forged']),/不在本次目录/);
  assert.deepEqual(await plugin.save(r.preview,['new','old','new']),{added:['new']});
  assert.deepEqual(writes,[[route.settingsNs,[{op:'set',path:[...route.settingsPath,'models'],value:[row,candidates[0]]}],0]]);
  assert.deepEqual(view.value.providers.other,{models:[{id:'untouched'}]});
  await assert.rejects(plugin.save(r.preview,['new']),/过期/);
});
test('duplicate selections are no-ops; concurrent profile changes require a fresh preview',async()=>{
  const {plugin,view,writes}=host({models:[{id:'old'}]});
  const {preview}=await plugin.refresh();
  assert.deepEqual(await plugin.save(preview,['old']),{added:[]});assert.equal(writes.length,0);
  view.revision++;
  await assert.rejects(plugin.save(preview,['new']),/变更/);
  const changed=host({models:[{id:'old'}]},{conflict:true});
  await assert.rejects(changed.plugin.save((await changed.plugin.refresh()).preview,['new']),/变更/);
});
test('inherited models and user model overrides survive making the first explicit list',async()=>{
  const {plugin,writes}=host({modelOverrides:{old:{name:'Mine'}}});
  const {preview}=await plugin.refresh();await plugin.save(preview,['new']);
  assert.deepEqual(writes[0][1],[{op:'unset',path:[...route.settingsPath,'modelOverrides']},
    {op:'set',path:[...route.settingsPath,'models'],value:[{id:'old',name:'Mine'},candidates[0]]}]);
});
