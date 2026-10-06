# Tender 5-FACT single-call extraction 검증

**Practical FAIL — 4건 중 2건 호출 후 중단.** Rumble은 PASS, DXL은 명시된 expiration.previous 누락으로 MODEL_ERROR. Carlyle·Xerox는 요청과 baseline만 고정했고 호출하지 않았다. **공시 2건 = Gemini physical calls 2회**, 모두 gemini-3.5-flash, HTTP200, finishReason STOP. Retry/repair/fallback/재호출/FACT별 호출은 모두0.

## 핵심 실패와 판정

DXL 원문 E4와 E13은 이전 expiration을 June22,2026으로 직접 명시한다. E13은 May27에 June22까지 연장했던 사실과 June23에 July24까지 다시 연장한 사실을 함께 제공한다. 호출 전 baseline은 current=2026-07-24, previous=2026-06-22로 고정했다. 실제 응답은 current만 출력했다. 이전 가격은0.82, 현재 가격은0.84로 정확하며 board reject도 정확하다.

- 누락된 FACT type은 없음. **expiration의 명시적 previous 필드 1개 누락**이다.
- previous는 JSON schema에서 optional이므로 validator가 거절하지 않는 것이 맞다. 그 구조적 허용이 호출 전 source-grounded 기대값을 충족했다는 뜻은 아니다.
- 필요한 원문이 이미 selected input E4/E13에 있고, 그 내용은 명확하다. 따라서 이번 오류는 SOURCE_COVERAGE나 source ambiguity가 아니라 **MODEL_ERROR**다.
- 값·날짜·enum·refs를 보정하거나 previous를 코드로 채우지 않았다. 원본 응답 그대로 보존했다.
- 잘못된 다른 FACT로 값이 이동하는 오염은 관찰되지 않았다. 여러 FACT를 동시에 검토하면서 previous가 누락된 사실은 확인되지만, attention 경쟁/FACT 간 간섭이 원인이라는 인과관계는 미확인이다.
- 추가 유료 호출, 동일 case 재호출, source 확대, FACT별 호출 회귀, prompt/schema 사후 수정 없이 중단했다. 후속 수정 검토는 다음 사용자 승인 범위다.

## 통합 계약 및 검증

