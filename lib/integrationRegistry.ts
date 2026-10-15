import { envStatus } from "@/lib/env";

export const integrationRegistry = [
  {
    key: "supabase",
    label: "Supabase",
    category: "database",
    envKeys: [
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
    ],
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
    key: "gemini",
    label: "Gemini",
    category: "ai",
    envKeys: ["GEMINI_API_KEY", "GEMINI_MODEL", "NEWS_GEMINI_MODEL"],
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
  {
    key: "snaptrade",
    label: "SnapTrade Brokerage",
    category: "brokerage",
    envKeys: [
      "SNAPTRADE_CLIENT_ID",
      "SNAPTRADE_CONSUMER_KEY",
      "SNAPTRADE_USER_SECRET_ENCRYPTION_KEY",
      "SNAPTRADE_CONNECTIONS_ENABLED",
      "SNAPTRADE_PUBLIC_PROOFS_ENABLED",
    ],
  },
  {
    key: "klipy",
    label: "KLIPY GIF",
    category: "media",
    envKeys: ["KLIPY_API_KEY"],
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
