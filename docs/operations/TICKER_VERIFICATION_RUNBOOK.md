# SEC / Kiwoom ticker verification — 운영 절차서

2026-10-09, 코드 기준 local main `41a7947c6ade9a34521bcdef6ddee2d63fcb4d04`.
[최종 구조](../architecture/TICKER_VERIFICATION.md)와
[Production source of truth](PRODUCTION_SOURCE_OF_TRUTH.md)를 함께 사용한다.
아래 apply/save는 절차 설명이며 이번 문서 작업에서 실행하지 않았다.
로컬 검증 완료와 운영 활성화 승인은 다르다. GitHub main/Vercel/운영 DB는 이번에 확인하지 않았다.

## 시작 조건

현재 root/branch/HEAD/status와 대상 DB의 API URL, SQL URL, system identifier를 확인한다.
기존 미커밋 파일, 특히 사용자 `next-env.d.ts`를 보존한다. 다른 포트/worktree가 같은 DB를
사용할 수 있으므로 포트 분리를 DB 격리로 간주하지 않는다.
계정/세션/role을 검증 편의를 위해 생성·변경하지 않고, 로그에 토큰·쿠키·비밀번호를 남기지 않는다.
쓰기 작업은 해당 환경과 대상에 대한 승인이 있을 때만 한다.

## 1. 보존 SEC 원문 → raw → cover → 자동 후보

세 runner 모두 기존 [package scripts](../../package.json)를 사용한다.
Offline import는 현재 8-K/8-K/A 보존 archive 범위이며 범용 form importer가 아니다.
Manifest, retained Submissions identity, UTF-8 원문과 SHA를 먼저 검증한다.

```powershell
npm run sec:offline-import -- --directory <archive-directory> --mode validate --receipt <new-validation.json>
```

그다음 각 단계의 plan을 만든다. 아래 꺾쇠 값은 실제 확인한 값을 넣는 자리이며 자격 증명은 아니다.

```powershell
npm run sec:offline-import -- --directory <archive-directory> --mode plan --expected-api-url <local-api-url> --expected-db-url <local-sql-url> --expected-system-identifier <verified-system-id> --receipt <new-import-plan.json>
npm run sec:cover-replay -- --input <exact-raw-targets.json> --mode plan --expected-api-url <local-api-url> --expected-db-url <local-sql-url> --expected-system-identifier <verified-system-id> --receipt <new-cover-plan.json>
npm run sec:ticker-automatic -- --input <exact-cover-trigger.json> --mode plan --expected-api-url <local-api-url> --expected-db-url <local-sql-url> --expected-system-identifier <verified-system-id> --receipt <new-candidate-plan.json>
```

각 단계는 이전 단계의 성공한 저장/read-back 이후 진행한다. 위 세 plan을 입력 준비 없이
연속 실행하지 않는다. Receipt는 Git 밖 새 파일에 create-new로 남긴다.

| 단계 | 입력과 apply 확인값 | 저장 후 검증 |
| --- | --- | --- |
| Offline import | archive의 exact manifest/source. 같은 명령의 mode를 apply로 바꾸고 `--confirm-bundle-sha256 <verified-bundle-sha256>` 추가 | `import_sec_offline_archive_raw` 결과와 exact raw/source/run 재조회. 동일 입력 replay/no-op, 다른 원문 conflict를 구분 |
| Cover replay | rawItemId/accessionNumber/issuerCik/sourceSha256의 명시적 대상 목록. `--mode apply --confirm-plan-digest <verified-plan-digest>` | `readSecCoverObservations`로 exact source/result/rows 검증. raw metadata 및 자동 후보를 이 runner가 수정하지 않음 |
| Automatic candidate | issuerCik/accessionNumber/sourceSha256/resultId의 exact cover trigger. `--mode apply --confirm-plan-digest <verified-plan-digest>` | `readSecTickerResolutionByDecisionId`로 exact 평가/ID/hash 검증. REVIEW 저장 성공은 ticker 승인 아님 |

