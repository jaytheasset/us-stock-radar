# Rumble expiration v3 단일 canary

**최종 Canary FAIL — MODEL_ERROR(직접 근거가 아닌 ref 선택).** A Provider/schema, B local strict, C provenance mapping은 모두 PASS다. 현재 날짜도 정확하다. 그러나 D SEC 의미 대조에서 E5/E8이 withdrawal 문맥으로 확인돼, 요청의 “Evidence ref가 expiration의 직접 근거가 아님 → FAIL” 조건에 걸린다. 단순히 citation 개수가 많다는 이유로 실패시킨 것은 아니다.

v3는 정확히 **1 physical provider call** 후 종료했다. 원 응답/ref를 수정·삭제하지 않았고 재호출하지 않았다. Applied 및 나머지 사례 호출은 0이다. 전체 expiration FACT는 여전히 Practical PASS가 아니다.

## v2 → v3 contract

|항목|v2|v3|
|---|---|---|
|LLM source|실제 ID/document/URL/hash/offset/text|form/coverage 및 `{ref,text}` 배열|
|current/previous|`{date,wording}`|`YYYY-MM-DD` 문자열, previous optional|
|근거 선택|긴 evidence_ids 복사|실제 입력에서 동적으로 만든 opaque evidence_refs enum|
|실제 provenance|모델에 전달|호출 전 동결한 별도 시스템 mapping|
|Provider date 제약|pattern|문자열 타입만; YYYY-MM-DD는 local 검사|
|중복 ref|해당 없음|local 검사에서 거부|
|wording|모델 인용 출력|출력에서 제거; 시간·시간대·조건은 연결된 원문에 보존|

최상위 facts/unresolved, lowercase expiration, facts 최대 1개는 유지했다. version/filing_kind/change/extended/unchanged/changed/actual evidence_ids/URL/hash/offset/document metadata는 출력하지 않는다. evidence_refs에 maxItems를 두거나 “하나만 고르라”는 지시를 추가하지 않았다.

## 실제 입력과 동결 자료

Run ID: `tender-expiration-v3-rumble-canary-20261006`.
Target: Rumble Inc., SC TO-I, `0001213900-25-000757`.

[실제 provider-source](./run/provider-source.json)의 구조는 다음과 같다. 아래 text는 생략 표기이며 실제 파일에는 원문 전체 selected text가 있다.

```json
{
  "form": "SC TO-I",
  "coverage": {
    "partialDocuments": [],
    "unavailable": [],
    "externalReferences": "not-resolved",
    "selection": "bounded source slices; not the complete filing"
  },
  "evidence": [
    {"ref":"E1","text":"…"},
    {"ref":"E2","text":"…"}
  ]
}
```

실제로는 E1–E12 **12개**, 원문 합계 **12,169자**다. v2 Evidence 배열 순서와 text가 모두 동일하다. 추가 fetch/Selector 확대/prepare 변경 없음. 정답 날짜/정답 ref/기존 모델 응답/Parser 값은 provider input에 없다.

제거한 metadata는 실제 tender SHA ID, accession, document 객체와 documentId/URL/role/format/completeness, sourceHash/renderedHash/textHash, location의 start/end/heading/representation/offsets다. 필요한 partial/unavailable 상태는 coverage에 남겼다. 원문 자체의 숫자·URL·날짜는 원문 보존을 위해 손대지 않았다.

시스템 측 [evidence-map.json](./run/evidence-map.json)은 실제 ID, accession, form, document와 URL, 모든 hash와 location을 보존한다. [frozen.json](./run/frozen.json)에 provider-source/map/schema/prompt/request/코드/계획 각 파일의 SHA256 및 v1/v2 전체 기존 파일 hash가 있다.

- Mapping SHA256: `ec8d99cfce121d41ca2b290ee27f0817dda2448618f279010e4fa99d546c6959`
- Exact request SHA256: `ceb9e3cd606cb43e9be06f4014b9203024e8b5fb8f292c430dd0e3cabdedd22e`
- [실제 provider-facing schema](./run/provider-schema.json)
- [Exact prompt](./run/prompt.txt), [v2 대비 exact 변경 문장](./run/prompt.diff)
- [Exact HTTP request body](./run/request.json), [호출 전 계획](./PLAN.md)

Provider schema는 기본 object/string/array, properties/required/additionalProperties, enum, items/minItems/maxItems만 사용한다. type은 `["expiration"]`, ref enum은 실제 input 배열을 순회해 생성했다. const/pattern/format/추가 길이 제약 없음. Request 파일의 저장된 바이트를 그대로 전송했다.

