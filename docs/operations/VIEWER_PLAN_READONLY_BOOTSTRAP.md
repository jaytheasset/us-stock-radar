# RootLayout viewer-plan bootstrap 분리 — 2026-10-08

**이번 보호 데이터 무변경 차단 사항만 PASS. SEC human E2E·전체 기능 완료·병합 준비 판정 아님.**

- 작업본: `C:/Users/PC/.codex/worktrees/eeb4/US-Stock Radar`, detached.
- Base: `c6ec6aaa6b9a79b702f00e9b7e73cbc9a8fc6183`, 시작 clean.
- 이전 부분 수정/실패 증빙은 [ADMIN_READONLY_AUTH_BOOTSTRAP.md](ADMIN_READONLY_AUTH_BOOTSTRAP.md)에 보존한다.
- 이번 변경은 base를 amend/revert하지 않는 별도 후속 커밋이다.

## 제품 변경 및 의미 보존

`lib/currentViewerPlan.ts`의 import/호출 두 줄만 기존
`getOptionalCurrentUserIdReadOnly`로 교체했다. RootLayout과 다른 viewer-plan
소비자 모두 plan 조회만 하며, pathname 분기/새 middleware/header/cookie는 없다.
Auth 사용자 검증과 UUID 검증은 동일 함수를 재사용한다.
`getEffectiveUserPlan`의 SELECT 및 subscription 부재 → free, 유료 plan/trial 판정은 그대로다.

`ensureUserBootstrap`, 일반 `getOptionalCurrentUserId`, admin 접근/role 정책,
session refresh/쿠키/subject 재검증은 변경하지 않았다.
기존 login/signup/OAuth 함수, signup/session route, auth/me resolver에 명시적
bootstrap 경로가 있다. RootLayout만이 기본 행을 생성하는 유일한 진입 계약은
확인되지 않았다. 읽기 중 누락된 행을 보충하는 부작용은 제거하되 명시적 생성은 유지한다.

## 수정 전/후 회귀

`lib/admin/readOnlyAuth.test.mjs`는 실제 viewer-plan/effectivePlan/currentUser/Auth/
session/admin 함수를 실행하고 HTTP/DB/request context만 합성 대역으로 격리한다.
기존 effectivePlan stub을 제거하고 실제 구독 판정과 SELECT를 사용한다.

제품 수정 **전** 새 기대값으로 실행: **10 PASS / 2 FAIL**.
인증 viewer-plan 조회에서 profile/subscription/preferences/delivery-channel upsert
각 1회(총 4회), profile/preferences merge-upsert가 발생했다.
제품 수정 **후** 동일 테스트 **12/12 PASS**:

- RootLayout이 호출하는 viewer-plan: subscription 부재 시 free, SELECT 1회, upsert 0회.
- 비로그인/무효 access: free, 구독 SELECT 0회, upsert 0회.
- ad_free/pro/advanced/ultimate, 비활성 구독, 활성 advanced trial,
  ultimate보다 낮은 trial, 만료 trial: 기존 결과 유지, upsert 0회.
- 로그인/회원가입/OAuth 실제 함수와 auth/me 실제 GET(정상 및 refresh),
  일반 current-user: 네 bootstrap 테이블의 기본 payload와 기존 ignore-duplicates 보존.
- 기존 admin role/거부/refresh/subject 불일치/장애 회귀 유지.

합성 테스트는 실제 신규 계정 생성이나 실제 refresh E2E를 의미하지 않는다.

## 실제 승인 loopback 읽기 검증

REST/Auth `http://127.0.0.1:56321`, SQL `127.0.0.1:56322/postgres`,
system identifier `7678429483712069671` 및 기존 Docker 라우팅/키 일치 재확인.
기존 Operations 브라우저 세션 사용. 토큰 추출·계정/role 변경 없음.
3111은 다른 앱이 점유 중이므로 건드리지 않고 후보 서버만 **3112**로 실행했다.
환경파일은 읽기 전용 확인만 했고 후보 child process에 기존 local-stack 설정을 전달했다.

새 baseline **2026-10-08T12:53:33.942Z** 이후, 다음을 실제 화면에서 실행했다.
전후 비교 종료 **2026-10-08T12:54:23.093Z**:

