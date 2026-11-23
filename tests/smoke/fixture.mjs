export const inject = ['credentials'];
export async function apply(ctx) {
  const access='test.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'test-only'}})).toString('base64url')+'.synthetic';
  await ctx.credentials.modifyRecord('llm-pi-ai/openai-codex',async()=>({kind:'grant',payload:{type:'oauth',access,refresh:'synthetic',expires:Date.now()+3600000,accountId:'test-only'}}));
}
