# Tender offer_status / final_results_observed 검증 보고서

판정: offer_status **5/5 Practical PASS**, final_results_observed **4/4 Practical PASS**. gemini-3.5-flash 총 **9 physical calls**, 각 case/FACT 1회. retry/repair/fallback/재호출/의미 교정 없음. 모든 호출 HTTP 200, finishReason STOP, 응답 modelVersion gemini-3.5-flash. 원문 대조는 **Codex 직접 검토이며 독립적인 사람의 signoff는 아직 아님**.

## 최소 schema 유지 결정

offer_status:

```json
{"facts":[{"type":"offer_status","current":"withdrawn","evidence_refs":["E1"]}],"unresolved":[]}
```

current enum은 withdrawn | terminated. 같은 실제 사건이 두 표현으로 기술되면 더 구체적인 명시적 withdrawn을 선택하도록 **호출 전에** 정의했다. 종료만으로 철회를 추론하지 않는다. Jos. A. Bank 원문이 실제로 두 표현을 함께 사용하므로 두 단어가 법적·언어적으로 완전히 배타적이라는 주장은 하지 않는다. 해당 구분이 미래 제품 요구와 맞지 않으면 별도 계약 검토가 필요하다. previous/date/reason/change 필드는 없다.

final_results_observed:

```json
{"facts":[{"type":"final_results_observed","observed":true,"evidence_refs":["E1"]}],"unresolved":[]}
```

observed는 true만 허용한다. 두 FACT 모두 정상적인 미관찰은 facts=[]와 unresolved=[]이며, selected source 밖에도 없다고 주장하지 않는다. 실제 source 불충분·모호함에만 unresolved를 사용한다. 결과 수치·지급·지분·날짜는 scope 밖이다. 각 FACT의 독립 schema를 유지하며 통합 schema는 만들지 않았다.

## Source 및 실험 경계

입력은 변경하지 않은 Tender Evidence index/search/read가 제공한 SEC source text만 사용했다. provider에는 form, coverage, evidence:[{ref,text}]만 전달했다. 실제 ID, URL, 문서 identity, hash, offset은 각 run의 evidence-map.json에만 있다. 기대 답은 manifest/source-audit에 분리했다. 관련 공시·기존 분석 결과를 provider input에 붙이지 않았다.

모든 case는 지원되는 실제 parent form을 SEC index와 대조했다. 각 문서는 complete이지만 전달은 bounded selected slices이며 외부 참조는 미해결이다. selection 문구의 complete는 filing 전체를 읽었다는 뜻이 아니다. 출처별 acquisition에는 검색 질의, 검색 결과, 원문/렌더링 hash가 있고 준비 단계에서 UTF-16 offset과 원문 slice 일치를 검사했다.

offer_status의 Carlyle 신규 일반 status 검색은 expired/final-results 문장을 놓쳤다(**SOURCE_COVERAGE**, 호출 전 발견). 기존 expiration 실험에서 일반 deadline 질의로 얻은 SEC Evidence packet을 수정 없이 재사용했다. 원래 source-plan의 신규 검색 결과도 보존했으며 실제 호출 source는 manifest의 carlyle-reused.json이다. 모델 응답 후 source 확대는 없었다. final_results_observed는 status PASS를 저장한 이후에만 준비했고 네 case 모두 같은 일반 final-results 질의 세 개를 사용했다.

실행 전 PLAN/manifest/source-audit, source, projection, map, prompt, provider schema, exact request, hash 및 run identity를 freeze했다. fetch 전 started.json을 exclusive 생성했다. 시작된 run은 재호출할 수 없다. 각 응답 후 source를 대조해 review.json을 작성한 다음에만 다음 case를 호출했다. validator는 형식과 ref membership/중복만 검사하며 의미 판단을 교정하지 않는다. resolveRefs는 정확한 frozen identity lookup만 한다.

## 사례별 원문 대조 및 호출 감사

