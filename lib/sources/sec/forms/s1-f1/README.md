# S-1 / F-1 Parser Room

Scope: `S-1`, `S-1/A`, `F-1`, `F-1/A`.

Allowed here: parser code, fixtures, parser tests, and local notes for this form family.

Do not wire this folder into runtime ingestion from this room. Leave integration to the SEC parser integration room.

## Draft Deliverables

- `types.ts`: S-1/F-1 parser fact types and prompt-facing term shapes.
- `parser.ts`: deterministic parser for IPO/new listing, primary registration, resale registration, mixed registrations, and amendment candidates.
- `routerPrompt.ts`: router prompt draft for IPO vs resale vs primary vs routine amendment.
- `analysisPrompt.ts`: analysis prompt draft aligned to common SEC score/action semantics.
- `fixtures/`: parser-only fixtures for IPO, resale, and primary amendment cases.
- `parser.test.ts`: parser-only fixture assertions.
- `NOTES.md`: integration handoff notes.

## Local Verification

```powershell
.\node_modules\.bin\tsc.cmd .\lib\sources\sec\forms\s1-f1\parser.test.ts --module commonjs --target ES2020 --moduleResolution node --esModuleInterop --skipLibCheck --types node --outDir .\.tmp\s1-f1-parser-test --noEmit false
node .\.tmp\s1-f1-parser-test\s1-f1\parser.test.js
npm.cmd run typecheck
```
