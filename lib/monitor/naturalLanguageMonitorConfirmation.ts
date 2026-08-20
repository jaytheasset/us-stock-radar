import {
  findDefiniteEqContradictions,
  type NaturalLanguageConditionCompilerStatus,
} from "./naturalLanguageConditionCompiler.ts";
import {
  formatNaturalLanguageMonitorDraftCondition,
  NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
  type NaturalLanguageMonitorDraft,
  type NaturalLanguageMonitorDraftStatus,
} from "./naturalLanguageMonitorDraft.ts";
import {
  getListingMonitorConfirmationCatalog,
  requiresExplicitAiDraftConfirmation,
  resolveListingMonitorConfirmationChoice,
} from "./listingMonitorConfirmation.ts";
import {
  validateCanonicalListingConditions,
  type CanonicalListingMonitorCondition,
} from "./listingMonitorPersistence.ts";

export type NaturalLanguageMonitorConfirmationRequest = Readonly<{
  draft: NaturalLanguageMonitorDraft;
  proposalId: string;
  choiceId: string;
}>;

export class NaturalLanguageMonitorConfirmationError extends Error {
  readonly code = "MONITOR_CONFIRMATION_INVALID" as const;
  readonly status = 400 as const;
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super("Monitor confirmation selection is invalid.");
    this.name = "NaturalLanguageMonitorConfirmationError";
    this.details = details;
  }
}

export function parseNaturalLanguageMonitorConfirmationRequest(
  value: unknown,
): NaturalLanguageMonitorConfirmationRequest {
  if (!record(value) || !exactKeys(value, ["draft", "proposalId", "choiceId"])) {
    throw invalid("request_shape_invalid");
  }
  const proposalId = readText(value.proposalId);
  const choiceId = readText(value.choiceId);
  if (!proposalId || !choiceId) throw invalid("selection_invalid");
  return Object.freeze({ draft: readDraft(value.draft), proposalId, choiceId });
}

export function applyNaturalLanguageMonitorConfirmation(
  request: NaturalLanguageMonitorConfirmationRequest,
): NaturalLanguageMonitorDraft {
  const draft = readDraft(request.draft);
  const proposalIndex = draft.proposed.findIndex((item) => item.id === request.proposalId);
  const proposal = draft.proposed[proposalIndex];
  if (!proposal || proposal.state !== "pending") throw invalid("proposal_not_pending");
  const selected = resolveListingMonitorConfirmationChoice(proposal.condition, request.choiceId);
  if (selected === undefined) throw invalid("confirmation_choice_unknown");

  const activeConditions = [...draft.conditions];
  if (selected && !activeConditions.some((condition) => fingerprint(condition) === fingerprint(selected))) {
    activeConditions.push(selected);
  }
  const validation = validateActiveConditions(activeConditions);
  if (!validation.ok) throw invalid(...validation.errors);
  if (findDefiniteEqContradictions(validation.conditions).length > 0) {
    throw invalid("conditions_contradictory");
  }
  const proposed = Object.freeze(draft.proposed.map((item, index) => Object.freeze({
    ...item,
    state: index === proposalIndex ? (selected ? "used" as const : "omitted" as const) : item.state,
  })));
  const unresolvedCount = proposed.filter((item) => item.state === "pending").length;
  const draftStatus = deriveDraftStatus(draft.compilerStatus, unresolvedCount, validation.conditions.length);

  return Object.freeze({
    version: NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
    draftStatus,
    compilerStatus: draft.compilerStatus,
    conditions: validation.conditions,
    mapped: Object.freeze(validation.conditions.length > 0 ? [Object.freeze({
      sourceText: "Resolved monitor conditions",
      conditions: Object.freeze(validation.conditions.map((condition, index) => (
        formatNaturalLanguageMonitorDraftCondition({ id: `c${index + 1}`, ...condition })
      ))),
    })] : []),
    unsupported: draft.unsupported,
    ambiguous: draft.ambiguous,
    proposed,
    unresolvedCount,
    message: messageForStatus(draftStatus),
  });
}

