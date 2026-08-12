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
export const SUPPORTED_MONITOR_ANALYZER_KEYS = ["listing_risk"] as const;

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
