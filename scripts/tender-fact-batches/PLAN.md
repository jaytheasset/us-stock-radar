# Tender three-FACT batch gate

Base: 276bb1db9d6cd3ac7cad2d8d52fe01df40b64b55; same 87db detached worktree.
All earlier experiments remain immutable. New calls use only gemini-3.5-flash, one request per case per FACT, no retry/repair/fallback. Model comes from the frozen plan, never an env override.

Sequence: expiration remaining five → review whole FACT (including frozen Rumble, Applied, Nano) → only on Practical PASS prepare price source/schema/batch → only on price Practical PASS prepare board recommendation → report/STOP. No status/final_results FACT, DB, persistence, jobs, product routes, Parser semantics, integration/push/deploy.

Before every request freeze source, projected short-ref source, identity map, prompt, schema, exact request bytes, code hashes, case expectations, run identity. Record started before fetch. Preserve raw text/response, validation, lookup and usage. Exclusive markers prohibit a second call. Transport/schema/provenance failure stops remaining batch calls; completed valid independent cases may all be reviewed together. Any needed semantic contract revision blocks the next FACT. No same-case rerun in this task even under a new identity.

Separate A provider/schema, B strict local, C provenance, D direct SEC meaning/support review. Expected answers/reviews never enter provider requests. Claims current/previous each require >=1 direct selected ref; related non-conflicting corroborating refs allowed; unreviewed/irrelevant/conflicting/foreign/missing refs fail. Review is Codex reading actual selected SEC text, not an independent human signoff or Parser oracle. Empty facts with justified unresolved is an expected abstention, not automatically a failure.

Failure taxonomy: SOURCE_COVERAGE, MODEL_ERROR, SCHEMA_ERROR, SOURCE_UNRESOLVED, PROVIDER_MODEL_UNAVAILABLE, PREFLIGHT_TEST_ERROR. A meaningful wrong answer with adequate source is MODEL_ERROR; no selector expansion after seeing a model error. Provider transport limitations must be reported distinctly, never asserted as SEC ambiguity.

All data files here are requested experiment audit artifacts, not production FACT persistence or snapshots. No product collector E2E is implemented.
