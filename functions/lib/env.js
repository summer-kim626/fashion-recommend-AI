// .env 파일을 읽어 process.env에 넣는다 (외부 패키지 없이)
'use strict';
const fs = require('fs');

function loadEnv(file){
  if(!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for(const raw of lines){
    const line = raw.trim();
    if(!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if(eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if(process.env[key] === undefined) process.env[key] = val;   // 이미 설정된 환경변수가 우선
  }
  return true;
}

module.exports = { loadEnv };
