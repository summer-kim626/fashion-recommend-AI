// 관리자 피드백 지침: 검증 규칙 (저장은 storage가 담당 — 로컬은 파일, Firebase는 Firestore)
'use strict';
const crypto = require('crypto');
const MAX_TEXT = 300;
const MAX_ACTIVE = 30;
const nowKST = () => new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 16);

function cleanText(t){
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if(!s) return { error:'지침 문장이 비어 있어요.' };
  if(s.length > MAX_TEXT) return { error:`지침은 ${MAX_TEXT}자 이내로 써 주세요. (지금 ${s.length}자)` };
  return { text:s };
}
function cleanSource(src){
  if(!src || typeof src !== 'object') return null;
  const cut = (v, n) => String(v || '').slice(0, n);
  return { sessionId:cut(src.sessionId, 64), messageId:cut(src.messageId, 64), question:cut(src.question, 300), answer:cut(src.answer, 500), rating:cut(src.rating, 8), comment:cut(src.comment, 500) };
}

function createGuidelines(storage){
  return {
    MAX_TEXT, MAX_ACTIVE,
    list: () => storage.listGuidelines(),
    active: async () => (await storage.listGuidelines()).filter(g => g.active),
    async add(text, source){
      const c = cleanText(text); if(c.error) return c;
      const items = await storage.listGuidelines();
      if(items.filter(g => g.active).length >= MAX_ACTIVE) return { error:`켜진 지침이 ${MAX_ACTIVE}개를 넘을 수 없어요. 오래된 지침을 끄거나 합쳐 주세요.` };
      if(items.some(g => g.text === c.text)) return { error:'같은 지침이 이미 있어요.' };
      const g = { id:'G' + crypto.randomBytes(4).toString('hex'), text:c.text, active:true, createdAt:nowKST(), updatedAt:nowKST(), source:cleanSource(source) };
      await storage.putGuideline(g);
      return { item:g };
    },
    async update(id, patch){
      const items = await storage.listGuidelines(); const g = items.find(x => x.id === id);
      if(!g) return { error:'없는 지침이에요.', status:404 };
      if(patch.text !== undefined){ const c = cleanText(patch.text); if(c.error) return c; g.text = c.text; }
      if(patch.active !== undefined){
        const on = !!patch.active;
        if(on && !g.active && items.filter(x => x.active).length >= MAX_ACTIVE) return { error:`켜진 지침이 ${MAX_ACTIVE}개를 넘을 수 없어요.` };
        g.active = on;
      }
      g.updatedAt = nowKST(); await storage.putGuideline(g);
      return { item:g };
    },
    async remove(id){ return (await storage.deleteGuideline(id)) ? { ok:true } : { error:'없는 지침이에요.', status:404 }; }
  };
}
module.exports = { createGuidelines, MAX_TEXT, MAX_ACTIVE };
