# Tender expiration v2 Rumble canary 결과

**Canary FAIL — MODEL_ERROR (존재하지 않는 Evidence ID 생성).** 마감일의 의미와 lowercase type 등 v2 구조 변경은 이번 응답에서 맞았지만, 모든 evidence_ids가 실제 입력에 존재해야 한다는 필수 조건을 어겼다. **다음 expiration 사례 실험으로 넘어갈 수 없다.** v2 physical provider call은 정확히 1회이고 종료했다. 전체 expiration FACT도 여전히 Practical PASS가 아니다.

## v1 → v2 변경

|항목|v1|v2|
|---|---|---|
|최상위|version, facts, unresolved|facts, unresolved만|
|type provider 제약|const|`enum:["expiration"]`, const 없음|
|fact 필드|type/current/previous?/change?/evidence_ids|type/current/previous?/evidence_ids|
|unresolved|reason/detail/IDs 객체 배열|string[]|
|previous 없음|optional|optional, null 강제 없음|
|고정 metadata|version을 모델에 요구|모델 출력에서 제거, 시스템 wrapper/persistence 미구현|

실제 전송한 **전체 [provider-facing JSON schema](./run/provider-schema.json)**는 request의 `generationConfig.responseJsonSchema`와 동일하다. [정확한 HTTP request body](./run/request.json)를 호출 전에 저장했고, 그 바이트 그대로 전송했다. request SHA256: `b8b536f55fc80cee42045d35ddc25ceac1f584102a9fb1aa96273cef7ff445e7`.

[Exact prompt](./run/prompt.txt), [정확한 변경 문장 목록](./run/prompt.diff), [사전 호출 계획](./PLAN.md), [동결 hash](./run/frozen.json).

새 prompt는 다음을 명시한다:

> The only top-level fields are facts and unresolved. The fact type must be exactly lowercase "expiration"; other spellings or capitalizations, including "Expiration" and "EXPIRATION", are forbidden. Do not output version or filing_kind. Do not output change, extended, unchanged, changed, or any separate comparison/status field. A fact has only type, current, evidence_ids and optional previous. unresolved is an array of strings, not objects.

기존 change 출력 지시는 제거하고 “unless extended는 실제 연장 발생이 아니다”라는 의미 규칙은 유지했다. unresolved의 객체 reason 출력 지시만 문자열 설명으로 바꿨다. current/prior 판단, unrelated date 배제, source-named calendar date, 시간·시간대·조건 보존, partial/만료/불확실 원문 처리 원칙은 유지했다. Evidence 개수 최적화를 위한 새 지시는 추가하지 않았다.

## 실행 기록

|항목|결과|
|---|---|
|Run identity|tender-expiration-v2-rumble-canary-20261006|
|대상|Rumble Inc., SC TO-I, 0001213900-25-000757|
|모델 / 응답 modelVersion|gemini-2.5-flash / gemini-2.5-flash|
|입력|v1과 동일한 source 객체; 12 Evidence, 12,169 text characters|
|Physical provider calls|**1**; v1의 기존 1회와 별개. 두 run 누적 2회|
|Retry / repair / fallback / 다른 모델|전부 0|
|나머지 7개 사례 호출|0|
|HTTP / finishReason|200 / STOP|
|Latency|2,500ms|
|Tokens|prompt 8,767 / candidates 265 / total 9,032|
|설정|temperature 0, thinkingBudget 0, maxOutputTokens 3500; v1과 동일|
|형식+연결 validator|FAIL: 네 번째 evidence_ids가 ID pattern에 불일치|
|청구액|미조회; token usage만 기록|

원본: [provider response](./run/provider-response.txt), [Structured text](./run/structured.txt), [audit](./run/audit.json), [ledger](./run/ledger.json), [입력 source](./run/source.json). 기대 정답, v1 결과, 검색 점수, Parser 의미값은 Gemini 입력에 넣지 않았다. 원문은 기존 selected slices를 그대로 사용했고 새 SEC fetch나 Selector 변경은 없다.

## Raw Structured output

