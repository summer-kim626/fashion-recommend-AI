// API 키·모델이 제대로 동작하는지 한 번 호출해서 확인: npm run check
'use strict';
const path = require('path');
require('../functions/lib/env').loadEnv(path.join(__dirname, '..', '.env'));
const { chat } = require('../functions/lib/claude');
(async () => {
  console.log('모델:', process.env.CLAUDE_MODEL || 'claude-sonnet-5-5');
  if(!process.env.ANTHROPIC_API_KEY){ console.log('✗ .env에 ANTHROPIC_API_KEY가 없어요.'); process.exit(1); }
  try{
    const r = await chat({ system:'한 문장으로 짧게 답해.', messages:[{ role:'user', content:'연결 확인입니다. "연결 성공"이라고만 답해 주세요.' }] });
    console.log('✓ 연결 성공 · 답변:', r.text, '· 실제 모델:', r.model);
  }catch(e){ console.log('✗ 실패:', e.message); process.exit(1); }
})();
