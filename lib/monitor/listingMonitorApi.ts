import {publicEvidence as public425Evidence,type FactEvidence} from "../sec425/evidence.ts";
import {publicOfferingPlanEvidence} from './offeringPlanFacts.ts';
import {
  validateCanonicalListingConditions,
  type CanonicalListingMonitorCondition,
} from "./listingMonitorPersistence.ts";
import {
  buildForm4InsiderPurchaseConditions,
  FORM4_INSIDER_PURCHASE_MONITOR_KIND,
  parseForm4InsiderPurchaseSettings,
  parseStoredForm4PurchaseMatchEvidence,
  type Form4InsiderPurchaseSettings,
  type Form4PurchaseMatchEvidence,
} from "./form4InsiderPurchaseMonitor.ts";

import { secondaryMonitorDisplay, type SecondaryMonitorDisplay } from "./secondaryMonitorEvidence.ts";

export const LISTING_MONITOR_API_VERSION = "listing_monitor_api_v1" as const;

export type ListingMonitorApiRequestError = Readonly<{
  ok: false;
  status: 400 | 422;
  code:
    | "LISTING_MONITOR_REQUEST_INVALID"
    | "LISTING_MONITOR_DOMAIN_UNSUPPORTED"
    | "LISTING_MONITOR_CONDITIONS_INVALID";
  message: string;
  errors: readonly string[];
}>;

export type ListingMonitorCreateInput = Readonly<{
  conditions: readonly CanonicalListingMonitorCondition[];
  kind?: typeof FORM4_INSIDER_PURCHASE_MONITOR_KIND;
  form4PurchaseSettings?: Form4InsiderPurchaseSettings;
}>;

export type ListingMonitorUpdateInput = Readonly<{
  conditions?: readonly CanonicalListingMonitorCondition[];
  form4PurchaseSettings?: Form4InsiderPurchaseSettings;
  isActive?: boolean;
}>;

export type ListingMonitorAlertItem = Readonly<{
  sec425Evidence?: FactEvidence;
  secondaryDisplay?: SecondaryMonitorDisplay;
  ntAlertTitle?: "SEC late-filing notice filed" | "Delayed periodic report filed";
  offeringPlanEvidence?: NonNullable<ReturnType<typeof publicOfferingPlanEvidence>>;
  projectedScenario?: string;
  effectEvidence?: import("../sec-effect/reader.ts").EffectEvidence | null;
  id: string;
  monitorId: string | null;
  eventId: string | null;
  createdAt: string;
  matchEvidence: Form4PurchaseMatchEvidence | null;
}>;

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  count?: number | null;
  error?: string;
}>;

export type ListingMonitorAlertRepository = Readonly<{
  list(input: Readonly<{
    ownerId: string;
    monitorId?: string;
    limit: number;
    offset: number;
  }>): Promise<RepositoryResult>;
}>;

export function parseListingMonitorCreateRequest(
  value: unknown,
): Readonly<{ ok: true; value: ListingMonitorCreateInput }> | ListingMonitorApiRequestError {
  const body = strictBody(value, ["conditions", "form4Purchase"]);
  if (!body.ok) return body;
  if ("form4Purchase" in body.value) {
    if ("conditions" in body.value) {
      return invalidRequest("Choose either canonical conditions or Form 4 purchase settings.", ["monitor_definition_conflict"]);
    }
    const settings = parseForm4InsiderPurchaseSettings(body.value.form4Purchase);
    if (!settings.ok) return invalidRequest("Form 4 purchase settings are invalid.", settings.errors);
    const validation = validateCanonicalListingConditions(buildForm4InsiderPurchaseConditions(settings.value));
    if (!validation.ok) return invalidConditions(validation.errors);
    return {
      ok: true,
      value: {
        conditions: validation.conditions,
        kind: FORM4_INSIDER_PURCHASE_MONITOR_KIND,
        form4PurchaseSettings: settings.value,
      },
    };
  }
  const validation = validateCanonicalListingConditions(body.value.conditions);
  if (!validation.ok) return invalidConditions(validation.errors);
  return { ok: true, value: { conditions: validation.conditions } };
}