아래는 JSON 의미를 수정하지 않고 들여쓰기만 한 원 응답이다. 정확한 byte sequence는 위 structured.txt에 있다.

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": {
        "date": "2025-02-04",
        "wording": "February 4, 2025, at 5:00 p.m. New York City time unless we extend or terminate it"
      },
      "evidence_ids": [
        "tender:df83f703e5f5551b80b7145afc057cd05098af49401e1617e8d7c4918231a0d4",
        "tender:885c62531c420499f4e452b1fcc9985366d852e032fa9ad10f7a4cfef32d4144",
        "tender:214184f7b5db6b0f294fe3bab5239cb7c5d0b7b63f93a8e74c8771435db97dca",
        "tender:61758-62458"
      ]
    }
  ],
  "unresolved": []
}
```

## SEC 원문 대조와 PASS 조건

Codex가 selected SEC 원문을 직접 읽어 대조했다. Parser의 expiration_date나 기존 AI 답을 정답으로 사용하지 않았다. 별도 사람의 독립 검토는 미완료다.

|요청한 조건|판정|관찰|
|---|---|---|
|1. HTTP / Structured 정상|PASS|200 / STOP, 순수 JSON 객체|
|2. provider schema validation|**FAIL**|`facts.0.evidence_ids.3`가 `^tender:[a-f0-9]{64}$`를 만족하지 않음. 서버가 응답을 수락한 것과 로컬 strict validation 통과는 다름|
|3. version 없음|PASS|최상위 facts/unresolved만|
|4. type 정확히 expiration|PASS|lowercase enum 준수|
|5. current.date 2025-02-04|PASS|원문 Expiration Time과 일치|
|6. source-backed wording|PASS|첫 두 cited Evidence에 exact substring 존재; 5pm NYC와 연장/종료 조건 보존|
|7. previous 없음|PASS|필드 생략|
|8. change 없음|PASS|필드 생략; 다른 관계 상태도 없음|
|9. 발생하지 않은 extension 생성 없음|PASS|unless 조건만 원문대로 인용|
|10. 무관 날짜 오인 없음|PASS|April 30 상한/공지·withdrawal·broker 기한을 current로 선택하지 않음|
|11. 모든 evidence_ids 입력에 존재|**FAIL**|3/4 존재, `tender:61758-62458`은 입력에 없음|
|12. source에 없는 의미 생성 없음|날짜 의미 PASS / provenance FAIL|날짜·시간대·조건·prior 판단에는 발명 없음. 근거 식별자 생성 오류로 전체 조건을 충족했다고 볼 수 없음|

unresolved는 예상대로 빈 배열이다. 이 1건으로 partial/final-results/모호성 처리를 검증한 것은 아니다.

Source [SEC offer attachment](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm)의 deadline 문장에서 출력 wording이 그대로 확인된다. 특히 두 번째 Evidence에는 현재 February 4 deadline과 April 30 maximum extension limit가 함께 있어 날짜 선택을 직접 대조할 수 있다.

|출력 ID|입력 존재 / offset|주장 근거|
|---|---|---|
|tender:df83f703e5f5551b80b7145afc057cd05098af49401e1617e8d7c4918231a0d4|있음 / 33868–35029|Expiration Q&A, exact wording|
|tender:885c62531c420499f4e452b1fcc9985366d852e032fa9ad10f7a4cfef32d4144|있음 / 34300–35627|같은 deadline와 최대 연장 한도|
|tender:214184f7b5db6b0f294fe3bab5239cb7c5d0b7b63f93a8e74c8771435db97dca|있음 / 246–1189|표지의 동일 expiration/조건|
|tender:61758-62458|**없음**|정규 Evidence ID가 아님|

입력에는 실제로 start=61758, end=62458인 expiration 정의 passage가 있고, 그 ID는 `tender:73d7902262674e2ea3f9f01886a4a703bd363495c8749975ebd9e6ae11aff8ab`다. 따라서 모델이 offset을 ID처럼 조합한 것으로 **추정**되지만 내부 원인은 확정하지 않는다. 이 관찰은 오류 분석일 뿐, 출력 ID를 올바른 ID로 매핑하거나 삭제하지 않았다.

## 실패 분류와 판단

- **MODEL_ERROR:** 충분한 deadline 원문과 정상 ID가 입력에 있었는데 모델이 존재하지 않는 ID를 생성했다. 유효한 ID를 많이 인용한 과다 인용 문제가 아니다. 필수 provenance 연결 실패다.
- SOURCE_COVERAGE 아님: 필요한 source와 ID가 모두 있음. source/Selector 확대 없음.
- SCHEMA_ERROR로 분류하지 않음: 이번 잘못된 ID는 정의된 계약이 표현할 수 없는 의미가 아니다. 형식 validator가 정확히 검출했다. enum/type과 제거 필드 변경은 이번 응답에서 지켜졌다.
- SOURCE_UNRESOLVED 아님: 원문 deadline은 명확하다.

**다음 7건으로 진행하지 않는 것이 맞다.** 같은 모델이 필요한 원문 의미를 읽을 수 있다는 신호는 있지만 신뢰할 수 있는 Structured FACT에는 근거 ID 연결까지 필요하다. 다음 변경 후보로 입력 ID의 provider enum 제한을 검토할 수 있으나, 이는 제안만이며 schema/prompt 수정이나 새 호출을 실행하지 않았다. 이번 v2 contract와 응답은 동결 상태로 보존한다.

## 검증, 파일, 작업 경계

- v2 offline 검사 **8/8 PASS**, 전체 `npm run typecheck` PASS. 이들은 canary 의미 PASS와 별개다.
- v1 frozen hash 검증 PASS. v2 exact request/source/schema/prompt 무결성 PASS, v1 전체 파일의 기준 commit 대비 byte 동일성 PASS, raw output 무수정 확인 PASS. `verify-audit.mjs`는 ID 존재 결과를 보고만 하며 원 응답을 수정하지 않는다.
- 변경은 `scripts/tender-expiration/v2/` 신규 파일뿐이다. v1 PLAN/started/request/provider-response/structured/audit/ledger/frozen hashes 전부 보존.
- 기준 commit `fc5cc0a51af2f60b498aff54a57483accd37cd52`; 동일 87db detached worktree. 최종 commit과 clean 상태는 완료 메시지에 기록한다.
- 운영 코드/Parser/Selector/DB/persistence/snapshot/Reader/Matcher/Monitor/Alert/UI/다른 FACT 변경 없음. main merge/push/deploy/cron/외부 발송 없음. 서버 실행·화면 변경이 없어 UI 검증은 N/A.
- 기존 인계의 local/GitHub main `af265b5bf3bb8878d706e1f4d763c0ce85a1b024`, Vercel `bf586ed559c7f4bea6a171790ab7b563cabc7161` READY 정보는 재조회하지 않았다. 운영 코드 일치나 배포 완료를 주장하지 않는다. DB/환경/cron 상태도 변경·재검증하지 않았다.

오프라인 재검토:

```powershell
node --no-warnings --experimental-strip-types scripts/tender-expiration/v2/verify-audit.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-expiration/v2/run.test.mjs
node --no-warnings --experimental-strip-types scripts/tender-expiration/verify-audit.mjs
```

이번 단일 canary는 종료했다. 사용자 승인 전 다음 실험을 실행하지 않는다.
