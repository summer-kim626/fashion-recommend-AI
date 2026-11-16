// 프롬프트 조립, 데이터 계산(재고 상태·주문 금액), 검증
'use strict';

const SIZES = ['S', 'M', 'L', 'XL'];
const won = n => Number(n || 0).toLocaleString('ko-KR') + '원';

// {{이름}} 자리를 실제 내용으로 바꿈
const fillTpl = (tpl, vars) => String(tpl || '').replace(/\{\{(.+?)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

// 프롬프트마다 꼭 있어야 하는 자리
const PLACEHOLDERS = {
  policy:    ['기본배송비', '무료배송기준', '도서산간추가', '반품배송비'],
  dataRules: ['재고기준시각'],
  fit:       ['운영정책', '데이터원칙', '상품카탈로그', '사용자정보']
};
const PH_DESC = {
  기본배송비:'기본 배송비', 무료배송기준:'무료배송 기준', 도서산간추가:'도서산간 추가 금액', 반품배송비:'반품 왕복 배송비',
  재고기준시각:'재고 기준 시각', 운영정책:'운영 정책', 데이터원칙:'데이터 사용 원칙', 상품카탈로그:'상품+재고 목록', 사용자정보:'사용자 체형 정보'
};

const settingVars = st => ({ 기본배송비:won(st.baseFee), 무료배송기준:won(st.freeThreshold), 도서산간추가:won(st.remoteExtra), 반품배송비:won(st.returnFee) });
const calcFee = (subtotal, st) => subtotal >= st.freeThreshold ? 0 : st.baseFee;

// 재고 합계·상태, 주문 금액을 다시 맞춤
// 주문 배송비는 금액(단가×수량)이 바뀌었거나 새 주문일 때만 현재 설정으로 다시 계산 → 기존 주문 배송비는 유지
function normalize(d, st){
  const pmap = Object.fromEntries(d.products.map(p => [p.id, p]));
  const old = Object.fromEntries(d.inventory.map(i => [i.id, i]));
  d.inventory = d.products.map(p => {
    const i = old[p.id] || { id:p.id, stock:{ S:0, M:0, L:0, XL:0 }, restock:'', asOf:'' };
    const stock = Object.fromEntries(SIZES.map(s => [s, Math.max(0, Math.round(Number(i.stock && i.stock[s]) || 0))]));
    const total = SIZES.reduce((a, s) => a + stock[s], 0);
    const status = total === 0 ? '품절' : (SIZES.some(s => !stock[s]) || total < 15 ? '품절임박' : '정상');
    return { ...i, id:p.id, stock, total, status };
  });
  d.orders = d.orders.map(o => {
    const subtotal = (Number(o.unitPrice) || 0) * (Number(o.qty) || 0);
    const recalc = o.shippingFee == null || o.subtotal !== subtotal;
    const shippingFee = recalc ? calcFee(subtotal, st) : o.shippingFee;
    return { ...o, productName: pmap[o.productId] ? pmap[o.productId].name : '(없는 상품)', subtotal, shippingFee, total: subtotal + shippingFee };
  });
  return d;
}

function validate(d, prompts, settings){
  const errs = [];
  const dup = (arr, key, label, keyName) => {
    const seen = new Set();
    arr.forEach((r, i) => {
      const v = r[key];
      if(!v) errs.push(`${label} ${i + 1}번째 줄: ${keyName}가 비어 있어요`);
      else if(seen.has(v)) errs.push(`${label}: ${v}가 중복돼요`);
      seen.add(v);
    });
  };
  dup(d.products, 'id', '상품', '상품ID');
  dup(d.orders, 'orderNo', '주문', '주문번호');
  d.products.forEach(p => { if(!p.name) errs.push(`상품 ${p.id || '(ID 없음)'}: 상품명이 비어 있어요`); });
  const pids = new Set(d.products.map(p => p.id)), onos = new Set(d.orders.map(o => o.orderNo));
  d.orders.forEach(o => { if(o.productId && !pids.has(o.productId)) errs.push(`주문 ${o.orderNo}: 상품ID ${o.productId}가 상품 표에 없어요`); });
  d.shipping.forEach((s, i) => { if(!onos.has(s.orderNo)) errs.push(`배송 ${i + 1}번째 줄: 주문번호 ${s.orderNo || '(빈칸)'}가 주문 표에 없어요`); });
  if(prompts) Object.keys(PLACEHOLDERS).forEach(k => { if(!String(prompts[k] || '').trim()) errs.push(`프롬프트 '${k}'가 비어 있어요`); });
  if(settings) Object.values(settings).forEach(v => { if(!Number.isFinite(v) || v < 0) errs.push('배송비 설정에 올바르지 않은 값이 있어요'); });
  return errs;
}

function promptWarnings(key, text){
  return (PLACEHOLDERS[key] || []).filter(ph => !String(text || '').includes('{{' + ph + '}}'))
    .map(ph => `{{${ph}}}가 없어서 ${PH_DESC[ph]}이(가) AI에게 전달되지 않아요`);
}

function catalogText(d){
  const inv = Object.fromEntries(d.inventory.map(i => [i.id, i]));
  return d.products.map(p => {
    const i = inv[p.id] || { stock:{ S:0, M:0, L:0, XL:0 }, status:'품절', restock:'' };
    const st = SIZES.map(s => `${s} ${i.stock[s]}개`).join(', ');
    return `${p.id} | ${p.name} | ${p.category} | ${p.gender} | ${won(p.price)} | 핏 ${p.fit} | 소재 ${p.material} | 색상 ${p.colors} | 재고 ${st} | ${i.status}${i.restock ? ' (입고예정 ' + i.restock + ')' : ''}`;
  }).join('\n');
}

function profileText(p){
  if(!p) return '(설정된 정보 없음)';
  const parts = [];
  if(p.gender) parts.push('성별: ' + p.gender);
  if(p.height) parts.push('키: ' + p.height + 'cm');
  if(p.weight) parts.push('체중: ' + p.weight + 'kg');
  if(p.age) parts.push('연령대: ' + p.age);
  return parts.length ? parts.join('\n') : '(설정된 정보 없음)';
}

const stockAsOf = d => d.inventory.map(i => i.asOf).filter(Boolean).sort().pop() || '최근';

// 관리자 피드백 지침 → 지시문 문단
const GUIDE_HEAD = '[관리자 피드백 지침]\n관리자가 과거 답변을 검토하고 남긴 개선 지침이야. 답변할 때 반영해. 단, 위의 주제 제한·데이터 사용 원칙·주문 조회 원칙과 충돌하면 그 원칙을 우선해.';
function guidelinesText(list){
  if(!list || !list.length) return '(아직 등록된 지침 없음)';
  return list.map((g, i) => `${i + 1}. ${g.text}`).join('\n');
}

// 탭4 AI가 받는 최종 지시문
// 템플릿에 {{관리자피드백}} 자리가 없으면(이전 버전에서 저장한 프롬프트) 지침이 있을 때 맨 끝에 자동으로 붙임
function buildFitPrompt({ prompts, settings, data, profile, guidelines = [] }){
  const tpl = prompts.fit;
  const out = fillTpl(tpl, {
    운영정책: fillTpl(prompts.policy, settingVars(settings)),
    데이터원칙: fillTpl(prompts.dataRules, { 재고기준시각: stockAsOf(data) }),
    상품카탈로그: catalogText(data),
    사용자정보: profileText(profile),
    관리자피드백: guidelinesText(guidelines)
  });
  if(!String(tpl).includes('{{관리자피드백}}') && guidelines.length) return out + '\n\n' + GUIDE_HEAD + '\n' + guidelinesText(guidelines);
  return out;
}

// 프로필 값 정리·검증
function cleanProfile(b){
  const p = { gender:String(b.gender || ''), height:String(b.height || '').trim(), weight:String(b.weight || '').trim(), age:String(b.age || '') };
  if(p.gender && !['여성', '남성'].includes(p.gender)) return { error:'성별 값이 올바르지 않아요.' };
  if(p.height && !(Number(p.height) >= 100 && Number(p.height) <= 230)) return { error:'키는 100~230cm 사이로 입력해 주세요.' };
  if(p.weight && !(Number(p.weight) >= 25 && Number(p.weight) <= 200)) return { error:'체중은 25~200kg 사이로 입력해 주세요.' };
  if(p.age && !['10대', '20대', '30대', '40대', '50대', '60대 이상'].includes(p.age)) return { error:'연령대 값이 올바르지 않아요.' };
  return { profile:p };
}

module.exports = { SIZES, won, fillTpl, PLACEHOLDERS, settingVars, normalize, validate, promptWarnings, catalogText, profileText, guidelinesText, buildFitPrompt, cleanProfile };
