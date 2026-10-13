"use client";

import {OfferingPlanAlertDetails} from './OfferingPlanAlertDetails';
import Link from "next/link";
import { AlertTriangle, BellRing, CheckCircle2, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  addListingMonitorDraftCondition,
  changeListingMonitorDraftConditionOperator,
  createListingMonitorDraftReview,
  formatListingMonitorConditionPreview,
  getListingMonitorConditionEditorCatalog,
  getListingMonitorDraftCreateGate,
  groupListingMonitorConditionsByDomain,
  removeListingMonitorDraftCondition,
  replaceListingMonitorDraftCondition,
  setListingMonitorDraftIssueAbandoned,
  type ListingMonitorDraftReview,
} from "@/lib/monitor/listingMonitorDraftReview";
import type { ListingMonitorAlertItem } from "@/lib/monitor/listingMonitorApi";
import type { CanonicalListingMonitorCondition, ListingMonitor } from "@/lib/monitor/listingMonitorPersistence";
import { hasRetiredMonitorConditions, type MonitorConditionOperator } from "@/lib/monitor/conditionRegistry";
import type { NaturalLanguageMonitorDraft } from "@/lib/monitor/naturalLanguageMonitorDraft";
import {
  createMonitorPresetDraft,
  getMonitorAddConditionCatalog,
  getMonitorPresetCatalog,
  getMonitorPresetConditionSummary,
} from "@/lib/monitor/monitorPresets";
import {
  Form4InsiderPurchaseBuilder,
  Form4PurchaseAlertDetails,
  Form4PurchaseMonitorSummary,
} from "./Form4InsiderPurchaseMonitor";
import styles from "./ListingMonitorDraftBuilder.module.css";
import {ProjectedAlertDetails} from './ProjectedAlertDetails';

