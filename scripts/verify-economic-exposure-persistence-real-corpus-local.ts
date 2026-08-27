import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  DILUTION_EVIDENCE_IDENTITY_VERSION,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  type DilutionEvidenceIdentity,
  type DilutionExposureType,
  type DilutionIdentityClaim,
  type DilutionSourceObservation,
} from "../lib/dilution/economicExposureContracts.ts";
import {
  persistEconomicExposureIdentityObservations,
  type EconomicExposurePersistenceDependencies,
} from "../lib/dilution/economicExposurePersistence.ts";
import {
  resolveExposureIdentity,
  type EconomicExposureIdentityCandidate,
} from "../lib/dilution/economicExposureIdentityResolver.ts";

type LocalPgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(query: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};
const { Client } = createRequire(import.meta.url)("pg") as {
  Client: new (options: { connectionString: string }) => LocalPgClient;
};

const RECOVERY_ROOT = process.env.STOCK_RADAR_RECOVERY_CORPUS
  || "C:/Users/PC/Documents/Stock-Radar-Recovery/validation-corpus-v1";
const GOLD_PATH = path.join(RECOVERY_ROOT, "logs/dilution-identity-focused-gold-v2.json");
const GOLD_SHA_PATH = path.join(RECOVERY_ROOT, "logs/dilution-identity-focused-gold-v2.sha256.txt");
const FROZEN_RESULT_PATH = path.join(RECOVERY_ROOT, "logs/dilution-identity-focused-sequential-validation-v2.json");
const DATABASE_URL = process.env.ECONOMIC_EXPOSURE_DATABASE_URL;
if (!DATABASE_URL) throw new Error("ECONOMIC_EXPOSURE_DATABASE_URL is required for the isolated candidate database");

type GoldObservation = {
  observation_id: string;
  issuer: "IPW" | "AMSS" | "VEEA";
  accession: string;
  form: string;
  filing_date: string;
  source_file: string;
  source_sha256: string;
  evidence_location: { locator_phrase: string };
  gold_action: "NEW_DISTINCT" | "SAME_EXISTING" | "AMENDMENT_OF_EXISTING";
  gold_target: string | null;
  performance_group: "MUST-MERGE" | "MUST-NOT-MERGE";
};

type GoldCorpus = {
  frozen: boolean;
  resolver_accessed_or_executed_before_freeze: boolean;
  summary: {
    gold_exposures: number;
    observations: number;
    actions: Record<string, number>;
  };
  observations: GoldObservation[];
  gold_disputes: unknown[];
};

type IdentityDefinition = {
  type: DilutionExposureType;
  claims: Array<[DilutionIdentityClaim["claim_kind"], string]>;
};

const issuerCik = { IPW: "0001830072", AMSS: "0001851491", VEEA: "0001840317" } as const;
const createdExposure: Record<string, string> = {
  "IPW-01": "IPW-NOTE-A-INITIAL-20251222",
  "IPW-02": "IPW-NOTE-B-INITIAL-20251222",
  "IPW-03": "IPW-NOTE-A-20260210",
  "IPW-04": "IPW-NOTE-A-20260519",
  "IPW-05": "IPW-NOTE-A-20260706",
  "AMSS-01": "AMSS-WARRANT-STREETERVILLE-20260317",
  "AMSS-02": "AMSS-WARRANT-ALCHEMI-20260213",
  "VEEA-01": "VEEA-PREFERRED-A-20260330",
  "VEEA-02": "VEEA-WARRANT-NLABS-20260330",
  "VEEA-03": "VEEA-PREFERRED-A1-20260625",
  "VEEA-04": "VEEA-WARRANT-NLABS-20260625",
};

