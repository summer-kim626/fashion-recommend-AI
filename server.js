// 의류 맞춤 추천 챗봇(탭4) + 관리자 페이지 — 로컬 서버
// 실행: node server.js  (Node.js 18 이상, 별도 설치 패키지 없음)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('./lib/env').loadEnv(path.join(__dirname, '.env'));
const store = require('./lib/store');
const P = require('./lib/prompt');
const G = require('./lib/guidelines');
const { chat, ClaudeError } = require('./lib/claude');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';          // 기본: 내 컴퓨터에서만 접속 가능
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';
const SHOW_PW = (process.env.SHOW_ADMIN_PASSWORD || 'true') !== 'false';
const MAX_HISTORY = 20;                                 // AI에 보내는 최근 대화 수 (길이·비용 제한)
const PUBLIC = path.join(__dirname, 'public');

const nowKST = () => new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 16);

/* ---------- 공통 도우미 ---------- */
function send(res, status, obj){
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if(size > 2 * 1024 * 1024){ reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try{ resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }catch(e){ reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
function serveStatic(req, res, pathname){
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC, rel));
  if(!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error:'forbidden' });
  fs.readFile(file, (err, buf) => {
    if(err) return send(res, 404, { error:'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-cache' });
    res.end(buf);
  });
}

/* ---------- 관리자 로그인 (서버에서 비밀번호 확인, 토큰 발급) ---------- */
const tokens = new Map();   // token → 만료 시각
const TOKEN_TTL = 8 * 60 * 60 * 1000;
function safeEqual(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function isAdmin(req){
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const exp = tokens.get(t);
  if(!exp) return false;
  if(exp < Date.now()){ tokens.delete(t); return false; }
  return true;
}

/* ---------- 주문 조회 도구: 서버에서 실행 (주문 데이터는 브라우저로 가지 않음) ---------- */
function orderTool(data){
  return {
    name:'lookup_order',
    description:'주문번호와 주문자 이름으로 주문 내역과 배송 추적 정보를 조회한다. 둘 다 일치해야 결과를 준다. 사용자가 둘 다 알려준 뒤에만 호출한다.',
    input_schema:{
      type:'object',
      properties:{
        orderNo:{ type:'string', description:'주문번호, 예: MO-20261113-0006' },
        customerName:{ type:'string', description:'주문자 이름' }
      },
      required:['orderNo', 'customerName']
    },
    run: ({ orderNo, customerName }) => {
      const no = String(orderNo || '').trim().toUpperCase();
      const name = String(customerName || '').replace(/\s/g, '');
      const o = data.orders.find(x => x.orderNo === no);
      if(!o || o.customerName !== name) return { found:false, message:'주문번호와 주문자 이름이 일치하는 주문이 없음' };
      const { customerId, ...order } = o;
      return { found:true, order, shipping: data.shipping.find(x => x.orderNo === no) || null };
    }
  };
}

/* ---------- API ---------- */
async function api(req, res, pathname, query){
  const m = req.method;

  if(pathname === '/api/config' && m === 'GET'){
    return send(res, 200, { adminPasswordHint: SHOW_PW ? ADMIN_PASSWORD : null, model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
  }

  // 탭4 사용자 정보
  if(pathname === '/api/profile'){
    const body = m === 'PUT' ? await readBody(req) : {};
    const uid = String((m === 'GET' ? query.get('uid') : body.uid) || '');
    if(!/^[a-zA-Z0-9-]{8,64}$/.test(uid)) return send(res, 400, { error:'사용자 ID가 올바르지 않아요.' });
    if(m === 'GET') return send(res, 200, { profile: store.getProfile(uid) });
    if(m === 'PUT'){
      const r = P.cleanProfile(body.profile || {});
      if(r.error) return send(res, 400, { error:r.error });
      store.setProfile(uid, r.profile);
      return send(res, 200, { profile:r.profile });
    }
  }

  // 탭4 대화
  if(pathname === '/api/chat' && m === 'POST'){
    const body = await readBody(req);
    const uid = String(body.uid || '');
    let msgs = Array.isArray(body.messages) ? body.messages : [];
    msgs = msgs.filter(x => (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && x.content.trim())
               .map(x => ({ role:x.role, content:x.content.slice(0, 4000) }))
               .slice(-MAX_HISTORY);
    while(msgs.length && msgs[0].role !== 'user') msgs.shift();
    if(!msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, 400, { error:'보낼 메시지가 없어요.' });
    const st = store.load();
    const profile = /^[a-zA-Z0-9-]{8,64}$/.test(uid) ? store.getProfile(uid) : null;   // 답변 직전에 최신 정보 읽기
    const guidelines = G.active();                                                       // 관리자 피드백 지침도 매번 최신으로
    const system = P.buildFitPrompt({ prompts:st.prompts, settings:st.settings, data:st.data, profile, guidelines });
    const t0 = Date.now();
    try{
      const out = await chat({ system, messages:msgs, tools:[orderTool(st.data)] });
      return send(res, 200, { text:out.text, profileUsed: P.profileText(profile), guidelineIds: guidelines.map(g => g.id), model: out.model || null, toolCalls: out.toolCalls || [], serverMs: Date.now() - t0 });
    }catch(e){
      const status = e instanceof ClaudeError ? (e.status || 500) : 500;
      console.error('[chat]', e.message);
      return send(res, status >= 400 && status < 600 ? status : 500, { error:e.message });
    }
  }

  // 관리자
  if(pathname === '/api/admin/login' && m === 'POST'){
    const { password } = await readBody(req);
    if(!safeEqual(password || '', ADMIN_PASSWORD)) return send(res, 401, { error:'비밀번호가 틀렸어요.' });
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + TOKEN_TTL);
    return send(res, 200, { token });
  }
  if(pathname.startsWith('/api/admin/')){
    if(!isAdmin(req)) return send(res, 401, { error:'관리자 로그인이 필요해요.' });

    if(pathname === '/api/admin/logout' && m === 'POST'){
      tokens.delete((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      return send(res, 200, { ok:true });
    }
    if(pathname === '/api/admin/state' && m === 'GET') return send(res, 200, store.load());
    if(pathname === '/api/admin/defaults' && m === 'GET') return send(res, 200, store.seed());

    if(pathname === '/api/admin/state' && m === 'PUT'){
      const body = await readBody(req);
      const cur = store.load();
      if(body.version !== cur.version)   // 동시 편집 충돌 방지
        return send(res, 409, { error:`다른 곳에서 먼저 적용했어요${cur.updatedAt ? ` (${cur.updatedAt} KST)` : ''}. "새로 불러오기"를 누른 뒤 다시 수정해 주세요.` });
      const settings = Object.fromEntries(Object.entries(body.settings || {}).map(([k, v]) => [k, Math.round(Number(v))]));
      const data = P.normalize(store.clone(body.data || {}), settings);
      const prompts = body.prompts || {};
      const errs = P.validate(data, prompts, settings);
      if(errs.length) return send(res, 400, { error:'적용하지 못했어요 · ' + errs.slice(0, 3).join(' / ') + (errs.length > 3 ? ` 외 ${errs.length - 3}건` : ''), errors:errs });
      const stamp = nowKST();
      const before = Object.fromEntries(cur.data.inventory.map(i => [i.id, JSON.stringify(i.stock)]));
      data.inventory.forEach(i => { if(before[i.id] !== JSON.stringify(i.stock) || !i.asOf) i.asOf = stamp; });
      const next = store.save({ data, prompts, settings, version: cur.version + 1, updatedAt: stamp });
      const warnings = Object.keys(P.PLACEHOLDERS).flatMap(k => P.promptWarnings(k, prompts[k]).map(w => `${k}: ${w}`));
      return send(res, 200, { ...next, warnings });
    }

    if(pathname === '/api/admin/preview' && m === 'POST'){
      const body = await readBody(req);
      const settings = Object.fromEntries(Object.entries(body.settings || {}).map(([k, v]) => [k, Math.round(Number(v))]));
      const data = P.normalize(store.clone(body.data), settings);
      const sample = { gender:'남성', height:'175', weight:'70', age:'20대' };
      return send(res, 200, { text: P.buildFitPrompt({ prompts:body.prompts, settings, data, profile:sample, guidelines:G.active() }), sampleProfile:sample });
    }

    /* ---- 관리자 피드백 지침 ---- */
    if(pathname === '/api/admin/guidelines' && m === 'GET') return send(res, 200, { items:G.list(), maxActive:G.MAX_ACTIVE, maxText:G.MAX_TEXT });
    if(pathname === '/api/admin/guidelines' && m === 'POST'){
      const body = await readBody(req);
      const r = G.add(body.text, body.source);
      return r.error ? send(res, 400, { error:r.error }) : send(res, 200, r);
    }
    // 피드백 코멘트를 AI가 짧은 지침 문장으로 다듬기 (저장은 하지 않음, 관리자가 확인 후 반영)
    if(pathname === '/api/admin/guidelines/draft' && m === 'POST'){
      const b = await readBody(req);
      const cut = (v, n) => String(v || '').slice(0, n);
      if(!String(b.comment || '').trim()) return send(res, 400, { error:'먼저 피드백 코멘트를 적어 주세요.' });
      const system = '너는 쇼핑몰 챗봇의 지시문을 다듬는 편집자야. 관리자의 피드백을, 앞으로 모든 답변에 적용할 일반 규칙 한 문장으로 바꿔. 특정 고객 이름·주문번호·개인정보는 넣지 마. "~해." 같은 반말 지시형, 120자 이내, 한 문장만 출력해. 다른 말은 쓰지 마.';
      const content = `[고객 질문]\n${cut(b.question, 500)}\n\n[챗봇 답변]\n${cut(b.answer, 1500)}\n\n[관리자 평가] ${b.rating === 'bad' ? '아쉬움' : b.rating === 'good' ? '좋음' : '없음'}\n[관리자 피드백]\n${cut(b.comment, 500)}`;
      try{
        const out = await chat({ system, messages:[{ role:'user', content }] });
        return send(res, 200, { text: out.text.replace(/\s+/g, ' ').trim().slice(0, G.MAX_TEXT) });
      }catch(e){ return send(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { error:e.message }); }
    }
    const gm = pathname.match(/^\/api\/admin\/guidelines\/(G[0-9a-f]{8})$/);
    if(gm && m === 'PATCH'){
      const r = G.update(gm[1], await readBody(req));
      return r.error ? send(res, r.status || 400, { error:r.error }) : send(res, 200, r);
    }
    if(gm && m === 'DELETE'){
      const r = G.remove(gm[1]);
      return r.error ? send(res, r.status || 400, { error:r.error }) : send(res, 200, r);
    }
  }
  return send(res, 404, { error:'없는 주소예요.' });
}

/* ---------- 서버 시작 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try{
    if(url.pathname.startsWith('/api/')) return await api(req, res, url.pathname, url.searchParams);
    if(req.method !== 'GET') return send(res, 405, { error:'method not allowed' });
    return serveStatic(req, res, url.pathname);
  }catch(e){
    console.error('[server]', e);
    const msg = e.message === 'bad_json' ? '요청 형식이 잘못됐어요.' : e.message === 'too_large' ? '요청이 너무 커요.' : '서버 오류가 났어요.';
    if(!res.headersSent) send(res, e.message === 'bad_json' || e.message === 'too_large' ? 400 : 500, { error:msg });
  }
});

if(require.main === module){
  store.load();   // 처음 실행이면 data/store.json 생성
  server.listen(PORT, HOST, () => {
    console.log('\n  의류 맞춤 추천 챗봇이 켜졌어요');
    console.log(`  → 브라우저에서 열기: http://localhost:${PORT}`);
    console.log(`  → 모델: ${process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'}`);
    if(!process.env.ANTHROPIC_API_KEY) console.log('  ⚠ .env에 ANTHROPIC_API_KEY가 없어요. 화면은 열리지만 AI 답변은 안 돼요.');
    console.log('  → 끄기: 이 창에서 Ctrl + C\n');
  });
}

module.exports = { server };