각 행의 schema/local/provenance/의미 판정은 모두 PASS. token은 input/output/total, latency는 요청부터 응답 저장·검증까지 ms이다. 실패 분류 '없음'은 해당 유료 호출의 판정이며 Carlyle의 호출 전 coverage 문제는 위에 별도 기록했다.

| FACT / case | SEC accession / form | 기대 → 실제 | 직접 refs | calls / HTTP | tokens | ms | 실패 |
|---|---|---|---|---|---|---|---|
| offer_status / jos-withdrawn | 0001571049-14-000777 / SC TO-I/A | withdrawn → 일치 | E1 | 1 / 200 | 3161/61/3222 | 1651 | 없음 |
| offer_status / bluewolf-terminated | 0001144204-13-039264 / SC TO-I/A | terminated → 일치 | E1, E2, E4 | 1 / 200 | 2345/31/2376 | 1566 | 없음 |
| offer_status / rumble-right-only | 0001213900-25-000757 / SC TO-I | facts=[]; unresolved=[] → 일치 | 해당 없음 | 1 / 200 | 3731/16/3747 | 1662 | 없음 |
| offer_status / carlyle-expired-final | 0001702510-26-000009 / SC TO-I/A | facts=[]; unresolved=[] → 일치 | 해당 없음 | 1 / 200 | 1300/8/1308 | 1381 | 없음 |
| offer_status / xerox-terminated | 0001193125-20-092896 / SC TO-T/A | terminated → 일치 | E1 | 1 / 200 | 1976/25/2001 | 1748 | 없음 |
| final_results_observed / carlyle-final | 0001702510-26-000009 / SC TO-I/A | observed:true → 일치 | E1, E9 | 1 / 200 | 1994/67/2061 | 1811 | 없음 |
| final_results_observed / bcp-final | 0001193125-25-317765 / SC TO-T/A | observed:true → 일치 | E4 | 1 / 200 | 1702/61/1763 | 1821 | 없음 |
| final_results_observed / dxl-interim | 0001193125-26-298540 / SC 14D9/A | facts=[]; unresolved=[] → 일치 | 해당 없음 | 1 / 200 | 5896/16/5912 | 1617 | 없음 |
| final_results_observed / rumble-active | 0001213900-25-000757 / SC TO-I | facts=[]; unresolved=[] → 일치 | 해당 없음 | 1 / 200 | 3818/16/3834 | 1666 | 없음 |

총 provider 보고 tokens **26224**, latency 합계 **14923ms**. 실제 청구 금액은 조회하지 않았으므로 비용을 추정해 표시하지 않는다.

### offer_status — jos-withdrawn

