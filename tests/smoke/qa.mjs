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
const uri=base+'/local/chatgpt/models/api';
async function call(body,extra={}){
 const r=await fetch(uri,{method:body?'POST':'GET',headers:{cookie,origin:base,'content-type':'application/json','x-dsh-login':csrf,...extra},body:body?JSON.stringify(body):undefined});
 return [r.status,await r.json()];
}
assert.equal((await call({action:'refresh'},{origin:'https://untrusted.invalid'}))[0],403);
assert.deepEqual(await call(),[200,{configured:['gpt-test-existing']}]);
const [code,preview]=await call({action:'refresh'});assert.equal(code,200,JSON.stringify(preview));
assert.equal(preview.candidates[0].id,'gpt-test-candidate');
assert.deepEqual(await call({action:'save',preview:preview.preview,ids:['gpt-test-candidate']}),[200,{added:['gpt-test-candidate']}]);
assert.deepEqual(await call(),[200,{configured:['gpt-test-existing','gpt-test-candidate']}]);
const config=readFileSync('/data/profiles/web/cordis.patch.yml','utf8');
assert.match(config,/gpt-test-candidate/);assert.match(config,/200000/);assert.match(config,/98304/);assert.match(config,/high: high/);
console.log('Real DSH Web, authenticated plugin page, legacy health, denied anonymous/foreign origin, synthetic account discovery, scoped persisted model add and existing custom model preservation passed.');
