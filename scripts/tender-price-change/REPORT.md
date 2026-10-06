# Tender offer price change — 로컬 candidate 검증

2026-10-07 KST. Worktree `C:\Users\PC\.codex\worktrees\87db\US-Stock Radar`. 시작 HEAD `47fd6b0ee8562e7208aa97c44a8abc737607e9ea`, detached/clean 확인 후 진행. **요청 범위 PASS**. 실제 DXL 제품 E2E와 replay 검증 완료. NL 의미 해석은 명시적으로 허용된 stub 검증이며 live AI 정확도를 주장하지 않는다.

## 1. 변경한 제품 파일

- `lib/monitor/tenderStructuredFacts.ts`: 기존 canonical offer_price의 current/previous를 비교해 Monitor 전용 `offer_price_change: "changed" | null` 도출.
- `lib/monitor/conditionRegistry.ts`: text one-state enum `tender.offer_price_change eq changed` 등록.
- `scripts/tender-price-change/`: offline tests, 실제 SEC source, isolated E2E harness/증거/보고서. 기존 실험·Carlyle artifacts 변경 없음.
- DB migration, matcher, Alert consumer, NL compiler 코드, UI 페이지는 추가/수정하지 않았다. 기존 Registry 경로로 연결된다.

## 2. LLM prompt/schema 변경 여부

**변경 없음.** 기존 4-slot contract.ts, analyzer.ts, source.ts는 base와 동일(Windows 줄바꿈 차이는 테스트에서 제외). price change/changed/increased/decreased 출력 필드를 추가하지 않았다. source queries/selection, persistence, provider stage, Workflow도 그대로다. 실제 전송 [request](artifacts/request.json).

## 3. offer_price_change derivation 코드

```ts
  const price = read.canonical.facts.find((fact) => fact.type === "offer_price");
  const current = price?.current;
  const previous = price?.previous;
  // Compare only explicit canonical prices; abstention is never an unchanged fact.
  const priceChanged = current && previous
    && typeof current.amount === "number" && Number.isFinite(current.amount)
    && typeof previous.amount === "number" && Number.isFinite(previous.amount)
    && typeof current.currency_text === "string" && current.currency_text.length > 0
    && current.currency_text === previous.currency_text
    && current.unit === "cash_per_share" && previous.unit === "cash_per_share"
    && current.amount !== previous.amount;
```

Monitor projection은 `offer_price_change: priceChanged ? "changed" : null`이다. readTenderStructured가 검증한 기존 canonical을 사용하며 current/previous 숫자, unit, provenance를 수정하지 않는다.

## 4. 왜 false가 없는지

가격 부재·previous 부재·동일 금액·서로 다른 통화 표기·잘못된 unit은 모두 null이다. null은 변경을 positive하게 확인하지 못했다는 뜻이며 unchanged 사실을 생성하지 않는다. 외부 source 부족은 기존 Reader가 not_ready로 차단한다. `$`/`USD`/`US$`를 정규화하거나 환산하지 않는다.

## 5. Monitor Registry condition

```json
{
  "key": "tender.offer_price_change",
  "operator": "eq",
  "value": "changed"
}
```

valueType=text, enumValues=[changed], allowedOperators=[eq]. 표시 이름 “Tender offer price changed”. 기존 UI editor catalog에는 Changed 선택지 한 개만 있고 boolean true/false 선택지가 없다. unchanged/false/true/increased/decreased 및 다른 operator는 validation 실패. [NL/editor 결과](artifacts/nl-stub.json).

## 6. NL 문구 compile 결과

| 문구 | stub 응답의 실제 compiler/validator/draft 처리 |
|---|---|
| Tender 제안 가격이 바뀌면 알려줘 | VALID → eq changed → READY_FOR_REVIEW |
| 공개매수 가격이 변경되면 알려줘 | VALID → eq changed → READY_FOR_REVIEW |
| Notify me when a tender offer price changes. | VALID → eq changed → READY_FOR_REVIEW |

현재 AI compiler는 READY Registry metadata를 prompt에 자동 포함한다. 회사명/문구 hardcoding 없이 새 조건이 전달됨을 확인했다. provider를 stub으로 대체하고 나머지 compiler, deterministic validation, draft와 UI editor catalog를 실제 실행했다. **NL live Gemini 호출 0회**. 실제 자연어 모델의 문구별 해석 정확도와 로그인 UI 클릭 흐름은 이번 검증 범위에서 미검증이다.

## 7. Offline test 결과