// These are the frozen runner's source-backed identity units. They are test
// fixtures only: no values are calculated, normalized, or promoted.
const identities: Record<string, IdentityDefinition> = {
  "IPW-NOTE-A-INITIAL-20251222": { type: "convertible_note", claims: [
    ["agreement_reference", "Securities Purchase Agreement dated December 22, 2025"],
    ["designation_or_tranche", "Series A Convertible Note issued December 23, 2025"],
    ["original_issuance_or_closing_date", "2025-12-23"],
    ["holder_or_investor", "institutional investor"], ["principal", "5184024"],
  ] },
  "IPW-NOTE-B-INITIAL-20251222": { type: "convertible_note", claims: [
    ["agreement_reference", "Securities Purchase Agreement dated December 22, 2025"],
    ["designation_or_tranche", "Series B Convertible Note issued December 23, 2025"],
    ["original_issuance_or_closing_date", "2025-12-23"],
    ["holder_or_investor", "institutional investor"], ["principal", "1815976"],
  ] },
  "IPW-NOTE-A-20260210": { type: "convertible_note", claims: [
    ["agreement_reference", "Securities Purchase Agreement dated December 22, 2025"],
    ["designation_or_tranche", "Series A Convertible Note issued February 10, 2026"],
    ["original_issuance_or_closing_date", "2026-02-10"],
    ["holder_or_investor", "institutional investor"], ["principal", "2000000"],
  ] },
  "IPW-NOTE-A-20260519": { type: "convertible_note", claims: [
    ["agreement_reference", "Securities Purchase Agreement dated December 22, 2025"],
    ["designation_or_tranche", "Series A Convertible Note issued May 19, 2026"],
    ["original_issuance_or_closing_date", "2026-05-19"],
    ["holder_or_investor", "institutional investor"], ["principal", "3000000"],
  ] },
  "IPW-NOTE-A-20260706": { type: "convertible_note", claims: [
    ["agreement_reference", "Securities Purchase Agreement dated December 22, 2025"],
    ["designation_or_tranche", "Series A Convertible Note issued July 6, 2026"],
    ["original_issuance_or_closing_date", "2026-07-06"],
    ["holder_or_investor", "institutional investor"], ["principal", "2000000"],
  ] },
  "AMSS-WARRANT-STREETERVILLE-20260317": { type: "warrant", claims: [
    ["original_instrument_reference", "Streeterville Warrant issued under March 17, 2026 Securities Purchase Agreement"],
    ["agreement_reference", "Securities Purchase Agreement dated March 17, 2026"],
    ["original_issuance_or_closing_date", "2026-03-17"],
    ["holder_or_investor", "Streeterville Capital, LLC"], ["underlying_share_quantity", "3500000"],
  ] },
  "AMSS-WARRANT-ALCHEMI-20260213": { type: "warrant", claims: [
    ["original_instrument_reference", "Alchemi Warrant dated February 13, 2026"],
    ["agreement_reference", "Convertible Note Purchase Agreement dated February 13, 2026"],
    ["original_issuance_or_closing_date", "2026-02-13"],
    ["holder_or_investor", "Alchemi Project Inc. / MVL Inc."],
  ] },
  "VEEA-PREFERRED-A-20260330": { type: "convertible_preferred", claims: [
    ["series_or_designation", "Series A Convertible Preferred Stock"],
    ["certificate_of_designation_reference", "Certificate of Designation of Series A Convertible Preferred Stock dated March 30, 2026"],
    ["original_issuance_or_closing_date", "2026-03-30"],
  ] },
  "VEEA-WARRANT-NLABS-20260330": { type: "warrant", claims: [
    ["original_instrument_reference", "NLabs Common Warrant issued March 30, 2026"],
    ["agreement_reference", "First Amendatory Agreement to Demand Notes dated March 30, 2026"],
    ["original_issuance_or_closing_date", "2026-03-30"],
    ["holder_or_investor", "NLabs Inc."], ["underlying_share_quantity", "33551486"],
  ] },
  "VEEA-PREFERRED-A1-20260625": { type: "convertible_preferred", claims: [
    ["series_or_designation", "Series A-1 Convertible Preferred Stock"],
    ["certificate_of_designation_reference", "Certificate of Designation of Series A-1 Convertible Preferred Stock dated June 25, 2026"],
    ["original_issuance_or_closing_date", "2026-06-25"],
  ] },
  "VEEA-WARRANT-NLABS-20260625": { type: "warrant", claims: [
    ["original_instrument_reference", "NLabs Common Warrant issued June 25, 2026"],
    ["agreement_reference", "Note Conversion Agreement dated June 25, 2026"],
    ["original_issuance_or_closing_date", "2026-06-25"],
    ["holder_or_investor", "NLabs Inc."], ["underlying_share_quantity", "13331969"],
  ] },
};

const goldBytes = fs.readFileSync(GOLD_PATH);
const goldSha = crypto.createHash("sha256").update(goldBytes).digest("hex");
assert.equal(goldSha, fs.readFileSync(GOLD_SHA_PATH, "utf8").trim().split(/\s+/)[0]);
const gold = JSON.parse(goldBytes.toString("utf8")) as GoldCorpus;
const frozenResult = JSON.parse(fs.readFileSync(FROZEN_RESULT_PATH, "utf8"));
assert.equal(gold.frozen, true);
assert.equal(gold.resolver_accessed_or_executed_before_freeze, false);
assert.deepEqual(gold.gold_disputes, []);
assert.equal(gold.observations.length, gold.summary.observations);

