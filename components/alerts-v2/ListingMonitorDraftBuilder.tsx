"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Sparkles, Trash2 } from "lucide-react";
import {
  changeListingMonitorDraftConditionKey,
  changeListingMonitorDraftConditionOperator,
  createListingMonitorDraftReview,
  formatListingMonitorConditionPreview,
  getListingMonitorConditionEditorCatalog,
  getListingMonitorDraftCreateGate,
  removeListingMonitorDraftCondition,
  replaceListingMonitorDraftCondition,
  setListingMonitorDraftIssueAbandoned,
  type ListingMonitorDraftReview,
} from "@/lib/monitor/listingMonitorDraftReview";
import type { CanonicalListingMonitorCondition, ListingMonitor } from "@/lib/monitor/listingMonitorPersistence";
import type { MonitorConditionOperator } from "@/lib/monitor/conditionRegistry";
import styles from "./ListingMonitorDraftBuilder.module.css";

const EDITOR_CATALOG = getListingMonitorConditionEditorCatalog();
const EDITOR_BY_KEY = new Map(EDITOR_CATALOG.map((item) => [item.key, item]));

type ApiPayload = Readonly<{
  ok?: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}>;

type ListingMonitorListData = Readonly<{
  monitors: readonly ListingMonitor[];
}>;

