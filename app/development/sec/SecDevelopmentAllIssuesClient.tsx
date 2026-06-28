"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SecDevRoomIssueData } from "@/lib/development/secFormDevDashboard";
import styles from "./sec-development.module.css";
import {
  buildIssueCopyText,
  collectSecDevIssues,
  countIssuesBySeverity,
  formatIssueSeverityLabel,
  formatSecDevRunMode,
  sortSecDevIssues,
  type SecDevIssue,
  type SecDevIssueSeverity,
} from "./secDevelopmentIssues";

type SeverityFilter = SecDevIssueSeverity | "all";

export function SecDevelopmentAllIssuesClient({ rooms }: { rooms: SecDevRoomIssueData[] }) {
  const [roomFilter, setRoomFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const [copiedIssueId, setCopiedIssueId] = useState<string | null>(null);

  const roomIssueEntries = useMemo(
    () =>
      rooms.map((room) => ({
        room,
        issues: collectSecDevIssues(room, "all"),
      })),
    [rooms],
  );
  const allIssues = useMemo(() => sortSecDevIssues(roomIssueEntries.flatMap((entry) => entry.issues)), [roomIssueEntries]);
  const visibleIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allIssues.filter((issue) => {
      if (roomFilter !== "all" && issue.roomKey !== roomFilter) return false;
      if (severityFilter !== "all" && issue.severity !== severityFilter) return false;
      if (!normalizedQuery) return true;
      return [
        issue.roomLabel,
        issue.formType,
        issue.ticker,
        issue.accession,
        issue.eventId,
        issue.rawItemId,
        issue.title,
        issue.message,
        issue.source,
        issue.stage,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [allIssues, query, roomFilter, severityFilter]);
  const counts = countIssuesBySeverity(allIssues);
  const visibleCounts = countIssuesBySeverity(visibleIssues);

  async function copyIssue(issue: SecDevIssue) {
    const didCopy = await copyTextToClipboard(buildIssueCopyText(issue));
    setCopiedIssueId(didCopy ? issue.id : null);
    window.setTimeout(() => setCopiedIssueId(null), 1800);
  }

  return (
    <section className={styles.issueDashboard}>
      <div className={styles.issueDashboardToolbar}>
        <label>
          <span>Room</span>
          <select onChange={(event) => setRoomFilter(event.target.value)} value={roomFilter}>
            <option value="all">{`All rooms (${allIssues.length})`}</option>
            {roomIssueEntries.map(({ room, issues }) => (
              <option key={room.key} value={room.key}>
                {`${room.label} (${issues.length})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)} value={severityFilter}>
            <option value="all">{`All severities (${allIssues.length})`}</option>
            <option value="fail">{`Failures (${counts.fail})`}</option>
            <option value="warning">{`Warnings (${counts.warning})`}</option>
            <option value="review">{`Needs review (${counts.review})`}</option>
            <option value="info">{`Skipped / info (${counts.info})`}</option>
          </select>
        </label>
        <label className={styles.issueSearchControl}>
          <span>Search</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="ticker, accession, message" value={query} />
        </label>
      </div>

      <section className={styles.issueSummaryGrid}>
        <IssueMetric label="Visible" value={visibleIssues.length} tone="neutral" />
        <IssueMetric label="Failures" value={visibleCounts.fail} tone="fail" />
        <IssueMetric label="Warnings" value={visibleCounts.warning} tone="idle" />
        <IssueMetric label="Needs review" value={visibleCounts.review} tone="neutral" />
      </section>

      <section className={styles.issueRoomSummaryList}>
        {roomIssueEntries
          .filter((entry) => entry.issues.length > 0)
          .map(({ room, issues }) => {
            const roomCounts = countIssuesBySeverity(issues);
            return (
              <Link className={styles.issueRoomSummary} href={`/development/sec?room=${encodeURIComponent(room.key)}&tab=issues`} key={room.key}>
                <strong>{room.label}</strong>
                <span>{`${roomCounts.fail} fail / ${roomCounts.warning} warning / ${roomCounts.review} review / ${roomCounts.info} info`}</span>
              </Link>
            );
          })}
      </section>

      {!visibleIssues.length ? <div className={styles.emptyState}>No SEC issues match the current filters.</div> : null}

      <div className={styles.testStack}>
        {visibleIssues.map((issue) => (
          <article className={`${styles.issueCard} ${styles[`issue_${issue.severity}`]}`} key={issue.id}>
            <div className={styles.issueHeader}>
              <div className={styles.issueTitle}>
                <span className={styles.issueSource}>{`${issue.roomLabel} - ${formatSecDevRunMode(issue.runMode)} - ${issue.stage}`}</span>
                <strong>{issue.title || issue.accession || issue.source}</strong>
                <p>{issue.message}</p>
              </div>
              <span className={`${styles.issueBadge} ${styles[`issueBadge_${issue.severity}`]}`}>{formatIssueSeverityLabel(issue.severity)}</span>
            </div>
            <div className={styles.issueMetaGrid}>
              <IssueField label="Room" value={issue.roomLabel || "-"} />
              <IssueField label="Form" value={issue.formType || "-"} />
              <IssueField label="Ticker" value={issue.ticker || "-"} />
              <IssueField label="Accession" value={issue.accession || "-"} />
              <IssueField label="Event" value={issue.eventId || "-"} />
              <IssueField label="Source" value={issue.source} />
            </div>
            <div className={styles.issueActions}>
              <Link href={`/development/sec?room=${encodeURIComponent(issue.roomKey)}&tab=issues`}>Open room</Link>
              {issue.detailUrl ? <a href={issue.detailUrl}>Open detail</a> : null}
              <button onClick={() => copyIssue(issue)} type="button">
                {copiedIssueId === issue.id ? "Copied" : "Copy debug"}
              </button>
            </div>
            <details className={styles.issueDetails}>
              <summary>Debug context</summary>
              <pre>{JSON.stringify(issue.debug, null, 2)}</pre>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}

function IssueMetric({ label, value, tone }: { label: string; value: number; tone: "fail" | "idle" | "neutral" }) {
  return (
    <article className={`${styles.metricCard} ${styles[tone]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function IssueField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.previewField}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below for browser profiles that block navigator.clipboard.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
