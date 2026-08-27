import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DILUTION_IDENTITY_CLAIM_VERSION,
  verifyDilutionEvidenceIdentity,
  type DilutionExposureType,
  type DilutionIdentityClaimKind,
  type DilutionSemanticRole,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";
import {
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD,
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_CLAIMS,
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_OBSERVATIONS,
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD,
  economicExposureIdentitySidecarProviderSchema,
  transportEconomicExposureIdentitySidecar,
} from "./economicExposureIdentityObservationSidecar.ts";
import {
  resolveExposureIdentity,
  type EconomicExposureIdentityCandidate,
} from "./economicExposureIdentityResolver.ts";

const accession = "0001477932-26-004651";
const issuerCik = "0001809750";

test("A. valid Note designation and agreement claims materialize locked contracts", () => {
  const text = "Under the Notes Purchase Agreement, the issuer sold Promissory Note A-1.";
  const result = transport(text, [observation("convertible_note", [
    claim("agreement_reference", "Notes Purchase Agreement", text),
    claim("designation_or_tranche", "Promissory Note A-1", text),
  ])]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0]?.identity_claims[0]?.version, DILUTION_IDENTITY_CLAIM_VERSION);
  assert.equal(result.observations[0]?.identity_claims[0]?.evidence_identity.exact_source, true);
});

test("B. Note with principal only has no strong identity and stays unresolved", () => {
  const text = "The note has an original principal amount of $2,170,000.";
  const result = transport(text, [observation("convertible_note", [claim("principal", "$2,170,000", text)])]);
  assert.equal(resolveExposureIdentity({ observation: result.observations[0]!, candidateExposures: [] }).decision, "UNRESOLVED");
});

test("C. two Note designations under one agreement remain separate", () => {
  const text = "The Notes Purchase Agreement issued Promissory Note A-1 and Secured Promissory Note B.";
  const result = transport(text, [
    observation("convertible_note", [
      claim("agreement_reference", "Notes Purchase Agreement", text),
      claim("designation_or_tranche", "Promissory Note A-1", text),
    ]),
    observation("convertible_note", [
      claim("agreement_reference", "Notes Purchase Agreement", text),
      claim("designation_or_tranche", "Secured Promissory Note B", text),
    ]),
  ]);
  const prior = candidate("note-a", result.observations[0]!);
  assert.equal(resolveExposureIdentity({ observation: result.observations[1]!, candidateExposures: [prior] }).decision, "CREATE_NEW");
});

test("D. explicit Note amendment target lets the resolver AMEND_EXISTING", () => {
  const originalText = "The instrument is Promissory Note A-1.";
  const amendmentText = "This amendment expressly amends Promissory Note A-1.";
  const original = transport(originalText, [observation("convertible_note", [claim("designation_or_tranche", "Promissory Note A-1", originalText)])]).observations[0]!;
  const amended = transport(amendmentText, [observation("convertible_note", [claim("amendment_reference", "Promissory Note A-1", amendmentText)], "exposure_amendment")]).observations[0]!;
  assert.equal(resolveExposureIdentity({ observation: amended, candidateExposures: [candidate("note-a", original)] }).decision, "AMEND_EXISTING");
});

test("E. Warrant Series A and B remain separate", () => {
  const text = "The issuer sold a Series A Warrant and a Series B Warrant.";
  const rows = ["Series A Warrant", "Series B Warrant"].map((name) =>
    transport(text, [observation("warrant", [claim("series_or_designation", name, text)])]).observations[0]!);
  assert.equal(resolveExposureIdentity({ observation: rows[1], candidateExposures: [candidate("warrant-a", rows[0])] }).decision, "CREATE_NEW");
});

test("F. same warrant exercise price is not an identity claim", () => {
  const text = "The warrant has an exercise price of $1.00 per share.";
  const raw = observation("warrant", [claim("underlying_share_quantity", "1,000,000", text)]);
  raw.identity_claims[0]!.claim_kind = "exercise_price" as DilutionIdentityClaimKind;
  raw.identity_claims[0]!.value = "$1.00";
  const result = transport(text, [raw]);
  assert.equal(result.observations.length, 0);
  assert.match(result.rejected.join(" "), /claim kind is not allowed/);
});

