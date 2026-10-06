# offer_price 실제 SEC batch 결과

유지. 현금 주당 고정가격 범위5/5 Practical PASS. current/previous를 코드 계산 없이 직접 추출했다.

## 최소 schema와 적용 의미

```ts
type CashPrice = { amount: number; currency_text: string; unit: "cash_per_share" };
type Fact = { type: "offer_price"; current: CashPrice; previous?: CashPrice; evidence_refs: string[] };
type Output = { facts: Fact[]; unresolved: string[] }; // facts: 0..1
```

previous는 명시적 이전 값이 있을 때만 optional이며 없으면 생략한다. 확정할 수 없으면 facts=[] 및 unresolved 설명을 출력한다. version/filing_kind/change_type는 LLM FACT에서 제거했고 filing identity/version은 frozen run metadata가 보존한다. schema는 값 형식만 검사하며 의미 판단은 Codex가 원문을 직접 읽어 수행했다. 독립적인 사람 검수 완료를 의미하지 않는다.

## 호출과 gate

모델: **gemini-3.5-flash** (요청/응답 modelVersion 모두 일치). Physical calls **5**, 각 case 1회. Retry/repair/fallback/동일 case 재호출0. Provider가 보고한 신규 totalTokenCount 합계 **20646**. 비용 금액은 추정하지 않았다.

모든5건 HTTP200/STOP, provider schema/local/provenance 각각5/5 PASS. 의미 판정5/5 PASS, Evidence support5/5 PASS. source+opaque ref만 입력하고 expected answer는 manifest에만 보존했다. 각 current/previous에 selected direct ref 최소1개를 확인했으며, 추가 corroborating ref는 관련·비모순 여부를 별도 기록했다. Validator와 lookup은 값을 고치거나 ref를 교체/삭제하지 않았다.

## 원문 대비 정확도

