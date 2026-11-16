// Firebase Cloud Functions 진입점
// Hosting의 /api/** 요청이 이 함수(api)로 연결됨 (firebase.json의 rewrites)
// API 키·관리자 비밀번호는 Secret Manager에서 꺼내 씀 → 코드·깃허브에 비밀 값이 남지 않음
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const seedFile = require('./data/seed.json');
const { createApp } = require('./lib/app');
const { createFirestoreStorage } = require('./lib/storage/firestore');

// 비밀 값: firebase functions:secrets:set ANTHROPIC_API_KEY / ADMIN_PASSWORD 로 등록
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const ADMIN_PASSWORD = defineSecret('ADMIN_PASSWORD');

initializeApp();
const seed = { data:seedFile.data, prompts:seedFile.prompts, settings:seedFile.settings };
const storage = createFirestoreStorage({ db: getFirestore(), seed });
const handle = createApp({ storage, seed });

exports.api = onRequest({
  region: 'asia-northeast3',          // 서울 리전
  secrets: [ANTHROPIC_API_KEY, ADMIN_PASSWORD],
  timeoutSeconds: 120,                // Claude 답변 + 주문 조회 도구 시간 여유
  memory: '256MiB',
  maxInstances: 5,                    // 비용 폭주 방지: 동시에 켜지는 서버 수 상한
  cors: false                         // 같은 Hosting 도메인에서만 호출
}, (req, res) => {
  // 공용 코드(lib/claude.js, lib/app.js)는 process.env에서 값을 읽으므로 비밀 값을 넘겨줌
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY.value();
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD.value();
  return handle(req, res);
});
