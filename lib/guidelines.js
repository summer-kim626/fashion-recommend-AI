// 관리자 피드백 지침: data/guidelines.json
// 관리자가 대화 기록을 보고 남긴 피드백 중 "지침에 반영"한 것만 여기 저장되고,
// 켜져 있는(active) 지침은 매 답변 지시문에 자동으로 들어감
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'guidelines.json');
const MAX_TEXT = 300;
const MAX_ACTIVE = 30;
const nowKST = () => new Date().toLocaleString('sv-SE', { timeZone:'Asia/Seoul' }).slice(0, 16);

function read(){ try{ return JSON.parse(fs.readFileSync(FILE, 'utf8')); }catch(e){ return { items:[] }; } }
function write(obj){ const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1)); fs.renameSync(tmp, FILE); }

function cleanText(t){
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if(!s) return { error:'지침 문장이 비어 있어요.' };
  if(s.length > MAX_TEXT) return { error:`지침은 ${MAX_TEXT}자 이내로 써 주세요. (지금 ${s.length}자)` };
  return { text:s };
}
// 출처: 어떤 대화의 어떤 답변을 보고 만든 지침인지 (질문·답변 일부와 피드백)
function cleanSource(src){
  if(!src || typeof src !== 'object') return null;
  const cut = (v, n) => String(v || '').slice(0, n);
  return { sessionId:cut(src.sessionId, 64), messageId:cut(src.messageId, 64), question:cut(src.question, 300), answer:cut(src.answer, 500), rating:cut(src.rating, 8), comment:cut(src.comment, 500) };
}

const list = () => read().items;
const active = () => list().filter(g => g.active);

function add(text, source){
  const c = cleanText(text); if(c.error) return c;
  const db = read();
  if(db.items.filter(g => g.active).length >= MAX_ACTIVE) return { error:`켜진 지침이 ${MAX_ACTIVE}개를 넘을 수 없어요. 오래된 지침을 끄거나 합쳐 주세요.` };
  if(db.items.some(g => g.text === c.text)) return { error:'같은 지침이 이미 있어요.' };
  const g = { id:'G' + crypto.randomBytes(4).toString('hex'), text:c.text, active:true, createdAt:nowKST(), updatedAt:nowKST(), source:cleanSource(source) };
  db.items.push(g); write(db);
  return { item:g };
}
function update(id, patch){
  const db = read(); const g = db.items.find(x => x.id === id);
  if(!g) return { error:'없는 지침이에요.', status:404 };
  if(patch.text !== undefined){ const c = cleanText(patch.text); if(c.error) return c; g.text = c.text; }
  if(patch.active !== undefined){
    const on = !!patch.active;
    if(on && !g.active && db.items.filter(x => x.active).length >= MAX_ACTIVE) return { error:`켜진 지침이 ${MAX_ACTIVE}개를 넘을 수 없어요.` };
    g.active = on;
  }
  g.updatedAt = nowKST(); write(db);
  return { item:g };
}
function remove(id){
  const db = read(); const n = db.items.length;
  db.items = db.items.filter(x => x.id !== id);
  if(db.items.length === n) return { error:'없는 지침이에요.', status:404 };
  write(db); return { ok:true };
}

module.exports = { list, active, add, update, remove, MAX_TEXT, MAX_ACTIVE };