const observations = gold.observations.map((item) => ({ gold: item, observation: lockedObservation(item) }));
const oracle = runResolverMode("ORACLE");
const selfPropagating = runResolverMode("SELF_PROPAGATING");
const combined = [...oracle.rows, ...selfPropagating.rows];
const combinedMetrics = metrics(combined);
const groups = groupPerformance(combined);
assert.equal(
  oracle.rows.filter((row) => row.pass).length,
  29,
  JSON.stringify(oracle.rows.filter((row) => !row.pass)),
);
assert.equal(
  selfPropagating.rows.filter((row) => row.pass).length,
  29,
  JSON.stringify(selfPropagating.rows.filter((row) => !row.pass)),
);
assert.equal(combined.filter((row) => row.replayStable).length, 58);
assert.deepEqual(combinedMetrics, frozenResult.combined_metrics);
assert.equal(groups.mustMergePass, 36);
assert.equal(groups.mustNotMergePass, 22);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query("insert into public.sec_issuers(cik) values ($1),($2),($3) on conflict do nothing", Object.values(issuerCik));
  const dependencies = postgresRpc(client);
  const databaseExposureByGoldId = new Map<string, string>();
  const firstPass = [];

  for (const item of observations) {
    const result = await persistEconomicExposureIdentityObservations({
      observations: [item.observation],
      dependencies,
    });
    const row = result.rows[0]!;
    const expectedDecision = expectedDecisionFor(item.gold.gold_action);
    assert.equal(row.status, "saved", `first persistence ${item.gold.observation_id}`);
    assert.equal(row.decision, expectedDecision, item.gold.observation_id);
    if (item.gold.gold_action === "NEW_DISTINCT") {
      assert.ok(row.targetExposureId);
      databaseExposureByGoldId.set(createdExposure[item.gold.observation_id]!, row.targetExposureId);
    } else {
      assert.equal(row.targetExposureId, databaseExposureByGoldId.get(item.gold.gold_target!));
    }
    firstPass.push(row);
  }

  const countsAfterFirst = await readCounts(client);
  assert.equal(countsAfterFirst.exposures, gold.summary.actions.NEW_DISTINCT);
  assert.equal(countsAfterFirst.observations, gold.summary.observations);
  assert.deepEqual(countsAfterFirst.decisions, {
    AMEND_EXISTING: gold.summary.actions.AMENDMENT_OF_EXISTING,
    CREATE_NEW: gold.summary.actions.NEW_DISTINCT,
    LINK_EXISTING: gold.summary.actions.SAME_EXISTING,
  });
  assert.equal(countsAfterFirst.canonicalClaimMismatches, 0);

  const replayRows = [];
  for (const item of observations) {
    const result = await persistEconomicExposureIdentityObservations({
      observations: [item.observation],
      dependencies,
    });
    assert.equal(result.status, "idempotent", `persistence replay ${item.gold.observation_id}`);
    replayRows.push(result.rows[0]);
  }
  const countsAfterReplay = await readCounts(client);
  assert.deepEqual(countsAfterReplay, countsAfterFirst);

  const special = {
    IPW: databaseExposureByGoldId.size >= 5
      && new Set([...databaseExposureByGoldId].filter(([id]) => id.startsWith("IPW-")).map(([, id]) => id)).size === 5,
    AMSS: databaseExposureByGoldId.get("AMSS-WARRANT-STREETERVILLE-20260317")
      !== databaseExposureByGoldId.get("AMSS-WARRANT-ALCHEMI-20260213"),
    VEEA: databaseExposureByGoldId.get("VEEA-PREFERRED-A-20260330")
      !== databaseExposureByGoldId.get("VEEA-PREFERRED-A1-20260625"),
  };
  assert.deepEqual(special, { IPW: true, AMSS: true, VEEA: true });

  console.log(JSON.stringify({
    corpus: { sha256: goldSha, observations: gold.observations.length, goldExposures: gold.summary.gold_exposures, disputes: 0 },
    resolver: {
      oracle: `${oracle.rows.filter((row) => row.pass).length}/29`,
      selfPropagating: `${selfPropagating.rows.filter((row) => row.pass).length}/29`,
      replay: `${combined.filter((row) => row.replayStable).length}/58`,
      mustMerge: `${groups.mustMergePass}/36`,
      mustNotMerge: `${groups.mustNotMergePass}/22`,
      errors: combinedMetrics,
    },
    persistence: {
      firstPass: `${firstPass.length}/29`,
      replayIdempotent: `${replayRows.length}/29`,
      countsAfterFirst,
      countsAfterReplay,
      special,
    },
  }, null, 2));
} finally {
  await client.end();
}

