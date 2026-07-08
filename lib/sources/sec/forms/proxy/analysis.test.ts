import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_PROXY_EVENT_TYPES, parseProxyFiling } from "./parser.ts";
import {
  buildProxyAnalysisPrompt,
  buildProxyLlmRouterPlaceholder,
} from "./analysisPrompt.ts";

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
  const parserOutput = parseProxyFiling(fixture.input);
  const routerDecision = buildProxyLlmRouterPlaceholder();
  const prompt = buildProxyAnalysisPrompt({
    parserOutput,
    routerDecision,
    marketContext: fixture.input.market_context ?? null,
  });

  for (const eventType of APPROVED_PROXY_EVENT_TYPES) {
    assert.ok(prompt.includes(`- ${eventType}`), `${caseName}: analysis prompt omitted ${eventType}`);
  }
  assert.ok(prompt.includes("Do not call live market data"), `${caseName}: prompt should block live market data`);
  assert.ok(prompt.includes("Choose event_type yourself from the source blocks."), `${caseName}: prompt should require LLM event routing`);
  assert.ok(prompt.includes("Always use display_payload.display_type = proxy_vote"), `${caseName}: prompt should force unified proxy vote UI`);
  assert.ok(prompt.includes("display_payload.data.proposals: the visible agenda table"), `${caseName}: prompt should include display payload contract`);
  assert.ok(prompt.includes("Always include score_explanation"), `${caseName}: prompt should require score explanation for the visible score rationale UI`);
  assert.ok(!prompt.includes("score_explanation is not in this schema"), `${caseName}: prompt must not suppress score explanation`);
  assert.ok(!prompt.includes("prebuilt_display_payload"), `${caseName}: prompt should not include full prebuilt display payload`);
  const sourceInput = prompt.slice(prompt.indexOf("cleaned_source_blocks:"));
  assert.ok(!sourceInput.includes('"facts":'), `${caseName}: source input should not include parser facts`);
  assert.ok(!sourceInput.includes('"signals":'), `${caseName}: source input should not include parser signals`);
  assert.ok(!sourceInput.includes('"eventType":'), `${caseName}: source input should not include parser event labels`);
}

console.log(`analysis.test.ts: ${CASES.length} fixture cases passed`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(currentDir, relativePath), "utf8"));
}
