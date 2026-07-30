# KLIPY Live Room media

Live Room and Community Room chat use KLIPY's Tenor-compatible v2 API
through a server-only adapter. Browsers never receive `KLIPY_API_KEY` or
call KLIPY directly.

- Search uses `/v2/search`; the initial picker uses `/v2/featured`.
- Every request uses `contentfilter=high`, the strictest documented
  Tenor-compatible rating.
- The picker placeholder is exactly `Search KLIPY` and displays
  `Powered by KLIPY`.
- Message creation sends only the selected provider media ID. The server
  resolves it from its recent sanitized search cache or `/v2/posts`.
- Stored media is limited to HTTPS assets on `static.klipy.com` and item
  links on `klipy.com`. Raw provider payloads, tags, API keys, and IPs are
  not stored.
- The test key is limited to 100 requests per hour. The client debounces,
  cancels and caches searches; the server applies member/IP and global
  best-effort limits and preserves provider `429` retry guidance.

Before production launch, replace the test key with an approved
production key and configure the KLIPY Partner Panel content rating and
blocked-keyword settings. The in-request `high` filter complements those
partner controls; it does not replace them.

References:

- https://klipy.com/api-overview
- https://developers.google.com/tenor/guides/endpoints
- https://developers.google.com/tenor/guides/content-filtering
