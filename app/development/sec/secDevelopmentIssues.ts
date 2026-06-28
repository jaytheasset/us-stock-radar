import type { SecDevLiveRunResult } from "@/lib/development/secFormDevDashboard";

export type SecDevIssueSeverity = "fail" | "warning" | "review" | "info";

export type SecDevIssueSource = {
  key: string;
  label: string;
  forms: string[];
  liveRuns: SecDevLiveRunResult[];
};

export type SecDevIssue = {
  id: string;
  roomKey: string;
  roomLabel: string;
  severity: SecDevIssueSeverity;
  stage: string;
  source: string;
  message: string;
  runMode: string;
  ranAt: string;
  formType: string;
  ticker: string;
  accession: string;
  eventId: string;
  rawItemId: string;
  title: string;
  detailUrl: string;
  debug: Record<string, unknown>;
};

export function collectSecDevIssues(source: SecDevIssueSource, formFilter: string): SecDevIssue[] {
  const issues: SecDevIssue[] = [];

  source.liveRuns.forEach((run, runIndex) => {
    const runKey = `${source.key}-${run.mode}-${run.ranAt}-${runIndex}`;
    const runMatchesFilter = liveRunMatchesFormFilter(run, formFilter);
    const visibleItems = filterLiveItemsByForm(run.items, formFilter);

    if (runMatchesFilter && (run.status === "fail" || run.error)) {
      issues.push({
        id: `${runKey}-run-error`,
        roomKey: source.key,
        roomLabel: source.label,
        severity: "fail",
        stage: "run",
        source: "run.error",
        message: run.error || "Run returned fail status without an error message.",
        runMode: run.mode,
        ranAt: run.ranAt,
        formType: run.formTypes.join(", "),
        ticker: "",
        accession: clientString(run.accessionNumber),
        eventId: "",
        rawItemId: clientString(run.rawItemId),
        title: run.summary || formatSecDevRunMode(run.mode),
        detailUrl: "",
        debug: buildIssueDebug(run, null, null, null),
      });
    }

    visibleItems.forEach((item, itemIndex) => {
      const runtimeOutput = readClientRecord(item.runtime_output);
      const displayPayloadDebug = readClientRecord(runtimeOutput?.display_payload_debug);
      const issueBase = buildIssueBase(source, run, item, runtimeOutput);
      const itemKey = `${runKey}-item-${itemIndex}`;
      const excluded = isExcludedLiveItem(item);
      const itemError = clientString(item.error);

      if (!excluded && (item.ok === false || itemError)) {
        issues.push({
          ...issueBase,
          id: `${itemKey}-item-error`,
          severity: "fail",
          stage: clientString(item.stage) || clientString(runtimeOutput?.stage) || "analysis",
          source: itemError ? "item.error" : "item.ok",
          message: itemError || "Item returned ok=false without an error message.",
          debug: buildIssueDebug(run, item, runtimeOutput, displayPayloadDebug),
        });
      }

      collectIssueStringArrays([item, runtimeOutput, displayPayloadDebug], ["display_warnings", "warnings", "parser_warnings"]).forEach((warning, warningIndex) => {
        issues.push({
          ...issueBase,
          id: `${itemKey}-warning-${warningIndex}`,
          severity: "warning",
          stage: "display",
          source: "display_warnings",
          message: warning,
          debug: buildIssueDebug(run, item, runtimeOutput, displayPayloadDebug),
        });
      });

      const reviewReasons = collectIssueStringArrays([item, runtimeOutput, displayPayloadDebug], ["review_reasons", "human_review_reasons"]);
      const needsReview = item.needs_human_review === true || runtimeOutput?.needs_human_review === true || displayPayloadDebug?.needs_human_review === true;
      if (needsReview || reviewReasons.length) {
        issues.push({
          ...issueBase,
          id: `${itemKey}-review`,
          severity: "review",
          stage: "review",
          source: reviewReasons.length ? "review_reasons" : "needs_human_review",
          message: reviewReasons.join(" / ") || "Analysis marked this filing as needing human review.",
          debug: buildIssueDebug(run, item, runtimeOutput, displayPayloadDebug),
        });
      }

      if (excluded) {
        const skipReason = clientString(item.skip_reason) || clientString(runtimeOutput?.skip_reason) || "Skipped before SEC analysis.";
        issues.push({
          ...issueBase,
          id: `${itemKey}-excluded`,
          severity: "info",
          stage: clientString(item.skip_gate) || clientString(runtimeOutput?.skip_gate) || "excluded",
          source: "skip",
          message: skipReason,
          debug: buildIssueDebug(run, item, runtimeOutput, displayPayloadDebug),
        });
      }
    });
  });

  return sortSecDevIssues(issues);
}

export function sortSecDevIssues(issues: SecDevIssue[]) {
  return [...issues].sort((a, b) => {
    const severityDelta = issueSeverityRank(a.severity) - issueSeverityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return Date.parse(b.ranAt) - Date.parse(a.ranAt);
  });
}

export function countIssuesBySeverity(issues: SecDevIssue[]) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { fail: 0, warning: 0, review: 0, info: 0 } satisfies Record<SecDevIssueSeverity, number>,
  );
}

export function formatIssueSeverityLabel(severity: SecDevIssueSeverity) {
  if (severity === "fail") return "FAIL";
  if (severity === "warning") return "WARNING";
  if (severity === "review") return "REVIEW";
  return "INFO";
}

export function formatSecDevRunMode(mode: string) {
  if (mode === "live_dry_run") return "Live SEC dry-run";
  if (mode === "latest_analysis_dry_run") return "Latest analysis dry-run";
  if (mode === "accession_samples") return "Accession samples";
  if (mode === "accession_dry_run") return "Accession dry-run";
  if (mode === "controlled_persist") return "Controlled persist";
  if (mode === "reset_analysis") return "Delete existing analysis";
  if (mode === "recent_persisted") return "Recent persisted event";
  return mode;
}

