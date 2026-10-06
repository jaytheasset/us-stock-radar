# Tender expiration 단일 호출 실험 — 호출 전 계획

기준 commit: `2d5928ad9b2dce9e4a9d4d48d7c2a318080e2a88`, 87db detached candidate.
Provider: Gemini, 고정 모델 `gemini-2.5-flash`. 서로 다른 8 accession, 각각 최대 1 physical HTTP request. 이 계획 작성 시 호출 0회.

## 최소 공통 구조

사용자 수요는 가격 변경, 마감 변경/연장, 이사회 입장 변경, offer 종료/철회/결과 알림이다. 따라서 공통 구조는 `version`, sparse `facts[]`, 필요한 `unresolved[]`만 둔다. 각 fact는 `type`, type별 작은 `current`, 명시된 경우에만 `previous`, `evidence_ids`를 가진다. 가격의 통화나 추천 enum을 공통 필드로 강제하지 않는다. `filing_kind`는 source provenance에 이미 있으므로 중복 생성하지 않는다. 조건/financing/waiver/공정성 논리는 Evidence 영역에 남긴다. 향후 세 type은 설계 수요만 설명하며 실행 schema에는 없다.

이번 executable variant는 expiration뿐이다:

```text
{version, facts:[{type:"expiration", current:{date,wording},
 previous?:{date,wording}, change?:"extended"|"explicitly_unchanged", evidence_ids:[id]}],
 unresolved:[{type:"expiration", reason, detail, evidence_ids:[id]}]}
```

`date`는 source가 명명한 달력 날짜이며 instant가 아니다. `wording`은 시각/시간대/자정 표현/연장 조건을 정확한 원문 인용으로 보존한다. 시간만 바뀌는 경우의 자동 비교/시간대 정규화는 이 초안에서 검증되지 않는다. 현재란 오늘이 아니라 해당 filing에서 제시된 일정이다. 이미 expired된 final-results의 과거 날짜는 current에 넣지 않고 `historical_only`로 보존한다. 이는 status FACT 구현이 아니다. null 필드를 채우는 대신 fact를 생략한다. 이전 날짜가 안 나오면 previous를 생략한다.

ID는 정확한 source/document/accession/hash/offset에 연결한다. 날짜 선택/old-new 비교/인용의 의미 판단은 validator가 하지 않는다. validator는 strict JSON, type/enum, 날짜 문자열 형식, 필수 ID 연결과 ID 존재만 확인한다.

## 고정된 호출별 목적과 원문 판정 기준

아래 기준은 SEC selected evidence를 직접 읽은 Codex의 사전 판정이다. 기존 Parser나 AI 결과를 정답으로 사용하지 않았다. 사람의 독립 원문 검토를 완료했다고 주장하지 않는다. 이 표와 기대값은 Gemini 입력에 포함되지 않는다.

|호출|accession / 사례|기대 의미|확인할 오류 / 해당 사례 FAIL 조건|
|---|---|---|---|
|1|0001213900-25-000757 / Rumble 최초|current 2025-02-04 5pm NYC; previous/change 없음|April 30 연장 상한/브로커 기한을 current로 선택, 가상 previous/실제 연장 생성|
|2|0001193125-26-026154 / Applied 연장|current 2026-01-28, previous 2026-01-27, extended; one minute following 11:59pm Eastern 그대로|old/new 역전, filing date 선택, 날짜를 다음날로 변환, 필수 관계 누락|
|3|0001213900-23-055698 / Nano 변경 없는 amendment|current 2023-07-24 5pm NY, explicitly_unchanged, previous 없음|가격 변경을 deadline 변경으로 혼동, 조건부 July 28 추가 수락 기간 선택, previous 생성|
|4|0001104659-25-006713 / H&E 여러 날짜|current 2025-02-25; one minute after 11:59pm Eastern; previous/change 없음|May 13 merger Termination Date/보증 인도 기간을 expiration으로 선택|
|5|0001702510-26-000009 / Carlyle final-results|facts 비움, historical_only; Jan 21은 이미 expired|과거 만료일/NAV/지급일을 current로 생성, status/result FACT 생성|
|6|0001062993-17-000336 / Caza 조건부 연장|current 2017-02-27 11:59pm Pacific, 조건 보존, previous/change 없음|의무적/가능한 향후 연장을 이미 발생한 것으로 해석|
|7|0001193125-25-335440 / Applied partial|facts 비움, source_partial|다른 날짜를 expiration으로 오인, 미제공 본문/외부 지식으로 보충|
|8|0001193125-25-281502 / Cidara 미개시|facts 비움, not_stated 또는 ambiguous|현재 expiration이 정해지지 않은 원문에서 날짜 생성|