|사례 / 실제 filing|목적·판정|current|previous|선택 ref|Schema/local/provenance|의미/support|
|---|---|---|---|---|---|---|
|initial-competing: [0001213900-25-000757](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm) (SC TO-I)|7.50;12.40 시장가격·aggregate·par value 제외|$7.5 (cash_per_share)|—|E1, E2, E5, E6|PASS/PASS/PASS|PASS/PASS|
|southwest-increase: [0001193125-22-074629](https://www.sec.gov/Archives/edgar/data/1692115/000119312522074629/d318756dsctota.htm) (SC TO-T/A)|75→82.50; old introduction보다 operative amendment 선택|$82.5 (cash_per_share)|$75 (cash_per_share)|E1, E2, E3|PASS/PASS/PASS|PASS/PASS|
|dxl-revised: [0001193125-26-298540](https://www.sec.gov/Archives/edgar/data/813298/000119312526298540/sch14d9_amendment_3_july.htm) (SC 14D9/A)|0.82→0.84; 별도1.25 proposal을 previous로 오인하지 않음|$0.84 (cash_per_share)|$0.82 (cash_per_share)|E1, E2, E6, E7|PASS/PASS/PASS|PASS/PASS|
|unchanged-amendment: [0001213900-25-003454](https://www.sec.gov/Archives/edgar/data/1830081/000121390025003454/sctoia0125_rumble.htm) (SC TO-I/A)|7.50; previous를 복사·추정하지 않음|$7.5 (cash_per_share)|—|E1|PASS/PASS/PASS|PASS/PASS|
|epicor-decrease: [0001193125-08-224348](https://www.sec.gov/Archives/edgar/data/891178/000119312508224348/dsctota.htm) (SC TO-T/A)|9.50→7.50;18.10 전환가격·417m funding 제외|$7.5 (cash_per_share)|$9.5 (cash_per_share)|E1, E2|PASS/PASS/PASS|PASS/PASS|

## 각 case 원응답 및 감사 연결

아래 JSON은 저장된 structured 응답의 원문 그대로다. 전체 provider 응답과 상세 direct/corroborating 판단은 각 링크에 보존했다.

### initial-competing

[원문 Evidence](runs/initial-competing/source.json) · [Provider input](runs/initial-competing/provider-source.json) · [원응답](runs/initial-competing/provider-response.txt) · [Schema/local 감사](runs/initial-competing/audit.json) · [Provenance](runs/initial-competing/provenance-audit.json) · [직접 의미·support 검토](runs/initial-competing/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "offer_price",
      "current": {
        "amount": 7.5,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "evidence_refs": [
        "E1",
        "E2",
        "E5",
        "E6"
      ]
    }
  ],
  "unresolved": []
}
```

### southwest-increase

[원문 Evidence](runs/southwest-increase/source.json) · [Provider input](runs/southwest-increase/provider-source.json) · [원응답](runs/southwest-increase/provider-response.txt) · [Schema/local 감사](runs/southwest-increase/audit.json) · [Provenance](runs/southwest-increase/provenance-audit.json) · [직접 의미·support 검토](runs/southwest-increase/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "offer_price",
      "current": {
        "amount": 82.50,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "previous": {
        "amount": 75.00,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
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

### dxl-revised

[원문 Evidence](runs/dxl-revised/source.json) · [Provider input](runs/dxl-revised/provider-source.json) · [원응답](runs/dxl-revised/provider-response.txt) · [Schema/local 감사](runs/dxl-revised/audit.json) · [Provenance](runs/dxl-revised/provenance-audit.json) · [직접 의미·support 검토](runs/dxl-revised/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "offer_price",
      "current": {
        "amount": 0.84,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "previous": {
        "amount": 0.82,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "evidence_refs": [
        "E1",
        "E2",
        "E6",
        "E7"
      ]
    }
  ],
  "unresolved": []
}
```

### unchanged-amendment

[원문 Evidence](runs/unchanged-amendment/source.json) · [Provider input](runs/unchanged-amendment/provider-source.json) · [원응답](runs/unchanged-amendment/provider-response.txt) · [Schema/local 감사](runs/unchanged-amendment/audit.json) · [Provenance](runs/unchanged-amendment/provenance-audit.json) · [직접 의미·support 검토](runs/unchanged-amendment/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "offer_price",
      "current": {
        "amount": 7.50,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "evidence_refs": [
        "E1"
      ]
    }
  ],
  "unresolved": []
}
```

### epicor-decrease

[원문 Evidence](runs/epicor-decrease/source.json) · [Provider input](runs/epicor-decrease/provider-source.json) · [원응답](runs/epicor-decrease/provider-response.txt) · [Schema/local 감사](runs/epicor-decrease/audit.json) · [Provenance](runs/epicor-decrease/provenance-audit.json) · [직접 의미·support 검토](runs/epicor-decrease/semantic-review.json)

```json
{
  "facts": [
    {
      "type": "offer_price",
      "current": {
        "amount": 7.50,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "previous": {
        "amount": 9.50,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "evidence_refs": [
        "E1",
        "E2"
      ]
    }
  ],
  "unresolved": []
}
```

## 실패·수정 이력과 남은 한계

이번 batch에서 MODEL_ERROR/SCHEMA_ERROR/PROVIDER_MODEL_UNAVAILABLE/PREFLIGHT_TEST_ERROR는0. 호출 후 schema/prompt/Selector 수정 및 의미 교정0. 빈 facts의 올바른 abstention은 모델 실패로 세지 않았다. source 부족과 원문상 미확정은 위 표에 별도 분류했다.

currency_text는 원문 통화 표기($)이며 ISO USD 확정값이 아니다. 서로 다른 통화·증권·거래 사이 숫자 비교에 사용하면 안 된다. 금액+통화표기+현금 주당 단위를 함께 보존한다. 세금/이자 조건은 Evidence에 남는다. exchange ratio, cash+stock/CVR, 경매 범위, 복수 증권은 contract 범위 밖이며 live abstention 검증은 이번에 하지 않았다. source coverage 부족/partial 가격 사례도 live 검증하지 않았다.
