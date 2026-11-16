// 공통 도우미
const $ = id => document.getElementById(id);
const nowTime = () => new Date().toLocaleTimeString('ko-KR', { hour:'numeric', minute:'2-digit', timeZone:'Asia/Seoul' });

// 서버 API 호출: 실패하면 서버가 보낸 한국어 오류 문구로 예외
async function api(path, { method = 'GET', body, token } = {}){
  const headers = { 'content-type':'application/json' };
  if(token) headers.authorization = 'Bearer ' + token;
  let res;
  try{ res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch(e){ const err = new Error('서버에 연결하지 못했어요. 터미널에서 서버가 켜져 있는지 확인해 주세요.'); err.status = 0; throw err; }
  const json = await res.json().catch(() => ({}));
  if(!res.ok){ const err = new Error(json.error || ('오류 ' + res.status)); err.status = res.status; err.data = json; throw err; }
  return json;
}

// 화면 전환: 주소 끝이 #admin이면 관리자 화면
function showView(){
  const admin = location.hash === '#admin';
  $('chatView').hidden = admin;
  $('adminView').hidden = !admin;
  if(admin && window.onAdminOpen) window.onAdminOpen();
}
window.addEventListener('hashchange', showView);
