# Source Jobs

Source job configuration lives in `lib/sourceJobs.ts`.

## Job Routes

These routes are hosted by the existing `APP_BASE_URL` server. The Next.js app
exposes wrapper routes under `/api/source-jobs/:source/run`, but these are not
called automatically because they can trigger collection.

| Source | Server job route |
| --- | --- |
| GlobeNewswire | `POST /jobs/globe` |
| Business Wire | `POST /jobs/businesswire` |
| PR Newswire | `POST /jobs/prnewswire` |
| Newsfile | `POST /jobs/newsfile` |
| OFAC | `POST /jobs/ofac` |
| DOJ | `POST /jobs/doj` |
| DEA | `POST /jobs/dea` |
| White House | `POST /jobs/whitehouse` |

## Health Routes

Safe source URL checks:

```text
GET /api/sources/registry
GET /api/sources/health
GET /api/sources/health?full=true
```

`/api/sources/health` checks only the primary URL for each source.
`/api/sources/health?full=true` checks all configured source URLs, including
Business Wire category feeds and DEA/White House fallbacks.

## Execution Wrapper

Manual job wrapper:

```text
POST /api/source-jobs/:source/run
```

The wrapper defaults to:

```json
{
  "skipTelegram": true,
  "includePreview": true,
  "dryRun": true
}
```

Do not add automatic polling from the Next.js UI without explicit approval.
