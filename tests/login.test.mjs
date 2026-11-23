import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.mjs';
test('login UI requires loopback Host and page nonce, exposes presence but no credential value', async () => {
  let route;
  apply({ effect: f => f(), on() {}, connection:{requestRejection(req){ return req.headers.host === '127.0.0.1:3080' ? 401 : 403; }},
    webServer: { register: r => { route = r; return () => {}; } },
    credentials: { describeRecord: async () => ({ configured: true }) },
    authorization: { describe: () => ({}), cancel() {} },
  });
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
    connection:{requestRejection:req=>req.headers.cookie==='synthetic-web-session'?undefined:401},
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
  assert.equal(beginCalls,0);
  assert.equal((await request('/local/chatgpt/models/api','POST',{cookie:'synthetic-web-session'},{action:'refresh'})).code,403);
  assert.equal((await request('/local/chatgpt/models','GET',{cookie:'synthetic-web-session'})).code,200);
});
