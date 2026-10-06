# Tender 4-FACT product candidate — bounded Carlyle E2E

Base acf8c181a6af3c15896c6d363a53930f357c008e, existing detached 87db worktree. Adopt and correct the explicitly identified uncommitted GPT draft. Local Supabase only (127.0.0.1:56322 / API 56321), candidate Workflow server 3117. No main merge, push, deployment or external alert delivery.

## Acceptance before the one paid call

- Product has offer_price, board_recommendation, offer_status and final_results_observed only. No expiration/unresolved output. Source-only currency enum; fixed unit and observed=true attached structurally.
- Source through existing prepare/index/search/read; one packet and three generic queries. No Primary/parser meaning input, fake issuer CIK or fake ticker. Carlyle archive bytes unchanged. Exact document identity restoration from original archive segments is harness-only.
- Filing-bound unique execution, no source-version/verification-key second-call namespace. Started provider requests are never reclaimed. Completed response checkpoint is replayed after downstream DB failure. Reader validates current full packet fingerprint, identity, model/version, one output, hashes, transport checkpoint and exact canonical projection.
- Monitor exposes board/status eq/in and final=true only. False rejected by common validation; absent slots remain null. Keep activation rule. Synthetic monitor predates actual filing; existing monitor timestamps untouched.
- Unit/contract/source/Reader/matcher/ingest tests; S-8/Proxy/Tender regression tests; local migration apply/reapply and DB failure-injection tests; typecheck; Workflow strict validation and actual generated manifest/routes all must pass before permit.

## Authorized provider operation and stopping rule

Exactly at most one physical request, gemini-3.5-flash, Carlyle 0001702510-26-000009. Purpose: validate four source-only judgments through real local durable Workflow and persist/read/match one synthetic alert. Freeze request/source/hash before permit. The local transport checks exact URL/model/request hash and creates an exclusive physical-call-started marker before network. Every other outbound network host is blocked; no Telegram/email/push calls.

Expected (review only, never provider input): price=null, board=null, status=null, final_results_observed positive. Canonical only final_results_observed/observed:true. Source final-results statement plus NAV/promissory-note consideration supports these judgments. Provider semantic error => MODEL_ERROR and STOP; no new prompt, source expansion, fallback or second call. If checkpoint exists and downstream infrastructure fails, fix and replay only. Unknown provider outcome => uncertain and no new call.

Successful path: snapshot → runSecRawIngest (fixture-backed fetch/persistence adapters) → automatic Tender sidecar enqueue → generated Workflow descriptor on real local worker → Gemini → DB checkpoint/output → official Reader → matcher → existing alert persistence. The harness supplies a synthetic event/user/monitor and no Primary analysis. No-ticker Tender source is retained as excluded-from-Primary raw evidence; Primary exclusion remains intact.

Replay/duplicate tests must keep one ai_run, one ai_output, one monitor/event alert, same canonical hash, physical requests=1. Compare before/after digests of preexisting users, monitors, raw, events, AI history and alerts. Stop after local candidate commit, regardless of PASS/FAIL. This is not a main-integration handoff.
