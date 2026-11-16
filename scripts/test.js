// 자동 테스트: npm test
// 실제 Claude 대신 가짜 Claude 서버를 띄우고, 임시 폴더의 데이터로 서버 기능을 점검 (내 data/ 파일은 건드리지 않음)
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fitbot-test-'));
let lastReq = null, mode = 'ok';
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b); lastReq = { headers:req.headers, body };
    if(mode === '401'){ res.writeHead(401, { 'content-type':'application/json' }); return res.end('{"error":{"message":"invalid x-api-key"}}'); }
    const last = body.messages[body.messages.length - 1];
    if(String(body.system).includes('편집자')){ res.writeHead(200, { 'content-type':'application/json' }); return res.end(JSON.stringify({ stop_reason:'end_turn', model:body.model, content:[{ type:'text', text:'사이즈는 S=90, M=95, L=100, XL=105 기준으로만 안내해.' }] })); }
    const reply = o => { res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify(o)); };
    if(Array.isArray(last.content) && last.content[0].type === 'tool_result')
      return reply({ stop_reason:'end_turn', model:body.model, content:[{ type:'text', text:'TOOL:' + last.content[0].content }] });
    const m = typeof last.content === 'string' && last.content.match(/(MO-\d{8}-\d{4})\s+(\S+)/);
    if(m) return reply({ stop_reason:'tool_use', model:body.model, content:[{ type:'tool_use', id:'toolu_1', name:'lookup_order', input:{ orderNo:m[1], customerName:m[2] } }] });
    reply({ stop_reason:'end_turn', model:body.model, content:[{ type:'text', text:'답변입니다' }] });
  });
});

