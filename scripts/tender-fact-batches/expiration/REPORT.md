# expiration 실제 SEC batch 결과

유지. 신규5건 + 기존3건 = 8/8 대표 사례 Practical PASS. source-named calendar date 추출 범위에서 Structured Monitor 후보로 계속 검증할 가치가 있다.

## 최소 schema와 적용 의미

```ts
type Fact = { type: "expiration"; current: string; previous?: string; evidence_refs: string[] };
// current/previous: source-named YYYY-MM-DD; previous only if explicitly stated
type Output = { facts: Fact[]; unresolved: string[] }; // facts: 0..1
```

previous는 명시적 이전 값이 있을 때만 optional이며 없으면 생략한다. 확정할 수 없으면 facts=[] 및 unresolved 설명을 출력한다. version/filing_kind/change_type는 LLM FACT에서 제거했고 filing identity/version은 frozen run metadata가 보존한다. schema는 값 형식만 검사하며 의미 판단은 Codex가 원문을 직접 읽어 수행했다. 독립적인 사람 검수 완료를 의미하지 않는다.

## 호출과 gate

모델: **gemini-3.5-flash** (요청/응답 modelVersion 모두 일치). Physical calls **5**, 각 case 1회. Retry/repair/fallback/동일 case 재호출0. Provider가 보고한 신규 totalTokenCount 합계 **13760**. 비용 금액은 추정하지 않았다.

모든5건 HTTP200/STOP, provider schema/local/provenance 각각5/5 PASS. 의미 판정5/5 PASS, Evidence support5/5 PASS. source+opaque ref만 입력하고 expected answer는 manifest에만 보존했다. 각 current/previous에 selected direct ref 최소1개를 확인했으며, 추가 corroborating ref는 관련·비모순 여부를 별도 기록했다. Validator와 lookup은 값을 고치거나 ref를 교체/삭제하지 않았다.

## 원문 대비 정확도