8번은 미개시여서 원문만으로 현재 날짜를 정할 수 없는 사례다. 상충하는 두 deadline이 있는 사례는 아니며, 그 유형은 미검증이다. 7번은 실제 원문 rendered prefix 5,000자를 사용한 통제된 truncation이다. 원문 자체가 원래 잘린 SEC 공시라는 뜻이 아니다. 8개 중 7개 filing은 기존 Evidence 검증 사례 재사용이며 Cidara는 추가 사례다.

입력은 `fixtures/inputs.json`의 `source` 객체만 사용한다. 수집 메타데이터, 검색 점수, 사례 이름/유형/기대값은 전달하지 않는다. 원문 source만 가진 기존 Tender Evidence index의 search/read 결과다. 공통 질문 3개 × Top5, ID 중복 제거. 모델 결과를 본 뒤 source/질문을 바꾸지 않는다. CB의 open-for-acceptance 문장이 두 질문으로 누락된 것은 **호출 전 SOURCE_COVERAGE**로 기록하고 세 번째 공통 질문으로 보완했다. 기존 Selector/Parser 코드는 수정하지 않았다.

## 실행 종료 조건

- 실행 전 source, contract/prompt/schema, runner, 계획 파일 SHA256과 exact request SHA256을 고정한다. 이미 started marker가 있으면 재실행 거부.
- 각 request 전에 exclusive attempted marker를 쓴다. crash/timeout도 재호출하지 않는다. 자동 redirect도 거부하여 추가 요청을 막는다.
- HTTP/transport/provider 응답 오류, 비정상 finishReason, JSON/schema/link validation 실패 시 해당 raw 결과를 보존하고 **전체 나머지 유료 호출을 중단**한다. provider 오류를 네 의미 실패 유형으로 억지 분류하지 않고 의미 평가 불가로 표시한다.
- 형식 정상인 의미 오류는 원문 대조 후 MODEL_ERROR/SCHEMA_ERROR 등으로 기록한다. 이미 계획된 독립 사례만 끝까지 수행하며 추가 호출/수정 호출/다른 모델 호출은 없다.
- 8회 성공 또는 위 중단 조건에 도달하면 종료. 재시도/repair/fallback/추가 FACT/후속 단계 금지.
- 모든 current/previous/관계, 무관한 날짜 배제, 불확실성 처리, 실제 근거 ID, 의미 보존을 원문과 대조한다. 충분한 source의 모델 오류는 selector 확대로 숨기지 않는다.
- Practical PASS 기술 조건은 8/8 format/link PASS 및 8/8 의미 PASS, 필수 Applied 관계 정확, 허위 날짜/연장 없음이다. 독립 사람 검토 여부를 별도 명시한다. 8건 단회는 안정성의 통계적 증명이 아니다.

## 산출물과 범위

선택된 입력, request, raw response, raw Structured text, call ledger/usage, 형식 검증과 원문 대조 보고서는 실험 감사 자료다. 운영 FACT 저장소/snapshot/persistence가 아니며 제품 import/DB/UI/Reader/Monitor/Matcher/Alert는 없다. 최종 판정 후 대기한다.