순서는 **plan → 대상·변경 행·exact digest 검토 → apply → exact reader → 새 plan으로 replay/no-op 확인**이다.
기존 insert 이전 digest를 다음 replay에 무조건 재사용하지 않는다. 특히 automatic runner는
저장된 decision/human scope까지 digest에 포함하므로 새 plan이 필요하다.

Automatic v1 CLI는 issuer scope 전체를 살펴보되 선택된 decision intent 하나만 실행한다.
둘 이상이면 review-required다. Lease를 확보하고 잠금 아래 재계획·최종 digest 재검증 후 저장한다.
Cover replay는 item별 저장이며 전체 batch 원자성은 없다. 중간 실패 시 이미 저장된 item을
삭제하지 말고 receipt와 공식 reader로 상태를 확인한 뒤 새 plan을 만든다.
CLI flags의 정의: [import](../../scripts/import-sec-offline-archive.ts),
[cover](../../scripts/replay-sec-stored-raw-cover.ts), [automatic](../../scripts/sec-ticker-automatic.ts).

## 2. Kiwoom evidence review와 publisher 변경

관리자 화면은 `/admin/data/kiwoom-verification`, API는
[`/api/admin/data/kiwoom-verification`](../../app/api/admin/data/kiwoom-verification/route.ts)다.
GET `mode=notice&noticeId=<id>`로 exact notice를 확인하고 실제 이미지에서 country/event/date/
symbol/securityName/details 및 인접 행 문맥을 사람이 읽는다. SEC 값을 Kiwoom 셀에 보충하지 않는다.

Review 저장은 mode 없는 POST, `X-Request-Id`, exact draft를 사용한다. Expected source hash,
image proof/locator, case/expectedRevision, US row 확인과 verdict/reason을 검토한다.
서버가 current source를 다시 확인하고 `admin_record_kiwoom_ticker_evidence`로 review+audit를 저장한다.
GET `mode=review&id=<id>` 및 `mode=recheck&id=<id>`로 저장 원본과 현재 source의 차이를 구분한다.

Publisher 이미지가 달라지면 기존 snapshot/locator/전사를 그대로 승인하지 않는다.
새 이미지를 다시 읽고 같은 evidence case에 새 revision을 append한다. 이전 review는 보존한다.
이로 인해 기존 human comparison이 stale이 될 수 있으며 기존 human 값을 자동 갱신하지 않는다.
Evidence review 철회는 별도 verdict=withdrawn이고 human judgment 철회와 혼동하지 않는다.

## 3. SEC human preview와 첫 저장

1. GET `mode=candidate&decisionId=<exact-id>`로 official 자동 후보, exact SEC reference와 visible text를 읽는다.
2. Exact Kiwoom review와 현재 snapshot/image를 재확인한다. 장애·변경 시 과거 snapshot으로 대체하지 않는다.
3. B의 SEC values/security/eventStatus/proofs/exchangeTransfer와 C의 literal cells/dateBasis/rowCorrespondence를 독립적으로 작성한다. Proof는 visible text UTF-16 `[start,end)`의 exact quote다.
4. 첫 draft는 action=append, expectedRevision=0, previousId=null이다. Exact case/decision SHA/candidate revision/source/review revision/snapshot/image/locator를 묶는다.
5. POST `mode=human-preview`로 비교만 실행한다. 저장 RPC는 없다. A 원형, B↔C fields, differencesFromAutomatic, SEC-only exchange, eligible/reasons, authority를 확인한다.
6. 승인된 exact draft와 새 `X-Request-Id`로 POST `mode=human-save`한다. Actor body를 추가하지 않는다. 서버 인증 actor가 사용된다.
7. 응답의 exact judgment/comparison/audit 연결과 hash를 확인하고 GET `mode=human&id=<judgment-id>`로 공식 current-state를 읽는다.

새 저장은 judgment/comparison/audit 각각 한 행이다. 기존 행은 변경하지 않는다.
`authentication: not_verified`는 순수 comparison의 표시이고 실제 API 세션 인증/audit actor와는 별개다.
서버가 반환한 `current`를 eligible·동일 증권 승인·ticker 변경 승인으로 표현하지 않는다.

