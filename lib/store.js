// 데이터 저장소: data/ 폴더의 JSON 파일
//  - seed.json     : 처음 데이터 (초기 데이터 불러오기에 사용, 수정하지 않음)
//  - store.json    : 관리자가 적용한 현재 데이터 (처음 실행 때 seed.json을 복사해 만듦)
//  - profiles.json : 탭4 사용자별 체형 정보
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');   // 테스트 때는 다른 폴더 사용
const SEED = path.join(__dirname, '..', 'data', 'seed.json');
const STORE = path.join(DIR, 'store.json');
const PROFILES = path.join(DIR, 'profiles.json');

const readJson = (f, fallback) => { try{ return JSON.parse(fs.readFileSync(f, 'utf8')); }catch(e){ return fallback; } };
function writeJson(f, obj){
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);   // 쓰는 도중 꺼져도 파일이 깨지지 않게 임시 파일 → 이름 바꾸기
}
const clone = o => JSON.parse(JSON.stringify(o));

function seed(){
  const s = readJson(SEED, null);
  if(!s) throw new Error('data/seed.json 파일이 없거나 깨졌어요.');
  return { data:s.data, prompts:s.prompts, settings:s.settings };
}

function load(){
  let st = readJson(STORE, null);
  if(!st){
    st = { ...seed(), version:1, updatedAt:'' };
    writeJson(STORE, st);
  }
  return st;
}

function save(next){ writeJson(STORE, next); return next; }

function getProfile(uid){ return (readJson(PROFILES, {})[uid]) || null; }
function setProfile(uid, profile){
  const all = readJson(PROFILES, {});
  all[uid] = profile;
  writeJson(PROFILES, all);
}

module.exports = { load, save, seed, getProfile, setProfile, clone };