const EDITOR_CATALOG = getListingMonitorConditionEditorCatalog();
const EDITOR_BY_KEY = new Map(EDITOR_CATALOG.map((item) => [item.key, item]));
const MONITOR_PRESETS = readMonitorPresets();
const MONITOR_ADD_CONDITION_GROUPS = readMonitorAddConditionGroups();

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
  const [createdMonitor, setCreatedMonitor] = useState<ListingMonitor | null>(null);
  const [addConditionOpen, setAddConditionOpen] = useState(false);
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
    setCreatedMonitor(null);
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
    setCreatedMonitor(null);
    try {
      const response = await requestDraftConfirmation({
          draft: { ...draft, conditions: review.conditions },
          proposalId,
          choiceId,
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
    setCreatedMonitor(null);
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
      setCreatedMonitor(monitor);
      setDraft(null);
      setReview(null);
      setMessage("");
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

  async function confirmRegistration(registrationAccession: string) {
    if (!draft || !review || action !== "idle") return;
    setAction("confirming");
    try {
      const response = await requestDraftConfirmation({ draft: { ...draft, conditions: review.conditions }, registrationAccession });
      const payload = await readApiPayload(response);
      if (!response.ok || !payload?.data) throw apiError(response, payload, "Registration could not be confirmed.");
      setDraft(payload.data as NaturalLanguageMonitorDraft);
      setReview(createListingMonitorDraftReview(payload.data));
      setMessage("Registration confirmed. Review the exact target before creating the monitor.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Registration could not be confirmed. Build the monitor again."); }
    finally { setAction("idle"); }
  }

  function updateCondition(index: number, condition: CanonicalListingMonitorCondition) {
    setReview((current) => current
      ? replaceListingMonitorDraftCondition(current, index, condition)
      : current);
    setCreatedMonitor(null);
  }

  function selectPreset(presetId: string) {
    if (action !== "idle") return;
    setMessage("");
    setCreatedMonitor(null);
    try {
      const nextDraft = createMonitorPresetDraft(presetId);
      const nextReview = createListingMonitorDraftReview(nextDraft);
      setDraft(nextDraft);
      setReview(nextReview);
      setAddConditionOpen(false);
      setMessage("Preset loaded. Review or adjust each condition before creating it.");
    } catch {
      setDraft(null);
      setReview(null);
      setMessage("Recommended monitors are temporarily unavailable. Build a monitor from your description instead.");
    }
  }

  function addCondition(optionId: string) {
    if (!review || action !== "idle") return;
    const option = MONITOR_ADD_CONDITION_GROUPS
      .flatMap((group) => group.options)
      .find((candidate) => candidate.id === optionId);
    if (!option) {
      setMessage("That condition is temporarily unavailable.");
      return;
    }
    const nextReview = addListingMonitorDraftCondition(review, option.condition);
    if (nextReview === review) {
      setMessage("That condition is already included or conflicts with this monitor.");
      return;
    }
    setReview(nextReview);
    setCreatedMonitor(null);
    setAddConditionOpen(false);
    setMessage(`${option.title} added. Review the condition before creating this monitor.`);
  }

  return (
    <section className={styles.builder} aria-label="Custom alerts builder">
      {authRequired ? (
        <div className={styles.authNotice} role="status">
          <span>Sign in to create Custom alerts from saved conditions.</span>
          <Link href="/login?next=%2Fmonitor">Sign in</Link>
        </div>
      ) : null}

      <Form4InsiderPurchaseBuilder authRequired={authChecking || authRequired} />

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

      <section className={styles.presets} aria-labelledby="recommended-monitors-title">
        <div className={styles.presetsHeading}>
          <div>
            <h2 id="recommended-monitors-title">Recommended monitors</h2>
            <p>Start with a common setup, then edit any condition before creating it.</p>
          </div>
          <span>{MONITOR_PRESETS.length} recommendations</span>
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
            Recommended monitors are temporarily unavailable. Build a monitor from your description instead.
          </p>
        )}
      </section>

      {message ? <p className={styles.message} aria-live="polite">{message}</p> : null}

      {createdMonitor ? <CreatedMonitorSummary monitor={createdMonitor} /> : null}
      {review && draft?.effectResolution ? (
        <section className={styles.createdSummary} aria-label="Registration target review">
          <h2>Confirm the registration</h2>
          <p>{draft.effectResolution.message}</p>
          {draft.effectResolution.candidates.map(target => (
            <article key={`${target.cik}:${target.fileNumber}`}>
              <strong>{target.company} · {target.form} · {target.fileNumber}</strong>
              <p>CIK {target.cik} · {target.filingCount} filing{target.filingCount === 1 ? "" : "s"} in this registration</p>
              <p>Evidence: <a href={target.sourceUrl} target="_blank" rel="noreferrer">{target.accession}</a></p>
              {draft.effectResolution?.status !== "confirmed" ? <button type="button" disabled={action !== "idle"}
                onClick={() => void confirmRegistration(target.accession)}>Use this registration</button> : null}
            </article>
          ))}
          <p>One alert for this registration when a matching SEC EFFECT is confirmed. Missing EFFECT means unknown.</p>
          <p>To change the registration, edit your request and build the monitor again.</p>
        </section>
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

          <div aria-label="Monitor conditions">
            {review.conditions.length === 0 ? (
              <p className={styles.emptyState}>We can’t create this monitor yet. Remove the unsupported conditions or try another request.</p>
            ) : (
              <ConditionDomainCards
                action={action}
                conditions={review.conditions}
                onChange={updateCondition}
                onConfirm={applyConfirmation}
                onRemove={(index) => {
                  setReview((current) => current ? removeListingMonitorDraftCondition(current, index) : current);
                  setCreatedMonitor(null);
                }}
                proposals={review.proposals}
              />
            )}
          </div>

          <div className={styles.addCondition}>
            <button
              aria-expanded={addConditionOpen}
              className={styles.addConditionTrigger}
              disabled={action !== "idle" || MONITOR_ADD_CONDITION_GROUPS.length === 0}
              onClick={() => setAddConditionOpen((current) => !current)}
              type="button"
            >
              + Add condition
            </button>
            {addConditionOpen ? (
              <div aria-label="Add a condition" className={styles.addConditionPanel}>
                {MONITOR_ADD_CONDITION_GROUPS.map((group) => {
                  const visibleOptions = group.options.filter((option) =>
                    getAddConditionOptionState(review.conditions, option.condition) !== "hidden",
                  );
                  return visibleOptions.length > 0 ? (
                    <section key={group.id}>
                      <h3>{group.title}</h3>
                      {visibleOptions.map((option) => {
                        const optionState = getAddConditionOptionState(review.conditions, option.condition);
                        return (
                          <button
                            data-added={optionState === "added" ? "true" : "false"}
                            disabled={optionState === "added"}
                            key={option.id}
                            onClick={() => addCondition(option.id)}
                            type="button"
                          >
                            <span>{option.title}</span>
                            {optionState === "added" ? <small>Added</small> : null}
                          </button>
                        );
                      })}
                    </section>
                  ) : null;
                })}
              </div>
            ) : null}
          </div>

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
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const monitorById = useMemo(
    () => new Map(monitors.map((monitor) => [monitor.id, monitor])),
    [monitors],
  );

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
    if (isActive && hasRetiredMonitorConditions(monitor.conditions)) {
      setMessage('This condition is retired and cannot be resumed.');
      return;
    }
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
      setEditingId((current) => current === monitor.id ? "" : current);
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
          <span>Custom alerts</span>
          <h2 id="monitor-management-title">Your saved conditions</h2>
          <p>Manage the saved conditions that trigger your Custom alerts.</p>
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
        <p className={styles.emptyState}>No monitors yet. Open Custom alerts to create your first one.</p>
      ) : null}
      <div className={styles.monitorRows}>
        {monitors.map((monitor) => {
          const retired = hasRetiredMonitorConditions(monitor.conditions);
          return <article key={monitor.id} data-retired={retired ? 'true' : undefined}>
            <div className={styles.monitorStatus}>
              <strong>{monitor.kind === "form4_insider_purchase" ? "Form 4 purchase alert" : "Custom alerts"}</strong>
              <span data-active={!retired && monitor.isActive ? "true" : "false"}>{retired ? 'Retired condition' : monitor.isActive ? "Active" : "Paused"}</span>
            </div>
            {retired && <p>This condition no longer runs or creates alerts. Its saved settings are kept for reference.</p>}
            {monitor.kind === "form4_insider_purchase" && !retired ? (
              <Form4PurchaseMonitorSummary
                busy={actionId === monitor.id}
                editing={editingId === monitor.id}
                monitor={monitor}
                onCancel={() => setEditingId("")}
                onEdit={() => setEditingId(monitor.id)}
                onSaved={(updated) => {
                  setMonitors((current) => current.map((item) => item.id === updated.id ? updated : item));
                  setEditingId("");
                  setMessage("Form 4 purchase alert updated.");
                }}
              />
            ) : (
              <ul>
                {monitor.conditions.map((condition, index) => (
                  <li key={`${monitor.id}-${index}`}>{formatListingMonitorConditionPreview(condition).text}</li>
                ))}
              </ul>
            )}
            <div className={styles.monitorActions}>
              <span>Created {formatMonitorDate(monitor.createdAt)}</span>
              {(!retired || monitor.isActive) && <button
                disabled={actionId === monitor.id}
                onClick={() => void setMonitorActive(monitor, !monitor.isActive)}
                type="button"
              >
                {monitor.isActive ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
                {monitor.isActive ? "Pause" : "Resume"}
              </button>}
              <button
                className={styles.deleteMonitor}
                disabled={actionId === monitor.id}
                onClick={() => void removeMonitor(monitor)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} /> Delete
              </button>
            </div>
          </article>;
        })}
      </div>

      {!authRequired ? (
        <section className={styles.generatedAlerts} aria-labelledby="monitor-alerts-title">
          <div>
            <h3 id="monitor-alerts-title"><BellRing aria-hidden="true" size={17} /> Custom alerts</h3>
            <span>{loading ? "Loading..." : `${alertTotal} total`}</span>
          </div>
          {!loading && alerts.length === 0 ? (
            <p>No Custom alerts yet. Alerts appear when your saved conditions match.</p>
          ) : (
            <ul>
              {alerts.map((alert) => (
                <li className={alert.offeringPlanEvidence || alert.effectEvidence || alert.projectedScenario || alert.ntAlertTitle ? styles.effectAlert : undefined} id={`monitor-alert-${alert.id}`} key={alert.id} data-alert-id={alert.id}>
                  {alert.offeringPlanEvidence ? (
                    <OfferingPlanAlertDetails id={alert.id} evidence={alert.offeringPlanEvidence}/>
                  ) : alert.projectedScenario ? (
                    <ProjectedAlertDetails id={alert.id} scenario={alert.projectedScenario}/>
                  ) : alert.effectEvidence ? (
                    <>
                      <strong>Registration EFFECT confirmed</strong>
                      <span>{alert.effectEvidence.registrationForm} · {alert.effectEvidence.fileNumber} · CIK {alert.effectEvidence.cik}</span>
                      <span>Effective date: {alert.effectEvidence.effectiveDate}</span>
                      <a href={alert.effectEvidence.sourceUrl} target="_blank" rel="noreferrer">SEC EFFECT {alert.effectEvidence.effectAccession}</a>
                    </>
                  ) : alert.matchEvidence ? (
                    <Form4PurchaseAlertDetails
                      alert={alert}
                      settings={alert.monitorId ? monitorById.get(alert.monitorId)?.form4PurchaseSettings ?? null : null}
                    />
                  ) : alert.ntAlertTitle ? (
                    <>
                      <strong>{alert.ntAlertTitle}</strong>
                      <span>{formatMonitorDate(alert.createdAt)}</span>
                      {alert.eventId ? <a href={`/filings/${encodeURIComponent(alert.eventId)}`}>View filing</a> : null}
                    </>
                  ) : (
                    <>
                      <strong>Alert delivered</strong>
                      <span>{formatMonitorDate(alert.createdAt)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}

function requestDraftConfirmation(body: unknown) {
  return fetch("/api/monitors/listing/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function ConditionDomainCards({
  action = "idle",
  conditions,
  onChange,
  onConfirm,
  onRemove,
  proposals = [],
}: Readonly<{
  action?: string;
  conditions: readonly CanonicalListingMonitorCondition[];
  onChange?: (index: number, condition: CanonicalListingMonitorCondition) => void;
  onConfirm?: (proposalId: string, choiceId: string) => Promise<void>;
  onRemove?: (index: number) => void;
  proposals?: readonly Readonly<{
    id: string;
    preview: Readonly<{ label: string; value: string }>;
    choices: readonly Readonly<{ id: string; label: string }>[];
  }>[];
}>) {
  const groups = groupListingMonitorConditionsByDomain(conditions);
  const visibleDomains = (["market", "corporate-actions", "listing-risk", "proxy", "effect", "projected", "offering-plan"] as const).filter((id) =>
    groups.some((group) => group.id === id) || (id === "corporate-actions" && proposals.length > 0),
  );
  const titles = {
    market: "Market",
    "corporate-actions": "Corporate Actions",
    "listing-risk": "Listing Risk",
    "proxy": "Proxy",
    "effect": "Registration EFFECT",
    "projected": "Projected offering dilution",
    "offering-plan": "Offering Plan",
  } as const;

  return (
    <div className={styles.conditionDomainGrid}>
      {visibleDomains.map((domainId) => {
        const group = groups.find((candidate) => candidate.id === domainId);
        return (
          <section className={styles.conditionDomainCard} data-domain={domainId} key={domainId}>
            <h3>{titles[domainId]}</h3>
            {group?.items.length ? (
              <div className={styles.domainConditions}>
                {group.items.map(({ condition, index }) => (
                  onChange && onRemove && domainId !== "effect" ? (
                    <ConditionEditor
                      condition={condition}
                      index={index}
                      key={`${index}-${condition.key}`}
                      onChange={(next) => onChange(index, next)}
                      onRemove={() => onRemove(index)}
                    />
                  ) : (
                    <ConditionReadOnlyRow condition={condition} key={`${index}-${condition.key}`} />
                  )
                ))}
              </div>
            ) : null}
            {domainId === "corporate-actions" && proposals.length > 0 ? (
              <div className={styles.domainConfirmation}>
                <h4>Suggested filter</h4>
                {proposals.map((proposal) => (
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
                          onClick={() => void onConfirm?.(proposal.id, choice.id)}
                          type="button"
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ConditionReadOnlyRow({
  condition,
}: Readonly<{ condition: CanonicalListingMonitorCondition }>) {
  const preview = formatListingMonitorConditionPreview(condition);
  return (
    <div className={styles.conditionReadOnlyRow}>
      <span>{preview.label}</span>
      <strong>{preview.value}</strong>
    </div>
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
  const [editing, setEditing] = useState(false);
  const editor = EDITOR_BY_KEY.get(condition.key) ?? EDITOR_CATALOG[0];
  const preview = formatListingMonitorConditionPreview(condition);
  const fixedEvent = condition.key === "corporate_action.event_kind" || condition.key === "listing.event_kind";
  const editable = !fixedEvent && (
    editor.operators.length > 1
    || editor.values.length > 1
    || editor.values.length === 0
  );

  return (
    <article className={styles.conditionCard}>
      <div className={styles.conditionSummary}>
        <div className={styles.conditionPreview}>
          <span>{preview.label}</span>
          <strong>{preview.value}</strong>
        </div>
        <div className={styles.conditionActions}>
          {editable ? (
            <button
              aria-expanded={editing}
              aria-label={`Edit ${preview.label}`}
              onClick={() => setEditing((current) => !current)}
              type="button"
            >
              <Pencil aria-hidden="true" size={15} /> {editing ? "Cancel" : "Edit"}
            </button>
          ) : null}
          <button aria-label={`Remove ${preview.label}`} className={styles.removeCondition} onClick={onRemove} type="button">
            <Trash2 aria-hidden="true" size={16} /> Remove
          </button>
        </div>
      </div>
      {editing ? (
        <div className={styles.editorFields}>
          {editor.operators.length > 1 && condition.key !== "listing.compliance_deadline" ? (
            <label>
              <span>{condition.key === "market.price" ? "Price is" : "Comparison"}</span>
              <select
                aria-label={`Edit ${preview.label} comparison`}
                onChange={(event) => onChange(changeListingMonitorDraftConditionOperator(
                  condition,
                  event.currentTarget.value as MonitorConditionOperator,
                ))}
                value={condition.operator}
              >
                {editor.operators.map((item) => (
                  <option key={item.value} value={item.value}>
                    {getConditionOperatorLabel(condition.key, item.value, item.label)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ConditionValueEditor condition={condition} index={index} onChange={onChange} />
          <button className={styles.finishEdit} onClick={() => setEditing(false)} type="button">Done</button>
        </div>
      ) : null}
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
        <legend>{editor.label}</legend>
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
        <span>{editor.label}</span>
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
        <span>{condition.key === "market.price" ? "Price amount" : editor.label}</span>
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
      <span>{isSetOperator ? `${editor.label} (comma separated)` : editor.label}</span>
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

function CreatedMonitorSummary({ monitor }: Readonly<{ monitor: ListingMonitor }>) {
  return (
    <section className={styles.createdSummary} aria-labelledby="created-monitor-title" aria-live="polite">
      <header>
        <CheckCircle2 aria-hidden="true" size={22} />
        <div>
          <h2 id="created-monitor-title">Monitor created</h2>
          <p>This is what Stock Radar saved and is watching now.</p>
        </div>
      </header>
      <div aria-label="Created monitor conditions">
        <ConditionDomainCards conditions={monitor.conditions} />
      </div>
      <footer>
        <div>
          <span>Status</span>
          <strong>{monitor.isActive ? "Active" : "Paused"}</strong>
        </div>
        <Link href="/alerts">Manage monitors</Link>
      </footer>
    </section>
  );
}

function getConditionOperatorLabel(
  key: string,
  operator: MonitorConditionOperator,
  fallback: string,
) {
  if (key !== "market.price") return fallback;
  return ({
    lt: "Less than",
    lte: "Or less",
    gt: "More than",
    gte: "Or more",
  } as Partial<Record<MonitorConditionOperator, string>>)[operator] ?? fallback;
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

function getAddConditionOptionState(
  conditions: readonly CanonicalListingMonitorCondition[],
  option: CanonicalListingMonitorCondition,
): "available" | "added" | "hidden" {
  const selected = conditions.find((condition) => condition.key === option.key);
  if (!selected) return "available";
  if (option.key === "listing.event_kind") {
    return selected.value === option.value ? "added" : "hidden";
  }
  return "added";
}

function readMonitorAddConditionGroups() {
  try {
    const editorByKey = new Map(
      getListingMonitorConditionEditorCatalog().map((editor) => [editor.key, editor]),
    );
    const groups = getMonitorAddConditionCatalog().map((group) => ({
      ...group,
      options: group.options.filter((option) => {
        const editor = editorByKey.get(option.condition.key);
        if (!editor) return false;
        const preview = formatListingMonitorConditionPreview(option.condition);
        const fixedHumanValue = option.condition.key === "corporate_action.event_kind"
          || option.condition.key === "listing.event_kind";
        const usableEditor = fixedHumanValue
          || editor.values.length > 0
          || editor.operators.length > 0;
        return usableEditor && preview.label !== "Condition" && preview.value.trim().length > 0;
      }),
    })).filter((group) => group.options.length > 0);
    const expectedCount = getMonitorAddConditionCatalog().reduce((count, group) => count + group.options.length, 0);
    return groups.reduce((count, group) => count + group.options.length, 0) === expectedCount ? groups : [];
  } catch {
    return [];
  }
}
