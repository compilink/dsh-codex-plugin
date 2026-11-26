import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base='http://127.0.0.1:3080';
let startup;
for(let i=0;i<180;i++) {
 const log=readFileSync('/tmp/dsh-codex-smoke.log','utf8');
 const match=log.match(/dsh web: (http:\/\/[^\s]+?\?token=[a-zA-Z0-9_-]+)/);
 if(match){startup=match[1];break;}
 await new Promise(r=>setTimeout(r,350));
}
if(!startup) {
 const names=readFileSync('/tmp/dsh-codex-smoke.log','utf8').split('\n').filter(l=>/error|not found|fail|warn/i.test(l)).slice(-10);
 console.error(names.map(l=>l.replace(/token=[^\s]+/g,'token=REDACTED')));throw Error('DSH did not start');
}
const login=await fetch(startup,{redirect:'manual'});assert.equal(login.status,303);
const cookie=login.headers.get('set-cookie').split(';')[0];
assert.equal((await fetch(base+'/local/chatgpt')).status,200);
assert.equal((await fetch(base+'/local/chatgpt/models')).status,401);
const page=await fetch(base+'/local/chatgpt/models',{headers:{cookie}});
assert.equal(page.status,200);
const csrf=(await page.text()).match(/const csrf='([^']+)'/)[1];
const bootstrap=await fetch(base+'/local/chatgpt/panel-session',{headers:{cookie}});
assert.equal(bootstrap.status,200);
assert.equal((await bootstrap.json()).csrf,csrf);
assert.equal((await fetch(base+'/local/chatgpt/panel-session')).status,401);
const ownerHtml=await (await fetch(base+'/',{headers:{cookie}})).text();
const marker='dsh-bundle-codex-tools/client.js';
const sources=[...ownerHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1].replaceAll('&amp;','&'));
const bundlePath=sources.find(path=>path.includes(marker)) ?? [...ownerHtml.matchAll(/"(\/plugins\/[^"]+)"/g)].map(match=>match[1]).find(path=>path.includes(marker));
if(!bundlePath) throw Error('Plugin did not occur in boot asset URLs: '+ownerHtml.includes(marker)+' '+JSON.stringify(ownerHtml.slice(Math.max(0,ownerHtml.indexOf('dsh-bundle-codex-tools')-44),ownerHtml.indexOf('dsh-bundle-codex-tools')+85)));
const module=await fetch(new URL(bundlePath,base),{headers:{cookie}});
assert.equal(module.status,200);
assert.match(await module.text(),/浏览器登录/);
const statusUrl=base+'/local/chatgpt/api';
async function auth(body) {
 const response=await fetch(statusUrl,{method:body?'POST':'GET',headers:{cookie,origin:base,'content-type':'application/json','x-dsh-login':csrf},body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,200); return response.json();
}
async function until(check) {
 for(let n=0;n<100;n++) { const state=await auth();if(check(state))return state;await new Promise(done=>setTimeout(done,100)); }
 throw Error('Authorization did not reach the expected state');
}
if(process.env.CODEX_AUTH_QA === '1') {
 await auth({action:'begin',method:'browser'});
 const browser=await until(state=>state.notices.some(notice=>notice.url));
 assert.equal(browser.method,'browser');
 assert.equal(new URL(browser.notices.find(notice=>notice.url).url).origin,'https://auth.openai.com');
 await auth({action:'cancel'});await until(state=>state.status==='cancelled');
 await auth({action:'begin',method:'device_code'});
 const device=await until(state=>state.notices.some(notice=>notice.code==='TEST-CODE'));
 assert.equal(device.method,'device_code');
 assert.ok(device.notices.some(notice=>notice.url==='https://auth.openai.com/codex/device'));
 const finished=await until(state=>state.status==='authorized');
 assert.equal(finished.configured,true);
 assert.deepEqual(finished.notices,[]);
}
const uri=base+'/local/chatgpt/models/api';
async function call(body,extra={}){
 const r=await fetch(uri,{method:body?'POST':'GET',headers:{cookie,origin:base,'content-type':'application/json','x-dsh-login':csrf,...extra},body:body?JSON.stringify(body):undefined});
 return [r.status, r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text()];
}
assert.equal((await call({action:'refresh'},{origin:'https://untrusted.invalid'}))[0],403);
assert.deepEqual(await call(),[200,{configured:['gpt-test-existing']}]);
const [code,preview]=await call({action:'refresh'});assert.equal(code,200,JSON.stringify(preview));
assert.equal(preview.candidates[0].id,'gpt-test-candidate');
assert.deepEqual(await call({action:'save',preview:preview.preview,ids:['gpt-test-candidate']}),[200,{added:['gpt-test-candidate']}]);
assert.deepEqual(await call(),[200,{configured:['gpt-test-existing','gpt-test-candidate']}]);
const config=readFileSync('/data/profiles/web/cordis.patch.yml','utf8');
assert.match(config,/gpt-test-candidate/);assert.match(config,/200000/);assert.match(config,/98304/);assert.match(config,/high: high/);
if(process.env.CODEX_AUTH_QA==='1') console.log('Actual pi-ai method selection, official browser URL and cancellation, fixture device-code confirmation, credential persistence and notice cleanup passed.');
console.log('Real DSH Web, authenticated plugin page, legacy health, denied anonymous/foreign origin, synthetic account discovery, scoped persisted model add and existing custom model preservation passed.');
