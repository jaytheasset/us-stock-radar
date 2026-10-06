# Tender 3 FACT — 최종 실험 보고

**대표 실제 SEC 사례 범위에서 3/3 Practical PASS. 여기서 STOP한다.**

expiration → offer_price → board_recommendation 순서로 이전 FACT의 판정 이후 다음 FACT를 준비·호출했다. 신규 physical provider call은 **15회**, 모두 **gemini-3.5-flash**, case당 해당 FACT에1회다. 기존 expiration3건은 재호출하지 않았다. 신규15건의 원응답·값·ref는 수정하지 않았으며 retry/repair/fallback은0이다.

이는 작은 사전 선정 대표 세트에서의 실험 판정이다. 운영 정확도 추정, 독립적인 사람의 검수, production-ready 판정을 뜻하지 않는다. SEC 의미 판정은 Codex가 실제 selected 원문을 직접 읽고 수행했다.

## FACT별 결론과 전체 정확도

|FACT|대표 사례|신규 calls|Schema/local/provenance|SEC 의미 / support|결정|
|---|---:|---:|---|---|---|
|[expiration](expiration/REPORT.md)|8 (기존3+신규5)|5|신규5/5 모두PASS|8/8 PASS|최소 날짜 schema 유지|
|[offer_price](offer_price/REPORT.md)|5|5|5/5 모두PASS|5/5 PASS|현금 주당 가격 schema 유지|
|[board_recommendation](board_recommendation/REPORT.md)|5|5|5/5 모두PASS|5/5 PASS|명시적 추천 enum 유지|

18개 FACT-case 관찰 중 신규15개는3.5 호출 결과다. 기존 Rumble expiration1건은 사용자 지시대로2.5 frozen 결과를 v3.1 support 기준으로 재사용했다. 같은 filing을 다른 FACT로 검증한 사례가 있으므로18개 고유 filing이라는 뜻은 아니다.

Applied Therapeutics **0001193125-26-026154**는 **previous2026-01-27 → current2026-01-28**을 정확히 추출했다. [기존 원응답](../tender-expiration/v5_applied_35/run/structured.txt)과 direct refs E1/E2/E5/E6의 근거를 보존했다.

## 최소 schema 판단

- expiration: `type`, `current: YYYY-MM-DD`, optional `previous`, `evidence_refs`. 시간·시간대·조건은 Evidence에 유지한다. 별도 `change_type`은 추가하지 않았다.
- offer_price: `current`/optional `previous`에 `{amount, currency_text, unit:"cash_per_share"}`를 묶는다. `$`는 source notation이며 코드나 모델이 ISO USD로 확장하지 않는다. 복합 consideration/exchange ratio는 이번 계약에 넣지 않았다.
- board_recommendation: `current`/optional `previous`는 `accept | reject | no_recommendation`. 명시적 no recommendation과 정보 없음은 다르다. 임시 take-no-action/pending evaluation은 이 세 enum으로 강제하지 않는다.

모두 독립된 `{facts: [0..1개], unresolved: string[]}` envelope를 유지한다. previous는 명시적 source가 없으면 생략한다. source가 확정값을 지원하지 않으면 sparse facts와 설명을 남긴다. version/filing_kind/provenance 기술정보는 LLM 의미 출력에서 제외하고 frozen run metadata로 보존한다. FACT별 전체 schema·각 case raw JSON·원문 링크·정확도 표·근거 검토는 위 개별 보고서에 있다.

## 원문과 모델을 분리한 검증

입력은 기존 Tender Evidence index/search/read에서 얻은 SEC source text와 opaque refs다. 가격/board는 고정된 공통 질문3개×상위5 hit를 중복 제거하여 선정했다. 의미 regex Parser, Primary summary/score/signal, transaction_fingerprint, Parser semantic 값, 이전 Gemini 분석은 의미 근거에 사용하지 않았다. 호출 전 expected answer는 manifest에만 저장했고 provider-source/request에는 넣지 않았다.

호출 전 source/provider-source/map/prompt/schema/exact request bytes/hash/run identity를 고정했다. fetch 전에 exclusive started marker를 기록했다. provider schema/local 형식 검사를 통과한 뒤 frozen identity lookup으로만 실제 Evidence ID를 연결했다. 원문 ID/URL/hash/offset/document identity는 provider의 기술 metadata 입력에서 제거하고 mapping에 보존했다. 단, SEC 텍스트 자체의 URL 등은 원문 내용으로 남을 수 있다.

각 emitted current/previous claim마다 selected direct ref 최소1개를 확인했다. 추가 ref도 모두 직접 읽었고 관련·비모순 corroboration만 허용했다. 예컨대 Rumble 가격 E2/E6는 현금 전체 claim의 corroboration이며 E1/E5가 direct다. DXL 가격 E6/E7의 Offer Price 인상은 E1/E2의 현금 주당 정의와 같은 offer에 속한다. 검토되지 않은 ref를 자동 통과시키지 않았다.

Validator는 의미를 계산·정규화·보정하지 않는다. `verify-completed.mjs`는 저장된 원응답과 extraction text의 일치, frozen hash, call ledger, lookup, 사람이 읽을 수 있도록 작성한 Codex 검토 기록의 완전성을 확인한다. 이것은 새로운 의미 판정기가 아니다. unresolved 내 ref는 narrative 문자열이며 typed claim ref와 같은 production consumer 계약은 아직 없다.