export function parseListingMonitorUpdateRequest(
  value: unknown,
): Readonly<{ ok: true; value: ListingMonitorUpdateInput }> | ListingMonitorApiRequestError {
  const body = strictBody(value, ["conditions", "form4Purchase", "isActive"]);
  if (!body.ok) return body;
  if (!("conditions" in body.value) && !("form4Purchase" in body.value) && !("isActive" in body.value)) {
    return invalidRequest("A monitor update must include conditions or isActive.", ["update_empty"]);
  }
  if ("conditions" in body.value && "form4Purchase" in body.value) {
    return invalidRequest("Choose either canonical conditions or Form 4 purchase settings.", ["monitor_definition_conflict"]);
  }

  const result: {
    conditions?: readonly CanonicalListingMonitorCondition[];
    form4PurchaseSettings?: Form4InsiderPurchaseSettings;
    isActive?: boolean;
  } = {};
  if ("conditions" in body.value) {
    const validation = validateCanonicalListingConditions(body.value.conditions);
    if (!validation.ok) return invalidConditions(validation.errors);
    result.conditions = validation.conditions;
  }
  if ("form4Purchase" in body.value) {
    const settings = parseForm4InsiderPurchaseSettings(body.value.form4Purchase);
    if (!settings.ok) return invalidRequest("Form 4 purchase settings are invalid.", settings.errors);
    result.form4PurchaseSettings = settings.value;
  }
  if ("isActive" in body.value) {
    if (typeof body.value.isActive !== "boolean") {
      return invalidRequest("isActive must be a boolean.", ["is_active_invalid"]);
    }
    result.isActive = body.value.isActive;
  }
  return { ok: true, value: result };
}

export function validateListingMonitorCandidate(value: unknown) {
  const parsed = parseListingMonitorCreateRequest(value);
  return parsed.ok
    ? {
        valid: true as const,
        conditions: parsed.value.conditions,
        errors: [] as readonly string[],
      }
    : {
        valid: false as const,
        conditions: [] as readonly CanonicalListingMonitorCondition[],
        errors: parsed.errors,
        error: parsed,
      };
}

export function parseListingMonitorAlertQuery(searchParams: URLSearchParams):
  | Readonly<{ ok: true; monitorId?: string; limit: number; offset: number }>
  | ListingMonitorApiRequestError {
  const monitorId = searchParams.get("monitorId")?.trim() || undefined;
  if (monitorId && !isListingMonitorUuid(monitorId)) {
    return invalidRequest("monitorId must be a UUID.", ["monitor_id_invalid"]);
  }
  return {
    ok: true,
    ...(monitorId ? { monitorId } : {}),
    limit: clampInteger(searchParams.get("limit"), 20, 1, 100),
    offset: clampInteger(searchParams.get("offset"), 0, 0, 100_000),
  };
}

export async function listListingMonitorAlertsForOwner(
  input: Readonly<{
    ownerId: string;
    monitorId?: string;
    limit?: number;
    offset?: number;
  }>,
  repository?: ListingMonitorAlertRepository,
) {
  if (!isListingMonitorUuid(input.ownerId)) {
    throw new Error("ownerId must be a UUID");
  }
  if (input.monitorId && !isListingMonitorUuid(input.monitorId)) {
    throw new Error("monitorId must be a UUID");
  }
  const resolved = repository || await resolveAlertRepository();
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 20), 100));
  const offset = Math.max(0, Math.min(Math.floor(input.offset ?? 0), 100_000));
  const result = await resolved.list({
    ownerId: input.ownerId,
    ...(input.monitorId ? { monitorId: input.monitorId } : {}),
    limit,
    offset,
  });
  if (!result.ok) {
    throw new ListingMonitorAlertReadError(
      result.error || "Listing Monitor Alerts could not be read.",
      result.status || 502,
    );
  }
  return {
    alerts: readRows(result.data).flatMap(mapAlertRow),
    total: result.count ?? 0,
    limit,
    offset,
  };
}

export class ListingMonitorAlertReadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ListingMonitorAlertReadError";
    this.status = status;
  }
}

export function isListingMonitorUuid(value: string) {
  return UUID_PATTERN.test(value);
}

