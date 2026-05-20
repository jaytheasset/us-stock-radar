# Telegram Connect Setup

This flow links a user's personal Telegram chat to STOCK RADAR alert delivery.

Required server environment variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`

Register the webhook with Telegram Bot API:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'"
  }'
```

Do not print or commit token/secret values. The webhook route verifies the
`X-Telegram-Bot-Api-Secret-Token` header before accepting updates.

Implementation notes:

- Connect links use one-time tokens.
- The raw token is sent only in the Telegram deep link.
- The database stores only `token_hash`.
- Successful `/start <token>` writes `user_delivery_channels.channel = 'telegram'`.
- `destination` stores the Telegram `chat.id`.
- `metadata` stores Telegram user/chat attributes.
- `verified_at` is set when the chat is linked.
- `enabled` is set to `true` after successful linking.
