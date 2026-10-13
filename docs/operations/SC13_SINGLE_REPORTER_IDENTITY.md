# SC13 single-reporter SEC identity supplement

This candidate adds a narrow, source-bound identity supplement for specific-person Schedule 13G monitors. Existing monitor settings, APIs, numeric conditions, activation, matching comparisons and alert deduplication remain unchanged. All-reporters monitoring is deferred.

## Source and storage boundary

The existing SEC collector may make one additional bounded submission-text request when canonical XML has exactly one cover reporter without a CIK. The URL must be the exact accession's link in the original filing index. The collector compares the embedded primary XML with the separately collected canonical XML before retaining a supplement.

`raw_payload.sc13_reporter_identity_source` retains the original filing index (at most 100,000 characters), SEC header (at most 32,000 characters), source URLs, document identity and hashes. Full submission text is limited to 256,000 bytes during collection and is not stored again. Original canonical XML, reporter rows, raw CIK, numerical values and canonical fingerprints are unchanged.

Newly collected raw items carry this evidence automatically. Existing raw items require an explicit refresh through the existing ingestion workflow to obtain the newly captured evidence: an ordinary deduplicated replay deliberately does not replace their saved raw payload. This candidate does not change ingestion deduplication or add a backfill path.

Qualification requires all of the following:

- One Schedule 13G/13G-A cover reporter, one signature reporting-person name and the same Item 2 filing-person name. Name comparison only folds case and whitespace; it is not a name-based CIK lookup.
- One SEC-header `FILED BY` and one `SUBJECT COMPANY`; one corresponding index role each. Header/index accession, form, names and CIKs must agree with the XML header filer and issuer. Index visible CIK and link CIK must also agree. Issuer and filer must be different, nonzero CIKs.
- Original archive URLs and exact accession, form, primary-document filename and embedded XML hash bindings. Stored index/header text hashes are checked again on reads.
- An absent group flag or literal `b`, plus explicit Item 8 `notApplicableFlag=Y`. Literal `a`, unsupported group flags, applicable/absent Item 8, joint signatures, multiple cover reporters and contradictory identities are not eligible.

The `b` case is only a reporter-identity qualification. It is not a determination about group status, beneficial ownership, managed funds or whether other entities are the same person. No CIK is assigned to mentioned funds and no holdings are aggregated.

## Shared read and alert behavior

Canonical readers validate the original XML and rows first. When eligible, they read only the supplement attached to that canonical filing's exact raw-item ID. Missing, invalid, conflicting or unreadable evidence yields no supplement. Reads never fetch SEC documents or write data.

`verifiedReporterIdentity` is separate from canonical `reporting_person_cik`. Only the derived lineage input receives the verified CIK. The shared current-state reader feeds both the stock Ownership section and specific-person Monitor choices. Historical XML reporter rows continue to show their original missing CIK. Existing whole-position unresolved behavior for unverified joint reporters is preserved.

The matched alert optionally retains `reportingPersonIdentity` alongside immutable numeric match evidence. It includes the original source links and hashes, so the identity proof remains auditable if supplementary raw evidence later becomes unavailable. Stock, Monitor and Alert UI explain that the CIK came from the SEC header/index and link those originals. The builder explicitly states “CIK-verified shareholders only.”

Existing XML reporter CIKs remain authoritative and bypass supplementation. No old alerts are rewritten. Future filings that fail identity, security or lineage proof remain unresolved.

## Candidate verification

The focused offline suite passed 52 tests and TypeScript checking. It includes the actual retained AGCO accession `0000354204-26-001092` sources, whose canonical XML SHA-256 is `ee7db24a5e42b933c76eec0d6fde3f510a483e5f57f5885e8d53896471e3cc64`. The complete 6,699-character XML, including its trailing newline, is validated through the canonical reader path. Raw reporter CIK remains null; separate verified CIK is `0000354204`; reported values remain `5.3` and `3722188.00`.

Negative tests cover source/accession/hash mismatch, role and visible/link CIK contradictions, zero CIKs, multiple reporters/signatures, Item 2 name mismatch, unsupported group evidence, missing supplement, replay, and the original XML-CIK path. The checked-in small original-source fixture is test evidence, not production data.

Live collection, isolated database immutability, actual stock/monitor/alert browser journeys and their results are recorded separately by the integration reviewer. This document does not claim main integration, remote migration, production deployment or all-reporters support. No schema migration, environment-file change, cover-sidecar repair, model/provider call or external alert delivery is part of this candidate change.
