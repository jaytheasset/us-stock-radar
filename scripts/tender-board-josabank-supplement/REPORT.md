# Jos. A. Bank — board previous transition 검증

**이번 case PASS. 최신 사용자 판정 기준에 따라 board_recommendation은 대표7건 Practical PASS, Tender3 FACT는 최종3/3 Practical PASS로 판정한다.**

기존 board current-state5건과 Beacon transition PASS에 Jos. A. Bank transition PASS를 더한 결과다. Cream의 `no_recommendation→accept` 조합은 여전히 미검증이며,6-K SOURCE_COVERAGE / provider0회 기록을 그대로 유지한다. 이는 대표 사례 기준의 실험 판정이고 exhaustive coverage나 운영 준비 완료를 뜻하지 않는다. source 의미 검토는 Codex가 직접 수행했으며 독립적인 사람 검수 완료를 주장하지 않는다.

## 1. SEC filing identity

|항목|확인 결과|
|---|---|
|Company / CIK|Jos. A. Bank Clothiers, Inc. /920033|
|Parent form|SC14D9/A (SEC index 표기)|
|Amendment|No.17 — SEC primary opening에서 직접 확인|
|Accession|0001047469-14-002675|
|Primary document|a2219129zsc14d9a.htm, sequence1, SC14D9/A|
|Filing date / accepted|2014-03-20 /2014-03-20 06:07:24|

