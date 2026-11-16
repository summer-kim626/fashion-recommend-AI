// 파일 저장소 (로컬 실행용): DATA_DIR 폴더의 JSON 파일
//  - store.json: 상품·재고·주문·배송·프롬프트·배송비 설정 / profiles.json: 사용자 정보
//  - guidelines.json: 관리자 피드백 지침 / 관리자 세션은 메모리(서버 재시작 시 다시 로그인)
'use strict';
const fs = require('fs');
const path = require('path');

function createFileStorage({ dir, seed }){
  fs.mkdirSync(dir, { recursive:true });
  const F = n => path.join(dir, n);
  const read = (f, fb) => { try{ return JSON.parse(fs.readFileSync(F(f), 'utf8')); }catch(e){ return fb; } };
  const write = (f, obj) => { const tmp = F(f) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1)); fs.renameSync(tmp, F(f)); };
  const sessions = new Map();

  return {
    kind:'file',
    label:'서버 파일(data/store.json)',
    async getState(){
      let st = read('store.json', null);
      if(!st){ st = { ...JSON.parse(JSON.stringify(seed)), version:1, updatedAt:'' }; write('store.json', st); }
      return st;
    },
    // 버전이 맞을 때만 저장 (동시 편집 충돌 방지)
    async saveState(next, expectedVersion){
      const cur = await this.getState();
      if(cur.version !== expectedVersion) return { conflict:true, current:cur };
      const st = { ...next, version: cur.version + 1 };
      write('store.json', st);
      return { state:st };
    },
    async getProfile(uid){ return read('profiles.json', {})[uid] || null; },
    async setProfile(uid, p){ const all = read('profiles.json', {}); all[uid] = p; write('profiles.json', all); },
    async listGuidelines(){ return read('guidelines.json', { items:[] }).items; },
    async putGuideline(g){
      const db = read('guidelines.json', { items:[] });
      const i = db.items.findIndex(x => x.id === g.id);
      if(i >= 0) db.items[i] = g; else db.items.push(g);
      write('guidelines.json', db);
    },
    async deleteGuideline(id){
      const db = read('guidelines.json', { items:[] }); const n = db.items.length;
      db.items = db.items.filter(x => x.id !== id); write('guidelines.json', db);
      return db.items.length !== n;
    },
    async createSession(hash, exp){ sessions.set(hash, exp); },
    async getSession(hash){ return sessions.get(hash) || null; },
    async deleteSession(hash){ sessions.delete(hash); }
  };
}
module.exports = { createFileStorage };
