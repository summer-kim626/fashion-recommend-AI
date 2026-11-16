// 대화 기록·피드백 저장소 (브라우저 localStorage)
// - 같은 브라우저에서 연 챗봇 화면과 관리자 화면이 이 기록을 함께 씀
// - 다른 브라우저·다른 컴퓨터의 대화는 보이지 않음 (localStorage는 브라우저마다 따로 저장됨)
const ChatLog = (() => {
  const KEY = 'fit_chat_logs_v1';        // { sessions:[{ id, startedAt, updatedAt, uid, messages:[...] }] }
  const FB_KEY = 'fit_chat_feedback_v1'; // { [messageId]: { rating, comment, guideline, guidelineId, at } }
  const MAX_SESSIONS = 300;              // 오래된 대화부터 지움 (저장 공간 보호)
  const nowKST = () => new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 19);
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let lastError = '';

  const read = (k, fb) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } };
  function write(k, v){
    try{ localStorage.setItem(k, JSON.stringify(v)); lastError = ''; return true; }
    catch(e){
      // 저장 공간이 꽉 차면 오래된 대화를 지우고 한 번 더 시도
      if(k === KEY && v.sessions && v.sessions.length > 1){
        v.sessions.splice(0, Math.ceil(v.sessions.length / 5));
        try{ localStorage.setItem(k, JSON.stringify(v)); lastError = '저장 공간이 부족해 오래된 대화 기록 일부를 지웠어요.'; return true; }catch(_){}
      }
      lastError = '브라우저 저장 공간에 대화 기록을 저장하지 못했어요.'; return false;
    }
  }
  const db = () => { const d = read(KEY, null); return d && Array.isArray(d.sessions) ? d : { sessions:[] }; };

  function startSession(uid){
    const d = db();
    const s = { id:newId('S'), startedAt:nowKST(), updatedAt:nowKST(), uid, messages:[] };
    d.sessions.push(s);
    if(d.sessions.length > MAX_SESSIONS) d.sessions.splice(0, d.sessions.length - MAX_SESSIONS);
    write(KEY, d);
    return s.id;
  }
  function addMessage(sessionId, msg){
    const d = db(); const s = d.sessions.find(x => x.id === sessionId);
    if(!s) return null;
    const m = { id:newId('M'), at:nowKST(), ...msg };
    s.messages.push(m); s.updatedAt = m.at;
    write(KEY, d);
    return m.id;
  }
  const sessions = () => db().sessions;
  const feedbackAll = () => read(FB_KEY, {});
  function setFeedback(messageId, fb){
    const all = feedbackAll();
    if(fb === null) delete all[messageId];
    else all[messageId] = { ...(all[messageId] || {}), ...fb, at:nowKST() };
    write(FB_KEY, all);
    return all[messageId] || null;
  }
  function clearAll(){ try{ localStorage.removeItem(KEY); localStorage.removeItem(FB_KEY); }catch(e){} }
  function exportJson(){ return JSON.stringify({ exportedAt:nowKST(), sessions:sessions(), feedback:feedbackAll() }, null, 1); }
  function sizeKB(){ try{ return Math.round(((localStorage.getItem(KEY) || '').length + (localStorage.getItem(FB_KEY) || '').length) * 2 / 1024); }catch(e){ return 0; } }

  return { startSession, addMessage, sessions, feedbackAll, setFeedback, clearAll, exportJson, sizeKB, lastError: () => lastError, KEY, FB_KEY };
})();
