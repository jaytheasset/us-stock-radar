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
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_CHAT_ID",
  "ALERT_DELIVERY_CRON_SECRET",
  "ALERT_DELIVERY_CRON_WRITE_ENABLED",
  "DASHBOARD_MOVERS_CRON_SECRET",
  "CRON_SECRET",
  "SOURCE_INGEST_WORKFLOW_ENABLED_LANES",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "NEWS_GEMINI_MODEL",
  "SEC_OWNERSHIP_GEMINI_MODEL",
  "SEC_PROXY_ROUTINE_GEMINI_MODEL",
  "SEC_NT_GEMINI_MODEL",
  "SEC_FORM25_GEMINI_MODEL",
  "SEC_ANALYSIS_LLM_PROVIDER",
  "SEC_ANALYSIS_ALLOW_OPENAI",
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
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || "",
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    alertDeliveryCronSecret: process.env.ALERT_DELIVERY_CRON_SECRET || "",
    alertDeliveryCronWriteEnabled:
      (process.env.ALERT_DELIVERY_CRON_WRITE_ENABLED || "false").toLowerCase() === "true",
    dashboardMoversCronSecret:
      process.env.DASHBOARD_MOVERS_CRON_SECRET || "",
    cronSecret: process.env.CRON_SECRET || "",
    sourceIngestWorkflowEnabledLanes:
      process.env.SOURCE_INGEST_WORKFLOW_ENABLED_LANES || "",
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiModel: process.env.OPENAI_MODEL || "gpt-5-mini",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    newsGeminiModel: process.env.NEWS_GEMINI_MODEL || "gemini-2.5-flash-lite",
    secOwnershipGeminiModel: process.env.SEC_OWNERSHIP_GEMINI_MODEL || "gemini-2.5-flash-lite",
    secProxyRoutineGeminiModel: process.env.SEC_PROXY_ROUTINE_GEMINI_MODEL || "gemini-2.5-flash-lite",
    secNtGeminiModel: process.env.SEC_NT_GEMINI_MODEL || "gemini-2.5-flash-lite",
    secForm25GeminiModel: process.env.SEC_FORM25_GEMINI_MODEL || "gemini-2.5-flash-lite",
    secAnalysisLlmProvider: process.env.SEC_ANALYSIS_LLM_PROVIDER || "gemini",
    secAnalysisAllowOpenAi:
      (process.env.SEC_ANALYSIS_ALLOW_OPENAI || "false").toLowerCase() === "true",
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
    TELEGRAM_BOT_USERNAME: values.telegramBotUsername,
    TELEGRAM_WEBHOOK_SECRET: values.telegramWebhookSecret,
    TELEGRAM_CHAT_ID: values.telegramChatId,
    ALERT_DELIVERY_CRON_SECRET: values.alertDeliveryCronSecret,
    ALERT_DELIVERY_CRON_WRITE_ENABLED: String(values.alertDeliveryCronWriteEnabled),
    DASHBOARD_MOVERS_CRON_SECRET: values.dashboardMoversCronSecret,
    CRON_SECRET: values.cronSecret,
    SOURCE_INGEST_WORKFLOW_ENABLED_LANES:
      values.sourceIngestWorkflowEnabledLanes,
    OPENAI_API_KEY: values.openAiApiKey,
    OPENAI_MODEL: values.openAiModel,
    GEMINI_API_KEY: values.geminiApiKey,
    GEMINI_MODEL: values.geminiModel,
    NEWS_GEMINI_MODEL: values.newsGeminiModel,
    SEC_OWNERSHIP_GEMINI_MODEL: values.secOwnershipGeminiModel,
    SEC_PROXY_ROUTINE_GEMINI_MODEL: values.secProxyRoutineGeminiModel,
    SEC_NT_GEMINI_MODEL: values.secNtGeminiModel,
    SEC_FORM25_GEMINI_MODEL: values.secForm25GeminiModel,
    SEC_ANALYSIS_LLM_PROVIDER: values.secAnalysisLlmProvider,
    SEC_ANALYSIS_ALLOW_OPENAI: String(values.secAnalysisAllowOpenAi),
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
