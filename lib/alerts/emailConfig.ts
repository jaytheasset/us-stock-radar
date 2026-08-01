import "server-only";

import { getServerEnv } from "@/lib/env";

export function getAlertEmailConfig() {
  const env = getServerEnv();
  const configured = Boolean(
    env.resendApiKey &&
      env.alertEmailFrom &&
      env.appBaseUrl &&
      env.resendWebhookSecret &&
      env.alertEmailUnsubscribeSecret,
  );
  return {
    configured,
    sendingEnabled: configured && env.alertDeliverySendEmail,
    apiKey: env.resendApiKey,
    from: env.alertEmailFrom,
    replyTo: env.alertEmailReplyTo,
    webhookSecret: env.resendWebhookSecret,
    unsubscribeSecret: env.alertEmailUnsubscribeSecret,
    appBaseUrl: env.appBaseUrl,
  };
}
