import {
  resolveSupabasePublishableKey,
  resolveSupabaseSecretKey,
} from "./supabaseKeys.ts";

const serverKeys = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "APP_BASE_URL",
  "SEC_USER_AGENT",
  "POLYGON_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_PUBLIC_CHANNEL_ID",
  "ALERT_DELIVERY_CRON_SECRET",
  "ALERT_DELIVERY_CRON_WRITE_ENABLED",
  "ALERT_DELIVERY_SEND_TELEGRAM",
  "ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC",
  "ALERT_DELIVERY_SEND_EMAIL",
  "RESEND_API_KEY",
  "ALERT_EMAIL_FROM",
  "ALERT_EMAIL_REPLY_TO",
  "RESEND_WEBHOOK_SECRET",
  "ALERT_EMAIL_UNSUBSCRIBE_SECRET",
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
  "SNAPTRADE_CLIENT_ID",
  "SNAPTRADE_CONSUMER_KEY",
  "SNAPTRADE_USER_SECRET_ENCRYPTION_KEY",
  "SNAPTRADE_CONNECTIONS_ENABLED",
  "SNAPTRADE_PUBLIC_PROOFS_ENABLED",
  "SNAPTRADE_MOCK_ENABLED",
  "SNAPTRADE_SANDBOX_BROKER",
  "SNAPTRADE_MANUAL_REFRESH_MONTHLY_LIMIT",
  "SNAPTRADE_MANUAL_REFRESH_COOLDOWN_SECONDS",
  "SNAPTRADE_MANUAL_REFRESH_ESTIMATED_COST_CENTS",
  "KLIPY_API_KEY",
] as const;

export function getServerEnv(
  environment: Record<string, string | undefined> = process.env,
) {
  const publishableKey = resolveSupabasePublishableKey(environment);
  const secretKey = resolveSupabaseSecretKey(environment);
  return {
    supabaseUrl: environment.SUPABASE_URL || "",
    supabaseSecretKey: secretKey.key,
    supabaseSecretKeySource: secretKey.source,
    supabaseSecretKeyError: secretKey.error,
    supabasePublishableKey: publishableKey.key,
    supabasePublishableKeySource: publishableKey.source,
    supabasePublishableKeyError: publishableKey.error,
    appBaseUrl: process.env.APP_BASE_URL || "",
    secUserAgent: process.env.SEC_USER_AGENT || "",
    polygonApiKey: process.env.POLYGON_API_KEY || "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || "",
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    telegramPublicChannelId: process.env.TELEGRAM_PUBLIC_CHANNEL_ID || "",
    alertDeliveryCronSecret: process.env.ALERT_DELIVERY_CRON_SECRET || "",
    alertDeliveryCronWriteEnabled:
      (process.env.ALERT_DELIVERY_CRON_WRITE_ENABLED || "false").toLowerCase() === "true",
    alertDeliverySendTelegram:
      (process.env.ALERT_DELIVERY_SEND_TELEGRAM || "false").toLowerCase() === "true",
    alertDeliverySendTelegramPublic:
      (process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC || "false").toLowerCase() === "true",
    alertDeliverySendEmail:
      (process.env.ALERT_DELIVERY_SEND_EMAIL || "false").toLowerCase() === "true",
    resendApiKey: process.env.RESEND_API_KEY || "",
    alertEmailFrom: process.env.ALERT_EMAIL_FROM || "",
    alertEmailReplyTo: process.env.ALERT_EMAIL_REPLY_TO || "",
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",
    alertEmailUnsubscribeSecret: process.env.ALERT_EMAIL_UNSUBSCRIBE_SECRET || "",
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
    snaptradeClientId: process.env.SNAPTRADE_CLIENT_ID || "",
    snaptradeConsumerKey: process.env.SNAPTRADE_CONSUMER_KEY || "",
    snaptradeUserSecretEncryptionKey:
      process.env.SNAPTRADE_USER_SECRET_ENCRYPTION_KEY || "",
    snaptradeConnectionsEnabled:
      (process.env.SNAPTRADE_CONNECTIONS_ENABLED || "false").toLowerCase() === "true",
    snaptradePublicProofsEnabled:
      (process.env.SNAPTRADE_PUBLIC_PROOFS_ENABLED || "false").toLowerCase() === "true",
    snaptradeMockEnabled:
      process.env.NODE_ENV !== "production" &&
      (process.env.SNAPTRADE_MOCK_ENABLED || "false").toLowerCase() === "true",
    snaptradeSandboxBroker:
      process.env.NODE_ENV !== "production" &&
      (process.env.SNAPTRADE_SANDBOX_BROKER || "").toUpperCase() === "SANDBOX"
        ? "SANDBOX"
        : "",
    snaptradeManualRefreshMonthlyLimit:
      Number(process.env.SNAPTRADE_MANUAL_REFRESH_MONTHLY_LIMIT) || 20,
    snaptradeManualRefreshCooldownSeconds:
      Number(process.env.SNAPTRADE_MANUAL_REFRESH_COOLDOWN_SECONDS) || 600,
    snaptradeManualRefreshEstimatedCostCents:
      Number(process.env.SNAPTRADE_MANUAL_REFRESH_ESTIMATED_COST_CENTS) || 5,
    klipyApiKey: process.env.KLIPY_API_KEY || "",
  };
}

