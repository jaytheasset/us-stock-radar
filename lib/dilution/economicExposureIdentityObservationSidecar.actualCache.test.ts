import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES } from "./economicExposureIdentityResolver.actualSecFixtures.ts";
import {
  ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD,
  transportEconomicExposureIdentitySidecar,
} from "./economicExposureIdentityObservationSidecar.ts";
import { resolveExposureIdentity, type EconomicExposureIdentityCandidate } from "./economicExposureIdentityResolver.ts";
import type { DilutionExposureType, DilutionIdentityClaimKind, DilutionSemanticRole } from "./economicExposureContracts.ts";

test("actual cached GME, HR, EDBL, RLAY, EMPD, MRAI, TPET, and SKK remain source-backed and replay-stable", () => {
  const observations = ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES.flatMap((fixture) =>
    transportFixture(fixture).map((observation) => ({ fixture, observation })));
  assert.equal(observations.length, 10);

  const decisions = observations.map(({ fixture, observation }, index) => {
    const candidateExposures: EconomicExposureIdentityCandidate[] = fixture.history_id === "skk_same_atm_agreement_prospectus_update"
      ? [{
          exposure_id: "skk-atm-existing",
          issuer_cik: observation.issuer_cik,
          exposure_type: observation.exposure_type!,
          identity_claims: observation.identity_claims,
        }]
      : [];
    const first = resolveExposureIdentity({ observation, candidateExposures });
    const replay = resolveExposureIdentity({ observation, candidateExposures });
    assert.deepEqual(replay, first, `replay drift for ${fixture.history_id}:${index}`);
    return first;
  });

  assert.deepEqual(count(decisions.map((decision) => decision.decision)), {
    CREATE_NEW: 9,
    LINK_EXISTING: 1,
  });
  assert.equal(decisions.filter((decision) => decision.decision === "CONFLICT").length, 0);
  assert.equal(decisions.filter((decision) => decision.decision === "UNRESOLVED").length, 0);

  const edbl = observations.filter(({ fixture }) => fixture.history_id === "edbl_two_note_designations_one_registration");
  assert.equal(edbl.length, 2);
  assert.notEqual(
    edbl[0]?.observation.identity_claims.find((claim) => claim.claim_kind === "designation_or_tranche")?.value,
    edbl[1]?.observation.identity_claims.find((claim) => claim.claim_kind === "designation_or_tranche")?.value,
  );
  const edblSecond = resolveExposureIdentity({
    observation: edbl[1]!.observation,
    candidateExposures: [{
      exposure_id: "edbl-note-a",
      issuer_cik: edbl[0]!.observation.issuer_cik,
      exposure_type: "convertible_note",
      identity_claims: edbl[0]!.observation.identity_claims,
    }],
  });
  assert.equal(edblSecond.decision, "CREATE_NEW");

  const skk = observations.find(({ fixture }) => fixture.history_id === "skk_same_atm_agreement_prospectus_update")!;
  assert.equal(decisions[observations.indexOf(skk)]?.decision, "LINK_EXISTING");
});

function transportFixture(fixture: (typeof ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES)[number]) {
  assert.equal(createHash("sha256").update(fixture.excerpt).digest("hex"), fixture.excerpt_sha256);
  const groupedClaims = fixture.history_id === "edbl_two_note_designations_one_registration"
    ? [
        fixture.raw_derived_strong_claims.filter((claim) => claim[0] === "agreement_reference" || claim[1] === "Promissory Note A‑1"),
        fixture.raw_derived_strong_claims.filter((claim) => claim[0] === "agreement_reference" || claim[1] === "Secured Promissory Note B"),
      ]
    : fixture.history_id === "empd_prefunded_and_common_warrants"
      ? [
          fixture.raw_derived_strong_claims.filter((claim) => claim[0] === "agreement_reference" || claim[1] === "Pre-Funded Warrant"),
          fixture.raw_derived_strong_claims.filter((claim) => claim[0] === "agreement_reference" || claim[1] === "Common Warrant"),
        ]
      : [fixture.raw_derived_strong_claims];
  const result = transportEconomicExposureIdentitySidecar({
    provider_output: {
      [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD]: groupedClaims.map((claims, index) => ({
        exposure_type: fixture.history_id === "empd_prefunded_and_common_warrants" && index === 1
          ? "warrant"
          : fixture.exposure_type,
        observation_kind: "exposure_identity",
        identity_claims: claims.map(([claimKind, value]) => ({
          claim_kind: claimKind,
          value,
          semantic_role: semanticRole(claimKind),
          evidence: {
            source_block_index: 0,
            exact_quote: quoteFor(fixture.excerpt, claimKind, value),
          },
        })),
      })),
    },
    source_blocks: [{ block_id: fixture.history_id, block_type: "cleaned_source_block", text: fixture.excerpt }],
    issuer_cik: fixture.issuer_cik,
    accession: fixture.accessions[0],
    form: fixture.form,
    filed_date: "2026-08-01",
  });
  assert.deepEqual(result.rejected, [], fixture.history_id);
  return result.observations;
}

function quoteFor(excerpt: string, claimKind: DilutionIdentityClaimKind, value: string) {
  const direct = excerpt.toLowerCase().indexOf(value.toLowerCase());
  const dateAnchors: Record<string, string> = {
    "2024-05-17": "May 17, 2024",
    "2026-01-09": "January 9, 2026",
    "2026-05-18": "May 18, 2026",
    "2026-07-31": "July 31, 2026",
  };
  const keyword = direct >= 0
    ? value
    : dateAnchors[value] || (claimKind === "sales_agreement_date" ? "originally dated"
      : claimKind === "original_issuance_or_closing_date" ? "Initial Closing"
        : claimKind === "sales_agent" ? "Sales Agent"
          : claimKind === "sales_agreement_reference" ? "Sales Agreement"
            : claimKind === "agreement_reference" ? "purchase agreement"
            : claimKind === "certificate_of_designation_reference" ? "Certificate of Designation"
              : claimKind === "original_instrument_reference" ? "Exchangeable Senior Notes"
                : value);
  const index = excerpt.toLowerCase().indexOf(keyword.toLowerCase());
  assert.ok(index >= 0, `missing quote anchor: ${claimKind} ${value}`);
  const start = Math.max(0, index - 80);
  return excerpt.slice(start, Math.min(excerpt.length, index + keyword.length + 180));
}

function semanticRole(claimKind: DilutionIdentityClaimKind): DilutionSemanticRole | null {
  if (claimKind === "sales_agreement_date" || claimKind === "purchase_agreement_date") return "agreement_signing_date";
  if (claimKind === "original_issuance_or_closing_date") return "funding_date";
  if (claimKind === "expiration_date") return "expiration_date";
  return null;
}

function count(values: string[]) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}
