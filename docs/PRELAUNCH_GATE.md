# Prelaunch access gate

The public-page gate is disabled by default. Production enables it with
server-only environment variables:

```text
PRELAUNCH_MODE=1
PRELAUNCH_PASSWORD=<a strong private password>
```

Do not prefix either variable with `NEXT_PUBLIC_`. Changing
`PRELAUNCH_PASSWORD` invalidates every existing access cookie.

## Request behavior

- Ordinary page requests redirect to `/coming-soon`.
- `/api/**`, `/.well-known/workflow/**`, `/_next/**`, and static assets bypass
  the page gate. Their existing authentication rules still apply.
- A correct developer password sets a 30-day, HttpOnly, SameSite=Lax access
  cookie. The cookie contains an HMAC proof, not the password.
- `POST /api/prelaunch/logout` clears the access cookie.
- Redirect targets are restricted to internal paths.
- Prelaunch pages and authenticated preview responses send no-index signals.
  `robots.txt` disallows all crawling while the mode is enabled.

Set `PRELAUNCH_MODE=0` or remove it to restore normal public-page behavior.

## Scheduled ingestion during UI development

Automatic source ingestion is intentionally disabled: `vercel.json` contains
no `/api/cron/source-ingest/*` schedules. The authenticated source Cron routes
and durable workflows remain available for manual testing only. Do not restore
their schedules until automatic collection is explicitly approved.

The `/api/cron/market-cache` five-minute schedule remains enabled so market
cache behavior can continue to be validated.