## 4. Replay, collision, 새 revision, withdrawal

| 작업 | 계약 및 확인 |
| --- | --- |
| 동일 요청 replay | 같은 인증 actor, exact body, 같은 X-Request-Id. HTTP 200/status=replayed, 동일 저장 ID/hash/audit. 정상 fast path는 source fetch/저장 RPC 0회. 새 행 0개. current-state는 별도 조회 |
| 같은 ID + 다른 body | HTTP 409 / `KIWOOM_HUMAN_IDEMPOTENCY_CONFLICT`. 새로운 request ID로 바꿔 자동 통과시키지 않음 |
| 새 human revision | 새 request ID, 같은 caseId, 최신 expectedRevision/previousId. 서버가 previousJudgmentSha256를 연결. 이번 판단의 변경만 새 행에 기록하고 이전 reason/created_at도 보존 |
| Withdrawal | action=withdraw, 최신 predecessor 및 새 request ID. 기존 source/review/row/값/proof는 동일하게 유지하고 human.status=withdrawn과 reason으로 append. 원문 fetch 없이 기존 저장을 근거로 철회하며 재활성화 기능은 없음 |

일반 revision append 후 최신 exact 조회는 current, 이전 exact 조회는 stale/
`human_revision_changed`가 된다(다른 stale 원인이 없는 경우). Human 철회 이후에는 최신 상태를
우선하므로 이전 revision exact 조회도 withdrawn을 반환할 수 있다. `saved`는 요청한 과거 행이다.
`mode=human-history`는 최근 30개 기록의 목록이며 무제한 전체 이력 export가 아니다.

Withdrawal은 `admin_record_kiwoom_human_comparison`의 실제 append-only 계약을 사용한다.
이 문서는 공유 PSKY 사례에 withdrawal을 실행할 승인이 아니다. 예외 회귀는 소유한 임시 DB에서만 수행한다.

## 5. 진단과 응답 유실

| 증상 | 처리 |
| --- | --- |
| stale / human_revision_changed | 최신 revision과 predecessor 확인. 과거 행 수정 금지 |
| stale / source_changed 계열 | 저장 snapshot/image와 current source 비교. Publisher 변경이면 새 evidence review가 필요하며 예전 bytes 주입 금지 |
| unavailable / upstream 장애 | 장애 reason 보존, 저장하지 않음. 정상 source 복귀 후 별도 current read. 없는 공시로 단정하지 않음 |
| unavailable / store·hash·proof 검증 실패 | 권한/응답 형식/retained source/해시 계약을 읽기 전용으로 조사. DB 값을 맞춰서 PASS로 만들지 않음 |
| withdrawn | human/evidence 어느 쪽 철회인지 reason과 최신 이력 확인. ticker 취소·상장 상태와 별개 |
| not_found | exact judgment 또는 참조 ID와 읽기 범위를 확인. 조회 실패와 실제 부재를 구분 |
| 저장 응답 유실 | 자동 재시도하지 않고 request identity와 저장 이력을 먼저 조회. 커밋 후 응답만 유실될 수 있음. 승인된 동일 요청 replay로 판별하며 새 ID로 중복 저장하지 않음 |

인증 refresh나 다른 작업방 로그인은 공유 DB를 바꿀 수 있다. 도메인 reader 쓰기와 별도로
원인을 조사하며, 오염된 전체 DB hash 측정을 PASS로 바꾸지 않는다. 안정성 회귀에는 소유한
격리 DB와 통제된 source fixture를 사용한다. 같은 포트만 바꾼 서버는 격리가 아니다.
Direct SQL UPDATE/DELETE, 이전 revision 덮어쓰기, source/hash 재작성, revision 삭제로 재시도,
임의 migration repair/reset은 하지 않는다.

## 6. 배포 전 점검과 배포 후 smoke

이번 작업은 배포하지 않는다. 향후 승인된 배포에서는 아래 **기존 migration과 후속 변경의
이력/객체 정합을 점검**한다. 목록의 파일을 이미 적용된 DB에 다시 실행하거나 일괄 적용하지 않는다.

