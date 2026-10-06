# v3 Rumble 단일 canary — 호출 전 계획

Base `f1796606bf7a70f65cf6902a195325e1560182b6`, 동일 87db detached worktree.
Run identity `tender-expiration-v3-rumble-canary-20261006`. v1/v2 전체 기존 파일은 byte-identical 보존한다. 이번 추가 파일은 v3 디렉터리에만 둔다.

## 유일한 호출의 목적과 종료 조건

Rumble SC TO-I `0001213900-25-000757`을 `gemini-2.5-flash`로 정확히 한 번 호출해 긴 provenance ID 생성 오류가 짧은 opaque enum ref로 해소되는지 검증한다. 성공/실패/HTTP 오류/timeout/형식 오류에 관계없이 1회에서 종료한다. retry/repair/fallback/두 번째 호출은 없다. Applied 및 나머지 7건은 실행하지 않는다.

확인할 오류는 잘못된 current 날짜, 없는 previous, 금지 필드, invalid/duplicate ref, 유효하나 deadline의 직접 근거가 아닌 ref 선택, 사전 mapping과 실제 source의 불일치다. Provider/schema, local strict, provenance, 직접 원문 의미 대조를 각각 판정한다. 전부 통과해야 canary PASS다. PASS여도 전체 expiration Practical PASS나 다음 호출 승인이 아니다.

## 고정 입력 / 구조

v2 동결 `run/source.json`의 동일 12개 Evidence를 동일 순서와 동일 text로 재사용한다. 새 acquisition/Selector/prepare 변경이 없다. 원문 text는 12,169자다. refs는 실제 배열 순서에 따라 동적으로 E1, E2, …를 부여한다. 실제 수에 맞는 ref enum을 생성하며 12개를 코드에 하드코딩하지 않는다. ref에 정답 의미를 붙이지 않는다.

Provider source는 form, coverage(partial/unavailable/external-reference/selection 상태), evidence의 ref/text뿐이다. 실제 ID, accession, document identity, URL, hashes, location/offset/representation metadata는 provider source에서 제거한다. SEC 원문 자체에 존재하는 날짜/URL/숫자는 원문 변조를 피하기 위해 제거하지 않는다. metadata 필드 제거와 원문 텍스트 편집을 구별한다.

별도 evidence-map에는 실제 ID, accession/form/document identity와 URL, source/rendered/text hashes, location을 원형대로 보존한다. provider-source/map/schema/prompt/request 및 각 SHA256을 호출 전에 동결한다. 전송 body는 저장한 request.json 바이트 그대로다. mapping hash도 started/audit에 연결한다.

출력은 `{facts:[{type:"expiration",current:"YYYY-MM-DD",previous?:"YYYY-MM-DD",evidence_refs:["E…"]}],unresolved:[]}`다. version/filing_kind/wording/change/extended/unchanged/changed/evidence_ids/provenance metadata 없음. time/timezone/조건은 재작성하지 않고 원문 Evidence에 남긴다.

Provider schema는 object/properties/required/additionalProperties/type/enum/array/items/minItems/maxItems만 사용한다. `const`/`pattern`/`format` 등에 의존하지 않는다. facts만 maxItems=1이며 evidence_refs에는 maxItems를 넣지 않는다. 날짜 형식과 중복 ref는 local validator가 확인한다.

## 원문 기준 기대와 정보 분리

현재 expiration은 2025-02-04; previous 없음; unresolved=[]. April 30은 최대 연장 한도이지 현재 expiration이 아니다. broker/withdrawal/announcement 시간을 current로 대체하면 FAIL이다. 직접 근거인 E1/E2/E4/E12는 결과 검토에만 참고하며 expected date/정답 refs/기존 Gemini 응답/Parser 값/이 계획을 request에 넣지 않는다.

형식 검사 뒤에만 frozen mapping lookup을 실행한다. map hash, 같은 accession, 실제 ID 존재/원본 mapping 동일성을 검사한다. invalid ref를 수정/삭제/유사 ID로 보완하지 않는다. 코드가 날짜나 Evidence를 재선택하지 않는다. 여러 직접 citation은 허용하며 별도 citation 수 최적화를 하지 않는다.

## 실패 분류와 범위

충분한 원문/refs에서 잘못된 날짜나 ref 선택은 MODEL_ERROR다. SOURCE_COVERAGE / SCHEMA_ERROR / SOURCE_UNRESOLVED와 구분하며 모델 오류를 숨기는 source 확대는 없다. 형식과 provenance 검사만 자동화하고 SEC 의미 판단은 Codex가 selected 원문을 직접 읽어 대조한다. 사람 독립 검토 완료를 주장하지 않는다.

Provider raw/Structured raw 및 resolution 자료는 요청된 실험 감사자료일 뿐 제품 persistence/snapshot 기능이 아니다. DB/Reader/Matcher/Monitor/Alert/다른 FACT/collector E2E/merge/push/deploy/cron/외부 발송 없음. 최종 보고 후 승인 전에는 다음 호출을 하지 않는다.