export function ListingMonitorDraftBuilder() {
  const [text, setText] = useState("");
  const [review, setReview] = useState<ListingMonitorDraftReview | null>(null);
  const [monitors, setMonitors] = useState<readonly ListingMonitor[]>([]);
  const [action, setAction] = useState<"idle" | "compiling" | "creating">("idle");
  const [listLoading, setListLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [createdMonitorId, setCreatedMonitorId] = useState("");
  const createGate = useMemo(
    () => review ? getListingMonitorDraftCreateGate(review) : null,
    [review],
  );

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    fetchListingMonitors(controller.signal)
      .then((data) => {
        setMonitors(data.monitors);
        setAuthRequired(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof MonitorApiError && error.status === 401) setAuthRequired(true);
        else setMessage(error instanceof Error ? error.message : "Could not load Listing monitors.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function compileDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action !== "idle") return;
    setAction("compiling");
    setMessage("");
    setCreatedMonitorId("");
    try {
      const response = await fetch("/api/monitors/listing/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await readApiPayload(response);
      if (!response.ok || !payload?.data) throw apiError(response, payload, "Could not compile this monitor draft.");
      setReview(createListingMonitorDraftReview(payload.data));
      setAuthRequired(false);
      setMessage("Draft ready. Review every condition before creating a monitor.");
    } catch (error) {
      if (error instanceof MonitorApiError && error.status === 401) setAuthRequired(true);
      setMessage(error instanceof Error ? error.message : "Could not compile this monitor draft.");
    } finally {
      setAction("idle");
    }
  }

  async function createMonitor() {
    if (!review || !createGate?.ready || action !== "idle") return;
    setAction("creating");
    setMessage("");
    setCreatedMonitorId("");
    try {
      const response = await fetch("/api/monitors/listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: createGate.conditions }),
      });
      const payload = await readApiPayload(response);
      const monitor = readCreatedMonitor(payload?.data);
      if (!response.ok || !monitor) throw apiError(response, payload, "Could not create this Listing monitor.");
      setCreatedMonitorId(monitor.id);
      setMonitors((current) => Object.freeze([monitor, ...current.filter((item) => item.id !== monitor.id)]));
      setAuthRequired(false);
      setMessage("Listing monitor created. It is active and appears below.");
    } catch (error) {
      if (error instanceof MonitorApiError && error.status === 401) setAuthRequired(true);
      setMessage(error instanceof Error ? error.message : "Could not create this Listing monitor.");
    } finally {
      setAction("idle");
    }
  }

  function updateCondition(index: number, condition: CanonicalListingMonitorCondition) {
    setReview((current) => current
      ? replaceListingMonitorDraftCondition(current, index, condition)
      : current);
    setCreatedMonitorId("");
  }

  return (
    <section className={styles.builder} aria-labelledby="listing-monitor-draft-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Sparkles aria-hidden="true" size={16} /> Listing monitor draft</span>
          <h2 id="listing-monitor-draft-title">Describe what you want to monitor</h2>
          <p>The AI creates a reviewable draft. Nothing is saved until you confirm Create monitor.</p>
        </div>
        <span className={styles.draftBadge}>DRAFT</span>
      </header>

      {authRequired ? (
        <div className={styles.authNotice} role="status">
          <span>Sign in to compile and create Listing monitors.</span>
          <Link href="/login?next=%2Falerts">Sign in</Link>
        </div>
      ) : null}

      <form className={styles.promptForm} onSubmit={compileDraft}>
        <label htmlFor="listing-monitor-natural-language">Natural-language monitor request</label>
        <textarea
          disabled={authRequired || action !== "idle"}
          id="listing-monitor-natural-language"
          maxLength={1000}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder="Alert me when a Nasdaq company receives a listing deficiency and has a compliance deadline within 30 days."
          required
          rows={3}
          value={text}
        />
        <div className={styles.promptActions}>
          <span>{text.length} / 1000</span>
          <button disabled={authRequired || action !== "idle" || !text.trim()} type="submit">
            {action === "compiling" ? "Building draft..." : "Build draft preview"}
          </button>
        </div>
      </form>

      {message ? <p className={styles.message} aria-live="polite">{message}</p> : null}

      {review ? (
        <div className={styles.review}>
          <div className={styles.reviewHeading}>
            <div>
              <h3>Review mapped conditions</h3>
              <p>Every visible condition will be sent exactly as shown in the canonical create request.</p>
            </div>
            <span data-ready={createGate?.ready ? "true" : "false"}>
              {createGate?.ready ? "Ready to create" : "Needs review"}
            </span>
          </div>

          <div className={styles.previewList} aria-label="Mapped Listing conditions">
            {review.conditions.length === 0 ? (
              <p className={styles.emptyState}>Add at least one mapped condition before creating a monitor.</p>
            ) : review.conditions.map((condition, index) => (
              <ConditionEditor
                condition={condition}
                index={index}
                key={`${index}-${condition.key}`}
                onChange={(next) => updateCondition(index, next)}
                onRemove={() => {
                  setReview((current) => current ? removeListingMonitorDraftCondition(current, index) : current);
                  setCreatedMonitorId("");
                }}
              />
            ))}
          </div>

          {review.issues.length > 0 ? (
            <section className={styles.issues} aria-labelledby="listing-monitor-draft-issues-title">
              <h3 id="listing-monitor-draft-issues-title">Requirements needing a decision</h3>
              <p>These requirements are never dropped silently. Explicitly abandon each one to create a partial monitor.</p>
              {review.issues.map((issue) => (
                <article data-abandoned={issue.abandoned ? "true" : "false"} key={issue.id}>
                  <AlertTriangle aria-hidden="true" size={18} />
                  <div>
                    <strong>{issue.kind === "unsupported" ? "Unsupported" : "Needs clarification"}</strong>
                    <q>{issue.sourceText}</q>
                    <span>{issue.detail}</span>
                  </div>
                  <button
                    onClick={() => setReview((current) => current
                      ? setListingMonitorDraftIssueAbandoned(current, issue.id, !issue.abandoned)
                      : current)}
                    type="button"
                  >
                    {issue.abandoned ? "Restore requirement" : "Abandon requirement"}
                  </button>
                </article>
              ))}
            </section>
          ) : null}

          <footer className={styles.confirmBar}>
            <div>
              <strong>Explicit confirmation required</strong>
              <span>
                {!createGate?.ready
                  ? createGate?.errors.includes("requirements_unresolved")
                    ? "Resolve or explicitly abandon every unsupported or ambiguous requirement."
                    : "Keep at least one valid, non-contradictory condition."
                  : `${createGate.conditions.length} condition${createGate.conditions.length === 1 ? "" : "s"} will be created.`}
              </span>
            </div>
            <button
              disabled={!createGate?.ready || action !== "idle" || authRequired}
              onClick={() => void createMonitor()}
              type="button"
            >
              {action === "creating" ? "Creating monitor..." : "Confirm and create monitor"}
            </button>
          </footer>
        </div>
      ) : null}

      <section className={styles.monitorList} aria-labelledby="listing-monitors-title">
        <div className={styles.monitorListHeading}>
          <div>
            <h3 id="listing-monitors-title">Your Listing monitors</h3>
            <p>Active monitors use the canonical conditions stored by Monitor API V1.</p>
          </div>
          <span>{listLoading ? "Loading..." : `${monitors.length} total`}</span>
        </div>
        {!listLoading && !authRequired && monitors.length === 0 ? (
          <p className={styles.emptyState}>No Listing monitors yet.</p>
        ) : null}
        <div className={styles.monitorRows}>
          {monitors.map((monitor) => (
            <article data-created={monitor.id === createdMonitorId ? "true" : "false"} key={monitor.id}>
              <div className={styles.monitorStatus}>
                {monitor.id === createdMonitorId ? <CheckCircle2 aria-hidden="true" size={18} /> : null}
                <strong>{monitor.id === createdMonitorId ? "Created monitor" : "Listing monitor"}</strong>
                <span>{monitor.isActive ? "Active" : "Paused"}</span>
              </div>
              <ul>
                {monitor.conditions.map((condition, index) => (
                  <li key={`${monitor.id}-${index}`}>{formatListingMonitorConditionPreview(condition).text}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function ConditionEditor({
  condition,
  index,
  onChange,
  onRemove,
}: Readonly<{
  condition: CanonicalListingMonitorCondition;
  index: number;
  onChange: (condition: CanonicalListingMonitorCondition) => void;
  onRemove: () => void;
}>) {
  const editor = EDITOR_BY_KEY.get(condition.key) ?? EDITOR_CATALOG[0];
  const preview = formatListingMonitorConditionPreview(condition);

  return (
    <article className={styles.conditionCard}>
      <div className={styles.conditionPreview}>
        <span>Condition {index + 1}</span>
        <strong>{preview.text}</strong>
      </div>
      <div className={styles.editorFields}>
        <label>
          <span>Condition</span>
          <select
            aria-label={`Condition ${index + 1} type`}
            onChange={(event) => onChange(changeListingMonitorDraftConditionKey(condition, event.currentTarget.value))}
            value={condition.key}
          >
            {EDITOR_CATALOG.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>Match</span>
          <select
            aria-label={`Condition ${index + 1} match operator`}
            onChange={(event) => onChange(changeListingMonitorDraftConditionOperator(condition, event.currentTarget.value as MonitorConditionOperator))}
            value={condition.operator}
          >
            {editor.operators.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <ConditionValueEditor condition={condition} index={index} onChange={onChange} />
        <button aria-label={`Remove ${preview.label} condition`} className={styles.removeCondition} onClick={onRemove} type="button">
          <Trash2 aria-hidden="true" size={17} /> Remove
        </button>
      </div>
    </article>
  );
}

function ConditionValueEditor({
  condition,
  index,
  onChange,
}: Readonly<{
  condition: CanonicalListingMonitorCondition;
  index: number;
  onChange: (condition: CanonicalListingMonitorCondition) => void;
}>) {
  const editor = EDITOR_BY_KEY.get(condition.key) ?? EDITOR_CATALOG[0];
  const updateValue = (value: unknown) => onChange({ ...condition, value });
  const isSetOperator = condition.operator === "in" || condition.operator === "not_in";

  if (editor.values.length > 0 && isSetOperator) {
    const selected = new Set(Array.isArray(condition.value) ? condition.value.map(String) : []);
    return (
      <fieldset className={styles.valueOptions}>
        <legend>Values</legend>
        {editor.values.map((item) => (
          <label key={item.value}>
            <input
              checked={selected.has(item.value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.currentTarget.checked) next.add(item.value);
                else next.delete(item.value);
                updateValue(editor.values.map((entry) => entry.value).filter((value) => next.has(value)));
              }}
              type="checkbox"
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (editor.values.length > 0) {
    return (
      <label>
        <span>Value</span>
        <select
          aria-label={`Condition ${index + 1} value`}
          onChange={(event) => updateValue(editor.valueType === "boolean" ? event.currentTarget.value === "true" : event.currentTarget.value)}
          value={String(condition.value)}
        >
          {editor.values.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
    );
  }

  if (editor.valueType === "date") {
    const withinDays = condition.operator === "within_days";
    return (
      <label>
        <span>{withinDays ? "Days" : "Date"}</span>
        <input
          aria-label={`Condition ${index + 1} ${withinDays ? "days" : "date"}`}
          min={withinDays ? 0 : undefined}
          onChange={(event) => updateValue(withinDays ? Number(event.currentTarget.value) : event.currentTarget.value)}
          step={withinDays ? 1 : undefined}
          type={withinDays ? "number" : "date"}
          value={typeof condition.value === "number" || typeof condition.value === "string" ? condition.value : ""}
        />
      </label>
    );
  }

  return (
    <label>
      <span>{isSetOperator ? "Values (comma separated)" : "Value"}</span>
      <input
        aria-label={`Condition ${index + 1} value`}
        onChange={(event) => updateValue(isSetOperator
          ? event.currentTarget.value.split(",").map((item) => item.trim()).filter(Boolean)
          : event.currentTarget.value)}
        type="text"
        value={isSetOperator
          ? (Array.isArray(condition.value) ? condition.value.join(", ") : "")
          : (typeof condition.value === "string" ? condition.value : "")}
      />
    </label>
  );
}

async function fetchListingMonitors(signal?: AbortSignal): Promise<ListingMonitorListData> {
  const response = await fetch("/api/monitors/listing", { cache: "no-store", signal });
  const payload = await readApiPayload(response);
  if (!response.ok || !record(payload?.data) || !Array.isArray(payload.data.monitors)) {
    throw apiError(response, payload, "Could not load Listing monitors.");
  }
  return { monitors: payload.data.monitors as readonly ListingMonitor[] };
}

async function readApiPayload(response: Response) {
  return (await response.json().catch(() => null)) as ApiPayload | null;
}

function readCreatedMonitor(value: unknown) {
  if (!record(value) || !record(value.monitor) || typeof value.monitor.id !== "string") return null;
  return value.monitor as ListingMonitor;
}

class MonitorApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MonitorApiError";
    this.status = status;
  }
}

function apiError(response: Response, payload: ApiPayload | null, fallback: string) {
  return new MonitorApiError(response.status, payload?.message || fallback);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
