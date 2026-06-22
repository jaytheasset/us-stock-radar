import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser";
import { parseSecPeriodicReport } from "./parser";
import {
  SEC_PERIODIC_REPORTS_ROUTER_ACTION_VALUES,
  SEC_PERIODIC_REPORTS_ROUTER_DELIVERY_LEVEL_VALUES,
  SEC_PERIODIC_REPORTS_ROUTER_DISPLAY_TYPES,
  SEC_PERIODIC_REPORTS_ROUTER_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ROUTER_PROMPT_VERSION,
  buildSecPeriodicReportsRouterPromptDraft,
  secPeriodicReportsRouterResponseSchema,
  secPeriodicReportsRouterSystemPrompt,
} from "./routerPrompt";
import { APPROVED_SEC_EVENT_TYPES, PERIODIC_REPORTS_FORM_SCOPE } from "./types";

type Fixture = {
  filing: SecPeriodicReportParseInput;
  market_context?: Record<string, unknown> | null;
};

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "periodic-reports");
const fixtureNames = [
  "routine-10q-earnings",
  "going-concern-10k",
  "revenue-decline-10q",
  "legal-risk-20f",
  "dividend-buyback-10q",
  "foreign-issuer-20f",
  "routine-amendment-10qa",
];

const eventTypeEnum = secPeriodicReportsRouterResponseSchema.properties.event_type.enum;
assert.deepEqual(eventTypeEnum, APPROVED_SEC_EVENT_TYPES, "router schema must use only the approved 16 event types");
assert.ok(eventTypeEnum.includes("ipo_listing"), "router schema includes ipo_listing");
assert.deepEqual(SEC_PERIODIC_REPORTS_ROUTER_ACTION_VALUES, ["archive", "feed", "alert"], "router action bands");
assert.deepEqual(SEC_PERIODIC_REPORTS_ROUTER_DELIVERY_LEVEL_VALUES, ["archive", "feed", "alert"], "router delivery bands");
assert.deepEqual(secPeriodicReportsRouterResponseSchema.properties.display_type.enum, SEC_PERIODIC_REPORTS_ROUTER_DISPLAY_TYPES, "router display types");
assert.match(secPeriodicReportsRouterSystemPrompt, /score below 50 derived_delivery_level archive/i, "router score archive band");
assert.match(secPeriodicReportsRouterSystemPrompt, /score 50 to 74 feed/i, "router score feed band");
assert.match(secPeriodicReportsRouterSystemPrompt, /score 75 or above alert/i, "router score alert band");
assert.match(secPeriodicReportsRouterSystemPrompt, /Routine deterministic parser archive cases/i, "router deterministic amendment instruction");
assert.match(secPeriodicReportsRouterSystemPrompt, /Do not call live APIs, live FMP, live databases/i, "router live-data prohibition");
assert.match(secPeriodicReportsRouterSystemPrompt, /Use only cleaned_source_blocks/i, "periodic reports router uses source blocks");
assert.match(secPeriodicReportsRouterSystemPrompt, /UI payload builder, not analysis LLM/i, "router owns display selection before analysis");
assert.match(secPeriodicReportsRouterSystemPrompt, /Use ipo_listing for traditional IPOs, SPAC IPOs, direct listings/i, "router IPO listing instruction");
assert.match(secPeriodicReportsRouterSystemPrompt, /Do not use ipo_listing for ordinary resale registration/i, "router IPO exclusion instruction");
assert.match(secPeriodicReportsRouterSystemPrompt, /Return ipo_kind as traditional or spac/i, "router IPO kind instruction");
assert.ok(hasOwn(secPeriodicReportsRouterResponseSchema.properties, "display_type"), "router response includes display_type");
assert.ok(hasOwn(secPeriodicReportsRouterResponseSchema.properties, "display_version"), "router response includes display_version");
assert.ok(hasOwn(secPeriodicReportsRouterResponseSchema.properties, "ipo_kind"), "router response includes ipo_kind");
assert.ok(hasOwn(secPeriodicReportsRouterResponseSchema.properties, "analysis_llm_needed"), "router response includes analysis flag");
assert.ok(hasOwn(secPeriodicReportsRouterResponseSchema.properties, "derived_delivery_level"), "router response includes derived delivery");

for (const fixtureName of fixtureNames) {
  const fixture = readJson<Fixture>(join(roomDir, "fixtures", `${fixtureName}.json`));
  const parserOutput = parseSecPeriodicReport(fixture.filing);
  const prompt = buildSecPeriodicReportsRouterPromptDraft({
    parser_output: parserOutput,
    filing_excerpt: fixture.filing.bodyText,
    market_context: fixture.market_context || null,
  });
  const sourcePayload = JSON.parse(prompt.user) as { cleaned_source_blocks?: Array<Record<string, unknown>>; parser_output?: unknown };

  assert.equal(prompt.key, SEC_PERIODIC_REPORTS_ROUTER_PROMPT_KEY, `${fixtureName}: prompt key`);
  assert.equal(prompt.version, SEC_PERIODIC_REPORTS_ROUTER_PROMPT_VERSION, `${fixtureName}: prompt version`);
  assert.equal(prompt.responseFormat.json_schema.schema, secPeriodicReportsRouterResponseSchema, `${fixtureName}: response schema`);
  assert.equal(sourcePayload.parser_output, undefined, `${fixtureName}: router payload omits full parser output`);
  assert.ok(Array.isArray(sourcePayload.cleaned_source_blocks), `${fixtureName}: router payload has cleaned_source_blocks`);
  assert.ok(sourcePayload.cleaned_source_blocks.length > 0, `${fixtureName}: router payload has source blocks`);
  assert.ok(
    sourcePayload.cleaned_source_blocks.some((block) => block.block_type === "cleaned_source_block" || block.block_type === "table_source_block" || block.block_type === "xbrl_source_data"),
    `${fixtureName}: router payload includes source text/table/xbrl blocks`,
  );
  assert.deepEqual(findForbiddenKeys(sourcePayload), [], `${fixtureName}: router payload omits parser judgment keys`);
  assert.equal(secPeriodicReportsRouterResponseSchema.properties.source_form_scope.enum[0], PERIODIC_REPORTS_FORM_SCOPE, `${fixtureName}: scope`);
}

console.log("sec periodic reports router prompt fixtures passed");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function hasOwn(target: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function findForbiddenKeys(value: unknown, path = "user_payload"): string[] {
  const forbidden = new Set([
    "facts",
    "signals",
    "classification",
    "event_type",
    "display_type",
    "score",
    "topSignal",
    "extraction_summary",
    "selected_classification",
    "routingHints",
  ]);
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const nextPath = `${path}.${key}`;
    return [
      ...(forbidden.has(key) ? [nextPath] : []),
      ...findForbiddenKeys(item, nextPath),
    ];
  });
}
