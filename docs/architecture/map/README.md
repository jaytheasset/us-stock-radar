# No inference — 추측을 현재 구조로 기록하지 않는다

확인되지 않은 노드와 연결은 `UNKNOWN / TO AUDIT`로 남긴다. 파일명, 테이블의 존재, 과거 문서나 이전 PASS 보고만으로 실제 호출·저장·소비·production 연결을 확정하지 않는다.

## 목적과 현재 범위

Architecture Map은 합의한 서비스 모델과 앞으로 확인할 실제 구현을 구분해 기록하는 문서 기반이다. 기존 architecture, handoff, diagnostics 문서를 이동하거나 대체하지 않는다.

현재 **Service Model, SEC Primary As-Is, News Primary As-Is, Primary Overview 작성을 완료하여 Primary 영역의 1차 문서화가 끝났다.** 각 문서의 SERVICE MODEL / VERIFIED / UNKNOWN 구분과 검증 범위는 그대로 적용한다. 다음 큰 조사 영역은 Structured Data Pipeline이며, 전체 Architecture Map이 완성된 상태는 아니다.

## 작성 원칙

- 노드뿐 아니라 연결마다 근거가 필요하다. 같은 이름이나 가까운 파일 위치는 연결 근거가 아니다.
- 코드의 존재와 실제 실행 경로 연결, 실행 가능성과 운영 활성화를 구분한다.
- DB table의 존재와 저장 실행, reader의 존재와 consumer 사용을 구분한다.
- 과거 문서는 조사 출발점이다. 현재 코드·DB·실행과 충돌하면 다시 확인하며, 어느 쪽도 자동으로 정답 처리하지 않는다.
- 모르는 코드, storage, consumer, 배포 상태는 `UNKNOWN`으로 적는다. 조회 실패나 제한된 조회 범위는 부재의 증거가 아니다.
- SERVICE MODEL, VERIFIED AS-IS, UNKNOWN, PROPOSED는 별도 제목과 상태 표기로 분리한다. 색상만으로 구분하지 않는다.
- SERVICE MODEL 개념도를 실제 runtime 지도처럼 사용하지 않는다. 향후 VERIFIED 도식에는 확인된 연결만 넣고, 미확인 연결은 별도 조사 목록에 남긴다.
- 기존 코드의 `canonical` 명칭을 상위 서비스 축과 동일시하지 않는다. 상위 축은 **Structured Data Pipeline**으로 부른다.
- 이 초기 문서 기반 확정 이후, 서비스 모델이나 용어 정리를 이유로 구현 완료 범위를 바꾸지 않는다. 실제 구현 변경 시에만 관련 architecture의 구조 설명을 갱신한다. 조사로 근거를 확보하거나 문서와 실제 상태의 충돌을 확인한 경우에는 그 확인 범위·상태·근거를 구분해 기록하며, 구현 변경이 일어났다고 표현하지 않는다.

## 상태 표시와 검증 근거

| 표시 | 기록하는 내용 |
| --- | --- |
| `SERVICE MODEL` | 합의한 상위 서비스 개념. 현재 구현 검증 결과가 아님 |
| `VERIFIED AS-IS` | 특정 시점과 범위에서 직접 확인한 구현 사실. 가능한 근거를 아래 형식으로 기록 |
| `UNKNOWN / TO AUDIT` | 확인하지 못한 항목, 부족한 근거, 다음 확인 대상 |
| `PROPOSED` | 향후 변경 제안. 현재 구현과 분리하며 승인·구현 완료를 뜻하지 않음 |

향후 VERIFIED 항목에는 가능한 범위에서 다음을 기록한다. 빈칸을 추정값으로 채우지 않는다.

| 근거 항목 | 기록 기준 |
| --- | --- |
| 대상과 주장 | 어떤 노드 또는 연결의 무엇을 확인했는지 |
| 코드 | 경로·함수·호출 위치 등 직접 확인한 근거 |
| Storage | 실제 저장 계약·row/실행 근거. 미확인은 `UNKNOWN` |
| Consumer | 실제 읽거나 사용하는 호출자·API/UI. 미확인은 `UNKNOWN` |
| Verification level | `CODE`, `DB`, `EXECUTION`, `BROWSER E2E` 중 실제 확인한 범위와 증거 위치 |
| Verified commit | 확인한 코드의 commit. 확인하지 못하면 `UNKNOWN` |
| 환경·시점·제한 | local/candidate/shared-local/production 구분, 확인 날짜, 실제·합성 사례 및 미검증 경계 |

검증 수준은 자동 승격되는 점수나 단계가 아니다. 코드에서 호출을 확인해도 `CODE` 수준의 사실만 기록한다. local E2E로 production 활성화를 주장하지 않는다. 재검증 전에는 예전 commit의 근거를 최신 commit 검증으로 옮겨 적지 않는다.

## 문서 인덱스

현재 존재하는 문서:

- [SEC / Kiwoom ticker verification](../TICKER_VERIFICATION.md) / [운영 runbook](../../operations/TICKER_VERIFICATION_RUNBOOK.md) — 현재 A/B/C·append-only·current reader 구조와 완료된 로컬/격리 검증. 과거 단계 기록 보존, ticker authority 없음, push/deploy 미실행.

