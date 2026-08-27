import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  persistEconomicExposureIdentityObservations,
  validateEconomicExposurePersistenceObservation,
  type EconomicExposurePersistenceDependencies,
} from "./economicExposurePersistence.ts";
import {
  DILUTION_EVIDENCE_IDENTITY_VERSION,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  type DilutionIdentityClaim,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";

const ACCESSION = "0001234567-26-000001";
const OBSERVATION_KEY = `economic-observation:v1:${"a".repeat(64)}`;
const EXPOSURE_A = `economic-exposure:v1:${"b".repeat(64)}`;
const EXPOSURE_B = `economic-exposure:v1:${"c".repeat(64)}`;

test("CREATE_NEW sends the locked resolver result and accepts one atomic exposure/observation target", async () => {
  const observation = identityObservation([claim("designation_or_tranche", "Series A Note")]);
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await persistEconomicExposureIdentityObservations({
    observations: [observation],
    dependencies: rpcSequence(calls, [
      context([]),
      writeResult("saved", "CREATE_NEW", EXPOSURE_A),
    ]),
  });

  assert.equal(result.status, "saved");
  assert.equal(result.savedCount, 1);
  assert.equal(result.rows[0]?.decision, "CREATE_NEW");
  assert.equal(result.rows[0]?.targetExposureId, EXPOSURE_A);
  assert.deepEqual(calls.map((call) => call.name), [
    "read_dilution_exposure_resolution_context",
    "persist_dilution_exposure_resolution_v1",
  ]);
  const resolution = calls[1]?.payload.p_resolution as Record<string, unknown>;
  assert.equal(resolution.decision, "CREATE_NEW");
  assert.equal(resolution.target_exposure_id, null);
});

test("LINK_EXISTING persists only the exact target and never sends canonical promotion fields", async () => {
  const original = claim("designation_or_tranche", "Series A Note", "0".repeat(64));
  const observation = identityObservation([claim("designation_or_tranche", "Series A Note")], {
    accession: "0001234567-26-000002",
  });
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await persistEconomicExposureIdentityObservations({
    observations: [observation],
    dependencies: rpcSequence(calls, [
      context([candidate(EXPOSURE_A, [original])]),
      writeResult("saved", "LINK_EXISTING", EXPOSURE_A),
    ]),
  });

  assert.equal(result.rows[0]?.decision, "LINK_EXISTING");
  assert.equal(result.rows[0]?.targetExposureId, EXPOSURE_A);
  const writePayload = calls[1]?.payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(writePayload).sort(), ["p_observation", "p_resolution"]);
  assert.doesNotMatch(JSON.stringify(writePayload), /promotion|current_terms|conversion_price|balance/i);
});

test("AMEND_EXISTING records the amendment against the exact original without a new exposure", async () => {
  const targetReference = "Streeterville Warrant dated March 17, 2026";
  const observation = identityObservation([claim("amendment_reference", targetReference)], {
    accession: "0001234567-26-000003",
    exposureType: "warrant",
    observationKind: "exposure_amendment",
  });
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await persistEconomicExposureIdentityObservations({
    observations: [observation],
    dependencies: rpcSequence(calls, [
      context([candidate(EXPOSURE_A, [
        claim("original_instrument_reference", targetReference, "1".repeat(64)),
      ], "warrant")]),
      writeResult("saved", "AMEND_EXISTING", EXPOSURE_A),
    ]),
  });

  assert.equal(result.rows[0]?.decision, "AMEND_EXISTING");
  assert.equal(result.rows[0]?.targetExposureId, EXPOSURE_A);
});

test("UNRESOLVED and CONFLICT preserve distinct null-target decisions", async () => {
  const unresolved = identityObservation([claim("holder_or_investor", "Investor A")], {
    accession: "0001234567-26-000004",
  });
  const conflict = identityObservation([claim("designation_or_tranche", "Series A Note")], {
    accession: "0001234567-26-000005",
  });
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await persistEconomicExposureIdentityObservations({
    observations: [unresolved, conflict],
    dependencies: rpcSequence(calls, [
      context([], "d"),
      writeResult("saved", "UNRESOLVED", null, "d"),
      context([
        candidate(EXPOSURE_A, [claim("designation_or_tranche", "Series A Note", "2".repeat(64))]),
        candidate(EXPOSURE_B, [claim("designation_or_tranche", "Series A Note", "3".repeat(64))]),
      ], "e"),
      writeResult("saved", "CONFLICT", null, "e"),
    ]),
  });

  assert.deepEqual(result.rows.map((row) => [row.decision, row.targetExposureId]), [
    ["UNRESOLVED", null],
    ["CONFLICT", null],
  ]);
});

