const serverKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "APP_BASE_URL",
  "SEC_USER_AGENT",
  "FMP_API_KEY",
  "FMP_BATCH_QUOTE_ENABLED",
  "POLYGON_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_VAPID_SUBJECT",
  "NAS_BASE_URL",
  "NAS_INGEST_TOKEN",
  "FDA_INGEST_URL",
  "ACCESSWIRE_INGEST_URL",
] as const;

export function getServerEnv() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    appBaseUrl: process.env.APP_BASE_URL || "",
    secUserAgent: process.env.SEC_USER_AGENT || "",
    fmpApiKey: process.env.FMP_API_KEY || "",
    fmpBatchQuoteEnabled:
      (process.env.FMP_BATCH_QUOTE_ENABLED || "false").toLowerCase() === "true",
    polygonApiKey: process.env.POLYGON_API_KEY || "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiModel: process.env.OPENAI_MODEL || "gpt-5-mini",
    webPushVapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "",
    webPushVapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "",
    webPushVapidSubject: process.env.WEB_PUSH_VAPID_SUBJECT || "",
    nasBaseUrl: process.env.NAS_BASE_URL || "",
    nasIngestToken: process.env.NAS_INGEST_TOKEN || "",
    fdaIngestUrl: process.env.FDA_INGEST_URL || "",
    accesswireIngestUrl: process.env.ACCESSWIRE_INGEST_URL || "",
  };
}

export function envStatus() {
  const values = getServerEnv();
  const lookup: Record<(typeof serverKeys)[number], string> = {
    SUPABASE_URL: values.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: values.supabaseServiceRoleKey,
    SUPABASE_ANON_KEY: values.supabaseAnonKey,
    APP_BASE_URL: values.appBaseUrl,
    SEC_USER_AGENT: values.secUserAgent,
    FMP_API_KEY: values.fmpApiKey,
    FMP_BATCH_QUOTE_ENABLED: String(values.fmpBatchQuoteEnabled),
    POLYGON_API_KEY: values.polygonApiKey,
    TELEGRAM_BOT_TOKEN: values.telegramBotToken,
    TELEGRAM_CHAT_ID: values.telegramChatId,
    OPENAI_API_KEY: values.openAiApiKey,
    OPENAI_MODEL: values.openAiModel,
    WEB_PUSH_VAPID_PUBLIC_KEY: values.webPushVapidPublicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: values.webPushVapidPrivateKey,
    WEB_PUSH_VAPID_SUBJECT: values.webPushVapidSubject,
    NAS_BASE_URL: values.nasBaseUrl,
    NAS_INGEST_TOKEN: values.nasIngestToken,
    FDA_INGEST_URL: values.fdaIngestUrl,
    ACCESSWIRE_INGEST_URL: values.accesswireIngestUrl,
  };

  return serverKeys.map((key) => ({
    key,
    present: Boolean(lookup[key]),
  }));
}

export function redactUrl(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "[invalid-url]";
  }
}
