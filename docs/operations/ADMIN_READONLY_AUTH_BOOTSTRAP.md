# 관리자 접근 확인 bootstrap 분리 — 2026-10-08

**전체 완료 조건 미달 / 관리자 API 단독 무변경 PASS / 페이지 경로는 차단.**

Base `97933c08173f80c63d585e514608b6fe890856f0`, 기존 eeb4 detached worktree.
관리자 인증·권한 확인에 기존 read-only 함수를 연결하는 최소 수정만 수행했다.
실제 페이지에서는 공통 RootLayout의 별도 bootstrap 경로가 남아 있다.
일반 사용자 bootstrap을 바꾸지 말라는 범위를 지키기 위해 그 경로는 수정하지 않았다.

## 제품 diff

1. `lib/admin/api.ts`: `resolveAdminApiAccess`의 기존 `resolveAuthSession` 호출에
   `bootstrap: false` 한 줄 추가.
2. `lib/admin/server.ts`: 관리자 페이지의 사용자 ID 조회를 기존
   `getOptionalCurrentUserIdReadOnly`로 교체(import/호출 두 줄).

전역 Auth resolver/기본 bootstrap, login/signup, Supabase refresh, proxy,
role reader/policy, 쿠키 적용/오류 처리, 일반 사용자 호출부는 변경하지 않았다.
API는 여전히 Auth `/user` 확인, 필요한 refresh, refresh 후 subject 재확인을
수행하고 기존 admin role/permission gate를 통과해야 한다.
페이지는 기존과 같은 Auth 사용자 확인과 redirect/role/permission 정책을 사용한다.
API mutation 내부의 접근 확인에도 동일한 읽기 전용 identity 확인이 적용되며,
그 뒤의 명시적 관리자 작업은 변경하지 않는다.

## 수정 전 재현과 좁은 회귀

새 `lib/admin/readOnlyAuth.test.mjs`는 실제 admin/api, admin/server,
sessionResolution, supabaseAuth, currentUser, role policy, Auth cookie 코드를 실행한다.
HTTP/DB/Next request context만 격리한다. 모든 사용자/토큰/row는 합성값이다.
실제 merge-upsert 호출을 계측하고 전체 profile/preferences 객체 변화도 검사한다.
resolver 자체를 stub해서 bootstrap 플래그만 보는 테스트가 아니다.

제품 수정 전 8개 중 **5 FAIL / 3 PASS**:

- 정상 관리자 API와 페이지 조회에서 각각 bootstrap upsert 4회.
- expired access의 정상 refresh 후에도 upsert 4회.
- 인증됐지만 role이 없거나 권한이 부족한 요청도 role 거부 전에 bootstrap 수행.
- `user_profiles`, `alert_preferences`는 merge-duplicates.
- 구독/채널은 기존 ignore-duplicates 호출. 이 차이를 구분해 기록했다.

수정 후 같은 8개 **8/8 PASS**. 추가한 root-plan 잔여 부작용 characterization
1개 포함 최종 **9/9 PASS**. 마지막 테스트는 root bootstrap이 **여전히 존재함**을
확인하는 것이므로 페이지의 무변경 PASS로 세면 안 된다.

확인한 인증 의미:

- 정상 identity/Operations role 유지, bootstrap 쓰기 0.
- expired access → refresh → 새 access로 `/user` 재검증 → rotated cookie 응답 유지.
- anonymous 401, 무권한 403, protected loader 미실행 유지.
- 페이지의 로그인/관리자 필요/권한 부족 redirect 목적지 유지.
- Auth 장애는 fail-closed, 불필요한 refresh/쿠키 삭제 없음.
- invalid refresh 및 refresh subject 불일치 거부 유지.
- 일반 `resolveAuthSession` 기본값은 정상/refresh 모두 기존 bootstrap 4회 유지.

## 실제 동일 loopback 검증

REST/Auth `http://127.0.0.1:56321`, SQL `127.0.0.1:56322/postgres`,
system identifier `7678429483712069671` 재확인. 기존 Docker project/network/
Auth·REST DB 라우팅과 실행 스택 키 동등성은 기존 검증 스크립트로 재확인했다.
환경파일 수정 없이 최소 loopback 환경을 후보 3111 자식 프로세스에만 전달했다.
기존 Chrome Operations session을 사용했으며 토큰·쿠키를 추출하거나 계정을
만들지 않았다. 정상 session 접근이며 새 비밀번호 로그인 검증은 아니다.

`scripts/verify-admin-readonly-auth.mjs`는 이전과 같은 **30개 테이블**을 선정해
새 전후 baseline을 읽는다. 읽기 전용 repeatable-read transaction을 각각 열고
닫으며, 브라우저 조작을 기다리는 동안 transaction을 유지하지 않는다.
profile 12행/preferences 10행의 **모든 필드**를 메모리에 보존하고 deep equality로
비교한다. 기존 검수 actor가 두 집합에 포함됨을 확인하며, actor 전체 행 hash도
각 receipt에 기록한다. 개인정보 원문은 파일·stdout에 저장하지 않는다.
따라서 특정 actor만이 아니라 두 테이블의 모든 행을 비교했다.
별도로 migration ledger, 키움 세 테이블 및 전체 admin audit count/hash도 비교했다.

### 측정 1: 페이지 + API (run2) — FAIL

baseline 후 `/admin/data/kiwoom-verification` 진입 및 reload, history /
human-history / 기존 exact review GET을 실행했다. HTTP 200, Operations
AdminShell과 기존 revision 2가 표시됐다. POST/저장은 실행하지 않았다.

- 30개 중 **28개** count/hash 동일.
- `user_profiles`와 `alert_preferences`의 전체 행 비교 **false**.
- ledger, 키움 기록, admin audit **동일**.

