import { taxonomyCanonicalTables } from "@/lib/taxonomyRegistry";

export type DbColumn = {
  name: string;
  type: string;
  required?: boolean;
  notes: string;
};

export type CanonicalTable = {
  name: string;
  group: "core" | "notification" | "ai" | "admin" | "taxonomy";
  status: "draft" | "required" | "later";
  purpose: string;
  columns: DbColumn[];
};

export const eventScoringPolicy = {
  score: [
    { range: "0-49", deliveryLevel: "archive", notes: "Store only, no main feed or alert." },
    { range: "50-74", deliveryLevel: "feed", notes: "Visible in feed, no alert by default." },
    { range: "75-100", deliveryLevel: "alert", notes: "Eligible for subscriber delivery." },
  ],
  impact: ["high", "medium", "low"],
  signal: ["bullish", "bearish", "volatile", "neutral"],
};

export const liveFeedEventFieldContract = [
  {
    field: "source_group",
    canonical: "events.source_group",
    legacyFallback: "events.metadata.source_group, then source_code/event_type heuristic",
    usage: "Live Feed tabs, notification filters, cross-source dedupe scope.",
  },
  {
    field: "quick_take",
    canonical: "events.quick_take",
    legacyFallback: "events.metadata.quick_take, then events.summary",
    usage: "One-line text under the feed headline.",
  },
  {
    field: "score",
    canonical: "events.score",
    legacyFallback: "events.metadata.score/event_score/alert_score, then impact + confidence derived score",
    usage: "Ranking and delivery threshold calculation.",
  },
  {
    field: "delivery_level",
    canonical: "events.delivery_level",
    legacyFallback: "events.metadata.delivery_level or events.metadata.alert_policy.visibility, then score thresholds",
    usage: "Archive/feed/alert visibility and alert tab filtering.",
  },
  {
    field: "signal",
    canonical: "events.signal",
    legacyFallback: "events.metadata.signal, events.market_direction, or events.direction",
    usage: "Bullish/bearish/volatile/neutral UI badge and filters.",
  },
];

export const taxonomyTickerFlow = [
  {
    step: "1",
    table: "tickers",
    purpose: "Stores raw FMP sector/industry for each symbol.",
  },
  {
    step: "2",
    table: "fmp_industry_mappings",
    purpose: "Maps raw FMP industry into our sector and sub-category tree.",
  },
  {
    step: "3",
    table: "ticker_classifications",
    purpose: "Stores the current ticker-to-sector/sub-category assignment, including manual overrides.",
  },
  {
    step: "4",
    table: "market_group_snapshots",
    purpose: "Caches sector/sub-category performance and top symbols for Market tab and value-map UI.",
  },
];