## 실패 분류와 수정 이력

|분류|신규 실험 관찰|
|---|---|
|MODEL_ERROR|0. adequate source에서 잘못된 current/previous/추천 또는 부적절 ref 선택 없음|
|SCHEMA_ERROR|0. 신규 output의 형식/현재 scoped 의미 표현 실패 없음|
|SOURCE_COVERAGE|Applied partial expiration 및 Cidara board 미제공 추천 source에서 올바른 abstention. 모델 실패로 세지 않음|
|SOURCE_UNRESOLVED|Cidara expiration 미개시 원문에서 현재 expiration 미확정; 올바른 abstention|
|PROVIDER_MODEL_UNAVAILABLE|신규0. 기존 Applied v4의2.5 HTTP404는 불변 보존|
|PREFLIGHT_TEST_ERROR|신규0. 기존 Nano v6 사전 테스트 실패·0호출은 불변 보존|

Carlyle final-results는 source가 historical expired를 명시하므로 active scheduled expiration 범위에서 abstention하는 정상 사례다. 별도 status/final_results FACT를 만들지 않았다. partial expiration은 확정을 피했으나 설명에 partial을 명시적으로 반복하지 않은 표현상 한계가 있다.

이번 batch 내 호출 후 contract/prompt/Selector 변경은0이다. 과거 Rumble v3의 direct-only FAIL과 v3.1 support 정책 재평가 PASS를 모두 남겼다. 과거 실패를 성공 결과로 덮어쓰거나 이번15회에서 재시도하지 않았다.

## 다음 단계 가능성과 남은 리스크

**공통 envelope 설계 검토로 갈 근거는 확보했다.** 그러나3개를 동시에 한 번에 추출하는 통합 schema/단일 호출은 미검증이다. 독립 FACT 결과의 PASS를 통합 extraction PASS로 간주하면 안 된다. 이번에는 union schema를 구현하지 않았다.

**사용자 승인 후4·5번째 FACT의 독립 실험으로 확장할 수 있는 후보 수준이다.** 자동으로 확장하거나 product 구현으로 넘어가지는 않는다.

- expiration: 날짜만 추출하며 시간만 바뀌는 amendment, 복수 offer 충돌, timezone 변환은 미검증이다. Rumble initial은3.5 재시험을 하지 않았다.
- offer_price: literal currency notation만 검증했다. ISO 통화 식별, 서로 다른 통화/단위 비교, composite/exchange/range 및 partial/불확실 가격의 live abstention은 미검증이다.
- board: revised amendment의 현재 reject와 다른 merger의 철회 구분은 통과했다. 실제 tender accept↔reject 전환, previous enum emission, 단독 pending/take-no-action 사례는 미검증이다. Cidara의 미제공 exhibit에서 추천이 존재할 가능성은 열어 둔다.
- 공통: 작은 의도적 대표 세트이며 무작위 holdout/반복 안정성/독립 human review/collector E2E를 수행하지 않았다. source selection의 일반 recall 및 production consumer 정책을 검증한 것이 아니다.

세 FACT 모두 Structured Monitor 후보로 계속 검증할 가치가 있다. 다만 운영용 Monitor/Alert의 자동 판단 신뢰도를 이번 결과만으로 확정할 수는 없다.

## 검증·변경 범위·작업 상태

작업 경로: `C:\Users\PC\.codex\worktrees\87db\US-Stock Radar`.
Base: `276bb1db9d6cd3ac7cad2d8d52fe01df40b64b55`, detached candidate HEAD.
변경은 `scripts/tender-fact-batches/` 신규 실험 코드·선별 source·감사 산출물·보고서만이다. 기존 `scripts/tender-expiration/**`는 base의 모든 추적 파일과 byte hash가 일치한다.

검증 결과: offline tests10/10 PASS, `npm run typecheck` PASS, completed audit 신규15건 모두PASS. 실제 UI 변경이 없어 PC/mobile 화면 검증은 해당 없음이다. 요청된 source slices와 감사 자료만 보존하며 전체 SEC 원본 HTML 묶음은 추가하지 않았다.

재실행 가능한 읽기 전용 검사(추가 유료 호출 없음):

```powershell
node --no-warnings --experimental-strip-types scripts/tender-fact-batches/verify-completed.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-fact-batches/runner.test.mjs scripts/tender-fact-batches/price-contract.test.mjs scripts/tender-fact-batches/board-contract.test.mjs
npm run typecheck
```

실행 완료된 live/freeze 명령을 다시 실행하지 않는다. 기존 started/frozen 파일은 삭제·덮어쓰기하지 않는다. 완료 commit 및 clean 상태는 최종 채팅 보고에서 확인한다.

DB migration/persistence/job/snapshot/Reader/Matcher/Monitor/Alert/UI/Parser semantic/cron/외부 발송 변경 없음. offer_status/final_results_observed 구현·호출 없음. main merge/push/deploy 없음. 환경변수 수정 없음. 로컬 main/GitHub main/Vercel 배포 상태는 이 후보 실험의 검증 범위 밖이라 최신 일치 여부를 확인하지 않았고 운영 완료를 주장하지 않는다. 포트3110을 조작하지 않았다.

Gemini structured-output 형식 참고: [공식 문서](https://ai.google.dev/gemini-api/docs/structured-output). 문서 예시의 상위 모델을 사용하지 않고 사용자 지정3.5 ceiling을 코드와 frozen request에서 고정했다.
