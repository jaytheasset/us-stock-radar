# SEC Filing-level XBRL Context Foundation V1

This foundation provides lossless structural input for a later security-class or outstanding-shares resolver. It does not decide authoritative shares outstanding.

## Flow

```text
SEC filing ledger (CIK + accession + primary document)
  -> official accession archive index.json + filing attachment index
  -> complete primary Inline XBRL Document Set (IXDS) OR filing instance XML
  -> exact raw artifact + SHA-256 persistence
  -> structural XML/XHTML parser
  -> fact -> contextRef -> context -> every dimension
  -> CompanyFacts O/S candidate linker
```

The existing `sec_structured_raw_sources` table already admits the server-only `filing_xbrl` source kind and retains up to 256 MiB of exact source text. V1 therefore adds no migration. `PostgresSecFilingXbrlArtifactRepository` stores filing artifacts there; `InMemorySecFilingXbrlArtifactRepository` supports deterministic tests. The unique `(source_kind, source_identity, content_hash)` constraint remains the persistence dedupe boundary.

`SecFilingXbrlContextService.ingestFiling()` reads the raw-artifact cache before fetching. An inline cache is complete only when both official inventories are present and every document identified as part of the primary IXDS is persisted. A primary-only or index-only cache is incomplete and is fetched again. A complete replay performs no second SEC request.

## Discovery

- CIK and accession build the official EDGAR archive directory with the existing `buildSecArchiveFilingUrls()` helper.
- `index.json` is the official archive inventory. The filing index supplies attachment sequence, description, type, and the SEC iXBRL marker; it is parsed structurally with an HTML parser.
- The primary document must equal `sec_filing_ledger.primary_document`; missing identity fails closed.
- Inline XBRL is confirmed from the Inline XBRL namespace/header, independent of the namespace prefix.
- The primary document and non-excluded inline attachments form the primary IXDS. SEC attachment roles processed separately, including `EX-FILING FEES` and `EX-98`, are retained in discovery but never mixed into it.
- Attachment roles whose IXDS membership depends on an instance type not present in the current filing ledger fail with `PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS`; the implementation does not guess.
- For a non-inline filing, XML instance candidates exclude taxonomy support files (`cal`, `def`, `lab`, `pre`), filing summaries, and rendered reports. Zero or multiple candidates fail closed.

The source URL, accession, document name, fetched timestamp, content type, exact raw body, and SHA-256 hash are retained. No full filing is committed to Git.

## Structural contract

A fact preserves:

- taxonomy-qualified QName and namespace URI;
- exact parsed text/value tree (including inline `scale`, `sign`, `format`, `decimals`, and `precision` attributes);
- `unitRef` and `contextRef`;
- accession, document URL/name, and raw-body hash.

A context preserves:

- exact context ID;
- entity identifier and scheme;
- either instant or start/end duration;
- every explicit or typed dimension.

An explicit dimension preserves exact axis/member QNames and namespace URIs. A typed dimension preserves its axis QName, value-element QName, text, deterministic XML representation, and canonical value tree. The exact original bytes remain addressable through the raw artifact and hash.

`parseSecFilingXbrlArtifacts()` parses every primary-IXDS document with its own namespace map, then creates one shared context map before extracting facts. A fact may therefore resolve a `contextRef` defined in another IXDS document while keeping the fact's original document URL/name/hash. Conflicting context IDs across documents fail deterministically.

Unsupported individual facts (for example `ix:fraction` or `continuedAt`) are rejected explicitly without destroying unrelated supported facts. A relevant rejected O/S fact makes the O/S linker fail closed. Broken context references, conflicting context IDs, uninterpretable typed members, malformed XML/XHTML, missing artifacts, and accession mismatch are never repaired or guessed.

## O/S candidate linker boundary

`readOsCandidateFilingContexts()` accepts only the existing `SecOsFilingContextCandidate` produced by `extractCompanyFactsOs()` / `readOsCandidates()`. It parses the primary IXDS as one document set, matches exact accession, canonical concept QName, and `as_of` instant, then returns the linked filing facts and contexts.

It does not:

- choose a winning fact;
- infer common-stock class;
- resolve ADS versus ordinary shares;
- apply split arithmetic;
- promote authoritative O/S;
- create Share Count History.

Alphabet demonstrates why this boundary matters: the same filing/as-of/concept includes an aggregate fact plus Class A, B, and C contexts carrying `us-gaap:StatementClassOfStockAxis` members. The foundation returns all four. A later semantic resolver must decide how, or whether, they can be used.

## Official acceptance sources

The committed audit fixture records official EDGAR URLs and full-document hashes for AAPL, Alphabet, Wipro, and NeoMedia. The full bodies were fetched only for read-only acceptance. AAPL, Alphabet, and Wipro exercised inline XBRL; NeoMedia exercised a standalone XML instance.

SEC documents describe the accession archive directory's machine-readable `index.json` and require facts to link to filing contexts. See the SEC's [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) and [EDGAR XBRL Guide](https://www.sec.gov/files/edgar/filer-information/specifications/xbrl-guide-2026-08-14.pdf).