[SEC filing index](https://www.sec.gov/Archives/edgar/data/920033/000104746914002675/0001047469-14-002675-index.html)와 [SEC primary](https://www.sec.gov/Archives/edgar/data/920033/000104746914002675/a2219129zsc14d9a.htm)를 직접 확인했다. [보존 index](josabank-sec-index.html), [identity audit](identity.json). Index의 form/accession/filename을 사용했고 Parser의 form은 사용하지 않았다.

## 2. Source coverage와 same-tender lineage

기존 [일반 board queries](../tender-fact-batches/board_recommendation/source-plan.json)3개를 그대로 사용했다. 기존 `buildTenderEvidenceIndex → search_evidence(limit5) → read_evidence`에서 중복 제거한11개 Evidence,15323 characters를 얻었다. partialDocuments/unavailable은 비어 있다. 기존 [source preparation utility](../tender-fact-batches/prepare-source.mjs)를 수정 없이 실행했다. [이번 source plan](source-plan.json), [acquisition/search 기록](sources/josabank.acquisition.json), [호출 전 source audit](source-audit.json).

호출 전3개 조건 모두 PASS:

|Coverage 조건|Selected source의 직접 근거|
|---|---|
|이전 reject/not tender|E1/E2: Initial Offer. E5: February27 First Amended Offer에 대한 Board reject/not tender|
|현재 accept/tender|E3/E4/E10/E11: Second Amended Offer에 대한 Board accept/tender|
|같은 tender lineage|E2 Initial Offer, E5 First Amended Offer, E3 Second Amended Offer가 동일한 정의명 Offeror를 사용. E5는 MW와의 거래 검토 및 Men's Wearhouse 명칭을 포함|

E5는 별도 Everest Transaction/Company Tender Offer를 배경·분석 가정으로 구분해 언급하면서, Board의 reject 추천 대상은 **First Amended Offer**라고 명시한다. E3은 같은 Offeror에게 **Second Amended Offer**에 따라 tender하라고 명시한다. 따라서 다른 transaction 추천을 previous로 결합할 필요가 없다.

Primary opening도 identity 확인용으로 읽어 Java Corp=Offeror, Men's Wearhouse=MW와 Amendment17을 확인했다. 이 opening을 별도 Evidence로 추가하거나 provider에게 전달하지 않았다. 위 coverage 판정은 실제 selected E2/E5/E3의 공통 Offeror와 offer 단계 표현으로 성립한다.

## 3. 실제 provider source 및 frozen artifacts

[Provider에게 전달한11개 Evidence 전체](run/provider-source.json) · [provenance 포함 source](run/source.json) · [exact request](run/request.json).

Provider input은 기존 `{form, coverage, evidence:[{ref,text}]}`뿐이다. expected answer는 [manifest](manifest.json)/source audit에만 있고 provider input에 없다. 실제 Evidence ID/URL/hash/offset/document identity는 [frozen map](run/evidence-map.json)에 보존했다. SEC text 자체에 나타나는 정보는 원문으로 유지했다.

[Prompt](run/prompt.txt) · [Provider schema](run/provider-schema.json) · [Run hashes](run/frozen.json) · [기존 파일/이번 입력 보존 hashes](frozen-supplement.json) · [fetch 전 started marker](run/started.json).

기존 `board_recommendation.ts`를 import하여 prompt/schema/enum/Validator를 그대로 재사용했다. 기존 code의 `callOnce`와 identity lookup도 그대로 사용했다. retry/repair/fallback/postprocessing0이며 previous 삽입·값 정규화·ref 교체/삭제0이다.

## 4. Raw Structured output

```json
{
  "facts": [
    {
      "type": "board_recommendation",
      "current": "accept",
      "previous": "reject",
      "evidence_refs": [
        "E1",
        "E2",
        "E3",
        "E5",
        "E10",
        "E11"
      ]
    }
  ],
  "unresolved": []
}
```

[위 Structured 원응답](run/structured.txt) · [전체 provider response](run/provider-response.txt).

## 5. 호출·형식·provenance 결과

|항목|결과|
|---|---|
|Physical provider calls|**1**|
|HTTP / finishReason|200 / STOP|
|요청 모델 / 응답 modelVersion|gemini-3.5-flash / gemini-3.5-flash|
|Provider tokens|input3655 / output102 / total3757|
|Latency|2489ms, 요청부터 응답/감사 기록까지 local 측정|
|Provider schema / local validation|PASS / PASS|
|Provenance|PASS:6개 selected ref 모두 해당 accession의 frozen Evidence ID로 정확히 resolve|
|현재·이전 의미 / Evidence support|PASS / PASS|
|Unresolved|[] — 예상과 일치|
|실패 분류|없음|

[HTTP/model/usage/local 감사](run/audit.json) · [정확한 ref→actual ID lookup](run/provenance-audit.json) · [의미/support 검토](run/semantic-review.json). Validator는 형식만 확인했다. 다음 의미 판정은 원문을 직접 읽어 별도로 수행했다.

## 6. Current·previous 직접 대조와 타 거래 배제

|모델 선택 ref|판정 대상|Direct support 확인|
|---|---|---|
|E1|previous|January17 Board reject Initial Offer / not tender. 앞의 advisor disclaimer와 Board 추천을 구분|
|E2|previous|Offeror의 Initial Offer에 대한 Board reject/not tender 명시|
|E3|current|March11 Board가 Second Amended Offer accept/tender to Offeror를 결의·추천|
|E5|previous|February27 Board가 First Amended Offer reject/not tender 명시 — 더 최근 prior state 직접 지원|
|E10|current|Second Amended Offer accept/tender 직접 추천|
|E11|current|위험 고려 뒤 Board가 Second Amended Offer accept/tender 직접 추천|

current direct refs3개(E3/E10/E11), previous direct refs3개(E1/E2/E5)로 각각 최소1개 조건을 충족한다. 같은 offer의 역사적 reject가 현재 accept와 함께 있어도 시점이 구분되므로 모순 근거가 아니다. 모든 selected ref를 검토했고 fabricated/foreign/missing/unreviewed/irrelevant ref는 없다.

E5의 Everest/Company Tender Offer는 같은 slice의 주변 문맥이지만, 실제 추천 문장은 명시적으로 First Amended Offer에 관한 것이다. 따라서 이 ref를 선택한 것 자체가 unrelated transaction 근거 선택은 아니다. 모델은 Everest termination(E4), advisor 의견 disclaimer(E6/E8/E9), appraisal not-tender 절차(E7)를 현재/이전 Board 추천으로 가져오지 않았다. 이전 reject는 Gemini가 원문에서 직접 출력했고 코드가 계산·삽입하지 않았다.

## 7. 최종 Practical PASS 판정

|대표 검증|판정|
|---|---|
|기존 board current-state5건|PASS 유지 — accept/reject/no_recommendation/unresolved 및 amendment context|
|Beacon same-tender reject→accept|PASS 유지|
|Jos. A. Bank same-tender reject→accept|**PASS**|
|Board 대표7건 종합|**Practical PASS**|
|expiration|이전 Practical PASS 인정 유지|
|offer_price|이전 scoped Practical PASS 인정 유지|
|Tender3 FACT|**3/3 Practical PASS**|

최신 사용자 기준은 current enum 대표 검증과 실제 same-tender previous 관계 검증의 조합으로 Practical PASS를 판단하며, enum×position의 모든 조합을 요구하지 않는다. 이 기준에서 board의 마지막 보강 요건을 충족했다.

남은 한계는 유지한다. Cream은6-K form gate로 계속 SOURCE_COVERAGE/provider0회이며 `previous=no_recommendation→current=accept`를 검증한 것이 아니다. 실제 두 transition은 모두 reject→accept로 반대 방향도 미검증이다. 3-FACT union extraction, 운영 consumer, 독립 human 검수, 일반적 정확도·반복 안정성은 미검증이다. 기존 expiration의 시간/복수 offer, 가격의 ISO 통화/복합 consideration 제한도 그대로다.

이번 결과로 이전 batch나 Beacon/Cream 보고서를 수정하지 않았다. 이전 보류 판정은 그 당시의 기준·결과로 남기며, 이 supplement가 최신 사용자 기준에 따른 최종 판정을 기록한다. [최종 result](result.json).

## 8. 검증·작업 상태·종료

Base `6f96b33b24c11ee486399420600005fa7cf2dc10`, same87db detached worktree. 새 `scripts/tender-board-josabank-supplement/`만 추가했다. 기존15개 batch, Beacon/Cream supplement, contract, queries 및 Tender source code는 보존 hash 검사를 통과했다. 기존 experiment artifacts는 base Git blob과 byte-identical이며 library 파일은 Git-clean identity와 freeze 시 실제 디스크 byte를 함께 확인했다.

오프라인7/7 tests PASS, `npm run typecheck` PASS, completed audit PASS. 새 preflight/provider/schema/semantic 오류0. 보존 SEC index의 원본 whitespace는 유지한다. UI 변경이 없으므로 화면 검증은 해당 없음이다. 최종 commit/clean 상태는 완료 메시지에 기록한다.

추가 유료 호출 없이 재검증:

```powershell
node --no-warnings --experimental-strip-types scripts/tender-board-josabank-supplement/verify-completed.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-fact-batches/board-contract.test.mjs scripts/tender-fact-batches/runner.test.mjs
```

기존 started를 삭제하거나 live/freeze를 재실행하지 않는다. **여기서 STOP한다.** FACT4/5, union extraction, DB/persistence/Reader/Matcher/Monitor/Alert/cron/merge/push/deploy는 하지 않았다.3110 조작·환경변수 수정 없음. 운영 main/GitHub/Vercel 상태는 이번 후보 실험의 검증 범위 밖이며 운영 완료를 주장하지 않는다.