| 읽기 | 실제 결과 |
| --- | --- |
| `/admin/data/kiwoom-verification` 최초 진입 | 200, Operations AdminShell |
| 같은 페이지 reload | 200, Operations 유지 |
| `?mode=history` | 200, 기존 revision 1/2 |
| `?mode=human-history` | 200, 기존 빈 목록 |
| `?mode=review&id=91bdc584-47ba-4c0b-93f3-a6d77883e574` | 200, 기존 PSKY→SKYD revision 2 표시 |

POST/저장/원문 재수집 없이 GET만 수행했다.

| 보호 대상 | 전후 비교 |
| --- | --- |
| 기존 동일 30개 보호 테이블 | count/전체 내용 hash **30/30 동일** |
| user_profiles 전체 12행 | 모든 필드 deep equality, actor 전체 행 SHA-256 동일 |
| alert_preferences 전체 10행 | 모든 필드 deep equality, actor 전체 행 SHA-256 동일 |
| migration ledger 134행 | 버전 목록 및 전체 행 count/hash 동일 |
| 키움 evidence 2 / human judgment 0 / comparison 0 | 각 count/hash 동일 |
| admin audit 전체 11행 | count/hash 동일 |

기존 검증기의 ledger 버전 목록 비교에 전체 행 fingerprint를 추가했다.
첫 실행도 30/30 PASS였으나 ledger 보강 후 위 새 baseline에서 재검증했다.
profile/preferences 원문 행은 메모리에서만 비교하며 개인정보를 증빙 파일에 저장하지 않는다.
DB 원복·updated_at 덮어쓰기·ledger 조작·migration 적용은 없었다.

## 실행 결과와 증빙

```powershell
node --test lib/admin/readOnlyAuth.test.mjs                 # 12/12
npm run verify:admin                                      # 58/58
npm run verify:auth                                       # 21/21
npm run verify:kiwoom-evidence                             # 50/50
npm run verify:subscription                               # 12/12
npm run typecheck                                         # PASS
node --check scripts/verify-admin-readonly-auth.mjs        # PASS
git diff --check                                         # PASS
git diff --cached --check                                 # PASS
```

추가 `node --test --experimental-strip-types lib/auth/mutationOriginInventory.test.ts`는
기존 cron source-ingest/cancel scheduler-secret 문자열 검사 1건 FAIL(1 PASS/1 FAIL).
`app/api`, `lib/auth`, `lib/currentUser.ts`가 base와 동일함을 확인했다. 범위 밖 기존 실패는 수정하지 않았다.

외부 증빙 root:
`C:/Users/PC/.codex/visualizations/kiwoom-verification-implementation-20261008/viewer-plan-readonly/`

- `before-test.txt`, `after-test.txt`, `admin.txt`, `auth.txt`, `kiwoom.txt`, `subscription.txt`, `typecheck.txt`.
- `target.json`, `server-final.json`: 동일 loopback 대상 확인.
- `full-read-final/readonly-before.json`, `readonly-after.json`, `readonly-comparison.json`:
  전체 count/hash와 full-row equality 판정. 변경 테이블 `[]`, 모든 비교 true.
- `full-read-final/first-entry.txt`, `reload.txt`, `after-reads.txt`, `server-read-log.txt`:
  실제 AdminShell/GET 응답 증빙. 첫 실행 캡처는 `after-reads.png`.
- 최종 검증 스크립트 명령: `node --no-warnings --experimental-strip-types scripts/verify-admin-readonly-auth.mjs <new receipt directory> <original loopback/before.json>`.

소유한 후보 서버/탭만 종료했고 Next 생성 파일은 실행 전 사본으로 복구했다.
일반 사용자 로그인·회원가입·OAuth를 실제 DB에서 다시 실행하거나 세션을 강제 만료시키지 않았다.
이 경로들의 의미 보존은 코드 diff와 격리 함수/통합 회귀 범위다.
SEC candidate seed/수집/backfill, human judgment/comparison 저장과 실제 ticker 변경은 0회.
SEC human 저장 E2E는 계속 미검증이다.

local main ref: `d7347e4d2e75a5c412f69218003d2dfd407c79c5`.
GitHub main/Vercel/원격 DB/cron은 미조회이며 코드 일치·병합 준비를 주장하지 않는다.
공유 DB migration·main/3110·기존 3111 프로세스·Docker lifecycle·env/key/account/role은 변경하지 않았다.
merge/push/deploy 없이 GPT 독립 검토를 기다린다.