test("G. exact ATM sales agreement identity links", () => {
  const text = "The Open Market Sale Agreement SM governs the ATM program.";
  const row = transport(text, [observation("atm_program", [claim("sales_agreement_reference", "Open Market Sale Agreement SM", text)])]).observations[0]!;
  assert.equal(resolveExposureIdentity({ observation: row, candidateExposures: [candidate("atm-a", row)] }).decision, "LINK_EXISTING");
});

test("H. explicit ATM amendment target amends the agreement", () => {
  const originalText = "The ATM uses the Open Market Sale Agreement SM.";
  const amendmentText = "This amendment amends the Open Market Sale Agreement SM.";
  const original = transport(originalText, [observation("atm_program", [claim("sales_agreement_reference", "Open Market Sale Agreement SM", originalText)])]).observations[0]!;
  const amended = transport(amendmentText, [observation("atm_program", [claim("amendment_reference", "Open Market Sale Agreement SM", amendmentText)], "exposure_amendment")]).observations[0]!;
  assert.equal(resolveExposureIdentity({ observation: amended, candidateExposures: [candidate("atm-a", original)] }).decision, "AMEND_EXISTING");
});

test("I. exact ELOC purchase agreement identity materializes", () => {
  const text = "The Equity Purchase Agreement dated January 10, 2026 was signed with Investor LLC.";
  const result = transport(text, [observation("equity_line", [
    claim("purchase_agreement_reference", "Equity Purchase Agreement", text),
    claim("purchase_agreement_date", "2026-01-10", text, "agreement_signing_date"),
    claim("counterparty", "Investor LLC", text),
  ])]);
  assert.equal(resolveExposureIdentity({ observation: result.observations[0]!, candidateExposures: [] }).decision, "CREATE_NEW");
});

test("J. explicit pre-funded subtype is accepted", () => {
  const text = "Each Pre-Funded Warrant is immediately exercisable.";
  assert.equal(transport(text, [observation("prefunded_warrant", [claim("series_or_designation", "Pre-Funded Warrant", text)])]).observations.length, 1);
});

test("K. generic warrant evidence cannot be relabeled pre-funded", () => {
  const text = "Each Warrant is immediately exercisable.";
  const result = transport(text, [observation("prefunded_warrant", [claim("series_or_designation", "Warrant", text)])]);
  assert.equal(result.observations.length, 0);
  assert.match(result.rejected.join(" "), /pre-funded subtype/);
});

test("L. wrong semantic date role is rejected", () => {
  const text = "The Sales Agreement was signed on May 17, 2024.";
  const result = transport(text, [observation("atm_program", [
    claim("sales_agreement_date", "2024-05-17", text, "registration_effective_date"),
  ])]);
  assert.equal(result.observations.length, 0);
  assert.match(result.rejected.join(" "), /semantic role/);
});

test("L2. partial or non-ISO date cannot bind to an identity date role", () => {
  const text = "The Sales Agreement was signed in May 2024.";
  const result = transport(text, [observation("atm_program", [
    claim("sales_agreement_date", "May 2024", text, "agreement_signing_date"),
  ])]);
  assert.equal(result.observations.length, 0);
  assert.match(result.rejected.join(" "), /semantic role/);
});

test("M. tampered evidence fails closed in the resolver", () => {
  const text = "The instrument is Promissory Note A-1.";
  const valid = transport(text, [observation("convertible_note", [claim("designation_or_tranche", "Promissory Note A-1", text)])]).observations[0]!;
  const tampered = {
    ...valid,
    identity_claims: valid.identity_claims.map((item) => ({
      ...item,
      evidence_identity: { ...item.evidence_identity, source_content_hash: "0".repeat(64) },
    })),
  };
  assert.equal(verifyDilutionEvidenceIdentity(
    tampered.identity_claims[0]!.evidence_identity,
    [{ source_ref: `analysis-source:${accession}:source-1`, text }],
  ), false);
});