export function envStatus() {
  const values = getServerEnv();
  const lookup: Record<(typeof serverKeys)[number], string> = {
    SUPABASE_URL: values.supabaseUrl,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || "",
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    APP_BASE_URL: values.appBaseUrl,
    SEC_USER_AGENT: values.secUserAgent,
    POLYGON_API_KEY: values.polygonApiKey,
    TELEGRAM_BOT_TOKEN: values.telegramBotToken,
    TELEGRAM_BOT_USERNAME: values.telegramBotUsername,
    TELEGRAM_WEBHOOK_SECRET: values.telegramWebhookSecret,
    TELEGRAM_CHAT_ID: values.telegramChatId,
    TELEGRAM_PUBLIC_CHANNEL_ID: values.telegramPublicChannelId,
    ALERT_DELIVERY_CRON_SECRET: values.alertDeliveryCronSecret,
    ALERT_DELIVERY_CRON_WRITE_ENABLED: String(values.alertDeliveryCronWriteEnabled),
    ALERT_DELIVERY_SEND_TELEGRAM: String(values.alertDeliverySendTelegram),
    ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC: String(
      values.alertDeliverySendTelegramPublic,
    ),
    ALERT_DELIVERY_SEND_EMAIL: String(values.alertDeliverySendEmail),
    RESEND_API_KEY: values.resendApiKey,
    ALERT_EMAIL_FROM: values.alertEmailFrom,
    ALERT_EMAIL_REPLY_TO: values.alertEmailReplyTo,
    RESEND_WEBHOOK_SECRET: values.resendWebhookSecret,
    ALERT_EMAIL_UNSUBSCRIBE_SECRET: values.alertEmailUnsubscribeSecret,
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
    SNAPTRADE_CLIENT_ID: values.snaptradeClientId,
    SNAPTRADE_CONSUMER_KEY: values.snaptradeConsumerKey,
    SNAPTRADE_USER_SECRET_ENCRYPTION_KEY:
      values.snaptradeUserSecretEncryptionKey,
    SNAPTRADE_CONNECTIONS_ENABLED: String(values.snaptradeConnectionsEnabled),
    SNAPTRADE_PUBLIC_PROOFS_ENABLED: String(
      values.snaptradePublicProofsEnabled,
    ),
    SNAPTRADE_MOCK_ENABLED: String(values.snaptradeMockEnabled),
    SNAPTRADE_SANDBOX_BROKER: values.snaptradeSandboxBroker,
    SNAPTRADE_MANUAL_REFRESH_MONTHLY_LIMIT: String(
      values.snaptradeManualRefreshMonthlyLimit,
    ),
    SNAPTRADE_MANUAL_REFRESH_COOLDOWN_SECONDS: String(
      values.snaptradeManualRefreshCooldownSeconds,
    ),
    SNAPTRADE_MANUAL_REFRESH_ESTIMATED_COST_CENTS: String(
      values.snaptradeManualRefreshEstimatedCostCents,
    ),
    KLIPY_API_KEY: values.klipyApiKey,
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