요청한 15개 항목을 grouped tests로 검증: 0.82→0.84 changed, 같은 금액 null, previous/offer_price/current 부재 null, $/USD·$/US$·$/CAD 불일치 null, 같은 US$ 비교 가능, composite null 유지, NaN/Infinity/string/invalid shape 거부, 양쪽 cash_per_share 필수, expiration 조건 부재, provider contract 불변, changed MATCH/null INELIGIBLE, unchanged/false 등 거부, Registry/UI/compiler one-state enum. 하락도 동일 changed이며 방향 필드를 만들지 않는다. 기존 Reader corruption/partial-source 회귀 포함. [사전 테스트](artifacts/tests.txt), [최종 UI editor 테스트](artifacts/final-editor-tests.txt).

## 8. DXL actual Evidence 수/chars

공시 0001193125-26-298540 / SC 14D9/A. repo에는 frozen evidence slices가 있어 이를 완전한 문서로 재포장하지 않았다. 해당 SEC primary HTML을 HTTP 200으로 받아 기존 sourceHash와 정확히 일치함을 확인했다. 원문 188,993 chars, SHA-256 `1445dda411b3ee7a467048fdc362a9f3759235a347f3e2bf2a9409c4817d536c`. 실제 SEC index의 filing date 2026-07-08 사용(accepted 원문 16:11:42 보존). 별도 CIK/ticker를 만들어 넣지 않았다.

prepareTenderEvidence → 제품 source/index/search/read → 15 units / 17147 evidence chars / 17974 provider-source JSON chars. 기존 query·schema 그대로이고 의미별 입력 분리 없음. primary 문서만 공급했으며 외부 referenced document는 not-resolved 메타데이터를 유지한다. [source acquisition](artifacts/source-acquisition.json), [source](artifacts/source.json), [map](artifacts/evidence-map.json).

원문 직접 검수(Codex; 독립 사람 승인 아님): E5/E6는 $0.84 per share in cash, E10/E15는 같은 Offer의 $0.82→$0.84를 명시한다. E7/E10은 reject 권고. E3의 $1.25는 다른 1월 acquisition proposal, E8은 merger recommendation 철회, E10의 June22 수량은 interim/as-of이다. 모델은 이들을 prior price/status/final 결과로 혼동하지 않았다. current refs는 다소 많지만 모두 $0.84를 명시하고, cash scope는 E5/E6로 직접 확인된다. previous refs E10/E15와 board refs E4/E7/E10 연결 PASS. 새 price-change AI evidence는 생성하지 않았다.

## 9. Gemini physical call count

**DXL 1회, 추가 0회.** 이 작업에서 Carlyle와 NL compiler는 provider 재호출 없음. 허용 목적과 종료조건은 [PLAN](PLAN.md), [preflight](artifacts/preflight.json), [permit](artifacts/permit.json)에 호출 전 기록했다.

## 10. Model / tokens / latency

gemini-3.5-flash / HTTP 200 / STOP. Input 4722, output 255, total 4977 tokens. Transport latency 2442 ms. [transport](artifacts/transport.json), [response](artifacts/provider-response.json).

## 11. Raw DXL 4-slot output

```json
{
  "offer_price": {
    "current": {
      "amount": 0.84,
      "currency_text": "$"
    },
    "previous": {
      "amount": 0.82,
      "currency_text": "$"
    },
    "current_evidence_refs": [
      "E1",
      "E2",
      "E3",
      "E4",
      "E5",
      "E6",
      "E10",
      "E13",
      "E15"
    ],
    "previous_evidence_refs": [
      "E10",
      "E15"
    ]
  },
  "board_recommendation": {
    "current": "reject",
    "previous": null,
    "current_evidence_refs": [
      "E4",
      "E7",
      "E10"
    ],
    "previous_evidence_refs": []
  },
  "offer_status": null,
  "final_results_observed": null
}
```

응답을 교정하지 않았다. 이전 실험 모델 출력을 제품 canonical로 주입하지 않았다.

## 12. Canonical offer_price

```json
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
    "E3",
    "E4",
    "E5",
    "E6",
    "E10",
    "E13",
    "E15"
  ]
}
```

unit=cash_per_share는 기존 서버 projection. price refs와 board refs는 기존 형식 그대로 보존. canonical에는 price와 board 두 FACT만 존재. [전체 canonical](artifacts/canonical.json).

## 13. Derived price-change value

`offer_price_change = "changed"`. 이 값은 Monitor Reader의 transient projection이며 저장된 4-FACT canonical에 새 FACT를 추가하지 않는다. [facts](artifacts/facts.json).

## 14. Reader 결과

공식 readTenderStructured(rawItemId) **available**. current source binding, 모델/contract, stage checkpoint, output/canonical hash, evidence refs 재검증 통과. execution `e42919b5-6837-5992-a9b7-dc89272c1a20`. [Reader](artifacts/reader.json).

## 15. Matcher 결과

**MATCH / all_conditions_match**. 실제 readCurrentTenderFacts를 사용. missing change는 기존 Tender null 처리로 INELIGIBLE/fact_unavailable이다. [matcher](artifacts/matcher.json).

## 16. Alert row

