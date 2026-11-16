// Claude API 호출 (Messages API) + 도구 사용 반복 처리
// API 키는 서버에서만 사용하고 브라우저로는 절대 보내지 않음
'use strict';

const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';

class ClaudeError extends Error {
  constructor(message, status){ super(message); this.status = status; }
}

function friendly(status, body){
  if(status === 401 || status === 403) return 'API 키가 올바르지 않거나 권한이 없어요. .env의 ANTHROPIC_API_KEY를 확인해 주세요.';
  if(status === 404) return `모델을 찾을 수 없어요. .env의 CLAUDE_MODEL 값을 확인해 주세요. (${(body && body.error && body.error.message) || ''})`;
  if(status === 400) return '요청 형식 오류: ' + ((body && body.error && body.error.message) || '알 수 없음');
  if(status === 429) return '요청이 너무 많거나 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.';
  if(status >= 500) return 'Claude 서버가 바빠요. 잠시 후 다시 시도해 주세요.';
  return `Claude API 오류 (${status})`;
}

async function callOnce(body){
  const key = process.env.ANTHROPIC_API_KEY;
  if(!key) throw new ClaudeError('API 키가 없어요. 프로젝트 폴더의 .env 파일에 ANTHROPIC_API_KEY를 넣고 서버를 다시 켜 주세요.', 500);
  let res;
  try{
    res = await fetch(API_URL, {
      method:'POST',
      headers:{
        'x-api-key': key,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2026-10-21',
        'content-type':'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000)
    });
  }catch(e){
    throw new ClaudeError('Claude API에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (' + e.message + ')', 502);
  }
  const json = await res.json().catch(() => null);
  if(!res.ok) throw new ClaudeError(friendly(res.status, json), res.status);
  return json;
}

// tools: [{ name, description, input_schema, run(input) }]
async function chat({ system, messages, tools = [] }){
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  const maxTokens = Number(process.env.MAX_TOKENS) || 1024;
  const apiTools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const convo = messages.map(m => ({ role:m.role, content:m.content }));
  const toolCalls = [];   // 대화 기록용: 어떤 도구를 어떤 값으로 불렀고 결과가 어땠는지

  for(let round = 0; round < 5; round++){   // 도구 호출은 최대 5번까지
    const res = await callOnce({ model, max_tokens:maxTokens, system, messages:convo, ...(apiTools.length ? { tools:apiTools } : {}) });
    const blocks = res.content || [];
    if(res.stop_reason !== 'tool_use'){
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { text: text || (res.stop_reason === 'refusal' ? '죄송해요, 이 요청에는 답변할 수 없어요.' : '(빈 답변)'), model:res.model, usage:res.usage, toolCalls };
    }
    convo.push({ role:'assistant', content:blocks });
    const results = [];
    for(const b of blocks.filter(x => x.type === 'tool_use')){
      const tool = tools.find(t => t.name === b.name);
      let content, isError = false;
      try{ content = JSON.stringify(tool ? await tool.run(b.input || {}) : { error:'알 수 없는 도구' }); if(!tool) isError = true; }
      catch(e){ content = JSON.stringify({ error:e.message }); isError = true; }
      results.push({ type:'tool_result', tool_use_id:b.id, content, ...(isError ? { is_error:true } : {}) });
      let found = null; try{ found = JSON.parse(content).found; }catch(e){}
      toolCalls.push({ name:b.name, input:{ orderNo:(b.input || {}).orderNo || '' }, found, error:isError });   // 이름 등 개인정보는 기록하지 않음
    }
    convo.push({ role:'user', content:results });
  }
  throw new ClaudeError('도구 호출이 너무 많이 반복돼서 답변을 멈췄어요.', 500);
}

module.exports = { chat, ClaudeError };
