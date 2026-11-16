// 관리자: 대화 기록 보기·피드백 남기기 / 피드백 지침 관리
// 대화 기록과 피드백은 이 브라우저의 localStorage(ChatLog), 지침은 서버(data/guidelines.json)에 저장
const AdminLogs = (() => {
  const st = { filter:'all', query:'', selected:null, guides:null, confirmClear:false };
  let ctx = null;   // { token, msg, onAuthFail, previewBody }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; };
  const btn = (cls, text, onclick) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = onclick; return b; };
  const call = async (path, opts = {}) => {
    try{ return await api(path, { ...opts, token:ctx.token() }); }
    catch(err){ if(!ctx.onAuthFail(err)) ctx.msg(err.message, 'err'); throw err; }
  };

  async function loadGuides(force){
    if(st.guides && !force) return st.guides;
    const r = await call('/api/admin/guidelines'); st.guides = r; return r;
  }
  const guideMap = () => Object.fromEntries(((st.guides && st.guides.items) || []).map(g => [g.id, g]));

  /* ---------- 대화를 "질문 → 답변" 쌍으로 ---------- */
  function pairs(session){
    const out = [];
    session.messages.forEach((m, i) => {
      if(m.role !== 'assistant') return;
      const q = [...session.messages.slice(0, i)].reverse().find(x => x.role === 'user');
      out.push({ q, a:m });
    });
    return out;
  }
  function sessionStats(s, fb){
    const ps = pairs(s);
    return { n:ps.length, good:ps.filter(p => (fb[p.a.id] || {}).rating === 'good').length, bad:ps.filter(p => (fb[p.a.id] || {}).rating === 'bad').length,
      none:ps.filter(p => !(fb[p.a.id] || {}).rating && !(fb[p.a.id] || {}).comment).length, err:ps.filter(p => p.a.error).length };
  }
  function matches(s, fb){
    const k = sessionStats(s, fb);
    if(st.filter === 'none' && !k.none) return false;
    if(st.filter === 'bad' && !k.bad) return false;
    if(st.filter === 'good' && !k.good) return false;
    if(st.filter === 'error' && !k.err) return false;
    if(st.query && !s.messages.some(m => m.content.includes(st.query))) return false;
    return true;
  }

  /* ---------- 대화 기록 탭 ---------- */
  async function renderLogs(box){
    await loadGuides().catch(() => {});
    const all = ChatLog.sessions().slice().reverse(), fb = ChatLog.feedbackAll();
    const totals = all.reduce((a, s) => { const k = sessionStats(s, fb); a.n += k.n; a.good += k.good; a.bad += k.bad; a.err += k.err; return a; }, { n:0, good:0, bad:0, err:0 });
    const applied = Object.values(fb).filter(f => f.guidelineId).length;
    box.innerHTML = '';

    // 요약·도구
    const top = el('div', 'lg-top');
    top.appendChild(el('div', 'lg-stats', `대화 ${all.length}건 · 답변 ${totals.n}개 · 👍 ${totals.good} · 👎 ${totals.bad} · 오류 ${totals.err} · 지침 반영 ${applied}건 · 저장 용량 약 ${ChatLog.sizeKB()}KB`));
    const filters = el('div', 'lg-filters');
    [['all','전체'], ['none','피드백 없음'], ['bad','👎 아쉬움'], ['good','👍 좋음'], ['error','오류']].forEach(([k, label]) => {
      const b = btn('lg-filter', label, () => { st.filter = k; renderLogs(box); });
      b.setAttribute('aria-pressed', st.filter === k); filters.appendChild(b);
    });
    const search = el('input', 'lg-search'); search.placeholder = '대화 내용 검색'; search.value = st.query;
    search.onchange = () => { st.query = search.value.trim(); renderLogs(box); };
    filters.appendChild(search);
    const tools = el('div', 'lg-tools');
    tools.appendChild(btn('btn-ghost', '내보내기(JSON)', () => {
      const blob = new Blob([ChatLog.exportJson()], { type:'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `챗봇_대화기록_${new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 10).replace(/-/g, '')}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }));
    tools.appendChild(btn('btn-ghost danger', st.confirmClear ? '한 번 더 누르면 전부 삭제' : '기록 전체 삭제', () => {
      if(!st.confirmClear){ st.confirmClear = true; renderLogs(box); setTimeout(() => { st.confirmClear = false; }, 4000); return; }
      ChatLog.clearAll(); st.confirmClear = false; st.selected = null; ctx.msg('대화 기록과 피드백을 모두 지웠어요. (서버에 반영된 지침은 그대로예요)', 'warn'); renderLogs(box);
    }));
    top.append(filters, tools);
    box.appendChild(top);

    const body = el('div', 'lg-body');
    const listEl = el('div', 'lg-list'), detail = el('div', 'lg-detail');
    const shown = all.filter(s => matches(s, fb));
    if(!shown.length) listEl.appendChild(el('div', 'lg-empty', all.length ? '조건에 맞는 대화가 없어요.' : '아직 대화 기록이 없어요. 챗봇 화면에서 대화하면 여기 쌓여요.'));
    if(!shown.some(s => s.id === st.selected)) st.selected = shown[0] ? shown[0].id : null;
    shown.forEach(s => {
      const k = sessionStats(s, fb);
      const firstQ = (s.messages.find(m => m.role === 'user') || {}).content || '(질문 없음)';
      const item = btn('lg-item' + (s.id === st.selected ? ' on' : ''), '', () => { st.selected = s.id; renderLogs(box); });
      item.append(el('div', 'lg-item-q', firstQ.length > 40 ? firstQ.slice(0, 40) + '…' : firstQ),
        el('div', 'lg-item-meta', `${s.startedAt.slice(5, 16)} · 답변 ${k.n} · ${k.none ? '미검토 ' + k.none : '검토 완료'}${k.bad ? ' · 👎' + k.bad : ''}${k.err ? ' · 오류' + k.err : ''}`));
      listEl.appendChild(item);
    });
    const sel = all.find(s => s.id === st.selected);
    if(sel) renderSession(detail, sel, fb); else detail.appendChild(el('div', 'lg-empty', '왼쪽에서 대화를 고르세요.'));
    body.append(listEl, detail);
    box.appendChild(body);
  }

  function renderSession(detail, s, fb){
    detail.appendChild(el('div', 'lg-detail-head', `대화 시작 ${s.startedAt} (KST) · 마지막 ${s.updatedAt.slice(11)} · 사용자 ID ${String(s.uid || '').slice(0, 8)}…`));
    const gmap = guideMap();
    pairs(s).forEach(({ q, a }, idx) => {
      const f = fb[a.id] || {};
      const card = el('div', 'qa' + (a.error ? ' qa-err' : '') + (f.rating === 'bad' ? ' qa-bad' : f.rating === 'good' ? ' qa-good' : ''));
      card.appendChild(el('div', 'qa-no', `#${idx + 1}`));
      card.appendChild(el('div', 'qa-q', 'Q. ' + (q ? q.content : '(질문 없음)')));
      card.appendChild(el('div', 'qa-a', a.content));
      const meta = [`${a.at.slice(11, 16)}`, a.ms ? `${(a.ms / 1000).toFixed(1)}초` : null,
        a.error ? '오류' : null,
        a.guidelineIds ? `지침 ${a.guidelineIds.length}개 적용` : null,
        (a.toolCalls || []).length ? '주문 조회 ' + a.toolCalls.map(t => `${t.input.orderNo || '?'}→${t.found === true ? '찾음' : t.found === false ? '없음' : '오류'}`).join(', ') : null,
        a.profileUsed ? '내 정보: ' + a.profileUsed.replace(/\n/g, ' · ') : null].filter(Boolean).join(' · ');
      card.appendChild(el('div', 'qa-meta', meta));
      if(a.guidelineIds && a.guidelineIds.length){
        const used = el('details', 'qa-used'); used.appendChild(el('summary', null, '이 답변에 적용된 지침 보기'));
        a.guidelineIds.forEach(id => used.appendChild(el('div', null, `· ${gmap[id] ? gmap[id].text : '(삭제된 지침 ' + id + ')'}`)));
        card.appendChild(used);
      }
      if(!a.error) card.appendChild(feedbackBox(s, q, a, f));
      detail.appendChild(card);
    });
  }

  function feedbackBox(s, q, a, f){
    const wrap = el('div', 'fb');
    const row = el('div', 'fb-row');
    const save = patch => { const r = ChatLog.setFeedback(a.id, patch); Object.assign(f, r || {}); };
    const good = btn('fb-rate' + (f.rating === 'good' ? ' on' : ''), '👍 좋아요', () => { save({ rating: f.rating === 'good' ? '' : 'good' }); refresh(); });
    const bad = btn('fb-rate' + (f.rating === 'bad' ? ' on bad' : ''), '👎 아쉬워요', () => { save({ rating: f.rating === 'bad' ? '' : 'bad' }); refresh(); });
    const savedAt = el('span', 'fb-saved', f.at ? '저장됨 ' + f.at.slice(5, 16) : '');
    row.append(good, bad, savedAt);
    const comment = el('textarea', 'fb-comment'); comment.rows = 2; comment.placeholder = '피드백 코멘트 (예: 첫 줄에 기준을 밝힌 건 좋은데, 사이즈 숫자가 다른 답변과 달라요)';
    comment.value = f.comment || '';
    comment.onchange = () => { save({ comment: comment.value.trim() }); savedAt.textContent = '저장됨 ' + (f.at || '').slice(5, 16); };
    const gRow = el('div', 'fb-grow');
    const gInput = el('input', 'fb-guide'); gInput.placeholder = '다음 답변부터 적용할 지침 한 문장 (예: 사이즈는 S=90, M=95, L=100, XL=105 기준으로만 안내해.)';
    gInput.maxLength = 300; gInput.value = f.guideline || '';
    gInput.onchange = () => save({ guideline: gInput.value.trim() });
    const draftBtn = btn('btn-ghost', 'AI로 지침 다듬기', async () => {
      if(!comment.value.trim()){ ctx.msg('먼저 피드백 코멘트를 적어 주세요.', 'warn'); comment.focus(); return; }
      save({ comment: comment.value.trim() });
      draftBtn.disabled = true; draftBtn.textContent = '다듬는 중…';
      try{
        const r = await call('/api/admin/guidelines/draft', { method:'POST', body:{ question: q ? q.content : '', answer: a.content, rating: f.rating, comment: comment.value.trim() } });
        gInput.value = r.text; save({ guideline: r.text }); ctx.msg('AI가 지침 문장을 만들었어요. 확인·수정한 뒤 "지침에 반영"을 누르세요.', 'ok');
      }catch(e){}
      finally{ draftBtn.disabled = false; draftBtn.textContent = 'AI로 지침 다듬기'; }
    });
    const applied = f.guidelineId && guideMap()[f.guidelineId];
    const applyBtn = btn('btn-main', applied ? '반영됨 ✓' : '지침에 반영', async () => {
      const text = gInput.value.trim();
      if(!text){ ctx.msg('지침 문장을 먼저 적어 주세요.', 'warn'); gInput.focus(); return; }
      applyBtn.disabled = true;
      try{
        const r = await call('/api/admin/guidelines', { method:'POST', body:{ text, source:{ sessionId:s.id, messageId:a.id, question: q ? q.content : '', answer:a.content, rating:f.rating || '', comment: comment.value.trim() } } });
        save({ guideline:text, guidelineId:r.item.id }); await loadGuides(true);
        ctx.msg(`지침에 반영했어요 (${r.item.id}) · 챗봇의 다음 답변부터 적용돼요`, 'ok'); refresh();
      }catch(e){ applyBtn.disabled = false; }
    });
    if(applied){ applyBtn.disabled = true; applyBtn.title = '이미 반영된 지침이에요. "피드백 지침" 탭에서 수정·끄기를 할 수 있어요.'; }
    gRow.append(gInput, draftBtn, applyBtn);
    wrap.append(row, comment, gRow);
    if(f.guidelineId && !applied) wrap.appendChild(el('div', 'fb-note', '반영했던 지침이 삭제됐어요. 다시 반영할 수 있어요.'));
    if(applied && !applied.active) wrap.appendChild(el('div', 'fb-note', '반영한 지침이 지금은 꺼져 있어요.'));
    function refresh(){ const box = document.getElementById('adLogs'); if(box) renderLogs(box); }
    return wrap;
  }

  /* ---------- 피드백 지침 탭 ---------- */
  async function renderGuides(box){
    box.innerHTML = '';
    let g; try{ g = await loadGuides(true); }catch(e){ return; }
    const items = g.items.slice().reverse();
    const activeN = items.filter(x => x.active).length;
    const head = el('div', 'gd-head');
    head.appendChild(el('div', 'lg-stats', `지침 ${items.length}개 · 켜짐 ${activeN}/${g.maxActive} · 켜진 지침은 매 답변 지시문의 [관리자 피드백 지침]에 순서대로 들어가요 (서버 data/guidelines.json)`));
    // 직접 추가
    const add = el('div', 'gd-add');
    const inp = el('input', 'fb-guide'); inp.placeholder = '지침 직접 추가 (예: 주문 조회 결과를 말할 때 택배사명은 데이터에 적힌 그대로 써.)'; inp.maxLength = g.maxText;
    add.append(inp, btn('btn-main', '추가', async () => {
      if(!inp.value.trim()) return;
      try{ await call('/api/admin/guidelines', { method:'POST', body:{ text:inp.value } }); ctx.msg('지침을 추가했어요 · 다음 답변부터 적용돼요', 'ok'); renderGuides(box); }catch(e){}
    }));
    head.appendChild(add);
    const pv = btn('btn-ghost', 'AI가 받는 지시문 미리보기', async () => {
      const old = box.querySelector('.pr-preview'); if(old){ old.remove(); pv.textContent = 'AI가 받는 지시문 미리보기'; return; }
      try{
        const r = await call('/api/admin/preview', { method:'POST', body:ctx.previewBody() });
        const pre = el('pre', 'pr-preview'); const k = r.text.lastIndexOf('[관리자 피드백 지침]');
        pre.textContent = k >= 0 ? '…(앞부분 생략)\n\n' + r.text.slice(k) : r.text;
        head.appendChild(pre); pv.textContent = '미리보기 닫기';
      }catch(e){}
    });
    head.appendChild(pv);
    box.appendChild(head);

    if(!items.length) box.appendChild(el('div', 'lg-empty', '아직 지침이 없어요. "대화 기록" 탭에서 답변에 피드백을 남기고 "지침에 반영"을 누르면 여기 쌓여요.'));
    items.forEach(it => {
      const card = el('div', 'gd-card' + (it.active ? '' : ' off'));
      const top = el('div', 'gd-top');
      const toggle = btn('gd-toggle' + (it.active ? ' on' : ''), it.active ? '켜짐' : '꺼짐', async () => {
        try{ await call('/api/admin/guidelines/' + it.id, { method:'PATCH', body:{ active:!it.active } }); renderGuides(box); }catch(e){}
      });
      top.append(toggle, el('span', 'gd-id', `${it.id} · 만든 날 ${it.createdAt} · 수정 ${it.updatedAt}`));
      const ta = el('textarea', 'fb-comment'); ta.rows = 2; ta.value = it.text; ta.maxLength = g.maxText;
      const actions = el('div', 'gd-actions');
      actions.appendChild(btn('btn-ghost', '문장 저장', async () => {
        try{ await call('/api/admin/guidelines/' + it.id, { method:'PATCH', body:{ text:ta.value } }); ctx.msg('지침을 수정했어요', 'ok'); renderGuides(box); }catch(e){}
      }));
      let armed = false;
      const del = btn('btn-ghost danger', '삭제', async () => {
        if(!armed){ armed = true; del.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { armed = false; del.textContent = '삭제'; }, 4000); return; }
        try{ await call('/api/admin/guidelines/' + it.id, { method:'DELETE' }); ctx.msg('지침을 삭제했어요', 'warn'); renderGuides(box); }catch(e){}
      });
      actions.appendChild(del);
      card.append(top, ta, actions);
      if(it.source && (it.source.question || it.source.comment)){
        const src = el('details', 'qa-used'); src.appendChild(el('summary', null, '이 지침을 만든 피드백 보기'));
        if(it.source.question) src.appendChild(el('div', null, 'Q. ' + it.source.question));
        if(it.source.answer) src.appendChild(el('div', 'gd-src-a', 'A. ' + it.source.answer));
        if(it.source.comment) src.appendChild(el('div', null, `피드백(${it.source.rating === 'bad' ? '👎' : it.source.rating === 'good' ? '👍' : '-'}): ${it.source.comment}`));
        card.appendChild(src);
      }
      box.appendChild(card);
    });
  }

  return {
    init(c){ ctx = c; },
    render(tab, box){ return tab === 'logs' ? renderLogs(box) : renderGuides(box); },
    countLabel(tab){ return tab === 'logs' ? `대화 ${ChatLog.sessions().length}건` : `지침 ${st.guides ? st.guides.items.length : '-'}개`; }
  };
})();
