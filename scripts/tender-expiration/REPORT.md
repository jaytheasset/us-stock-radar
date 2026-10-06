# Tender expiration Gemini 단일 호출 실험 결과

**판정: 수정 후 재실험 필요. Practical PASS 아님.** 공통 schema 판정은 **수정**이다. 작은 sparse envelope 설계는 유지하되 provider에 보내는 고정값 제약을 수정해야 한다. 이번 실행은 사전 중단 조건에 따라 **1 physical call에서 종료**했고, Applied 필수 연장 검증을 포함한 7건은 실행하지 못했다. 다음 단계 구현이나 추가 유료 호출은 수행하지 않는다.

## 확인한 결과

모델 `gemini-2.5-flash`, HTTP 200, finishReason STOP, 3,506ms. 입력 8,664 / 출력 524 / 합계 9,188 tokens. 실제 청구액은 조회하지 않았다. Retry 0, repair 0, fallback 0, 다른 모델 0. [호출 원장](./results/ledger.json), [호출 전 고정 hash](./results/started.json), [사전 계획](./PLAN.md).

Rumble의 실제 deadline `2025-02-04`와 5pm New York City 시간, 연장/종료 조건은 정확히 추출했다. previous와 change는 생성하지 않았다. 다만 raw output의 `version:"1.0"`, `type:"Expiration"`이 요구된 `tender-monitor-facts-draft-v1`, `expiration`과 달라 strict schema 검증에 실패했다. 코드가 값을 소문자로 바꾸거나 version을 덮어쓰지 않았다.

검토자는 Codex이다. 아래 평가는 selected SEC 원문을 직접 읽은 대조이며 Parser 값이나 다른 LLM의 답을 oracle로 쓰지 않았다. **사람의 독립적인 원문 대조는 미완료**다. 따라서 사람 검토까지 완료된 결과로 표시하지 않는다.

## 공통 schema 초안과 수정 판단

공통 필드는 `version`, `facts[]`, `unresolved[]`다. fact에는 type별 작은 current, 원문에 명시된 경우의 previous, evidence_ids를 둔다. expiration만 current/previous의 `{date, wording}`과 optional change를 구현했다. 없는 FACT type이나 이전 날짜를 nullable 필드로 채우도록 강제하지 않는다. filing identity/form/URL/hash/offset은 입력 Evidence에 있으므로 LLM에 중복 생성시키지 않는다.

사용자 수요 중 가격 변경은 장래 price+currency variant, 이사회 입장 변경은 장래 소수 enum variant, 종료/철회/결과는 장래 status variant로 검토할 수 있다. 이번에는 이를 schema/code/LLM 실험에 추가하지 않았다. 복잡한 조건, waiver, fairness 논리는 Evidence에 남긴다.

수정 제안은 provider-facing 고정 문자열에 `const` 대신 단일 원소 `enum`을 사용하고, 고정 version/type을 prompt에도 명시하는 것이다. 이는 **다음 실험 제안**이며 동결된 `contract.ts`나 이번 raw response를 고치지 않았다.

```json
{
  "version": {"type":"string","enum":["tender-monitor-facts-draft-v1"]},
  "fact_type": {"type":"string","enum":["expiration"]}
}
```

위는 제약 표현 예시이며 `fact_type`이라는 새 출력 필드를 추가하자는 뜻이 아니다. 실제 출력은 계속 fact의 `type`이다. current.date는 원문에 적힌 날짜로 정의하고, 자정 표현/시각/시간대는 wording에 보존한다. 자동 instant 계산이나 time-only deadline 변경 비교는 이 초안으로 검증하지 않았다. change의 두 enum도 실제 연장/명시적 불변만을 위한 이번 제한된 초안이며 모든 deadline 변경을 포괄하는 최종 enum은 아니다.

## 사례별 정확도 표

모든 입력은 [fixtures/inputs.json](./fixtures/inputs.json)에 source-only text와 전체 Evidence ID/URL/hash/offset/completeness로 기록되어 있다. `name`으로 각 사례를 찾을 수 있다. 입력의 검색 점수/사례명/정답은 provider에 전달하지 않았다. 실제 request는 `source` 객체와 공통 지시/schema뿐이다.