- [00 Service Model](00-service-model.md) — `SERVICE MODEL`: 네 서비스 축과 용어집, 개념도 1개.
- [01 Primary Analysis — SEC](01-primary-analysis.md) — 기존 3단계-A 기록 + 2026-10-05 Proxy local main 업데이트. Proxy shared discovery source의 Primary/Structured 분기와 internal Monitor Alert 연결을 기존 Mermaid 한 곳에서 관리; 다른 family 및 production 미검증 범위는 유지.
- [01b Primary Analysis — News](01b-news-primary.md) — `VERIFIED AS-IS`: 3단계-B의 VERIFIED CODE. 뉴스 저장 표본·production 활성화·E2E는 UNKNOWN.
- [01c Primary Analysis — Overview](01c-primary-overview.md) — SEC·News 상위 지도: 별도 처리 경로와 확인된 공유 계층, 검증 범위 구분.
- [02 Structured Data — Domain Inventory](02-structured-data-overview.md) — 기존 도메인 inventory + Proxy Call2 canonical/durable reader/typed Monitor의 local 저장·E2E 범위. 전체 production 완료를 뜻하지 않음.
- [03 Ownership — Form 4/144](03-ownership-form4-144.md) — `VERIFIED AS-IS`: CODE/WIRED + DB 구조 확인. 실제 저장 표본·제품 경로·E2E는 UNKNOWN.
- [03b Ownership — Form 3/5](03b-ownership-form3-5.md) — `VERIFIED AS-IS`: CODE/WIRED + DB STRUCTURE VERIFIED. accession 이력·lineage와 수동 Matcher; 실제 저장·제품 E2E는 UNKNOWN.
- [03c Ownership — SC13](03c-ownership-sc13.md) — `VERIFIED AS-IS`: CODE/WIRED + DB STRUCTURE VERIFIED. 신고인별 저장·current projection·종목 상세·내부 Monitor Alert; 실제 저장·제품 E2E는 UNKNOWN.
- [03d Ownership — Overview](03d-ownership-overview.md) — 세 family의 독립 저장·reader·consumer 상위 지도. 개념적 공통점과 CODE/WIRED·NOT WIRED·UNKNOWN 구분.
- [Proxy Structured product v1](../proxy-structured-product-v1.md) — local main merge `53e1f790…` 완료, migration 정합·internal Alert/dedupe·브라우저 검증. push/deploy·외부 발송은 별도이며 중복 Mermaid를 만들지 않음.
- [EFFECT registration Monitor](../effect-registration-monitor-v1.md) — `def88790` local main 통합, migration `20261005183052` 적용·main smoke 완료. 등록 대상 명시적 선택/원본 XML 검증/등록별 internal Alert dedupe. 배포·cron·외부 발송 완료 아님.
- [S-4/F-4 MCP handoff](../../../lib/sources/sec/forms/s4-f4/MCP_EVIDENCE_HANDOFF.md) — `3e15836c` main 통합 및 `def88790` 합본 보존. 독립 source-only MCP, 기존 Primary 유지, 정확한 제출 form Monitor; merger semantic FACT 없음. 위 두 경로의 최신 연결은 01/02의 2026-10-06 절에 명시한다.

향후 조사 placeholder는 **목록만** 예약한다. 아래 파일은 아직 생성하지 않았으며 내용과 실제 연결은 모두 `UNKNOWN / TO AUDIT`이다. 번호는 인덱스 순서이며 구현·의존 순서가 아니다.

| 예정 파일명 | 조사 영역 | 상태 |
| --- | --- | --- |
| `02-structured-data.md` | Structured Data Pipeline | UNKNOWN / TO AUDIT |
| `03-ownership.md` | Ownership | UNKNOWN / TO AUDIT |
| `04-financials.md` | Financials | UNKNOWN / TO AUDIT |
| `05-dilution.md` | Dilution | UNKNOWN / TO AUDIT |
| `06-listing-identity.md` | Listing / Delisting / Identity | UNKNOWN / TO AUDIT |
| `07-monitor-alert.md` | Monitor / Matcher / Monitor Alert | UNKNOWN / TO AUDIT |
| `08-external-sources.md` | External sources | UNKNOWN / TO AUDIT |

Corporate Actions는 합의된 Domain Data 예시에 포함한다. 별도 조사 문서 분할과 다른 도메인 추가 여부는 아직 `UNKNOWN / TO AUDIT`이며 여기서 확정하지 않는다. External sources 조사 항목은 특정 공급원 사용을 확정하지 않는다.

## 기존 참고 문서

아래는 조사 출발점이며 이 Map의 VERIFIED 근거로 자동 승격하지 않는다.

- [Diagnostics index](../../DIAGNOSTICS_INDEX.md), [SEC diagnostics](../../SEC_DIAGNOSTICS.md): 기존 조사 경로.
- [DB contract](../../DB_CONTRACT.md), [Source jobs](../../SOURCE_JOBS.md), [Read-outs](../../READOUTS.md): 저장·실행·조회 계약 참고.
- [기존 Architecture](../../ARCHITECTURE.md), [도메인 architecture 문서](../): 설계·구현·과거 단계 설명의 범위를 구별해 확인.
- [Main handoff](../../operations/ASTRA_6_MAIN_HANDOFF.md): 날짜별 기록과 historical 구분 확인. 기재된 HEAD·migration 수를 현재값으로 간주하지 않음.
- [Production source of truth](../../operations/PRODUCTION_SOURCE_OF_TRUTH.md): local main·GitHub main·배포 상태 구분에 적용할 운영 규칙.

## VERIFIED AS-IS

SEC Primary As-Is, News Primary As-Is와 이를 요약한 Primary Overview를 등록했다. Service Model은 개념적 모델로 분리한다. 코드·저장 검증은 각 As-Is 문서에 명시된 범위에 한하며, Primary 문서화 완료가 전체 제품 E2E나 production 활성화 검증을 뜻하지 않는다.

## UNKNOWN / TO AUDIT

기능별 source, 호출 관계, parser/분석 방식, storage, 공식 reader, consumer, 자동·수동 실행 여부, provider, 배포·운영 활성화 상태는 앞으로 직접 확인할 대상이다.

## PROPOSED

현재 제품 구조 변경 제안은 없다.
