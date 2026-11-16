// Firestore 저장소 (Firebase 배포용). 서버(Admin SDK)만 읽고 쓰며, 브라우저 직접 접근은 firestore.rules로 막음
//  - config/state           : 상품·재고·주문·배송·프롬프트·배송비 설정 (+ version, updatedAt)
//  - profiles/{uid}         : 사용자 체형 정보
//  - guidelines/{id}        : 관리자 피드백 지침
//  - adminSessions/{hash}   : 관리자 로그인 세션 (토큰 원문은 저장하지 않고 해시만)
'use strict';

function createFirestoreStorage({ db, seed }){
  const stateRef = db.collection('config').doc('state');
  const clean = o => JSON.parse(JSON.stringify(o));   // undefined 제거 (Firestore는 undefined 저장 불가)

  return {
    kind:'firestore',
    label:'Firestore(config/state)',
    async getState(){
      return db.runTransaction(async tx => {
        const snap = await tx.get(stateRef);
        if(snap.exists) return snap.data();
        const st = { ...clean(seed), version:1, updatedAt:'' };   // 처음 실행이면 기본 데이터로 시작
        tx.set(stateRef, st);
        return st;
      });
    },
    async saveState(next, expectedVersion){
      return db.runTransaction(async tx => {
        const snap = await tx.get(stateRef);
        const cur = snap.exists ? snap.data() : { ...clean(seed), version:1, updatedAt:'' };
        if(cur.version !== expectedVersion) return { conflict:true, current:cur };
        const st = clean({ ...next, version: cur.version + 1 });
        tx.set(stateRef, st);
        return { state:st };
      });
    },
    async getProfile(uid){ const s = await db.collection('profiles').doc(uid).get(); return s.exists ? s.data() : null; },
    async setProfile(uid, p){ await db.collection('profiles').doc(uid).set(clean(p)); },
    async listGuidelines(){
      const qs = await db.collection('guidelines').get();
      return qs.docs.map(d => d.data()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
    },
    async putGuideline(g){ await db.collection('guidelines').doc(g.id).set(clean(g)); },
    async deleteGuideline(id){
      const ref = db.collection('guidelines').doc(id); const s = await ref.get();
      if(!s.exists) return false; await ref.delete(); return true;
    },
    async createSession(hash, exp){ await db.collection('adminSessions').doc(hash).set({ exp }); },
    async getSession(hash){ const s = await db.collection('adminSessions').doc(hash).get(); return s.exists ? s.data().exp : null; },
    async deleteSession(hash){ await db.collection('adminSessions').doc(hash).delete(); }
  };
}
module.exports = { createFirestoreStorage };