|사례 / accession|입력 단위 / 문자|호출|Raw / 형식|원문 대조 결과|최종 상태|
|---|---:|---:|---|---|---|
|최초 Rumble / 0001213900-25-000757|12 / 12,169|1|[raw](./results/initial/structured.txt), [validation](./results/initial/audit.json) FAIL|current 2025-02-04 정확; previous/change 생략 정확; April 30 상한 오인 없음|FAIL — SCHEMA_ERROR|
|연장 Applied / 0001193125-26-026154|9 / 9,749|0|미생성 / N/A|원문 2026-01-27 → 2026-01-28 확인, **Gemini 결과 없음**|NOT RUN|
|변경 없는 Nano amendment / 0001213900-23-055698|12 / 12,384|0|미생성 / N/A|원문 current 2023-07-24, 명시적 불변; 모델 정확성 미검증|NOT RUN|
|여러 날짜 H&E / 0001104659-25-006713|15 / 16,064|0|미생성 / N/A|원문 2025-02-25; May 13은 merger termination bound; 모델 미검증|NOT RUN|
|Carlyle final-results / 0001702510-26-000009|6 / 2,919|0|미생성 / N/A|원문 Jan 21, 2026 이미 expired; historical_only 처리 미검증|NOT RUN|
|조건부 연장 Caza / 0001062993-17-000336|13 / 13,098|0|미생성 / N/A|원문 2017-02-27 11:59pm Pacific; 실제 연장과 조건 구분 미검증|NOT RUN|
|Applied partial / 0001193125-25-335440|4 / 3,304|0|미생성 / N/A|실제 source prefix 5,000자 내 selected slices; deadline 없음; 과잉 확정 여부 미검증|NOT RUN|
|Cidara 미개시 / 0001193125-25-281502|6 / 5,557|0|미생성 / N/A|원문 offer not yet commenced, 현재 날짜 없음; unresolved 처리 미검증|NOT RUN|

**전체 schema PASS 0/1 호출, 실험 계획 수행 1/8.** 날짜/조건 의미는 실행한 1건에서 정확했으나 이를 8건 성공이나 일반 정확도 100%로 해석할 수 없다. 미실행 7건은 모델 FAIL이 아니라 미검증이다.

## 실행한 1건의 상세 원문 대조

Source: [Rumble SEC offer attachment](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm).
Exact [request](./results/initial/request.json), [provider 원 응답](./results/initial/provider-response.txt), [Structured 원문](./results/initial/structured.txt).

|판정 항목|결과|근거|
|---|---|---|
|현재 날짜|PASS|2025-02-04; 직접 expiration을 정의한 문장과 일치|
|시각/시간대/조건|PASS|5:00 p.m. New York City time, unless extend or terminate 포함; wording은 exact source substring|
|이전 날짜|PASS|생성하지 않음; 별도 prior가 명시되지 않음|
|실제 연장 여부|PASS|change 없음; 가능한 연장을 발생한 연장으로 만들지 않음|
|무관한 날짜/시간|PASS|April 30 최대 연장 한도, 9am 발표 시각, 브로커/withdrawal 기한을 current로 대체하지 않음|
|ID 존재/filing 연결|PASS|출력 7개 ID 모두 해당 accession의 입력에 존재|
|인용 근거|PASS, 과다 인용|첫 두 ID에 exact wording, 표지와 정의에도 직접 확인. 일부는 withdrawal/연장 공지 배경이므로 독립적 deadline 근거가 아니며 직접 근거 1~2개로 줄이는 편이 명료함|
|schema 고정값|FAIL|version과 type이 계약과 불일치|
|partial/unresolved 처리|N/A|이 호출로 평가 불가|

직접 근거 ID:

- `tender:df83f703e5f5551b80b7145afc057cd05098af49401e1617e8d7c4918231a0d4` — rendered offset 33868–35029, deadline Q&A.
- `tender:885c62531c420499f4e452b1fcc9985366d852e032fa9ad10f7a4cfef32d4144` — offset 34300–35627, deadline와 April 30 상한을 함께 대조 가능.
- `tender:73d7902262674e2ea3f9f01886a4a703bd363495c8749975ebd9e6ae11aff8ab` — offset 61758–62458, Expiration Time 정의.

추가 citation 중 `tender:8d973188710c5341da081041d92ad7cc01d71785a3c72abfc94706669f1b2471`은 연장 시 공지 절차를 설명할 뿐 현재 날짜의 독립 근거가 아니다. `b992…`, `a264…`도 withdrawal 문맥이다. 이들을 단독으로 deadline 근거로 사용해서는 안 된다. 이번 출력은 다른 직접 근거가 충분하므로 날짜 의미 판정을 뒤집지는 않는다.

## 실패 분류 및 원인 확실성

