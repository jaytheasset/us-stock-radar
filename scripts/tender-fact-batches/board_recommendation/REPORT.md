# board_recommendation 실제 SEC batch 결과

유지. 명시적 board tender recommendation 범위5/5 Practical PASS. 신규 FACT 생성은 여기서 STOP.

## 최소 schema와 적용 의미

```ts
type Recommendation = "accept" | "reject" | "no_recommendation";
type Fact = { type: "board_recommendation"; current: Recommendation; previous?: Recommendation; evidence_refs: string[] };
type Output = { facts: Fact[]; unresolved: string[] }; // facts: 0..1
```

previous는 명시적 이전 값이 있을 때만 optional이며 없으면 생략한다. 확정할 수 없으면 facts=[] 및 unresolved 설명을 출력한다. version/filing_kind/change_type는 LLM FACT에서 제거했고 filing identity/version은 frozen run metadata가 보존한다. schema는 값 형식만 검사하며 의미 판단은 Codex가 원문을 직접 읽어 수행했다. 독립적인 사람 검수 완료를 의미하지 않는다.

## 호출과 gate

모델: **gemini-3.5-flash** (요청/응답 modelVersion 모두 일치). Physical calls **5**, 각 case 1회. Retry/repair/fallback/동일 case 재호출0. Provider가 보고한 신규 totalTokenCount 합계 **17126**. 비용 금액은 추정하지 않았다.

모든5건 HTTP200/STOP, provider schema/local/provenance 각각5/5 PASS. 의미 판정5/5 PASS, Evidence support5/5 PASS. source+opaque ref만 입력하고 expected answer는 manifest에만 보존했다. 각 current/previous에 selected direct ref 최소1개를 확인했으며, 추가 corroborating ref는 관련·비모순 여부를 별도 기록했다. Validator와 lookup은 값을 고치거나 ref를 교체/삭제하지 않았다.

## 원문 대비 정확도

|사례 / 실제 filing|목적·판정|current|previous|선택 ref|Schema/local/provenance|의미/support|
|---|---|---|---|---|---|---|
|applied-accept: [0001193125-25-335440](https://www.sec.gov/Archives/edgar/data/1697532/000119312525335440/d84762dsc14d9.htm) (SC 14D9)|accept; advisor disclaimer/appraisal 절차를 board 추천과 구분|accept|—|E1, E2, E6|PASS/PASS/PASS|PASS/PASS|
|dxl-reject: [0001193125-26-239365](https://www.sec.gov/Archives/edgar/data/813298/000119312526239365/sch14d9_may_26_2026f.htm) (SC 14D9)|reject; 임시 company take-no-action을 previous로 만들지 않음|reject|—|E3|PASS/PASS/PASS|PASS/PASS|
|dxl-amendment: [0001193125-26-298540](https://www.sec.gov/Archives/edgar/data/813298/000119312526298540/sch14d9_amendment_3_july.htm) (SC 14D9/A)|reject; 다른 FBB merger 추천 철회를 tender 변화로 합성하지 않음|reject|—|E1, E3, E6, E8|PASS/PASS/PASS|PASS/PASS|
|rumble-no-recommendation: [0001213900-25-000757](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm) (SC TO-I)|no_recommendation; offer 실행 승인과 주주 추천 구분|no_recommendation|—|E1, E2, E3|PASS/PASS/PASS|PASS/PASS|
|cidara-not-established: [0001193125-25-281502](https://www.sec.gov/Archives/edgar/data/1610618/000119312525281502/d46394dsctoc.htm) (SC TO-C)|facts=[]; source에 board 추천 없음, neutral 추론 없음 (SOURCE_COVERAGE)|—|—|unresolved 내 refs|PASS/PASS/PASS|PASS/PASS|

## 각 case 원응답 및 감사 연결

아래 JSON은 저장된 structured 응답의 원문 그대로다. 전체 provider 응답과 상세 direct/corroborating 판단은 각 링크에 보존했다.

### applied-accept

[원문 Evidence](runs/applied-accept/source.json) · [Provider input](runs/applied-accept/provider-source.json) · [원응답](runs/applied-accept/provider-response.txt) · [Schema/local 감사](runs/applied-accept/audit.json) · [Provenance](runs/applied-accept/provenance-audit.json) · [직접 의미·support 검토](runs/applied-accept/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "board_recommendation",
      "current": "accept",
      "evidence_refs": [
        "E1",
        "E2",
        "E6"
      ]
    }
  ],
  "unresolved": []
}
```

### dxl-reject

[원문 Evidence](runs/dxl-reject/source.json) · [Provider input](runs/dxl-reject/provider-source.json) · [원응답](runs/dxl-reject/provider-response.txt) · [Schema/local 감사](runs/dxl-reject/audit.json) · [Provenance](runs/dxl-reject/provenance-audit.json) · [직접 의미·support 검토](runs/dxl-reject/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "board_recommendation",
      "current": "reject",
      "evidence_refs": [
        "E3"
      ]
    }
  ],
  "unresolved": []
}
```

### dxl-amendment

[원문 Evidence](runs/dxl-amendment/source.json) · [Provider input](runs/dxl-amendment/provider-source.json) · [원응답](runs/dxl-amendment/provider-response.txt) · [Schema/local 감사](runs/dxl-amendment/audit.json) · [Provenance](runs/dxl-amendment/provenance-audit.json) · [직접 의미·support 검토](runs/dxl-amendment/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "board_recommendation",
      "current": "reject",
      "evidence_refs": [
        "E1",
        "E3",
        "E6",
        "E8"
      ]
    }
  ],
  "unresolved": []
}
```

### rumble-no-recommendation

[원문 Evidence](runs/rumble-no-recommendation/source.json) · [Provider input](runs/rumble-no-recommendation/provider-source.json) · [원응답](runs/rumble-no-recommendation/provider-response.txt) · [Schema/local 감사](runs/rumble-no-recommendation/audit.json) · [Provenance](runs/rumble-no-recommendation/provenance-audit.json) · [직접 의미·support 검토](runs/rumble-no-recommendation/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "board_recommendation",
      "current": "no_recommendation",
      "evidence_refs": [
        "E1",
        "E2",
        "E3"
      ]
    }
  ],
  "unresolved": []
}
```

