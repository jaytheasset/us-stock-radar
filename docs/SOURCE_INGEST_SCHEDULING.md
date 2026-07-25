# Source ingest scheduling

Source ingest automation is intentionally disabled during prelaunch.

- `vercel.json` contains no `/api/cron/source-ingest/*` schedules.
- The SEC, newswire, government, exchange, and FDA route handlers and durable
  Workflows remain deployed for authenticated manual verification.
- `/api/cron/market-cache` remains scheduled every five minutes for the
  separate market-cache validation program.

Manual source verification requires `CRON_SECRET` and the intended target in
`SOURCE_INGEST_WORKFLOW_ENABLED_LANES`. For example:

```bash
curl \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<production-host>/api/cron/source-ingest/sec?group=current_reports"
```

Do not add source-ingest entries back to `vercel.json` until automatic
collection is explicitly approved for launch. The regression in
`lib/sourceWorkflowConfig.test.ts` enforces the disabled state.