|사례 / 실제 filing|목적·판정|current|previous|선택 ref|Schema/local/provenance|의미/support|
|---|---|---|---|---|---|---|
|many-dates: [0001104659-25-006713](https://www.sec.gov/Archives/edgar/data/1067701/000110465925006713/tm253288d1_ex99-a1a.htm) (SC TO-T)|02-25 선택;05-13 merger termination/02-24 cutoff 제외|2025-02-25|—|E4, E5|PASS/PASS/PASS|PASS/PASS|
|already-expired: [0001702510-26-000009](https://www.sec.gov/Archives/edgar/data/1702510/000170251026000009/cars_2026130xsctoa.htm) (SC TO-I/A)|01-21 historical expired를 current로 만들지 않음|—|—|unresolved 내 refs|PASS/PASS/PASS|PASS/PASS|
|conditional: [0001062993-17-000336](https://www.sec.gov/Archives/edgar/data/1629583/000106299317000336/exhibit1-1.htm) (CB)|02-27 선택; conditional extension을 실제 연장으로 오인하지 않음|2017-02-27|—|E2, E10, E12|PASS/PASS/PASS|PASS/PASS|
|partial: [0001193125-25-335440](https://www.sec.gov/Archives/edgar/data/1697532/000119312525335440/d84762dsc14d9.htm) (SC 14D9)|facts=[]; 잘린 source에서 날짜를 만들어내지 않음 (SOURCE_COVERAGE)|—|—|unresolved 내 refs|PASS/PASS/PASS|PASS/PASS|
|not-established: [0001193125-25-281502](https://www.sec.gov/Archives/edgar/data/1610618/000119312525281502/d46394dsctoc.htm) (SC TO-C)|facts=[]; 미개시 공시에서 expiration 미확정 (SOURCE_UNRESOLVED)|—|—|unresolved 내 refs|PASS/PASS/PASS|PASS/PASS|

## 각 case 원응답 및 감사 연결

아래 JSON은 저장된 structured 응답의 원문 그대로다. 전체 provider 응답과 상세 direct/corroborating 판단은 각 링크에 보존했다.

### many-dates

[원문 Evidence](runs/many-dates/source.json) · [Provider input](runs/many-dates/provider-source.json) · [원응답](runs/many-dates/provider-response.txt) · [Schema/local 감사](runs/many-dates/audit.json) · [Provenance](runs/many-dates/provenance-audit.json) · [직접 의미·support 검토](runs/many-dates/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": "2025-02-25",
      "evidence_refs": [
        "E4",
        "E5"
      ]
    }
  ],
  "unresolved": []
}
```

### already-expired

[원문 Evidence](runs/already-expired/source.json) · [Provider input](runs/already-expired/provider-source.json) · [원응답](runs/already-expired/provider-response.txt) · [Schema/local 감사](runs/already-expired/audit.json) · [Provenance](runs/already-expired/provenance-audit.json) · [직접 의미·support 검토](runs/already-expired/semantic-review.json)

```json
{
  "facts": [],
  "unresolved": [
    "The source only reports an already expired historical offer that expired on January 21, 2026, as noted in E2, so an active scheduled expiration is not established."
  ]
}
```

### conditional

[원문 Evidence](runs/conditional/source.json) · [Provider input](runs/conditional/provider-source.json) · [원응답](runs/conditional/provider-response.txt) · [Schema/local 감사](runs/conditional/audit.json) · [Provenance](runs/conditional/provenance-audit.json) · [직접 의미·support 검토](runs/conditional/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": "2017-02-27",
      "evidence_refs": [
        "E2",
        "E10",
        "E12"
      ]
    }
  ],
  "unresolved": []
}
```

### partial

[원문 Evidence](runs/partial/source.json) · [Provider input](runs/partial/provider-source.json) · [원응답](runs/partial/provider-response.txt) · [Schema/local 감사](runs/partial/audit.json) · [Provenance](runs/partial/provenance-audit.json) · [직접 의미·support 검토](runs/partial/semantic-review.json)

```json
{
  "facts": [],
  "unresolved": [
    "No scheduled expiration date is stated in the provided source text (E1, E2, E3, E4)."
  ]
}
```

### not-established

[원문 Evidence](runs/not-established/source.json) · [Provider input](runs/not-established/provider-source.json) · [원응답](runs/not-established/provider-response.txt) · [Schema/local 감사](runs/not-established/audit.json) · [Provenance](runs/not-established/provenance-audit.json) · [직접 의미·support 검토](runs/not-established/semantic-review.json)

```json
{
  "facts": [],
  "unresolved": [
    "No scheduled expiration date is stated in the provided source because the tender offer has not yet commenced (E1, E4, E5, E6)."
  ]
}
```

## 실패·수정 이력과 남은 한계

이번 batch에서 MODEL_ERROR/SCHEMA_ERROR/PROVIDER_MODEL_UNAVAILABLE/PREFLIGHT_TEST_ERROR는0. 호출 후 schema/prompt/Selector 수정 및 의미 교정0. 빈 facts의 올바른 abstention은 모델 실패로 세지 않았다. source 부족과 원문상 미확정은 위 표에 별도 분류했다.

날짜만 typed value다. 시간·시간대·연장 조건은 Evidence에 남는다. 실제 시간 변경, 복수 offer 충돌, 시간대 변환, 운영 collector E2E는 검증하지 않았다. 이미 expired인 원문은 active scheduled expiration을 만들지 않는 계약이다. partial 응답은 날짜를 확정하지 않았으나 설명에 partial이라는 단어를 재명시하지 않은 표현상 한계가 있다. 최초 Rumble은 사용자 지시에 따라 이전2.5 결과를 재사용했으므로8건 전체가3.5 시험은 아니다.

## 재호출 없이 재사용한 기존3건

|사례|current|previous|모델|현재 support 기준 판정|결과/원응답|
|---|---|---|---|---|---|
|Rumble0001213900-25-000757|2025-02-04|없음|gemini-2.5-flash|v3.1 PASS|[재평가](../../tender-expiration/v3_1/result.json), [raw](../../tender-expiration/v3/run/structured.txt)|
|Applied0001193125-26-026154|2026-01-28|2026-01-27|gemini-3.5-flash|PASS; E1/E2/E5/E6 각각 양쪽 날짜 direct|[결과](../../tender-expiration/v5_applied_35/result.json), [raw](../../tender-expiration/v5_applied_35/run/structured.txt)|
|Nano0001213900-23-055698|2023-07-24|없음|gemini-3.5-flash|PASS;07-28 additional period 제외|[결과](../../tender-expiration/v6b_nano_unchanged_35/result.json), [raw](../../tender-expiration/v6b_nano_unchanged_35/run/structured.txt)|

Applied의 원문 extension은 정확히01-27→01-28로 추출됐다. change_type은 별도 출력하지 않는다. 동일 두 날짜가 있다는 사실만으로 모든 가능한 amendment의 extension 의미까지 일반화하지 않으며, 이 사례의 실제 extension 여부는 연결 원문으로 검토했다.

과거 Rumble v3는 direct-only 기준에서 FAIL이었고, 사용자와 확정한 v3.1 기준(각 claim에 direct 최소1개 + 관련 corroboration 허용)으로 동일 raw를 재평가하여 PASS가 됐다. 원FAIL 기록을 덮어쓰지 않았다. 기존 [Applied v4](../../tender-expiration/v4_applied/REPORT.md)는2.5 HTTP404 PROVIDER_MODEL_UNAVAILABLE, [Nano v6](../../tender-expiration/v6_nano_unchanged_35/REPORT.md)는0 physical call의 PREFLIGHT_TEST_ERROR였다. 이후의 사용자 승인된 v5/v6b 성공 결과를 그대로 재사용했으며 이번 batch의 retry로 처리하거나 과거 실패를 삭제하지 않았다. 모든 scripts/tender-expiration 파일을 base와 byte hash 비교해 불변을 확인했다.