Root는 facts[]와 unresolved:string[]뿐이다. facts 최대5, type별 최대1. 각 anyOf branch는 기존 accepted contract의 provider item schema를 **그대로 import**하며 type singleton enum으로 판별한다. Local validator도 기존 각 FACT validator를 재사용하고 root shape/최대5/중복type만 추가한다. 예외 보정·기본값·의미 정규화가 없다. [Google 공식 schema 문서](https://ai.google.dev/api/generate-content)의 anyOf/additionalProperties 지원을 확인했다.

| type | 허용 의미/필드 |
|---|---|
| expiration | type, current YYYY-MM-DD, optional previous, evidence_refs; historical expired 결과를 active current로 만들지 않음 |
| offer_price | type, current {amount,currency_text,unit:cash_per_share}, optional previous, evidence_refs; fixed all-cash per-share, source literal currency |
| board_recommendation | type, current accept/reject/no_recommendation, optional previous, evidence_refs; 임시 take-no-action와 다른 거래 배제 |
| offer_status | type, current withdrawn/terminated, evidence_refs; actual tender event만. 동일 사건 두 표현이면 withdrawn |
| final_results_observed | type, observed:true, evidence_refs; false 생성 금지, interim/preliminary/expected 배제 |

각 타입의 supported FACT는 다른 타입의 불충분함과 별개로 출력하도록 지시했다. 기존 unresolved 의미를 유지하되 type prefix로 구분한다. absent optional previous를 unresolved로 나열하지 않으며 status/final의 정상 미관찰은 빈 FACT로 남긴다. Provider에는 form/coverage/evidence:[{ref,text}]만 전달한다. Baseline, expected, actual ID, URL, hash, offset, 문서 metadata는 provider에 넣지 않는다. 코드가 만드는 것은 하나의 filing-level request뿐이다.

## Source 준비 및 호출 전 baseline

기존 검증 filing 네 건만 재사용했다. 기대값은 이번 selected SEC text를 다시 읽어 작성했으며 과거 Gemini structured output, Parser semantic, Primary summary/score/signal을 사용하지 않았다. 의미 검토는 **Codex 직접 검토이며 사람의 독립 signoff는 미실시**다.

일반 질의4개로 시작했지만 actual status와 final results를 합친 질의가 Xerox 종료 문장을 놓쳤다. 호출 전 SOURCE_COVERAGE로 발견하고 두 질의를 분리한 **공통5개 질의 Top5**를 모든 filing에 적용했다. Company/date/price/case-specific 정답 질의는 없다. Top5는 DXL competing-merger recommendation 맥락도 포함하도록 유지했다. 시험한 질의 중 충분한 최소 구성이지 전역 최소라고 주장하지 않는다.

기존 helper의 20-ID read 상한 때문에5-query 결합이 preflight에서 거절되어 PREFLIGHT_TEST_ERROR1건을 기록했다(당시 provider calls0). 신규 실험 adapter는 하나의 filing index에서20개씩 read하고 하나의 packet으로 결합한다. Rumble만 read2회, 나머지1회. 이는 provider call 분할이 아니다. ID 중복과 동일 문서·revision에 완전히 포함된 slice만 제거하고, 원문 자르기·이어붙이기·의미 필터는 하지 않았다. 모든 slice/offset/hash를 원문 렌더링과 대조했다. Product Evidence/Selector/Parser 코드는 그대로다.

모든 실제 입력은 complete 개별 SEC document에서 가져온 bounded slices이며 partial/unavailable은0, incorporated 외부 문서는 미해결이다. 공시 전체 coverage를 보장한다는 의미는 아니다. 이전에 직접 확인한 SEC index의 accession/form/document identity를 재사용해 대조했다. Source/projection/mapping/prompt/schema/exact request/baseline/hash/run identity를 **첫 호출 전에 네 건 모두 freeze**했다. Exclusive started marker를 network fetch 전에 저장했다.

| filing | accession / form | frozen expected | Evidence 수 | source chars | provider input chars | prompt tokens | calls | 결과 |
|---|---|---|---:|---:|---:|---:|---:|---|
| rumble-active | 0001213900-25-000757 / SC TO-I | expiration=2025-02-04; offer_price=$7.5; board_recommendation=no_recommendation | 24 | 31063 | 31912 | 7866 | 1 | PASS |
| dxl-amendment | 0001193125-26-298540 / SC 14D9/A | expiration=2026-07-24 (prev 2026-06-22); offer_price=$0.84 (prev $0.82); board_recommendation=reject | 18 | 18641 | 19742 | 6505 | 1 | FAIL |
| carlyle-final | 0001702510-26-000009 / SC TO-I/A | final_results_observed=true | 9 | 4714 | 5175 | 미호출 | 0 | NOT_RUN; stopped after DXL failure |
| xerox-terminated | 0001193125-20-092896 / SC TO-T/A | offer_status=terminated | 9 | 6663 | 7290 | 미호출 | 0 | NOT_RUN; stopped after DXL failure |

provider input chars는 실제 user-part의 compact JSON 문자열 길이이며 source chars는 Evidence.text 합계이다. 전체 request chars에는 schema/system prompt/JSON escape가 추가된다. 토큰 수와 문자 수를 혼동하지 않는다.

## rumble-active

SEC: [0001213900-25-000757](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm). source 재검토: All24 slices read. E1/E2 explicit Feb4 scheduled expiration; E16 repeats headline. E2 April30 outside limit is not current expiration. E8/E9 explicit cash $7.50, E6/E7/E10 market $12.40 and E15 aggregate250m are distractors. E12/E13/E15 explicit board no recommendation despite approval of making offer. E3 tender mechanics; E4 possible extensions/termination, E5/E17-E19 holder withdrawal mechanics; E20-E23 future preliminary/final/proration results; E24 operating risks. No actual terminal event or actual final results. No explicit previous for any active FACT.

Frozen expected FACT set:

```json
[
  {
    "type": "expiration",
    "current": "2025-02-04"
  },
  {
    "type": "offer_price",
    "current": {
      "amount": 7.5,
      "currency_text": "$",
      "unit": "cash_per_share"
    }
  },
  {
    "type": "board_recommendation",
    "current": "no_recommendation"
  }
]
```

출력하면 안 되는 types: offer_status, final_results_observed. 필요한 unresolved type 범위: 없음.

실제 raw Structured output:

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": "2025-02-04",
      "evidence_refs": [
        "E1",
        "E2",
        "E16"
      ]
    },
    {
      "type": "offer_price",
      "current": {
        "amount": 7.5,
        "currency_text": "$",
        "unit": "cash_per_share"
      },
      "evidence_refs": [
        "E8",
        "E9",
        "E16"
      ]
    },
    {
      "type": "board_recommendation",
      "current": "no_recommendation",
      "evidence_refs": [
        "E12",
        "E13",
        "E15"
      ]
    }
  ],
  "unresolved": []
}
```

- 출력 type: expiration, offer_price, board_recommendation. Missing type0 / excess type0.
- Schema/local/provenance 모두 PASS. HTTP200, modelVersion gemini-3.5-flash, physical calls1, input/output tokens 7866/226, latency 3208ms.
- 값/previous 대조: 모든 current와 previous 생략이 frozen baseline과 일치.
- Unresolved: Empty is correct: all requested active claims established; two terminal types normally absent.
- Cross-FACT checks: unless terminated not promoted to actual offer_status; holder withdrawal not promoted; future proration/final results not observed; market $12.40 and aggregate amounts excluded; all three positives emitted together
- 결과: **PASS**, failure class 없음.

FACT별 인용 검토:

- expiration: current: E1 DIRECT: Offer will expire February4,2025; E2 DIRECT: same scheduled expiration; April30 extension limit distinct; E16 DIRECT: headline February4 expiry / previous: correctly omitted

- offer_price: current: E8 DIRECT: $7.50 per Share and cash payment; E9 DIRECT: $7.50 per Share in cash; E16 DIRECT: same $7.50 per-share Purchase Price; cash corroborated by E8/E9 / previous: correctly omitted

- board_recommendation: current: E12 DIRECT: board expressly makes no recommendation despite offer approval; E13 DIRECT: same board no-recommendation statement; E15 DIRECT: same explicit no-recommendation / previous: correctly omitted

[원본 provider response](runs/rumble-active/provider-response.txt) · [Structured bytes](runs/rumble-active/structured.txt) · [Evidence mapping](runs/rumble-active/evidence-map.json) · [provenance audit](runs/rumble-active/provenance-audit.json) · [원문 대조 review](runs/rumble-active/review.json).

## dxl-amendment

SEC: [0001193125-26-298540](https://www.sec.gov/Archives/edgar/data/813298/000119312526298540/sch14d9_amendment_3_july.htm). source 재검토: All18 slices re-read; current July24 expressly stated E1/E2 and amendment E12/E13. Previous June22 is an expiration explicitly in E4/E13, not inferred merely from as-of count. Price E12/E13 explicitly increased .82 to .84, E8/E9 cash terms. E6 $1.25 separate January acquisition proposal is not previous tender price. E11/E12 current board reject; temporary June23 take-no-action is not previous board recommendation. E15 withdrawal of competing FBB merger recommendation is not offer_status or previous tender recommendation. E3 HSR terminated waiting periods and E5 conditions are not actual tender termination. E10/E17/E18 CIC compensation and July31 assumed consummation not tender price/expiration. E16 shares outstanding and E12/E13 interim June22 tendered count not final. E14 heading. No terminal/final facts.

Frozen expected FACT set:

```json
[
  {
    "type": "expiration",
    "current": "2026-07-24",
    "previous": "2026-06-22"
  },
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
    }
  },
  {
    "type": "board_recommendation",
    "current": "reject"
  }
]
```

출력하면 안 되는 types: offer_status, final_results_observed. 필요한 unresolved type 범위: 없음.

실제 raw Structured output:

```json
{
  "facts": [
    {
      "type": "expiration",
      "current": "2026-07-24",
      "evidence_refs": ["E1"]
    },
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
      "evidence_refs": ["E8", "E9", "E12", "E13"]
    },
    {
      "type": "board_recommendation",
      "current": "reject",
      "evidence_refs": ["E11", "E12"]
    }
  ],
  "unresolved": []
}
```

- 출력 type: expiration, offer_price, board_recommendation. Missing type0 / excess type0.
- Schema/local/provenance 모두 PASS. HTTP200, modelVersion gemini-3.5-flash, physical calls1, input/output tokens 6505/226, latency 2824ms.
- 값/previous 대조: current 값 및 price.previous는 일치. expiration.previous=2026-06-22 누락; baseline 불일치.
- Unresolved: Empty unresolved does not acknowledge the omitted explicit prior expiration.
- Cross-FACT checks: All three expected types emitted; no excess types; Interim count not promoted to final; Competing proposal $1.25 not previous price; FBB merger recommendation not previous tender board recommendation; No actual offer_status from conditions/holder withdrawals; Missing explicit expiration.previous is cross-FACT retention failure; cause of attention competition is not established
- 결과: **FAIL**, failure class MODEL_ERROR.

FACT별 인용 검토:

- expiration: current: E1 DIRECT: current scheduled July24,2026 / previous: FAIL: missing explicit June22,2026 in E4/E13

- offer_price: current: E8 DIRECT: current $0.84 per share cash; E9 DIRECT: same operative cash terms; E12 DIRECT: increased $.82 to $.84; E13 DIRECT: same explicit price amendment / previous: E12 DIRECT: earlier $.82 in same increase sentence; E13 DIRECT: earlier $.82 in same increase sentence

- board_recommendation: current: E11 DIRECT: announced board recommend reject and not tender; E12 DIRECT: board explicitly recommended rejection / previous: correctly omitted; temporary company communication and separate FBB merger are not previous tender recommendations

[원본 provider response](runs/dxl-amendment/provider-response.txt) · [Structured bytes](runs/dxl-amendment/structured.txt) · [Evidence mapping](runs/dxl-amendment/evidence-map.json) · [provenance audit](runs/dxl-amendment/provenance-audit.json) · [원문 대조 review](runs/dxl-amendment/review.json).

## carlyle-final

SEC: [0001702510-26-000009](https://www.sec.gov/Archives/edgar/data/1702510/000170251026000009/cars_2026130xsctoa.htm). source 재검토: All9 slices read. E2 explicitly received final results of Offer expired Jan21 and shares accepted; E8 explicitly final-results report. Do not create active expiration. E3/E4 show price tied to NAV per share and purchase payment through nontransferable promissory notes; $18.82 is NAV valuation/result with aggregate payment, not fixed all-cash offer terms within accepted price scope. No board shareholder recommendation is supplied. E1/E6 fees, E5 identity/par value, E7 amendment caption, E9 final checkbox corroboration. Completion/accepted shares not actual withdrawn/terminated.

Frozen expected FACT set:

```json
[
  {
    "type": "final_results_observed",
    "observed": true
  }
]
```

출력하면 안 되는 types: expiration, offer_price, board_recommendation, offer_status. 필요한 unresolved type 범위: expiration, offer_price, board_recommendation.

**미호출/미검증**. 앞선 DXL 실패로 중단했다. raw response, tokens, schema/local/provenance 실행 결과와 semantic PASS는 존재하지 않는다. [frozen request](runs/carlyle-final/request.json)와 [source](runs/carlyle-final/source.json)만 보존한다. 실패 분류는 이 case 자체의 실패가 아닌 이전 MODEL_ERROR로 인한 NOT_RUN이다.

## xerox-terminated

SEC: [0001193125-20-092896](https://www.sec.gov/Archives/edgar/data/47217/000119312520092896/d909416dsctota.htm). source 재검토: All9 slices read. E7 explicit Offer terminated March31; no shares purchased and return instructions. E1 historical $18.40 cash plus .149 Xerox shares with election/proration: composite offer out of fixed-all-cash contract. E2-E4/E8 fee/payment/transaction calculations and $22.05 market price are not tender price; historical filed March2 and terminated March31 not scheduled expiration. E5 identity/par value and E6/E9 heading/signatures. No shareholder recommendation supplied. E1 final-amendment reporting-results checkbox is unchecked; no actual final-results announcement. Return of shares is not final_results_observed.

Frozen expected FACT set:

```json
[
  {
    "type": "offer_status",
    "current": "terminated"
  }
]
```

출력하면 안 되는 types: expiration, offer_price, board_recommendation, final_results_observed. 필요한 unresolved type 범위: expiration, offer_price, board_recommendation.

**미호출/미검증**. 앞선 DXL 실패로 중단했다. raw response, tokens, schema/local/provenance 실행 결과와 semantic PASS는 존재하지 않는다. [frozen request](runs/xerox-terminated/request.json)와 [source](runs/xerox-terminated/source.json)만 보존한다. 실패 분류는 이 case 자체의 실패가 아닌 이전 MODEL_ERROR로 인한 NOT_RUN이다.

## 호출·비용 판단

- 계획 filings4, 실행 filings **2**, physical Gemini calls **2**. 미사용 예산2회는 추가로 쓰지 않았다.
- 평균 input tokens **7185.5**, 총 input **14371**, output **452**, 합계 **14823**.
- Retry0 / repair0 / fallback0 / re-call0 / per-FACT provider calls0.
- 모든 실행 응답 HTTP200 / STOP / gemini-3.5-flash. 전송·모델가용성·schema/provenance 실패0. 의미 실패1.

이미 지불된 동일 모델의 과거 usage metadata만 비용 비교에 사용했다. 과거 structured output은 읽어 oracle로 사용하지 않았다:

| filing | 과거 독립 실험(확인된 부분집합) | 과거 input | 이번 통합 input | input 감소 |
|---|---|---:|---:|---:|
| rumble-active | 4회 (offer_price, board_recommendation, offer_status, final_results_observed) → 1회 | 16599 | 7866 | 52.6% |
| dxl-amendment | 3회 (offer_price, board_recommendation, final_results_observed) → 1회 | 13192 | 6505 | 50.7% |

이 비교는 서로 다른 selected packet/prompt를 쓴 과거 실험이며, 다섯 독립 호출을 이번에 같은 조건으로 실행한 비교가 아니다. Rumble은 과거4종만으로16,599 input tokens였고 이번5종 검토는7,866이었다. DXL은 과거3종13,192 대비6,505지만 **정확도 FAIL이므로 비용 감소로 통과 처리할 수 없다**. 전체5-call의 정확한 청구액/토큰 감소율은 미검증이다. 실제 청구 금액은 조회하지 않았다.

별도 유료 비교 없이 문자수도 계산했다: 동일 통합 source를5번 반복 전송하는 가정에 비해1회 전송은 source 문자 중복80% 감소. Rumble31,912 vs159,560, DXL19,742 vs98,710 chars. 독립 prompt 합13,361 chars 대비 union6,215 chars. 이는 로컬 문자수 비교이며 토큰이나 실제 달러 절감률이 아니다. FACT별 provider-input/request 파일을 새로 만들거나 호출하지 않았다. 상세 usage 출처와 계산은 [audit-summary.json](audit-summary.json)에 있다.

**기존 FACT별 독립 실험은 검증 목적이었으며 production 구조가 아니다.** Production candidate의 원칙은 **Tender filing1건 → Gemini3.5 Flash1회 → 최대5 FACT 동시 추출**이다. 비용상 유리한 방향은 확인했으나 이번 통합 정확도 gate를 통과하지 못했으므로 운영 후보 검증 완료라고 판단하지 않는다. 이 원칙을 유지하며 FACT별 호출로 되돌리지 않는다.

## 실패 분류와 종료 상태

| 분류 | 결과 |
|---|---|
| MODEL_ERROR | DXL explicit expiration.previous 누락1건 |
| SOURCE_COVERAGE | 유료 호출 전4-query exploration의 Xerox actual-status 누락. 공통5-query로 해결 후 freeze; 호출 후 변경0 |
| SCHEMA_ERROR | 유료 응답0; optional previous omission은 형식 오류가 아님 |
| SOURCE_UNRESOLVED | 유료 응답에서 확정 실패 원인으로 관찰0; terminal 두 case는 미호출 |
| PROVIDER_MODEL_UNAVAILABLE | 0 |
| PREFLIGHT_TEST_ERROR | 기존 helper20-ID read 상한1건; 신규 adapter 분할 read로 호출 전 해결 |

기존 다섯 독립 FACT의 Practical PASS는 그대로 유지한다. **5-FACT single-call extraction Practical PASS는 아님**. Rumble1건 PASS, DXL1건 FAIL, Carlyle/Xerox2건 미실행. 신규 typed FACT나 통합 제품 저장 구조를 구현하지 않았다. Source/contract를 다시 고쳐 호출하는 다음 실험은 승인 대기하며 STOP한다.

## 로컬 검증·범위

Base: 0e020ecb090bf41dedcc9b4dd75bf5e56420ccaa. Workspace: C:\Users\PC\.codex\worktrees\87db\US-Stock Radar, 기존 detached HEAD. 신규 scripts/tender-union-single-call/만 변경. 최종 commit/clean 상태는 완료 메시지에서 제공한다.

8 offline tests PASS: 32개 sparse subset, 기존 union branch 동등성, 중복type/잘못된 필드·ref·false 거절, semantic correction 없음,4회 예산/동일case 차단, source dedupe isolation, success/HTTP/transport/중복type의 physical1/no retry. TypeScript PASS. Frozen input/원본 응답 bytes/모든 emitted ref review/provenance/기존 파일 hash 감사 PASS. 이는 **기술 테스트 PASS이며 의미 실험 PASS를 대신하지 않는다**.

```powershell
node --no-warnings --experimental-strip-types --test scripts/tender-union-single-call/contract.test.mjs
node --no-warnings --experimental-strip-types scripts/tender-union-single-call/audit.mjs
npm run typecheck
git diff --check
```

위 명령은 provider 호출이 없다. 시작된 두 run은 재호출 금지이며 뒤의 두 live case는 실패 review gate로 차단된다. DB/migration/persistence/job/Reader/Monitor/Matcher/Alert/UI/cron/main merge/push/deploy/외부 발송은 수행하지 않았다. UI·계정·모바일 변경이 없어 화면 검증은 해당 없음. 운영 main/GitHub/Vercel 상태는 검증하지 않았으며 운영 반영 완료를 주장하지 않는다.