const results = [];
const check = (id, name, pass, detail = '') => { results.push({ id, name, pass:!!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ' :: ' + detail : ''}`); };

mock.listen(0, '127.0.0.1', async () => {
  Object.assign(process.env, { ANTHROPIC_BASE_URL:'http://127.0.0.1:' + mock.address().port, ANTHROPIC_API_KEY:'test-key', CLAUDE_MODEL:'test-model', ADMIN_PASSWORD:'1234', DATA_DIR:tmp });
  const { server, storage } = require('../server');
  await storage.getState();
  server.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const call = async (p, { method = 'GET', body, token } = {}) => {
      const h = { 'content-type':'application/json' }; if(token) h.authorization = 'Bearer ' + token;
      const r = await fetch(base + p, { method, headers:h, body: body ? JSON.stringify(body) : undefined });
      const text = await r.text(); let json = null; try{ json = JSON.parse(text); }catch(e){}
      return { status:r.status, json, text };
    };
    const uid = 'test-user-0001';
    try{
      let r = await call('/'); check('T01', '첫 화면(index.html) 열림', r.status === 200 && r.text.includes('의류 맞춤 추천 봇'));
      r = await call('/api/config'); check('T02', '관리자 비밀번호 표시용 값 제공', r.json.adminPasswordHint === '1234' && r.json.hasApiKey === true);
      r = await call('/api/profile', { method:'PUT', body:{ uid, profile:{ height:'99' } } }); check('T03', '키 범위 밖 저장 거부(서버 검증)', r.status === 400, r.json && r.json.error);
      r = await call('/api/profile', { method:'PUT', body:{ uid, profile:{ gender:'남성', height:'180', weight:'83', age:'20대' } } });
      const g = await call('/api/profile?uid=' + uid); check('T04', '내 정보 저장·불러오기', r.status === 200 && g.json.profile.height === '180');
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'아우터 추천' }] } });
      const sys = lastReq.body.system;
      check('T05', '답변 직전 내 정보·카탈로그·운영정책이 지시문에 들어감', r.json.text === '답변입니다' && sys.includes('키: 180cm') && sys.includes('P003 | 경량 덕다운 패딩 점퍼') && sys.includes('배송비: 3,000원, 50,000원') && !/\{\{.+?\}\}/.test(sys));
      check('T06', 'API 키·버전 헤더를 서버에서 붙여 전송', lastReq.headers['x-api-key'] === 'test-key' && !!lastReq.headers['anthropic-version'] && lastReq.body.model === 'test-model');
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'MO-20261113-0006 강지호 배송 어디예요?' }] } });
      check('T07', '주문 조회 도구를 서버에서 실행(이름 일치)', r.json.text.includes('"found":true') && r.json.text.includes('중부 허브') && !r.json.text.includes('customerId'), r.json.text.slice(0, 80));
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'MO-20261113-0006 홍길동 배송' }] } });
      check('T08', '이름 불일치 주문은 조회 거부', r.json.text.includes('"found":false'));
      const many = Array.from({ length:30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content:'메시지' + i })); many.push({ role:'user', content:'마지막' });
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:many } }); check('T09', 'AI에 보내는 대화 기록 최근 20개로 제한', lastReq.body.messages.length <= 20 && lastReq.body.messages[0].role === 'user', '보낸 수 ' + lastReq.body.messages.length);
      r = await call('/api/admin/login', { method:'POST', body:{ password:'0000' } }); check('T10', '틀린 관리자 비밀번호 거부(서버)', r.status === 401);
      r = await call('/api/admin/state'); check('T11', '로그인 없이 관리자 데이터 접근 차단', r.status === 401);
      r = await call('/api/admin/login', { method:'POST', body:{ password:'1234' } }); const token = r.json.token; check('T12', '관리자 로그인 성공(토큰 발급)', !!token);
      let st = (await call('/api/admin/state', { token })).json;
      const bad = JSON.parse(JSON.stringify(st)); bad.data.products[1].id = 'P001';
      r = await call('/api/admin/state', { method:'PUT', token, body:bad }); check('T13', '잘못된 데이터(중복 상품ID) 적용 거부', r.status === 400 && r.json.error.includes('중복'), r.json.error);
      const good = JSON.parse(JSON.stringify(st)); good.data.inventory.find(i => i.id === 'P004').stock.M = 5;
      r = await call('/api/admin/state', { method:'PUT', token, body:good });
      const inv = r.json.data.inventory.find(i => i.id === 'P004');
      check('T14', '재고 적용 → 서버 계산(총재고·상태)·버전 증가', r.status === 200 && inv.total === 19 && inv.status === '정상' && r.json.version === st.version + 1);
      await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'데님' }] } });
      check('T15', '적용한 재고가 다음 답변 지시문에 반영', lastReq.body.system.includes('M 5개, L 4개'));
      r = await call('/api/admin/state', { method:'PUT', token, body:good }); check('T16', '옛 버전으로 적용 시 충돌(409) 안내', r.status === 409, r.json.error);
      st = (await call('/api/admin/state', { token })).json;
      const s2 = JSON.parse(JSON.stringify(st)); s2.settings.baseFee = 2500; s2.settings.freeThreshold = 30000;
      s2.data.orders.push({ orderNo:'MO-TEST-0001', orderedAt:'2026-11-16 12:00', customerId:'C099', customerName:'테스트', productId:'P005', productName:'', size:'M', color:'그레이', unitPrice:29000, qty:1, subtotal:null, shippingFee:null, total:null, payment:'신용카드', status:'배송준비중' });
      r = await call('/api/admin/state', { method:'PUT', token, body:s2 });
      const nw = r.json.data.orders.find(o => o.orderNo === 'MO-TEST-0001'), old = r.json.data.orders.find(o => o.orderNo === 'MO-20261108-0003');
      await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'배송비' }] } });
      check('T17', '배송비 설정 → 새 주문 계산·정책 문구 반영, 기존 주문 유지', nw.shippingFee === 2500 && old.shippingFee === 3000 && lastReq.body.system.includes('배송비: 2,500원, 30,000원'), `신규 ${nw.shippingFee} / 기존 ${old.shippingFee}`);
      r = await call('/api/admin/preview', { method:'POST', token, body:{ data:r.json.data, prompts:r.json.prompts, settings:r.json.settings } });
      check('T18', '미리보기: 모든 {{자리}} 채워짐', r.json.text.includes('키: 175cm') && !/\{\{.+?\}\}/.test(r.json.text));
      r = await call('/%2e%2e/server.js'); check('T19', '폴더 밖 파일 접근 차단', r.status === 403 || r.status === 404, 'status ' + r.status);
      const pub = ['index.html', 'common.js', 'chat.js', 'admin.js', 'chatlog.js', 'admin-logs.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('');
      check('T20', '브라우저 파일에 주문·고객 목록, API 키 없음 (안내 문구의 예시 1건 제외)', !['김하늘','박서연','최민준','MO-20261105','HB2026'].some(x => pub.includes(x)) && !pub.includes('ANTHROPIC_API_KEY='));
      mode = '401'; r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'안녕' }] } }); mode = 'ok';
      check('T21', 'API 키 오류 시 한국어 안내', r.status === 401 && r.json.error.includes('API 키'), r.json.error);
      const keep = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'안녕' }] } }); process.env.ANTHROPIC_API_KEY = keep;
      check('T22', 'API 키 없음 → .env 안내', r.json.error.includes('.env'), r.json.error);
      r = await call('/api/admin/logout', { method:'POST', token }); r = await call('/api/admin/state', { token }); check('T23', '로그아웃 후 토큰 무효', r.status === 401);
      check('T24', '테스트가 내 data/ 폴더를 건드리지 않음', fs.existsSync(path.join(tmp, 'store.json')));

      /* ---- v2: 관리자 피드백 지침 ---- */
      r = await call('/api/admin/guidelines'); check('T25', '로그인 없이 지침 조회 차단', r.status === 401);
      const tk = (await call('/api/admin/login', { method:'POST', body:{ password:'1234' } })).json.token;
      r = await call('/api/admin/guidelines', { token:tk }); check('T26', '처음 지침 목록은 비어 있음', r.status === 200 && r.json.items.length === 0);
      await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'코트' }] } });
      check('T27', '지침 없을 때 지시문에 "(아직 등록된 지침 없음)"', lastReq.body.system.includes('[관리자 피드백 지침]') && lastReq.body.system.includes('(아직 등록된 지침 없음)'));
      r = await call('/api/admin/guidelines', { method:'POST', token:tk, body:{ text:'  ', source:null } }); check('T28', '빈 지침 거부', r.status === 400);
      r = await call('/api/admin/guidelines', { method:'POST', token:tk, body:{ text:'x'.repeat(301) } }); check('T29', '300자 넘는 지침 거부', r.status === 400, r.json.error);
      r = await call('/api/admin/guidelines/draft', { method:'POST', token:tk, body:{ question:'아우터 추천', answer:'M(95)~L(100)', rating:'bad', comment:'사이즈 숫자가 답변마다 달라요' } });
      check('T30', 'AI로 지침 다듬기(저장 안 함)', r.status === 200 && r.json.text.includes('S=90') && (await call('/api/admin/guidelines', { token:tk })).json.items.length === 0, r.json.text);
      r = await call('/api/admin/guidelines/draft', { method:'POST', token:tk, body:{ question:'q', answer:'a', comment:'' } }); check('T31', '코멘트 없이 다듬기 요청 시 안내', r.status === 400);
      r = await call('/api/admin/guidelines', { method:'POST', token:tk, body:{ text:'사이즈는 S=90, M=95, L=100, XL=105 기준으로만 안내해.', source:{ sessionId:'S1', messageId:'M1', question:'아우터 추천', answer:'...', rating:'bad', comment:'사이즈 숫자 불일치' } } });
      const g1 = r.json.item; check('T32', '피드백을 지침에 반영(출처 포함 저장)', r.status === 200 && g1.active && g1.source.comment === '사이즈 숫자 불일치' && fs.existsSync(path.join(tmp, 'guidelines.json')));
      r = await call('/api/admin/guidelines', { method:'POST', token:tk, body:{ text:'사이즈는 S=90, M=95, L=100, XL=105 기준으로만 안내해.' } }); check('T33', '같은 지침 중복 거부', r.status === 400);
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'코트 사이즈' }] } });
      check('T34', '반영한 지침이 다음 답변 지시문에 들어감 + 응답에 적용 지침 ID', lastReq.body.system.includes('1. 사이즈는 S=90') && r.json.guidelineIds.includes(g1.id));
      r = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'MO-20261113-0006 강지호 배송' }] } });
      check('T35', '응답에 도구 호출 기록(주문번호·결과만, 이름 없음)', r.json.toolCalls.length === 1 && r.json.toolCalls[0].found === true && r.json.toolCalls[0].input.orderNo === 'MO-20261113-0006' && !JSON.stringify(r.json.toolCalls).includes('강지호'));
      r = await call('/api/admin/guidelines/' + g1.id, { method:'PATCH', token:tk, body:{ active:false } });
      await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'코트' }] } });
      check('T36', '지침 끄면 다음 답변에서 빠짐', r.json.item.active === false && !lastReq.body.system.includes('S=90'));
      r = await call('/api/admin/guidelines/' + g1.id, { method:'PATCH', token:tk, body:{ active:true, text:'사이즈는 S=90, M=95, L=100, XL=105로만 안내하고 브랜드별 실측 확인을 권해.' } });
      await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'코트' }] } });
      check('T37', '지침 문장 수정·다시 켜기 반영', lastReq.body.system.includes('브랜드별 실측 확인을 권해'));
      // 이전 버전에서 저장한 프롬프트({{관리자피드백}} 없음)도 지침이 자동으로 붙는지
      const cur = (await call('/api/admin/state', { token:tk })).json;
      const oldSt = JSON.parse(JSON.stringify(cur)); oldSt.prompts.fit = oldSt.prompts.fit.replace(/\[관리자 피드백 지침\][\s\S]*?\{\{관리자피드백\}\}\n\n/, '');
      r = await call('/api/admin/state', { method:'PUT', token:tk, body:oldSt });
      await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'코트' }] } });
      const sysOld = lastReq.body.system;
      check('T38', '{{관리자피드백}} 없는 옛 프롬프트에도 지침 자동 추가', r.status === 200 && !oldSt.prompts.fit.includes('{{관리자피드백}}') && sysOld.trim().endsWith('브랜드별 실측 확인을 권해.') && sysOld.includes('[관리자 피드백 지침]'));
      r = await call('/api/admin/preview', { method:'POST', token:tk, body:{ data:cur.data, prompts:cur.prompts, settings:cur.settings } });
      check('T39', '미리보기에 지침 포함', r.json.text.includes('브랜드별 실측 확인을 권해'));
      r = await call('/api/admin/guidelines/Gdeadbeef', { method:'DELETE', token:tk }); check('T40', '없는 지침 삭제 시 404', r.status === 404);
      r = await call('/api/admin/guidelines/' + g1.id, { method:'DELETE', token:tk });
      const after = (await call('/api/admin/guidelines', { token:tk })).json.items.length;
      check('T41', '지침 삭제', r.status === 200 && after === 0);
      r = await call('/api/admin/guidelines/' + g1.id, { method:'PATCH', body:{ active:true } }); check('T42', '로그인 없이 지침 수정 차단', r.status === 401);
      st = (await call('/api/admin/state', { token:tk })).json; const v0 = JSON.parse(JSON.stringify(st)); v0.version = 0;
      r = await call('/api/admin/state', { method:'PUT', token:tk, body:v0 }); check('T43', '충돌 안내 시각 표시 정상(LD4)', r.status === 409 && !r.json.error.includes('( KST)'), r.json.error);

      /* ---- v3: 배포 대비 ---- */
      r = await call('/api/config'); check('T44', '설정 정보에 저장소 종류 표시(로컬=file)', r.json.storage === 'file' && !!r.json.storageLabel);
      process.env.RATE_LOGIN_PER_MIN = '3';
      const codes = []; for(let i = 0; i < 4; i++) codes.push((await call('/api/admin/login', { method:'POST', body:{ password:'x' } })).status);
      check('T45', '로그인 시도 횟수 제한(1분 3회 설정 → 4번째 429)', codes[3] === 429, codes.join(','));
      process.env.RATE_CHAT_PER_MIN = '1';
      const c1 = (await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'a' }] } })).status;
      const c2 = await call('/api/chat', { method:'POST', body:{ uid, messages:[{ role:'user', content:'b' }] } });
      check('T46', '대화 요청 횟수 제한 → 429 한국어 안내', c2.status === 429 && c2.json.error.includes('1분'), `${c1},${c2.status}`);
      delete process.env.RATE_CHAT_PER_MIN; delete process.env.RATE_LOGIN_PER_MIN;
    }catch(e){ check('ERR', '예외 발생', false, e.stack); }
    const pass = results.filter(x => x.pass).length;
    console.log(`\n합계 ${pass}/${results.length}`);
    server.close(); mock.close(); fs.rmSync(tmp, { recursive:true, force:true });
    process.exit(pass === results.length ? 0 : 1);
  });
});