실제 잔여 경로:

```text
app/layout.tsx: RootLayout
  → lib/currentViewerPlan.ts: getCurrentViewerPlan
  → lib/currentUser.ts: getOptionalCurrentUserId
  → ensureUserBootstrap
  → user_profiles / alert_preferences merge-upsert
```

이 경로는 관리자 API gate와 별개로 페이지 공통 layout에서 실행된다.
실제 root-plan 함수를 실행하는 추가 격리 테스트에서도 같은 upsert 4회를
확인했다. 단순히 API `bootstrap:false`만으로 페이지 전체가 read-only가 된다고
보고하지 않는다. global plan 조회/일반 사용자 bootstrap을 바꾸거나 관리자
pathname 분기를 새로 만들지 않았다. 이 부분이 현재 범위의 중단 지점이다.

### 측정 2: 이미 열린 페이지의 API GET만 (api-only) — PASS

페이지 초기 로딩 완료 **후 별도 baseline**을 만들었다. 이후 페이지 navigation/
reload 없이 기존 버튼으로 다음 GET만 실행했다.

- `?mode=history`: HTTP 200
- `?mode=human-history`: HTTP 200
- `?mode=review&id=91bdc584-47ba-4c0b-93f3-a6d77883e574`: HTTP 200

결과:

- **30/30** count/hash 동일.
- `user_profiles` 전체 12행 및 `alert_preferences` 전체 10행 deep equality **true**.
- 기존 actor의 양쪽 전체 행 포함, 전후 SHA-256 동일.
- ledger, 키움 기록, admin audit **동일**.

이 분리 측정은 **API 수정 효과의 증거**이며, 측정 1의 실패를 대체하거나
초기 페이지 변경을 제외해 전체 PASS로 만드는 것이 아니다.
어떤 값도 원복하거나 updated_at를 덮어쓰지 않았다.
실제 브라우저에서 강제로 session을 만료시키지 않았으므로 expired-session
refresh 의미는 앞의 실제 함수/격리 HTTP 통합 테스트로 검증한 범위다.

## 실행 명령과 결과

```powershell
node --test lib/admin/readOnlyAuth.test.mjs
npm run verify:admin
npm run verify:auth
npm run verify:kiwoom-evidence
npx tsc --noEmit --incremental false
node --check scripts/verify-admin-readonly-auth.mjs
git diff --check
git diff --cached --check
```

- 새 좁은 테스트 **9/9** (8 회귀 + 1 잔여 경로 characterization).
- 기존 admin **58/58**, Auth **21/21**, Kiwoom **50/50**.
- TypeScript, 신규 스크립트 syntax, diffcheck PASS.

추가로 실행한 전체 mutation-origin inventory는 기존
`app/api/cron/source-ingest/cancel/route.ts`의 scheduler-secret 문자열 검사에서
실패했다. 해당 테스트와 그것이 읽는 `app/api` 파일들은 base와 동일함을
`git diff --quiet HEAD -- app/api lib/auth/mutationOriginInventory.test.ts`로
확인했다. 실제 인증 구현은 helper로 분리돼 있지만 이번에 검사를 약화하거나
무관한 cron을 수정하지 않았다. 전체 테스트가 모두 PASS라는 주장은 하지 않는다.

처음 humanAdmin 시험을 단독 명령에 포함했을 때 server-only loader 누락으로
모듈 로딩 실패가 있었다. 정식 `npm run verify:kiwoom-evidence`로 다시 실행해
기존 50개가 통과했다. 이를 제품 실패/수정 또는 새로운 E2E 성공으로 세지 않는다.

## 증빙 및 다음 검토

외부 receipt root:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/admin-readonly-auth/`

- `before-test.txt`, `after-test.txt`: 수정 전/후 좁은 테스트.
- `admin-tests.txt`, `auth-tests.txt`, `kiwoom-tests.txt`, `regressions.txt`.
- `target-before.json`, `server.json`: 동일 스택/서버 진단.
- `run2/readonly-before.json`, `readonly-after.json`, `readonly-comparison.json`:
  페이지+API 실패 기록. 초기 stdin 방식 종료로 비교가 끝나지 않은 root-level
  baseline은 증거로 사용하지 않는다.
- `api-only/readonly-before.json`, `readonly-after.json`, `readonly-comparison.json`:
  API만 비교한 성공 기록.
- `api-only/browser-state.txt`: 전체 AX 기록, Operations와 saved review 표시.
- `page-api-server.log`, `api-only-server.log`: 실제 GET 응답.

제품 변경은 관리자 두 호출부뿐이며, 이 문서/직접 테스트/검증 스크립트와 함께
한 독립 커밋으로 남긴다. 일반 root-plan 경로까지 읽기 전용으로 만들려면 일반
사용자 bootstrap/plan 조회의 의미와 관리자만의 적용 방법을 별도로 검토해야 한다.
현재 제한을 넘는 수정을 이미 승인받았다고 간주하지 않는다.

키움 evidence/human/audit 추가 **0**, SEC seed/수집/backfill **0**, migration
재적용/ledger 조작 **0**. env/key/account/role 변경 없음. 소유한 후보 3111 서버와
탭 종료, Next 생성 파일은 정확한 실행 전 사본으로 복구. DB 데이터 원복 없음.
local main ref는 `d7347e4d2e75a5c412f69218003d2dfd407c79c5`.
GitHub/Vercel/원격 DB/cron은 미조회, main/3110·Docker는 조작하지 않았다.
SEC human judgment/comparison 실제 E2E와 전체 완료·병합 준비 PASS를 선언하지 않는다.