`acce76e5-b7a4-4d7d-b097-7a7cf5fe546e`, synthetic monitor `4bc79b0e-405d-4755-baee-c2648325e28c`, event `437c38a2-2bbf-40dc-89ad-2ca21eec1da3`. monitor created_at 2026-01-01로 filing 이전. 기존 Generic Tender Monitor storage와 source execution lineage 사용. delivered_channels=[], sent_at=null. 외부 전송 0회. [Alert](artifacts/alerts.json).

## 17. Carlyle regression

저장된 제품 결과를 공식 Reader와 실제 consumer로 다시 읽었다. price_change=null → 새 가격 Monitor INELIGIBLE, 가격 Alert 0개. final_results_observed=true → 기존 Monitor MATCH, 기존 Alert를 existing으로 읽음(추가 생성 0). provider 재호출 없음. [회귀 결과](artifacts/carlyle-regression.json).

## 18. Duplicate / replay 결과

실제 raw ingest sidecar → 생성 manifest 기반 local Workflow 실행 후 duplicate enqueue=duplicate. repeated runtime succeeded(추가 provider 호출 시 throw하는 stub), 동일 execution의 실제 Workflow replay completed. Reader canonical/hash와 changed 값 동일. 원본 모델 response는 durable checkpoint와 일치한다. 두 번째 동일 요청 guard는 EEXIST로 native fetch 전에 거부, nativeCalls=0. [Workflow](artifacts/workflow.json), [replay](artifacts/replay.json), [replay Workflow](artifacts/replay-workflow.json), [audit](artifacts/completion-audit.json).

Canonical SHA-256: `b40176aa2b9695d950abd52c50aef30c0efcfe853d79fc38c4d50a6032df7675`. Request SHA-256: `0d2de6edc749491b0935492d6fd3e555d723f0e96b46ae389a244e07b072868f`.

## 19. ai_outputs count

DXL 실행의 ai_run **1개**, ai_output **1개**. [ai_run](artifacts/ai-run.json), [ai_outputs](artifacts/ai-outputs.json).

## 20. Alert count

DXL monitor/event Alert **1개**, replay duplicate **0개**, 다른 user의 해당 event Alert **0개**. Carlyle 가격 변경 Alert **0개**. 기존 raw 55, event 28, auth.users 9, user_profiles 11, monitor 8, ai_run 71, ai_output 69, Alert 3개의 전체-row digest가 전후 동일(이번 synthetic rows 제외). [before](artifacts/before.json), [after](artifacts/after.json).

## 21. 전체 tests/typecheck

호출 전 관련 회귀 **174 PASS / 0 fail**. 최종 editor+price tests **20 PASS / 0 fail**(8개 price tests 재포함; 합계를 고유 테스트 수로 주장하지 않음). `npx tsc --noEmit --incremental false` exit 0. `npm run verify:workflows` 7 files, no serde issues. 실제 local 3117 manifest/flow/step route 확인. 추가 migration 불필요: 기존 함수/unique indexes read-only 검증. 최종 git diff --check PASS, secret-pattern scan 0건. [completion audit](artifacts/completion-audit.json).

## 22. 최종 PASS / FAIL

**PASS — 요청한 가격 변경 positive-only 기능과 실제 DXL E2E/replay.** NL compile는 사용자 허용대로 stub contract 검증 PASS이며 live NL 정확도 검증이 아니다. source-only raw/event/user/monitor는 local synthetic harness로 구성했고 product Evidence/analyzer/persistence/Reader/matcher/Alert/Workflow는 실제 제품 경로를 실행했다. 원격 DB/실제 Primary 분석/외부 알림은 실행하지 않았다.

## 23. Failure class

미해결 실패 및 이번 E2E 실패 없음. SOURCE_COVERAGE/MODEL_ERROR/SCHEMA_ERROR/PERSISTENCE_ERROR/READER_ERROR/MATCHER_ERROR/NL_COMPILER_ERROR/ALERT_ERROR/WORKFLOW_ERROR/TEST_HARNESS_ERROR 해당 없음. 모델 호출은 성공/복구 여부와 관계없이 1회 제한을 유지한다.

## 24. Local commit hash

이 보고서를 포함하는 로컬 candidate commit의 SHA는 완료 응답에 기록한다(`git log -1 --format=%H`). base는 47fd6b0ee8562e7208aa97c44a8abc737607e9ea. commit 자신의 hash를 넣기 위한 추가 commit은 만들지 않는다.

## 25. Detached HEAD / clean 여부

지정된 detached HEAD에서 candidate commit으로 완료하고 최종 clean 상태는 완료 응답에서 확인한다. 검증용 3117을 종료하고 생성된 next-env.d.ts를 base로 복원한다. main/3110 조작, merge/push/deploy, 새 worktree/agent/thread 없음. 로컬 candidate commit 후 STOP.