function readDraft(value: unknown): NaturalLanguageMonitorDraft {
  if (!record(value) || value.version !== NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION) {
    throw invalid("draft_invalid");
  }
  if (
    !Array.isArray(value.conditions)
    || !Array.isArray(value.unsupported)
    || !Array.isArray(value.ambiguous)
    || !Array.isArray(value.proposed)
  ) {
    throw invalid("draft_incomplete");
  }
  const active = validateActiveConditions(value.conditions);
  if (!active.ok) throw invalid(...active.errors);
  const proposed = value.proposed.map((item, index) => readProposal(item, index));
  const ids = new Set(proposed.map((item) => item.id));
  if (ids.size !== proposed.length) throw invalid("proposal_id_duplicate");
  const unresolvedCount = proposed.filter((item) => item.state === "pending").length;
  if (value.unresolvedCount !== unresolvedCount) throw invalid("unresolved_count_invalid");
  const compilerStatus = readCompilerStatus(value.compilerStatus);
  const expectedDraftStatus = deriveDraftStatus(compilerStatus, unresolvedCount, active.conditions.length);
  if (value.draftStatus !== expectedDraftStatus) throw invalid("draft_status_invalid");

  const flaggedActive = active.conditions.filter(requiresExplicitAiDraftConfirmation).map(fingerprint).sort();
  const used = proposed.filter((item) => item.state === "used").map((item) => fingerprint(item.condition)).sort();
  if (JSON.stringify(flaggedActive) !== JSON.stringify(used)) {
    throw invalid("confirmed_condition_state_mismatch");
  }
  return Object.freeze({
    version: NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
    draftStatus: expectedDraftStatus,
    compilerStatus,
    conditions: active.conditions,
    mapped: Array.isArray(value.mapped) ? value.mapped as NaturalLanguageMonitorDraft["mapped"] : Object.freeze([]),
    unsupported: Object.freeze(value.unsupported as NaturalLanguageMonitorDraft["unsupported"]),
    ambiguous: Object.freeze(value.ambiguous as NaturalLanguageMonitorDraft["ambiguous"]),
    proposed: Object.freeze(proposed),
    unresolvedCount,
    message: typeof value.message === "string" ? value.message : "",
  });
}

function readProposal(value: unknown, index: number): NaturalLanguageMonitorDraft["proposed"][number] {
  if (!record(value) || !exactKeys(value, ["id", "condition", "preview", "choices", "state"])) {
    throw invalid(`proposals[${index}]:shape_invalid`);
  }
  const id = readText(value.id);
  if (!/^p[1-9]\d*$/.test(id)) throw invalid(`proposals[${index}]:id_invalid`);
  const conditionValidation = validateActiveConditions([value.condition]);
  const condition = conditionValidation.conditions[0];
  const catalog = condition ? getListingMonitorConfirmationCatalog(condition) : null;
  if (
    !conditionValidation.ok
    || !catalog
    || JSON.stringify(value.preview) !== JSON.stringify(catalog.preview)
    || JSON.stringify(value.choices) !== JSON.stringify(catalog.choices)
    || (value.state !== "pending" && value.state !== "used" && value.state !== "omitted")
  ) {
    throw invalid(`proposals[${index}]:invalid`);
  }
  return Object.freeze({
    id,
    condition,
    preview: catalog.preview,
    choices: catalog.choices,
    state: value.state,
  });
}

function validateActiveConditions(value: unknown): Readonly<{
  ok: boolean;
  conditions: readonly CanonicalListingMonitorCondition[];
  errors: readonly string[];
}> {
  if (Array.isArray(value) && value.length === 0) {
    return Object.freeze({ ok: true, conditions: Object.freeze([]), errors: Object.freeze([]) });
  }
  return validateCanonicalListingConditions(value);
}

function deriveDraftStatus(
  compilerStatus: NaturalLanguageConditionCompilerStatus,
  unresolvedCount: number,
  activeCount: number,
): NaturalLanguageMonitorDraftStatus {
  if (compilerStatus !== "VALID") return "NEEDS_ATTENTION";
  if (unresolvedCount > 0) return "NEEDS_CONFIRMATION";
  return activeCount > 0 ? "READY_FOR_REVIEW" : "NEEDS_ATTENTION";
}

function messageForStatus(status: NaturalLanguageMonitorDraftStatus) {
  if (status === "READY_FOR_REVIEW") return "Review this draft before creating a monitor.";
  if (status === "NEEDS_CONFIRMATION") {
    return "Confirm or remove each AI-suggested filter before creating this monitor.";
  }
  return "Review the highlighted requirements before creating a monitor.";
}

function readCompilerStatus(value: unknown): NaturalLanguageConditionCompilerStatus {
  if (value === "VALID" || value === "UNSUPPORTED" || value === "AMBIGUOUS" || value === "CONTRADICTORY") {
    return value;
  }
  throw invalid("compiler_status_invalid");
}

function fingerprint(condition: CanonicalListingMonitorCondition) {
  return JSON.stringify([condition.key, condition.operator, condition.value]);
}

function invalid(...details: string[]) {
  return new NaturalLanguageMonitorConfirmationError(Object.freeze(details));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1_000
    ? value.trim()
    : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
