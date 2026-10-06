# Tender expiration v6 — preflight aborted

This run was frozen but **never called the provider**.

Reason: an offline test still contained two copied Applied-extension regex assertions. The fixture itself was correct; the test code was stale. The failing preflight was detected before any `started.json` marker or network request.

- target accession: `0001213900-23-055698`
- intended model: `gemini-3.5-flash`
- provider calls: **0**
- started marker: absent
- frozen request preserved unchanged
- classification: **PREFLIGHT_TEST_ERROR**
- semantic conclusion: none

A fresh run identity `v6b` was created after correcting the offline test. This frozen v6 run is not reused or overwritten.
