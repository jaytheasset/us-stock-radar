import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_PROXY_EVENT_TYPES, parseProxyFiling } from "./parser.ts";
import {
  assertRequiredProxyOutputShape,
  buildDeterministicProxyAnalysis,
  buildProxyAnalysisPrompt,
  buildProxyLlmDisplayPayloadPlaceholder,
  deriveDeliveryLevel,
} from "./analysisPrompt.ts";
import { routeProxyFiling } from "./routerPrompt.ts";

const CASES = [
  "annual-meeting-routine",
  "special-meeting-merger-vote",
  "equity-plan-dilution",
  "insider-control-ownership",
  "shareholder-proposal-legal-risk",
  "governance-board-declassification",
  "preliminary-reverse-split",
  "director-nominee-withdrawal-supplement",
  "third-party-contested-solicitation",
  "notice-only-additional-material",
  "preliminary-merger-proxy",
  "additional-material-authorized-share-increase",
];

const currentDir = path.dirname(fileURLToPath(import.meta.url));

for (const caseName of CASES) {
  const fixture = readJson(`fixtures/${caseName}.json`);
  const expected = readJson(`expected/${caseName}.expected.json`);
  const parserOutput = parseProxyFiling(fixture.input);
  const routerDecision = routeProxyFiling(parserOutput);
  const displayPayload = buildProxyLlmDisplayPayloadPlaceholder();
  const prompt = buildProxyAnalysisPrompt({
    parserOutput,
    routerDecision,
    displayPayload,
    marketContext: fixture.input.market_context ?? null,
  });

  assert.doesNotThrow(
    () => assertRequiredProxyOutputShape(expected),
    `${caseName}: expected output must follow required proxy JSON shape`,
  );
  assert.equal(
    deriveDeliveryLevel(expected.analysis_output.score),
    expected.fixture_expected.expected_delivery_level,
    `${caseName}: delivery level must derive from score band`,
  );

  for (const eventType of APPROVED_PROXY_EVENT_TYPES) {
    assert.ok(prompt.includes(`- ${eventType}`), `${caseName}: analysis prompt omitted ${eventType}`);
  }
  assert.ok(prompt.includes("Do not call live market data"), `${caseName}: prompt should block live market data`);
  assert.ok(prompt.includes("Choose event_type, display_payload.display_type, and display_payload.display_version yourself"), `${caseName}: prompt should require LLM display routing`);
  assert.ok(prompt.includes("Required display_payload.data keys by display_version"), `${caseName}: prompt should include display payload contract`);
  assert.ok(prompt.includes("score_explanation is required"), `${caseName}: prompt should require score explanation for the visible score rationale UI`);
  assert.ok(!prompt.includes("score_explanation is not in this schema"), `${caseName}: prompt must not suppress score explanation`);
  assert.ok(!prompt.includes("prebuilt_display_payload"), `${caseName}: prompt should not include full prebuilt display payload`);
  const sourceInput = prompt.slice(prompt.indexOf("cleaned_source_blocks:"));
  assert.ok(!sourceInput.includes('"facts":'), `${caseName}: source input should not include parser facts`);
  assert.ok(!sourceInput.includes('"signals":'), `${caseName}: source input should not include parser signals`);
  assert.ok(!sourceInput.includes('"eventType":'), `${caseName}: source input should not include parser event labels`);
  assert.equal(displayPayload.display_type, "generic", `${caseName}: parser must not preselect display_type`);
  assert.equal(displayPayload.display_version, "proxy_generic_v1", `${caseName}: placeholder display payload should stay generic`);

  const deterministicAnalysis = buildDeterministicProxyAnalysis(parserOutput);
  if (expected.parser_output.facts.deterministic.canFinishWithoutLlm) {
    assert.deepStrictEqual(
      deterministicAnalysis,
      expected.analysis_output,
      `${caseName}: deterministic analysis output changed`,
    );
  } else {
    assert.equal(deterministicAnalysis, null, `${caseName}: non-deterministic case should use analysis prompt`);
  }
}

console.log(`analysis.test.ts: ${CASES.length} fixture cases passed`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(currentDir, relativePath), "utf8"));
}
