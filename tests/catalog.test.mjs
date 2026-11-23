import test from 'node:test';
import assert from 'node:assert/strict';
import {discover, KEY, parseCatalog} from '../src/catalog.mjs';
const jwt=id=>'x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:id}})).toString('base64url')+'.x';
const signal=new AbortController().signal;
const model={slug:'gpt-example',visibility:'list',supported_in_api:true,display_name:'Example',context_window:1000,input_modalities:['text','image','video'],supported_reasoning_levels:[{effort:'high'},{effort:'none'},{effort:'other'}]};
function fixture(expiry=Infinity){
  let value={kind:'grant',payload:{type:'oauth',expires:Number.isFinite(expiry)?expiry:Date.now()+999_999,access:jwt('test-account'),refresh:'test-only'}};
  let serial=Promise.resolve();
  return {readRecord:async key=>{assert.equal(key,KEY);return value;},modifyRecord(key,op){assert.equal(key,KEY);const next=serial.then(async()=>{value=(await op(value))??value;return value;}); serial=next.catch(()=>{});return next;}};
}
test('directory parses public visible models, supported fields, duplicate ids and malformed entries',()=>{
  assert.deepEqual(parseCatalog({models:[null,model,{...model,visibility:'hide'},{...model,supported_in_api:false},model]}),
    [{id:'gpt-example',name:'Example',contextWindow:1000,input:['text','image'],reasoningEfforts:{high:'high',off:'none'}}]);
  assert.throws(()=>parseCatalog({}));
});
test('live request is bound to the saved account and a fixed nonredirecting official address', async()=>{
  const received=await discover(fixture(),{},signal,async(url,options)=>{
    assert.equal(url.origin,'https://chatgpt.com');assert.equal(url.pathname,'/backend-api/codex/models');
    assert.equal(options.headers['chatgpt-account-id'],'test-account');
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return Response.json({models:[model]});
  });
  assert.equal(received[0].id,model.slug);
  for(const profile of [{apiKeyEnv:'SYNTHETIC'}, {baseURL:'https://example.invalid'}]){
    await assert.rejects(discover(fixture(),profile,signal,()=>assert.fail()), /自定义/);
  }
});
test('two concurrent refreshes rotate once under the shared DSH record lock',async()=>{
  const store=fixture(0);let rotations=0;
  const fetcher=async(url,options)=>{
    if(String(url)==='https://auth.openai.com/oauth/token'){
      assert.equal(options.redirect,'error');assert.equal(options.body.get('refresh_token'),'test-only');rotations++;
      return Response.json({access_token:jwt('test-account'),refresh_token:'rotated',expires_in:3600});
    }return Response.json({models:[model]});
  };
  await Promise.all([discover(store,{},signal,fetcher),discover(store,{},signal,fetcher)]);
  assert.equal(rotations,1);assert.equal((await store.readRecord(KEY)).payload.refresh,'rotated');
});
test('refuse account change, malformed and oversized replies; errors contain no bearer or upstream body',async()=>{
  const store=fixture(0);
  await assert.rejects(discover(store,{},signal,async()=>Response.json({access_token:jwt('other'),refresh_token:'rotated',expires_in:3600})),/账号校验/);
  assert.equal((await store.readRecord(KEY)).payload.refresh,'test-only');
  await assert.rejects(discover(fixture(),{},signal,async()=>new Response('sensitive-provider-error',{status:401})),error=>!error.message.includes('sensitive')&&error.message.includes('401'));
  await assert.rejects(discover(fixture(),{},signal,async()=>new Response('z'.repeat(2*1024*1024+1))),/大小限制/);
});
