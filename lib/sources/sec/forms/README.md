# SEC Form Parser Workspaces

This directory is the handoff boundary for parallel SEC form parser work.

Rules for Codex rooms:

- Work only inside the assigned form folder unless the user explicitly asks for integration work.
- Add parser code, fixtures, and parser tests in the assigned folder.
- Do not edit ingest wiring, prompt registry, database migrations, or shared UI from a form-specific room.
- If a shared change is needed, leave a TODO in the folder README or parser notes and stop.
- Keep S-3 behavior intact. The existing S-3 parser lives in `s3-f3/parser.ts`.
- End each room with a focused commit and a clean `git status`.

Recommended folders:

| Folder | Forms |
| --- | --- |
| `8k-6k/` | 8-K, 6-K, 8-K/A, 6-K/A |
| `periodic-reports/` | 10-K, 10-Q, 20-F and amendments |
| `nt/` | NT 10-K, NT 10-Q, NT 20-F |
| `s1-f1/` | S-1, F-1 and amendments |
| `s3-f3/` | S-3, F-3, S-3ASR, F-3ASR and amendments |
| `424b/` | 424B3, 424B5 |
| `s8/` | S-8 and amendments |
| `effect/` | EFFECT |
| `ownership/` | Form 4, Form 144 and amendments |
| `sc13/` | SC 13D, SC 13G and amendments |
| `proxy/` | Proxy statements |
| `425/` | 425 |
| `s4-f4/` | S-4, F-4 and amendments |
| `tender/` | Tender, CB, 13E3 |
| `form25/` | Form 25, 25-NSE |
| `other/` | Other SEC filing fallback |

Integration room only:

- Register parsers.
- Connect parser output to filing package, event analysis, calendar items, and detail pages.
- Run browser verification against filings pages after parser output reaches storage.
