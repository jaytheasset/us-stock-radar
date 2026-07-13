# Stock Radar UI Rules

- Before any Stock Radar UI work, read `docs/UI_DESIGN_SYSTEM.md`, `docs/UI_DESIGN_TOKENS.md`, and `docs/UI_COMPONENT_CONTRACTS.md`.
- Treat `/dashboard-v2` and `docs/ui-reference/dashboard-v2/` as the current canonical visual reference.
- Reuse existing `--sr-` tokens and shared components before adding new ones. Do not invent literal colors, arbitrary typography/spacing, shadows, radii, or breakpoints.
- Keep generic UI APIs free of business-specific ticker, event, filter, route, data, and provider logic.
- Design and verify desktop and mobile together. Do not use horizontal scrolling as the default mobile market/table solution; reprioritize information.
- Do not mix a UI refactor with feature, data, API, parser, auth, routing, SEO, or billing changes.
- For canonical visual refactors, compare previous and candidate commits in the same browser/runtime.
- Never overwrite baseline screenshots without explicit approval.
- Update the token or component contract document in the same change when its public source of truth changes.
- Treat documented known limitations as defects or deferred work, not reusable design rules.
- When moving this system to another repository, merge with that repository's `AGENTS.md`; never overwrite it.
