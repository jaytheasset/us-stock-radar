# S-4 / F-4 Parser Room

Scope: `S-4`, `S-4/A`, `F-4`, `F-4/A`.

Allowed here: parser code, fixtures, parser tests, and local notes for this form family.

Do not wire this folder into runtime ingestion from this room. Leave integration to the SEC parser integration room.

Local draft files:

- `parser.ts` extracts S-4/F-4 transaction, vote, amendment, dilution/ownership, risk, and calendar candidates.
- `routerPrompt.ts` drafts route classification for merger registration, exchange offer, shareholder vote, material amendment, and amendment noise.
- `analysisPrompt.ts` drafts event analysis output for strategic transaction, shareholder vote, dilution risk, financial risk, and routine archive cases.
- `fixtures/sample-filings.json` and `parser.test.ts` provide parser-only fixture checks.
- `NOTES.md` is the integration handoff.
