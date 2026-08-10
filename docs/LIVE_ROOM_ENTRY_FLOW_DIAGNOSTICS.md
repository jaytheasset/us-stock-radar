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

## Browser evidence

For a candidate, use a currently rendered stock entry and record the selected
stock link plus its existing Live Room link. At the logged-out direct URL,
record the account boundary, Join room control without activating it, initial
message GET status and safe item count, final visible copy and matching DOM
state, console errors, and horizontal overflow.

Repeat the same direct URL at desktop, an intermediate width, and 390px. Do not
bypass login or membership. Treat archived, locked, permission-denied, failed,
and unknown fixtures as unit-only unless those states can be reached safely in
the existing environment.
