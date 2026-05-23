# SEC Form Parser Workspaces

This directory is the workspace boundary for parallel SEC form parser rooms.

Rules:

- Work only inside the assigned form folder unless the user explicitly asks for integration work.
- Do not edit runtime ingest wiring, prompt registry, database migrations, shared scoring, market context, alerts, news code, auth code, or UI from a form-specific room.
- Each form folder owns parser drafts, fixtures, parser tests, router prompt drafts, analysis prompt drafts, and local notes for that exact form group.
- Runtime parser registry, DB storage, promptRegistry wiring, and site verification belong to a separate SEC integration room.
- Detail UI belongs to display-model UI rooms, not form rooms.
- Keep `s3-f3/` existing work intact unless the user explicitly asks for S-3/F-3 work.

Form room map:

| Folder | Exact scope |
| --- | --- |
| `8k-6k/` | 8-K / 6-K, 8-K/A / 6-K/A |
| `periodic-reports/` | 10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A |
| `nt/` | NT 10-K / NT 10-Q / NT 20-F |
| `s1-f1/` | S-1 / F-1, S-1/A / F-1/A |
| `s3-f3/` | S-3 / F-3 / S-3ASR / F-3ASR, S-3/A / F-3/A |
| `424b/` | 424B3 / 424B5 |
| `s8/` | S-8 / S-8/A |
| `effect/` | EFFECT |
| `ownership/` | Form 4 / 4/A, Form 144 / 144/A |
| `sc13/` | SC 13D / SC 13D/A, SC 13G / SC 13G/A |
| `proxy/` | Proxy |
| `425/` | 425 |
| `s4-f4/` | S-4 / F-4 / S-4/A / F-4/A |
| `tender/` | Tender / CB / 13E3 |
| `form25/` | Form 25 / 25-NSE |
| `other/` | Other SEC Filing |
