# Prelaunch access gate

The site-wide gate fails closed by default on Vercel Production. Keep it
explicitly enabled with server-only environment variables:

```text
PRELAUNCH_MODE=1
PRELAUNCH_PASSWORD=<a strong private password>
```

Do not prefix either variable with `NEXT_PUBLIC_`. Changing
`PRELAUNCH_PASSWORD` invalidates every existing access cookie.

## Request behavior

- Ordinary page requests redirect to `/coming-soon` and protected API requests
  return a `401 PRELAUNCH_ACCESS_REQUIRED` response before product data is
  generated.
- Only the gate routes, `robots.txt`, the favicon, immutable Next.js build
  assets, and authenticated operational endpoints needed by Cron, Workflow,
  email unsubscribe, and signed webhooks bypass the product gate. Operational
  endpoints keep their own secret or signature checks.
- Same-deployment calls made by Cron and Workflow attach a short-lived signed
  gate proof, so their dependent product APIs remain private to outside clients.
- A correct developer password sets a 30-day, HttpOnly, SameSite=Lax access
  cookie. HTTPS responses also mark it Secure. The cookie contains a
  server-validated expiry and HMAC proof, not the password.
- Expired or modified proofs fail closed. A password rotation invalidates all
  outstanding proofs.
- `POST /api/prelaunch/logout` clears the access cookie.
- Redirect targets are restricted to internal paths.
- Prelaunch pages and authenticated preview responses send no-index signals.
  `robots.txt` disallows all crawling while the mode is enabled.

Set `PRELAUNCH_MODE=0` to launch the public site. Removing the variable does
not open Vercel Production; it keeps the gate enabled and fails closed when
the password is unavailable. Development and preview environments remain off
unless `PRELAUNCH_MODE=1` is explicitly configured.

## Scheduled ingestion during UI development

Automatic source ingestion is intentionally disabled: `vercel.json` contains
no `/api/cron/source-ingest/*` schedules. The authenticated source Cron routes
and durable workflows remain available for manual testing only. Do not restore
their schedules until automatic collection is explicitly approved.

The `/api/cron/market-cache` five-minute schedule remains enabled so market
cache behavior can continue to be validated.
