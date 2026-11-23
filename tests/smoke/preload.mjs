const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  if(String(input).startsWith('https://chatgpt.com/backend-api/codex/models?')){
    if(options.headers['chatgpt-account-id']!=='test-only')throw Error('synthetic account required');
    return Response.json({models:[{slug:'gpt-test-candidate',display_name:'Isolated test model',context_window:200000,input_modalities:['text','image'],visibility:'list',supported_in_api:true,supported_reasoning_levels:[{effort:'high'}]}]});
  }
  return original(input,options);
};
