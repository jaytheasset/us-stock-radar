# Proxy product merge gates — 2026-10-05

Verified on existing `codex/proxy-structured-product-v1`, starting at
`ee6d574218b025524c686d38a686a48e5ad171ec`. No product implementation or frozen
parser/Call1/Call2/schema/prompt/validator/Primary contract changed. Changes in this
candidate are verification scripts, the verification-only launcher and this handoff.

## Automatic positive alert and dedupe: PASS

A real browser Create POST (201) created monitor
`d2879496-7935-4f10-aa88-c850eb0e5094` with both existing Proxy presence conditions.
Its actual creation time is `2026-10-05T06:22:59.422Z`. The later synthetic filing
uses DB clock time `2026-10-05T06:23:54.269Z`; neither time was backdated or edited.

One synthetic raw/event pair uses reserved fixture identity
`9999999999-26-000001`, ticker `PXGATE`, `example.invalid` source URL and explicit
synthetic metadata. Its text is copied from retained Alternus source solely to
reuse the saved response evidence references; the historical Alternus record is
unchanged. All 103 discovery blocks match the retained source apart from the new
document identity. Both saved fresh Alternus responses validate unchanged against
the synthetic source package. This demonstrates pipeline transport and storage,
not new model analysis of a real filing.

- Raw: `b28c4cc3-93de-4473-b1ce-4d79b36375b5`
- Event: `68bc8e24-70f2-4ed9-84b3-8495b326c0d9`
- Automatic execution: `dd7b1b45-3be7-507c-a985-da1e54245fc9`
- Initial durable run: `wrun_01M45BS0G2W85RYNZEFBSF9SQ0`
- New monitor alert: `d0e3b12f-f6c9-465e-b1f6-425e87fbff4d`

The unchanged worker ran through real local Workflow HTTP steps, durable stage
claims/checkpoints, canonical persistence, official raw/accession/event readers,
typed Matcher and actual internal alert insertion. Namespace is **automatic**;
no verification reader override or injected Matcher/alert repository was used.
Only the explicit local provider transport was replaced with exact saved responses,
gated by request hashes. External fetches were blocked; actual Gemini requests: 0.

The new monitor received exactly one alert. The previous broad Proxy test monitor
also matched this new synthetic event and received one new alert, for two rows
total. Its monitor row was not modified. Other existing monitor rows and both
historical raw rows retain their captured hashes. One canonical output exists.

Repeated enqueue returned `duplicate`. An explicit second durable Workflow run
for the same automatic execution completed, reused checkpoints and preserved the
same two alert IDs/count. The provider replay claim files remain one per stage.
No email/Telegram delivery occurred; both alerts retain empty delivered channels
and null `sent_at`. No existing data was reset, deleted or backfilled.

The first verification poll used a directory different from the Next Workflow
server's actual `.next/workflow-data`; the worker itself had completed. Correcting
the test poll recovered that same run without another provider dispatch. The
final script consistently reads the server's actual directory.

## Browser acceptance: PASS

On `http://127.0.0.1:3115/monitor`, the existing review user's authenticated session
submitted **Create this monitor** with the two Proxy conditions. The UI displayed
**Monitor created**, both saved conditions and **Active**. **Manage monitors**
opened `/alerts`, where the same new two-condition monitor and the actual internal
alerts were visible. No existing monitor/account settings controls were changed.

The same server at `http://localhost:3115` provided a separate unauthenticated
cookie origin without signing out the existing user. `/monitor` displayed the
sign-in notice and disabled Create; `/alerts` showed no private monitor rows and
requested sign-in. Unauthenticated Monitor GET and POST both returned 401.

Logged-in `/alerts` was visually inspected at 390, 900 and 1440px; measured page
widths were 390, 885 and 1425 respectively, with no horizontal overflow. No logged-in
browser console errors occurred. Screenshots and UI assertions are retained below.

The existing browser automatically refreshed its authentication session at
`06:22:20Z`: auth audit contains only `token_refreshed` and `token_revoked` for that
account during verification. Its full `auth.users` row hash changed, so this is
not reported as byte-identical account storage. No profile, password, permission,
plan or monitor setting mutation was performed. Existing monitor/historical raw
hash checks pass; the session audit is included in the result evidence.

## Local migration history: PASS

Verified database host/port `127.0.0.1:56322`, system identifier
`7678429483712069671`. Compared the migration with four function bodies/signatures,
return types/defaults/language/invoker/search-path settings, two valid unique
indexes, two enabled triggers and RPC grants. All match semantically.

Only after that comparison, executed:

```text
supabase migration repair 20261005043414 --status applied --local
```

The target local history row is now applied. Full before/after comparisons show
all other history rows and all inspected schema definitions unchanged. No CREATE
statements were rerun, no schema objects modified, and no remote/production DB
was touched. The migration file itself is unchanged.

## Baseline and evidence

Focused candidate tests: **34/36 pass**; baseline `b1e80ca`: **27/29 pass**.
The same two failures remain: the Matcher forbidden-word check matches existing
`Form4PurchaseMatchEvidence`, and preset Create roundtrip expectations omit existing
`monitor_kind`/`form4_purchase_settings`. All seven product/ingest tests pass.
No test expectations or runtime logic changed to obtain these results.
Whole-project `tsc --noEmit --incremental false`, syntax checks for the four
verification scripts and `git diff --check` also pass.

Evidence: `C:/Users/PC/.codex/visualizations/proxy-merge-gates-20261005`:
`automatic-alert-report.json`, `automatic-first-alerts.json`,
`automatic-replay-workflow.json`, `migration-object-audit.json`,
`migration-history-report.json`, `migration-repair.log`, `ui-report.json`,
browser screenshots and `.proxy-gates-*.log`.

Use `verify-proxy-automatic-alert.mjs check <evidence> <prior-evidence>` and
`verify-proxy-migration-history.mjs check <evidence>` for non-dispatch readback.
Do not rerun `before`/`seed` or issue fresh model calls. The new synthetic rows,
monitor and internal alerts are retained as evidence; they were not cleaned up.

All requested candidate gates now pass. This does not authorize main integration.
Local main remains `b1e80ca68e2b702849286091b3b0a7de4a190101`; GitHub main and Vercel
remain last-observed values from the prior handoff, not newly audited. No main
merge, push or deployment. Candidate server 3115 is stopped after verification;
3110 is untouched. Final candidate HEAD/clean state are reported separately.
