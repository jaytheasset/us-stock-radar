import Link from "next/link";
import { Fragment } from "react";
import styles from "@/components/admin/AdminSection.module.css";
import { TickerResolutionHumanReview } from "@/components/admin/TickerResolutionHumanReview";
import { rolesHavePermission } from "@/lib/admin/policy";
import { requireAdminPermission } from "@/lib/admin/server";
import {
  readEffectiveSecTickerResolutionByDecisionId,
  type SecTickerEffectiveReadResult,
} from "@/lib/sec-ticker-resolution/humanReview";
import {
  listSecTickerResolutions,
} from "@/lib/sec-ticker-resolution/persistence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageSearchParams = Promise<{
  decisionId?: string;
  q?: string;
  state?: string;
}>;

type Row = Record<string, unknown>;

export default async function AdminTickerResolutionPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const access = await requireAdminPermission("system.read");
  const canWriteHumanReview = rolesHavePermission(access.roles, "data.run");
  const params = await searchParams;
  const state = normalizeState(params.state);
  const query = (params.q || "").trim().slice(0, 120);
  const decisionId = (params.decisionId || "").trim();
  const [listing, selected] = await Promise.all([
    listSecTickerResolutions({ state: state || undefined, query }),
    decisionId
      ? readEffectiveSecTickerResolutionByDecisionId({ decisionId })
      : Promise.resolve<SecTickerEffectiveReadResult | null>(null),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>SEC data integrity</span>
          <h1>Ticker resolution</h1>
          <p>
            Validated, append-only relationships from retained SEC cover observations and
            exact filing evidence. Human actions are separate append-only events; automatic
            observations and decisions are never edited.
          </p>
        </div>
        <span className={styles.badge}>Controlled review</span>
      </header>

      {listing.status === "unavailable" ? (
        <div className={styles.error} role="alert">
          Resolution records are unavailable. No empty result was inferred.
        </div>
      ) : (
        <>
          <section aria-labelledby="resolution-status-heading" className={styles.stack}>
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="resolution-status-heading">Validated status overview</h2>
                <p>
                  Latest {listing.scope.scanned} saved decision{listing.scope.scanned === 1 ? "" : "s"}
                  {listing.scope.truncated ? ` within a bounded ${listing.scope.limit}-row scan` : " in the bounded scan"}.
                  Counts never include records the official reader could not validate.
                </p>
              </div>
            </div>
            <div className={styles.detailGrid}>
              {(["AUTO", "REVIEW", "UNRESOLVED"] as const).map((value) => (
                <Link className={styles.card} href={filterHref({ state: value, query })} key={value}>
                  <span className={statePillClass(value)}>{value}</span>
                  <p><strong>{listing.counts[value]}</strong> validated in this bounded scan</p>
                </Link>
              ))}
            </div>
            {listing.counts.unavailable ? (
              <div className={styles.error} role="status">
                {listing.counts.unavailable} saved decision{listing.counts.unavailable === 1 ? " was" : "s were"}
                {" "}excluded because validation or source revision checks were unavailable.
              </div>
            ) : null}
          </section>

          <form className={styles.toolbar} key={filterHref({ query, state })} method="get">
            <label className={`${styles.field} ${styles.fieldGrow}`}>
              <span>Issuer, ticker, accession, or decision ID</span>
              <input className={styles.input} defaultValue={query} maxLength={120} name="q" placeholder="GGRP or 0001854445" />
            </label>
            <label className={styles.field}>
              <span>Resolution state</span>
              <select className={styles.select} defaultValue={state} name="state">
                <option value="">All validated states</option>
                <option value="AUTO">AUTO</option>
                <option value="REVIEW">REVIEW</option>
                <option value="UNRESOLVED">UNRESOLVED</option>
              </select>
            </label>
            <button className={styles.button} type="submit">Apply filters</button>
            <Link className={styles.button} href="/admin/data/ticker-resolution">Clear</Link>
          </form>

          <section aria-labelledby="resolution-list-heading" className={styles.stack}>
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="resolution-list-heading">Relationships and review targets</h2>
                <p>{listing.relationships.length} validated match{listing.relationships.length === 1 ? "" : "es"} in the current bounded scan.</p>
              </div>
            </div>
            {listing.relationships.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Issuer</th>
                      <th>Relationship</th>
                      <th>Security</th>
                      <th>Effective</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listing.relationships.map((item) => {
                      const decision = item.decision;
                      const relationship = record(record(decision.decision_payload).relationship);
                      const itemState = stringValue(decision.resolution_state);
                      const href = filterHref({
                        decisionId: stringValue(decision.id),
                        query,
                        state,
                      });
                      return (
                        <tr key={stringValue(decision.id)}>
                          <td><span className={statePillClass(itemState)}>{itemState}</span></td>
                          <td className={styles.mono}>CIK {stringValue(decision.issuer_cik)}</td>
                          <td>
                            <Link href={href}>{displayTicker(relationship.oldTicker)} → {displayTicker(relationship.newTicker)}</Link>
                            <div className={styles.muted}>{humanize(stringValue(decision.resolution_type))}</div>
                          </td>
                          <td>
                            {humanize(stringValue(item.identity?.security_type) || item.evaluation.summary.securityType || "unresolved")}
                            <div className={styles.muted}>{stringValue(item.identity?.before_security_title) || "Title unavailable"}</div>
                          </td>
                          <td>
                            {stringValue(item.evidence?.effective_date) || item.evaluation.summary.effectiveDate || "Unresolved"}
                            <div className={styles.muted}>{humanize(stringValue(item.evidence?.effective_precision) || item.evaluation.summary.effectivePrecision || "unknown")}</div>
                          </td>
                          <td className={styles.mono}>{stringValue(decision.evidence_accession_number)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty} role="status">
                <strong>No validated matches in this bounded scan.</strong>
                <p>Change the filters, or use an exact decision URL if the record may be older than this list window.</p>
              </div>
            )}
          </section>
        </>
      )}

      {selected ? (
        <SelectedResolution
          canWriteHumanReview={canWriteHumanReview}
          result={selected}
        />
      ) : null}
    </div>
  );
}

function SelectedResolution({
  canWriteHumanReview,
  result,
}: {
  canWriteHumanReview: boolean;
  result: SecTickerEffectiveReadResult;
}) {
  if (result.status === "not_found") {
    return <div className={styles.notice} role="status">No saved decision matches this exact decision ID.</div>;
  }
  if (result.status === "unavailable") {
    return (
      <div className={styles.error} role="alert">
        The automatic decision or human history could not be validated. No relationship is effective.
      </div>
    );
  }

  if (result.automatic.status === "unavailable") {
    return (
      <section aria-labelledby="selected-resolution-heading" className={styles.stack}>
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="selected-resolution-heading">Selected filing pair</h2>
            <p className={styles.mono}>{result.currentAutomaticDecisionId}</p>
          </div>
          <span className={`${styles.pill} ${styles.pillNegative}`}>{result.effective.disposition}</span>
        </div>
        <div className={styles.error} role="alert">
          Automatic validation is unavailable ({result.automatic.reason}). Human history remains
          visible, but no automatic relationship or new action is enabled.
        </div>
        <HumanReviewSection
          automaticSha256=""
          automaticState="Unavailable"
          canWriteHumanReview={canWriteHumanReview}
          result={result}
        />
      </section>
    );
  }

  const automaticResult = result.automatic.result;
  const decision = automaticResult.decision;
  const evidence = automaticResult.evidence;
  const identity = automaticResult.identity;
  const relationship = record(record(decision.decision_payload).relationship);
  const itemState = stringValue(decision.resolution_state);
  const consoleHref = `/development/sec?room=periodic-reports&tab=resolution&resolutionId=${encodeURIComponent(stringValue(decision.id))}`;

  return (
    <section aria-labelledby="selected-resolution-heading" className={styles.stack}>
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="selected-resolution-heading">Selected exact decision</h2>
          <p className={styles.mono}>{stringValue(decision.id)}</p>
          {result.selectedAutomaticDecisionId !== result.currentAutomaticDecisionId ? (
            <p className={styles.muted}>
              Requested older decision {result.selectedAutomaticDecisionId}; showing the current
              automatic revision for this filing pair.
            </p>
          ) : null}
        </div>
        <span className={statePillClass(itemState)}>{itemState}</span>
      </div>

      <div className={styles.actions}>
        <Link className={styles.button} href={consoleHref}>Open separate SEC evidence view</Link>
      </div>

      <div className={styles.detailGrid}>
        <article className={styles.detailCard}>
          <h3>Relationship</h3>
          <DefinitionList values={[
            ["Issuer CIK", stringValue(decision.issuer_cik)],
            ["Old ticker", displayTicker(relationship.oldTicker)],
            ["New ticker", displayTicker(relationship.newTicker)],
            ["Type", humanize(stringValue(decision.resolution_type))],
            ["State", itemState],
          ]} />
        </article>
        <article className={styles.detailCard}>
          <h3>Security identity</h3>
          <DefinitionList values={[
            ["Type", humanize(stringValue(identity?.security_type) || automaticResult.evaluation.summary.securityType || "unresolved")],
            ["Class", stringValue(identity?.security_class) || automaticResult.evaluation.summary.securityClass || "Not recorded"],
            ["Before title", stringValue(identity?.before_security_title) || "Not resolved"],
            ["After title", stringValue(identity?.after_security_title) || "Not resolved"],
          ]} />
        </article>
        <article className={styles.detailCard}>
          <h3>Effective basis</h3>
          <DefinitionList values={[
            ["Effective date", stringValue(evidence?.effective_date) || automaticResult.evaluation.summary.effectiveDate || "Unresolved"],
            ["Effective at", stringValue(evidence?.effective_at) || "No exact timestamp claimed"],
            ["Precision", humanize(stringValue(evidence?.effective_precision) || automaticResult.evaluation.summary.effectivePrecision || "unknown")],
            ["Source wording", stringValue(evidence?.effective_text) || "Not extracted"],
            ["Continuity", humanize(stringValue(evidence?.continuity_basis) || automaticResult.evaluation.summary.continuityBasis || "unresolved")],
          ]} />
        </article>
      </div>

      <div className={styles.split}>
        <article className={styles.detailCard}>
          <h3>Decision method and reasons</h3>
          <DefinitionList values={[
            ["Method", stringValue(decision.method)],
            ["Version", stringValue(decision.method_version)],
            ["Evidence accession", stringValue(decision.evidence_accession_number)],
            ["Before accession", stringValue(decision.before_accession_number)],
            ["After accession", stringValue(decision.after_accession_number)],
          ]} />
          <ul className={styles.compactList}>
            {stringArray(decision.rule_reasons).map((reason) => <li key={reason}><span>{reason}</span></li>)}
          </ul>
        </article>
        <article className={styles.detailCard}>
          <h3>Evidence location</h3>
          <DefinitionList values={[
            ["Source document", stringValue(evidence?.source_document) || "Not resolved"],
            ["Source method", stringValue(evidence?.source_text_method) || "Not resolved"],
            ["Source version", stringValue(evidence?.source_text_version) || "Not resolved"],
            ["Text offsets", evidence ? `${String(evidence.source_text_span_start)}–${String(evidence.source_text_span_end)}` : "Not resolved"],
            ["Text SHA-256", stringValue(evidence?.source_text_span_sha256) || "Not resolved"],
          ]} />
        </article>
      </div>

      {evidence ? (
        <article className={styles.detailCard}>
          <h3>Exact normalized SEC evidence span</h3>
          <pre className={styles.snapshot}>{stringValuePreserve(evidence.source_text_span)}</pre>
        </article>
      ) : (
        <div className={styles.notice}>No relationship evidence row was persisted for this non-AUTO decision.</div>
      )}

      <HumanReviewSection
        automaticSha256={stringValue(decision.decision_sha256)}
        automaticState={itemState}
        canWriteHumanReview={canWriteHumanReview}
        result={result}
      />
    </section>
  );
}

function HumanReviewSection({
  automaticSha256,
  automaticState,
  canWriteHumanReview,
  result,
}: {
  automaticSha256: string;
  automaticState: string;
  canWriteHumanReview: boolean;
  result: Extract<SecTickerEffectiveReadResult, { status: "available" }>;
}) {
  return (
    <TickerResolutionHumanReview
      canWrite={canWriteHumanReview}
      approvalBlockedReason={result.approvalBlockedReason}
      automaticDecisionId={result.currentAutomaticDecisionId}
      automaticDecisionSha256={automaticSha256}
      automaticState={automaticState}
      availableActions={result.availableActions}
      effectiveDisposition={result.effective.disposition}
      expectedRevision={result.latestHumanDecision?.revision ?? 0}
      history={result.history}
      reconsiderationRequired={result.effective.reconsiderationRequired}
    />
  );
}

function DefinitionList({ values }: { values: Array<[string, string]> }) {
  return (
    <dl className={styles.definition}>
      {values.map(([label, value]) => (
        <Fragment key={label}><dt>{label}</dt><dd>{value || "—"}</dd></Fragment>
      ))}
    </dl>
  );
}

function filterHref(input: { decisionId?: string; query?: string; state?: string }) {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.state) params.set("state", input.state);
  if (input.decisionId) params.set("decisionId", input.decisionId);
  const query = params.toString();
  return `/admin/data/ticker-resolution${query ? `?${query}` : ""}`;
}

function normalizeState(value: unknown) {
  const normalized = stringValue(value).toUpperCase();
  return new Set(["AUTO", "REVIEW", "UNRESOLVED"]).has(normalized) ? normalized : "";
}

function statePillClass(value: string) {
  if (value === "AUTO") return `${styles.pill} ${styles.pillPositive}`;
  if (value === "REVIEW") return `${styles.pill} ${styles.pillAccent}`;
  return `${styles.pill} ${styles.pillNegative}`;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValuePreserve(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function displayTicker(value: unknown) {
  return stringValue(value) || "Unresolved";
}

function humanize(value: string) {
  return value ? value.replaceAll("_", " ") : "—";
}
