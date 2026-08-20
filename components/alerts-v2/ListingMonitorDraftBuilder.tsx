"use client";

import Link from "next/link";
import { AlertTriangle, BellRing, CheckCircle2, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import type { ListingMonitorAlertItem } from "@/lib/monitor/listingMonitorApi";
import type { CanonicalListingMonitorCondition, ListingMonitor } from "@/lib/monitor/listingMonitorPersistence";
import type { MonitorConditionOperator } from "@/lib/monitor/conditionRegistry";
import type { NaturalLanguageMonitorDraft } from "@/lib/monitor/naturalLanguageMonitorDraft";
import {
  createMonitorPresetDraft,
  getMonitorPresetCatalog,
  getMonitorPresetConditionSummary,
} from "@/lib/monitor/monitorPresets";
import styles from "./ListingMonitorDraftBuilder.module.css";

const EDITOR_CATALOG = getListingMonitorConditionEditorCatalog();
const EDITOR_BY_KEY = new Map(EDITOR_CATALOG.map((item) => [item.key, item]));
const MONITOR_PRESETS = readMonitorPresets();

type ApiPayload = Readonly<{
  ok?: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}>;

type ListingMonitorListData = Readonly<{
  monitors: readonly ListingMonitor[];
}>;

type ListingMonitorAlertsData = Readonly<{
  alerts: readonly ListingMonitorAlertItem[];
  total: number;
}>;

export function ListingMonitorDraftBuilder() {
  const [text, setText] = useState("");
  const [review, setReview] = useState<ListingMonitorDraftReview | null>(null);
  const [draft, setDraft] = useState<NaturalLanguageMonitorDraft | null>(null);
  const [action, setAction] = useState<"idle" | "compiling" | "confirming" | "creating">("idle");
  const [authChecking, setAuthChecking] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState(false);
  const createGate = useMemo(
    () => review ? getListingMonitorDraftCreateGate(review) : null,
    [review],
  );
  const hasUnresolvedIssues = review?.issues.some((issue) => !issue.abandoned) ?? false;

  useEffect(() => {
    const controller = new AbortController();
    fetchListingMonitors(controller.signal)
      .then(() => setAuthRequired(false))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof MonitorApiError && error.status === 401) setAuthRequired(true);
        else setMessage("We couldn’t check your monitors. Try again in a moment.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthChecking(false);
      });
    return () => controller.abort();
  }, []);

  async function compileDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action !== "idle") return;
    setAction("compiling");
    setMessage("");
    setCreated(false);
    try {
      const response = await fetch("/api/monitors/listing/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await readApiPayload(response);
      if (!response.ok || !payload?.data) throw apiError(response, payload, "Could not build this monitor.");
      const nextReview = createListingMonitorDraftReview(payload.data);
      setDraft(payload.data as NaturalLanguageMonitorDraft);
      setReview(nextReview);
      setAuthRequired(false);
      setMessage(nextReview.proposals.length > 0
        ? "Confirm or remove the suggested filter to finish this monitor."
        : "Your monitor is ready to review.");
    } catch (error) {
      if (error instanceof MonitorApiError && error.status === 401) {
        setAuthRequired(true);
        setMessage("Sign in to build and create a monitor.");
      } else {
        setMessage("We couldn’t build this monitor. Try a clearer request.");
      }
    } finally {
      setAction("idle");
    }
  }

  async function applyConfirmation(proposalId: string, choiceId: string) {
    if (!draft || !review || action !== "idle") return;
    setAction("confirming");
    setMessage("");
    setCreated(false);
    try {
      const response = await fetch("/api/monitors/listing/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: { ...draft, conditions: review.conditions },
          proposalId,
          choiceId,
        }),
      });
      const payload = await readApiPayload(response);
      if (!response.ok || !payload?.data) throw apiError(response, payload, "Could not apply this choice.");
      const nextReview = createListingMonitorDraftReview(payload.data);
      setDraft(payload.data as NaturalLanguageMonitorDraft);
      setReview(nextReview);
      setAuthRequired(false);
      setMessage(nextReview.proposals.length > 0
        ? "Confirm or remove the remaining suggested filter."
        : "Your choice was applied. Review the monitor before creating it.");
    } catch (error) {
      if (error instanceof MonitorApiError && error.status === 401) {
        setAuthRequired(true);
        setMessage("Sign in to finish this monitor.");
      } else {
        setMessage("We couldn't apply this choice. Build the monitor again.");
      }
    } finally {
      setAction("idle");
    }
  }

  async function createMonitor() {
    if (!review || !createGate?.ready || action !== "idle") return;
    setAction("creating");
    setMessage("");
    setCreated(false);
    try {
      const response = await fetch("/api/monitors/listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: createGate.conditions }),
      });
      const payload = await readApiPayload(response);
      const monitor = readMonitor(payload?.data);
      if (!response.ok || !monitor) throw apiError(response, payload, "Could not create this monitor.");
      setAuthRequired(false);
      setCreated(true);
      setMessage("Monitor created. It is active now and ready in Alerts.");
    } catch (error) {
      if (error instanceof MonitorApiError && error.status === 401) {
        setAuthRequired(true);
        setMessage("Sign in to create this monitor.");
      } else {
        setMessage("We couldn’t create this monitor. Review your choices and try again.");
      }
    } finally {
      setAction("idle");
    }
  }

  function updateCondition(index: number, condition: CanonicalListingMonitorCondition) {
    setReview((current) => current
      ? replaceListingMonitorDraftCondition(current, index, condition)
      : current);
    setCreated(false);
  }

  function selectPreset(presetId: string) {
    if (action !== "idle") return;
    setMessage("");
    setCreated(false);
    try {
      const nextDraft = createMonitorPresetDraft(presetId);
      const nextReview = createListingMonitorDraftReview(nextDraft);
      setDraft(nextDraft);
      setReview(nextReview);
      setMessage("Preset loaded. Review or adjust each condition before creating it.");
    } catch {
      setDraft(null);
      setReview(null);
      setMessage("Popular monitors are temporarily unavailable. Build a monitor from your description instead.");
    }
  }

  return (
    <section className={styles.builder} aria-label="AI Monitor builder">
      {authRequired ? (
        <div className={styles.authNotice} role="status">
          <span>Sign in to build and create an AI Monitor.</span>
          <Link href="/login?next=%2Fmonitor">Sign in</Link>
        </div>
      ) : null}

      <form className={styles.promptForm} onSubmit={compileDraft}>
        <label htmlFor="monitor-natural-language">What should Stock Radar watch?</label>
        <textarea
          disabled={authChecking || authRequired || action !== "idle"}
          id="monitor-natural-language"
          maxLength={1000}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder="Alert me when a Nasdaq company receives a listing deficiency and has a compliance deadline within 30 days."
          required
          rows={5}
          value={text}
        />
        <div className={styles.promptActions}>
          <span>{text.length} / 1000</span>
          <button disabled={authChecking || authRequired || action !== "idle" || !text.trim()} type="submit">
            {action === "compiling" ? "Building monitor..." : "Build monitor"}
          </button>
        </div>
      </form>

      <section className={styles.presets} aria-labelledby="popular-monitors-title">
        <div className={styles.presetsHeading}>
          <div>
            <h2 id="popular-monitors-title">Popular monitors</h2>
            <p>Start with a common setup, then edit any condition before creating it.</p>
          </div>
          <span>4 starting points</span>
        </div>
        {MONITOR_PRESETS.length > 0 ? (
          <div className={styles.presetGrid}>
            {MONITOR_PRESETS.map((preset) => (
              <button
                aria-label={`Use ${preset.title} preset`}
                className={styles.presetCard}
                disabled={action !== "idle"}
                key={preset.id}
                onClick={() => selectPreset(preset.id)}
                type="button"
              >
                <span className={styles.presetCategory}>{preset.category}</span>
                <strong>{preset.title}</strong>
                <span>{preset.description}</span>
                <small>{getMonitorPresetConditionSummary(preset)}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.presetUnavailable} role="status">
            Popular monitors are temporarily unavailable. Build a monitor from your description instead.
          </p>
        )}
      </section>

      {message ? (
        <p className={created ? styles.successMessage : styles.message} aria-live="polite">
          {created ? <CheckCircle2 aria-hidden="true" size={18} /> : null}
          <span>{message}</span>
          {created ? <Link href="/alerts">Manage monitors</Link> : null}
        </p>
      ) : null}

      {review ? (
        <div className={styles.review}>
          <div className={styles.reviewHeading}>
            <div>
              <h2>Your monitor</h2>
              <p>Review or adjust each condition before you create it.</p>
            </div>
            <span data-ready={createGate?.ready ? "true" : "false"}>
              {createGate?.ready ? "Review your monitor" : "Needs attention"}
            </span>
          </div>

          <div className={styles.previewList} aria-label="Monitor conditions">
            {review.conditions.length === 0 ? (
              <p className={styles.emptyState}>We can’t create this monitor yet. Remove the unsupported conditions or try another request.</p>
            ) : review.conditions.map((condition, index) => (
              <ConditionEditor
                condition={condition}
                index={index}
                key={`${index}-${condition.key}`}
                onChange={(next) => updateCondition(index, next)}
                onRemove={() => {
                  setReview((current) => current ? removeListingMonitorDraftCondition(current, index) : current);
                  setCreated(false);
                }}
              />
            ))}
          </div>

          {review.proposals.length > 0 ? (
            <section className={styles.confirmations} aria-labelledby="monitor-confirmations-title">
              <h3 id="monitor-confirmations-title">AI suggested an additional filter</h3>
              {review.proposals.map((proposal) => (
                <fieldset disabled={action !== "idle"} key={proposal.id}>
                  <legend>Confirm this filter</legend>
                  <div className={styles.suggestedFilterPreview}>
                    <span>{proposal.preview.label}</span>
                    <strong>{proposal.preview.value}</strong>
                  </div>
                  <div className={styles.confirmationActions}>
                    {proposal.choices.map((choice) => (
                      <button
                        key={choice.id}
                        onClick={() => void applyConfirmation(proposal.id, choice.id)}
                        type="button"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
            </section>
          ) : null}

          {review.issues.length > 0 ? (
            <section className={styles.issues} aria-labelledby="monitor-issues-title">
              <h3 id="monitor-issues-title">We can’t use these conditions yet</h3>
              <p>They stay in your request until you remove them.</p>
              {review.issues.map((issue) => (
                <article data-removed={issue.abandoned ? "true" : "false"} key={issue.id}>
                  <AlertTriangle aria-hidden="true" size={18} />
                  <div>
                    <strong>{issue.kind === "unsupported" ? "Not supported yet" : "Needs more detail"}</strong>
                    <q>{issue.sourceText}</q>
                    <span>
                      {issue.kind === "unsupported"
                        ? "This condition isn’t available yet."
                        : "This condition needs more detail before it can be used."}
                    </span>
                  </div>
                  <button
                    onClick={() => setReview((current) => current
                      ? setListingMonitorDraftIssueAbandoned(current, issue.id, !issue.abandoned)
                      : current)}
                    type="button"
                  >
                    {issue.abandoned ? "Restore" : "Remove"}
                  </button>
                </article>
              ))}
            </section>
          ) : null}

          <footer className={styles.confirmBar}>
            <div>
              <strong>{createGate?.ready ? "Ready when you are" : "Some conditions need your attention."}</strong>
              <span>{getCreateGuidance(review, createGate?.errors ?? [], hasUnresolvedIssues)}</span>
            </div>
            <button
              disabled={!createGate?.ready || action !== "idle" || authRequired}
              onClick={() => void createMonitor()}
              type="button"
            >
              {action === "creating" ? "Creating monitor..." : "Create this monitor"}
            </button>
          </footer>
        </div>
      ) : null}
    </section>
  );
}

export function ListingMonitorManagement() {
  const [monitors, setMonitors] = useState<readonly ListingMonitor[]>([]);
  const [alerts, setAlerts] = useState<readonly ListingMonitorAlertItem[]>([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [actionId, setActionId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchListingMonitors(controller.signal),
      fetchListingMonitorAlerts(controller.signal),
    ])
      .then(([monitorData, alertData]) => {
        setMonitors(monitorData.monitors);
        setAlerts(alertData.alerts);
        setAlertTotal(alertData.total);
        setAuthRequired(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof MonitorApiError && error.status === 401) setAuthRequired(true);
        else setMessage("We couldn’t load your monitors. Try again in a moment.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function setMonitorActive(monitor: ListingMonitor, isActive: boolean) {
    setActionId(monitor.id);
    setMessage("");
    try {
      const response = await fetch(`/api/monitors/listing/${encodeURIComponent(monitor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const payload = await readApiPayload(response);
      const updated = readMonitor(payload?.data);
      if (!response.ok || !updated) throw apiError(response, payload, "Could not update this monitor.");
      setMonitors((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(isActive ? "Monitor resumed." : "Monitor paused.");
    } catch {
      setMessage("We couldn’t update this monitor. Try again.");
    } finally {
      setActionId("");
    }
  }

  async function removeMonitor(monitor: ListingMonitor) {
    setActionId(monitor.id);
    setMessage("");
    try {
      const response = await fetch(`/api/monitors/listing/${encodeURIComponent(monitor.id)}`, { method: "DELETE" });
      const payload = await readApiPayload(response);
      if (!response.ok || !record(payload?.data) || payload.data.deleted !== true) {
        throw apiError(response, payload, "Could not delete this monitor.");
      }
      setMonitors((current) => current.filter((item) => item.id !== monitor.id));
      setMessage("Monitor deleted.");
    } catch {
      setMessage("We couldn’t delete this monitor. Try again.");
    } finally {
      setActionId("");
    }
  }

  return (
    <section className={styles.management} aria-labelledby="monitor-management-title">
      <div className={styles.managementHeading}>
        <div>
          <span>AI Monitor</span>
          <h2 id="monitor-management-title">Your monitors</h2>
          <p>Pause, resume, or remove the monitors you’ve created.</p>
        </div>
        <strong>{loading ? "Loading..." : `${monitors.length} total`}</strong>
      </div>

      {authRequired ? (
        <div className={styles.authNotice} role="status">
          <span>Sign in to manage your monitors and view generated alerts.</span>
          <Link href="/login?next=%2Falerts">Sign in</Link>
        </div>
      ) : null}
      {message ? <p className={styles.managementMessage} role="status">{message}</p> : null}

      {!loading && !authRequired && monitors.length === 0 ? (
        <p className={styles.emptyState}>No monitors yet. Open AI Monitor to create your first one.</p>
      ) : null}
      <div className={styles.monitorRows}>
        {monitors.map((monitor) => (
          <article key={monitor.id}>
            <div className={styles.monitorStatus}>
              <strong>AI Monitor</strong>
              <span data-active={monitor.isActive ? "true" : "false"}>{monitor.isActive ? "Active" : "Paused"}</span>
            </div>
            <ul>
              {monitor.conditions.map((condition, index) => (
                <li key={`${monitor.id}-${index}`}>{formatListingMonitorConditionPreview(condition).text}</li>
              ))}
            </ul>
            <div className={styles.monitorActions}>
              <span>Created {formatMonitorDate(monitor.createdAt)}</span>
              <button
                disabled={actionId === monitor.id}
                onClick={() => void setMonitorActive(monitor, !monitor.isActive)}
                type="button"
              >
                {monitor.isActive ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
                {monitor.isActive ? "Pause" : "Resume"}
              </button>
              <button
                className={styles.deleteMonitor}
                disabled={actionId === monitor.id}
                onClick={() => void removeMonitor(monitor)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} /> Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {!authRequired ? (
        <section className={styles.generatedAlerts} aria-labelledby="monitor-alerts-title">
          <div>
            <h3 id="monitor-alerts-title"><BellRing aria-hidden="true" size={17} /> Monitor alerts</h3>
            <span>{loading ? "Loading..." : `${alertTotal} total`}</span>
          </div>
          {!loading && alerts.length === 0 ? (
            <p>No monitor alerts yet.</p>
          ) : (
            <ul>
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <strong>Alert delivered</strong>
                  <span>{formatMonitorDate(alert.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
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
        <span>{preview.label}</span>
        <strong>{preview.value}</strong>
      </div>
      <div className={styles.editorFields}>
        <label>
          <span>Watch for</span>
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
            aria-label={`Condition ${index + 1} match`}
            onChange={(event) => onChange(changeListingMonitorDraftConditionOperator(condition, event.currentTarget.value as MonitorConditionOperator))}
            value={condition.operator}
          >
            {editor.operators.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <ConditionValueEditor condition={condition} index={index} onChange={onChange} />
        <button aria-label={`Remove ${preview.label}`} className={styles.removeCondition} onClick={onRemove} type="button">
          <Trash2 aria-hidden="true" size={16} /> Remove
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

  if (editor.valueType === "number") {
    return (
      <label>
        <span>Value</span>
        <input
          aria-label={`Condition ${index + 1} value`}
          inputMode="decimal"
          min={editor.exclusiveMinimum}
          onChange={(event) => updateValue(
            event.currentTarget.value === "" ? "" : Number(event.currentTarget.value),
          )}
          step="any"
          type="number"
          value={typeof condition.value === "number" || typeof condition.value === "string"
            ? condition.value
            : ""}
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

function getCreateGuidance(
  review: ListingMonitorDraftReview,
  errors: readonly string[],
  hasUnresolvedIssues: boolean,
) {
  if (review.proposals.length > 0) return "Confirm or remove every suggested filter before creating this monitor.";
  if (review.conditions.length === 0) {
    return "We can’t create this monitor yet. Remove the unsupported conditions or try another request.";
  }
  if (hasUnresolvedIssues) return "Remove the conditions we can’t use before creating this monitor.";
  if (errors.length > 0) return "Choose valid, non-conflicting options before creating this monitor.";
  return `${review.conditions.length} condition${review.conditions.length === 1 ? "" : "s"} will be created.`;
}

function formatMonitorDate(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(parsed)
    : "Recently";
}

async function fetchListingMonitors(signal?: AbortSignal): Promise<ListingMonitorListData> {
  const response = await fetch("/api/monitors/listing", { cache: "no-store", signal });
  const payload = await readApiPayload(response);
  if (!response.ok || !record(payload?.data) || !Array.isArray(payload.data.monitors)) {
    throw apiError(response, payload, "Could not load monitors.");
  }
  return { monitors: payload.data.monitors as readonly ListingMonitor[] };
}

async function fetchListingMonitorAlerts(signal?: AbortSignal): Promise<ListingMonitorAlertsData> {
  const response = await fetch("/api/monitors/listing/alerts?limit=20", { cache: "no-store", signal });
  const payload = await readApiPayload(response);
  if (
    !response.ok
    || !record(payload?.data)
    || !Array.isArray(payload.data.alerts)
    || typeof payload.data.total !== "number"
  ) {
    throw apiError(response, payload, "Could not load monitor alerts.");
  }
  return {
    alerts: payload.data.alerts as readonly ListingMonitorAlertItem[],
    total: payload.data.total,
  };
}

async function readApiPayload(response: Response) {
  return (await response.json().catch(() => null)) as ApiPayload | null;
}

function readMonitor(value: unknown) {
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

function readMonitorPresets() {
  try {
    return getMonitorPresetCatalog();
  } catch {
    return [];
  }
}