function lockedObservation(goldObservation: GoldObservation): DilutionSourceObservation {
  const id = createdExposure[goldObservation.observation_id] || goldObservation.gold_target;
  const definition = identities[id!];
  assert.ok(definition, `missing frozen identity ${id}`);
  const evidence = evidenceFor(goldObservation);
  const baseClaims = definition.claims.map(([kind, value]) => lockedClaim(kind, value, evidence));
  const identityClaims = goldObservation.gold_action === "AMENDMENT_OF_EXISTING"
    ? [
        lockedClaim(
          "amendment_reference",
          definition.claims.find(([kind]) => kind === "original_instrument_reference")![1],
          evidence,
        ),
        ...baseClaims.filter((claim) => claim.claim_kind !== "original_instrument_reference"),
      ]
    : baseClaims;
  return {
    version: DILUTION_SOURCE_OBSERVATION_VERSION,
    issuer_cik: issuerCik[goldObservation.issuer],
    accession: goldObservation.accession,
    form: goldObservation.form,
    filed_date: goldObservation.filing_date,
    accepted_at: null,
    analysis_lineage: null,
    exposure_id: null,
    exposure_type: definition.type,
    observation_kind: goldObservation.gold_action === "AMENDMENT_OF_EXISTING"
      ? "exposure_amendment"
      : "exposure_identity",
    observed_fields: [],
    identity_claims: identityClaims,
    status: "VALIDATED",
  };
}

function evidenceFor(goldObservation: GoldObservation): DilutionEvidenceIdentity {
  const sourceBytes = fs.readFileSync(goldObservation.source_file);
  assert.equal(
    crypto.createHash("sha256").update(sourceBytes).digest("hex"),
    goldObservation.source_sha256,
    `${goldObservation.observation_id} source SHA`,
  );
  const normalized = normalizeHtml(sourceBytes.toString("utf8"));
  const locator = goldObservation.evidence_location.locator_phrase;
  const start = normalized.toLowerCase().indexOf(locator.toLowerCase());
  assert.ok(start >= 0, `missing locator ${goldObservation.observation_id}`);
  const exact = normalized.slice(start, start + locator.length);
  return {
    version: DILUTION_EVIDENCE_IDENTITY_VERSION,
    source_ref: `recovery-sec:${goldObservation.accession}:normalized`,
    range_start: start,
    range_end: start + locator.length,
    source_content_hash: crypto.createHash("sha256").update(exact).digest("hex"),
    exact_source: true,
  };
}

function lockedClaim(
  kind: DilutionIdentityClaim["claim_kind"],
  value: string,
  evidence: DilutionEvidenceIdentity,
): DilutionIdentityClaim {
  return {
    version: DILUTION_IDENTITY_CLAIM_VERSION,
    claim_kind: kind,
    value,
    semantic_role: kind === "original_issuance_or_closing_date" ? "instrument_issuance_date" : null,
    evidence_identity: evidence,
  };
}

function runResolverMode(mode: "ORACLE" | "SELF_PROPAGATING") {
  const state = new Map<GoldObservation["issuer"], EconomicExposureIdentityCandidate[]>([
    ["IPW", []], ["AMSS", []], ["VEEA", []],
  ]);
  const rows = observations.map(({ gold: item, observation }) => {
    const before = [...state.get(item.issuer)!];
    const first = resolveExposureIdentity({ observation, candidateExposures: before });
    const replay = resolveExposureIdentity({ observation, candidateExposures: before });
    const replayStable = JSON.stringify(first) === JSON.stringify(replay);
    const expectedDecision = expectedDecisionFor(item.gold_action);
    const targetCorrect = expectedDecision === "LINK_EXISTING" || expectedDecision === "AMEND_EXISTING"
      ? first.target_exposure_id === item.gold_target
      : first.target_exposure_id === null;
    if (mode === "ORACLE" && item.gold_action === "NEW_DISTINCT") {
      state.get(item.issuer)!.push(candidate(createdExposure[item.observation_id]!, observation));
    } else if (mode === "SELF_PROPAGATING" && first.decision === "CREATE_NEW") {
      const exposureId = item.gold_action === "NEW_DISTINCT"
        ? createdExposure[item.observation_id]!
        : `SELF-${item.observation_id}`;
      state.get(item.issuer)!.push(candidate(exposureId, observation));
    }
    return {
      goldAction: item.gold_action,
      performanceGroup: item.performance_group,
      decision: first.decision,
      target: first.target_exposure_id,
      goldTarget: item.gold_target,
      replayStable,
      pass: first.decision === expectedDecision && targetCorrect,
    };
  });
  return { rows, state };
}

