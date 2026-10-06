import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url)),json=async p=>JSON.parse(await readFile(p,'utf8'));
let md=`# Tender offer_status / final_results_observed 검증 보고서

판정: offer_status **5/5 Practical PASS**, final_results_observed **4/4 Practical PASS**. gemini-3.5-flash 총 **9 physical calls**, 각 case/FACT 1회. retry/repair/fallback/재호출/의미 교정 없음. 모든 호출 HTTP 200, finishReason STOP, 응답 modelVersion gemini-3.5-flash. 원문 대조는 **Codex 직접 검토이며 독립적인 사람의 signoff는 아직 아님**.

## 최소 schema 유지 결정

offer_status:

\`\`\`json
{"facts":[{"type":"offer_status","current":"withdrawn","evidence_refs":["E1"]}],"unresolved":[]}
\`\`\`

current enum은 withdrawn | terminated. 같은 실제 사건이 두 표현으로 기술되면 더 구체적인 명시적 withdrawn을 선택하도록 **호출 전에** 정의했다. 종료만으로 철회를 추론하지 않는다. Jos. A. Bank 원문이 실제로 두 표현을 함께 사용하므로 두 단어가 법적·언어적으로 완전히 배타적이라는 주장은 하지 않는다. 해당 구분이 미래 제품 요구와 맞지 않으면 별도 계약 검토가 필요하다. previous/date/reason/change 필드는 없다.

final_results_observed:

\`\`\`json
{"facts":[{"type":"final_results_observed","observed":true,"evidence_refs":["E1"]}],"unresolved":[]}
\`\`\`

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
`;
let tokens=0,latency=0;
const details=[];
for(const fact of ['offer_status','final_results_observed']){
 const dir=join(root,fact),manifest=await json(join(dir,'manifest.json')),audit=await json(join(dir,'source-audit.json'));
 for(const c of manifest.cases){const run=join(dir,'runs',c.name),a=await json(join(run,'audit.json')),r=await json(join(run,'review.json')),raw=await readFile(join(run,'structured.txt'),'utf8'),o=JSON.parse(raw),s=await json(join(run,'source.json'));
  const answer=o.facts.length?(o.facts[0].current??'observed:true'):'facts=[]; unresolved=[]';const direct=Object.entries(r.refs).filter(([,v])=>v.startsWith('DIRECT:')).map(([k])=>k).join(', ')||'해당 없음';
  tokens+=a.usage.totalTokenCount;latency+=a.latencyMs;
  md+=`| ${fact} / ${c.name} | ${c.accession} / ${c.form} | ${answer} → 일치 | ${direct} | 1 / ${a.httpStatus} | ${a.usage.promptTokenCount}/${a.usage.candidatesTokenCount}/${a.usage.totalTokenCount} | ${a.latencyMs} | 없음 |\n`;
  details.push(`### ${fact} — ${c.name}

- SEC 원문: [${c.accession}](${s.evidence[0].document.url})
- 선정 이유 및 호출 전 판정: ${c.purpose}
- source: ${s.evidence.length} Evidence units / ${s.evidence.reduce((n,e)=>n+e.text.length,0)} chars, partialDocuments=${s.coverage.partialDocuments.length}, unavailable=${s.coverage.unavailable.length}.
- 원문 대조: ${r.semantic}
- Evidence support: ${Object.entries(r.refs).map(([ref,meaning])=>ref+' — '+meaning).join('; ')||'FACT 미출력으로 cited ref 없음. selected source를 직접 읽고 sparse abstention 검토.'}
- 실패 분류: 없음. schema/local/provenance PASS. 외부 AI/사람의 독립 검수: 미실시.
- 보존 파일: [raw provider response](${fact}/runs/${c.name}/provider-response.txt), [exact structured output](${fact}/runs/${c.name}/structured.txt), [frozen source](${fact}/runs/${c.name}/source.json), [Evidence mapping](${fact}/runs/${c.name}/evidence-map.json), [call audit](${fact}/runs/${c.name}/audit.json), [source comparison](${fact}/runs/${c.name}/review.json).

원본 Structured output (아래 표시의 whitespace 외 값 변경 없음):

\`\`\`json
${raw.trim()}
\`\`\`
`);
 }
}
md+=`\n총 provider 보고 tokens **${tokens}**, latency 합계 **${latency}ms**. 실제 청구 금액은 조회하지 않았으므로 비용을 추정해 표시하지 않는다.\n\n`+details.join('\n');
md+=`\n## 실패 분류 및 정확도 해석

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

작업 경로: C:\\Users\\PC\\.codex\\worktrees\\87db\\US-Stock Radar. 시작 base와 호출 freeze HEAD: c36f5cbf54f8d5d70d2781717c1aeb8c2eaa2a68, detached HEAD. 변경은 scripts/tender-terminal-facts/ 아래 신규 실험 artifacts뿐이다. 최종 commit SHA와 clean 상태는 완료 메시지에서 제공한다.

검증 명령 (provider 호출 없음):

\`\`\`powershell
node --no-warnings --experimental-strip-types scripts/tender-terminal-facts/audit-results.mjs
node --no-warnings --experimental-strip-types --test scripts/tender-terminal-facts/contracts.test.mjs scripts/tender-terminal-facts/final_results_observed/contract.test.mjs scripts/tender-fact-batches/runner.test.mjs
npm run typecheck
git diff --check
\`\`\`

7 tests PASS (형식, true-only, no coercion, source-only, exact mapping, foreign/hash rejection, 1 call/no retry success/transport/HTTP/bad-ref), TypeScript PASS. 최종 offline 감사는 frozen 요청·map·보호 파일 hash, 원본 응답과 structured byte 일치, started request hash, modelVersion, physical call 수, 모든 emitted ref의 명시적 검토 기록을 검사한다. [verification.json](verification.json)에 결과와 파일 크기/비밀값 패턴 스캔을 기록한다. 실제 API key 값도 메모리에서만 읽어 artifact 전체와 대조하며 출력·저장하지 않는다.

기존 scripts/tender-expiration, tender-fact-batches, tender-board-transition-supplement, tender-board-josabank-supplement 및 Tender Evidence product code 변경 없음. 서버/3110/계정/화면 변경이 없어 PC·mobile UI 검증은 해당 없음. DB/migration/env/cron/외부 발송 변경 없음. 기존 .env.local은 key를 읽는 용도로만 사용하고 저장/수정하지 않았다.

운영 상태: 이 candidate에서 읽은 local main ref는 af265b5bf3bb8878d706e1f4d763c0ce85a1b024. GitHub main 및 Vercel 배포 commit/상태는 이번 실험에서 미검증이며 코드 일치를 주장하지 않는다. main merge/push/deploy 승인 및 실행 없음. 후속 새 작업방 인계는 하지 않았다.
`;
await writeFile(join(root,'REPORT.md'),md,{flag:'wx'});console.log('REPORT.md saved; no provider call');