async function resolveAlertRepository(): Promise<ListingMonitorAlertRepository> {
  const supabase = await import("../supabase.ts");
  return {
    list: ({ ownerId, monitorId, limit, offset }) => supabase.supabaseSelect(
      "user_alert_deliveries",
      {
        select: "id,alert_event_id,listing_monitor_id,created_at,title,category,source_type,source_label,sec425_raw_item_id,sec425_match_evidence,offering_plan_match_evidence,listing_match_evidence,effect_match_evidence,projected_monitor_id,projected_scenario,secondary_match_evidence,listing_source_execution_id",
        user_id: `eq.${ownerId}`,
        alert_domain: "eq.listing",
        alert_lane: "eq.listing_monitor",
        ...(monitorId ? { or: `(listing_monitor_id.eq.${monitorId},projected_monitor_id.eq.${monitorId})` } : {}),
        order: "delivered_at.desc,id.desc",
        limit: String(limit),
        offset: String(offset),
      },
    ),
  };
}

function strictBody(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<{ ok: true; value: Record<string, unknown> }> | ListingMonitorApiRequestError {
  if (!record(value)) {
    return invalidRequest("Request body must be a JSON object.", ["body_invalid"]);
  }
  if ("domain" in value && value.domain !== "listing") {
    return {
      ok: false,
      status: 400,
      code: "LISTING_MONITOR_DOMAIN_UNSUPPORTED",
      message: "Only the listing monitor domain is supported.",
      errors: ["domain_unsupported"],
    };
  }
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    return invalidRequest("Request body contains unsupported fields.", unexpected.map((key) => `field_unsupported:${key}`));
  }
  return { ok: true, value };
}

function invalidRequest(message: string, errors: readonly string[]): ListingMonitorApiRequestError {
  return {
    ok: false,
    status: 400,
    code: "LISTING_MONITOR_REQUEST_INVALID",
    message,
    errors,
  };
}

function invalidConditions(errors: readonly string[]): ListingMonitorApiRequestError {
  return {
    ok: false,
    status: 422,
    code: "LISTING_MONITOR_CONDITIONS_INVALID",
    message: "Listing monitor conditions are invalid under Registry V1.",
    errors,
  };
}

function clampInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(Math.floor(parsed), maximum))
    : fallback;
}

function mapAlertRow(row: Record<string, unknown>): ListingMonitorAlertItem[] {
  if (typeof row.id !== "string" || !isListingMonitorUuid(row.id)) return [];
  if (typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return [];
  return [{
    id: row.id,
    monitorId: typeof row.listing_monitor_id === "string" ? row.listing_monitor_id : typeof row.projected_monitor_id==='string'?row.projected_monitor_id:null,
    eventId: typeof row.alert_event_id === "string" ? row.alert_event_id : null,
    createdAt: row.created_at,
    ...(public425Evidence(row.sec425_match_evidence,row.sec425_raw_item_id,row.listing_source_execution_id)?{sec425Evidence:public425Evidence(row.sec425_match_evidence,row.sec425_raw_item_id,row.listing_source_execution_id)!}:{}),
    secondaryDisplay: secondaryMonitorDisplay(row.secondary_match_evidence, row.alert_event_id, row.listing_source_execution_id),
    matchEvidence: parseStoredForm4PurchaseMatchEvidence(row.listing_match_evidence),
    // Display the persisted NT notification only; do not derive lifecycle facts.
    ...(row.category === "financial_risk" && row.source_type === "other"
      && row.source_label === "SEC Filing Monitor"
      && (row.title === "SEC late-filing notice filed" || row.title === "Delayed periodic report filed")
      ? { ntAlertTitle: row.title } : {}),
    ...(publicOfferingPlanEvidence(row.offering_plan_match_evidence) ? {offeringPlanEvidence:publicOfferingPlanEvidence(row.offering_plan_match_evidence)!} : {}),
    ...(typeof row.projected_scenario==='string'?{projectedScenario:row.projected_scenario}:{}),
    ...(validEffectEvidence(row.effect_match_evidence) ? { effectEvidence: row.effect_match_evidence } : {}),
  }];
}

function validEffectEvidence(value: unknown): value is import("../sec-effect/reader.ts").EffectEvidence {
  if (!record(value) || value.kind !== "effect_registration_v1"
    || !["registrationForm", "fileNumber", "cik", "effectiveDate", "effectAccession", "sourceUrl"].every(k => typeof value[k] === "string")) return false;
  try { const url = new URL(value.sourceUrl as string);
    return url.protocol === "https:" && url.hostname === "www.sec.gov" && url.pathname.startsWith("/Archives/edgar/data/");
  } catch { return false; }
}

function readRows(value: unknown) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