- SEC 원문: [0001571049-14-000777](https://www.sec.gov/Archives/edgar/data/920033/000157104914000777/t1400406_scto-a.htm)
- 선정 이유 및 호출 전 판정: E1 explicitly withdrew March 11 and terminated same own repurchase offer; withdrawal precedence frozen. E2/E3 exhibit references concern other agreements; E4-E7 fee/identity not direct.
- source: 7 Evidence units / 8568 chars, partialDocuments=0, unavailable=0.
- 원문 대조: Explicit withdrew and terminated same offer; withdrawn matches predeclared specific-label precedence. No extra claims.
- Evidence support: E1 — DIRECT: actual Company withdrew Offer; same paragraph says terminated; no shares purchased.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](offer_status/runs/jos-withdrawn/provider-response.txt), [exact structured output](offer_status/runs/jos-withdrawn/structured.txt), [frozen source](offer_status/runs/jos-withdrawn/source.json), [Evidence mapping](offer_status/runs/jos-withdrawn/evidence-map.json), [call audit](offer_status/runs/jos-withdrawn/audit.json), [source comparison](offer_status/runs/jos-withdrawn/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{
  "facts": [
    {
      "type": "offer_status",
      "current": "withdrawn",
      "evidence_refs": [
        "E1"
      ]
    }
  ],
  "unresolved": []
}
```

### offer_status — bluewolf-terminated

- SEC 원문: [0001144204-13-039264](https://www.sec.gov/Archives/edgar/data/1517526/000114420413039264/v349922_sctoi-a.htm)
- 선정 이유 및 호출 전 판정: Actual tender termination July 12 after July 11 expiration; planned merger agreement termination is a different object. E5-E7 fees.
- source: 7 Evidence units / 7487 chars, partialDocuments=0, unavailable=0.
- 원문 대조: Actual tender termination correctly distinguished from historical expiry and intended future merger termination.
- Evidence support: E1 — DIRECT: Blue Wolf terminated Offer July 12.; E2 — DIRECT: same defined Offer was terminated July 12.; E4 — DIRECT: repeats actual tender termination and return/no purchase.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](offer_status/runs/bluewolf-terminated/provider-response.txt), [exact structured output](offer_status/runs/bluewolf-terminated/structured.txt), [frozen source](offer_status/runs/bluewolf-terminated/source.json), [Evidence mapping](offer_status/runs/bluewolf-terminated/evidence-map.json), [call audit](offer_status/runs/bluewolf-terminated/audit.json), [source comparison](offer_status/runs/bluewolf-terminated/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{"facts":[{"type":"offer_status","current":"terminated","evidence_refs":["E1","E2","E4"]}],"unresolved":[]}
```

### offer_status — rumble-right-only

- SEC 원문: [0001213900-25-000757](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm)
- 선정 이유 및 호출 전 판정: All 15 refs reviewed. E1/E2 scheduled active offer and may terminate, E3/E4/E11/E13 shareholder withdrawal procedures, E12 conditional public announcement, E14/E15 future conditions/proration. E5-E10 offer mechanics/market/listing context. No actual offer withdrawal or termination.
- source: 15 Evidence units / 15006 chars, partialDocuments=0, unavailable=0.
- 원문 대조: All15 refs show active offer/future conditions/procedures; empty facts and empty unresolved correctly abstain. No invented actual event from may terminate, withdrawal rights, or final binding procedural decisions.
- Evidence support: FACT 미출력으로 cited ref 없음. selected source를 직접 읽고 sparse abstention 검토.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](offer_status/runs/rumble-right-only/provider-response.txt), [exact structured output](offer_status/runs/rumble-right-only/structured.txt), [frozen source](offer_status/runs/rumble-right-only/source.json), [Evidence mapping](offer_status/runs/rumble-right-only/evidence-map.json), [call audit](offer_status/runs/rumble-right-only/audit.json), [source comparison](offer_status/runs/rumble-right-only/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{
  "facts": [],
  "unresolved": []
}
```

### offer_status — carlyle-expired-final

- SEC 원문: [0001702510-26-000009](https://www.sec.gov/Archives/edgar/data/1702510/000170251026000009/cars_2026130xsctoa.htm)
- 선정 이유 및 호출 전 판정: Reused packet E2 explicitly received final results, offer expired January 21 and shares accepted. E1/E5 payment/NAV context; E3/E4 fees; E6 publication date. No offer withdrawal/termination. Fresh status-only retrieval omitted E2; pre-call SOURCE_COVERAGE selection miss remedied by exact prior SEC Evidence packet reuse, not post-call expansion.
- source: 6 Evidence units / 2919 chars, partialDocuments=0, unavailable=0.
- 원문 대조: E2 explicit final results/expired/accepted shares, E1/E5 payment; correctly no withdrawn/terminated fact and no unnecessary unresolved.
- Evidence support: FACT 미출력으로 cited ref 없음. selected source를 직접 읽고 sparse abstention 검토.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](offer_status/runs/carlyle-expired-final/provider-response.txt), [exact structured output](offer_status/runs/carlyle-expired-final/structured.txt), [frozen source](offer_status/runs/carlyle-expired-final/source.json), [Evidence mapping](offer_status/runs/carlyle-expired-final/evidence-map.json), [call audit](offer_status/runs/carlyle-expired-final/audit.json), [source comparison](offer_status/runs/carlyle-expired-final/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{"facts":[],"unresolved":[]}
```

### offer_status — xerox-terminated

- SEC 원문: [0001193125-20-092896](https://www.sec.gov/Archives/edgar/data/47217/000119312520092896/d909416dsctota.htm)
- 선정 이유 및 호출 전 판정: E1 Offer was terminated March 31, no HP shares purchased and return instructions. E3/E4 offer identity, E2 exhibit list, E5/E7 fees, E6 signature; no need to cite unrelated context.
- source: 7 Evidence units / 4465 chars, partialDocuments=0, unavailable=0.
- 원문 대조: E1 explicitly confirms actual termination of HP tender; no other status inferred.
- Evidence support: E1 — DIRECT: Offer was terminated March31 and shares returned.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](offer_status/runs/xerox-terminated/provider-response.txt), [exact structured output](offer_status/runs/xerox-terminated/structured.txt), [frozen source](offer_status/runs/xerox-terminated/source.json), [Evidence mapping](offer_status/runs/xerox-terminated/evidence-map.json), [call audit](offer_status/runs/xerox-terminated/audit.json), [source comparison](offer_status/runs/xerox-terminated/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{"facts":[{"type":"offer_status","current":"terminated","evidence_refs":["E1"]}],"unresolved":[]}
```

### final_results_observed — carlyle-final

- SEC 원문: [0001702510-26-000009](https://www.sec.gov/Archives/edgar/data/1702510/000170251026000009/cars_2026130xsctoa.htm)
- 선정 이유 및 호출 전 판정: E1 explicitly report final results. E9 received final results, expired, accepted shares. E5/E7 checked final amendment, E8/E10 purchase/payment context corroborate, not sufficient alone. Remaining identity/fees.
- source: 10 Evidence units / 5254 chars, partialDocuments=0, unavailable=0.
- 원문 대조: Actual final results correctly observed despite approximate final share figures; only minimal true observation.
- Evidence support: E1 — DIRECT: this Amendment being filed to report final results of Offer.; E9 — DIRECT: Company received final results of expired Offer and accepted shares.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](final_results_observed/runs/carlyle-final/provider-response.txt), [exact structured output](final_results_observed/runs/carlyle-final/structured.txt), [frozen source](final_results_observed/runs/carlyle-final/source.json), [Evidence mapping](final_results_observed/runs/carlyle-final/evidence-map.json), [call audit](final_results_observed/runs/carlyle-final/audit.json), [source comparison](final_results_observed/runs/carlyle-final/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{
  "facts": [
    {
      "type": "final_results_observed",
      "observed": true,
      "evidence_refs": [
        "E1",
        "E9"
      ]
    }
  ],
  "unresolved": []
}
```

### final_results_observed — bcp-final

- SEC 원문: [0001193125-25-317765](https://www.sec.gov/Archives/edgar/data/1372807/000119312525317765/d87145dsctota.htm)
- 선정 이유 및 호출 전 판정: E4 narrative confirms December12 issued final-results release for expired Offer. E1-E3 list that actual release, E6 defines same offer. E5 preliminary-communications unchecked boilerplate. SEC index confirms actual parent SC TO-T/A, despite mixed issuer/group offer.
- source: 6 Evidence units / 3728 chars, partialDocuments=0, unavailable=0.
- 원문 대조: Narrative issued final-results release confirms actual announcement. Numerical exhibit not needed for observation. No inference solely from exhibit title.
- Evidence support: E4 — DIRECT: Company issued press release announcing final results December12 for Offer expired December10.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](final_results_observed/runs/bcp-final/provider-response.txt), [exact structured output](final_results_observed/runs/bcp-final/structured.txt), [frozen source](final_results_observed/runs/bcp-final/source.json), [Evidence mapping](final_results_observed/runs/bcp-final/evidence-map.json), [call audit](final_results_observed/runs/bcp-final/audit.json), [source comparison](final_results_observed/runs/bcp-final/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{
  "facts": [
    {
      "type": "final_results_observed",
      "observed": true,
      "evidence_refs": [
        "E4"
      ]
    }
  ],
  "unresolved": []
}
```

### final_results_observed — dxl-interim

- SEC 원문: [0001193125-26-298540](https://www.sec.gov/Archives/edgar/data/813298/000119312526298540/sch14d9_amendment_3_july.htm)
- 선정 이유 및 호출 전 판정: All14 refs reviewed. E12/E13 June22 as-of approximate tender count followed by extension to July24 and board evaluation. E1 outstanding shares, E2 offer identity, E3-E5/E10 hypothetical executive compensation, E6/E8 conditions, E7 unchecked preliminary-communications boilerplate, E9 competing merger recommendation, E11/E14 board recommendation. No actual final offer results.
- source: 14 Evidence units / 19748 chars, partialDocuments=0, unavailable=0.
- 원문 대조: E12/E13 as-of tender count with extension is interim, not final. Correct sparse abstention; no false and no unnecessary unresolved. Other financial/compensation estimates not promoted to results.
- Evidence support: FACT 미출력으로 cited ref 없음. selected source를 직접 읽고 sparse abstention 검토.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](final_results_observed/runs/dxl-interim/provider-response.txt), [exact structured output](final_results_observed/runs/dxl-interim/structured.txt), [frozen source](final_results_observed/runs/dxl-interim/source.json), [Evidence mapping](final_results_observed/runs/dxl-interim/evidence-map.json), [call audit](final_results_observed/runs/dxl-interim/audit.json), [source comparison](final_results_observed/runs/dxl-interim/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{
  "facts": [],
  "unresolved": []
}
```

### final_results_observed — rumble-active

- SEC 원문: [0001213900-25-000757](https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm)
- 선정 이유 및 호출 전 판정: All8 refs reviewed. E1-E4 prospective proration and future preliminary/final announcements/payment, E5 operating risks, E6 historical financial interim results (different object), E7 tax consequences, E8 conditions and future determinations. No actual final offer results.
- source: 8 Evidence units / 16484 chars, partialDocuments=0, unavailable=0.
- 원문 대조: E1-E4 future preliminary/final announcements and payment mechanics, no actual announcement. E6 interim financial results unrelated. Correct sparse abstention, no observed false.
- Evidence support: FACT 미출력으로 cited ref 없음. selected source를 직접 읽고 sparse abstention 검토.
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](final_results_observed/runs/rumble-active/provider-response.txt), [exact structured output](final_results_observed/runs/rumble-active/structured.txt), [frozen source](final_results_observed/runs/rumble-active/source.json), [Evidence mapping](final_results_observed/runs/rumble-active/evidence-map.json), [call audit](final_results_observed/runs/rumble-active/audit.json), [source comparison](final_results_observed/runs/rumble-active/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

```json
{
  "facts": [],
  "unresolved": []
}
```

## 실패 분류 및 정확도 해석

| 분류 | 이번 결과 |
|---|---|
| SOURCE_COVERAGE | status Carlyle 신규 selection에서 required expiry 문장 누락 1건. 호출 전 기존 검증 source packet 재사용으로 해결. 일반 status 질의의 범용 recall PASS를 주장하지 않음. |
| MODEL_ERROR | 0/9 |
| SCHEMA_ERROR | 0/9 |
| SOURCE_UNRESOLVED | 0/9; 의도적인 불완전·충돌 source live case는 이번 배치에 없음 |
| PROVIDER_MODEL_UNAVAILABLE | 0/9 |
| PREFLIGHT_TEST_ERROR | 최종 실험 preflight/format/single-call 검증 실패 0 |

양성 5건의 emitted claim은 모두 직접 근거 ref를 최소 하나 갖는다. 실제 출력에는 직접 refs만 포함되었으며 무관/모순/미검토/foreign/fabricated ref는 0개다. 음성 4건은 모두 정상적인 sparse abstention이고 observed:false나 불필요한 unresolved를 생성하지 않았다. 9/9는 선택한 소규모 대표 세트의 정확도이며, 모집단 성능 추정이나 production 안정성 보증이 아니다.

남은 limitation: offer_status의 withdrawn/terminated 동의어 중첩 계약, partial/unavailable/conflict source의 신규 FACT별 live 검증, 별도 실제 preliminary-results 발표문(이번에는 실제 interim count를 사용), 다른 표현/문서군의 일반화, 사람의 독립 검수가 남는다. 출처가 여러 competing offers를 명확히 구분하지 못하면 추후에도 추측하지 않고 unresolved로 남겨야 한다.

## 전체 Tender FACT 상태와 종료

| FACT | 상태 | 범위/제한 |
|---|---|---|
| expiration | 기존 Practical PASS 유지 | 이번 재호출/변경 없음 |
| offer_price | 기존 Practical PASS 유지 | fixed all-cash per-share + source literal currency notation |
| board_recommendation | 기존 Practical PASS 유지 | current-state5, Beacon·Jos. A. Bank reject→accept 확인. Cream no_recommendation→accept는 parent6-K 지원 밖 SOURCE_COVERAGE/미검증 유지 |
| offer_status | Practical PASS, 5/5 | actual withdrawn/terminated, 권리·만료·완료 제외; Codex source review |
| final_results_observed | Practical PASS, 4/4 | true-only sparse observation; Codex source review |

현재 대표 사례 기준 **5/5 Practical PASS**, PASS 아닌 FACT 없음. 최소 schema 둘 다 유지하며 Structured Monitor 후보로 계속 검증할 가치가 있다. 사용자 승인을 받으면 **5 FACT union extraction 실험을 시작할 준비는 됨**. 이는 union 정확도나 product readiness의 PASS가 아니다. **union 호출/통합 schema/DB/persistence/Reader/Matcher/Monitor/Alert/UI/job/cron 구현은 실행하지 않고 여기서 STOP**.

## 재현 가능한 로컬 검증 및 작업 상태

작업 경로: C:\Users\PC\.codex\worktrees\87db\US-Stock Radar. 시작 base와 호출 freeze HEAD: c36f5cbf54f8d5d70d2781717c1aeb8c2eaa2a68, detached HEAD. 변경은 scripts/tender-terminal-facts/ 아래 신규 실험 artifacts뿐이다. 최종 commit SHA와 clean 상태는 완료 메시지에서 제공한다.

검증 명령 (provider 호출 없음):

```powershell
node --no-warnings --experimental-strip-types scripts/tender-terminal-facts/audit-results.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-terminal-facts/contracts.test.mjs scripts/tender-terminal-facts/final_results_observed/contract.test.mjs scripts/tender-fact-batches/runner.test.mjs
npm run typecheck
git diff --check
```

7 tests PASS (형식, true-only, no coercion, source-only, exact mapping, foreign/hash rejection, 1 call/no retry success/transport/HTTP/bad-ref), TypeScript PASS. 최종 offline 감사는 frozen 요청·map·보호 파일 hash, 원본 응답과 structured byte 일치, started request hash, modelVersion, physical call 수, 모든 emitted ref의 명시적 검토 기록을 검사한다. [verification.json](verification.json)에 결과와 파일 크기/비밀값 패턴 스캔을 기록한다. 실제 API key 값도 메모리에서만 읽어 artifact 전체와 대조하며 출력·저장하지 않는다.

기존 scripts/tender-expiration, tender-fact-batches, tender-board-transition-supplement, tender-board-josabank-supplement 및 Tender Evidence product code 변경 없음. 서버/3110/계정/화면 변경이 없어 PC·mobile UI 검증은 해당 없음. DB/migration/env/cron/외부 발송 변경 없음. 기존 .env.local은 key를 읽는 용도로만 사용하고 저장/수정하지 않았다.

운영 상태: 이 candidate에서 읽은 local main ref는 af265b5bf3bb8878d706e1f4d763c0ce85a1b024. GitHub main 및 Vercel 배포 commit/상태는 이번 실험에서 미검증이며 코드 일치를 주장하지 않는다. main merge/push/deploy 승인 및 실행 없음. 후속 새 작업방 인계는 하지 않았다.
