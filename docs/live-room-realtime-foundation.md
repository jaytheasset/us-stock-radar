# Live Room realtime and moderation foundation

## Server-owned browser contract

Live Rooms are keyed by normalized company ticker. `issuer_id` remains nullable
and uniquely indexed so a later canonical issuer migration can move room
identity without changing the URL contract.

The browser talks to same-origin Next.js routes:

- `GET/POST /api/live-room/[ticker]/messages`
- `GET/PUT /api/live-room/[ticker]/follow`
- `GET/PUT /api/live-room/profile`
- `POST /api/live-room/[ticker]/reports`
- `GET/POST /api/live-room/[ticker]/blocks`
- `DELETE /api/live-room/[ticker]/blocks/[blockId]`
- `GET/POST /api/live-room/[ticker]/moderation` (moderators only)

The server resolves the member from existing HttpOnly Supabase session cookies,
or creates a random 256-bit guest token in a separate HttpOnly, SameSite cookie.
The database stores only its SHA-256 digest. Browser payloads never supply
actor IDs, member/guest IDs, plan snapshots, or moderation state.

Member plan badges are read from `user_plan_subscriptions` through the existing
effective-plan service when a message is sent. The resulting server-owned
snapshot is stored with the message.

## Realtime Broadcast and fallback

`20260727200000_live_room_realtime_moderation.sql` replaces the four-second
message polling loop with a database-triggered Broadcast signal. The hardened
private trigger function calls:

```sql
realtime.send(
  jsonb_build_object('roomId', ..., 'messageId', ..., 'action', ...),
  'live-room-changed',
  'live-room:' || ticker,
  false
)
```

The final `false` makes the topic public. This is intentional because Live Room
readers include browser guests without Supabase Auth JWTs. The project must
keep **Allow public access** enabled in Realtime settings. No
`realtime.messages` authorization policy is needed for this public channel.

The signal is an untrusted refresh hint, not message data:

- it contains only room ID, message ID, and action;
- it never includes a body, profile, member/guest ID, or actor ID;
- the browser re-fetches visible data from the same-origin Live Room API;
- public signal bursts are debounced before an API refresh;
- a change cursor based on `(updated_at, id)` recovers inserts, hides, and
  restores missed during a disconnect;
- a visibility-aware 45-second poll runs as a low-frequency backstop;
- reconnecting and returning to a visible tab trigger immediate catch-up.

The browser receives only `SUPABASE_URL` and the publishable/legacy anon key
through a server component prop. `SUPABASE_SERVICE_ROLE_KEY` remains
server-only.

`@supabase/supabase-js` is pinned to `2.109.0`, the newest release compatible
with this project's Node `>=20` contract. Current `2.110.0+` releases require
Node 22, matching the July 2026 deprecation/breaking-change notices. Upgrade the
project runtime before advancing the package.

Relevant reviewed guidance:

- [Supabase changelog](https://supabase.com/changelog.md)
- [Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)

The July 27, 2026 review accounted for changes that restrict custom objects in
the `realtime` schema and stop automatically exposing new public tables to the
Data API. The migration creates no custom Realtime object. Every new public
table has RLS enabled; `PUBLIC`, `anon`, and `authenticated` privileges are
revoked; only `service_role` is granted access.

## Reporting, blocking, and soft moderation

The migration adds:

- `live_room_message_reports`, with an allowlisted reason and one report per
  message/reporter actor;
- `live_room_actor_blocks`, with message-ID target resolution, self-block
  rejection, and display snapshots for the unblock UI;
- `live_room_moderators`, the trusted service-only role source;
- `live_room_moderation_actions`, an append-only hide/restore audit trail.

`live_room_moderators` is deliberately separate from `user_metadata`, which a
user can edit. It also avoids stale JWT authorization and does not change the
existing account/session contract. Grant a moderator only through a controlled
operator process after applying the migration:

```sql
insert into public.live_room_moderators (user_id, role)
values ('<user_profiles.id>', 'moderator')
on conflict (user_id) do update
set role = excluded.role, active = true;
```

Do not expose this operation through a browser route.

Normal message lists always require `visibility_status = 'visible'` and apply
the current actor's block list on the server. Hidden/deleted content is never
returned by the normal API. A separate moderator-guarded route lists hidden
messages for restoration. Hide and restore are soft actions; the original row
and an audit action remain stored. There is no browser hard-delete route.

Reports and blocks accept only `messageId` from the browser. The server and
service-only RPC resolve the target actor. Unblock accepts an opaque block row
ID owned by the current member/guest and never returns actor UUIDs.

## Production rollout checklist

This branch contains migration files and application code only. It does not
apply anything to an operating database.

1. Review both Live Room foundation migrations and the new
   `20260727200000_live_room_realtime_moderation.sql`.
2. Confirm `20260727200000` runs after the already-applied
   `20260727192326` hardening migration.
3. Apply through the controlled migration pipeline, never from the browser.
4. Confirm all ten Live Room tables report RLS enabled.
5. Confirm `anon` and `authenticated` have no table/RPC privileges.
6. Confirm `service_role` can access the tables/RPCs and remains server-only.
7. Enable Realtime **Allow public access**. Subscribe with a publishable/anon
   key and verify the signal has only `roomId`, `messageId`, and `action`.
8. Run Supabase security and performance advisors after applying DDL.
9. Add moderator assignments through operator-only SQL.
10. Smoke-test a member and two private-browser guests: profile/follow
    persistence, message exchange, Realtime delivery, disconnect recovery,
    cursor pagination, reporting, blocking, and unblocking.
11. Verify moderator-only hide/restore and audit rows; verify normal APIs never
    return hidden/deleted bodies.
12. Verify blocked phrase, link, duplicate, burst, wrong-ticker event, and
    archived-event failures.
13. Review public-topic signal rates. A hostile public sender can request
    debounced same-origin reads; add API rate limiting if telemetry shows abuse.
