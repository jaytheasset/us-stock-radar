# Source Jobs

Source job configuration lives in `lib/sourceJobs.ts`.

## Job Routes

Most routes are hosted by the existing `APP_BASE_URL` server. GlobeNewswire,
Business Wire, PR Newswire, Newsfile, Access Newswire, OFAC, DOJ, DEA, White House, FDA, Nasdaq Trader, and Nasdaq Corporate Actions are the current exceptions
and use canonical Next.js ingest routes. The Next.js app exposes wrapper routes under
`/api/source-jobs/:source/run`, but these are not called automatically because
they can trigger collection.

| Source | Server job route |
| --- | --- |
| GlobeNewswire | `POST /api/sources/globe/ingest` |
| Business Wire | `POST /api/sources/businesswire/ingest` |
| PR Newswire | `POST /api/sources/prnewswire/ingest` |
| Newsfile | `POST /api/sources/newsfile/ingest` |
| Access Newswire | `POST /api/sources/accesswire/ingest` |
| OFAC | `POST /api/sources/ofac/ingest` |
| DOJ | `POST /api/sources/doj/ingest` |
| DEA | `POST /api/sources/dea/ingest` |
| White House | `POST /api/sources/whitehouse/ingest` |
| FDA | `POST /api/sources/fda/ingest` |
| Nasdaq Trader | `POST /api/sources/nasdaq-trader/ingest` |
| Nasdaq Corporate Actions | `POST /api/sources/nasdaq-corporate-actions/ingest` |

## Vercel Workflow Scheduling

Production Vercel Cron routes only authenticate, acquire a distributed lease,
and start a Workflow run. Collection, analysis, and Supabase persistence happen
inside durable Workflow steps.

| Lane | Vercel Cron (UTC) | Sources |
| --- | --- | --- |
| `sec` | every 5 minutes | Due groups from `SEC_PRODUCTION_INGEST_SCHEDULE` |
| `news_fast` | every 5 minutes | GlobeNewswire, Business Wire, PR Newswire, Newsfile, Access Newswire, Nasdaq Trader, Nasdaq Corporate Actions |
| `news_slow` | minute 2 and 32 | OFAC, DOJ, DEA, White House, FDA |

Start endpoints:

```text
GET /api/cron/source-ingest/sec
GET /api/cron/source-ingest/news_fast
GET /api/cron/source-ingest/news_slow
```

Vercel sends `Authorization: Bearer <CRON_SECRET>`. The routes also accept the
same bearer header for authenticated manual checks. No lane runs until its ID is
present in `SOURCE_INGEST_WORKFLOW_ENABLED_LANES`.

See `docs/VERCEL_WORKFLOW_INGEST.md` for deployment, observation, parallel-run,
and rollback procedures.

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

GlobeNewswire, Business Wire, PR Newswire, Newsfile, Access Newswire, OFAC, DOJ, DEA, White House, FDA, Nasdaq Trader, and Nasdaq Corporate Actions wrappers execute
against the current Next.js request origin so local dry-run checks hit their
canonical routes. Other sources still use their configured `APP_BASE_URL` job
routes.

PR Newswire uses multiple event and sector RSS feeds instead of the noisy
all-release RSS. The parser tags raw items with `candidate_class`; items marked
`low_value_filtered` are skipped before LLM analysis.

OFAC uses `https://ofac.treasury.gov/recent-actions` as the canonical source.
When an OFAC action links to a Treasury press release, the parser keeps the OFAC
action URL as `source_url` and appends the Treasury press release body to
`analysis_text` for market-relevance analysis.

DOJ uses `https://www.justice.gov/api/v1/press_releases.json` with
`sort=date&direction=DESC`; the API defaults to old archive items if those sort
params are omitted. The parser tags local individual criminal matters as
`low_value_filtered` before LLM analysis and keeps antitrust, securities fraud,
FCPA, False Claims Act, export/sanctions, cyber/crypto, defense procurement, and
public-company enforcement items as LLM candidates.

DEA uses the DOJ press release API as the canonical fetch path and filters for
the `Drug Enforcement Administration (DEA)` component client-side. The public
DEA.gov press-release HTML page is kept as a reference URL, but it is not the
parser's primary fetch path because direct HTML requests can be blocked by the
site edge layer. Routine local drug-crime items are tagged `low_value_filtered`;
controlled-substance policy, pharma distribution enforcement, public-health drug
supply, cartel/security, and darknet/crypto items remain LLM candidates.

White House uses the public HTML archive pages for Presidential Actions, Fact
Sheets, and Releases. The parser fetches archive list pages, hydrates article
body HTML from each item page, and tags ceremonial, nomination, and general
political-promo items as `low_value_filtered`. Trade, sanctions, energy,
healthcare, technology, defense, tax/budget/regulation, labor, infrastructure,
agriculture, and commodity policy items remain LLM candidates.

FDA uses official RSS feeds for Press Releases, What's New: Drugs, What's New:
Vaccines/Blood/Biologics, and MedWatch Safety Alerts. The parser hydrates FDA
page body HTML, keeps full text for display, and tags static databases,
conference/training pages, guidance indexes, and static product-label pages as
`low_value_filtered` before LLM analysis.
The FDA Next.js ingest route tries the direct parser first. If direct FDA raw
fetch fails, it falls back to the configured `FDA_INGEST_URL` NAS bridge and
passes the same `limit`, `dryRun`, `force`, and `sourceUniqueId` options. The
NAS bridge URL and token must not be printed; responses only expose a redacted
bridge host when fallback is attempted.

Nasdaq Trader uses the official trade-halts RSS feed. Short volatility-pause
codes such as `LUDP` and `M` are treated as deterministic ticker archive items
without LLM analysis; material halt codes such as news pending, SEC suspension,
non-compliance, filing delinquency, regulatory concern, and corporate action
remain company-event candidates.

Access Newswire uses the public article HTML parser for individual release
hydration and attempts the same `POST /newsroom/api` endpoint used by the
public newsroom pages for release discovery. Current server-side direct API
requests can return a Cloudflare challenge, so the Next.js ingest route falls
back to the configured `ACCESSWIRE_INGEST_URL` NAS raw bridge when direct raw
fetch fails. The bridge endpoint is expected to return Accesswire raw parser
results only; LLM analysis and DB writes still run in the main Next.js app.
The NAS bridge URL and token must not be printed; responses only expose a
redacted bridge host when fallback is attempted. The deployable bridge lives in
`nas/accesswire-bridge` and exposes `POST /api/accesswire/raw`.
