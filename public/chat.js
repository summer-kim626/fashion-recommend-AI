// 탭4: 의류 맞춤 추천 챗봇
(() => {
  const list = $('list'), form = $('chatForm'), input = $('chatInput'), sendBtn = $('sendBtn');
  const EMPTY = { gender:'', height:'', weight:'', age:'' };
  let profile = { ...EMPTY };
  let history = [];      // [{role, content}] — 서버가 최근 20개만 AI에 보냄
  let busy = false;
  let sessionId = null;  // 대화 기록(localStorage)용 세션 — 첫 질문 때 만들고, 대화 초기화하면 새로 시작

  // 이 브라우저를 구분하는 ID (사용자별 체형 정보 저장용)
  let uid;
  try{
    uid = localStorage.getItem('fit_uid');
    if(!uid){ uid = (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now() + Math.random().toString(16).slice(2)).replace(/[^a-zA-Z0-9-]/g, ''); localStorage.setItem('fit_uid', uid); }
  }catch(e){ uid = 'session-' + Date.now(); }

  /* ---------- 말풍선 ---------- */
  const scrollDown = () => { const box = list.parentElement; box.scrollTop = box.scrollHeight; };
  function addMsg(who, text){
    const row = document.createElement('div'); row.className = 'row ' + who;
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
    const time = document.createElement('span'); time.className = 'time'; time.textContent = nowTime();
    if(who === 'bot'){ const m = document.createElement('div'); m.className = 'mark'; m.textContent = '✦'; row.append(m, bubble, time); }
    else row.append(time, bubble);
    list.appendChild(row); scrollDown();
    return bubble;
  }
  function addTyping(){
    const row = document.createElement('div'); row.className = 'row bot';
    row.innerHTML = '<div class="mark">✦</div><div class="bubble typing"><span></span><span></span><span></span></div>';
    list.appendChild(row); scrollDown(); return row;
  }
  function addNotice(text, warn){
    const n = document.createElement('div'); n.className = 'notice' + (warn ? ' warn' : ''); n.textContent = text;
    list.appendChild(n); scrollDown();
  }
  function addChips(items){
    const wrap = document.createElement('div'); wrap.className = 'chips';
    items.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; b.onclick = () => ask(t); wrap.appendChild(b); });
    list.appendChild(wrap); scrollDown();
  }

  /* ---------- 내 정보 ---------- */
  function renderProfile(){
    const box = $('ptags'); box.innerHTML = '';
    [['성별', profile.gender], ['키', profile.height && profile.height + 'cm'], ['체중', profile.weight && profile.weight + 'kg'], ['연령대', profile.age]]
      .forEach(([label, val]) => { const t = document.createElement('span'); t.className = 'ptag' + (val ? '' : ' empty'); t.textContent = label + ' · ' + (val || '미설정'); box.appendChild(t); });
  }
  function fillForm(){ $('pGender').value = profile.gender; $('pHeight').value = profile.height; $('pWeight').value = profile.weight; $('pAge').value = profile.age; $('pError').textContent = ''; }
  async function loadProfile(){
    try{
      const r = await api('/api/profile?uid=' + encodeURIComponent(uid));
      if(r.profile) profile = { ...EMPTY, ...r.profile };
      $('saveState').textContent = '서버에 저장돼요 · 이 브라우저의 사용자 ID로 구분해요';
    }catch(e){ $('saveState').textContent = e.message; }
    renderProfile();
  }
  $('pEditBtn').onclick = () => { const f = $('pForm'); f.classList.toggle('open'); if(f.classList.contains('open')) fillForm(); };
  $('pCancel').onclick = () => $('pForm').classList.remove('open');
  $('pForm').addEventListener('submit', async e => {
    e.preventDefault();
    const next = { gender:$('pGender').value, height:$('pHeight').value.trim(), weight:$('pWeight').value.trim(), age:$('pAge').value };
    if(JSON.stringify(next) === JSON.stringify(profile)){ $('pForm').classList.remove('open'); return; }
    try{
      const r = await api('/api/profile', { method:'PUT', body:{ uid, profile:next } });   // 범위 검사는 서버에서
      profile = { ...EMPTY, ...r.profile }; renderProfile();
      $('pForm').classList.remove('open');
      addNotice('내 정보가 저장됐어요 · 다음 답변부터 반영돼요');
    }catch(err){ $('pError').textContent = err.message; }
  });

  /* ---------- 대화 ---------- */
  async function ask(text){
    text = String(text || '').trim();
    if(!text || busy) return;
    busy = true; sendBtn.disabled = true;
    addMsg('user', text);
    history.push({ role:'user', content:text });
    if(!sessionId) sessionId = ChatLog.startSession(uid);
    ChatLog.addMessage(sessionId, { role:'user', content:text });
    const typing = addTyping();
    const t0 = performance.now();
    try{
      // 서버가 답변 직전에 저장된 내 정보·관리자 지침을 읽어 지시문을 만들고, 주문 조회 도구도 서버에서 실행
      const r = await api('/api/chat', { method:'POST', body:{ uid, messages:history } });
      typing.remove();
      addMsg('bot', r.text);
      history.push({ role:'assistant', content:r.text });
      ChatLog.addMessage(sessionId, { role:'assistant', content:r.text, ms:Math.round(performance.now() - t0), profileUsed:r.profileUsed, guidelineIds:r.guidelineIds || [], model:r.model, toolCalls:r.toolCalls || [] });
    }catch(err){
      typing.remove();
      history.pop();
      addMsg('bot', err.message).classList.add('error');
      ChatLog.addMessage(sessionId, { role:'assistant', content:err.message, error:true, ms:Math.round(performance.now() - t0) });
    }finally{
      busy = false; sendBtn.disabled = false;
      if(ChatLog.lastError()) addNotice(ChatLog.lastError(), true);
    }
  }
  form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; input.style.height = 'auto'; ask(v); });
  input.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; });

  function start(){
    history = []; sessionId = null; list.innerHTML = '';
    addNotice('의류 맞춤 추천 · 내 정보를 읽고 답해요 · 대화는 이 브라우저에 기록돼 관리자가 품질 개선에 활용해요');
    addMsg('bot', '안녕하세요, 의류 맞춤 추천 봇이에요 👕\n위의 "정보 설정"에서 성별·키·체중·연령대를 넣어두면 사이즈와 코디를 맞춰 추천해 드려요.');
    addChips(['내 체형에 맞는 아우터 추천해줘', '청바지 사이즈 뭐 사야 돼?', '주문 배송 조회할래요']);
  }
  $('resetBtn').onclick = start;
  $('adminBtn').onclick = () => { location.hash = 'admin'; };

  (async () => {
    start(); renderProfile(); await loadProfile();
    try{
      const c = await api('/api/config');
      if(!c.hasApiKey){ addNotice('.env에 ANTHROPIC_API_KEY가 없어요. 키를 넣고 서버를 다시 켜 주세요.', true); }
      $('botStatus').textContent = '내 정보를 읽고 맞춰 답해요 · ' + c.model;
    }catch(e){ addNotice(e.message, true); }
    showView();
  })();
})();
