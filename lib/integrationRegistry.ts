import { envStatus } from "@/lib/env";

export const integrationRegistry = [
  {
    key: "supabase",
    label: "Supabase",
    category: "database",
    envKeys: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"],
  },
  {
    key: "render",
    label: "Render API",
    category: "runtime",
    envKeys: ["APP_BASE_URL"],
  },
  {
    key: "sec",
    label: "SEC EDGAR",
    category: "source",
    envKeys: ["SEC_USER_AGENT"],
  },
  {
    key: "fmp",
    label: "FMP",
    category: "market-data",
    envKeys: ["FMP_API_KEY", "FMP_BATCH_QUOTE_ENABLED"],
  },
  {
    key: "polygon",
    label: "Polygon",
    category: "market-data",
    envKeys: ["POLYGON_API_KEY"],
  },
  {
    key: "openai",
    label: "OpenAI",
    category: "ai",
    envKeys: ["OPENAI_API_KEY", "OPENAI_MODEL"],
  },
  {
    key: "telegram",
    label: "Telegram",
    category: "notification",
    envKeys: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  },
  {
    key: "web_push",
    label: "Web Push",
    category: "notification",
    envKeys: [
      "WEB_PUSH_VAPID_PUBLIC_KEY",
      "WEB_PUSH_VAPID_PRIVATE_KEY",
      "WEB_PUSH_VAPID_SUBJECT",
    ],
  },
  {
    key: "nas_ingest",
    label: "NAS Ingest",
    category: "runtime",
    envKeys: ["NAS_INGEST_TOKEN", "FDA_INGEST_URL", "ACCESSWIRE_INGEST_URL"],
  },
];

export function getIntegrationRegistry() {
  const statuses = envStatus();
  const statusByKey = new Map<string, boolean>(
    statuses.map((status) => [status.key, status.present]),
  );

  return {
    ok: true,
    mode: "read-only",
    integrations: integrationRegistry.map((integration) => ({
      ...integration,
      env: integration.envKeys.map((key) => ({
        key,
        present: statusByKey.get(key) ?? Boolean(process.env[key]),
      })),
    })),
  };
}
