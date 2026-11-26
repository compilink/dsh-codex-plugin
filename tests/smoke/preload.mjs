const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  if(process.env.CODEX_AUTH_QA==='1') {
    const url=String(input);
    if(url==='https://auth.openai.com/api/accounts/deviceauth/usercode')
      return Response.json({device_auth_id:'fixture-device',user_code:'TEST-CODE',interval:1});
    if(url==='https://auth.openai.com/api/accounts/deviceauth/token') {
      await new Promise(resolve=>setTimeout(resolve,450));
      return Response.json({authorization_code:'fixture-code',code_verifier:'fixture-verifier'});
    }
    if(url==='https://auth.openai.com/oauth/token') {
      const payload=Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'test-only'}})).toString('base64');
      return Response.json({access_token:'test.'+payload+'.synthetic',refresh_token:'fixture-refresh',expires_in:3600});
    }
  }
  if(String(input).startsWith('https://chatgpt.com/backend-api/codex/models?')){
    if(options.headers['chatgpt-account-id']!=='test-only')throw Error('synthetic account required');
    return Response.json({models:[{slug:'gpt-test-candidate',display_name:'Isolated test model',context_window:200000,input_modalities:['text','image'],visibility:'list',supported_in_api:true,supported_reasoning_levels:[{effort:'high'}]}]});
  }
  return original(input,options);
};
