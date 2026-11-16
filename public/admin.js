// 관리자 페이지: 비밀번호 확인·저장·검증은 모두 서버에서 함 (화면 계산은 미리보기용)
(() => {
  const S = { token:null, tab:'products', server:null, draft:null, dirty:false, pwHint:null };
  try{ S.token = sessionStorage.getItem('admin_token'); }catch(e){}
  const SIZES = ['S', 'M', 'L', 'XL'];
  const won = n => Number(n || 0).toLocaleString('ko-KR') + '원';
  const clone = o => JSON.parse(JSON.stringify(o));
  const nowKST = () => new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 16);

  /* ---------- 화면 계산 (서버 lib/prompt.js normalize와 같은 규칙) ---------- */
  function normalize(d, st){
    const pmap = Object.fromEntries(d.products.map(p => [p.id, p]));
    const old = Object.fromEntries(d.inventory.map(i => [i.id, i]));
    d.inventory = d.products.map(p => {
      const i = old[p.id] || { id:p.id, stock:{ S:0, M:0, L:0, XL:0 }, restock:'', asOf:'' };
      const total = SIZES.reduce((a, s) => a + (Number(i.stock[s]) || 0), 0);
      const status = total === 0 ? '품절' : (SIZES.some(s => !Number(i.stock[s])) || total < 15 ? '품절임박' : '정상');
      return { ...i, id:p.id, total, status };
    });
    d.orders = d.orders.map(o => {
      const subtotal = (Number(o.unitPrice) || 0) * (Number(o.qty) || 0);
      const recalc = o.shippingFee == null || o.subtotal !== subtotal;
      const shippingFee = recalc ? (subtotal >= st.freeThreshold ? 0 : st.baseFee) : o.shippingFee;
      return { ...o, productName: pmap[o.productId] ? pmap[o.productId].name : '(없는 상품)', subtotal, shippingFee, total: subtotal + shippingFee };
    });
    return d;
  }

  /* ---------- 표 정의: [키, 제목, 종류, 칸 너비] ---------- */
  const COLS = {
    products: [['id','상품ID','text','w-s'],['name','상품명','text','w-l'],['category','카테고리','text','w-s'],['gender','성별','select:공용|여성|남성'],
      ['price','판매가(원)','num'],['fit','핏','text','w-s'],['material','소재','text','w-l'],['colors','색상','text','w-m'],['sizes','사이즈','text','w-m']],
    inventory: [['id','상품ID','ro'],['_name','상품명','ro'],['S','S','stock'],['M','M','stock'],['L','L','stock'],['XL','XL','stock'],
      ['total','총재고','ro'],['status','재고상태','ro'],['restock','입고예정일','text','w-m'],['asOf','기준시각','ro']],
    orders: [['orderNo','주문번호','text','w-m'],['orderedAt','주문일시','text','w-m'],['customerId','고객ID','text','w-s'],['customerName','고객명','text','w-s'],
      ['productId','상품ID','text','w-s'],['productName','상품명','ro'],['size','사이즈','select:S|M|L|XL'],['color','색상','text','w-s'],
      ['unitPrice','단가(원)','num'],['qty','수량','num'],['subtotal','상품금액','ro'],['shippingFee','배송비','ro'],['total','결제금액','ro'],
      ['payment','결제수단','select:신용카드|카카오페이|네이버페이|토스페이|무통장입금'],['status','주문상태','select:배송준비중|출고완료|배송중|배송완료|반품 회수중|주문취소']],
    shipping: [['trackingNo','운송장번호','text','w-m'],['orderNo','주문번호','text','w-m'],['carrier','택배사','text','w-m'],
      ['status','배송상태','select:배송준비중|출고완료|배송중|배송완료|반품 회수중'],['shippedAt','출고일','text','w-m'],
      ['lastEvent','최근 위치·처리 내용','text','w-l'],['updatedAt','최근 업데이트','text','w-m'],['eta','도착(예정)일','text','w-m'],['note','비고','text','w-l']]
  };
  const LABEL = { products:'상품', inventory:'재고', orders:'주문', shipping:'배송', prompts:'정책·프롬프트' };
  const blankRow = {
    products: () => ({ id:'', name:'', category:'', gender:'공용', price:0, fit:'', material:'', colors:'', sizes:'S, M, L, XL' }),
    orders: () => ({ orderNo:'', orderedAt:nowKST(), customerId:'', customerName:'', productId:'', productName:'', size:'M', color:'', unitPrice:0, qty:1, subtotal:null, shippingFee:null, total:null, payment:'신용카드', status:'배송준비중' }),
    shipping: () => ({ trackingNo:'발급 전', orderNo:'', carrier:'', status:'배송준비중', shippedAt:'', lastEvent:'', updatedAt:nowKST(), eta:'', note:'' })
  };
  const HINT = {
    products:'상품을 추가하면 재고 표에 같은 상품ID가 자동으로 생겨요. 상품을 삭제하면 재고도 함께 지워져요.',
    inventory:'사이즈별 수량만 고치면 총재고·재고상태가 자동 계산돼요.',
    orders:() => `단가·수량을 고치거나 새 주문을 넣으면 배송비(${won(S.draft.settings.freeThreshold)} 이상 무료, 미만 ${won(S.draft.settings.baseFee)})가 자동 계산돼요. 기존 주문의 배송비는 설정을 바꿔도 유지돼요.`,
    shipping:'주문번호는 주문 표에 있는 번호와 같아야 챗봇이 조회할 수 있어요.',
    prompts:'{{이름}} 자리는 답변 직전에 실제 내용으로 바뀌어요. 칩을 누르면 커서 위치에 들어가요.'
  };

  /* ---------- 공통 ---------- */
  const msg = (t, k) => { const m = $('adMsg'); m.textContent = t || ''; m.className = 'ad-msg ' + (k || ''); };
  const setDirty = v => { S.dirty = v; $('adDirty').hidden = !v; };
  AdminLogs.init({ token: () => S.token, msg: (t, k) => msg(t, k), onAuthFail: e => onAuthFail(e), previewBody: () => S.draft });
  function storeLabel(){ $('adStore').textContent = S.server ? `서버 파일(data/store.json) · 버전 ${S.server.version}` + (S.server.updatedAt ? ` · 마지막 적용 ${S.server.updatedAt} (KST)` : ' · 아직 적용 기록 없음') : ''; }
  function takeServer(st){ S.server = st; S.draft = clone({ data:st.data, prompts:st.prompts, settings:st.settings }); setDirty(false); storeLabel(); }
  function onAuthFail(err){ if(err.status === 401){ S.token = null; try{ sessionStorage.removeItem('admin_token'); }catch(e){} showLogin(); msg(''); $('adPwErr').textContent = '로그인이 만료됐어요. 다시 로그인해 주세요.'; return true; } return false; }

  /* ---------- 로그인 ---------- */
  function showLogin(){ $('adLogin').hidden = false; $('adBody').hidden = true; setTimeout(() => $('adPw').focus(), 0); }
  async function enter(){
    try{
      takeServer(await api('/api/admin/state', { token:S.token }));
      $('adLogin').hidden = true; $('adBody').hidden = false; render();
    }catch(err){ if(!onAuthFail(err)) $('adPwErr').textContent = err.message; }
  }
  window.onAdminOpen = async () => {
    if(S.pwHint === null){ try{ const c = await api('/api/config'); S.pwHint = c.adminPasswordHint || ''; }catch(e){ S.pwHint = ''; } }
    $('adDemo').textContent = S.pwHint ? '데모용 비밀번호: ' + S.pwHint : '';
    if(S.token && !S.draft) enter(); else if(!S.token) showLogin();
  };
  $('adLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try{
      const r = await api('/api/admin/login', { method:'POST', body:{ password:$('adPw').value } });
      S.token = r.token; try{ sessionStorage.setItem('admin_token', r.token); }catch(_){}
      $('adPw').value = ''; $('adPwErr').textContent = ''; enter();
    }catch(err){ $('adPwErr').textContent = err.message; $('adPw').select(); }
  });
  $('adClose').onclick = () => {
    if(S.dirty){ msg('저장하지 않은 변경이 있어요. "적용"하거나 "새로 불러오기"로 취소해 주세요.', 'warn'); return; }
    location.hash = '';
  };
  $('adLogout').onclick = async () => {
    if(S.dirty){ msg('저장하지 않은 변경이 있어요. 먼저 적용하거나 새로 불러와 주세요.', 'warn'); return; }
    try{ await api('/api/admin/logout', { method:'POST', token:S.token }); }catch(e){}
    S.token = null; S.draft = null; try{ sessionStorage.removeItem('admin_token'); }catch(e){}
    location.hash = '';
  };

  /* ---------- 표 그리기 ---------- */
  function render(){
    const t = S.tab, isPr = t === 'prompts', isLog = t === 'logs' || t === 'guides';
    normalize(S.draft.data, S.draft.settings);
    document.querySelectorAll('.ad-tab').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
    $('adLogs').hidden = !isLog;
    ['adReload', 'adRestore', 'adApply'].forEach(id => { $(id).hidden = isLog; });
    $('adDirty').hidden = isLog || !S.dirty;
    if(isLog){
      $('adTableWrap').hidden = true; $('adPrompts').hidden = true; $('adAdd').hidden = true;
      $('adHint').textContent = t === 'logs'
        ? '이 브라우저에서 나눈 챗봇 대화가 여기 기록돼요(localStorage). 답변마다 👍/👎·코멘트를 남기고, 개선할 점은 "지침에 반영"으로 서버 지침에 추가하세요.'
        : '반영한 지침은 서버에 저장되고, 켜진 지침은 챗봇의 다음 답변부터 지시문에 들어가요. 표·프롬프트의 "적용" 버튼과는 별개로 바로 저장돼요.';
      AdminLogs.render(t, $('adLogs')).then(() => { $('adCount').textContent = AdminLogs.countLabel(t); });
      return;
    }
    $('adTableWrap').hidden = isPr; $('adPrompts').hidden = !isPr;
    $('adAdd').hidden = t === 'inventory' || isPr;
    $('adRestore').textContent = isPr ? '초기 프롬프트 불러오기' : '초기 데이터 불러오기';
    $('adHint').textContent = typeof HINT[t] === 'function' ? HINT[t]() : HINT[t];
    if(isPr){ $('adCount').textContent = '항목 4개'; renderPrompts(); return; }
    const d = S.draft.data, rows = d[t], cols = COLS[t];
    const pname = Object.fromEntries(d.products.map(p => [p.id, p.name]));
    const table = $('adTable'); table.innerHTML = '';
    const head = table.createTHead().insertRow();
    cols.forEach(([, label]) => { const th = document.createElement('th'); th.textContent = label; head.appendChild(th); });
    if(t !== 'inventory') head.appendChild(document.createElement('th'));
    const tb = table.createTBody();
    rows.forEach((row, ri) => {
      const tr = tb.insertRow();
      cols.forEach(([key, , type, w]) => {
        const td = tr.insertCell();
        const val = key === '_name' ? (pname[row.id] || '') : (type === 'stock' ? row.stock[key] : row[key]);
        if(type === 'ro'){ td.className = 'ro'; td.textContent = typeof val === 'number' ? val.toLocaleString('ko-KR') : (val ?? ''); return; }
        let el;
        if(type.startsWith('select:')){
          el = document.createElement('select');
          const opts = type.slice(7).split('|'); if(val && !opts.includes(val)) opts.unshift(val);
          opts.forEach(o => { const op = document.createElement('option'); op.textContent = o; el.appendChild(op); });
          el.value = val ?? '';
        }else{
          el = document.createElement('input');
          el.type = (type === 'num' || type === 'stock') ? 'number' : 'text';
          if(el.type === 'number'){ el.min = 0; el.step = 1; }
          if(w) el.className = w;
          el.value = val ?? '';
        }
        el.title = el.value;
        el.addEventListener('change', () => {
          let v = el.value;
          if(type === 'num' || type === 'stock') v = Math.max(0, Math.round(Number(v) || 0)); else v = v.trim();
          if(type === 'stock') row.stock[key] = v; else row[key] = v;
          setDirty(true); render();
        });
        td.appendChild(el);
      });
      if(t !== 'inventory'){
        const td = tr.insertCell(), del = document.createElement('button');
        del.type = 'button'; del.className = 'ad-del'; del.textContent = '삭제';
        del.onclick = () => { rows.splice(ri, 1); setDirty(true); render(); };
        td.appendChild(del);
      }
    });
    $('adCount').textContent = LABEL[t] + ' ' + rows.length + '건';
  }

  /* ---------- 정책·프롬프트 ---------- */
  const SECTIONS = [
    { key:'policy', title:'운영 정책', desc:'배송비, 교환·반품, 결제, 고객센터. 탭4 프롬프트의 {{운영정책}} 자리에 들어가요.', ph:['기본배송비','무료배송기준','도서산간추가','반품배송비'] },
    { key:'dataRules', title:'상품·주문 데이터 사용 원칙', desc:'추천·재고·주문 조회 규칙. {{데이터원칙}} 자리에 들어가요.', ph:['재고기준시각'] },
    { key:'fit', title:'탭4 의류 맞춤 추천 프롬프트', desc:'AI가 매 답변 전에 받는 지시문. 답변 직전에 사용자 정보·관리자 피드백 지침을 읽어 {{사용자정보}}·{{관리자피드백}}에 넣어요. ({{관리자피드백}}이 없으면 지침은 맨 끝에 자동으로 붙어요)', ph:['운영정책','데이터원칙','상품카탈로그','사용자정보'], opt:['관리자피드백'], preview:true }
  ];
  const SETTING_FIELDS = [['baseFee','기본 배송비'], ['freeThreshold','무료배송 기준 금액'], ['remoteExtra','제주·도서산간 추가'], ['returnFee','단순 변심 반품 왕복 배송비']];
  function renderPrompts(){
    const box = $('adPrompts'); box.innerHTML = '';
    // 배송비 설정
    const sc = document.createElement('div'); sc.className = 'pr-card';
    sc.innerHTML = '<div class="pr-title">배송비 설정 (숫자)</div><div class="pr-desc">여기 숫자가 ① 운영 정책 문구의 {{기본배송비}} 등 자리와 ② 새 주문의 배송비 계산에 함께 쓰여요.</div>';
    const grid = document.createElement('div'); grid.className = 'st-grid';
    SETTING_FIELDS.forEach(([k, label]) => {
      const f = document.createElement('label'); f.className = 'field'; f.textContent = label + ' (원)';
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.step = 100; inp.value = S.draft.settings[k];
      inp.addEventListener('change', () => { S.draft.settings[k] = Math.max(0, Math.round(Number(inp.value) || 0)); inp.value = S.draft.settings[k]; setDirty(true); });
      f.appendChild(inp); grid.appendChild(f);
    });
    sc.appendChild(grid); box.appendChild(sc);

    SECTIONS.forEach(sec => {
      const card = document.createElement('div'); card.className = 'pr-card';
      const h = document.createElement('div'); h.className = 'pr-title'; h.textContent = sec.title;
      const d = document.createElement('div'); d.className = 'pr-desc'; d.textContent = sec.desc;
      const chips = document.createElement('div'); chips.className = 'pr-chips';
      const ta = document.createElement('textarea'); ta.className = 'pr-text'; ta.spellcheck = false;
      ta.value = S.draft.prompts[sec.key] || '';
      ta.rows = Math.min(18, Math.max(5, ta.value.split('\n').length + 1));
      const warn = document.createElement('div'); warn.className = 'pr-warn';
      const upd = () => {
        const w = sec.ph.filter(p => !ta.value.includes('{{' + p + '}}')).map(p => `{{${p}}}가 없어서 AI에게 전달되지 않아요`);
        if(!ta.value.trim()) w.unshift('비어 있으면 적용할 수 없어요');
        warn.textContent = w.length ? '⚠ ' + w.join(' / ') : '';
      };
      ta.addEventListener('input', () => { S.draft.prompts[sec.key] = ta.value; setDirty(true); upd(); });
      sec.ph.concat(sec.opt || []).forEach(p => {
        const c = document.createElement('button'); c.type = 'button'; c.className = 'pr-chip'; c.textContent = '{{' + p + '}}'; c.title = '눌러서 커서 위치에 넣기';
        c.onclick = () => { ta.setRangeText(c.textContent, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); };
        chips.appendChild(c);
      });
      const tools = document.createElement('div'); tools.className = 'pr-tools';
      if(sec.preview){
        const pv = document.createElement('button'); pv.type = 'button'; pv.className = 'btn-ghost'; pv.textContent = 'AI가 받는 내용 미리보기';
        let pre = null;
        pv.onclick = async () => {
          if(pre){ pre.remove(); pre = null; pv.textContent = 'AI가 받는 내용 미리보기'; return; }
          try{
            const r = await api('/api/admin/preview', { method:'POST', token:S.token, body:S.draft });
            pre = document.createElement('pre'); pre.className = 'pr-preview';
            pre.textContent = `(예시 사용자: ${r.sampleProfile.gender} · ${r.sampleProfile.height}cm · ${r.sampleProfile.weight}kg · ${r.sampleProfile.age})\n\n` + r.text;
            card.appendChild(pre); pv.textContent = '미리보기 닫기';
          }catch(err){ if(!onAuthFail(err)) msg(err.message, 'err'); }
        };
        tools.appendChild(pv);
      }
      card.append(h, d, chips, ta, warn, tools); box.appendChild(card); upd();
    });
  }

  /* ---------- 버튼 ---------- */
  document.querySelectorAll('.ad-tab').forEach(b => b.onclick = () => { S.tab = b.dataset.t; msg(''); render(); });
  $('adAdd').onclick = () => { S.draft.data[S.tab].push(blankRow[S.tab]()); setDirty(true); render(); const w = $('adTableWrap'); w.scrollTop = w.scrollHeight; };
  $('adReload').onclick = async () => {
    try{ takeServer(await api('/api/admin/state', { token:S.token })); render(); msg('서버의 최신 데이터를 불러왔어요. 저장 안 된 변경은 버렸어요.'); }
    catch(err){ if(!onAuthFail(err)) msg(err.message, 'err'); }
  };
  $('adRestore').onclick = async () => {
    try{
      const def = await api('/api/admin/defaults', { token:S.token });
      if(S.tab === 'prompts'){ S.draft.prompts = def.prompts; S.draft.settings = def.settings; }
      else S.draft.data = def.data;
      setDirty(true); render(); msg('초기값을 불러왔어요. "적용"을 눌러야 챗봇에 반영돼요.', 'warn');
    }catch(err){ if(!onAuthFail(err)) msg(err.message, 'err'); }
  };
  $('adApply').onclick = async () => {
    const btn = $('adApply'); btn.disabled = true;
    try{
      const r = await api('/api/admin/state', { method:'PUT', token:S.token, body:{ ...S.draft, version:S.server.version } });
      takeServer(r); render();
      msg(`적용했어요 (${r.updatedAt} KST) · 챗봇의 다음 답변부터 반영돼요` + (r.warnings && r.warnings.length ? ' · 주의: ' + r.warnings.join(' / ') : ''), r.warnings && r.warnings.length ? 'warn' : 'ok');
    }catch(err){ if(!onAuthFail(err)) msg(err.message, 'err'); }
    finally{ btn.disabled = false; }
  };
  window.addEventListener('beforeunload', e => { if(S.dirty){ e.preventDefault(); e.returnValue = ''; } });
})();