### cidara-not-established

[원문 Evidence](runs/cidara-not-established/source.json) · [Provider input](runs/cidara-not-established/provider-source.json) · [원응답](runs/cidara-not-established/provider-response.txt) · [Schema/local 감사](runs/cidara-not-established/audit.json) · [Provenance](runs/cidara-not-established/provenance-audit.json) · [직접 의미·support 검토](runs/cidara-not-established/semantic-review.json)

```json
{
  "facts": [],
  "unresolved": [
    "The supplied text consists of preliminary communications made before the commencement of the tender offer (E4, E7, E8). It does not contain any explicit recommendation from the board of directors of Cidara Therapeutics, Inc. to its shareholders regarding whether to accept or reject the tender offer, nor does it state that the board has made no recommendation. According to E1, a solicitation/recommendation statement on Schedule 14D-9 containing such information will be filed by Cidara when the planned tender offer is commenced."
  ]
}
```

## 실패·수정 이력과 남은 한계

이번 batch에서 MODEL_ERROR/SCHEMA_ERROR/PROVIDER_MODEL_UNAVAILABLE/PREFLIGHT_TEST_ERROR는0. 호출 후 schema/prompt/Selector 수정 및 의미 교정0. 빈 facts의 올바른 abstention은 모델 실패로 세지 않았다. source 부족과 원문상 미확정은 위 표에 별도 분류했다.

DXL amendment는 수정된 offer에 대한 reject 재표명을 검증했다. 실제 accept↔reject 방향 전환이나 previous enum 출력은 live 검증하지 않았다. pending evaluation/take-no-action을 no_recommendation으로 압축하지 않고 unresolved로 남기는 제한 계약이며 별도 단독 live 사례는 없다. Cidara의 미제공 exhibit까지 추천이 없다는 뜻은 아니다. no_recommendation은 명시적 표현이며 정보 없음과 구분한다. 독립적 사람 검수는 수행하지 않았다.
