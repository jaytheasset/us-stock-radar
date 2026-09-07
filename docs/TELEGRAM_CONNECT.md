# Telegram Connect and Webhook Runbook

The production Telegram webhook is hosted by Vercel Production:

```text
https://us-stock-radar.com/api/telegram/webhook
```

The webhook Route Handler explicitly uses the Node.js runtime. It accepts only
Telegram private-chat updates with the configured secret header. The bot token,
webhook secret, Supabase service-role key, raw connect token, and Telegram chat
ID are server-only values.

## Vercel Production environment

Configure these values for the Vercel **Production** environment:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (preferred)
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`
- `ALERT_DELIVERY_SEND_TELEGRAM=true` only when real Telegram delivery is approved

Do not use a `NEXT_PUBLIC_` prefix for any secret. Environment changes apply only
to a new Vercel deployment, so redeploy before webhook validation.

## Connection contract

- Telegram is available only to Pro, Advanced, and Ultimate members.
- Connect and Change account links expire after 15 minutes and are one-use.
- Only the SHA-256 token hash is stored; the raw token exists only in the deep link.
- A member has at most one Telegram delivery-channel row.
- A non-empty Telegram private-chat destination can belong to only one member.
- Change account leaves the existing connection untouched until the new `/start`
  token is claimed and the new private chat passes ownership checks.
- ON/OFF pauses delivery without unlinking the account.
- Disconnect deletes the member's Telegram destination, metadata, verification
  timestamp, enabled state, and outstanding unused connection tokens.
- Browser responses expose only `Connected` or a validated `Connected · @username`
  label. They never expose the Telegram chat ID.

## Secret-safe webhook commands

Run these commands only in a private operator shell where the required values are
already environment variables. Do not paste values into history, screenshots,
tickets, or logs.

```powershell
$telegramApi = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)"
$productionWebhook = "https://us-stock-radar.com/api/telegram/webhook"
$payload = @{
  url = $productionWebhook
  secret_token = $env:TELEGRAM_WEBHOOK_SECRET
  allowed_updates = @("message", "callback_query")
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$telegramApi/setWebhook" -ContentType "application/json" -Body $payload
$info = Invoke-RestMethod -Method Get -Uri "$telegramApi/getWebhookInfo"
$info.result | Select-Object url, pending_update_count, last_error_date, last_error_message
```

Expected `url`:

```text
https://us-stock-radar.com/api/telegram/webhook
```

Do not print `$telegramApi`, `$payload`, or any environment variable value.

## Prelaunch local end-to-end test

Telegram supports one webhook URL per bot. During prelaunch, the production bot
may be pointed temporarily at an approved HTTPS tunnel for the isolated local QA
server. This diverts bot updates away from Production, so use a short announced
test window.

1. Start the isolated local app on a port that does not affect shared port 3110.
2. Start an HTTPS tunnel to that port and record only its public host.
3. Set `$localWebhook` to `https://<temporary-host>/api/telegram/webhook`.
4. Reuse the `setWebhook` payload above with `url = $localWebhook`.
5. Call `getWebhookInfo`; verify the tunnel URL and no recent webhook error.
6. Test Connect, duplicate rejection, Change account, ON/OFF, Disconnect,
   reconnect, expired/reused links, and non-private-chat ignore behavior.
7. In a cleanup step, restore the exact Production URL and call
   `getWebhookInfo` again.
8. Do not end the test window until the Production URL is restored and verified.

No webhook or Vercel environment change is performed by repository tests or this
runbook itself.

## Bot command menu

The implemented private-chat commands are `/stock`, `/watchlist`, `/rooms`,
`/room`, `/settings`, and `/help`. Preview the command registration
without network access or bot changes:

```powershell
npm run telegram:commands
```

For an explicitly approved operating window, set the bot token in the private
operator shell and require both write gates:

```powershell
$env:TELEGRAM_BOT_COMMANDS_WRITE_ENABLED = "true"
npm run telegram:commands -- --apply
```

The script registers the menu only for private chats. It never prints the bot
token or request URL. Do not run `--apply` during ordinary development or tests.

References:

- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Vercel Functions runtimes](https://vercel.com/docs/functions/runtimes)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Telegram Bot API setWebhook](https://core.telegram.org/bots/api#setwebhook)