| Migration | 관련 객체 |
| --- | --- |
| [20260728113243_canonical_baseline.sql](../../supabase/migrations/20260728113243_canonical_baseline.sql) | 공통 raw_items/source/run schema의 기존 baseline |
| [20260729195029_admin_foundation_v1.sql](../../supabase/migrations/20260729195029_admin_foundation_v1.sql) | admin_audit_logs / 권한 기반 |
| [20260821140512_sec_structured_data_foundation_v1.sql](../../supabase/migrations/20260821140512_sec_structured_data_foundation_v1.sql) | exact raw sources / issuers |
| [20260912103644_sec_cover_security_observation_persistence_v1.sql](../../supabase/migrations/20260912103644_sec_cover_security_observation_persistence_v1.sql) | cover 결과·rows / persistence RPC / append-only |
| [20260913005601_sec_ticker_resolution_v1.sql](../../supabase/migrations/20260913005601_sec_ticker_resolution_v1.sql) | identity/evidence/decision / persist_sec_ticker_resolution |
| [20260913064018_sec_ticker_resolution_human_review_v1.sql](../../supabase/migrations/20260913064018_sec_ticker_resolution_human_review_v1.sql) | 기존 별도 identity human review; Kiwoom 비교는 쓰지 않음 |
| [20261008121000_kiwoom_ticker_evidence_reviews.sql](../../supabase/migrations/20261008121000_kiwoom_ticker_evidence_reviews.sql) | review / admin_record_kiwoom_ticker_evidence / append-only |
| [20261008121100_kiwoom_human_comparisons.sql](../../supabase/migrations/20261008121100_kiwoom_human_comparisons.sql) | judgment/comparison / admin_record_kiwoom_human_comparison / atomic FK·hash·revision |
| [20261008134000_sec_offline_archive_raw_import.sql](../../supabase/migrations/20261008134000_sec_offline_archive_raw_import.sql) | import_sec_offline_archive_raw |

전체 DB 의존성 목록을 이 표로 대체하지 않는다. 기존 admin role helper, issuer lease RPC,
공통 raw/source/run schema와 후속 migration도 현재 repository 정의와 대조한다.
RLS·service-role SELECT/INSERT·RPC EXECUTE 및 public/anon/authenticated 차단, append-only trigger,
request/case unique, deferred FK를 확인한다. 환경의 DB 대상과 서버 전용 credentials, same-origin,
관리자 권한, SEC/Kiwoom 허용 source 접근을 점검하되 비밀값은 출력하지 않는다.

배포 후에는 정확한 deployed commit을 확인하고 기존 관리자 화면의 history/exact source/후보/
comparison/current 조회, 비로그인·비권한·cross-origin 차단을 smoke한다. Preview는 승인된 exact
입력으로만 실행한다. 실제 save/withdrawal smoke는 별도 쓰기 승인 및 검증용 대상이 필요하다.
기존 실데이터를 새 revision으로 바꾸어 배포 성공을 확인하지 않는다.

현재 존재하는 관련 fixture 회귀 명령:

```powershell
npm run verify:sec-offline-import
npm run verify:sec-cover-replay
npm run verify:sec-ticker-automatic
npm run verify:kiwoom-evidence
npm run typecheck
npm run build
git diff --check
```

이번 문서 변경에서는 위 제품 회귀·build·DB E2E를 재실행하지 않고 문서 검증만 한다.

## 현재 검증 상태

아래는 2026-10-09에 완료된 검증 기록이며 이번 문서 작성 중 새로 실행한 결과가 아니다.
코드 수정 `57c7acf3` 및 후속 main 통합에 보존된 계약을 정리한다.