export function buildIssueCopyText(issue: SecDevIssue) {
  return [
    `${formatIssueSeverityLabel(issue.severity)} - ${issue.stage}`,
    `Room: ${issue.roomLabel || issue.roomKey || "-"}`,
    `Source: ${issue.source}`,
    `Message: ${issue.message}`,
    `Run: ${formatSecDevRunMode(issue.runMode)} (${formatIssueDate(issue.ranAt)})`,
    `Form: ${issue.formType || "-"}`,
    `Ticker: ${issue.ticker || "-"}`,
    `Accession: ${issue.accession || "-"}`,
    `Event ID: ${issue.eventId || "-"}`,
    `Raw item ID: ${issue.rawItemId || "-"}`,
    `Detail URL: ${issue.detailUrl || "-"}`,
    "",
    "Debug:",
    JSON.stringify(issue.debug, null, 2),
  ].join("\n");
}

function buildIssueBase(
  source: SecDevIssueSource,
  run: SecDevLiveRunResult,
  item: Record<string, unknown>,
  runtimeOutput: Record<string, unknown> | null,
): Omit<SecDevIssue, "id" | "severity" | "stage" | "source" | "message" | "debug"> {
  const accession = clientString(item.accession_number) || clientString(run.accessionNumber);
  return {
    roomKey: source.key,
    roomLabel: source.label,
    runMode: run.mode,
    ranAt: run.ranAt,
    formType: clientString(item.form_type),
    ticker: clientString(item.ticker) || clientString(runtimeOutput?.ticker),
    accession,
    eventId: clientString(item.event_id),
    rawItemId: clientString(item.raw_item_id) || clientString(run.rawItemId),
    title: clientString(item.title) || clientString(runtimeOutput?.event_title) || clientString(item.event_id) || accession || "SEC filing",
    detailUrl: clientString(item.detail_url),
  };
}

function buildIssueDebug(
  run: SecDevLiveRunResult,
  item: Record<string, unknown> | null,
  runtimeOutput: Record<string, unknown> | null,
  displayPayloadDebug: Record<string, unknown> | null,
) {
  return {
    run: {
      mode: run.mode,
      status: run.status,
      ranAt: run.ranAt,
      room: run.room,
      formTypes: run.formTypes,
      accessionNumber: run.accessionNumber,
      rawItemId: run.rawItemId,
      summary: run.summary,
      error: run.error,
      diagnostics: run.diagnostics,
    },
    item: item
      ? {
          ok: item.ok,
          form_type: item.form_type,
          ticker: item.ticker,
          accession_number: item.accession_number,
          event_id: item.event_id,
          raw_item_id: item.raw_item_id,
          title: item.title,
          event_type: item.event_type,
          score: item.score,
          delivery_level: item.delivery_level,
          detail_url: item.detail_url,
          stage: item.stage,
          error: item.error,
          skip_gate: item.skip_gate,
          skip_reason: item.skip_reason,
          skip_evidence: item.skip_evidence,
          needs_human_review: item.needs_human_review,
          review_reasons: item.review_reasons,
        }
      : null,
    runtime_output: runtimeOutput
      ? {
          event_title: runtimeOutput.event_title,
          event_type: runtimeOutput.event_type,
          display_type: runtimeOutput.display_type,
          parser_route: runtimeOutput.parser_route,
          score: runtimeOutput.score,
          delivery_level: runtimeOutput.delivery_level,
          signal: runtimeOutput.signal,
          ticker: runtimeOutput.ticker,
          is_excluded: runtimeOutput.is_excluded,
          skip_gate: runtimeOutput.skip_gate,
          skip_reason: runtimeOutput.skip_reason,
          needs_human_review: runtimeOutput.needs_human_review,
          review_reasons: runtimeOutput.review_reasons,
          usage: runtimeOutput.usage,
          cost_estimate: runtimeOutput.cost_estimate,
        }
      : null,
    display_payload_debug: displayPayloadDebug,
  };
}

function collectIssueStringArrays(records: Array<Record<string, unknown> | null>, keys: string[]) {
  const values: string[] = [];
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      values.push(...clientStringArray(record[key]));
    }
  }
  return uniqueClientStrings(values);
}

function uniqueClientStrings(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function liveRunMatchesFormFilter(run: SecDevLiveRunResult, formFilter: string) {
  if (formFilter === "all") return true;
  const normalizedFilter = normalizeClientFormType(formFilter);
  return (
    run.formTypes.some((formType) => normalizeClientFormType(formType) === normalizedFilter) ||
    run.items.some((item) => normalizeClientFormType(clientString(item.form_type)) === normalizedFilter)
  );
}

function filterLiveItemsByForm(items: Array<Record<string, unknown>>, formFilter: string) {
  if (formFilter === "all") return items;
  const normalizedFilter = normalizeClientFormType(formFilter);
  return items.filter((item) => normalizeClientFormType(clientString(item.form_type)) === normalizedFilter);
}

function isExcludedLiveItem(item: Record<string, unknown>) {
  return item.is_excluded === true || Boolean(clientString(item.skip_gate)) || clientString(item.analysis_action) === "skip_analysis";
}

function issueSeverityRank(severity: SecDevIssueSeverity) {
  if (severity === "fail") return 0;
  if (severity === "warning") return 1;
  if (severity === "review") return 2;
  return 3;
}

function normalizeClientFormType(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

function readClientRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clientString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function clientStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(clientString).filter(Boolean) : [];
}

function formatIssueDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
