// 로컬 실행용 서버: node server.js  (Node.js 18 이상)
// 화면(public/)을 보여주고, /api/... 요청은 Firebase와 같은 코드(functions/lib/app.js)로 처리
// 데이터는 data/ 폴더의 JSON 파일에 저장 (Firebase 배포 때는 Firestore에 저장)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

require('./functions/lib/env').loadEnv(path.join(__dirname, '.env'));
if(process.env.SHOW_ADMIN_PASSWORD === undefined) process.env.SHOW_ADMIN_PASSWORD = 'true';   // 로컬은 기본으로 비밀번호 표시
const { createApp } = require('./functions/lib/app');
const { createFileStorage } = require('./functions/lib/storage/file');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';          // 기본: 내 컴퓨터에서만 접속 가능
const PUBLIC = path.join(__dirname, 'public');
const seed = (({ data, prompts, settings }) => ({ data, prompts, settings }))(JSON.parse(fs.readFileSync(path.join(__dirname, 'functions', 'data', 'seed.json'), 'utf8')));
const storage = createFileStorage({ dir: process.env.DATA_DIR || path.join(__dirname, 'data'), seed });
const handle = createApp({ storage, seed });

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.json':'application/json' };
function serveStatic(req, res, pathname){
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC, rel));
  if(!file.startsWith(PUBLIC + path.sep)){ res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404, { 'content-type':'application/json; charset=utf-8' }); return res.end('{"error":"not found"}'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if(pathname.startsWith('/api/')) return handle(req, res);
  if(req.method !== 'GET'){ res.writeHead(405); return res.end(); }
  return serveStatic(req, res, pathname);
});

if(require.main === module){
  storage.getState().then(() => server.listen(PORT, HOST, () => {
    console.log('\n  의류 맞춤 추천 챗봇이 켜졌어요 (로컬)');
    console.log(`  → 브라우저에서 열기: http://localhost:${PORT}`);
    console.log(`  → 모델: ${process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'}`);
    if(!process.env.ANTHROPIC_API_KEY) console.log('  ⚠ .env에 ANTHROPIC_API_KEY가 없어요. 화면은 열리지만 AI 답변은 안 돼요.');
    console.log('  → 끄기: 이 창에서 Ctrl + C\n');
  }));
}

module.exports = { server, storage };
