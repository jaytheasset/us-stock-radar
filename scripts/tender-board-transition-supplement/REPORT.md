# Board recommendation previous — transition supplement

**Beacon PASS. Cream은 SOURCE_COVERAGE로 미실행. 요청된 transition 2/2 PASS는 달성하지 못했으며 board 최종 Practical PASS는 보류한다.**

기존 board current-state5건은 PASS로 유지하고, 이번 Beacon1건도 PASS다. 그러나 `previous=no_recommendation` transition은 미검증이다. 따라서 현재 사용자의 최종 gate에서 Tender는 **2/3 Practical PASS 인정, board1개 보류**다. 이전 보고서의3/3 결론과 raw/result/review/ledger는 수정하지 않았고, 이번 supplement에서만 최종 판정을 명확히 한다.

## 실행 범위

Base: `af34a2d142dd853fc7c3e2e2d8de65b0d329cab7`.
워크트리: `C:\Users\PC\.codex\worktrees\87db\US-Stock Radar`, detached candidate.
신규 physical provider calls **1회**: Beacon1회, Cream0회. 모델 **gemini-3.5-flash**. Retry/repair/fallback/동일 case 재호출0.

기존 [board contract](../tender-fact-batches/contracts/board_recommendation.ts)의 prompt/schema/enum을 그대로 import했다. 기존 [일반 board queries](../tender-fact-batches/board_recommendation/source-plan.json)3개도 변경 없이 재사용했다. Top5×3 queries의 중복 제거11개 selected Evidence를 Beacon 입력으로 사용했다. 정답 문구 기반 특수 검색, Selector 변경, Parser semantic 사용, 다른 case 추가는 없었다. expected는 [manifest](manifest.json) 및 [source audit](source-audit.json)에만 있고 provider input에는 없다.

이번 의미 검토는 Codex가 selected 원문을 직접 읽어 수행했다. 독립적인 사람의 추가 검수 완료를 뜻하지 않는다.

## Case A — Beacon Roofing Supply

|항목|확인 결과|
|---|---|
|CIK|1124941|
|Parent form|SC 14D9/A, Amendment No.15|
|Accession|0001213900-25-026560|
|Filing date / accepted|2025-04-01 / 2025-03-31 20:48:57|
|Document|ea0236304-sc14d9a15_beacon.htm, primary, SC 14D9/A|
|Source coverage|PASS: current와 previous 직접 문장 모두 selected Evidence 안에 존재|
|Physical calls|1|
|HTTP / finish reason|200 / STOP|
|Request model / returned modelVersion|gemini-3.5-flash / gemini-3.5-flash|
|Tokens|input2998 / output106 / total3104 (provider usageMetadata)|
|Latency|1936ms (local request through response/audit measurement)|
|Provider schema / local validation|PASS / PASS|
|Provenance mapping|PASS: 선택7개 ref 모두 frozen same-accession Evidence ID와 정확히 일치|
|SEC 의미 / Evidence support|PASS / PASS|
|최종 판정 / 실패 분류|PASS / 없음|

