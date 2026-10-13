# Live Room initial entry diagnostics

Start with an existing company Live Room entry rendered by the product, then
follow its `/live/[ticker]` link directly. Do not assume a fixed ticker from a
test fixture or create a room solely for diagnostics.

## Read-only boundary

This diagnostic covers one initial company-room entry flow only:

1. the server resolves the normalized ticker, viewer plan, and existing room
   availability;
2. the client resolves the existing guest/member profile;
3. the existing `GET /api/live-room/[ticker]/messages?limit=50&resume=true`
   request loads the initial public timeline page;
4. the existing membership GET confirms whether a signed-in member has joined;
5. the resolver joins those results with the visible timeline state.

Do not add a debug API, browser instrumentation, stored logs, WebMCP/MCP, or a
second message request contract. Do not expose raw error text, response bodies,
query values, user data, cookies, or tokens. Message sending, Realtime
subscription or reconnection, presence, read marking, joining, following,
blocking, reporting, and other user-state changes are outside this flow.

## Shared header reads

The account menu uses `GET /api/live-room/profile?view=account`. This is an
owner-scoped projection of an existing member profile (`isGuest: false` and
`publicProfileId`), or `data: null` when no member profile exists. It does not
bootstrap an account, create a profile, or load chat privileges. The chat
repository still uses the unqualified profile GET for entry initialization;
profile PUT and other chat actor consumers keep their existing contracts.

The account projection and unread GET resolve only existing identities. They
never create guest sessions or update guest `last_seen_at`. Missing, malformed,
expired, or unknown guest identities yield absence (an anonymous empty unread
summary); existing members and guests retain their owner-scoped unread reads.
Auth refresh and its cookie rotation remain enabled, with account bootstrap
disabled. An Auth outage or failed identity/profile/unread query is an error,
not proof of absence or a successful zero count.

When checking a general page such as `/alerts`, distinguish these Live Room
reads from login, `/api/auth/me`, and other product APIs that may independently
bootstrap accounts. A blocked write guard must retain that distinction. Do not
relax it to make a header request pass. Use `headerReadOnly.test.mjs` (included
in `npm run verify:live-room`) for controlled identity/outage/initialization
coverage when existing guest or member-profile fixtures are unavailable.

## State interpretation

`resolveLiveRoomEntryFlowState` is the shared source for the visible diagnostic
copy and safe DOM observations:

- `loading`: profile, membership, initial messages, or the room surface is
  still being checked.
- `unavailable`: existing availability is `archived` or `locked`; public
  history may render, but new activity is unavailable.
- `permission`: the initial message GET returned an authentication or
  authorization boundary. A missing count is not an empty room.
- `error`: the initial message GET failed for another reason. A missing count
  is not an empty room.
- `empty`: availability is confirmed `active`, the message GET succeeded with
  zero items, and the visible timeline is also empty.
- `ready`: availability is confirmed `active`, the message GET succeeded with
  items, and the visible timeline is ready.
- `unknown`: availability could not be confirmed, another part of the room
  surface failed, or the successful result count disagrees with the visible
  timeline state.

Availability lookup failure is preserved as `unknown`; it is never promoted to
`active`. The existing read-only policy therefore keeps joins and new activity
disabled until availability is confirmed.

The company-room surface exposes only:

- `data-live-room-entry-state`
- `data-live-room-availability`
- `data-live-room-message-request`
- `data-live-room-result-count`
- `data-live-room-viewer-access`

The result count is a normalized non-negative count only after a successful
initial message response. Otherwise it is `unknown`. Guest access means public
reading succeeded while joining the room still requires sign-in; it does not
mean the public timeline request was denied.

## Current surface observation

The entry fields above keep their existing meaning. A separate visually hidden,
`aria-hidden` diagnostic node uses `resolveLiveRoomSurfaceObservation` to
describe the current rendered composition without adding a warning or card.
It stays out of both the visible UI and accessibility tree while retaining
safe data attributes for direct DOM inspection:

- `data-live-room-main-section`: the actual `chat`, `posts`, or `events` tab;
- `data-live-room-timeline-state`: `loading`, `error`, `empty`, or `ready`;
- `data-live-room-timeline-count`: the number of timeline items currently
  rendered, not the initial request result count;
- `data-live-room-latest-update`: `loading`, `visible`, `no-update`, or
  `source-error`. A retained visible update stays `visible` if a later optional
  source refresh fails. `visible` means the real event strip is rendered;
  whether that event also has a detail link does not change the state;
- `data-live-room-composer-state`: `available`, `loading`, `read-only`,
  `unavailable`, or the transient `busy` state;
- `data-live-room-composer-disabled-reason`: `none`, `profile-loading`,
  `timeline-loading`, `timeline-error`, `room-read-only`, or `sending`;
- `data-live-room-quick-preview`: `visible`, `hidden-narrow`, or the transient
  `checking` state. This follows the rail's actual rendered CSS visibility;
  opening the narrow-screen information drawer does not make the rail visible.

Read the entry fields first, then compare the surface observation with the
selected tab and visible timeline, update, composer, and quick-preview rail.
Zero rendered timeline items do not override an entry request failure, and
`no-update` is not a source failure. Optional update or rail state does not
downgrade the entry resolver.

## Browser evidence

For a candidate, use a currently rendered stock entry and record the selected
stock link plus its existing Live Room link. At the logged-out direct URL,
record the account boundary, Join room control without activating it, initial
message GET status and safe item count, final visible copy and matching DOM
state, current surface observation, console errors, and horizontal overflow.

Repeat the same direct URL at desktop, an intermediate width, and 390px. Do not
bypass login or membership. Treat archived, locked, permission-denied, failed,
and unknown fixtures as unit-only unless those states can be reached safely in
the existing environment.

For local grouping presentation checks only, run `next dev` and open
`/development/live-room-visual-fixture`. This fixed, non-persisted developer
fixture uses the real timeline UI and is not a source of real room data.