## 전체 ref mapping

아래는 기존 배열의 순서만 반영하며 이름에 의미를 넣지 않았다. provider에는 이 actual ID 표를 전달하지 않았다.

|ref|실제 Evidence ID|
|---|---|
|E1|tender:df83f703e5f5551b80b7145afc057cd05098af49401e1617e8d7c4918231a0d4|
|E2|tender:885c62531c420499f4e452b1fcc9985366d852e032fa9ad10f7a4cfef32d4144|
|E3|tender:afb64b21896117f314674d602e86ead232698e99f4f8f4cd1b321bfc7658f4c4|
|E4|tender:214184f7b5db6b0f294fe3bab5239cb7c5d0b7b63f93a8e74c8771435db97dca|
|E5|tender:b992e684a464e18b7618bddffcf681ff38b38399bfe45f0b1f549a36582a195e|
|E6|tender:8d973188710c5341da081041d92ad7cc01d71785a3c72abfc94706669f1b2471|
|E7|tender:f5e469aa9c11927992fc3d8092f812cd058522fde128465c934f4e082b061242|
|E8|tender:a264004acb9f9abd311d3c8d7fe8f815d8a5032b42880ac39f0729e2dd04f880|
|E9|tender:c9de9d778ab1dc31b944babca8ebfb5ed895d0acc2af5e79b7476352e8db73b6|
|E10|tender:5429bbbac58c3547363943778e29446b4a160b0c8df0f97482b77ea25f257f6f|
|E11|tender:c264e59c5f85a532d38cd7e37fe234a8b8cd44d78826d4b1a17d0893497665ae|
|E12|tender:73d7902262674e2ea3f9f01886a4a703bd363495c8749975ebd9e6ae11aff8ab|

## 호출 결과와 원 응답

|항목|값|
|---|---|
|Model / modelVersion|gemini-2.5-flash / gemini-2.5-flash|
|v3 physical calls|**1**|
|retry / repair / fallback / 타 모델|모두 0|
|다른 filing calls|0|
|HTTP / finishReason|200 / STOP|
|Latency|1,710ms|
|Tokens|prompt 3,474 / candidates 48 / total 3,522|
|Generation 설정|temperature 0, thinkingBudget 0, maxOutputTokens 3500; v2 동일|

[Provider raw](./run/provider-response.txt), [Structured raw](./run/structured.txt), [audit](./run/audit.json), [ledger](./run/ledger.json). v1/v2 각각 기존 1회는 별도 run이며 이번 1회를 합친 총 이력은 3회다. 실제 청구액은 미조회다.

```json
{"facts":[{"type":"expiration","current":"2025-02-04","evidence_refs":["E1","E2","E4","E5","E8","E12"]}],"unresolved":[]}
```

## 분리 판정

|Gate|결과|확인|
|---|---|---|
|A Provider/schema|**PASS**|정상 HTTP/STOP/JSON; provider에 전달한 구조/enum/required 필드 충족|
|B local strict|**PASS**|날짜 형식, ref 존재·중복 없음, facts 수, 금지 필드 없음, previous 생략|
|C provenance mapping|**PASS**|6/6 ref가 사전 map을 통해 동일 accession 실제 ID로 정확히 연결; map hash 동일|
|D SEC 의미|**FAIL**|현재 날짜는 정확하지만 E5/E8은 current expiration 직접 근거가 아님|

형식 gate 후에만 mapping lookup을 수행했다. [provenance-audit.json](./run/provenance-audit.json)에 각 ref와 actual ID 연결이 있다. E5/E8도 모델 선택 그대로 resolve했으며 다른 ref로 교체/삭제하지 않았다. date/previous를 비교하거나 교정하는 코드가 없다.

## 직접 원문 대조

Source: [Rumble SEC offer attachment](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm). Codex가 실제 selected text를 읽어 대조했다. 별도 사람 독립 검토는 미완료다. Parser 값이나 v1/v2 응답을 정답으로 사용하지 않았다. 상세 판단은 [semantic-review.json](./semantic-review.json)에 있으며 호출 직후 자동 audit의 pending 상태를 수정하지 않고 별도로 기록했다.

