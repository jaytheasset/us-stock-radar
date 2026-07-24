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

## 재시도, timeout, 중복 방지

- 모든 수집·분석·lock step은 최대 3회 재시도한다.
- retry backoff는 15초부터 지수 증가하며 최대 5분이다.
- source 1개와 SEC 분석 1건의 durable timeout은 12분이다.
- SEC raw 그룹 수집 timeout은 8분이다.
- Cron 시작 함수 자체 `maxDuration`은 60초다.
- Workflow SDK가 생성하는 step consumer는 Vercel에서 허용되는 최대
  function duration을 요청한다. 실제 상한은 Vercel plan과 Fluid Compute
  설정을 따른다.

Cron 중복 호출과 장시간 중첩 실행은
`public.ingest_workflow_locks`의 원자적 lease로 막는다. migration
`20260725050000_ingest_workflow_locks.sql`을 먼저 적용해야 한다.

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
- `OPENAI_API_KEY` 또는 현재 뉴스 분석 provider 설정
- `GEMINI_API_KEY`와 현재 SEC provider/model 설정
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
- 12분 step은 Hobby의 짧은 function duration과 맞지 않을 수 있다.
  Production은 Fluid Compute와 충분한 max duration이 있는 plan을 권장한다.
- Workflow step과 storage는 사용량 과금 대상이다. 특히 SEC raw ID별
  분석 step 수와 LLM 비용을 첫 주에 확인한다.
- FDA/Accesswire는 NAS bridge가 없으면 direct fetch 실패 시 해당 source
  step이 retry 후 실패한다.
- SEC 분석은 실제 event/alert 저장까지 수행한다. Production provider
  key와 alert delivery 설정을 확인하지 않은 채 `sec` lane을 enable하지
  않는다.