[SEC filing index](https://www.sec.gov/Archives/edgar/data/1124941/000121390025026560/0001213900-25-026560-index.html)에서 parent form·amendment·document identity를 확인했다. [SEC target source](https://www.sec.gov/Archives/edgar/data/1124941/000121390025026560/ea0236304-sc14d9a15_beacon.htm), [보존 index](beacon-sec-index.html), [identity](beacon-identity.json).

### 실제 제공된 source와 freeze

[전체 selected Evidence](runs/beacon/source.json) → [실제 provider-source](runs/beacon/provider-source.json) → [exact request](runs/beacon/request.json).
Provider에는 `{form,coverage,evidence:[{ref,text}]}`만 보냈다. [실제ID mapping](runs/beacon/evidence-map.json), [frozen hashes](runs/beacon/frozen.json), [prompt](runs/beacon/prompt.txt), [provider schema](runs/beacon/provider-schema.json), [started marker](runs/beacon/started.json)를 별도 보존했다. 모든 selected source 문자는 기존 Evidence renderer의 위치 slice와 일치하며, source/text hash도 확인했다.

|Selected ref|원문 내용 및 역할|모델 선택|
|---|---|---|
|E1|현재 Board가 ACCEPT/TENDER to QXO를 명시|예|
|E2|February6 Board의 Initial Offer REJECT/NOT TENDER 추천|예|
|E3|같은 과거 reject와 QXO의 반응|예|
|E4|현재 Offer/Merger의 Board accept/tender 추천|예|
|E5|Amended Offer accept/tender 명시|예|
|E6|March31 amendment와 현재 accept/tender 추천|예|
|E7|Financial advisor fairness opinion의 recommendation disclaimer|아니오|
|E8|QXO Initial Offer 개시와 임시 company take-no-action|아니오|
|E9|현재 Board accept/tender to QXO 재명시|예|
|E10|QXO Initial Offer 정의, 임시 company communication, rights plan|아니오|
|E11|다른 제안자/시장 조건 검토 배경|아니오|

### Raw Structured output

```json
{"facts":[{"type":"board_recommendation","current":"accept","previous":"reject","evidence_refs":["E1","E2","E3","E4","E5","E6","E9"]}],"unresolved":[]}
```

위 값과 ref는 [structured 원응답](runs/beacon/structured.txt)을 표시한 것이다. [전체 provider response](runs/beacon/provider-response.txt), [HTTP/model/usage/validation 감사](runs/beacon/audit.json), [lookup 결과](runs/beacon/provenance-audit.json), [의미/support 상세 검토](runs/beacon/semantic-review.json).

### Current 및 previous 직접 대조

- **current=accept:** E1/E9는 Board가 주주에게 Offer를 accept하고 QXO에 shares를 tender하라고 명시한다. E5는 그 추천의 대상을 Amended Offer로 명시한다. E4/E6에도 같은 현재 offer의 accept/tender 추천이 있다. direct selected refs는 E1/E4/E5/E6/E9다.
- **previous=reject:** E2/E3는 February6 발표 당시 Board가 주주에게 Initial Offer를 reject하고 shares를 tender하지 말라고 추천했음을 직접 명시한다. direct selected refs는 E2/E3다.
- **동일 tender lineage:** E8/E10은 QXO Initial Offer를 정의하고, E3은 그 추천에 대한 QXO의 반응을 설명한다. E1/E9 현재 추천도 QXO를 명시하며 E5는 Amended Offer를 명시한다. 다른 competing offer나 다른 merger recommendation을 previous로 가져온 것이 아니다.

선택7개 ref를 전부 검토했다. 각 ref는 current 또는 previous에 direct support를 제공하고, 서로 다른 시점의 추천이므로 상충 근거로 오인하지 않았다. claim 각각 direct 최소1개 조건을 충족한다. advisor disclaimer/임시 take-no-action/타 제안자 배경은 ref로 선택하지 않았다. previous는 Gemini가 출력했으며 validator나 코드가 삽입·계산하지 않았다.

## Case B — Cream Minerals

|항목|확인 결과|
|---|---|
|CIK|1066130|
|실제 parent form|**6-K**|
|Accession|0001137171-10-000736|
|Filing date / accepted|2010-12-09 / 2010-12-09 15:15:16|
|Parent primary document|cream6k12092010.htm|
|Target document|**notice.htm**, sequence9, **EX-99.8**, attachment|
|Index description|Notice of Change to Supplementary Directors' Circular|
|Source acquisition/preparation|SEC source fetch 후 기존 buildTenderEvidenceIndex에서 form validation 거부|
|Selected Evidence / provider input|생성되지 않음|
|Physical provider calls|**0**|
|Provider HTTP/model/tokens/latency|해당 없음 — provider 호출하지 않음|
|Raw Structured output|없음|
|Schema/local validation / provenance mapping|미실행 / 미생성|
|Current·previous 의미 / Evidence support|미검증|
|판정 / 실패 분류|**NOT_EXECUTED / SOURCE_COVERAGE**|

[SEC filing index](https://www.sec.gov/Archives/edgar/data/1066130/000113717110000736/0001137171-10-000736-index.html)를 직접 확인했다. [보존 index](cream-sec-index.html), [identity](cream-identity.json), [target notice](https://www.sec.gov/Archives/edgar/data/1066130/000113717110000736/notice.htm), [preparation 실패 trace](preparation-attempt.json), [case 결과](cream-result.json).

실제 form을6-K로 전달하자 기존 [Tender Evidence identity validation](../../lib/sources/sec/forms/tender/evidenceSource.ts)이 `Invalid Tender filing identity`를 반환했다. 현재 `TENDER_EVIDENCE_FORMS`에는6-K가 없다. 따라서 두 recommendation 문장을 selected Evidence에서 검수할 단계까지 도달하지 못했다.

이 분류는 **현재 source pipeline의 지원 form 경계**다. SEC document가 없다는 뜻도, notice에 transition이 없다는 뜻도, Gemini가 previous를 틀렸다는 뜻도 아니다. 사용자 expected `no_recommendation→accept`는 유지하되 미검증으로 남긴다. form을 SC14D9/CB로 위장하거나 validator를 우회하거나 다른 경로로 원문을 provider에 보내지 않았다.

## 검증·실패 이력

- 완료된 preflight tests7/7 PASS: supplement coverage gate2개 + 기존 one-call/provenance tests5개. 이후 `npm run typecheck` PASS, 완료 감사PASS.
- 기존15개 provider run 및 관련 artifacts/contract는 base blob과 byte 비교해 보존을 확인했다. 기존 Tender library는 Git-clean identity를 확인하고 실제 디스크 byte hash를 freeze한 뒤 재검사했다. 일반 source queries도 완전히 동일하다.
- 신규 supplement의 첫2회 freeze 시도는 Windows의 혼재 LF/CRLF 파일 표현을 잘못 비교해 중단됐다. 각각 [preflight-01](preflight-01/failure.json), [preflight-02](preflight-02/failure.json)에 `PREFLIGHT_TEST_ERROR`로 보존했다. 둘 다 frozen request/started marker 생성 전이며 physical calls0이다. 수정은 supplement의 파일보존 검사 방식뿐이다. schema/prompt/enum/source query/Selector/의미 값은 변경하지 않았다.
- 신규 semantic MODEL_ERROR0, SCHEMA_ERROR0, PROVIDER_MODEL_UNAVAILABLE0. SOURCE_COVERAGE1(Cream). failed/started run 삭제·덮어쓰기 및 재호출 없음.

읽기 전용 재검증 명령:

```powershell
node --no-warnings --experimental-strip-types scripts/tender-board-transition-supplement/verify-completed.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-board-transition-supplement/preflight.test.mjs scripts/tender-fact-batches/runner.test.mjs
```

live/freeze를 다시 실행하거나 기존 started marker를 삭제하지 않는다.

## 최종 판단과 종료

|Gate|판정|
|---|---|
|Beacon reject→accept|PASS|
|Cream no_recommendation→accept|SOURCE_COVERAGE로 미검증|
|Board transition2/2|**아니오 — 1/2만 검증**|
|기존 board current-state5건 + supplement|관찰된6건 PASS, 필수 transition1건 미검증|
|Board 최종 Practical PASS|**보류**|
|Tender3 FACT 최종 Practical PASS|**2/3 인정, board 보류**|

Beacon 결과는 현재 contract가 previous=reject를 직접 보존할 수 있다는 증거다. previous=no_recommendation 경로는 현재 Evidence source form 제한 때문에 평가할 수 없었다. 이번 결과만으로 contract를 수정하거나 폐기할 근거는 없으며, 해당 경로를 지원하는 source preparation 범위에 대한 별도 결정이 필요하다. 이 작업에서는 form 지원 확대나 대체 case를 진행하지 않는다.

모든 변경은 별도 `scripts/tender-board-transition-supplement/`에 한정한다. 기존 보고서·result·raw·review·ledger·frozen artifacts와 product code는 그대로다. DB/persistence/Reader/Matcher/Monitor/Alert/4·5 FACT/3-FACT union call/cron/main merge/push/deploy/3110 조작 없음. UI 변경이 없어 화면 검증은 해당 없음이며 운영 main/GitHub/Vercel 상태는 이번 실험에서 확인하지 않았다. 최종 commit/clean 상태는 완료 메시지에 기록한다. **여기서 STOP한다.**
