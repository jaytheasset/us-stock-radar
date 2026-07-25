# Vercel Workflow Source Ingest Runbook

이 문서는 뉴스·SEC 수집을 Vercel Workflow로 운영할 때 필요한 배포,
검증, 병행 운영, 롤백 절차를 정리한다.

공식 기준 문서:

- [Workflow SDK](https://useworkflow.dev/docs)
- [Vercel Workflows](https://vercel.com/workflows)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Cron 보안·중복 실행](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Vercel 리전](https://vercel.com/docs/regions)

## 구조

```text
Vercel Cron
  -> CRON_SECRET 확인
  -> Supabase lease 획득
  -> 작은 ID payload로 Workflow 시작
     -> SEC: 폼 그룹 raw 수집 step
             -> raw_item_id별 분석·저장 step
     -> 뉴스: lane 안에서 뉴스 소스별 수집·분석·저장 step
  -> lease 반환
```

Cron 함수는 실제 수집을 기다리지 않는다. `start()`가 돌려준 Workflow
`runId`만 응답하고, 작업은 Workflow queue에서 계속된다.

Workflow 입력에는 `triggerId`, lane/group ID, lock key/owner만 들어간다.
기사 본문, SEC 문서, LLM 입력·출력은 Workflow 인자로 전달하지 않는다.
각 step 반환값도 run ID, raw/event ID, 숫자 통계만 남긴다.

## 실행 주기

Vercel Cron 표현식은 UTC 기준이다.

| lane | 주기 | 대상 |
| --- | --- | --- |
| `sec` | 5분마다 | `SEC_PRODUCTION_INGEST_SCHEDULE`에서 그 시각에 due인 그룹 |
| `news_fast` | 5분마다 | 보도자료 5개 소스, Access Newswire, Nasdaq Trader 2개 소스 |
| `news_slow` | 매시 02분·32분 | OFAC, DOJ, DEA, White House, FDA |

SEC 그룹 주기와 offset은 계속
`lib/sources/sec/forms/common/forms.ts`의
`SEC_PRODUCTION_INGEST_SCHEDULE`이 단일 기준이다. 기존
`scripts/run-sec-production-ingest.mjs`도 같은 상수를 읽기 때문에 Render
롤백 경로와 Vercel 경로의 폼 범위가 어긋나지 않는다.

`vercel.json`은 모든 함수와 Workflow backend에 가까운 미국 동부
Washington, D.C. 리전 `iad1`을 사용한다.

## 재시도, 실행 상한, 중복 방지

- 모든 수집·분석·lock step은 최대 3회 재시도한다.
- retry backoff는 15초부터 지수 증가하며 최대 5분이다.
- Cron 시작 함수 자체 `maxDuration`은 60초다.
- `workflow@4.6.1`에서는 실행 중인 step을
  `Promise.race(step, sleep)`로 취소할 수 없다. timeout 쪽이 먼저 끝나도
  기존 step은 계속 실행될 수 있으므로 이 패턴을 사용하지 않고 각 step 완료를
  끝까지 기다린다. `AbortSignal` 기반
  [in-flight cancellation](https://vercel.com/changelog/workflow-sdk-now-supports-inflight-cancellation)은
  Workflow 5 beta 기능이므로 이 구현에는 사용하지 않는다.
- Workflow SDK가 생성하는 step consumer는 Vercel에서
  `maxDuration: max`인 별도 함수로 실행된다. 실제 함수 timeout이 발생하면
  실행 프로세스가 종료되고 같은 durable step이 retry된다. 실제 상한은 Vercel
  plan과 Fluid Compute 설정을 따른다.
- 외부 수집기의 기존 요청 timeout은 그대로 적용된다. 별도 timeout이 없는
  호출은 Vercel step 함수의 실제 max duration이 최종 강제 종료 경계다.

Cron 중복 호출과 장시간 중첩 실행은
`public.ingest_workflow_locks`의 원자적 lease로 막는다. migration
`20260725050000_ingest_workflow_locks.sql`을 먼저 적용해야 한다.
lease는 step retry 사이에 workflow 제어가 돌아오지 않는 Workflow 4.x 의미를
고려해 2시간으로 잡는다. 안정 Vercel의
[최대 800초 함수 실행](https://examples.vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out)이
최초 1회와
retry 3회 모두 소진되고 backoff까지 더해져도 약 55분이므로 한 시간 이상 여유가
남는다. 각 새 source/SEC 분석 step 직전에 같은 owner로 갱신하며, workflow의
`finally`가 lease를 해제할 때 실행 중인 step이 남지 않는다.

다른 잠금·재시도 의미:

- 함수 timeout이나 결과 보고 직전 crash는 같은 step을 다시 실행할 수 있다.
  DB 쓰기는 기존 dedupe/upsert와 SEC 분석 disposition으로 안전하지만, 저장 전에
  끝난 LLM·외부 provider 요청 비용까지 exactly-once로 만들 수는 없다.
- lease는 실행 중 중첩을 막는다. 정상 완료로 lease를 반납한 뒤 같은 minute의
  늦은 중복 Cron이 도착하면 새 run이 시작될 수 있으나 기존 DB dedupe 계약이
  중복 row를 막는다. 이 경우 소스 fetch는 한 번 더 발생할 수 있다.
- run을 수동 cancel하거나 `finally`가 영구적으로 실행되지 못하면 lock은 삭제되지
  않고 최대 2시간 뒤 만료된다. 이는 겹친 write보다 일시 중단을 택한 fail-safe다.
  실행 중 invocation이 없고 owner가 확인되지 않은 상태에서 lock row를 수동
  삭제하지 않는다.

Workflow step 재시도는 기존 저장 계약을 그대로 쓴다.

- 뉴스 raw: `(source_code, source_unique_id)` 또는 기존 dedupe key
- 뉴스 event: `(source_group, group_dedupe_key)`
- SEC raw: accession/source unique ID
- SEC event: filings group dedupe key
- child tables: 기존 event/raw ID 기준 upsert

SEC raw의 분석 완료 또는 의도적 skip은 기존 `raw_items.metadata`에
`workflow_analysis_status`와 event ID를 기록한다. step 결과 저장 직전
process가 중단돼도 다음 retry/cron이 미완료 raw만 다시 분석한다.

## 로그와 관측

Vercel Project의 Workflows 화면에서 run과 step 진행, retry 수, 입·출력,
시간을 확인한다. Logs에서는 다음 prefix로 검색한다.

- `[source-ingest-cron]`
- `[secSourceIngestWorkflow]`
- `[newsSourceIngestWorkflow]`
- `[runSecGroupRawIngestStep]`
- `[runSecRawAnalysisStep]`
- `[runNewsSourceIngestStep]`
- `[ensureWorkflowLockStep]`
- `[releaseWorkflowLockStep]`

CLI 확인:

```bash
npx workflow inspect runs --backend vercel
npx workflow web --backend vercel
```

Workflow step의 event log에는 provider secret이나 NAS URL 전체를 남기지
않는다. FDA/Accesswire fallback은 기존처럼 bridge host만 redaction해서
남긴다.

## Vercel 환경변수

Production에 먼저 설정:

- `CRON_SECRET`: 16자 이상의 랜덤 문자열. Vercel Cron이 자동으로 bearer
  header에 넣는다.
- `SOURCE_INGEST_WORKFLOW_ENABLED_LANES`: 첫 배포에는 빈 값. 검증 후
  `news_fast`, `news_slow`, `sec`를 쉼표로 점진 추가한다.
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SEC_USER_AGENT`
- `GEMINI_API_KEY`: 뉴스와 SEC Gemini 호출에 공통 사용
- `NEWS_GEMINI_MODEL`: 뉴스 1차 분류와 2차 분석 전용 모델
  (`gemini-2.5-flash-lite` 권장). SEC의 `GEMINI_MODEL`과는 별도 설정
- `FMP_API_KEY`, 필요 시 `POLYGON_API_KEY`
- `NAS_INGEST_TOKEN`, `FDA_INGEST_URL`, `ACCESSWIRE_INGEST_URL`
- 기존 Telegram/alert 전달 환경변수

Workflow가 Vercel에서 사용하는 queue/storage/OIDC는 별도 secret 없이
자동 구성된다.

## 배포 전·후 순서

1. Supabase lock migration을 적용한다.
2. Vercel Production 환경변수를 설정하되
   `SOURCE_INGEST_WORKFLOW_ENABLED_LANES`는 비운다.
3. 배포하고 build에서 Workflow manifest/consumer 생성이 성공했는지
   확인한다.
4. Cron Jobs 화면에 3개 경로와 주기가 보이는지 확인한다.
5. 인증 실패 확인:

   ```bash
   curl -i https://<production>/api/cron/source-ingest/news_fast
   ```

   `401`이어야 한다.

6. `news_fast`만 enable하고 2~3회 run을 관찰한다. 같은 minute에 bearer
   요청을 두 번 보내 두 번째가 `locked`로 끝나는지 확인한다.
7. `news_slow`를 enable하고 정부 사이트 timeout/fallback과 LLM 비용을
   확인한다.
8. `sec`를 enable하고 먼저 인증된 수동 요청으로 한 그룹만 확인한다.

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://<production>/api/cron/source-ingest/sec?group=current_reports"
   ```

9. raw row, event, analysis, ticker/calendar row, alert queue/delivery가 기존
   계약대로 저장되는지 확인한다.
10. 충분한 관찰 뒤 Render SEC cron service를 suspend한다. `render.yaml`
    항목은 삭제하지 않는다.

## Render 병행 운영과 롤백

`render.yaml`과 `npm run sec:ingest-production`은 그대로 남아 있다. 첫
Vercel 배포에서는 Workflow lane enable 값이 비어 있으므로 기존 Render
운영만 계속된다.

주의: Render SEC runner는 새 Supabase Workflow lease를 사용하지 않는다.
Vercel `sec` lane과 Render cron을 동시에 write mode로 오래 켜면 기존
dedupe가 DB 중복은 막더라도 SEC/LLM 요청이 중복될 수 있다. SEC 검증
시간을 짧게 잡고, Vercel 성공을 확인한 뒤 Render cron을 suspend한다.
Render 설정 자체는 삭제하지 않는다.

롤백:

1. Vercel에서 `SOURCE_INGEST_WORKFLOW_ENABLED_LANES`에서 문제 lane을
   제거하고 재배포한다. 긴급 시 Cron Jobs 전체를 disable한다.
2. 진행 중 Workflow run을 Workflows 화면 또는
   `npx workflow cancel <runId>`로 중단한다.
3. Render SEC cron이 suspend 상태라면 다시 resume한다.
4. lock row는 TTL 뒤 자동 인수 가능하다. 즉시 복구가 필요해도 owner를
   확인하지 않은 수동 delete는 하지 않는다.
5. 원인을 고친 뒤 lane 하나씩 다시 enable한다.

## 배포 전 위험

- 2026-07-25 기준 `npm audit --omit=dev --audit-level=high`는 기존
  `next@16.2.6`과 그 전이 의존성 PostCSS·Sharp에서 high 3건을 보고한다.
  Workflow 전환과 분리된 변경으로 Next.js 및 lockfile을 수정 버전으로 올리고 전체
  회귀 검증한 뒤 Production에 배포한다.
- 5분 Cron은 Vercel plan의 Cron 빈도 제한을 확인해야 한다.
- 소스별 세부 deadline 대신 Vercel 함수 max duration을 최종 경계로 사용한다.
  응답이 느린 외부 소스는 함수 timeout까지 점유할 수 있으므로 Production은
  Fluid Compute와 충분한 max duration이 있는 plan을 권장하며, 반복 timeout은
  Workflow step 로그에서 감시한다.
- Workflow step과 storage는 사용량 과금 대상이다. 특히 SEC raw ID별
  분석 step 수와 LLM 비용을 첫 주에 확인한다.
- FDA/Accesswire는 NAS bridge가 없으면 direct fetch 실패 시 해당 source
  step이 retry 후 실패한다.
- SEC 분석은 실제 event/alert 저장까지 수행한다. Production provider
  key와 alert delivery 설정을 확인하지 않은 채 `sec` lane을 enable하지
  않는다.