|선택 ref|직접 근거?|원문 문맥|
|---|---|---|
|E1|예|Offer will expire on February 4, 2025라는 명시 문장|
|E2|예|동일 expiration 및 별개의 April 30 최대 연장 한도|
|E4|예|표지에서 offer/proration/withdrawal의 February 4 expiration을 명시|
|E5|아니오|February 4 이전 withdrawal 가능, 연장 시 withdrawal 가능 기간 설명. 단독으로 현재 offer expiration을 선언한 문장이 아님|
|E8|아니오|Withdrawal Rights에서 February 4 이후에도 acceptance 전 withdrawal 가능하다는 설명. 현재 expiration 정의가 아님|
|E12|예|Expiration Time의 날짜·시간을 직접 정의|

current `2025-02-04`, previous 없음, unresolved=[]는 정확하다. April 30 한도, broker/withdrawal/payment/announcement 날짜로 current를 바꾸지 않았다. 실제 연장을 새로 주장하지 않았고 제거된 필드를 출력하지 않았다. 시간·시간대·조건은 E1/E2/E4/E12 원문에 그대로 남아 있다.

6개 citation 중 4개는 직접 근거이며 중복적인 직접 인용 자체는 개선점일 뿐 FAIL 사유가 아니다. **별도 FAIL 사유는 E5/E8의 직접성 부족**이다. 사용자가 제시한 직접 근거 기준을 완화해 PASS 처리하지 않았고, citation 최적화/후처리/추가 호출도 하지 않았다.

## 실패 분류와 다음 단계 판단

- **MODEL_ERROR:** 충분한 source와 직접 refs가 있는데 withdrawal refs도 선택했다. 날짜 의미 오류나 identity hallucination은 이번 호출에서 관찰되지 않았다.
- SOURCE_COVERAGE 아님: 직접 expiration source와 refs가 이미 충분하다. source/Selector 확대 없음.
- SCHEMA_ERROR 아님: schema와 lookup은 선택한 ref를 손실 없이 표현·연결했다. Ref enum은 존재 여부를 제한하며 의미 관련성은 보장하지 않는다.
- SOURCE_UNRESOLVED 아님: 현재 expiration 원문은 명확하다.

**Applied extension 1건을 향후 실험할 가치는 있다.** 이번 한 번에서는 short enum ref가 긴 ID 생성 오류 없이 작동했고 token 사용도 줄었다. 다만 반복 안정성은 증명되지 않았고, 이번 strict canary는 직접 근거 조건 때문에 FAIL이다. 직접 citation 처리 기준/지시를 검토한 후 승인받아 다음 실험을 별도로 계획해야 한다. Applied를 지금 실행하거나 전체 expiration에 Practical PASS를 부여할 근거는 없다.

## 실제 변경 파일과 검증

모든 추가 파일은 `scripts/tender-expiration/v3/` 아래에만 있다:

- `contract.ts`, `boundary.mjs`, `run.mjs`, `run.test.mjs`, `verify-audit.mjs`.
- `PLAN.md`, `REPORT.md`, `semantic-review.json`.
- `run/provider-source.json`, `evidence-map.json`, `provider-schema.json`, `prompt.txt`, `prompt.diff`, `request.json`, `frozen.json`.
- `run/started.json`, `provider-response.txt`, `structured.txt`, `audit.json`, `provenance-audit.json`, `ledger.json`.

오프라인 검사 9/9와 전체 typecheck PASS. 검사는 원문/순서 보존, metadata 제외, dynamic enum, 날짜/중복 검증, 금지 필드 거부, hash/foreign map 거부, 의미값 무수정, invalid ref gate, single-call 재실행 방지를 확인했다. v1/v2 모든 파일은 기준 commit 대비 byte-identical이며 source/contract/request/map은 호출 전 hash와 동일하다. 제품 collector E2E 및 UI는 이번 범위가 아니며 수행하지 않았다.

작업 base `f1796606bf7a70f65cf6902a195325e1560182b6`, 같은 87db detached worktree. 최종 commit/clean 상태는 완료 메시지에 기록한다. 기존 인계 main/GitHub `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`, Vercel `bf586ed559c7f4bea6a171790ab7b563cabc7161` READY는 재조회하지 않았다. 운영 코드 일치나 배포 완료를 주장하지 않는다.

DB/persistence/snapshot/Reader/Matcher/Monitor/Alert/다른 FACT/Parser/prepare/collector 변경 없음. Main merge/push/deploy/cron/외부 발송 없음. Requested source/map/raw/lookup 감사 파일은 실험 자료이며 운영 FACT 저장 기능이 아니다.

```powershell
node --no-warnings --experimental-strip-types scripts/tender-expiration/v3/verify-audit.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-expiration/v3/run.test.mjs
```

이번 단일 canary는 종료했다. 승인 전 다음 호출은 하지 않는다.
