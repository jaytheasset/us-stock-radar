# Tender expiration v2 — Rumble 단일 canary 사전 계획

기준 commit `fc5cc0a51af2f60b498aff54a57483accd37cd52`, 지정 87db worktree, detached HEAD.
별도 run identity: `tender-expiration-v2-rumble-canary-20261006`. v1 파일/marker/hash/실패 응답을 일절 수정하지 않는다.

## 목적과 통제 변수

Gemini provider 계약 수정만 시험한다. v1의 동일 Rumble SEC Evidence 12개와 원문/순서/coverage/provenance를 그대로 사용한다. 새로운 source 수집/Selector 수정/요약/Parser 의미값/기존 AI 응답은 입력하지 않는다. 모델 `gemini-2.5-flash`, temperature 0, thinkingBudget 0, maxOutputTokens 3500은 동일하다.

v2 provider output은 `{facts:[], unresolved:[]}`만 가진다. version/filing_kind/change/extended/unchanged/비교 상태는 출력하지 않는다. fact는 type/current/evidence_ids가 필수이며 previous만 optional이다. type은 `enum:["expiration"]`이고 `const`는 전혀 사용하지 않는다. unresolved는 string[]다. version은 시스템 metadata이며 이번에는 metadata persistence도 만들지 않는다.

Prompt에는 lowercase expiration, 다른 capitalization 금지, version/change 등 제거 필드 금지, optional previous 생략, unresolved string[]를 명시한다. 기존 current/prior 의미, unrelated date 배제, 시간·시간대·조건 exact wording, calendar-date 유지, partial/만료/불확실 원문 처리 원칙은 유지한다. 제거된 change 출력을 요구하던 문장과 unresolved 객체 reason 지시만 새 구조에 맞춘다. 정확한 문장 차이는 `prompt.diff`에 저장한다.

## 유일한 호출

- 대상: Rumble Inc., SC TO-I, `0001213900-25-000757`.
- 목적: single-value enum 및 작은 envelope가 형식 계약을 지키면서 기존 올바른 expiration 의미를 보존하는지 확인.
- source: v1 `fixtures/inputs.json`에서 해당 filing의 **source 객체만** 추출. 사전 기대값/사례 이름/검색 점수/이전 output은 Gemini에 전달하지 않는다.
- 원문 기준: current 2025-02-04, 5pm New York City time, unless extended/terminated를 wording에 보존. previous 없음, 실제 연장 생성 없음, unresolved 비어 있음.
- 오류 표적: capitalization/version/change 재출력, April 30 연장 상한/9am 공지 시간/withdrawal·broker 기한 오인, 가상 previous, 인용 없는 의미 추가.
- physical provider request **정확히 1회**. 성공/실패와 무관하게 즉시 종료. HTTP/timeout/non-JSON/schema 실패도 retry/repair/fallback하지 않는다. 시작 marker를 삭제하지 않는다.
- 나머지 7건, 특히 Applied `0001193125-26-026154`는 호출 금지. 호출 runner에 전체 사례 반복문이나 다른 accession 옵션을 두지 않는다.

## 호출 전 고정 / 검증

1. exact request, provider schema, exact prompt, unchanged source, prompt diff를 `run/`에 저장한다. `request.json`의 **저장된 바이트 그대로** HTTP body로 전송한다.
2. 계획/contract/runner/tests/입력/v1 전체 기존 파일의 hash를 `run/frozen.json`에 기록한다. 이는 실험 감사자료이지 운영 FACT snapshot/persistence가 아니다.
3. 오프라인 검사 및 타입 검사 후 호출한다. `started.json`을 exclusive 생성해 중복 호출을 차단한다.
4. raw provider response, structured text, usage/latency, shape/link validator 결과를 그대로 보존한다. 코드가 capitalization/date/version/관계를 고치거나 계산하지 않는다.

## Canary PASS와 중단

HTTP/Structured 정상, strict schema 통과, version 없음, type 정확히 expiration, current 2025-02-04, SEC가 뒷받침하는 시각·시간대·조건 wording, previous/change 없음, 가상 extension/무관 날짜/원문 없는 의미 없음, 모든 ID 입력에 존재해야 PASS다. unresolved는 이 사례에서 비어 있어야 한다.

Evidence 과다 인용은 기록하되 직접 근거가 있고 의미/schema가 맞으면 핵심 실패로 처리하지 않는다. Source를 직접 읽은 Codex 대조와 별도 사람의 검토 여부를 구분한다. 실패는 SOURCE_COVERAGE / MODEL_ERROR / SCHEMA_ERROR / SOURCE_UNRESOLVED로 분류한다. 충분한 source에서 의미를 틀리면 MODEL_ERROR이며 source/Selector를 확대하지 않는다.

Canary PASS는 전체 expiration Practical PASS가 아니다. 다음 사례 실험으로 진행 가능한지 판단만 보고하고, 사용자 승인 전 다음 호출/다른 FACT/DB/Reader/Matcher/Monitor/Alert/merge/push/deploy는 하지 않는다.