export const canonicalTables: CanonicalTable[] = [
  {
    name: "sources",
    group: "core",
    status: "required",
    purpose: "Source catalog and runtime ownership.",
    columns: [
      column("code", "text", "Stable source code such as accesswire or sec_edgar", true),
      column("name", "text", "Human display name", true),
      column("source_group", "text", "news, filings, or market", true),
      column("runtime_owner", "text", "render, nas, external, or manual", true),
      column("enabled", "boolean", "Source on/off flag", true),
      column("poll_interval_seconds", "integer", "Expected cadence"),
      column("metadata", "jsonb", "Source-specific settings and notes"),
    ],
  },
  {
    name: "event_types",
    group: "taxonomy",
    status: "required",
    purpose: "Canonical event_type registry used by feed badges, alert filters, and parser output.",
    columns: [
      column("code", "text", "Stable event_type key stored on events.event_type", true),
      column("label", "text", "User-facing badge label", true),
      column("category", "text", "Admin grouping such as Earnings, Dilution / Offering, or Risk", true),
      column("badge_tone", "text", "UI tone: general, earnings, dilution, risk, deal, clinical, regulatory, market", true),
      column("source_groups", "text[]", "news, filings, and/or market groups where this type can appear", true),
      column("status", "text", "active or planned", true),
      column("covered_forms", "text[]", "SEC forms currently mapped to this type"),
      column("description", "text", "Classification meaning"),
      column("examples", "jsonb", "Short examples for parser and admin review"),
      column("metadata", "jsonb", "Future rule ids, prompt ids, and migration notes"),
    ],
  },
  {
    name: "source_runs",
    group: "core",
    status: "required",
    purpose: "One execution of a source job.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("source_code", "text", "References sources.code", true),
      column("source_group", "text", "Copied from sources.source_group for filtering and audit", true),
      column("run_type", "text", "manual, cron, ingest, dry_run, etc.", true),
      column("status", "text", "queued, running, completed, failed, skipped", true),
      column("started_at", "timestamptz", "Run start time", true),
      column("finished_at", "timestamptz", "Run finish time"),
      column("stats", "jsonb", "Fetched counts, event counts, delivery counts"),
      column("error_message", "text", "Failure text if any"),
      column("metadata", "jsonb", "Parser version, runtime info, source-specific trace"),
    ],
  },
  {
    name: "raw_items",
    group: "core",
    status: "required",
    purpose: "Raw article, filing, press release, feed item, or government release.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("run_id", "uuid", "References source_runs.id"),
      column("source_code", "text", "References sources.code", true),
      column("source_group", "text", "news, filings, or market", true),
      column("source_unique_id", "text", "Source-side stable id when available"),
      column("source_url", "text", "Original URL"),
      column("title", "text", "Original title"),
      column("published_at", "timestamptz", "Source publication time"),
      column("fetched_at", "timestamptz", "Fetch time", true),
      column("body_text", "text", "Parsed text body"),
      column("raw_payload", "jsonb", "Raw source payload and parse trace"),
      column("dedupe_key", "text", "Raw item dedupe key"),
    ],
  },
  {
    name: "events",
    group: "core",
    status: "required",
    purpose: "Normalized investable events extracted from raw items.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("raw_item_id", "uuid", "References raw_items.id"),
      column("source_code", "text", "References sources.code", true),
      column("source_group", "text", "news, filings, or market", true),
      column("ticker", "text", "Ticker if event maps to a company"),
      column("market", "text", "Exchange or venue label"),
      column("event_type", "text", "Normalized event type", true),
      column("score", "integer", "0-100 scoring value used to derive delivery_level", true),
      column("delivery_level", "text", "archive when score < 50, feed when 50-74, alert when >= 75", true),
      column("impact", "text", "high, medium, or low", true),
      column("signal", "text", "bullish, bearish, volatile, or neutral", true),
      column("title", "text", "User-facing title", true),
      column("quick_take", "text", "One-line feed card takeaway shown under the title"),
      column("summary", "text", "Longer event summary for detail pages"),
      column("reason", "text", "Why the event matters"),
      column("event_date", "date", "Business/event date when known"),
      column("detected_at", "timestamptz", "Detection time", true),
      column("group_dedupe_key", "text", "Unique only inside the same source_group", true),
      column("cross_group_event_key", "text", "Linking key for same underlying event across groups; never suppresses alerts by itself"),
      column("metadata", "jsonb", "Parser, LLM, extracted facts, and source-specific data"),
    ],
  },
  {
    name: "event_links",
    group: "core",
    status: "required",
    purpose: "Links same underlying event across source groups without merging rows or suppressing alerts.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("left_event_id", "uuid", "References events.id", true),
      column("right_event_id", "uuid", "References events.id", true),
      column("link_type", "text", "same_underlying_event, follow_up, correction, related", true),
      column("link_confidence", "text", "high, medium, low"),
      column("created_at", "timestamptz", "Creation time", true),
      column("metadata", "jsonb", "Linking evidence and trace"),
    ],
  },
  {
    name: "market_snapshots",
    group: "core",
    status: "required",
    purpose: "FMP, Polygon, and other market context snapshots.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("ticker", "text", "Ticker", true),
      column("price", "numeric", "Latest price"),
      column("market_cap", "numeric", "Market cap"),
      column("float_shares", "numeric", "Public float when available"),
      column("shares_outstanding", "numeric", "Shares outstanding when available"),
      column("volume", "numeric", "Volume"),
      column("avg_volume", "numeric", "Average volume"),
      column("source", "text", "fmp, polygon, yahoo, etc.", true),
      column("fetched_at", "timestamptz", "Fetch time", true),
      column("raw_payload", "jsonb", "Provider response"),
    ],
  },
  {
    name: "dedupe_keys",
    group: "core",
    status: "required",
    purpose: "Cross-run dedupe tracking scoped by source_group, never global news-vs-filing suppression.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("source_group", "text", "news, filings, or market", true),
      column("source_code", "text", "Source code", true),
      column("scope", "text", "source, raw_item, event, delivery", true),
      column("dedupe_key", "text", "Stable dedupe key", true),
      column("created_at", "timestamptz", "Creation time", true),
      column("expires_at", "timestamptz", "Optional expiry"),
    ],
  },
  {
    name: "notification_subscriptions",
    group: "notification",
    status: "required",
    purpose: "Telegram chats, web push subscriptions, and future notification recipients.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("channel", "text", "telegram, web_push, email, etc.", true),
      column("destination_code", "text", "telegram_primary, browser_default, etc.", true),
      column("recipient_ref", "text", "Masked or referenced destination id"),
      column("enabled", "boolean", "Subscription active flag", true),
      column("filters", "jsonb", "source_groups, source_codes, tickers, event_types, delivery_levels, impacts, signals", true),
      column("created_at", "timestamptz", "Creation time", true),
      column("updated_at", "timestamptz", "Update time"),
      column("last_seen_at", "timestamptz", "Last active time"),
      column("metadata", "jsonb", "Channel-specific subscription payload"),
    ],
  },
  {
    name: "deliveries",
    group: "notification",
    status: "required",
    purpose: "Telegram, Web Push, and future delivery attempts in one table.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("event_id", "uuid", "References events.id", true),
      column("subscription_id", "uuid", "References notification_subscriptions.id"),
      column("channel", "text", "telegram, web_push, email, etc.", true),
      column("destination_code", "text", "Delivery destination label"),
      column("status", "text", "pending, sent, failed, skipped", true),
      column("attempted_at", "timestamptz", "Attempt time"),
      column("sent_at", "timestamptz", "Successful send time"),
      column("error_message", "text", "Failure text"),
      column("provider_message_id", "text", "Telegram message id, push id, etc."),
      column("metadata", "jsonb", "Provider response, filter result, and delivery trace"),
    ],
  },
  {
    name: "prompt_templates",
    group: "ai",
    status: "draft",
    purpose: "Versioned LLM prompt registry.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("key", "text", "Stable prompt key", true),
      column("version", "text", "Prompt version", true),
      column("task", "text", "press_release_analysis, sec_filing_analysis, etc.", true),
      column("model", "text", "Default model"),
      column("is_active", "boolean", "Active version flag", true),
      column("template", "text", "Prompt body"),
      column("metadata", "jsonb", "Schema, examples, validation notes"),
    ],
  },
  {
    name: "ai_runs",
    group: "ai",
    status: "draft",
    purpose: "One LLM request or batch run.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("event_id", "uuid", "Optional event reference"),
      column("raw_item_id", "uuid", "Optional raw item reference"),
      column("prompt_key", "text", "Prompt key", true),
      column("prompt_version", "text", "Prompt version", true),
      column("model", "text", "Model used", true),
      column("status", "text", "completed, failed, skipped", true),
      column("started_at", "timestamptz", "Start time"),
      column("finished_at", "timestamptz", "Finish time"),
      column("usage", "jsonb", "Token usage"),
      column("error_message", "text", "Failure text"),
      column("metadata", "jsonb", "Request trace"),
    ],
  },
  {
    name: "ai_outputs",
    group: "ai",
    status: "draft",
    purpose: "Structured LLM output separate from events when needed.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("ai_run_id", "uuid", "References ai_runs.id", true),
      column("event_id", "uuid", "Optional event reference"),
      column("output_type", "text", "summary, extracted_facts, risk_flags, etc.", true),
      column("payload", "jsonb", "Structured output", true),
      column("created_at", "timestamptz", "Creation time", true),
    ],
  },
  {
    name: "integration_configs",
    group: "admin",
    status: "later",
    purpose: "Read-out registry for external providers and safe config state.",
    columns: [
      column("key", "text", "Provider key such as fmp or polygon", true),
      column("label", "text", "Display label", true),
      column("enabled", "boolean", "Enabled flag", true),
      column("metadata", "jsonb", "Non-secret settings only"),
    ],
  },
  {
    name: "schema_versions",
    group: "admin",
    status: "later",
    purpose: "Applied schema version and migration history.",
    columns: [
      column("version", "text", "Schema version", true),
      column("description", "text", "Migration description"),
      column("applied_at", "timestamptz", "Applied time", true),
      column("metadata", "jsonb", "Migration metadata"),
    ],
  },
  {
    name: "audit_logs",
    group: "admin",
    status: "later",
    purpose: "Admin actions and configuration changes.",
    columns: [
      column("id", "uuid", "Primary key", true),
      column("actor", "text", "User or system actor"),
      column("action", "text", "Action name", true),
      column("target_type", "text", "sources, prompts, deliveries, etc."),
      column("target_id", "text", "Target id"),
      column("created_at", "timestamptz", "Creation time", true),
      column("metadata", "jsonb", "Change details without secrets"),
    ],
  },
  ...taxonomyCanonicalTables,
];

export const currentReferenceTables = [
  "source_configs",
  "source_runs",
  "articles",
  "article_bodies",
  "events",
  "seen_items",
  "telegram_deliveries",
  "market_data_cache",
  "web_push_subscriptions",
  "notification_delivery_logs",
];

function column(name: string, type: string, notes: string, required = false): DbColumn {
  return {
    name,
    type,
    notes,
    required,
  };
}
