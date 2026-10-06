# Tender price-change candidate

Base 47fd6b0ee8562e7208aa97c44a8abc737607e9ea; existing detached 87db workspace.
Product changes: Monitor Reader derives changed/null from existing canonical price pair;
Registry adds only tender.offer_price_change eq changed. Provider contract/source/Workflow unchanged.
No migration, direction, thresholds, FX, new LLM fields or stages.

Before paid call: offline edge/contract/matcher/NL stub/Carlyle tests, regression suite,
typecheck, Workflow validation, local DB schema checks, source hash/provenance review,
real generated Workflow manifest/routes, frozen request. Source E5 provides current
all-cash per-share price; E10/E15 explicitly report 0.82 to 0.84, with reject recommendation.
E3's 1.25 acquisition proposal and E8's merger recommendation are other transaction contexts.

One authorized paid call: DXL 0001193125-26-298540 through unchanged gemini-3.5-flash
four-slot product analyzer and real local Workflow. Purpose: source-backed price pair
through persistence/Reader/deterministic comparison/Matcher/one internal Alert.
Semantic error => MODEL_ERROR and STOP. Infrastructure failure after response => durable
checkpoint replay only. Unknown started outcome => uncertain, never a second call.
Exclusive marker and exact request hash guard before fetch; external delivery blocked.

Synthetic local auth user AND user profile, monitor predating filing, source-only raw/event.
Compare preexisting row digests, including prior Carlyle history. After success test duplicate
enqueue, runtime replay, real Workflow replay, output/alert count one, unchanged canonical.
NL compiler is paid AI: test all three requested phrases with explicit stubs, not live AI.
Finish report, local candidate commit and clean detached HEAD. No main merge/push/deploy.
