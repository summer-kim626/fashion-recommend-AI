# 의류 맞춤 추천 AI 챗봇 + 관리자 페이지 (v3 · Firebase 배포 지원)

성별·키·체중·연령대를 바탕으로 의류 사이즈와 코디를 추천하는 쇼핑몰 AI 챗봇과, 상품·재고·주문·프롬프트를 관리하고 대화를 검토해 **답변을 계속 개선하는 관리자 페이지**입니다. AI는 Claude API를 사용합니다.

- 상품·재고·주문·배송 데이터는 모두 **가상 데이터**입니다.
- 같은 코드를 **① 내 컴퓨터(로컬)** 와 **② Firebase(인터넷 배포)** 두 방식으로 실행할 수 있습니다.

| | 로컬 실행 | Firebase 배포 |
|---|---|---|
| 화면 | `node server.js`가 `public/` 제공 | Firebase Hosting |
| 서버 API | `server.js` → `functions/lib/app.js` | Cloud Functions(`api`, 서울 리전) → `functions/lib/app.js` |
| 데이터 저장 | `data/*.json` 파일 | Firestore |
| API 키·관리자 비밀번호 | `.env` 파일 | **Secret Manager** (코드·깃허브에 남지 않음) |
| 관리자 비밀번호 화면 표시 | 기본 표시 | 기본 숨김 |

---

## 주요 기능

- **의류 맞춤 추천 챗봇:** 답변 직전에 사용자 정보·상품 카탈로그·재고·운영 정책·관리자 지침을 읽어 답변. 주문 조회는 서버의 조회 도구가 주문번호+이름이 모두 맞을 때만 결과 반환.
- **관리자 페이지:** 상품·재고·주문·배송 표 편집(자동 계산·검증·동시 편집 충돌 방지), 배송비 숫자 설정, 운영 정책·AI 프롬프트 편집과 미리보기.
- **대화 기록·피드백·지침:** 대화가 브라우저(localStorage)에 기록되고, 관리자가 답변마다 👍/👎·코멘트를 남긴 뒤 "지침에 반영"하면 서버에 저장되어 다음 답변부터 AI 지시문에 들어갑니다.

```
사용자 대화 → 대화 기록(브라우저) → 관리자 피드백 → (AI로 지침 다듬기) → 지침에 반영(서버)
            → 다음 답변 지시문 [관리자 피드백 지침]에 자동 포함 → 다시 검토
```

---

## 1. 로컬에서 실행하기

준비물: Node.js 18 이상, Claude API 키

```bash
cp .env.example .env          # Windows: copy .env.example .env
# .env 파일을 열어 ANTHROPIC_API_KEY=sk-ant-... 입력
npm run check                 # API 연결 확인
npm start                     # http://localhost:3000
```

관리자: 오른쪽 위 "관리자" → 비밀번호(기본 1234, 로그인 화면에 표시)

## 2. Firebase에 배포하기 (프로젝트 ID: `fashion-ai-chat`)

### 2-1. 처음 한 번만 하는 준비