function candidate(exposureId: string, observation: DilutionSourceObservation): EconomicExposureIdentityCandidate {
  return {
    exposure_id: exposureId,
    issuer_cik: observation.issuer_cik,
    exposure_type: observation.exposure_type!,
    identity_claims: observation.identity_claims.filter((claim) => claim.claim_kind !== "amendment_reference"),
    registration_canonical_keys: [],
  };
}

function metrics(rows: ReturnType<typeof runResolverMode>["rows"]) {
  return {
    false_merge: rows.filter((row) => row.goldAction === "NEW_DISTINCT" && row.decision === "LINK_EXISTING").length,
    wrong_target_link: rows.filter((row) => row.goldAction === "SAME_EXISTING" && row.decision === "LINK_EXISTING" && row.target !== row.goldTarget).length,
    wrong_target_amendment: rows.filter((row) => row.goldAction === "AMENDMENT_OF_EXISTING" && row.decision === "AMEND_EXISTING" && row.target !== row.goldTarget).length,
    false_split: rows.filter((row) => row.goldAction !== "NEW_DISTINCT" && row.decision === "CREATE_NEW").length,
    missed_link: rows.filter((row) => row.goldAction === "SAME_EXISTING" && !(row.decision === "LINK_EXISTING" && row.target === row.goldTarget)).length,
    wrong_new: rows.filter((row) => row.goldAction !== "NEW_DISTINCT" && row.decision === "CREATE_NEW").length,
    unnecessary_unresolved: rows.filter((row) => row.decision === "UNRESOLVED").length,
    wrong_confident_identity: rows.filter((row) => ["CREATE_NEW", "LINK_EXISTING", "AMEND_EXISTING"].includes(row.decision) && !row.pass).length,
  };
}

function groupPerformance(rows: ReturnType<typeof runResolverMode>["rows"]) {
  return {
    mustMergePass: rows.filter((row) => row.performanceGroup === "MUST-MERGE" && row.pass).length,
    mustNotMergePass: rows.filter((row) => row.performanceGroup === "MUST-NOT-MERGE" && row.pass).length,
  };
}

function expectedDecisionFor(action: GoldObservation["gold_action"]) {
  return action === "NEW_DISTINCT"
    ? "CREATE_NEW" as const
    : action === "SAME_EXISTING"
      ? "LINK_EXISTING" as const
      : "AMEND_EXISTING" as const;
}

function postgresRpc(client: LocalPgClient): EconomicExposurePersistenceDependencies {
  return {
    async rpc(functionName, payload) {
      try {
        const query = functionName === "read_dilution_exposure_resolution_context"
          ? "select public.read_dilution_exposure_resolution_context($1::jsonb) as data"
          : functionName === "persist_dilution_exposure_resolution_v1"
            ? "select public.persist_dilution_exposure_resolution_v1($1::jsonb, $2::jsonb) as data"
            : null;
        if (!query) throw new Error(`unexpected RPC ${functionName}`);
        const values = functionName === "read_dilution_exposure_resolution_context"
          ? [JSON.stringify(payload.p_observation)]
          : [JSON.stringify(payload.p_observation), JSON.stringify(payload.p_resolution)];
        const response = await client.query(query, values);
        return { ok: true, status: 200, data: response.rows[0]?.data };
      } catch (error) {
        return { ok: false, status: 400, data: null, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

async function readCounts(client: LocalPgClient) {
  const response = await client.query(`
    select
      (select count(*)::integer from public.dilution_economic_exposure_registry_v1) as exposures,
      (select count(*)::integer from public.dilution_source_observations_v1) as observations,
      (select coalesce(jsonb_object_agg(decision, count), '{}'::jsonb)
       from (select resolver_decision as decision, count(*)::integer as count
             from public.dilution_source_observations_v1 group by resolver_decision) grouped) as decisions,
      (select count(*)::integer
       from public.dilution_economic_exposure_registry_v1 exposure
       join public.dilution_source_observations_v1 observation
         on observation.observation_key = exposure.created_from_observation_key
       where exposure.canonical_identity_claims is distinct from observation.observation_payload->'identity_claims')
        as canonical_claim_mismatches
  `);
  const row = response.rows[0];
  return {
    exposures: row.exposures as number,
    observations: row.observations as number,
    decisions: row.decisions as Record<string, number>,
    canonicalClaimMismatches: row.canonical_claim_mismatches as number,
  };
}

function normalizeHtml(text: string) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
