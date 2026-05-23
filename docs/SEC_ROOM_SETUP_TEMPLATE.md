# SEC Room Setup Template

이 문서는 새 Codex 방을 만들 때 그대로 따라가는 세팅 절차다.

핵심은 단순하다:

- 인수인계 MD는 기준 문서다. 개별 방에서 커밋하지 않는다.
- 개별 공시폼 방은 자기 폴더만 수정한다.
- 공통, ingest, DB, UI, 알림, 라이브 FMP 연결은 해당 전용 방에서만 한다.
- 병렬 작업이면 같은 로컬 폴더 하나를 여러 방이 동시에 쓰지 않는다.

## 1. 병렬 작업 폴더 만들기

진짜 병렬로 돌릴 방은 git worktree로 폴더를 분리한다.

기준 폴더:

```powershell
cd "C:\Users\PC\Documents\Codex\US-Stock Radar"
git status --short
```

`git status --short`가 깨끗한 상태에서 새 작업 폴더를 만든다.

예시:

```powershell
git worktree add "..\US-Stock-Radar-sec-8k-6k" -b sec/8k-6k
git worktree add "..\US-Stock-Radar-sec-s1-f1" -b sec/s1-f1
git worktree add "..\US-Stock-Radar-sec-424b" -b sec/424b
```

새 Codex 방은 원본 폴더가 아니라 각 worktree 폴더로 연다.

같은 폴더 하나를 여러 Codex 방이 동시에 수정하면 dirty 상태가 섞이고,
한 방의 산출물이 다른 방에 보이면서 꼬일 수 있다.

## 2. 방별 기준표

| Scope | Handoff MD | Work Folder | Branch Example |
| --- | --- | --- | --- |
| `8-K / 6-K, 8-K/A / 6-K/A` | `docs/SEC_8K_6K_ROOM.md` | `lib/sources/sec/forms/8k-6k/` | `sec/8k-6k` |
| `10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A` | `docs/SEC_PERIODIC_REPORTS_ROOM.md` | `lib/sources/sec/forms/periodic-reports/` | `sec/periodic-reports` |
| `NT 10-K / NT 10-Q / NT 20-F` | `docs/SEC_NT_ROOM.md` | `lib/sources/sec/forms/nt/` | `sec/nt` |
| `S-1 / F-1, S-1/A / F-1/A` | `docs/SEC_S1_F1_ROOM.md` | `lib/sources/sec/forms/s1-f1/` | `sec/s1-f1` |
| `S-3 / F-3 / S-3ASR / F-3ASR, S-3/A / F-3/A` | `docs/SEC_S3_F3_ROOM.md` | `lib/sources/sec/forms/s3-f3/` | `sec/s3-f3` |
| `424B3 / 424B5` | `docs/SEC_424B_ROOM.md` | `lib/sources/sec/forms/424b/` | `sec/424b` |
| `S-8 / S-8/A` | `docs/SEC_S8_ROOM.md` | `lib/sources/sec/forms/s8/` | `sec/s8` |
| `EFFECT` | `docs/SEC_EFFECT_ROOM.md` | `lib/sources/sec/forms/effect/` | `sec/effect` |
| `Form 4 / 4/A, Form 144 / 144/A` | `docs/SEC_OWNERSHIP_ROOM.md` | `lib/sources/sec/forms/ownership/` | `sec/ownership` |
| `SC 13D / SC 13D/A, SC 13G / SC 13G/A` | `docs/SEC_SC13_ROOM.md` | `lib/sources/sec/forms/sc13/` | `sec/sc13` |
| `Proxy` | `docs/SEC_PROXY_ROOM.md` | `lib/sources/sec/forms/proxy/` | `sec/proxy` |
| `425` | `docs/SEC_425_ROOM.md` | `lib/sources/sec/forms/425/` | `sec/425` |
| `S-4 / F-4 / S-4/A / F-4/A` | `docs/SEC_S4_F4_ROOM.md` | `lib/sources/sec/forms/s4-f4/` | `sec/s4-f4` |
| `Tender / CB / 13E3` | `docs/SEC_TENDER_CB_13E3_ROOM.md` | `lib/sources/sec/forms/tender-cb-13e3/` | `sec/tender-cb-13e3` |
| `Form 25 / 25-NSE` | `docs/SEC_FORM25_ROOM.md` | `lib/sources/sec/forms/form25/` | `sec/form25` |
| `Other SEC Filing` | `docs/SEC_OTHER_ROOM.md` | `lib/sources/sec/forms/other/` | `sec/other` |
| SEC ingest / site connection | `docs/SEC_INGEST_INTEGRATION_ROOM.md` | integration files only after form output exists | `sec/ingest-integration` |
| SEC detail UI | `docs/SEC_EVENT_DETAIL_UI_ROOM.md` | app/UI files only after UI payload exists | `sec/event-detail-ui` |

