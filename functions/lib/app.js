// API 요청 처리 (로컬 server.js와 Firebase Cloud Functions가 함께 사용)
// createApp({ storage, seed }) → handle(req, res): /api/... 요청만 처리
'use strict';
const crypto = require('crypto');
const P = require('./prompt');
const { createGuidelines } = require('./guidelines');
const { chat, ClaudeError } = require('./claude');

const MAX_HISTORY = 20;                         // AI에 보내는 최근 대화 수 (길이·비용 제한)
const TOKEN_TTL = 8 * 60 * 60 * 1000;           // 관리자 로그인 유지 8시간
const UID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const nowKST = () => new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 16);
const clone = o => JSON.parse(JSON.stringify(o));
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const toSettings = s => Object.fromEntries(Object.entries(s || {}).map(([k, v]) => [k, Math.round(Number(v))]));

/* ---------- 요청 횟수 제한 (서버 인스턴스별, 1분 단위) ---------- */
// 공개 배포 시 API 비용 폭주·비밀번호 무작위 대입을 막는 1차 장치 (정밀한 전역 제한은 아님)
function createLimiter(){
  const hits = new Map();
  return (key, max) => {
    const now = Date.now(), win = 60000;
    const arr = (hits.get(key) || []).filter(t => now - t < win);
    if(arr.length >= max){ hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if(hits.size > 5000) for(const [k, v] of hits) if(!v.some(t => now - t < win)) hits.delete(k);
    return true;
  };
}
const limits = () => ({
  chat: Number(process.env.RATE_CHAT_PER_MIN) || 20,
  login: Number(process.env.RATE_LOGIN_PER_MIN) || 10,
  draft: Number(process.env.RATE_DRAFT_PER_MIN) || 10
});

/* ---------- 요청 본문 읽기: Cloud Functions(req.rawBody/req.body)와 로컬(스트림) 모두 지원 ---------- */
function readBody(req){
  if(req.rawBody !== undefined){
    const s = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody || '');
    if(!s) return Promise.resolve({});
    try{ return Promise.resolve(JSON.parse(s)); }catch(e){ return Promise.reject(new Error('bad_json')); }
  }
  if(req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if(size > 2 * 1024 * 1024){ reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try{ resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }catch(e){ reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
function send(res, status, obj){
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  res.end(JSON.stringify(obj));
}
function safeEqual(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

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

function createApp({ storage, seed }){
  const G = createGuidelines(storage);
  const allow = createLimiter();
  const adminPassword = () => process.env.ADMIN_PASSWORD || '1234';
  const showPw = () => (process.env.SHOW_ADMIN_PASSWORD || 'false') === 'true';

  async function isAdmin(req){
    const t = bearer(req); if(!t) return false;
    const exp = await storage.getSession(sha(t));
    if(!exp) return false;
    if(exp < Date.now()){ await storage.deleteSession(sha(t)); return false; }
    return true;
  }

  async function api(req, res, pathname, query){
    const m = req.method;
    const ip = clientIp(req);

    if(pathname === '/api/config' && m === 'GET'){
      return send(res, 200, { adminPasswordHint: showPw() ? adminPassword() : null, model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', hasApiKey: !!process.env.ANTHROPIC_API_KEY, storage: storage.kind, storageLabel: storage.label });
    }

    // 탭4 사용자 정보
    if(pathname === '/api/profile'){
      const body = m === 'PUT' ? await readBody(req) : {};
      const uid = String((m === 'GET' ? query.get('uid') : body.uid) || '');
      if(!UID_RE.test(uid)) return send(res, 400, { error:'사용자 ID가 올바르지 않아요.' });
      if(m === 'GET') return send(res, 200, { profile: await storage.getProfile(uid) });
      if(m === 'PUT'){
        const r = P.cleanProfile(body.profile || {});
        if(r.error) return send(res, 400, { error:r.error });
        await storage.setProfile(uid, r.profile);
        return send(res, 200, { profile:r.profile });
      }
    }

    // 탭4 대화
    if(pathname === '/api/chat' && m === 'POST'){
      if(!allow('chat:' + ip, limits().chat)) return send(res, 429, { error:'요청이 너무 많아요. 1분 뒤에 다시 시도해 주세요.' });
      const body = await readBody(req);
      const uid = String(body.uid || '');
      let msgs = Array.isArray(body.messages) ? body.messages : [];
      msgs = msgs.filter(x => (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && x.content.trim())
                 .map(x => ({ role:x.role, content:x.content.slice(0, 4000) }))
                 .slice(-MAX_HISTORY);
      while(msgs.length && msgs[0].role !== 'user') msgs.shift();
      if(!msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, 400, { error:'보낼 메시지가 없어요.' });
      // 답변 직전에 최신 데이터·내 정보·관리자 지침을 읽음
      const [st, profile, guidelines] = await Promise.all([storage.getState(), UID_RE.test(uid) ? storage.getProfile(uid) : null, G.active()]);
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

    // 관리자 로그인
    if(pathname === '/api/admin/login' && m === 'POST'){
      if(!allow('login:' + ip, limits().login)) return send(res, 429, { error:'로그인 시도가 너무 많아요. 1분 뒤에 다시 시도해 주세요.' });
      const { password } = await readBody(req);
      if(!safeEqual(password || '', adminPassword())) return send(res, 401, { error:'비밀번호가 틀렸어요.' });
      const token = crypto.randomBytes(24).toString('hex');
      await storage.createSession(sha(token), Date.now() + TOKEN_TTL);   // 토큰 원문이 아니라 해시만 저장
      return send(res, 200, { token });
    }

    if(pathname.startsWith('/api/admin/')){
      if(!(await isAdmin(req))) return send(res, 401, { error:'관리자 로그인이 필요해요.' });

      if(pathname === '/api/admin/logout' && m === 'POST'){ await storage.deleteSession(sha(bearer(req))); return send(res, 200, { ok:true }); }
      if(pathname === '/api/admin/state' && m === 'GET') return send(res, 200, await storage.getState());
      if(pathname === '/api/admin/defaults' && m === 'GET') return send(res, 200, clone(seed));

      if(pathname === '/api/admin/state' && m === 'PUT'){
        const body = await readBody(req);
        const settings = toSettings(body.settings);
        const data = P.normalize(clone(body.data || {}), settings);
        const prompts = body.prompts || {};
        const errs = P.validate(data, prompts, settings);
        if(errs.length) return send(res, 400, { error:'적용하지 못했어요 · ' + errs.slice(0, 3).join(' / ') + (errs.length > 3 ? ` 외 ${errs.length - 3}건` : ''), errors:errs });
        const cur = await storage.getState();
        const stamp = nowKST();
        const before = Object.fromEntries(cur.data.inventory.map(i => [i.id, JSON.stringify(i.stock)]));
        data.inventory.forEach(i => { if(before[i.id] !== JSON.stringify(i.stock) || !i.asOf) i.asOf = stamp; });
        const r = await storage.saveState({ data, prompts, settings, updatedAt:stamp }, body.version);   // 버전 비교는 저장소가 원자적으로
        if(r.conflict) return send(res, 409, { error:`다른 곳에서 먼저 적용했어요${r.current.updatedAt ? ` (${r.current.updatedAt} KST)` : ''}. "새로 불러오기"를 누른 뒤 다시 수정해 주세요.` });
        const warnings = Object.keys(P.PLACEHOLDERS).flatMap(k => P.promptWarnings(k, prompts[k]).map(w => `${k}: ${w}`));
        return send(res, 200, { ...r.state, warnings });
      }

      if(pathname === '/api/admin/preview' && m === 'POST'){
        const body = await readBody(req);
        const settings = toSettings(body.settings);
        const data = P.normalize(clone(body.data), settings);
        const sample = { gender:'남성', height:'175', weight:'70', age:'20대' };
        return send(res, 200, { text: P.buildFitPrompt({ prompts:body.prompts, settings, data, profile:sample, guidelines: await G.active() }), sampleProfile:sample });
      }

      /* ---- 관리자 피드백 지침 ---- */
      if(pathname === '/api/admin/guidelines' && m === 'GET') return send(res, 200, { items: await G.list(), maxActive:G.MAX_ACTIVE, maxText:G.MAX_TEXT });
      if(pathname === '/api/admin/guidelines' && m === 'POST'){
        const body = await readBody(req);
        const r = await G.add(body.text, body.source);
        return r.error ? send(res, 400, { error:r.error }) : send(res, 200, r);
      }
      // 피드백 코멘트를 AI가 짧은 지침 문장으로 다듬기 (저장은 하지 않음, 관리자가 확인 후 반영)
      if(pathname === '/api/admin/guidelines/draft' && m === 'POST'){
        if(!allow('draft:' + ip, limits().draft)) return send(res, 429, { error:'요청이 너무 많아요. 1분 뒤에 다시 시도해 주세요.' });
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
        const r = await G.update(gm[1], await readBody(req));
        return r.error ? send(res, r.status || 400, { error:r.error }) : send(res, 200, r);
      }
      if(gm && m === 'DELETE'){
        const r = await G.remove(gm[1]);
        return r.error ? send(res, r.status || 400, { error:r.error }) : send(res, 200, r);
      }
    }
    return send(res, 404, { error:'없는 주소예요.' });
  }

  // 공통 진입점: 예외를 한국어 오류로 바꿔 응답
  return async function handle(req, res){
    const url = new URL(req.originalUrl || req.url, 'http://localhost');
    try{ return await api(req, res, url.pathname, url.searchParams); }
    catch(e){
      console.error('[api]', e);
      const bad = e.message === 'bad_json' || e.message === 'too_large';
      if(!res.headersSent) send(res, bad ? 400 : 500, { error: e.message === 'bad_json' ? '요청 형식이 잘못됐어요.' : e.message === 'too_large' ? '요청이 너무 커요.' : '서버 오류가 났어요.' });
    }
  };
}

module.exports = { createApp };