|분류|관찰 / 판단|
|---|---|
|SCHEMA_ERROR|이번 실행의 확정 실패는 provider-facing 계약의 고정값 불일치. Zod literal이 JSON Schema `const`로 변환되어 전송됨을 exact request에서 확인했다. sparse envelope가 커서 거절된 사례는 아니다.|
|MODEL_ERROR|deadline 의미 오류는 관찰하지 못했다. 고정값 불일치의 내부 원인은 확정 불가하며, schema 제약 미적용으로 보는 것이 유력하다. 과다 인용은 개선점이고 source 확대로 해결할 문제가 아니다.|
|SOURCE_COVERAGE|호출 전 CB 두 질문에서 deadline 누락을 발견해 모든 사례에 동일한 세 번째 질문을 추가했다. 모델 결과를 본 뒤 selector/source를 늘리지 않았다. partial은 의도적 coverage 결손이며 모델 결과는 없다.|
|SOURCE_UNRESOLVED|미개시 Cidara는 현재 날짜를 원문으로 확정할 수 없다. 기대된 unresolved 사례이지 관찰된 모델 실패는 아니다. 서로 충돌하는 두 deadline 사례까지 검증한 것은 아니다.|

[Gemini 공식 Structured Outputs 문서](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en)는 지원 subset과 미지원 제약 무시 가능성을 설명하고 string의 `enum`을 명시한다. `const`는 지원 목록에 없다. 따라서 `const`가 적용되지 않았다는 설명은 **근거 있는 추론**이지만 provider 내부 동작을 확인한 확정 원인은 아니다. 다음에는 single-value enum과 명시적 prompt를 사용하고 새로운 실험 계획을 먼저 고정해야 한다. 이번 실행의 값은 수정하지 않는다.

## 최종 판단과 남은 검증

- **expiration: 수정 후 재실험 필요.** 현재 결과만으로 Structured Monitor에 안정적으로 사용할 수 있다고 승인할 수 없다. 특히 필수 Applied old/new 관계, final-results/partial/unresolved 안전성은 Gemini 미검증이다.
- **공통 schema: 수정.** 작은 envelope와 sparse fact는 유지하고 Gemini용 제약 표현을 수정하는 방향이다. 큰 nullable schema나 더 많은 FACT type으로 확장할 이유는 없다.
- **후보로 계속 검토할 가치: 있음.** 최초 filing 1건에서 원문 deadline/조건/무관 날짜 구분은 정확했다. 단, 이 판단은 제한적 가능성에 대한 평가이며 Practical PASS가 아니다.
- 사람 독립 대조, 시간만 변경, 다중 offer/상충 deadline, 명시적 앞당김, 반복 실행 안정성은 미검증이다. 이번 단계에서 추가 구현/추가 실험을 하지 않는다.

## 산출물과 검증 상태

- `prepare.mjs`: 기존 Tender Evidence search/read 사용, public SEC source 수집 및 최소 선택 입력 감사 자료.
- `contract.ts`: experiment-only sparse schema, 공통 prompt, 형식/link validator.
- `run.mjs`: Gemini direct REST, 1회 호출 잠금, raw 응답/usage 보존, fail-stop.
- `run.test.mjs`: 7개 offline 검사 PASS. 성공/timeout/HTTP429/비JSON 후 재호출 거부, 의미 오류를 고치지 않는 validator 확인.
- 전체 `npm run typecheck` PASS. `verify-audit.mjs`의 frozen hash/source/request/raw-output/ID 검증 PASS. `.gitattributes`는 이 실험 디렉터리의 자동 줄바꿈 변환을 막아 감사 hash를 보존한다.
- 제품 코드/기존 Parser/Selector 변경 없음. DB/Reader/Monitor/Matcher/Alert/다른 FACT/서버/cron/외부 발송/merge/push/deploy 수행 없음. UI 변경이 없어 화면 검증은 N/A.
- 필요한 source/request/raw output은 실험의 재검토용 감사 자료이며 운영 FACT persistence나 snapshot 저장 기능이 아니다.

작업 기준은 `2d5928ad9b2dce9e4a9d4d48d7c2a318080e2a88`, 지정 87db worktree detached HEAD다. 최종 commit과 clean 상태는 완료 메시지에 기재한다. 기존 인계의 local/GitHub main `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`, Vercel `bf586ed559c7f4bea6a171790ab7b563cabc7161` READY 정보는 이번 실험에서 재조회하지 않았다. DB/migration/환경/cron 상태 역시 재검증·변경하지 않았다. 운영 코드 일치나 배포 완료를 주장하지 않는다.

오프라인 재검토 명령(유료 호출 없음):

```powershell
node --no-warnings --experimental-strip-types scripts/tender-expiration/verify-audit.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-expiration/run.test.mjs
node --no-warnings --experimental-strip-types scripts/tender-expiration/run.mjs
npm run typecheck
```

`--live` 재실행과 입력 재생성은 started marker로 잠긴 상태다. marker를 삭제해 실패를 덮어쓰거나 같은 filing을 재호출하지 않는다. 이번 실험은 종료 상태로 보존한다.
