// Render the released browser bundle with the DSH checkout's React and JSDOM packages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const store = process.argv[2];
function load(name, spec = name) {
  const folder = fs.readdirSync(store).find(entry => entry.startsWith(name + '@'));
  return require(path.join(store, folder, 'node_modules', spec));
}
const React = load('react'), { JSDOM } = load('jsdom'), { createRoot } = load('react-dom', 'react-dom/client');
const source = fs.readFileSync(path.join(__dirname,'../../src/client.js'),'utf8');
async function scenario(origin) {
  const dom = new JSDOM('<main></main>', {url: origin});
  global.window = dom.window; global.document = window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let Panel, poll, method, done = false, saved, externals = [];
  window.open = url => externals.push(url);
  window.__ModuleLoader__ = { load(module) { module.factory(() => React).apply({
    effect: f => f(), slots: {inject: (_, f) => f(), register: (_, component) => { Panel = component; }},
  }); } };
  async function request(url, options) {
    assert.equal(url.protocol, new URL(origin).protocol);
    assert.equal(options.credentials, 'same-origin');
    let data;
    if (url.pathname.endsWith('panel-session')) data = {csrf:'test-nonce'};
    else {
      assert.equal(options.headers['x-dsh-login'],'test-nonce');
      const body = options.body && JSON.parse(options.body);
      if (url.pathname.endsWith('models/api')) {
        data = body?.action === 'refresh' ? {preview:'example', configured:['old'],
          candidates:[{id:'old',name:'Existing'},{id:'new',name:'New'}]} : body?.action === 'save'
          ? (saved=body.ids, {added:body.ids}) : {configured:['old']};
      } else if (body) {
        if (body.action === 'begin') { method=body.method; done=false; }
        if (body.action === 'cancel') { method=undefined; done=false; }
        data = {ok:true};
      } else {
        const url = method === 'browser' ? 'https://auth.openai.com/oauth/authorize' : 'https://auth.openai.com/codex/device';
        data = {status:done?'authorized':method?'running':'idle', available:true, configured:done,
          notices:method&&!done?[{url, ...(method==='device_code'&&{code:'TEST-CODE'})}]:[]};
      }
    }
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  }
  vm.runInNewContext(source,{window,document,URL,AbortController,fetch:request,setTimeout:fn=>{poll=fn;return 1;},clearTimeout:()=>{poll=undefined;}});
  const main=document.querySelector('main'), root=createRoot(main);
  const getButton=label=>[...main.querySelectorAll('button')].find(el=>el.textContent===label);
  const click=async label=>React.act(async()=>{getButton(label).click();});
  await React.act(async()=>{root.render(React.createElement(Panel));});
  await click('浏览器登录');assert.equal(method,'browser');assert.equal(externals.length,1);
  await click('取消本次登录');assert.equal(method,undefined);
  await click('设备码登录');assert.match(main.textContent,/TEST-CODE/);assert.equal(externals.length,1);
  done=true;await React.act(async()=>{await poll();});
  assert.match(main.textContent,/已保存 ChatGPT 登录凭据/);assert.doesNotMatch(main.textContent,/TEST-CODE/);
  await click('模型更新');await click('获取最新模型');
  const inputs=main.querySelectorAll('input');assert.equal(inputs[0].disabled,true);assert.equal(inputs[1].disabled,false);
  await React.act(async()=>{inputs[1].click();});await click('添加选中模型');assert.deepEqual(saved,['new']);
  await React.act(async()=>root.unmount());dom.window.close();
}
(async()=>{await scenario('http://127.0.0.1:3080/');await scenario('dsh-app://app/');
  console.log('React settings passed on both origins: user choice, official link, cancel, device code, completion, preview and save.');})()
.catch(error=>{console.error(error);process.exitCode=1;});