## 3. 새 공시폼 방 첫 메시지

아래를 새 방 첫 메시지로 붙여 넣는다. 대괄호 부분만 바꾼다.

```text
이 방은 SEC [정확한 Scope] 작업방이다.

먼저 아래 두 문서와 작업 폴더만 읽어라.

- docs/SEC_FORM_ROOM_RULES.md
- docs/[해당 ROOM MD 파일명]
- [해당 Work Folder]

이 MD들은 기준 문서다. 수정하지 마라.

작업은 [해당 Work Folder] 안에서만 한다.
common, ingest, DB, app/UI, alerts, live FMP, live DB는 건드리지 마라.

목표 흐름은 parser > router LLM prompt > analysis LLM prompt > fixture JSON tests다.
LLM 없이 deterministic으로 끝나는 케이스가 있으면 fixture로 증명만 해라.

시장정보는 fixture JSON으로만 넣고 실제 API 호출은 하지 마라.
결과 JSON은 docs/SEC_FORM_ROOM_RULES.md의 Required Output JSON 형식을 따른다.

먼저 문서와 폴더를 읽고 작업 계획만 말해라.
아직 수정하지 마라.
```

## 4. 작업 시작 허가 메시지

계획을 보고 괜찮으면 아래처럼 말한다.

```text
진행해.

수정 전 변경할 파일 목록을 먼저 말해라.
수정은 [해당 Work Folder] 안에서만 해라.
테스트는 fixture JSON으로만 해라.

작업 중 공통 규칙, market context, ingest 연결, 특수 상세 UI가 필요해지면
구현하지 말고 final handoff에 적어라.
다른 공시폼 방들이 병렬로 작업 중이라 공통/DB/UI/ingest를 건드리면 충돌난다.
```

## 5. 중간 리마인드

작업이 길어지면 이 문장을 다시 붙인다.

```text
리마인드: 이 방은 [해당 Work Folder] 안에서만 작업한다.
공통, ingest, DB, app/UI, alerts, live FMP, live DB는 건드리지 마라.
필요하면 구현하지 말고 final handoff에 적어라.
```

## 6. 커밋 전 확인 메시지

개별 방에서 커밋하기 전에 아래를 요구한다.

```text
커밋 전에 git status를 보여주고,
변경 파일이 전부 [해당 Work Folder] 안에만 있는지 확인해라.

인수인계 MD, common, ingest, DB, app/UI, alerts 파일이 있으면 커밋하지 말고 멈춰라.
```

정상이라면 개별 방은 자기 branch에서 자기 작업물만 커밋한다.

인수인계 MD는 이 메인 방에서 관리하는 기준 문서라서 개별 공시폼 방에서 다시
커밋하지 않는다.

## 7. 완료 보고 형식

각 공시폼 방은 완료할 때 이것만 보고한다.

```text
완료 보고:

- 작업한 scope:
- 변경 파일:
- 만든 parser/router/analysis:
- fixture 테스트:
- score별 archive/feed/alert 예시:
- market context 필요 여부:
- ingest 방에 전달할 내용:
- 상세 UI 방에 전달할 내용:
- common 규칙으로 승격할 후보:
- 남은 위험:
```

## 8. ingest 방 시작 메시지

폼 방 산출물이 하나 이상 끝난 뒤에만 시작한다.

```text
이 방은 SEC ingest / integration 방이다.

먼저 docs/SEC_FORM_ROOM_RULES.md 와 docs/SEC_INGEST_INTEGRATION_ROOM.md를 읽어라.
완료된 공시폼 방의 final handoff와 Required Output JSON만 기준으로 연결한다.

개별 parser 로직을 고치지 마라.
DB, ingest, market context, feed, filings page, archive, alert 연결만 담당한다.

먼저 어떤 form room을 연결할지와 변경 예정 파일을 말해라.
아직 수정하지 마라.
```

## 9. 상세 UI 방 시작 메시지

특수 `display_payload`가 실제로 나온 뒤에만 시작한다.

```text
이 방은 SEC event detail UI 방이다.

먼저 docs/SEC_FORM_ROOM_RULES.md 와 docs/SEC_EVENT_DETAIL_UI_ROOM.md를 읽어라.
완료된 공시폼 방의 display_payload와 ingest 방의 저장 방식을 기준으로 UI를 만든다.

parser, router, analysis prompt, ingest, DB, alerts는 건드리지 마라.

먼저 어떤 display_type 또는 candidate_special을 화면화할지와 변경 예정 파일을 말해라.
아직 수정하지 마라.
```
