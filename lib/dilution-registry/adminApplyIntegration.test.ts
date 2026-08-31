import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "app/api/admin/data/dilution-registry/apply/route.ts",
  "utf8",
);
const server = readFileSync(
  "lib/dilution-registry/humanVerifiedOsServer.ts",
  "utf8",
);
const applyServer = readFileSync(
  "lib/dilution-registry/applyServer.ts",
  "utf8",
);

test("Admin Apply requires data.run and uses only the authenticated server user UUID", () => {
  assert.match(route, /assertSameOriginAuthRequest\(request\)/);
  assert.match(route, /resolveAdminApiAccess\(request, "data\.run"\)/);
  assert.match(route, /const approverUserId = resolution\.auth\.user\?\.id/);
  assert.match(route, /applyDilutionRegistryAndHumanVerifiedOsOnServer\([\s\S]*approverUserId/);
  assert.doesNotMatch(route, /request[^\n]*(?:plan|verified|approver)/i);
  assert.doesNotMatch(route, /data\.read/);
});

test("the server path reuses the existing human writer and independent Registry RPC", () => {
  assert.match(
    applyServer,
    /const approvedAt = \(input\.now \?\? \(\(\) => new Date\(\)\)\)\(\)\.toISOString\(\);/,
  );
  assert.match(
    applyServer,
    /approval:\s*\{\s*approverUserId: input\.approverUserId,\s*approvedAt,\s*\},\s*ingestedAt: approvedAt,/,
  );
  assert.match(
    applyServer,
    /registryDependencies:\s*\{\s*rpc: supabaseRpc,\s*now: \(\) => new Date\(approvedAt\),\s*runCorporateActionAdjustmentForIssuer: \(input\) =>\s*runDilutionCorporateActionAdjustmentForIssuer\(input\),\s*\}/,
  );
  assert.match(applyServer, /writeSharesOutstanding: applyHumanVerifiedOsOnServer/);
  assert.match(server, /writeHumanVerifiedShareCountObservation\(input/);
  assert.match(server, /readSourceBundle: readDilutionRegistryOsSourceBundle/);
  assert.match(server, /toShareCountHistoryDatabaseRow\(observation\)/);
  assert.match(server, /resolution=ignore-duplicates,return=representation/);
  assert.match(server, /source_kind,source_identity,content_hash/);
});

test("Admin O/S persistence creates no fallback run, event, analyzer, or permission identities", () => {
  const combined = `${route}\n${server}\n${applyServer}`;
  assert.doesNotMatch(combined, /rawItemId|eventId|aiRun|sourceExecution|sourceAnalyzer/);
  assert.doesNotMatch(combined, /randomUUID|crypto\.randomUUID|fake/i);
  assert.doesNotMatch(combined, /create.*permission|admin_roles|plan/i);
});
