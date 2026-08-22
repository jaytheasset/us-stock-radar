/**
 * Generic Primary-to-Monitor routing contract.
 *
 * A route is a recall-oriented request for a domain analyzer to inspect the
 * source. It is not a canonical domain fact, and array order carries no
 * priority meaning. Execution, lineage, persistence, and analyzer results are
 * owned by later boundaries.
 */

export const MONITOR_ROUTING_CONTRACT_VERSION = "monitor_routing_v1";
export const MONITOR_ANALYZER_KEY_MAX_LENGTH = 64;

// Only analyzers that actually exist may be enabled by default. Future domains
// extend this small set when implemented; callers may inject an explicit set to
// validate a different deployment without changing the generic route shape.
export const SUPPORTED_MONITOR_ANALYZER_KEYS = ["listing_risk", "corporate_action"] as const;

export type SupportedMonitorAnalyzerKey = (typeof SUPPORTED_MONITOR_ANALYZER_KEYS)[number];

export type MonitorRoute<AnalyzerKey extends string = SupportedMonitorAnalyzerKey> = {
  monitor_analyzer_key: AnalyzerKey;
};

export type MonitorRoutingResult<AnalyzerKey extends string = SupportedMonitorAnalyzerKey> = {
  monitor_routes: MonitorRoute<AnalyzerKey>[];
};

export type MonitorRoutingValidationOptions<AnalyzerKey extends string = string> = {
  allowedAnalyzerKeys?: readonly AnalyzerKey[];
};

export const MONITOR_ROUTING_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["monitor_routes"],
  properties: {
    monitor_routes: {
      type: "array",
      maxItems: SUPPORTED_MONITOR_ANALYZER_KEYS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["monitor_analyzer_key"],
        properties: {
          monitor_analyzer_key: {
            type: "string",
            enum: SUPPORTED_MONITOR_ANALYZER_KEYS,
            maxLength: MONITOR_ANALYZER_KEY_MAX_LENGTH,
          },
        },
      },
    },
  },
} as const;

export const LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS = [
  "Independently from event_type, decide whether monitor_routes includes {\"monitor_analyzer_key\":\"listing_risk\"} from the complete source semantics.",
  "Route listing_risk when the source materially reports a listing deficiency or minimum-bid compliance issue, regained compliance, a delisting determination, a listing appeal or hearing, a listing-related trading suspension, removal or withdrawal from an exchange, listing termination, or another material listing-status action.",
  "Adverse, recovered, and procedural listing actions are all eligible. A merger or other primary event may therefore keep its own event_type while also routing listing_risk when the source materially reports the security's procedural removal or listing termination.",
  "Do not route listing_risk solely because of a simple reverse split without explicit listing or compliance context, an ordinary exchange or trading-symbol mention, administrative CUSIP or ticker mechanics, or an unrelated event.",
  "Do not derive monitor_routes from event_type, SEC form type, router candidates, material_events, keywords, or regex matches. Do not include relation, confidence, reason, domain facts, execution state, or persistence fields in a route.",
].join("\n");

export const CORPORATE_ACTION_MONITOR_ROUTING_PROMPT_INSTRUCTIONS = [
  "Independently from event_type and every other route, include {\"monitor_analyzer_key\":\"corporate_action\"} when the complete stored source may semantically establish an explicit reverse or forward stock split, including an announcement, board approval, shareholder approval, confirmed schedule, or effective action.",
  "This route is recall-oriented analyzer work, not a canonical fact. Do not output a stage, ratio, date, evidence, confidence, reason, or any other corporate-action fact in monitor_routes.",
  "Do not route corporate_action from parser event-family values, calendar items, badges, event_type, SEC capital_mode, keywords, regex matches, ticker metadata, or prior AI summaries. Use the complete original source semantics.",
  "Do not route corporate_action for a stock dividend, merger, spin-off, recapitalization, ADS-ratio change, broad capital-structure discussion, historical split-adjusted value, or unrelated listing action unless the source may also establish an explicit reverse or forward stock split.",
  "Before returning the final JSON, audit it for routing consistency: if any source-backed output field states that the current source announces, approves, schedules, makes effective, or completes an explicit reverse or forward stock split, monitor_routes must include corporate_action. Never state an explicit current stock split anywhere in the output while returning an empty corporate_action route.",
  "Return monitor_routes as an unordered array containing zero, one, or both distinct implemented analyzer routes. A source with separate listing-risk and stock-split semantics may route both analyzers.",
].join("\n");

export function validateMonitorRoutingResult(
  value: unknown,
  options: MonitorRoutingValidationOptions = {},
): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["monitor_routing must be an object"];

  exactKeys(root, ["monitor_routes"], "monitor_routing", errors);
  if (!Array.isArray(root.monitor_routes)) {
    errors.push("monitor_routing.monitor_routes must be an array");
    return errors;
  }

  const allowedAnalyzerKeys = new Set(options.allowedAnalyzerKeys || SUPPORTED_MONITOR_ANALYZER_KEYS);
  const seenAnalyzerKeys = new Set<string>();

  root.monitor_routes.forEach((routeValue, index) => {
    const path = `monitor_routing.monitor_routes[${index}]`;
    const route = record(routeValue);
    if (!route) {
      errors.push(`${path} must be an object`);
      return;
    }

    exactKeys(route, ["monitor_analyzer_key"], path, errors);
    const analyzerKey = route.monitor_analyzer_key;
    if (!validAnalyzerKey(analyzerKey)) {
      errors.push(
        `${path}.monitor_analyzer_key must match ^[a-z][a-z0-9_]*$ and be ${MONITOR_ANALYZER_KEY_MAX_LENGTH} characters or fewer`,
      );
      return;
    }

    if (!allowedAnalyzerKeys.has(analyzerKey)) {
      errors.push(`${path}.monitor_analyzer_key is not supported: ${analyzerKey}`);
    }
    if (seenAnalyzerKeys.has(analyzerKey)) {
      errors.push(`${path}.monitor_analyzer_key must be unique: ${analyzerKey}`);
    } else {
      seenAnalyzerKeys.add(analyzerKey);
    }
  });

  return errors;
}

export function readMonitorRoutingResult<AnalyzerKey extends string = SupportedMonitorAnalyzerKey>(
  value: unknown,
  options: MonitorRoutingValidationOptions<AnalyzerKey> = {},
): MonitorRoutingResult<AnalyzerKey> | null {
  return validateMonitorRoutingResult(value, options).length === 0
    ? (value as MonitorRoutingResult<AnalyzerKey>)
    : null;
}

export function readMonitorRoutingResultFromPrimaryOutput<
  AnalyzerKey extends string = SupportedMonitorAnalyzerKey,
>(
  value: unknown,
  options: MonitorRoutingValidationOptions<AnalyzerKey> = {},
): MonitorRoutingResult<AnalyzerKey> | null {
  const root = record(value);
  if (!root || !Object.hasOwn(root, "monitor_routes")) return null;
  return readMonitorRoutingResult({ monitor_routes: root.monitor_routes }, options);
}

function validAnalyzerKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MONITOR_ANALYZER_KEY_MAX_LENGTH
    && /^[a-z][a-z0-9_]*$/.test(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  errors: string[],
) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
