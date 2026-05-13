# Read-Out Surfaces

This project exposes registries and status pages for architecture-critical
objects so future chats do not invent parallel structures.

## API Read-Outs

```text
GET /api/db/registry
GET /api/prompts/registry
GET /api/integrations/registry
GET /api/integrations/health
GET /api/sources/registry
GET /api/sources/health
GET /api/sources/health?full=true
```

## Admin Pages

```text
/admin
/admin/db
/admin/event-types
/admin/sources
/admin/taxonomy
/admin/prompts
/admin/integrations
```

## Rules

- Read-outs are safe and read-only.
- Schema changes must be implemented through migrations, not admin pages.
- Prompt registry changes should be versioned.
- Source job execution must stay explicit; source health checks must not run
  collection jobs.
- Do not expose secret values in read-outs.
