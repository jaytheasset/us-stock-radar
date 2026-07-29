# Brokerage proof foundation

Stock Radar uses SnapTrade Commercial as a read-only brokerage connection provider.
The integration is pinned to `snaptrade-typescript-sdk` 11.0.3 and never calls a
trading endpoint.

## Runtime configuration

- `SNAPTRADE_CLIENT_ID`
- `SNAPTRADE_CONSUMER_KEY`
- `SNAPTRADE_USER_SECRET_ENCRYPTION_KEY`
- `SNAPTRADE_CONNECTIONS_ENABLED`
- `SNAPTRADE_PUBLIC_PROOFS_ENABLED`
- `SNAPTRADE_MOCK_ENABLED`

Public proof sharing defaults to disabled. The mock provider is available only in
non-production runtimes and cannot be enabled in production. Missing provider
credentials produce a safe `Not configured` state instead of breaking account or
Live Room pages.

SnapTrade user secrets are encrypted with AES-256-GCM using a random 12-byte IV,
authentication tag, and key version. Plaintext secrets, provider credentials,
account numbers, full balances, source market prices, and source market values
must not be logged, returned to the browser, or persisted.

## Data and disclosure policy

The server retrieves current positions, orders, and activities on demand. It
sanitizes one user-selected item into an immutable public proof snapshot and does
not store a raw provider response.

- Positions store only the selected disclosure fields. SnapTrade market price,
  market value, and open profit/loss are discarded.
- Filled orders are provisional execution evidence.
- Activities are final execution evidence.
- Paper accounts are always labeled `Paper account`.
- A proof states that linked brokerage data was observed at a particular time. It
  does not verify account ownership or the accuracy of the attached analysis.

Disconnecting expires the connection and leaves already shared, non-identifying
proofs as historical snapshots. Revoking a proof updates only its separate status
record. A brokerage data deletion request disconnects the provider user and
deletes the encrypted connection secret; public-safe historical proof snapshots
remain until the applicable content/account retention path removes them.

## Webhooks

The webhook endpoint parses the JSON payload, recursively sorts object keys at
every level while preserving array order, serializes compact canonical JSON, and
verifies the Base64 HMAC-SHA256 `Signature` using the consumer key. Verification
uses decoded equal-length buffers and `timingSafeEqual`. Events outside the
five-minute timestamp window are rejected and `webhookId` is idempotent.

## Authorization

Only effective Pro, Advanced, or Ultimate plans may connect or create proofs.
Entitlement is recalculated on the server and in database wrappers. Browser roles
have no direct table or function access; the service role has explicit minimum
grants. Message and post attachment wrappers recheck the content author, proof
owner, current proof state, plan, and public-sharing gate in one transaction.

The public-sharing gate exists because public redistribution requires the
necessary provider and user permissions. Enabling it is an operational and legal
approval, not a UI-only switch.
