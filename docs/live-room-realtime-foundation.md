# Live Room realtime foundation

## Phase 1 behavior

Live Rooms are keyed by normalized company ticker. `issuer_id` is nullable and
uniquely indexed so a later canonical issuer migration can move room identity
without changing the URL contract.

The browser talks only to same-origin Next.js routes:

- `GET/POST /api/live-room/[ticker]/messages`
- `GET/PUT /api/live-room/[ticker]/follow`
- `GET/PUT /api/live-room/profile`

The server is the only Supabase Data API caller. It resolves the member from the
existing HttpOnly Supabase session cookies, or creates a random 256-bit guest
token in a separate HttpOnly, SameSite cookie. The database stores only its
SHA-256 digest. Browser payloads never supply actor IDs, author plan, author
profile snapshots, or moderation state.

Member plan badges are read from `user_plan_subscriptions` through the existing
effective-plan service when a message is sent. The resulting server-owned
snapshot is stored with the message.

## Why phase 1 uses polling

Supabase recommends private Broadcast channels for production Realtime and
requires a client JWT for Realtime Authorization. The current app intentionally
keeps its Supabase access token HttpOnly, and browser guests are not Supabase
Auth users. Giving the browser the existing access token would weaken the
session design; using a public channel would remove private-channel
authorization; and exposing a service/secret key is prohibited.

Phase 1 therefore uses a replaceable `LiveRoomUpdateTransport` with a four
second cursor-polling implementation. This cadence is for phase-1 testing, not
an operating-scale target. Before broader production rollout, evaluate private
Realtime Broadcast and polling backoff/jitter. A future Broadcast adapter can
replace polling after a short-lived, room-scoped client-token design covers
both members and guests.

Relevant current Supabase guidance:

- [Realtime getting started](https://supabase.com/docs/guides/realtime/getting_started)
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase breaking-change changelog](https://supabase.com/changelog?types=breaking-change)

The July 2026 review also accounted for current changes that restrict custom
objects in the `realtime` schema and stop automatically exposing new public
tables to the Data API. This migration does not create custom Realtime objects
and explicitly grants only `service_role`.

## Persistence and moderation

`20260727081914_live_room_realtime_foundation.sql` creates rooms, guest
sessions, member/guest display profiles, messages, and follows. Every new
public table has RLS enabled. `public`, `anon`, and `authenticated` have no
table or RPC privileges and no allow policies, matching the server-only access
model.

Message creation goes through a service-role-only, `SECURITY INVOKER` RPC. An
actor-scoped transaction advisory lock makes duplicate and burst checks atomic
across server instances. Both TypeScript and the database enforce:

- non-whitespace content;
- 600-character maximum;
- at most two links;
- blocked phrases;
- no duplicate within two minutes;
- no more than three messages within 20 seconds;
- referenced event exists, belongs to the room ticker, and is not archived.

Hidden and deleted message states are modeled, but message reporting and its
UI, administrator hide/delete actions and UI, and user-to-user blocking are not
implemented in this phase. No client hard-delete API is included. Room deletion
is restricted while messages exist. Account or expired guest-session cleanup
can remove identity rows while message author/event snapshots preserve the
conversation.

## Production rollout checklist

1. Review the migration against the production schema, especially the
   `events`, `user_profiles`, and `user_plan_subscriptions` contracts.
2. Apply the migration through the normal controlled migration pipeline. This
   branch does not apply it.
3. Confirm all six tables report RLS enabled.
4. Confirm `anon` and `authenticated` have no table privileges and cannot
   execute `insert_live_room_message`.
5. Confirm `service_role` can select/upsert the new tables and execute the RPC,
   while the key remains server-only.
6. Run Supabase security and performance advisors after applying DDL.
7. Smoke-test one member and two separate private-browser guest sessions:
   profile persistence, Follow persistence, message exchange, event mention,
   refresh, and cursor pagination.
8. Verify blocked phrase, link, duplicate, burst, wrong-ticker event, and
   archived-event failures from the deployed API.
9. Treat the four-second polling cadence as phase-1 testing only. Before
   widening rollout, review API latency and volume and choose private Realtime
   or a polling strategy with exponential backoff, jitter, and visibility-aware
   suspension.
