# Accesswire Raw Bridge

Small NAS-side Node server for Access Newswire raw fetch only.

It does not need OpenAI, Supabase, or app database keys. It only needs:

```env
NAS_INGEST_TOKEN=your-existing-token
PORT=3000
```

## API

```text
GET /health
POST /api/accesswire/raw
```

`POST /api/accesswire/raw` requires either:

```text
Authorization: Bearer <NAS_INGEST_TOKEN>
```

or:

```text
X-Ingest-Token: <NAS_INGEST_TOKEN>
```

Request body:

```json
{
  "limit": 1,
  "sourceUniqueId": "optional Accesswire article URL or release id",
  "includeArticleBody": true,
  "articleBodyLimit": 1
}
```

Response shape matches the Accesswire raw parser result:

```json
{
  "ok": true,
  "status": 200,
  "count": 1,
  "items": [],
  "diagnostics": {}
}
```

## Synology Docker

Use a Playwright/Chromium image because Accesswire release discovery can require
browser-rendered newsroom content.

Recommended image:

```text
playwright/chromium:latest
```

Run with NAS port `18081` mapped to container port `3000`.

Mount this folder to:

```text
/app
```

Use this command:

```text
sh -c "cd /app && npm install --omit=dev && node server.mjs"
```

The bridge stops the remaining newsroom API feed requests after the first
Cloudflare `403`/challenge and moves immediately to browser discovery.
Browser discovery uses a bounded listing deadline and does not wait for
Playwright `networkidle`; it returns as soon as a newsroom API response or
release link is available.

After changing `server.mjs`, restart or redeploy the NAS container. Updating
the Vercel application alone does not update the NAS bridge process.

After it is running:

```text
http://192.168.0.126:18081/health
```

Then set the main app:

```env
ACCESSWIRE_INGEST_URL=http://192.168.0.126:18081/api/accesswire/raw
NAS_INGEST_TOKEN=<same existing token>
```
