import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_PROXY_EVENT_TYPES, parseProxyFiling } from "./parser.ts";
import { buildProxyRouterPrompt, routeProxyFiling } from "./routerPrompt.ts";

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
  const decision = routeProxyFiling(parserOutput);
  const prompt = buildProxyRouterPrompt(parserOutput);

  assert.ok(
    APPROVED_PROXY_EVENT_TYPES.includes(decision.event_type),
    `${caseName}: router selected unapproved event_type ${decision.event_type}`,
  );

  if (expected.parser_output.facts.deterministic.canFinishWithoutLlm) {
    assert.equal(decision.stage, "parser", `${caseName}: deterministic case should finish at parser stage`);
    assert.equal(decision.usesLlm, false, `${caseName}: deterministic case should not require LLM`);
    assert.equal(decision.analysis_needed, false, `${caseName}: deterministic case should not need analysis LLM`);
    assert.equal(decision.preliminary_action, "archive", `${caseName}: deterministic routine case should archive`);
    assert.equal(
      decision.event_type,
      expected.analysis_output.event_type,
      `${caseName}: deterministic router selected the wrong event_type`,
    );
    assert.equal(decision.display_type, expected.display_payload.display_type, `${caseName}: deterministic router selected wrong display_type`);
  } else {
    assert.equal(decision.stage, "router", `${caseName}: non-deterministic case should route to analysis`);
    assert.equal(decision.usesLlm, true, `${caseName}: non-deterministic case should require analysis LLM`);
    assert.equal(decision.analysis_needed, true, `${caseName}: non-deterministic case should need analysis LLM`);
    assert.equal(decision.event_type, "other", `${caseName}: non-deterministic parser must not preselect event_type`);
    assert.equal(decision.display_type, "generic", `${caseName}: non-deterministic parser must not preselect display_type`);
  }
  assert.ok(decision.display_version.startsWith("proxy_"), `${caseName}: router display_version should be versioned`);

  for (const eventType of APPROVED_PROXY_EVENT_TYPES) {
    assert.ok(prompt.includes(`- ${eventType}`), `${caseName}: router prompt omitted ${eventType}`);
  }
  assert.ok(prompt.includes("Return compact JSON only"), `${caseName}: router prompt should require JSON`);
  assert.ok(prompt.includes("cleaned_source_blocks_input"), `${caseName}: router prompt should use cleaned source blocks`);
  assert.ok(!prompt.includes('"raw":'), `${caseName}: router prompt should not receive full raw parser payload`);
  assert.ok(!prompt.includes('"facts":'), `${caseName}: router prompt should not receive parser facts`);
  assert.ok(!prompt.includes('"signals":'), `${caseName}: router prompt should not receive parser signals`);
  assert.ok(!prompt.includes('"eventType":'), `${caseName}: router prompt should not receive parser event labels`);
}

console.log(`router.test.ts: ${CASES.length} fixture cases passed`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(currentDir, relativePath), "utf8"));
}