test("N. source reference outside the analyzer bundle is rejected", () => {
  const text = "The instrument is Promissory Note A-1.";
  const raw = observation("convertible_note", [claim("designation_or_tranche", "Promissory Note A-1", text)]);
  raw.identity_claims[0]!.evidence.source_block_index = 2;
  const result = transport(text, [raw]);
  assert.equal(result.observations.length, 0);
  assert.match(result.rejected.join(" "), /source membership/);
});

test("O. registration identity alone does not merge an exposure", () => {
  const text = "The note has principal of $4,000,000 under registration statement 333-123456.";
  const row = transport(text, [observation("convertible_note", [claim("principal", "$4,000,000", text)])]).observations[0]!;
  assert.equal(resolveExposureIdentity({
    observation: row,
    candidateExposures: [candidate("note-a", row)],
    registration_canonical_keys: ["reg:v1:0001809750:333-123456"],
  }).decision, "UNRESOLVED");
});

test("P. Registered Direct and PIPE wrappers produce no observation by themselves", () => {
  const result = transport("The issuer completed a Registered Direct and PIPE.", []);
  assert.deepEqual(result, { observations: [], rejected: [] });
});

test("Q. plain common shares produce no continuing exposure", () => {
  assert.equal(transport("The issuer sold 1,000,000 common shares.", []).observations.length, 0);
});

test("R. observation and claim bounds are enforced", () => {
  const text = "The instrument is Promissory Note A-1.";
  const tooManyObservations = Array.from({ length: ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_OBSERVATIONS + 1 }, () =>
    observation("convertible_note", [claim("designation_or_tranche", "Promissory Note A-1", text)]));
  assert.match(transport(text, tooManyObservations).rejected.join(" "), /observation bound/);
  const tooManyClaims = Array.from({ length: ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_CLAIMS + 1 }, () =>
    claim("designation_or_tranche", "Promissory Note A-1", text));
  assert.match(transport(text, [observation("convertible_note", tooManyClaims)]).rejected.join(" "), /claim bound/);
});

test("S. provider exposure strings are locked by deterministic transport", () => {
  const serializedSchema = JSON.stringify(economicExposureIdentitySidecarProviderSchema);
  assert.equal(economicExposureIdentitySidecarProviderSchema.type, "string");
  assert.doesNotMatch(serializedSchema, /"(?:exposure_type|observation_kind|identity_claims)"/);

  const text = "The instrument is Promissory Note A-1.";
  const result = transportEconomicExposureIdentitySidecar({
    provider_output: {
      [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD]: [{
        exposure_type: "unsupported_exposure",
        observation_kind: "exposure_identity",
        identity_claims: [claim("designation_or_tranche", "Promissory Note A-1", text)],
      }],
    },
    source_blocks: [{ block_id: "source-1", block_type: "cleaned_source_block", text }],
    issuer_cik: issuerCik,
    accession,
    form: "S-3",
    filed_date: "2026-07-01",
  });
  assert.equal(result.observations.length, 0);
  assert.match(result.rejected.join(" "), /contract is invalid/);

  const unsupportedKind = transportEconomicExposureIdentitySidecar({
    provider_output: {
      [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD]: [{
        exposure_type: "convertible_note",
        observation_kind: "unsupported_kind",
        identity_claims: [claim("designation_or_tranche", "Promissory Note A-1", text)],
      }],
    },
    source_blocks: [{ block_id: "source-1", block_type: "cleaned_source_block", text }],
    issuer_cik: issuerCik,
    accession,
    form: "S-3",
    filed_date: "2026-07-01",
  });
  assert.equal(unsupportedKind.observations.length, 0);
  assert.match(unsupportedKind.rejected.join(" "), /contract is invalid/);
});