| 범위 | 결과 | 증거 환경 / 한계 |
| --- | --- | --- |
| SEC raw import/replay, cover 저장/replay, automatic candidate 저장/replay | PASS | 보존 SEC 원문으로 실제 로컬 저장/read-back. REVIEW를 AUTO로 바꾸지 않음 |
| Kiwoom evidence revision 저장, human preview | PASS | 실제 로컬 review 및 exact SEC/Kiwoom 근거 |
| Judgment + comparison + audit 첫 저장 | PASS | 실제 로컬 원자적 저장. 서버 Operations actor, 세 행 연결 |
| Request replay/no-op, 같은 request ID body collision | PASS | 실제 로컬 API; 동일 결과 재조회 / HTTP 409, 추가 행 없음 |
| Human revision 2, predecessor, 최신 current / 과거 stale | PASS | 실제 로컬 append. 이전 전체 행·created_at 보존 |
| Source 변경 → stale, source 장애 → unavailable, 정상 복귀 → current | PASS | 최종 격리 검증: production source adapter에 보존 detail/image fixture와 통제 응답 적용. 실제 publisher가 바뀌었다는 주장이 아님 |
| Withdrawal → withdrawn, 과거 이력 보존 | PASS | 소유한 임시 PostgreSQL에 실제 migration/RPC, 합성 actor/준비된 revision으로 append. 실제 DB trigger·원자성·기존 행 hash 확인 |
| Ticker/current/Watchlist/Alert 쓰기 | 0회 | comparison 검증 경로의 권한·쓰기 경계. 자동 후보 REVIEW/date null, tickerAuthority none 유지 |

**로컬 기능 검증 완료. GitHub push·배포는 아직 미실행.** 운영 DB/cron/공개 제품 적용 완료라는
뜻은 아니다. 실제 공유 PSKY human revision 2는 마지막 실제 조회에서 current였고, 최종 격리
검증은 공유 DB에 연결하지 않았다. 공유 사례를 철회하거나 새 revision을 만들지 않았다.

공유 DB에서 다른 작업방 로그인으로 인증 테이블이 변한 이전 측정은 무변경 PASS로 소급하지
않는다. 최종 격리 검증은 13개 fixture 테이블을 서로 다른 읽기 트랜잭션의 PK별 full-row hash로
비교했다. Withdrawal만 judgment/comparison/audit 각 +1, 기존 행 무변경이며 UPDATE/DELETE 거부를
확인했다. 새 브라우저 로그인/인증/PostgREST E2E로 확대 해석하지 않는다.

최종 격리 근거: Git 밖 로컬 임시 폴더
`kiwoom-final-isolated-20261009-173506`의 `REPORT.md`, `FINAL.json`, `postgres-result.json`.
Kiwoom 54/54 + SEC/cover/admin 133/133, full typecheck/production build/diffcheck PASS.
임시 PostgreSQL은 종료·정리됐다. 임시 근거는 영구 저장소 보장을 갖지 않으며 원문·토큰을
이 문서나 Git에 복사하지 않는다.

## 과거 단계별 검증 문서

아래 문서는 당시 단계와 제약을 그대로 보존한다. 과거의 “apply 미실행”, “후보 없음”,
“human 저장 미검증”은 **현재 완료 상태가 아니다**. 현재 구조/상태의 진입점은 이 runbook과
[최종 구조 문서](../architecture/TICKER_VERIFICATION.md)이며 과거 증거를 고쳐 쓰지 않는다.

- [보존 원문 offline import](SEC_OFFLINE_ARCHIVE_IMPORT.md)
- [Stored raw cover replay](SEC_STORED_RAW_COVER_REPLAY.md)
- [Automatic runner stage 3-A](SEC_TICKER_AUTOMATIC_RUNNER.md)
- [Kiwoom evidence 구현](KIWOOM_TICKER_EVIDENCE.md)
- [Real SEC link validation](KIWOOM_REAL_SEC_LINK_VALIDATION.md)
- [Human exception 계약](KIWOOM_HUMAN_EXCEPTION.md)
- [Human storage 초기 검증](KIWOOM_HUMAN_STORAGE.md)
- [Local connection check](KIWOOM_LOCAL_CONNECTION_CHECK.md)
- [Loopback validation](KIWOOM_LOOPBACK_VALIDATION.md)
- [Admin read-only auth 경계](ADMIN_READONLY_AUTH_BOOTSTRAP.md)
