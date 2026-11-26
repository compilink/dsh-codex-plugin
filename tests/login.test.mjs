import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.mjs';
test('login UI requires loopback Host and page nonce, exposes presence but no credential value', async () => {
  let route;
  apply({ effect: f => f(), on() {}, connection:{admit(req){ return {rejection:req.headers.host === '127.0.0.1:3080' ? 401 : 403}; }},
    webServer: { register: r => { route = r; return () => {}; } },
    credentials: { describeRecord: async () => ({ configured: true }) },
    authorization: { describe: () => ({}), cancel() {} },
  });
  const facts = {transport:'http', method:'GET', url:new URL('http://localhost/local/chatgpt'), headers:new Headers({host:'127.0.0.1:3080'})};
  assert.equal(route.auth(facts),'anonymous');
  assert.equal(route.auth({...facts,method:'POST'}),'required');
  assert.equal(route.auth({...facts,headers:{host:'localhost',origin:'http://localhost'}}),'required');
  assert.equal(route.auth({...facts,url:new URL('http://localhost/local/chatgpt/models')}),'required');
  async function call(url, headers = {}) {
    let code, body;
    await route.handler({ url, method: 'GET', headers: { host: '127.0.0.1:3080', ...headers } },
      { writeHead: c => { code = c; }, end: s => { body = s; } });
    return { code, body };
  }
  assert.equal((await call('/local/chatgpt', { host: 'untrusted.example' })).code, 403);
  assert.equal((await call('/local/chatgpt/api')).code, 403);
  const page = await call('/local/chatgpt');
  assert.match(page.body, /使用 ChatGPT 登录/);
  const nonce = page.body.match(/const token='([^']+)'/)[1];
  const state = await call('/local/chatgpt/api', { 'x-dsh-login': nonce });
  assert.equal(state.code, 200);
  assert.equal(JSON.parse(state.body).configured, true);
  assert.deepEqual(Object.keys(JSON.parse(state.body)).sort(), ['available', 'configured', 'notices', 'prompt', 'status']);
});
test('the model settings route and login actions require DSH admission, including when a valid page nonce is known', async()=>{
  let route;let beginCalls=0;
  apply({effect:f=>f(),on(){},webServer:{register:r=>{route=r;return ()=>{};}},
    connection:{browserPeer:'owner',admit:req=>req.headers.cookie==='synthetic-web-session'?{peer:'owner'}:req.headers.cookie==='authenticated-api-session'?{peer:'limited'}:{rejection:401}},
    authorization:{begin(){beginCalls++;},cancel(){}},credentials:{}});
  async function request(path,method,headers={},body) {
    let code,value;
    const req={url:path,method,headers:{host:'127.0.0.1:3080',...headers},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}};
    await route.handler(req,{writeHead:c=>{code=c;},end:v=>{value=v;}});
    return {code,value};
  }
  const login=await request('/local/chatgpt','GET');
  const csrf=login.value.match(/const token='([^']+)'/)[1];
  assert.equal((await request('/local/chatgpt/models','GET')).code,401);
  assert.equal((await request('/local/chatgpt/api','POST',{'x-dsh-login':csrf},{action:'begin'})).code,401);
  assert.equal((await request('/local/chatgpt/api','POST',{cookie:'authenticated-api-session','x-dsh-login':csrf},{action:'begin'})).code,403);
  assert.equal((await request('/local/chatgpt/api','GET',{cookie:'authenticated-api-session','x-dsh-login':csrf})).code,403);
  assert.equal((await request('/local/chatgpt/models','GET',{cookie:'authenticated-api-session'})).code,403);
  assert.equal((await request('/local/chatgpt/models/api','POST',{cookie:'authenticated-api-session','x-dsh-login':csrf},{action:'refresh'})).code,403);
  assert.equal((await request('/local/chatgpt/models/api','POST',{cookie:'authenticated-api-session','x-dsh-login':csrf},{action:'save'})).code,403);
  assert.equal(beginCalls,0);
  assert.equal((await request('/local/chatgpt/models/api','POST',{cookie:'synthetic-web-session'},{action:'refresh'})).code,403);
  assert.equal((await request('/local/chatgpt/models','GET',{cookie:'synthetic-web-session'})).code,200);
});

test('the token provider distinguishes browser, API and in-process owner peers', async () => {
  const internal = {principal:{kind:'owner'}};
  const browser = {principal:{kind:'owner'}};
  const api = {principal:{kind:'owner'}};
  let route;
  let peer;
  const context={effect:f=>f(),on(){},webServer:{register(r){route=r;return ()=>{};}},
    inject:(names,mount)=>{assert.deepEqual(names,['connection.authentication']);return mount(context);},
    get:name=>name==='dshLocalBrowserOwner'?{matches:actual=>actual===browser}:name==='connection.authentication'?{}:undefined,connection:{browserPeer:internal,admit:()=>peer?{peer}:{rejection:401}},
    authorization:{cancel(){}},credentials:{}};
  apply(context);
  for (const [requestPeer,status] of [[undefined,401],[api,403],[internal,403],[browser,200]]) {
    peer=requestPeer;
    let code;
    await route.handler({url:'/local/chatgpt/models',method:'GET',headers:{host:'localhost:3080'}},
      {writeHead:c=>{code=c;},end(){}});
    assert.equal(code,status);
  }
});
