# Company Live Room functional Mock

## Product boundary

- A room belongs to one company, not one event. Every eligible entry point
  routes to `/live/[ticker]`.
- `CompanyRoomKey` already accepts either `issuer_id` or `ticker_fallback`.
  The Mock uses the ticker fallback; production should resolve and persist a
  stable issuer/company ID before opening the realtime channel.
- Market-wide news without a resolvable ticker does not render a Live Room
  entry.
- The room header shows the company's newest news or filing. Mentioning an
  older event attaches only `eventId`, kind, and title to a message.

## Adapter and persistence decisions

- Existing read-only profile and event APIs provide company metadata and
  events when available. Deterministic Mock data keeps local development
  usable when those APIs or environment variables are unavailable.
- `LiveRoomMessageRepository` is the UI boundary for a future Supabase
  Realtime or other transport. The current in-memory adapter resets all
  messages on refresh and does not write to a database or browser storage.
- Guest profile and emoji use localStorage. They are always treated as a
  temporary `Free` guest profile and are never written to an account.
- Room Follow uses localStorage and is keyed by `CompanyRoomKey`. Its contract
  supports `company_updates_only` and `all_room_messages`; the Mock stores
  `company_updates_only` and intentionally has no settings screen.
- Follow does not send notifications. Account sync, push, and email delivery
  remain production work.

## Client moderation simulation

`ModerationDecision` is independent from the UI so the same outcomes can later
come from a server-enforced policy. The Mock explains and preserves the draft
for:

- empty messages;
- more than 600 characters;
- three prior sends within 20 seconds;
- the same normalized content within two minutes;
- configured blocked phrases;
- more than two links.

This is not a security control. A user can bypass the browser policy.

## Production moderation recommendations

The realtime implementation should enforce policy on the server before
broadcasting a message:

1. Apply per-user, per-room, and IP-aware rate limits with retry metadata.
2. Keep canonical blocked-content and link policies on the server.
3. Add report, mute, and block workflows with moderator review.
4. Use graduated actions: warning, temporary slow mode, temporary suspension,
   then account restriction.
5. Record append-only audit events for decisions and moderator actions while
   limiting retained personal data.
6. Treat link previews and attachments as untrusted content.

## Realtime work left

- Resolve ticker to a stable issuer ID on the server.
- Authenticate room participants and derive their real plan from the existing
  subscription contract.
- Replace the in-memory repository with durable message history and a realtime
  subscription adapter.
- Enforce moderation and authorization server-side.
- Sync Follow to accounts and add explicit notification preferences and
  delivery channels.
- Add pagination, reconnect/catch-up behavior, presence only if it is real and
  useful, reporting, moderation tooling, and retention controls.