test("T. provider JSON sidecar strings decode into the locked contract", () => {
  const text = "The instrument is Promissory Note A-1.";
  const rawObservation = observation("convertible_note", [
    claim("designation_or_tranche", "Promissory Note A-1", text),
  ]);
  const result = transportEconomicExposureIdentitySidecar({
    provider_output: {
      [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD]: JSON.stringify([rawObservation]),
    },
    source_blocks: [{ block_id: "source-1", block_type: "cleaned_source_block", text }],
    issuer_cik: issuerCik,
    accession,
    form: "S-3",
    filed_date: "2026-07-01",
  });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0]?.exposure_type, "convertible_note");
});

test("U. malformed or duplicate-key provider JSON fails closed", () => {
  const base = {
    source_blocks: [{ block_id: "source-1", block_type: "cleaned_source_block", text: "source" }],
    issuer_cik: issuerCik,
    accession,
    form: "S-3",
    filed_date: "2026-07-01",
  };
  for (const wire of [
    "[{",
    '[{"exposure_type":"warrant","exposure_type":"atm_program"}]',
  ]) {
    const result = transportEconomicExposureIdentitySidecar({
      ...base,
      provider_output: { [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD]: wire },
    });
    assert.equal(result.observations.length, 0);
    assert.match(result.rejected.join(" "), /sidecar must be an array/);
  }
});

test("provider architecture remains observation-only and adds no call implementation", () => {
  const source = readFileSync(new URL("./economicExposureIdentityObservationSidecar.ts", import.meta.url), "utf8");
  const ingest = readFileSync(new URL("../secFilingAnalysisIngest.ts", import.meta.url), "utf8");
  const adapterSources = [
    "../ai/sec8k6kAnalysisAdapter.ts",
    "../ai/secS1F1AnalysisAdapter.ts",
    "../ai/secS3AnalysisAdapter.ts",
    "../ai/sec424bAnalysisAdapter.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  assert.doesNotMatch(source, /runOpenAi|generateContent|generateObject|fetch\s*\(/);
  for (const adapterSource of adapterSources) {
    assert.doesNotMatch(adapterSource, /runOpenAiJsonPrompt|runGeminiJsonPrompt|generateContent|generateObject/);
  }
  assert.doesNotMatch(JSON.stringify(economicExposureIdentitySidecarProviderSchema), /"(?:exposure_id|canonical_id|same_as_previous|confidence)"/);
  assert.match(ingest, /outputText: withoutEconomicExposureIdentitySidecar\(analysisRun\.outputText\)/);
  assert.match(ingest, /delete root\[ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD\]/);
  assert.doesNotMatch(ingest, /analysis:.*economicExposureIdentityObservations/);
});

function transport(text: string, observations: ReturnType<typeof observation>[]) {
  return transportEconomicExposureIdentitySidecar({
    provider_output: { [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD]: observations },
    source_blocks: [{ block_id: "source-1", block_type: "cleaned_source_block", text }],
    issuer_cik: issuerCik,
    accession,
    form: "S-3",
    filed_date: "2026-07-01",
  });
}

function observation(
  exposureType: DilutionExposureType,
  identityClaims: ReturnType<typeof claim>[],
  observationKind: "exposure_identity" | "exposure_amendment" = "exposure_identity",
) {
  return { exposure_type: exposureType, observation_kind: observationKind, identity_claims: identityClaims };
}

function claim(
  claimKind: DilutionIdentityClaimKind,
  value: string,
  exactQuote: string,
  semanticRole: DilutionSemanticRole | null = null,
) {
  return {
    claim_kind: claimKind,
    value,
    semantic_role: semanticRole,
    evidence: { source_block_index: 0, exact_quote: exactQuote },
  };
}

function candidate(exposureId: string, observationValue: DilutionSourceObservation): EconomicExposureIdentityCandidate {
  return {
    exposure_id: exposureId,
    issuer_cik: observationValue.issuer_cik,
    exposure_type: observationValue.exposure_type!,
    identity_claims: observationValue.identity_claims,
  };
}