1. **Firebase CLI 설치·로그인**
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
2. **요금제 업그레이드:** [Firebase 콘솔](https://console.firebase.google.com/project/fashion-ai-chat/usage/details)에서 **Blaze(종량제)**로 변경합니다. Secret Manager를 쓰는 Cloud Functions에 필요합니다. 같은 화면에서 **예산 알림**(예: 월 10,000원)을 꼭 설정하세요.
3. **Firestore 만들기:** 콘솔 → Firestore Database → 데이터베이스 만들기 → 위치 **asia-northeast3(서울)**, **프로덕션 모드**.
4. **함수 패키지 설치**
   ```bash
   cd functions && npm install && cd ..
   ```
5. **비밀 값 등록** (입력하는 값은 화면에 보이지 않아요)
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY --project fashion-ai-chat
   firebase functions:secrets:set ADMIN_PASSWORD --project fashion-ai-chat   # 1234 말고 새 비밀번호!
   ```

### 2-2. 배포

```bash
npm run deploy      # = firebase deploy --project fashion-ai-chat (화면 + 함수 + Firestore 보안 규칙)
```

배포가 끝나면 **https://fashion-ai-chat.web.app** 에서 열립니다. 처음 접속하면 Firestore에 기본(가상) 데이터가 자동으로 만들어집니다.

### 2-3. 수정 후 다시 배포

코드나 화면을 고친 뒤 `npm run deploy`를 다시 실행하면 됩니다. 데이터(Firestore)와 비밀 값은 그대로 유지됩니다. 화면만 바꿨다면 `firebase deploy --only hosting`이 더 빠릅니다.

### 2-4. 비밀이 아닌 설정 바꾸기

`functions/.env.fashion-ai-chat` 파일(깃허브에 올라가도 되는 값만)을 고치고 다시 배포하세요.

| 항목 | 기본값 | 설명 |
|---|---|---|
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | 더 저렴하게: `claude-haiku-5-5` |
| `SHOW_ADMIN_PASSWORD` | `false` | `true`면 로그인 화면에 비밀번호 표시 (공개 사이트에서는 비권장) |
| `RATE_CHAT_PER_MIN` | `20` | IP당 1분 대화 요청 수 (서버 인스턴스별) |
| `RATE_LOGIN_PER_MIN` | `10` | IP당 1분 로그인 시도 수 |

### 2-5. 보안·비용 체크리스트

- [ ] API 키는 Secret Manager에만 있음 (`.env`·코드·깃허브에 없음)
- [ ] 관리자 비밀번호를 1234에서 바꿈
- [ ] Firebase 예산 알림 설정
- [ ] [Anthropic 콘솔](https://platform.claude.com)에서 월 사용 한도 설정
- [ ] Firestore 보안 규칙(`firestore.rules`)은 브라우저 직접 접근을 모두 막음 — 데이터는 함수(Admin SDK)로만 읽고 씀
- [ ] 동시에 켜지는 함수 인스턴스 최대 5개(`functions/index.js`의 `maxInstances`)

### 2-6. (선택) 배포 전 내 컴퓨터에서 Firebase처럼 실행하기

Java가 필요합니다. `functions/.secret.local` 파일을 만들고(깃허브에 올라가지 않음) 아래처럼 적은 뒤 실행하세요.
```
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_PASSWORD=1234
```
```bash
firebase emulators:start --project fashion-ai-chat     # http://127.0.0.1:5000
```

---

## 3. 알아둘 점

- **대화 기록은 브라우저 localStorage에 저장됩니다.** 그래서 Firebase에 배포하면 **관리자는 자기 브라우저에서 나눈 대화만** 볼 수 있습니다. 다른 사용자들의 대화를 검토하려면 대화 기록을 Firestore(서버)에 저장하도록 바꿔야 합니다. 이 경우 개인정보 고지와 보관 기간 정책도 함께 필요합니다.
- **관리자 로그인 세션**은 로컬에서는 메모리에(서버 재시작 시 다시 로그인), Firebase에서는 Firestore `adminSessions`에 토큰 해시로 저장됩니다(8시간 유지).
- **요청 횟수 제한**은 서버 인스턴스별 1차 방어입니다. 비용 사고를 막는 최종 장치는 예산 알림과 Anthropic 사용 한도입니다.
- **남은 결함:** 주문 조회 뒤 대화를 이어가면 AI가 사실과 다른 사과를 할 수 있음(LD1), 재고를 채워도 입고예정일이 남음(LD2).

## 4. 폴더 구조

```
├─ public/                  화면 (Firebase Hosting)
├─ functions/               서버 (Cloud Functions)
│  ├─ index.js              Firebase 진입점: Secret Manager 값 연결, 서울 리전
│  ├─ lib/app.js            API 처리 (로컬·Firebase 공용)
│  ├─ lib/claude.js         Claude API 호출 + 주문 조회 도구 반복
│  ├─ lib/prompt.js         지시문 조립·재고/금액 계산·검증
│  ├─ lib/guidelines.js     관리자 피드백 지침 규칙
│  ├─ lib/storage/file.js   로컬 저장 (data/*.json)
│  ├─ lib/storage/firestore.js  Firebase 저장 (Firestore)
│  ├─ data/seed.json        처음 데이터·프롬프트
│  └─ .env.fashion-ai-chat  배포용 비밀 아닌 설정
├─ server.js                로컬 실행용 서버
├─ firebase.json · .firebaserc · firestore.rules
├─ .env.example             로컬용 설정 예시 (.env는 깃허브에 올리지 않음)
└─ scripts/test.js          자동 테스트 (npm test, 가짜 Claude 사용 → 비용 없음)
```

## 5. 문제 해결

| 메시지 | 해결 |
|---|---|
| 배포 시 `Secret Manager API` 또는 `Blaze` 관련 오류 | 2-1의 요금제 업그레이드 후 다시 배포 |
| 화면에 `API 키가 올바르지 않거나…` | `firebase functions:secrets:set ANTHROPIC_API_KEY`로 다시 등록 후 `firebase deploy --only functions` |
| 화면에 `서버 오류가 났어요` | Firestore 데이터베이스를 만들었는지 확인, `firebase functions:log`로 원인 확인 |
| 관리자 비밀번호를 잊음 | `firebase functions:secrets:set ADMIN_PASSWORD`로 새로 등록 후 함수 다시 배포 |
| `요청이 너무 많아요` | 1분 뒤 다시 시도, 필요하면 `RATE_CHAT_PER_MIN` 조정 |

자동 테스트: `npm test` (서버 46건) · Claude Messages API 문서: https://platform.claude.com/docs/en/api/messages