test("all decision replays stop before Resolver/write when the deterministic observation already exists", async () => {
  const cases = [
    ["CREATE_NEW", EXPOSURE_A],
    ["LINK_EXISTING", EXPOSURE_A],
    ["AMEND_EXISTING", EXPOSURE_A],
    ["UNRESOLVED", null],
    ["CONFLICT", null],
  ] as const;
  for (const [decision, target] of cases) {
    let calls = 0;
    const result = await persistEconomicExposureIdentityObservations({
      observations: [identityObservation([claim("designation_or_tranche", "Series Replay")])],
      dependencies: {
        async rpc(name) {
          calls += 1;
          assert.equal(name, "read_dilution_exposure_resolution_context");
          return {
            ok: true,
            status: 200,
            data: {
              status: "already_persisted",
              observation_key: OBSERVATION_KEY,
              decision,
              target_exposure_id: target,
            },
          };
        },
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "idempotent");
    assert.equal(result.rows[0]?.decision, decision);
  }
});

test("malformed evidence and incomplete batches fail before any DB call", async () => {
  const malformed = structuredClone(identityObservation([claim("designation_or_tranche", "Series A Note")])) as unknown as {
    identity_claims: Array<{ evidence_identity: { source_content_hash: string } }>;
  };
  malformed.identity_claims[0]!.evidence_identity.source_content_hash = "bad";
  let calls = 0;
  await assert.rejects(
    persistEconomicExposureIdentityObservations({
      observations: [identityObservation([claim("designation_or_tranche", "Valid")]), malformed],
      dependencies: { async rpc() { calls += 1; throw new Error("must not run"); } },
    }),
    /evidence_identity is invalid/,
  );
  assert.equal(calls, 0);
});

test("wrong-issuer, malformed, and non-registry candidates fail closed before persistence", async () => {
  const observation = identityObservation([claim("designation_or_tranche", "Series A Note")]);
  for (const badCandidate of [
    { ...candidate(EXPOSURE_A, [claim("designation_or_tranche", "Series A Note")]), issuer_cik: "0007654321" },
    { ...candidate(EXPOSURE_A, [claim("designation_or_tranche", "Series A Note")]), exposure_id: "legacy-id" },
    { ...candidate(EXPOSURE_A, [claim("designation_or_tranche", "Series A Note")]), identity_claims: [{}] },
  ]) {
    let calls = 0;
    await assert.rejects(persistEconomicExposureIdentityObservations({
      observations: [observation],
      dependencies: {
        async rpc(name) {
          calls += 1;
          assert.equal(name, "read_dilution_exposure_resolution_context");
          return context([badCandidate]);
        },
      },
    }), /candidate|context/i);
    assert.equal(calls, 1);
  }
});

test("persistence RPC errors surface clearly without fallback or alternate target", async () => {
  const observation = identityObservation([claim("designation_or_tranche", "Series A Note")]);
  await assert.rejects(persistEconomicExposureIdentityObservations({
    observations: [observation],
    dependencies: rpcSequence([], [context([]), {
      ok: false,
      status: 400,
      data: null,
      error: "dilution resolver target does not exist",
    }]),
  }), /target does not exist/);
});

test("migration and ingest integration stay server-only, diagnostic-only, and outside the locked resolver", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260827165844_economic_exposure_registry_source_observation_persistence_v1_candidate.sql", import.meta.url),
    "utf8",
  );
  const ingest = readFileSync(new URL("../secFilingAnalysisIngest.ts", import.meta.url), "utf8");
  const resolver = readFileSync(new URL("./economicExposureIdentityResolver.ts", import.meta.url), "utf8");
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.dilution_economic_exposure_registry_v1[\s\S]*service_role/);
  assert.match(migration, /grant execute on function public\.persist_dilution_exposure_resolution_v1[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*to\s+(?:anon|authenticated)/i);
  assert.doesNotMatch(migration, /potential_shares|dilution_percent|current_conversion_price|current_balance|lifecycle_status|reviewer_id|approved_at/i);
  assert.match(ingest, /persistEconomicExposureIdentityObservations\([\s\S]*economicExposureIdentityObservations/);
  assert.match(ingest, /withoutEconomicExposureIdentitySidecar\(analysisRun\.outputText\)/);
  assert.doesNotMatch(ingest, /analysis:\s*\{[\s\S]{0,200}economicExposurePersistence/);
  assert.match(resolver, /Pure comparison of source-backed claims/);
});

test("observation validator rejects invalid enums, extra fields, non-null targets, and source refs without accession", () => {
  const base = identityObservation([claim("designation_or_tranche", "Series A Note")]);
  const invalids = [
    { ...base, exposure_type: "note" },
    { ...base, observation_kind: "terms_update" },
    { ...base, exposure_id: EXPOSURE_A },
    { ...base, extra: true },
    {
      ...base,
      identity_claims: [{
        ...base.identity_claims[0],
        evidence_identity: { ...base.identity_claims[0]!.evidence_identity, source_ref: "analysis-source:other:0" },
      }],
    },
  ];
  invalids.forEach((value) => assert.ok(validateEconomicExposurePersistenceObservation(value).length > 0));
});

function identityObservation(
  claims: readonly DilutionIdentityClaim[],
  options: {
    accession?: string;
    exposureType?: DilutionSourceObservation["exposure_type"];
    observationKind?: DilutionSourceObservation["observation_kind"];
  } = {},
): DilutionSourceObservation {
  return {
    version: DILUTION_SOURCE_OBSERVATION_VERSION,
    issuer_cik: "0001234567",
    accession: options.accession || ACCESSION,
    form: "8-K",
    filed_date: "2026-08-27",
    accepted_at: null,
    analysis_lineage: null,
    exposure_id: null,
    exposure_type: options.exposureType || "convertible_note",
    observation_kind: options.observationKind || "exposure_identity",
    observed_fields: [],
    identity_claims: claims.map((item) => ({
      ...item,
      evidence_identity: {
        ...item.evidence_identity,
        source_ref: `analysis-source:${options.accession || ACCESSION}:0`,
      },
    })),
    status: "VALIDATED",
  };
}

function claim(kind: DilutionIdentityClaim["claim_kind"], value: string, hash = "f".repeat(64)): DilutionIdentityClaim {
  const semanticRole = kind === "original_issuance_or_closing_date"
    ? "instrument_issuance_date"
    : kind === "expiration_date"
      ? "expiration_date"
      : kind === "sales_agreement_date" || kind === "purchase_agreement_date"
        ? "agreement_signing_date"
        : null;
  return {
    version: DILUTION_IDENTITY_CLAIM_VERSION,
    claim_kind: kind,
    value,
    semantic_role: semanticRole,
    evidence_identity: {
      version: DILUTION_EVIDENCE_IDENTITY_VERSION,
      source_ref: `analysis-source:${ACCESSION}:0`,
      range_start: 0,
      range_end: 10,
      source_content_hash: hash || createHash("sha256").update(value).digest("hex"),
      exact_source: true,
    },
  };
}

function candidate(
  exposureId: string,
  claims: readonly DilutionIdentityClaim[],
  exposureType: "convertible_note" | "warrant" = "convertible_note",
) {
  return {
    exposure_id: exposureId,
    issuer_cik: "0001234567",
    exposure_type: exposureType,
    identity_claims: claims,
    registration_canonical_keys: [],
  };
}

function context(candidates: readonly unknown[], keyChar = "a") {
  return {
    ok: true,
    status: 200,
    data: {
      status: "ready",
      observation_key: `economic-observation:v1:${keyChar.repeat(64)}`,
      candidates,
    },
  };
}

function writeResult(
  status: "saved" | "idempotent",
  decision: string,
  target: string | null,
  keyChar = "a",
) {
  return {
    ok: true,
    status: 200,
    data: {
      status,
      observation_key: `economic-observation:v1:${keyChar.repeat(64)}`,
      decision,
      target_exposure_id: target,
    },
  };
}

function rpcSequence(
  calls: Array<{ name: string; payload: Record<string, unknown> }>,
  responses: Array<{ ok: boolean; status: number; data: unknown; error?: string }>,
): EconomicExposurePersistenceDependencies {
  return {
    async rpc(name, payload) {
      calls.push({ name, payload });
      const response = responses.shift();
      if (!response) throw new Error("unexpected RPC call");
      return response;
    },
  };
}
