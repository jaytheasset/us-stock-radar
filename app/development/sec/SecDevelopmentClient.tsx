"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import styles from "./sec-development.module.css";
import type { SecDevRoomDetail, SecDevRoomSnapshot } from "@/lib/development/secFormDevDashboard";
import {
  buildIssueCopyText,
  collectSecDevIssues,
  countIssuesBySeverity,
  formatIssueSeverityLabel,
  type SecDevIssue,
} from "./secDevelopmentIssues";

type TabKey = "overview" | "parser" | "prompt" | "outputs" | "results" | "tests" | "live" | "issues" | "excluded";

export function SecDevelopmentClient({ initialRooms }: { initialRooms: SecDevRoomSnapshot[] }) {
  const searchParams = useSearchParams();
  const requestedRoom = searchParams.get("room") || "";
  const requestedTab = searchParams.get("tab") || "";
  const initialRoom = initialRooms.some((room) => room.key === requestedRoom) ? requestedRoom : initialRooms[0]?.key || "";
  const initialTab = isTabKey(requestedTab) ? requestedTab : "overview";
  const [rooms, setRooms] = useState(initialRooms);
  const [selectedRoom, setSelectedRoom] = useState(initialRoom);
  const [detail, setDetail] = useState<SecDevRoomDetail | null>(null);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningLive, setRunningLive] = useState(false);
  const [runningLatestAnalysis, setRunningLatestAnalysis] = useState(false);
  const [collectingSamples, setCollectingSamples] = useState(false);
  const [runningAccessionDryRun, setRunningAccessionDryRun] = useState(false);
  const [runningRouteOnly, setRunningRouteOnly] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [resettingAnalysis, setResettingAnalysis] = useState(false);
  const [accessionNumber, setAccessionNumber] = useState("");
  const [archiveCik, setArchiveCik] = useState("");
  const [dryRunAccession, setDryRunAccession] = useState("");
  const [resetExistingAnalysis, setResetExistingAnalysis] = useState(false);
  const [secPromptVariant, setSecPromptVariant] = useState("sectioned");
  const [liveSampleCount, setLiveSampleCount] = useState("1");
  const [allowLlm, setAllowLlm] = useState(false);
  const [liveFormFilter, setLiveFormFilter] = useState("all");
  const [liveDateFrom, setLiveDateFrom] = useState("");
  const [liveDateTo, setLiveDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedSnapshot = useMemo(
    () => rooms.find((room) => room.key === selectedRoom) || null,
    [rooms, selectedRoom],
  );
  const selectedRunForms = liveFormFilter === "all" ? selectedSnapshot?.forms || [] : [liveFormFilter];
  const selectedSecPromptVariant =
    selectedRoom === "424b" && (secPromptVariant === "legacy" || secPromptVariant === "sectioned")
      ? secPromptVariant
      : selectedRoom === "s1-f1" && secPromptVariant === "pending_terms_test"
        ? secPromptVariant
        : "";
  const liveSampleCountNumber = clampLiveSampleCount(liveSampleCount);
  const selectedRunFormCount = Math.max(1, selectedRunForms.length);
  const selectedRunLabel = liveFormFilter === "all" ? "all forms " : `${liveFormFilter} `;
  const selectedRunCountLabel = liveFormFilter === "all" ? `${liveSampleCountNumber}/form` : String(liveSampleCountNumber);
  const selectedRoomHasTests = (selectedSnapshot?.testFiles.length || 0) > 0;

  useEffect(() => {
    if (!selectedRoom) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/development/sec-form-room?room=${encodeURIComponent(selectedRoom)}`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        if (!payload.ok) throw new Error(payload.error || "Failed to load room detail.");
        setDetail(payload.detail);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load room detail.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoom]);

  useEffect(() => {
    setLiveFormFilter("all");
    setSecPromptVariant(selectedRoom === "424b" ? "sectioned" : "default");
  }, [selectedRoom]);

  async function runTests() {
    if (!selectedRoom) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: selectedRoom }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Test run failed.");
      setDetail(payload.detail);
      setRooms((current) => current.map((room) => (room.key === payload.detail.key ? roomFromDetail(payload.detail) : room)));
      setTab("tests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function runLiveDryRun() {
    if (!selectedRoom) return;
    const sampleCount = clampLiveSampleCount(liveSampleCount);
    setLiveSampleCount(String(sampleCount));
    setRunningLive(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "live_dry_run",
          limit: liveFormFilter === "all" ? sampleCount * selectedRunFormCount : sampleCount,
          countPerForm: sampleCount,
          attachmentLimit: 6,
          formTypes: selectedRunForms,
          dateFrom: liveDateFrom,
          dateTo: liveDateTo,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Live SEC dry-run failed.");
      setDetail(payload.detail);
      setTab("live");
      const firstAccession = payload.detail.liveRuns?.[0]?.items?.[0]?.accession_number;
      if (typeof firstAccession === "string" && !accessionNumber) setAccessionNumber(firstAccession);
      if (typeof firstAccession === "string" && !dryRunAccession) setDryRunAccession(firstAccession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live SEC dry-run failed.");
    } finally {
      setRunningLive(false);
    }
  }

  async function runLatestAnalysisDryRun() {
    if (!selectedRoom) return;
    const sampleCount = clampLiveSampleCount(liveSampleCount);
    setLiveSampleCount(String(sampleCount));
    setRunningLatestAnalysis(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "latest_analysis_dry_run",
          limit: liveFormFilter === "all" ? sampleCount * selectedRunFormCount : sampleCount,
          countPerForm: sampleCount,
          attachmentLimit: 6,
          allowLlm,
          secPromptVariant: selectedSecPromptVariant,
          formTypes: selectedRunForms,
          dateFrom: liveDateFrom,
          dateTo: liveDateTo,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Latest SEC analysis dry-run failed.");
      setDetail(payload.detail);
      setTab("live");
      const firstAccession = payload.detail.liveRuns?.[0]?.items?.[0]?.accession_number;
      if (typeof firstAccession === "string" && !accessionNumber) setAccessionNumber(firstAccession);
      if (typeof firstAccession === "string" && !dryRunAccession) setDryRunAccession(firstAccession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Latest SEC analysis dry-run failed.");
    } finally {
      setRunningLatestAnalysis(false);
    }
  }

  async function collectAccessionSamples() {
    if (!selectedRoom) return;
    const sampleCount = clampLiveSampleCount(liveSampleCount);
    setLiveSampleCount(String(sampleCount));
    setCollectingSamples(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "accession_samples",
          limit: sampleCount,
          maxPages: 20,
          delayMs: 700,
          formTypes: selectedRunForms,
          dateFrom: liveDateFrom,
          dateTo: liveDateTo,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "SEC accession sample collection failed.");
      setDetail(payload.detail);
      setTab("live");
      const firstAccession = payload.detail.liveRuns?.[0]?.items?.[0]?.accession_number;
      if (typeof firstAccession === "string" && !accessionNumber) setAccessionNumber(firstAccession);
      if (typeof firstAccession === "string" && !dryRunAccession) setDryRunAccession(firstAccession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SEC accession sample collection failed.");
    } finally {
      setCollectingSamples(false);
    }
  }

  async function runAccessionDryRun() {
    if (!selectedRoom || !dryRunAccession.trim()) return;
    setRunningAccessionDryRun(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "accession_dry_run",
          accessionNumber: dryRunAccession.trim(),
          secPromptVariant: selectedSecPromptVariant,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Accession analysis dry-run failed.");
      setDetail(payload.detail);
      setTab("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accession analysis dry-run failed.");
    } finally {
      setRunningAccessionDryRun(false);
    }
  }

  async function runRouteOnlyDryRun() {
    if (!selectedRoom || !dryRunAccession.trim()) return;
    setRunningRouteOnly(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "route_only",
          accessionNumber: dryRunAccession.trim(),
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Route-only dry-run failed.");
      setDetail(payload.detail);
      setTab("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Route-only dry-run failed.");
    } finally {
      setRunningRouteOnly(false);
    }
  }

  async function runControlledPersist() {
    if (!selectedRoom || !accessionNumber.trim()) return;
    setPersisting(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "controlled_persist",
          accessionNumber: accessionNumber.trim(),
          cik: archiveCik.trim(),
          attachmentLimit: 6,
          resetExistingAnalysis,
          llmProvider: "gemini",
          secPromptVariant: selectedSecPromptVariant,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Controlled persist failed.");
      setDetail(payload.detail);
      setTab("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Controlled persist failed.");
    } finally {
      setPersisting(false);
    }
  }

  async function deleteExistingAnalysis() {
    if (!selectedRoom || !accessionNumber.trim()) return;
    const targetAccession = accessionNumber.trim();
    const confirmed = window.confirm(`Delete existing SEC analysis rows for ${targetAccession}? Raw filing text will be kept.`);
    if (!confirmed) return;

    setResettingAnalysis(true);
    setError(null);
    try {
      const response = await fetch("/api/development/sec-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: selectedRoom,
          mode: "reset_analysis",
          accessionNumber: targetAccession,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Delete existing SEC analysis failed.");
      setDetail(payload.detail);
      setTab("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete existing SEC analysis failed.");
    } finally {
      setResettingAnalysis(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span>SEC Rooms</span>
          <strong>{rooms.length}</strong>
        </div>
        <div className={styles.roomList}>
          {rooms.map((room) => (
            <button
              className={`${styles.roomButton} ${room.key === selectedRoom ? styles.activeRoom : ""}`}
              key={room.key}
              onClick={() => {
                setSelectedRoom(room.key);
                setTab("overview");
              }}
              type="button"
            >
              <span>
                <strong>{room.label}</strong>
                <small>{room.forms.join(", ")}</small>
              </span>
              <StatusBadge status={room.status} />
            </button>
          ))}
        </div>
      </aside>

      <section className={styles.mainPanel}>
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.kicker}>Development Console</p>
            <h2>{selectedSnapshot?.label || "SEC Form Room"}</h2>
            <p>{selectedSnapshot?.forms.join(", ")}</p>
          </div>
          <div className={styles.headerActions}>
            <StatusBadge status={selectedSnapshot?.status || "not_run"} />
            <button
              className={styles.primaryButton}
              disabled={running || loading || !selectedRoom || !selectedRoomHasTests}
              onClick={runTests}
              title={selectedRoomHasTests ? "Run local room tests" : "No local test files are configured for this room"}
              type="button"
            >
              {running ? "Running..." : selectedRoomHasTests ? "Run room tests" : "No room tests"}
            </button>
            <label className={styles.countControl}>
              <span>Live count</span>
              <input
                max={100}
                min={1}
                onBlur={() => setLiveSampleCount(String(clampLiveSampleCount(liveSampleCount)))}
                onChange={(event) => setLiveSampleCount(event.target.value)}
                type="number"
                value={liveSampleCount}
              />
            </label>
            <button className={styles.secondaryButton} disabled={runningLive || loading || !selectedRoom} onClick={runLiveDryRun} type="button">
              {runningLive ? "Fetching..." : `Run ${selectedRunLabel}live SEC dry-run (${selectedRunCountLabel})`}
            </button>
            <label className={styles.checkboxControl}>
              <input checked={allowLlm} onChange={(event) => setAllowLlm(event.target.checked)} type="checkbox" />
              <span>Allow LLM</span>
            </label>
            <button
              className={styles.secondaryButton}
              disabled={runningLatestAnalysis || loading || !selectedRoom}
              onClick={runLatestAnalysisDryRun}
              type="button"
            >
              {runningLatestAnalysis ? "Analyzing..." : `Analyze ${selectedRunLabel}latest samples, no persist (${selectedRunCountLabel})`}
            </button>
          </div>
        </header>

        <section className={styles.liveControls}>
          <label className={styles.compactControl}>
            <span>Form filter</span>
            <select onChange={(event) => setLiveFormFilter(event.target.value)} value={liveFormFilter}>
              <option value="all">All forms</option>
              {(selectedSnapshot?.forms || []).map((form) => (
                <option key={form} value={form}>
                  {form}
                </option>
              ))}
            </select>
          </label>
          {selectedRoom === "424b" || selectedRoom === "s1-f1" ? (
            <label className={styles.compactControl}>
              <span>Prompt variant</span>
              <select onChange={(event) => setSecPromptVariant(event.target.value)} value={secPromptVariant}>
                {selectedRoom === "424b" ? (
                  <>
                    <option value="sectioned">Default sectioned (active)</option>
                    <option value="legacy">Backup legacy (pre-sectioned)</option>
                  </>
                ) : (
                  <>
                    <option value="default">Default active</option>
                    <option value="pending_terms_test">Pending terms test</option>
                  </>
                )}
              </select>
            </label>
          ) : null}
          <label className={styles.dateControl}>
            <span>Date from</span>
            <input onChange={(event) => setLiveDateFrom(event.target.value)} type="date" value={liveDateFrom} />
          </label>
          <label className={styles.dateControl}>
            <span>Date to</span>
            <input onChange={(event) => setLiveDateTo(event.target.value)} type="date" value={liveDateTo} />
          </label>
          <button
            className={styles.secondaryButton}
            disabled={collectingSamples || loading || !selectedRoom}
            onClick={collectAccessionSamples}
            type="button"
          >
            {collectingSamples ? "Collecting..." : `Collect ${selectedRunLabel}accession samples (${liveSampleCountNumber})`}
          </button>
          <label>
            <span>Analysis dry-run accession</span>
            <input
              onChange={(event) => setDryRunAccession(event.target.value)}
              placeholder="0000000000-00-000000"
              value={dryRunAccession}
            />
          </label>
          <button
            className={styles.secondaryButton}
            disabled={runningAccessionDryRun || loading || !dryRunAccession.trim()}
            onClick={runAccessionDryRun}
            type="button"
          >
            {runningAccessionDryRun ? "Analyzing..." : "Analyze accession, no persist"}
          </button>
          <button
            className={styles.secondaryButton}
            disabled={runningRouteOnly || loading || selectedRoom !== "s1-f1" || !dryRunAccession.trim()}
            onClick={runRouteOnlyDryRun}
            title={selectedRoom === "s1-f1" ? "Route S-1/F-1 display mode only" : "Route-only is currently available for S-1/F-1"}
            type="button"
          >
            {runningRouteOnly ? "Routing..." : "Route only"}
          </button>
          <label>
            <span>Controlled persist accession</span>
            <input
              onChange={(event) => setAccessionNumber(event.target.value)}
              placeholder="0000000000-00-000000"
              value={accessionNumber}
            />
          </label>
          <label className={styles.compactControl}>
            <span>Archive CIK</span>
            <input
              onChange={(event) => setArchiveCik(event.target.value)}
              placeholder="0000000"
              value={archiveCik}
            />
          </label>
          <label className={styles.resetControl}>
            <input checked={resetExistingAnalysis} onChange={(event) => setResetExistingAnalysis(event.target.checked)} type="checkbox" />
            <span>Reset existing analysis</span>
          </label>
          <button
            className={styles.dangerButton}
            disabled={resettingAnalysis || persisting || loading || !accessionNumber.trim()}
            onClick={deleteExistingAnalysis}
            type="button"
          >
            {resettingAnalysis ? "Deleting..." : "Delete existing analysis"}
          </button>
          <button
            className={styles.dangerButton}
            disabled={persisting || resettingAnalysis || loading || !accessionNumber.trim()}
            onClick={runControlledPersist}
            type="button"
          >
            {persisting ? "Persisting..." : resetExistingAnalysis ? "Reset + persist, alerts off" : "Persist one, alerts off"}
          </button>
        </section>

        {error ? <div className={styles.errorBox}>{error}</div> : null}

        <nav className={styles.tabs} aria-label="SEC development sections">
          {[
            ["overview", "Overview"],
            ["parser", "Parser"],
            ["prompt", "LLM Prompt"],
            ["outputs", "Site Output"],
            ["results", "Fixtures / Results"],
            ["tests", "Tests"],
            ["live", "Live / Persist"],
            ["issues", "Issues"],
            ["excluded", "Excluded"],
          ].map(([key, label]) => (
            <button className={tab === key ? styles.activeTab : ""} key={key} onClick={() => setTab(key as TabKey)} type="button">
              {label}
            </button>
          ))}
        </nav>

        {loading ? (
          <div className={styles.emptyState}>Loading room files...</div>
        ) : detail ? (
          <RoomDetail
            detail={detail}
            liveFormFilter={liveFormFilter}
            tab={tab}
            onUseAccession={(value) => {
              setAccessionNumber(value);
              setDryRunAccession(value);
            }}
          />
        ) : (
          <div className={styles.emptyState}>Select a form room.</div>
        )}
      </section>
    </div>
  );
}

function RoomDetail({
  detail,
  liveFormFilter,
  onUseAccession,
  tab,
}: {
  detail: SecDevRoomDetail;
  liveFormFilter: string;
  onUseAccession: (value: string) => void;
  tab: TabKey;
}) {
  if (tab === "overview") {
    const displayLabelGuide = getDisplayLabelGuide(detail.key);

    return (
      <div className={styles.grid}>
        <MetricCard label="Pass" value={detail.passCount} tone="pass" />
        <MetricCard label="Fail" value={detail.failCount} tone="fail" />
        <MetricCard label="Not run" value={detail.notRunCount} tone="idle" />
        <MetricCard label="Tests" value={detail.testFiles.length} tone="neutral" />
        <MetricCard label="Outputs" value={detail.outputPreviews.length} tone="neutral" />
        <section className={styles.wideCard}>
          <h3>Room contract</h3>
          <dl className={styles.definitionList}>
            <div>
              <dt>Folder</dt>
              <dd>{`lib/sources/sec/forms/${detail.folder}`}</dd>
            </div>
            <div>
              <dt>Forms</dt>
              <dd>{detail.forms.join(", ")}</dd>
            </div>
            <div>
              <dt>Adapter key</dt>
              <dd>{detail.adapterKey || "-"}</dd>
            </div>
            <div>
              <dt>Last run</dt>
              <dd>{detail.lastRunAt ? formatDate(detail.lastRunAt) : "Not run"}</dd>
            </div>
          </dl>
        </section>
        {displayLabelGuide ? <DisplayLabelGuidePanel guide={displayLabelGuide} /> : null}
      </div>
    );
  }

  if (tab === "parser") {
    return <FileSections files={detail.files.filter((file) => file.kind === "parser" || file.kind === "adapter" || file.kind === "display")} />;
  }

  if (tab === "prompt") {
    return <PromptPreviewSections previews={detail.promptPreviews} />;
  }

  if (tab === "outputs") {
    return <OutputPreviewSections formFilter={liveFormFilter} liveRuns={detail.liveRuns} previews={detail.outputPreviews} />;
  }

  if (tab === "results") {
    return <FileSections files={detail.files.filter((file) => file.kind === "fixture" || file.kind === "expected")} />;
  }

  if (tab === "tests") {
    return (
      <div className={styles.testStack}>
        {detail.testResults.map((result) => (
          <section className={styles.testCard} key={result.file}>
            <div className={styles.testHeader}>
              <div>
                <strong>{result.file}</strong>
                <p>{result.command || "Not run"}</p>
              </div>
              <StatusBadge status={result.status} />
            </div>
            <div className={styles.testMeta}>
              <span>{result.durationMs === null ? "-" : `${result.durationMs} ms`}</span>
              <span>{result.ranAt ? formatDate(result.ranAt) : "Not run"}</span>
            </div>
            {result.error ? <p className={styles.errorText}>{result.error}</p> : null}
            {result.output ? <pre className={styles.outputBlock}>{result.output}</pre> : null}
          </section>
        ))}
      </div>
    );
  }

  if (tab === "excluded") {
    return (
      <ExcludedReviewSections
        detail={detail}
        liveFormFilter={liveFormFilter}
        onUseAccession={onUseAccession}
      />
    );
  }

  if (tab === "issues") {
    return <IssueReviewSections detail={detail} liveFormFilter={liveFormFilter} onUseAccession={onUseAccession} />;
  }

  return (
    <div className={styles.testStack}>
      {!detail.liveRuns.length ? (
        <div className={styles.emptyState}>No live SEC dry-run or controlled persist result yet.</div>
      ) : null}
      {detail.liveRuns.map((run, index) => (
        <LiveRunCard
          key={`${run.mode}-${run.ranAt}-${index}`}
          liveFormFilter={liveFormFilter}
          onUseAccession={onUseAccession}
          run={run}
        />
      ))}
    </div>
  );
}

function IssueReviewSections({
  detail,
  liveFormFilter,
  onUseAccession,
}: {
  detail: SecDevRoomDetail;
  liveFormFilter: string;
  onUseAccession: (value: string) => void;
}) {
  const [copiedIssueId, setCopiedIssueId] = useState<string | null>(null);
  const issues = useMemo(() => collectSecDevIssues(detail, liveFormFilter), [detail, liveFormFilter]);
  const counts = countIssuesBySeverity(issues);

  async function copyIssue(issue: SecDevIssue) {
    const didCopy = await copyTextToClipboard(buildIssueCopyText(issue));
    setCopiedIssueId(didCopy ? issue.id : null);
    window.setTimeout(() => setCopiedIssueId(null), 1800);
  }

  if (!detail.liveRuns.length) {
    return <div className={styles.emptyState}>No live SEC analysis runs found for this room yet.</div>;
  }

  if (!issues.length) {
    return <div className={styles.emptyState}>No failures, warnings, review flags, or skipped filings found for this room.</div>;
  }

  return (
    <div className={styles.testStack}>
      <section className={styles.issueSummaryGrid}>
        <MetricCard label="Failures" value={counts.fail} tone="fail" />
        <MetricCard label="Warnings" value={counts.warning} tone="idle" />
        <MetricCard label="Needs review" value={counts.review} tone="neutral" />
        <MetricCard label="Skipped / info" value={counts.info} tone="neutral" />
      </section>
      {issues.map((issue) => (
        <article className={`${styles.issueCard} ${styles[`issue_${issue.severity}`]}`} key={issue.id}>
          <div className={styles.issueHeader}>
            <div className={styles.issueTitle}>
              <span className={styles.issueSource}>{`${formatLiveRunMode(issue.runMode)} - ${issue.stage}`}</span>
              <strong>{issue.title || issue.accession || issue.source}</strong>
              <p>{issue.message}</p>
            </div>
            <span className={`${styles.issueBadge} ${styles[`issueBadge_${issue.severity}`]}`}>{formatIssueSeverityLabel(issue.severity)}</span>
          </div>
          <div className={styles.issueMetaGrid}>
            <PreviewField label="Form" value={issue.formType || "-"} />
            <PreviewField label="Ticker" value={issue.ticker || "-"} />
            <PreviewField label="Accession" value={issue.accession || "-"} />
            <PreviewField label="Event" value={issue.eventId || "-"} />
            <PreviewField label="Raw item" value={issue.rawItemId || "-"} />
            <PreviewField label="Ran at" value={formatDate(issue.ranAt)} />
            <PreviewField label="Source" value={issue.source} />
          </div>
          <div className={styles.issueActions}>
            {issue.accession ? (
              <button onClick={() => onUseAccession(issue.accession)} type="button">
                Use accession
              </button>
            ) : null}
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
  );
}

function ExcludedReviewSections({
  detail,
  liveFormFilter,
  onUseAccession,
}: {
  detail: SecDevRoomDetail;
  liveFormFilter: string;
  onUseAccession: (value: string) => void;
}) {
  const runsWithExcluded = detail.liveRuns
    .map((run) => ({
      run,
      items: filterLiveItemsByForm(run.items, liveFormFilter).filter(isExcludedLiveItem),
    }))
    .filter((entry) => entry.items.length > 0);

  if (!runsWithExcluded.length) {
    return <div className={styles.emptyState}>No excluded SEC filings found for this room yet.</div>;
  }

  return (
    <div className={styles.testStack}>
      {runsWithExcluded.map(({ run, items }, index) => (
        <section className={styles.testCard} key={`${run.mode}-${run.ranAt}-excluded-${index}`}>
          <div className={styles.testHeader}>
            <div>
              <strong>{formatLiveRunMode(run.mode)}</strong>
              <p>{`${items.length} excluded item(s) - ${formatDate(run.ranAt)}`}</p>
            </div>
            <StatusBadge status={run.status === "pass" ? "pass" : "fail"} />
          </div>
          <div className={styles.excludedList}>
            {items.map((item, itemIndex) => (
              <ExcludedLiveItem
                item={item}
                key={`${clientString(item.accession_number)}-${itemIndex}`}
                onUseAccession={onUseAccession}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LiveRunCard({
  liveFormFilter,
  onUseAccession,
  run,
}: {
  liveFormFilter: string;
  onUseAccession: (value: string) => void;
  run: SecDevRoomDetail["liveRuns"][number];
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [excludedCopyStatus, setExcludedCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const visibleItems = filterLiveItemsByForm(run.items, liveFormFilter);
  const excludedItems = visibleItems.filter(isExcludedLiveItem);
  const resultItems = visibleItems.filter((item) => !isExcludedLiveItem(item));
  const isFiltered = liveFormFilter !== "all";
  const copyText = buildAccessionCopyText(run, visibleItems, liveFormFilter);
  const excludedCopyText = buildExcludedCopyText(run, excludedItems, liveFormFilter);
  const copyLabel =
    copyStatus === "copying"
      ? "Copying..."
      : copyStatus === "copied"
        ? "Copied"
        : copyStatus === "failed"
          ? "Copy failed"
          : "Copy accession list";
  const excludedCopyLabel =
    excludedCopyStatus === "copying"
      ? "Copying..."
      : excludedCopyStatus === "copied"
        ? "Copied"
        : excludedCopyStatus === "failed"
          ? "Copy failed"
          : "Copy excluded list";

  return (
    <section className={styles.testCard}>
          <div className={styles.testHeader}>
            <div>
              <strong>{formatLiveRunMode(run.mode)}</strong>
              <p>{run.summary}</p>
            </div>
            <div className={styles.testHeaderActions}>
              {copyText ? (
                <button
                  className={styles.secondaryButton}
                  onClick={async () => {
                    setCopyStatus("copying");
                    const didCopy = await copyTextToClipboard(copyText);
                    setCopyStatus(didCopy ? "copied" : "failed");
                    window.setTimeout(() => setCopyStatus("idle"), 1800);
                  }}
                  type="button"
                >
                  {copyLabel}
                </button>
              ) : null}
              <StatusBadge status={run.status === "pass" ? "pass" : "fail"} />
            </div>
          </div>
          <div className={styles.testMeta}>
            <span>{formatDate(run.ranAt)}</span>
            <span>{run.durationMs} ms</span>
            <span>{run.formTypes.join(", ")}</span>
            {isFiltered ? <span>{`Showing ${visibleItems.length}/${run.items.length} ${liveFormFilter}`}</span> : null}
          </div>
          {run.error ? <p className={styles.errorText}>{run.error}</p> : null}
          {isFiltered && !visibleItems.length ? (
            <div className={styles.emptyState}>No {liveFormFilter} items in this run.</div>
          ) : null}
          {excludedItems.length ? (
            <section className={styles.excludedPanel}>
              <div className={styles.excludedHeader}>
                <div>
                  <strong>Excluded / Skipped</strong>
                  <p>{excludedItems.length} item(s) were excluded before SEC analysis. Review these later for gate quality.</p>
                </div>
                {excludedCopyText ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={async () => {
                      setExcludedCopyStatus("copying");
                      const didCopy = await copyTextToClipboard(excludedCopyText);
                      setExcludedCopyStatus(didCopy ? "copied" : "failed");
                      window.setTimeout(() => setExcludedCopyStatus("idle"), 1800);
                    }}
                    type="button"
                  >
                    {excludedCopyLabel}
                  </button>
                ) : null}
              </div>
              <div className={styles.excludedList}>
                {excludedItems.map((item, itemIndex) => (
                  <ExcludedLiveItem
                    item={item}
                    key={`${clientString(item.accession_number)}-${itemIndex}`}
                    onUseAccession={onUseAccession}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {visibleItems.length && !resultItems.length ? (
            <div className={styles.emptyState}>All visible items in this run were excluded before analysis.</div>
          ) : null}
          <div className={styles.liveItemList}>
            {resultItems.map((item, itemIndex) => {
              const accession = String(item.accession_number || "");
              return (
                <article className={styles.liveItem} key={`${accession}-${itemIndex}`}>
                  <div>
                    <strong>{String(item.title || item.event_id || accession || "-")}</strong>
                    <p>
                      {[item.form_type, item.ticker, accession, item.event_type, item.delivery_level]
                        .filter(Boolean)
                        .map(String)
                        .join(" - ")}
                    </p>
                  </div>
                  <div className={styles.liveItemActions}>
                    {accession ? (
                      <button onClick={() => onUseAccession(accession)} type="button">
                        Use accession
                      </button>
                    ) : null}
                    {typeof item.detail_url === "string" && item.detail_url ? (
                      <a href={item.detail_url}>Open detail</a>
                    ) : null}
                  </div>
                  <RuntimeOutputCard value={item.runtime_output} />
                  <pre>{JSON.stringify(item, null, 2)}</pre>
                </article>
              );
            })}
          </div>
          {run.diagnostics ? <pre className={styles.outputBlock}>{JSON.stringify(run.diagnostics, null, 2)}</pre> : null}
        </section>
  );
}

function ExcludedLiveItem({
  item,
  onUseAccession,
}: {
  item: Record<string, unknown>;
  onUseAccession: (value: string) => void;
}) {
  const accession = clientString(item.accession_number);
  const evidence = clientStringArray(item.skip_evidence);

  return (
    <article className={styles.excludedItem}>
      <div className={styles.excludedItemHeader}>
        <div>
          <strong>{clientString(item.title) || accession || "Excluded filing"}</strong>
          <p>
            {[clientString(item.form_type), clientString(item.ticker), accession, clientString(item.skip_gate)]
              .filter(Boolean)
              .join(" - ")}
          </p>
        </div>
        {accession ? (
          <button onClick={() => onUseAccession(accession)} type="button">
            Use accession
          </button>
        ) : null}
      </div>
      {clientString(item.skip_reason) ? (
        <div className={styles.outputTextBlock}>
          <span>Skip reason</span>
          <p>{clientString(item.skip_reason)}</p>
        </div>
      ) : null}
      {evidence.length ? <PreviewList title="Gate evidence" items={evidence} /> : null}
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </article>
  );
}

function RuntimeOutputCard({ value }: { value: unknown }) {
  const output = readClientRecord(value);
  if (!output) return null;
  const isParserCompletedArchive = output.is_parser_completed_archive === true;
  const filingSummary = clientString(output.filing_summary) || (isParserCompletedArchive ? clientString(output.archive_summary) || clientString(output.summary) : "");
  const transactionFingerprint = readClientRecord(output.transaction_fingerprint);
  const parentRegistrationContext = readClientRecord(output.parent_registration_context);
  const parentFilingContext = readClientRecord(output.parent_filing_context);
  const displayPayloadDebug = readClientRecord(output.display_payload_debug);
  const parentContext = parentRegistrationContext || parentFilingContext;

  return (
    <div className={styles.runtimeOutputCard}>
      <div className={styles.runtimeOutputHeader}>
        <strong>Runtime Output</strong>
        <span>actual dry-run result</span>
      </div>
      <div className={styles.outputMetaGrid}>
        <PreviewField label="Ticker" value={clientString(output.ticker)} />
        <PreviewField label="Model" value={clientString(output.model)} />
        <PreviewField label="Event type" value={clientString(output.event_type)} />
        <PreviewField label="Display type" value={clientString(output.display_type)} />
        <PreviewField label="Parser route" value={clientString(output.parser_route)} />
        <PreviewField label="Score" value={clientString(output.score)} />
        <PreviewField label="Delivery" value={clientString(output.delivery_level)} />
        <PreviewField label="Signal" value={clientString(output.signal)} />
        <PreviewField label="S-3/F-3 parent" value={formatParentContextSummary(parentRegistrationContext)} />
        <PreviewField
          label="Parent context"
          value={
            parentFilingContext
              ? [
                  clientString(parentFilingContext.status),
                  clientString(parentFilingContext.parent_accession),
                  clientString(parentFilingContext.match_method),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : ""
          }
        />
      </div>
      {parentRegistrationContext ? (
        <div className={styles.outputTextBlock}>
          <span>S-3/F-3 parent registration context</span>
          <pre>{JSON.stringify(parentRegistrationContext, null, 2)}</pre>
        </div>
      ) : null}
      {!parentRegistrationContext && parentFilingContext ? (
        <div className={styles.outputTextBlock}>
          <span>Generic parent filing context</span>
          <pre>{JSON.stringify(parentFilingContext, null, 2)}</pre>
        </div>
      ) : null}
      {filingSummary ? (
        <div className={styles.outputTextBlock}>
          <span>Filing summary</span>
          <p>{filingSummary}</p>
        </div>
      ) : null}
      {!isParserCompletedArchive && clientString(output.quick_take) ? (
        <div className={styles.outputTextBlock}>
          <span>Quick take</span>
          <p>{clientString(output.quick_take)}</p>
        </div>
      ) : null}
      {!filingSummary && clientString(output.summary) ? (
        <div className={styles.outputTextBlock}>
          <span>Summary</span>
          <p>{clientString(output.summary)}</p>
        </div>
      ) : null}
      {clientString(output.archive_summary) ? (
        <div className={styles.outputTextBlock}>
          <span>Archive summary</span>
          <p>{clientString(output.archive_summary)}</p>
        </div>
      ) : null}
      {clientString(output.score_reason) ? (
        <div className={styles.outputTextBlock}>
          <span>Score reason</span>
          <p>{clientString(output.score_reason)}</p>
        </div>
      ) : null}
      <div className={styles.outputColumns}>
        <PreviewList title="Key evidence" items={clientStringArray(output.key_evidence)} />
        {!isParserCompletedArchive ? <PreviewList title="What to watch next" items={clientStringArray(output.what_to_watch_next)} /> : null}
        <PreviewList title="Parser signals" items={clientStringArray(output.parser_signals)} />
        <PreviewList title="Display payload fields" items={clientDisplayData(output.display_data)} />
      </div>
      {displayPayloadDebug ? <DisplayPayloadDebugSummary debug={displayPayloadDebug} /> : null}
      {displayPayloadDebug ? (
        <div className={styles.outputTextBlock}>
          <span>Display payload debug</span>
          <pre>{JSON.stringify(displayPayloadDebug, null, 2)}</pre>
        </div>
      ) : null}
      {transactionFingerprint ? (
        <div className={styles.outputTextBlock}>
          <span>Transaction fingerprint</span>
          <pre>{JSON.stringify(transactionFingerprint, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function DisplayPayloadDebugSummary({ debug }: { debug: Record<string, unknown> }) {
  const labelGroups = buildDisplayPayloadLabelGroups(debug);

  return (
    <div className={styles.outputTextBlock}>
      <span>Display payload labels</span>
      <div className={styles.displayDataGrid}>
        <PreviewField label="UI" value={clientString(debug.display_type)} />
        <PreviewField label="Detail UI" value={clientString(debug.display_mode)} />
        <PreviewField label="Risk label" value={clientString(debug.risk_label)} />
        <PreviewField label="Version" value={clientString(debug.display_version)} />
      </div>
      <div className={styles.outputColumns}>
        {labelGroups.map((group) => (
          <PreviewList key={group.title} title={group.title} items={group.items} />
        ))}
      </div>
    </div>
  );
}

function buildDisplayPayloadLabelGroups(debug: Record<string, unknown>) {
  return [
    { title: "Snapshot labels", items: collectDisplayPayloadLabels(debug.snapshot_metrics) },
    { title: "Offering detail labels", items: collectDisplayPayloadLabels(debug.offering_details) },
    { title: "What changed labels", items: collectDisplayPayloadLabels(debug.amendment_changes) },
    { title: "Supply segment labels", items: collectDisplayPayloadLabels(debug.supply_segments) },
    { title: "Instrument labels", items: collectDisplayPayloadLabels(debug.instrument_details) },
    { title: "Mixed component labels", items: collectDisplayPayloadLabels(debug.mixed_offering_components) },
    { title: "Cash term labels", items: collectDisplayPayloadLabels(debug.key_cash_terms) },
    { title: "S-8 context labels", items: collectDisplayPayloadLabels(debug.s8_context_details) },
    { title: "Warnings", items: clientStringArray(debug.display_warnings) },
  ].filter((group) => group.items.length > 0);
}

function collectDisplayPayloadLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readClientRecord(item);
      if (!record) return clientString(item);
      const label =
        clientString(record.label) ||
        clientString(record.name) ||
        clientString(record.type) ||
        clientString(record.component_type) ||
        clientString(record.security_type) ||
        clientString(record.metric) ||
        clientString(record.title) ||
        `Item ${index + 1}`;
      const valueText =
        clientString(record.value) ||
        clientString(record.value_text) ||
        clientString(record.amount) ||
        clientString(record.shares) ||
        clientString(record.summary);
      const note =
        clientString(record.description) ||
        clientString(record.caption) ||
        clientString(record.note) ||
        clientString(record.source);
      return [label, valueText ? `= ${valueText}` : "", note ? `- ${note}` : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

type DisplayLabelGroup = { title: string; items: string[] };
type DisplayDetailModeGuide = {
  mode: string;
  purpose: string;
  groups: DisplayLabelGroup[];
};
type DisplayLabelGuide = {
  overview: DisplayLabelGroup[];
  detailModes?: DisplayDetailModeGuide[];
};

function DisplayLabelGuidePanel({ guide }: { guide: DisplayLabelGuide }) {
  return (
    <section className={styles.wideCard}>
      <h3>Display / UI label guide</h3>
      <div className={styles.labelGuideStageGrid}>
        {guide.overview.map((group) => (
          <PreviewList key={group.title} title={group.title} items={group.items} />
        ))}
      </div>
      {guide.detailModes?.length ? (
        <div className={styles.detailGuideSection}>
          <h4>3. Detail UI structures</h4>
          <div className={styles.detailGuideGrid}>
            {guide.detailModes.map((modeGuide) => (
              <article className={styles.detailGuideCard} key={modeGuide.mode}>
                <header>
                  <strong>{modeGuide.mode}</strong>
                  <p>{modeGuide.purpose}</p>
                </header>
                <div className={styles.detailGuideGroups}>
                  {modeGuide.groups.map((group) => (
                    <PreviewList key={`${modeGuide.mode}-${group.title}`} title={group.title} items={group.items} />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getDisplayLabelGuide(roomKey: string): DisplayLabelGuide | null {
  if (roomKey === "ownership") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["candidate_special", "generic", "offering_terms"],
        },
        {
          title: "2. Detail UI choices",
          items: ["form4_transaction", "form144_proposed_sale", "ownership_amendment", "related_filing_context", "routine_archive"],
        },
      ],
      detailModes: [
        {
          mode: "form4_transaction",
          purpose: "Form 4 actual ownership transaction or holding update.",
          groups: [
            { title: "Display payload", items: ["filing_summary", "form4", "evidence", "notes"] },
            {
              title: "Form 4 transaction fields",
              items: [
                "Owner / role",
                "Security",
                "Transaction type",
                "Transaction date",
                "Shares",
                "Price per share",
                "Transaction value",
                "Post-transaction holdings",
                "Direct / indirect ownership",
              ],
            },
            {
              title: "Investor labels",
              items: ["Purchase", "Sale", "Tax withholding", "Award / grant", "Exercise / conversion", "Gift / transfer", "Holding update"],
            },
          ],
        },
        {
          mode: "form144_proposed_sale",
          purpose: "Form 144 proposed sale notice before or around the planned sale date.",
          groups: [
            { title: "Display payload", items: ["filing_summary", "form144", "evidence", "notes"] },
            {
              title: "Form 144 sale fields",
              items: [
                "Seller",
                "Relationship to issuer",
                "Securities class",
                "Proposed shares",
                "Aggregate market value",
                "Approximate sale date",
                "Broker / market maker",
                "Plan adoption date",
                "Prior 3-month sales",
              ],
            },
            {
              title: "Investor labels",
              items: ["Proposed sale", "10b5-1 sale plan", "Tax / vesting sale", "Large holder sale", "Routine notice", "Amended notice"],
            },
          ],
        },
        {
          mode: "ownership_amendment",
          purpose: "Form 4/A or 144/A comparison against a confirmed parent filing.",
          groups: [
            { title: "Parent context", items: ["Parent accession", "Parent form", "Parent filing date", "Comparison status", "Match reason"] },
            {
              title: "What changed",
              items: [
                "Transaction rows changed",
                "Shares changed",
                "Price changed",
                "Value changed",
                "Holding amount changed",
                "Sale date changed",
                "Seller / owner changed",
                "Footnote changed",
                "Signature / metadata changed",
              ],
            },
            { title: "Decision labels", items: ["Economic change", "No economic change", "Footnote-only", "Metadata-only", "Parent missing", "Needs review"] },
          ],
        },
        {
          mode: "related_filing_context",
          purpose: "Related ownership filings shown above market context and used for follow-up interpretation.",
          groups: [
            {
              title: "Context inputs",
              items: ["related_form144_candidates", "related_form4_execution_candidates", "amendment_parent_candidate", "context_as_of"],
            },
            {
              title: "Related filing labels",
              items: ["Parent candidate", "Form 4 candidate", "Form 144 candidate", "Recent ownership filing", "Recent 13D/13G filing"],
            },
            { title: "Related filing fields", items: ["Form type", "Title", "Relation", "Filed date", "Accession", "Impact score", "Match confidence"] },
          ],
        },
        {
          mode: "routine_archive",
          purpose: "Low-impact ownership filing that still gets an archive detail page.",
          groups: [
            { title: "Display payload", items: ["filing_summary", "form4 or form144 when useful", "evidence", "notes"] },
            {
              title: "Archive labels",
              items: [
                "Routine equity award",
                "Small transaction",
                "Tax withholding",
                "Administrative amendment",
                "Footnote-only amendment",
                "Metadata-only amendment",
                "No open-market purchase or sale",
              ],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "s4-f4") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic"],
        },
        {
          title: "2. Analysis subtype choices",
          items: [
            "merger_or_acquisition",
            "de_spac_business_combination",
            "shareholder_vote_update",
            "exchange_offer_or_share_exchange",
            "debt_exchange_or_restructuring",
            "litigation_or_regulatory_update",
            "spin_off_or_distribution",
            "routine_amendment",
          ],
        },
      ],
      detailModes: [
        {
          mode: "generic display payload",
          purpose: "S-4/F-4 uses the common filing detail page, not a specialized SPAC UI.",
          groups: [
            { title: "Display payload", items: ["display_type: generic", "data.filing_summary", "data.key_terms", "evidence", "notes"] },
            { title: "Required data", items: ["filing_summary", "key_terms"] },
            { title: "Common page sections", items: ["Why It Matters", "Summary", "Positive", "Negative", "Key Evidence", "What To Watch Next"] },
          ],
        },
        {
          mode: "merger_or_acquisition",
          purpose: "Merger, acquisition, share exchange, or business combination terms.",
          groups: [
            {
              title: "Key terms",
              items: ["Parties", "Consideration", "Exchange ratio", "Cash / stock mix", "Ownership split", "Merger agreement date", "Closing conditions"],
            },
            {
              title: "Event type choices",
              items: ["strategic_transaction", "shareholder_vote", "dilution_risk", "financial_risk", "legal_risk"],
            },
            { title: "Watch labels", items: ["Vote result", "SEC effectiveness", "Closing conditions", "Regulatory approval", "Financing", "Litigation"] },
          ],
        },
        {
          mode: "de_spac_business_combination",
          purpose: "SPAC/de-SPAC registration or amendment, still rendered through generic UI.",
          groups: [
            {
              title: "Key terms",
              items: ["Target company", "Pro forma ownership", "Redemption rights", "Trust / minimum cash", "PIPE or backstop", "Ticker / listing condition"],
            },
            { title: "Event type choices", items: ["strategic_transaction", "shareholder_vote", "listing_risk", "financial_risk"] },
            { title: "Alert-level changes", items: ["Vote result", "Redemption result", "Minimum cash waiver/failure", "Closing completed", "Termination", "Financing collapse"] },
          ],
        },
        {
          mode: "shareholder_vote_update",
          purpose: "Meeting, vote date, approval process, vote result, or adjournment update.",
          groups: [
            { title: "Key terms", items: ["Meeting date", "Record date", "Vote requirement", "Proposal", "Adjournment", "Vote result"] },
            { title: "Event type", items: ["shareholder_vote"] },
            { title: "Score-sensitive facts", items: ["Vote approved", "Vote failed", "Insufficient votes", "Changed approval threshold"] },
          ],
        },
        {
          mode: "exchange_offer_or_share_exchange",
          purpose: "Registered share issuance, exchange offer, or share exchange mechanics.",
          groups: [
            { title: "Key terms", items: ["Securities exchanged", "New securities", "Exchange ratio", "Holder treatment", "Expiration / election deadline", "Registered shares"] },
            { title: "Event type choices", items: ["strategic_transaction", "dilution_risk", "financial_risk", "other"] },
            { title: "Watch labels", items: ["Participation level", "Final exchange result", "Settlement date", "Changed terms"] },
          ],
        },
        {
          mode: "debt_exchange_or_restructuring",
          purpose: "Debt exchange, maturity extension, solvency repair, or distressed financing.",
          groups: [
            { title: "Key terms", items: ["Existing notes", "Exchange notes", "Cash consideration", "Maturity", "Interest rate", "Collateral", "Covenants"] },
            { title: "Event type", items: ["financial_risk"] },
            { title: "Risk labels", items: ["Liquidity pressure", "Refinancing risk", "Default / waiver", "Going concern", "Debt maturity"] },
          ],
        },
        {
          mode: "litigation_or_regulatory_update",
          purpose: "Legal, regulatory, injunction, appraisal, or disclosure-settlement updates tied to a transaction.",
          groups: [
            { title: "Key terms", items: ["Lawsuit", "Court order", "Injunction", "Regulatory approval", "Settlement", "Appraisal / dissenters rights"] },
            { title: "Event type", items: ["legal_risk"] },
            { title: "Score-sensitive facts", items: ["Blocks closing", "Delays closing", "Changes holder treatment", "Requires amended disclosure"] },
          ],
        },
        {
          mode: "spin_off_or_distribution",
          purpose: "Distribution, spin-off, split-off, dividend-like value transfer, or return-of-capital mechanics.",
          groups: [
            { title: "Key terms", items: ["Distribution ratio", "Record date", "Payment / distribution date", "Distributed company", "Tax treatment", "Listing status"] },
            { title: "Event type choices", items: ["capital_return", "dividends", "strategic_transaction"] },
          ],
        },
        {
          mode: "routine_amendment",
          purpose: "Administrative S-4/A or F-4/A with no changed investor economics.",
          groups: [
            { title: "Common labels", items: ["Fee table", "Signature", "Exhibit-only", "Consent", "No-change amendment", "Source unavailable"] },
            { title: "Event type choices", items: ["other", "archive when low-signal"] },
            { title: "What changed", items: ["Only show parent comparison when confirmed parent context is supplied"] },
          ],
        },
      ],
    };
  }

  if (roomKey === "8k-6k") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "spac_transaction_status", "candidate_special"],
        },
        {
          title: "2. Router cases",
          items: [
            "listing_risk",
            "dilution_or_offering",
            "ipo_listing",
            "earnings_or_results",
            "sales_or_operating_update",
            "product_or_commercial_update",
            "leadership_or_governance",
            "insider_or_control_update",
            "shareholder_vote",
            "strategic_transaction",
            "financial_distress_or_default",
            "legal_or_regulatory_risk",
            "dividend",
            "capital_return",
            "fda_or_clinical",
            "routine_amendment",
            "material_amendment",
            "other",
          ],
        },
        {
          title: "3. Event choices",
          items: [
            "listing_risk",
            "dilution_risk",
            "ipo_listing",
            "earnings",
            "sales_performance",
            "product_update",
            "leadership_governance",
            "insider_ownership",
            "shareholder_vote",
            "strategic_transaction",
            "financial_risk",
            "legal_risk",
            "dividends",
            "capital_return",
            "fda_clinical",
            "other",
          ],
        },
      ],
      detailModes: [
        {
          mode: "generic current report payload",
          purpose: "Default 8-K, 8-K/A, 6-K, or 6-K/A payload built from parser facts, source snippets, exhibits, and router output.",
          groups: [
            {
              title: "Display payload",
              items: ["display_type", "data.display_version", "data.event_type", "data.route_case", "evidence", "notes"],
            },
            {
              title: "Core fields",
              items: ["sec_form_type", "company_name", "ticker", "filed_at", "source_url", "score_from_router", "ipo_kind"],
            },
            {
              title: "Source sections",
              items: ["item_inventory", "attachment_inventory", "linked_exhibit_hints", "selected_source_snippets", "selected_tables", "parser_warnings"],
            },
          ],
        },
        {
          mode: "8-K item inventory",
          purpose: "8-K item numbers are evidence and navigation hints; they do not decide the event by themselves.",
          groups: [
            {
              title: "Agreement / transaction items",
              items: ["Item 1.01", "Item 1.02", "Item 2.01", "Item 3.02", "Item 8.01", "Item 9.01"],
            },
            {
              title: "Financial / distress items",
              items: ["Item 2.02", "Item 2.03", "Item 2.04", "Item 2.05", "Item 2.06", "Item 4.02"],
            },
            {
              title: "Listing / governance / vote items",
              items: ["Item 3.01", "Item 3.03", "Item 4.01", "Item 5.01", "Item 5.02", "Item 5.03", "Item 5.07"],
            },
            {
              title: "6-K guardrail",
              items: ["6-K may have no Item numbers", "Primary document may be a wrapper", "Exhibit 99 / attached report can be the real content"],
            },
          ],
        },
        {
          mode: "earnings_or_results / sales_or_operating_update",
          purpose: "Results releases, operating metrics, deliveries, bookings, subscribers, or demand updates.",
          groups: [
            {
              title: "Result labels",
              items: ["Revenue", "Net income / loss", "EPS", "Adjusted EBITDA", "Guidance", "Bookings", "Backlog", "Deliveries", "Production volumes"],
            },
            {
              title: "Typical source",
              items: ["Item 2.02", "EX-99.1 earnings release", "6-K attached results release", "selected_tables"],
            },
            {
              title: "Event choices",
              items: ["earnings", "sales_performance", "financial_risk"],
            },
          ],
        },
        {
          mode: "dilution_or_offering",
          purpose: "Offering, financing, warrant, convertible, PIPE, ATM, or share issuance terms suitable for offering UI.",
          groups: [
            {
              title: "Display type",
              items: ["offering_terms"],
            },
            {
              title: "Offering labels",
              items: ["Registered direct", "Private placement", "PIPE", "ATM", "Warrants", "Convertible notes", "Purchase price", "Exercise price", "Gross proceeds", "Net proceeds"],
            },
            {
              title: "Payload fields",
              items: ["offering_terms", "moneyAmounts", "shareCounts", "market_context_available"],
            },
          ],
        },
        {
          mode: "strategic_transaction / spac_transaction_status",
          purpose: "Merger, acquisition, asset sale, business combination, SPAC/de-SPAC status, vote, redemption, closing, or ticker update.",
          groups: [
            {
              title: "Strategic labels",
              items: ["Merger agreement", "Acquisition", "Asset sale", "Joint venture", "Business combination", "Closing completed", "Termination"],
            },
            {
              title: "SPAC display type",
              items: ["spac_transaction_status"],
            },
            {
              title: "SPAC status labels",
              items: ["business_combination_status", "redemption_result", "merger_vote", "minimum_cash_condition", "ticker_change", "closing_update"],
            },
          ],
        },
        {
          mode: "listing / financial distress / legal risk",
          purpose: "Listing deficiency, delisting risk, default, liquidity stress, bankruptcy, impairment, investigation, lawsuit, or settlement.",
          groups: [
            {
              title: "Listing labels",
              items: ["Nasdaq notice", "NYSE notice", "Minimum bid", "Continued listing", "Cure period", "Hearing deadline", "Delisting"],
            },
            {
              title: "Financial risk labels",
              items: ["Default", "Covenant breach", "Liquidity", "Going concern", "Bankruptcy", "Impairment", "Restructuring", "Workforce reduction"],
            },
            {
              title: "Legal labels",
              items: ["Lawsuit", "Litigation", "Settlement", "SEC investigation", "DOJ investigation", "Subpoena", "Enforcement action"],
            },
          ],
        },
        {
          mode: "leadership / governance / shareholder vote",
          purpose: "Board, officer, auditor, bylaws, control, beneficial ownership, vote result, meeting, or proposal update.",
          groups: [
            {
              title: "Governance labels",
              items: ["CEO / CFO change", "Director appointment", "Director resignation", "Auditor change", "Bylaw amendment", "Change in control"],
            },
            {
              title: "Ownership / control labels",
              items: ["Beneficial ownership", "Control holder", "Voting agreement", "Standstill agreement", "Insider transaction"],
            },
            {
              title: "Vote labels",
              items: ["Shareholder meeting", "Proposal approved", "Proposal rejected", "Votes for / against", "Broker non-votes"],
            },
          ],
        },
        {
          mode: "product / FDA / capital return",
          purpose: "Commercial update, launch, deployment, FDA/clinical event, dividend, buyback, or share repurchase authorization.",
          groups: [
            {
              title: "Product labels",
              items: ["Product launch", "Customer deployment", "Commercial agreement", "Platform release", "Certification", "Clearance"],
            },
            {
              title: "FDA / clinical labels",
              items: ["FDA", "PDUFA", "NDA / BLA / IND", "Clinical trial", "Phase 1 / 2 / 3", "Endpoint", "CRL", "Topline data"],
            },
            {
              title: "Capital-return labels",
              items: ["Dividend declared", "Record date", "Payment date", "Share repurchase", "Buyback authorization"],
            },
          ],
        },
        {
          mode: "amendment handling",
          purpose: "8-K/A and 6-K/A should be analyzed by what changed in the amendment, not by the full prior event.",
          groups: [
            {
              title: "Parent context fields",
              items: ["parent_filing_context", "needs_parent_context", "parentAccessionNumber", "parentFiledDate"],
            },
            {
              title: "Routine amendment labels",
              items: ["Clerical amendment", "Typo correction", "Exhibit refile", "Wrapper-only", "No new material information", "Archive / other"],
            },
            {
              title: "Material amendment labels",
              items: ["Changed terms", "Changed condition", "Changed financing", "Changed vote result", "Changed default / waiver", "Changed listing status"],
            },
          ],
        },
        {
          mode: "archive / other guardrails",
          purpose: "Low-impact or administrative current reports still get compact archive display when source supports it.",
          groups: [
            {
              title: "Common archive labels",
              items: ["Total voting rights", "Block listing return", "Issued share capital update", "Analyst meeting schedule", "Investor presentation only", "Officer certification only"],
            },
            {
              title: "Archive payload fields",
              items: ["archive_summary", "archive_reason", "source_url", "source_availability_note", "selected_source_snippets", "selected_tables", "attachment_inventory"],
            },
            {
              title: "Router gate",
              items: ["score 0-49 = archive short-circuit", "score 50 = analysis-needed candidate", "router must not use alert"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "425") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"],
        },
        {
          title: "2. Router cases",
          items: [
            "merger_or_acquisition_terms",
            "spac_business_combination_terms",
            "tender_or_exchange_offer",
            "agreement_amendment",
            "shareholder_vote_solicitation",
            "shareholder_vote_results",
            "shareholder_meeting_adjournment",
            "deal_litigation_or_regulatory_risk",
            "financing_or_liquidity_risk",
            "investor_day_notice",
            "routine_repetition",
            "unclear_425_communication",
          ],
        },
        {
          title: "3. Event choices",
          items: ["strategic_transaction", "shareholder_vote", "legal_risk", "financial_risk", "dilution_risk", "ipo_listing", "other"],
        },
      ],
      detailModes: [
        {
          mode: "generic / common 425 payload",
          purpose: "Default Form 425 transaction communication page; router chooses display_type and analysis copies the payload.",
          groups: [
            {
              title: "Display payload",
              items: ["display_type", "data.display_version", "data.route_case", "data.event_type", "data.routing_reason", "evidence", "notes"],
            },
            {
              title: "Core data objects",
              items: ["deal", "vote", "offer", "spac", "spac_transaction_status", "amendment", "legal", "financing", "calendar_items"],
            },
            {
              title: "Source identity",
              items: ["company_name", "primary_ticker", "filed_by", "subject_company", "communication_types", "content_types"],
            },
          ],
        },
        {
          mode: "merger_or_acquisition_terms",
          purpose: "Material merger, acquisition, business-combination, consideration, closing, or deal-status communication.",
          groups: [
            {
              title: "Deal fields",
              items: ["transaction_type", "transaction_status", "parties", "consideration_text", "cash_component", "stock_component", "exchange_ratio", "transaction_value", "premium", "expected_close"],
            },
            {
              title: "Investor labels",
              items: ["Consideration", "Transaction value", "Premium", "Expected close", "Closing conditions", "Changed deal terms"],
            },
            {
              title: "Event type choices",
              items: ["strategic_transaction", "financial_risk", "legal_risk"],
            },
          ],
        },
        {
          mode: "spac_transaction_status",
          purpose: "SPAC/de-SPAC business-combination status, vote, redemption, minimum cash, closing condition, ticker, or related update.",
          groups: [
            {
              title: "SPAC status fields",
              items: ["spac_name", "target_name", "combined_company_name", "expected_ticker", "pipe_amount", "pre_money_valuation", "trust_cash", "redemption_risk"],
            },
            {
              title: "Vote / closing fields",
              items: ["meeting_date", "record_date", "reconvened_date", "vote_results", "expected_close", "transaction_status"],
            },
            {
              title: "SPAC labels",
              items: ["Business combination", "Redemption", "Minimum cash", "PIPE", "Trust cash", "Ticker change", "Adjourned meeting", "Vote result"],
            },
            {
              title: "Guardrails",
              items: ["Do not use for plain blank-check IPO registration", "Do not infer de-SPAC status without source-backed target/deal facts"],
            },
          ],
        },
        {
          mode: "tender_or_exchange_offer",
          purpose: "Tender offer, exchange offer, public exchange offer, hostile or unsolicited offer communication.",
          groups: [
            {
              title: "Offer fields",
              items: ["offer_type", "is_hostile_or_unsolicited", "subject_company", "consideration", "schedule_to_reference", "form_s4_reference", "consent_solicitation"],
            },
            {
              title: "Investor labels",
              items: ["Tender offer", "Exchange offer", "Hostile / unsolicited", "Offer consideration", "Schedule TO reference", "Consent solicitation"],
            },
            {
              title: "Event type choices",
              items: ["strategic_transaction", "shareholder_vote", "legal_risk"],
            },
          ],
        },
        {
          mode: "agreement_amendment",
          purpose: "Follow-up or amended communication where the current filing changes or repeats prior deal terms.",
          groups: [
            {
              title: "Amendment fields",
              items: ["is_amendment_or_follow_up", "amendment_number", "amendment_title", "amendment_date", "original_agreement_date", "amended_sections", "unchanged_remainder_language"],
            },
            {
              title: "Change labels",
              items: ["Consideration changed", "Timeline changed", "Closing condition changed", "Recommendation changed", "Disclosure supplement", "No material change", "Routine repetition"],
            },
            {
              title: "Guardrails",
              items: ["Analyze what changed in this filing", "Do not restate parent agreement as new unless terms changed", "Routine repetition can archive"],
            },
          ],
        },
        {
          mode: "shareholder_vote",
          purpose: "Vote solicitation, special meeting, record date, board recommendation, vote results, or adjournment.",
          groups: [
            {
              title: "Vote fields",
              items: ["meeting_date", "record_date", "reconvened_date", "vote_recommendation", "solicitation_present", "adjourned", "quorum", "voting_threshold", "vote_results"],
            },
            {
              title: "Vote labels",
              items: ["Special meeting", "Record date", "Board recommendation", "Adjournment", "Reconvened meeting", "Proposal approved", "Proposal not approved", "Quorum"],
            },
            {
              title: "Calendar labels",
              items: ["Meeting date", "Record date", "Reconvened date", "Vote deadline", "Closing date"],
            },
          ],
        },
        {
          mode: "deal_litigation_or_regulatory_risk",
          purpose: "Litigation, injunction, regulatory approval, HSR, settlement, or claims that may affect deal timing or certainty.",
          groups: [
            {
              title: "Legal fields",
              items: ["litigation_or_claims", "regulatory_risk", "injunction_or_delay_risk"],
            },
            {
              title: "Risk labels",
              items: ["Merger litigation", "Injunction risk", "Disclosure settlement", "HSR / antitrust", "Regulatory approval", "Closing delay"],
            },
            {
              title: "Event type",
              items: ["legal_risk"],
            },
          ],
        },
        {
          mode: "financing_or_liquidity_risk",
          purpose: "Financing availability, financing condition, liquidity need, going concern, or failure-to-close funding consequence.",
          groups: [
            {
              title: "Financing fields",
              items: ["financing_risk", "financing_condition", "going_concern_or_liquidity_risk"],
            },
            {
              title: "Risk labels",
              items: ["Financing condition", "Debt financing risk", "Liquidity need", "Capital raise alternative", "Going concern", "Failure-to-close consequence"],
            },
            {
              title: "Event type choices",
              items: ["financial_risk", "dilution_risk", "strategic_transaction"],
            },
          ],
        },
        {
          mode: "investor_day_notice / routine_repetition",
          purpose: "Investor day, FAQ, employee memo, presentation notice, or repeated deal material with no new material terms.",
          groups: [
            {
              title: "Routine labels",
              items: ["Investor day notice", "Employee FAQ", "Presentation notice", "Repeated merger summary", "No new material information", "Boilerplate-only"],
            },
            {
              title: "Archive guardrails",
              items: ["No changed consideration", "No changed timeline", "No changed closing conditions", "No changed vote date", "No new litigation/financing risk"],
            },
            {
              title: "Display type",
              items: ["generic"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "periodic-reports") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special"],
        },
        {
          title: "2. Router cases",
          items: [
            "routine_periodic_report",
            "earnings_results",
            "sales_performance",
            "going_concern_or_liquidity",
            "legal_or_regulatory_risk",
            "dividend_or_capital_return",
            "product_or_business_update",
            "fda_or_clinical_update",
            "leadership_or_governance",
            "strategic_transaction",
            "ipo_listing",
            "listing_risk",
            "routine_amendment_no_llm",
            "material_amendment",
            "needs_human_review",
            "other",
          ],
        },
        {
          title: "3. Event choices",
          items: [
            "earnings",
            "sales_performance",
            "financial_risk",
            "legal_risk",
            "listing_risk",
            "strategic_transaction",
            "capital_return",
            "dividends",
            "fda_clinical",
            "product_update",
            "leadership_governance",
            "shareholder_vote",
            "ipo_listing",
            "other",
          ],
        },
      ],
      detailModes: [
        {
          mode: "generic periodic report payload",
          purpose: "Default 10-K, 10-Q, or 20-F detail payload built from parser facts and router output.",
          groups: [
            {
              title: "Display payload",
              items: ["display_type", "data.version", "data.event_type", "data.form_type", "data.accession_number", "evidence", "notes"],
            },
            {
              title: "Filing identity",
              items: ["Company name", "Primary ticker", "Exchange", "Reporting period", "Fiscal year", "Fiscal quarter", "Form type"],
            },
            {
              title: "Routing fields",
              items: ["route_case", "confidence", "analysis_llm_needed", "derived_delivery_level", "source_blocks_used"],
            },
          ],
        },
        {
          mode: "earnings_results / sales_performance",
          purpose: "Quarterly or annual operating results, revenue demand, bookings, subscribers, margin, or sales deterioration.",
          groups: [
            {
              title: "Result labels",
              items: ["Revenue", "Net income / loss", "EPS", "Gross margin", "Operating loss", "Cash balance", "Bookings", "Subscribers / units"],
            },
            {
              title: "Route cases",
              items: ["earnings_results", "sales_performance", "routine_periodic_report"],
            },
            {
              title: "Event choices",
              items: ["earnings", "sales_performance", "financial_risk", "other"],
            },
          ],
        },
        {
          mode: "going_concern_or_liquidity",
          purpose: "Going-concern language, liquidity runway, debt stress, covenant/default risk, or working-capital pressure.",
          groups: [
            {
              title: "Risk labels",
              items: ["Going concern", "Substantial doubt", "Cash runway", "Working capital deficit", "Debt maturity", "Default / waiver", "Covenant risk"],
            },
            {
              title: "Parser evidence labels",
              items: ["going_concern_language", "liquidity_or_cash_runway_language", "debt_default_or_covenant_language"],
            },
            {
              title: "Event choices",
              items: ["financial_risk", "dilution_risk", "listing_risk"],
            },
          ],
        },
        {
          mode: "legal_or_regulatory_risk / controls",
          purpose: "Legal proceedings, investigations, enforcement actions, restatements, non-reliance, or internal-control problems.",
          groups: [
            {
              title: "Legal labels",
              items: ["Litigation", "SEC / DOJ investigation", "Subpoena", "Settlement", "Loss contingency", "Regulatory proceeding"],
            },
            {
              title: "Controls / accounting labels",
              items: ["Material weakness", "Restatement", "Non-reliance", "Amended financials", "Disclosure controls"],
            },
            {
              title: "Parser evidence labels",
              items: ["legal_or_regulatory_proceedings", "material_weakness_language", "restatement_indicator", "material_weakness_or_controls_change_in_amendment"],
            },
          ],
        },
        {
          mode: "dividend_or_capital_return",
          purpose: "Dividend, special dividend, buyback authorization, issuer purchases, or capital-return changes disclosed in the periodic report.",
          groups: [
            {
              title: "Capital-return labels",
              items: ["Dividend declared", "Special dividend", "Record date", "Payable date", "Share repurchase authorization", "Shares repurchased"],
            },
            {
              title: "Parser evidence labels",
              items: ["dividend_declaration_or_payment", "dividend_record_date", "dividend_payable_date", "share_repurchase_activity_or_authorization"],
            },
            {
              title: "Event choices",
              items: ["dividends", "capital_return"],
            },
          ],
        },
        {
          mode: "business / listing / governance updates",
          purpose: "Non-earnings business updates that dominate the periodic report impact.",
          groups: [
            {
              title: "Business labels",
              items: ["Product launch", "Clinical update", "FDA milestone", "Customer rollout", "Strategic transaction", "Asset sale"],
            },
            {
              title: "Listing / governance labels",
              items: ["Minimum bid deficiency", "Delisting notice", "Cure deadline", "Board / CEO / CFO change", "Shareholder vote"],
            },
            {
              title: "Parser evidence labels",
              items: [
                "product_launch_or_customer_rollout_language",
                "fda_or_clinical_trial_language",
                "exchange_deficiency_or_delisting_notice",
                "leadership_or_board_change_language",
                "shareholder_vote_or_annual_meeting_language",
              ],
            },
          ],
        },
        {
          mode: "amendment handling",
          purpose: "10-K/A, 10-Q/A, and 20-F/A should be scored by what changed in the amendment, not by the full original report.",
          groups: [
            {
              title: "Amendment fields",
              items: ["is_amendment", "amendment_number", "explanatory_note", "amended_items", "parent_accession_number", "original_filing_date"],
            },
            {
              title: "Routine archive labels",
              items: ["XBRL-only", "Certification-only", "Signature-only", "No other changes", "Routine amendment no LLM"],
            },
            {
              title: "Material amendment labels",
              items: ["Financial statement change", "Restatement", "Going-concern change", "Controls change", "Legal proceeding change", "Listing-risk change"],
            },
          ],
        },
        {
          mode: "source inventory / table summary",
          purpose: "Parser/debug context for whether the periodic report source package was complete enough to analyze.",
          groups: [
            {
              title: "Source inventory",
              items: ["document_count", "attachment_text_count", "xbrl_fact_count", "has_primary_document", "has_inline_xbrl_document", "has_truncated_source"],
            },
            {
              title: "Table summary",
              items: ["classification", "confidence", "type_hints", "caption", "unit_hint", "row_count", "column_count", "numeric_cell_count"],
            },
            {
              title: "Coverage warnings",
              items: ["missingCriticalRawData", "hasPotentiallyUselessRawData", "parser_warnings", "noiseCandidates"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "sc13") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special"],
        },
        {
          title: "2. Detail UI choices",
          items: [
            "13d_control_or_activist",
            "13g_passive_or_institutional",
            "ownership_change_or_exit",
            "sc13_amendment",
            "routine_archive",
          ],
        },
      ],
      detailModes: [
        {
          mode: "generic display payload",
          purpose: "SC13 normally uses the common filing detail page with LLM-authored ownership facts.",
          groups: [
            { title: "Display payload", items: ["display_type: generic", "data.issuerName", "data.reportingPersons", "data.ownershipIntent"] },
            { title: "Optional data", items: ["percentOwned", "sharesBeneficiallyOwned", "isAmendment", "isExitFiling", "ownershipPercentChange"] },
            { title: "Common page sections", items: ["Why It Matters", "Summary", "Positive", "Negative", "Key Evidence", "What To Watch Next"] },
          ],
        },
        {
          mode: "13d_control_or_activist",
          purpose: "Schedule 13D/13D-A where Item 4, agreements, or related text show control, governance, or transaction intent.",
          groups: [
            {
              title: "Ownership fields",
              items: ["Issuer", "Reporting person / group", "Security class", "Shares beneficially owned", "Percent of class", "Voting power", "Dispositive power"],
            },
            {
              title: "Intent labels",
              items: ["Purpose of transaction", "Board / governance action", "Proxy or voting action", "Control agreement", "Transaction support", "Source of funds"],
            },
            { title: "Event type choices", items: ["insider_ownership", "leadership_governance", "strategic_transaction", "legal_risk", "financial_risk"] },
          ],
        },
        {
          mode: "13g_passive_or_institutional",
          purpose: "Schedule 13G/13G-A passive, institutional, or exempt-holder reporting without active Item 4 pressure.",
          groups: [
            {
              title: "Ownership fields",
              items: ["Issuer", "Reporting person", "Beneficial ownership", "Percent of class", "Sole / shared voting", "Sole / shared dispositive", "Type of reporting person"],
            },
            {
              title: "Passive labels",
              items: ["Passive stake", "Institutional holder", "Large passive holder", "Routine annual amendment", "Below-5% exit", "Certification"],
            },
            { title: "Event type", items: ["insider_ownership"] },
          ],
        },
        {
          mode: "ownership_change_or_exit",
          purpose: "Meaningful increase, decrease, sale, below-5% exit, or reportable ownership exit.",
          groups: [
            { title: "Current ownership", items: ["Current shares", "Current percent", "Voting power", "Dispositive power"] },
            { title: "Prior context", items: ["Prior shares", "Prior percent", "Parent accession", "Parent filing date", "Comparison status"] },
            {
              title: "Change labels",
              items: ["Stake increase", "Stake decrease", "Reportable ownership exited", "Below 5%", "Block sale", "New group", "Control threshold crossed"],
            },
          ],
        },
        {
          mode: "sc13_amendment",
          purpose: "SC 13D/A or SC 13G/A where confirmed parent context supports a current-vs-prior comparison.",
          groups: [
            { title: "Parent context", items: ["parent_filing_context.status", "Parent accession", "Parent form", "Parent filing date", "Comparison allowed"] },
            {
              title: "What changed labels",
              items: [
                "Shares changed",
                "Percent changed",
                "Reporting person changed",
                "Intent changed",
                "Agreement added",
                "Sale plan added",
                "Voting/control terms changed",
                "Certification changed",
                "Exit / below-5% status",
              ],
            },
            { title: "Guardrails", items: ["No parent context: do not invent amendment change", "Unclear change: cap urgency", "Routine repeat: archive or low feed"] },
          ],
        },
        {
          mode: "routine_archive",
          purpose: "Low-signal passive ownership or administrative amendment that still gets an archive detail page.",
          groups: [
            { title: "Archive labels", items: ["Routine 13G", "Annual amendment", "Minimal ownership change", "Passive certification", "Below-5% exit", "No active intent"] },
            { title: "Display payload", items: ["issuerName", "reportingPersons", "ownershipIntent", "percentOwned when stated", "sharesBeneficiallyOwned when stated"] },
          ],
        },
      ],
    };
  }

  if (roomKey === "nt") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special"],
        },
        {
          title: "2. Display version",
          items: ["nt_late_filing_v1"],
        },
        {
          title: "3. NT report choices",
          items: ["NT 10-K", "NT 10-Q", "NT 20-F", "NT 10-K/A", "NT 10-Q/A", "NT 20-F/A"],
        },
      ],
      detailModes: [
        {
          mode: "nt_late_filing_v1",
          purpose: "Default NT 10-K, NT 10-Q, or NT 20-F late-filing notice UI built from Form 12b-25 facts.",
          groups: [
            {
              title: "Display payload",
              items: ["display_type", "display_version", "data.form_family", "data.delayed_report", "data.period_of_report", "evidence", "notes"],
            },
            {
              title: "Core delay facts",
              items: [
                "Delayed report",
                "Period of report",
                "Filed at",
                "Extension window",
                "Anticipated within extension",
                "Unable without unreasonable effort",
                "Late filing reason",
              ],
            },
            {
              title: "Investor-facing labels",
              items: ["Delayed report", "Period ended", "Expected filing timing", "Reason for delay", "Extension window", "Filed late notice"],
            },
          ],
        },
        {
          mode: "routine_extension_archive",
          purpose: "Routine Form 12b-25 extension where no material results change or accounting risk is disclosed.",
          groups: [
            {
              title: "Archive labels",
              items: ["Routine late filing", "Expected within extension", "No significant results change", "Administrative delay", "Filing preparation delay"],
            },
            {
              title: "Common parser flags",
              items: ["anticipated_within_extension: true", "significant_change_expected: false", "other_periodic_reports_filed: true"],
            },
            {
              title: "Guardrails",
              items: ["Do not alert from late-filing form alone", "Keep routine NT filings below feed unless source-backed risk is present"],
            },
          ],
        },
        {
          mode: "financial_or_accounting_delay",
          purpose: "Late filing tied to accounting review, audit issue, restatement, material weakness, going concern, or financial-statement uncertainty.",
          groups: [
            {
              title: "Risk labels",
              items: ["Accounting review", "Audit delay", "Restatement / no-reliance", "Material weakness", "Going concern", "Financial-statement delay"],
            },
            {
              title: "Display payload fields",
              items: ["late_filing_reason", "accountant_statement_attached", "accountant_statement_text", "significant_change_expected", "significant_change_explanation"],
            },
            {
              title: "Event type choices",
              items: ["financial_risk", "legal_risk", "other"],
            },
          ],
        },
        {
          mode: "results_change_delay",
          purpose: "NT filing discloses expected significant operating-result change in Part IV.",
          groups: [
            {
              title: "Result-change labels",
              items: ["Revenue change", "Net loss / income change", "Gross margin change", "Liquidity change", "Order delay", "Quantitative disclosure"],
            },
            {
              title: "Display payload fields",
              items: ["significant_change_expected", "significant_change_explanation", "significant_change_quantitative_disclosure"],
            },
            {
              title: "Guardrails",
              items: ["Use only source-backed Part IV language", "Do not turn generic delay language into financial deterioration"],
            },
          ],
        },
        {
          mode: "amended_nt_notice",
          purpose: "NT 10-K/A, NT 10-Q/A, or NT 20-F/A amendment to a previous late-filing notice.",
          groups: [
            {
              title: "Amendment fields",
              items: ["is_amendment", "amendment_purpose", "source_form_type", "body_form_type"],
            },
            {
              title: "Change labels",
              items: ["Amended late notice", "Updated reason", "Updated timing", "Corrected checkbox", "Exhibit added", "Administrative amendment"],
            },
            {
              title: "Guardrails",
              items: ["Do not compare against parent unless confirmed context is supplied", "Routine amendment can archive"],
            },
          ],
        },
        {
          mode: "special_context_flags",
          purpose: "Additional source-backed flags that may affect routing, scoring, or human review.",
          groups: [
            {
              title: "Special flags",
              items: ["is_transition_report", "portion_only", "electronic_filing_difficulty", "missing_report_hints", "contact", "raw_data_quality"],
            },
            {
              title: "Possible labels",
              items: ["Transition report", "Partial report delay", "EDGAR filing issue", "Missing prior reports", "Ambiguous checkbox", "Needs review"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "form25") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["sec_form25_listing_removal", "generic", "candidate_special"],
        },
        {
          title: "2. Display version",
          items: ["sec_form25_listing_removal_v1"],
        },
        {
          title: "3. Router cases",
          items: [
            "common_equity_delisting_risk",
            "merger_completion_removal",
            "matured_redeemed_retired_non_common",
            "voluntary_withdrawal_continued_listing_or_transfer",
            "ambiguous_units_or_ads",
            "missing_or_unclear_reason",
            "other_form25",
          ],
        },
      ],
      detailModes: [
        {
          mode: "sec_form25_listing_removal",
          purpose: "Default Form 25 / 25-NSE removal-from-listing and registration detail payload.",
          groups: [
            {
              title: "Display payload",
              items: ["display_type", "display_version", "data", "evidence", "notes"],
            },
            {
              title: "Core fields",
              items: [
                "issuer_name",
                "filed_by_name",
                "exchange",
                "removed_security",
                "security_category",
                "rule_provision",
                "removal_reason",
                "removal_reason_text",
              ],
            },
            {
              title: "Date / venue fields",
              items: ["filing_date", "effectiveness_date", "delisting_or_removal_date", "trading_suspension_date", "continued_listing_or_trading_venue"],
            },
            {
              title: "Context fields",
              items: ["primary_ticker", "primary_ticker_exchange", "common_equity_affected", "successor_or_acquirer", "consideration_summary", "deterministic_case"],
            },
          ],
        },
        {
          mode: "common_equity_delisting_risk",
          purpose: "Common stock, ordinary shares, or unresolved ADS/units removal where listing failure or trading removal matters to equity holders.",
          groups: [
            {
              title: "Reason labels",
              items: ["Listing standards failure", "Bid-price failure", "Bankruptcy / insolvency", "No appeal", "Trading suspended", "Exchange delisting determination"],
            },
            {
              title: "Investor-facing labels",
              items: ["Removed security", "Exchange", "Suspension date", "Removal date", "Rule provision", "Reason for removal"],
            },
            {
              title: "Event type",
              items: ["listing_risk"],
            },
          ],
        },
        {
          mode: "merger_completion_removal",
          purpose: "Form 25 after completed merger, share exchange, substitution, cash-out, or acquisition closing.",
          groups: [
            {
              title: "Transaction fields",
              items: ["successor_or_acquirer", "consideration_summary", "delisting_or_removal_date", "trading_suspension_date", "rule_provision"],
            },
            {
              title: "Labels",
              items: ["Merger completed", "Share exchange", "Cash-out", "Substitution of securities", "Deal completion removal"],
            },
            {
              title: "Event type choices",
              items: ["strategic_transaction", "other when purely administrative"],
            },
            {
              title: "Guardrails",
              items: ["Do not label as listing failure if source says merger completion", "Score by new information in this filing, not original deal importance"],
            },
          ],
        },
        {
          mode: "matured_redeemed_retired_non_common",
          purpose: "Debt, warrants, preferred, notes, or other non-common securities removed after maturity, redemption, payment, or retirement.",
          groups: [
            {
              title: "Security labels",
              items: ["Debt", "Notes", "Warrants", "Preferred stock", "Units", "Other non-common securities"],
            },
            {
              title: "Reason labels",
              items: ["Matured", "Redeemed", "Paid at maturity", "Retired", "Expired warrant", "No common equity affected"],
            },
            {
              title: "Event type choices",
              items: ["other", "financial_risk only with source-backed credit stress/default/bankruptcy"],
            },
            {
              title: "Guardrails",
              items: ["Do not call routine non-common maturity listing_risk", "Do not imply common-share delisting unless common equity is affected"],
            },
          ],
        },
        {
          mode: "voluntary_withdrawal_continued_listing_or_transfer",
          purpose: "Voluntary exchange withdrawal, transfer, or removal where the security continues trading/listing elsewhere.",
          groups: [
            {
              title: "Venue fields",
              items: ["continued_listing_or_trading_venue", "exchange", "removed_security", "delisting_or_removal_date"],
            },
            {
              title: "Labels",
              items: ["Voluntary withdrawal", "Exchange transfer", "Continued listing", "Trading venue changed", "No exchange-failure signal"],
            },
            {
              title: "Event type choices",
              items: ["other", "listing_risk only if source-backed listing failure remains central"],
            },
          ],
        },
        {
          mode: "ambiguous_units_or_ads / missing_or_unclear_reason",
          purpose: "Cases where security class, common-equity impact, removal reason, or continued venue is unclear.",
          groups: [
            {
              title: "Review labels",
              items: ["Ambiguous units", "Unresolved ADS", "Missing removal reason", "Security title not found", "Issuer identity unclear", "Exchange missing"],
            },
            {
              title: "Routing fields",
              items: ["router_required", "analysis_reasons", "suggested_event_types", "classification_source", "needs_human_review"],
            },
            {
              title: "Guardrails",
              items: ["Use low confidence when reason is unclear", "Do not invent the listing venue or reason", "Preserve archive page even for low-signal removals"],
            },
          ],
        },
        {
          mode: "classification_source",
          purpose: "Debug whether parser, router, or fallback selected event_type/display_type.",
          groups: [
            {
              title: "Classification values",
              items: ["parser_deterministic", "router", "fallback"],
            },
            {
              title: "Display notes",
              items: ["classification_source", "analysis_llm_needed", "router_required", "warning:*", "document_count", "attachment_count"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "s8") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special"],
        },
        {
          title: "2. S-8 UI mode choices",
          items: ["plan_registration", "inducement_awards", "reoffer_resale", "post_effective_amendment"],
        },
        {
          title: "Approved metric labels",
          items: [
            "Shares Outstanding",
            "Registered plan shares",
            "Plan Shares / Outstanding",
            "Plan Type",
            "Plan Name",
            "Immediate Dilution",
            "Vesting Period",
            "Registered inducement shares",
            "Inducement Shares / Outstanding",
            "Award Type",
            "Grant Date",
            "Recipient Count",
            "Reoffer resale shares",
            "Resale Shares / Outstanding",
            "Parent plan shares",
            "Parent Plan / Outstanding",
            "Reoffer subset",
            "Subset of Parent Plan",
            "Selling Holders",
            "Amendment Status",
            "Additional Shares",
            "Prior Shares Carried Forward",
            "Remaining Plan Shares Removed",
          ],
        },
      ],
      detailModes: [
        {
          mode: "plan_registration",
          purpose: "Ordinary S-8 plan-share registration for employees, directors, consultants, or compensation plans.",
          groups: [
            { title: "Display payload", items: ["display_type", "data.s8_ui_mode", "data.narrative_summary", "data.snapshot_metrics"] },
            {
              title: "Preferred snapshot labels",
              items: ["Shares Outstanding", "Registered plan shares", "Plan Shares / Outstanding", "Plan Name", "Plan Type", "Immediate Dilution", "Vesting Period"],
            },
            {
              title: "Important guardrails",
              items: ["Do not show Company proceeds", "Do not use fee-table dollars as shares", "Do not imply resale unless selling-holder facts exist"],
            },
          ],
        },
        {
          mode: "inducement_awards",
          purpose: "S-8 for inducement grants, inducement plans, or mixed plan + inducement award registrations.",
          groups: [
            {
              title: "Preferred snapshot labels",
              items: ["Shares Outstanding", "Registered inducement shares", "Inducement Shares / Outstanding", "Award Type", "Grant Date", "Recipient Count", "Vesting Period"],
            },
            {
              title: "Award labels",
              items: ["Stock options", "RSUs", "Restricted stock", "Inducement plan", "New-hire awards", "Nasdaq Listing Rule 5635(c)(4)"],
            },
            { title: "Component handling", items: ["If plan shares and inducement shares both exist, keep component counts separate in evidence"] },
          ],
        },
        {
          mode: "reoffer_resale",
          purpose: "S-8 reoffer or resale prospectus with selling holders or affiliate resale rows.",
          groups: [
            {
              title: "Preferred snapshot labels",
              items: ["Shares Outstanding", "Reoffer resale shares", "Resale Shares / Outstanding", "Selling Holders", "Plan Name", "Vesting Period"],
            },
            {
              title: "With parent S-8 context",
              items: ["Shares Outstanding", "Parent plan shares", "Reoffer subset", "Parent Plan / Outstanding", "Subset of Parent Plan"],
            },
            {
              title: "POS context details",
              items: ["Parent filing", "Parent plan shares", "Reoffer subset", "Relationship", "Company proceeds", "Selling holders", "What changed", "What did not change"],
            },
            {
              title: "Guardrails",
              items: ["Do not add reoffer subset on top of parent plan shares", "Company proceeds should explain resale proceeds only", "Do not infer insider selling intent"],
            },
          ],
        },
        {
          mode: "post_effective_amendment",
          purpose: "S-8 POS, S-8/A, deregistration, no-additional-securities, carryover, plan replacement, or amendment update.",
          groups: [
            {
              title: "Preferred snapshot labels",
              items: ["Amendment Status", "Additional Shares", "Prior Shares Carried Forward", "Remaining Plan Shares Removed", "Plan Name"],
            },
            {
              title: "What Changed / context labels",
              items: ["Parent filing", "Parent plan shares", "Reoffer subset", "Relationship", "What changed", "What did not change", "Company proceeds", "Selling holders"],
            },
            {
              title: "Routine archive labels",
              items: ["Deregistration", "No additional securities", "Exhibit-only", "Consent-only", "Administrative amendment", "Plan replacement", "Carryover shares"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "tender") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic"],
        },
        {
          title: "2. Transaction family choices",
          items: ["tender_offer", "going_private", "exchange_offer", "cross_border", "issuer_repurchase", "other"],
        },
        {
          title: "3. Transaction type choices",
          items: ["issuer_tender", "third_party_tender", "going_private_cash_out", "exchange_offer", "merger_tender", "final_results", "amendment_update", "other"],
        },
      ],
      detailModes: [
        {
          mode: "generic display payload",
          purpose: "Tender / CB / 13E3 uses the common filing detail page; transaction_fingerprint is metadata for context matching.",
          groups: [
            { title: "Display payload", items: ["display_type: generic", "data.payload_version", "data.* source-backed UI fields", "evidence", "notes"] },
            { title: "Common page sections", items: ["Why It Matters", "Summary", "Positive", "Negative", "Key Evidence", "What To Watch Next"] },
            { title: "Metadata payload", items: ["transaction_fingerprint", "Not displayed as UI copy", "Used for future filing_context linking"] },
          ],
        },
        {
          mode: "issuer_tender",
          purpose: "Issuer self-tender, issuer repurchase, Dutch auction, fund NAV tender, or issuer exchange offer.",
          groups: [
            { title: "Fingerprint fields", items: ["transaction_family", "transaction_type", "target_company", "target_ticker", "cash_price", "offer_size", "securities_sought"] },
            { title: "Tender terms", items: ["Purchase price", "Price range / Dutch auction", "NAV pricing", "Shares sought", "Offer size", "Expiration", "Proration"] },
            { title: "Calendar labels", items: ["Expiration date", "Withdrawal deadline", "Pricing date", "Valuation date", "Payment date", "Final-results date"] },
            { title: "Guardrails", items: ["Issuer tender is not automatically capital_return", "Small final-result amendments cap below alert unless another alert gate exists"] },
          ],
        },
        {
          mode: "third_party_tender",
          purpose: "Third-party Schedule TO tender, merger tender, acquisition tender, or target response filing.",
          groups: [
            { title: "Fingerprint fields", items: ["buyer_parent", "buyer_group", "offeror", "target_company", "target_ticker", "cash_price", "minimum_condition"] },
            { title: "Offer terms", items: ["Offer price", "Securities sought", "Minimum tender condition", "Financing condition", "Board recommendation", "Second-step merger"] },
            { title: "Related ticker handling", items: ["Primary ticker: SEC filer when source-backed", "Target ticker: transaction_fingerprint.target_ticker", "Related tickers: buyer/target when useful"] },
          ],
        },
        {
          mode: "going_private_13e3",
          purpose: "Schedule 13E-3 going-private, affiliate cash-out, squeeze-out, merger, delisting, or deregistration transaction.",
          groups: [
            { title: "Fingerprint fields", items: ["transaction_family: going_private", "transaction_type: going_private_cash_out", "cash_price", "consideration_summary", "merger_agreement_date"] },
            { title: "Holder economics", items: ["Cash-out price", "Exchange ratio", "Public holder treatment", "Special committee / board recommendation", "Financing condition", "Expected closing"] },
            { title: "Amendment labels", items: ["Completion-only", "Delisting-only", "Changed consideration", "Vote result", "Financing change", "Condition change", "Litigation / regulatory block"] },
            { title: "Guardrails", items: ["First definitive cash-out can be alert", "Completion-only or delisting-only amendment usually feed-level"] },
          ],
        },
        {
          mode: "form_cb_cross_border",
          purpose: "Form CB cross-border tender, exchange offer, merger, rights offer, buyback, or business combination.",
          groups: [
            { title: "Fingerprint fields", items: ["transaction_family: cross_border", "transaction_type", "target_company", "buyer_parent", "exchange_ratio", "consideration_summary"] },
            { title: "Transaction terms", items: ["What holders receive", "Ownership after deal", "Offer document / circular", "Rule 13e-4(h)(8)", "Rule 14d-1(c)", "Rule 14d-1(d)"] },
            { title: "Writing guardrails", items: ["Do not create cross-border legal risk from form type alone", "Describe transaction mechanics and approvals", "Do not make exhibit inventory the summary lead"] },
          ],
        },
        {
          mode: "amendment_update",
          purpose: "SC TO/A, SC 13E3/A, CB/A, or related amendment where current filing changes or repeats prior transaction terms.",
          groups: [
            {
              title: "Amendment fingerprint",
              items: ["amendment_number", "amendment_change_type", "material_terms_changed", "source_forms", "source_accession", "source_evidence"],
            },
            {
              title: "Change labels",
              items: ["price_change", "deadline_extension", "final_results", "financing_change", "condition_change", "procedural", "no_material_change", "unknown"],
            },
            {
              title: "Score-sensitive changes",
              items: ["Changed price", "Changed consideration", "Changed recommendation", "Changed conditions", "Accepted shares", "Payment date", "Failed / terminated", "Litigation / regulatory block"],
            },
            { title: "Guardrails", items: ["Score amendment by what changed now", "Routine/no-change amendment can archive", "Do not alert from original deal importance alone"] },
          ],
        },
        {
          mode: "transaction_fingerprint",
          purpose: "Stable metadata used to connect parent/follow-up filings; it is not the visible UI copy.",
          groups: [
            {
              title: "Parties",
              items: ["target_company", "target_ticker", "buyer_parent", "buyer_group", "offeror", "filing_persons"],
            },
            {
              title: "Economics",
              items: ["cash_price", "exchange_ratio", "consideration_summary", "offer_size", "securities_sought"],
            },
            {
              title: "Conditions / dates",
              items: ["minimum_condition", "financing_condition", "offer_expiration", "final_result_date", "merger_agreement_date", "expected_closing"],
            },
            {
              title: "Amendment context",
              items: ["amendment_number", "amendment_change_type", "material_terms_changed", "source_forms", "source_accession", "source_evidence"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "s1-f1") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"],
        },
        {
          title: "2. Registration kind",
          items: ["ipo", "resale", "mixed", "primary", "unknown"],
        },
        {
          title: "3. Boundary variants",
          items: ["S-1/A or F-1/A amendment", "POS AM", "Rule 462(b) / MEF", "routine or administrative update"],
        },
      ],
      detailModes: [
        {
          mode: "offering_terms",
          purpose: "IPO, new listing, primary sale, resale registration, or mixed S-1/F-1 offering terms.",
          groups: [
            {
              title: "Offering facts",
              items: ["registration_kind", "ipo_kind", "securities", "shares_offered", "selling_shareholder_shares", "underwriters"],
            },
            {
              title: "Pricing / proceeds",
              items: ["price_low", "price_high", "gross_proceeds", "use_of_proceeds"],
            },
            {
              title: "Display data",
              items: ["offering", "offering_terms", "use_of_proceeds", "capitalization", "dilution", "exhibit_summary"],
            },
            {
              title: "Investor-facing labels",
              items: ["Shares offered", "Price range", "Company proceeds", "Selling stockholder shares", "Use of proceeds", "Underwriters"],
            },
          ],
        },
        {
          mode: "candidate_special",
          purpose: "High-risk registration candidate where risk factors or unusual issuer facts are more important than simple offering math.",
          groups: [
            { title: "Risk facts", items: ["going_concern", "listing_risk", "legal_risk", "fda_or_clinical", "insider_control", "strategic_transaction"] },
            { title: "Display data", items: ["risks", "risk_factors", "selected_sections"] },
            { title: "Investor-facing labels", items: ["Going concern", "Listing risk", "Clinical risk", "Legal risk", "Insider control", "Strategic transaction"] },
          ],
        },
        {
          mode: "spac_transaction_status",
          purpose: "SPAC or de-SPAC registration status surfaced from S-1/F-1 source blocks.",
          groups: [
            {
              title: "Transaction status",
              items: ["current_stage", "deal_status", "target_company", "expected_ticker", "deal_value", "announced_date"],
            },
            {
              title: "SPAC economics",
              items: ["redemption_rate", "trust_cash_before", "trust_cash_after", "redemption_price", "public_shares_remaining", "min_cash_condition"],
            },
            { title: "Watch next", items: ["closing_date", "ticker_change_date", "risk_flags", "watch_next", "event_history"] },
          ],
        },
        {
          mode: "generic / routine boundary",
          purpose: "Routine, weak, POS AM, Rule 462(b), or unclear registration where full offering UI is not justified.",
          groups: [
            {
              title: "Filing facts",
              items: ["filing_variant", "boundary_case", "post_effective_purpose", "rule_462b", "no_additional_securities_registered"],
            },
            {
              title: "Amendment facts",
              items: ["is_amendment", "amendment_number", "stated_material_change", "routine_or_administrative", "parent_context_provided"],
            },
            { title: "Display data", items: ["signals", "deterministic", "source_inventory"] },
          ],
        },
      ],
    };
  }

  if (roomKey === "other") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic fallback only", "no specialized display payload", "no dedicated router/display schema"],
        },
        {
          title: "2. Fetch plan",
          items: ["room: other", "forms: OTHER", "defaultAttachmentLimit: 4", "preserve primary filing text"],
        },
        {
          title: "3. Promotion rule",
          items: ["If a recurring form becomes important, move it into its own form room", "Do not expand Other indefinitely"],
        },
      ],
      detailModes: [
        {
          mode: "generic fallback collection",
          purpose: "Catch unmapped SEC forms while preserving enough source text to debug whether a new form room is needed.",
          groups: [
            {
              title: "Primary text",
              items: ["primary filing text", "cleaned source text", "basic SEC metadata", "accession / form / issuer"],
            },
            {
              title: "High-signal attachments",
              items: ["EX-99", "EX-10", "EX-2", "max 3 matching documents"],
            },
            {
              title: "Guardrails",
              items: [
                "Do not infer a specialized event type from Other alone",
                "Do not create custom UI labels inside Other",
                "Use Other to identify missing form coverage",
              ],
            },
          ],
        },
        {
          mode: "room promotion candidate",
          purpose: "Repeated high-value Other filings should be split into a real form-family room with its own parser, prompt, and display labels.",
          groups: [
            {
              title: "Promotion signals",
              items: ["recurring form type", "repeat investor impact", "repeat exhibit pattern", "manual review keeps finding the same structure"],
            },
            {
              title: "New-room requirements",
              items: ["form list", "source block extraction", "LLM prompt", "display mode labels", "sample filings", "regression tests"],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "effect") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special"],
        },
        {
          title: "2. Deterministic route",
          items: ["No analysis LLM by default", "Classify from EFFECT XML/header", "Link to original registration analysis when available"],
        },
        {
          title: "3. Related form families",
          items: ["S-1 / F-1 IPO or dilution", "S-3 / F-3 shelf or resale", "S-4 / F-4 strategic transaction", "POS AM", "N-series / unclear archive"],
        },
      ],
      detailModes: [
        {
          mode: "generic effectiveness notice",
          purpose: "Default EFFECT page showing the effectiveness notice and the linked original registration context.",
          groups: [
            {
              title: "Display payload",
              items: ["effective_filing_form", "ipo_kind", "effective_registration_reference", "effective_date", "original_filing_reference"],
            },
            {
              title: "Evidence labels",
              items: ["effective_filing_form", "effective_date", "effective_time", "registration_number", "effective_filer"],
            },
            {
              title: "Original filing context",
              items: ["parentEventType", "parentEventTitle", "parentAccessionNumber", "parentRegistrationNumber", "originalAnalysisReference"],
            },
          ],
        },
        {
          mode: "S-1 / F-1 effectiveness",
          purpose: "S-1/F-1 registration statement became effective; impact depends on original IPO or registration analysis.",
          groups: [
            { title: "Route", items: ["ipo_listing when parent context supports IPO", "dilution_risk for registration/dilution context"] },
            { title: "Watch labels", items: ["Original registration filing terms", "IPO pricing / final prospectus", "Any 424B or prospectus supplement"] },
            { title: "Display labels", items: ["Effective date", "Registration number", "Original filing analysis", "Ticker / exchange when source-backed"] },
          ],
        },
        {
          mode: "S-3 / F-3 / shelf effectiveness",
          purpose: "Shelf, resale, or offering registration became effective; EFFECT itself should not invent offering terms.",
          groups: [
            { title: "Route", items: ["dilution_risk", "usually feed or archive unless parent context is stronger"] },
            { title: "Watch labels", items: ["Original registration filing terms", "Prospectus supplement", "424B takedown", "Resale or warrant exercise activity"] },
            { title: "Guardrails", items: ["Do not calculate dilution from EFFECT alone", "Use original S-3/F-3 analysis for securities and holder economics"] },
          ],
        },
        {
          mode: "S-4 / F-4 effectiveness",
          purpose: "Merger, exchange, acquisition, or strategic registration cleared SEC effectiveness step.",
          groups: [
            { title: "Route", items: ["strategic_transaction"] },
            { title: "Watch labels", items: ["Transaction closing conditions", "Shareholder vote timing", "Exchange ratio / consideration", "Ticker or listing changes"] },
            { title: "Display labels", items: ["Effective date", "Registration number", "Target / acquirer from original filing", "Original filing analysis"] },
          ],
        },
        {
          mode: "unclear / fund / administrative effectiveness",
          purpose: "EFFECT notice lacks enough operating-company investor context or points to fund/series contracts.",
          groups: [
            { title: "Route", items: ["other", "archive", "needs_human_review when target is unclear"] },
            { title: "Parser facts", items: ["hasMultipleFilers", "hasSeriesClassContractData", "effectiveTargetClear", "targetAmbiguityWarnings"] },
            { title: "Display notes", items: ["Multiple filer/file-number pairs preserved", "Series/class/contract data preserved", "Integration should supply parent context"] },
          ],
        },
      ],
    };
  }

  if (roomKey === "proxy") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"],
        },
        {
          title: "2. Display versions",
          items: [
            "proxy_generic_v1",
            "proxy_ipo_listing_v1",
            "proxy_equity_plan_vote_v1",
            "proxy_transaction_vote_v1",
            "proxy_capital_structure_vote_v1",
            "proxy_governance_vote_v1",
            "proxy_spac_transaction_status_v1",
          ],
        },
        {
          title: "3. Router event choices",
          items: ["shareholder_vote", "dilution_risk", "strategic_transaction", "listing_risk", "leadership_governance", "legal_risk", "insider_ownership", "ipo_listing", "other"],
        },
      ],
      detailModes: [
        {
          mode: "proxy_generic_v1",
          purpose: "Routine annual proxy, ordinary shareholder vote, notice-only material, or weak proxy signal.",
          groups: [
            {
              title: "Base data",
              items: ["company_name", "sec_form_type", "proxy_type", "proposal_count", "meeting_date", "record_date", "proposals", "warnings"],
            },
            {
              title: "Proposal labels",
              items: ["Proposal id", "Proposal title", "Category", "Board recommendation", "Shareholder proposal"],
            },
            {
              title: "Routine archive labels",
              items: ["Director election", "Auditor ratification", "Say-on-pay", "Routine annual meeting", "Vote reminder", "Notice-only material"],
            },
          ],
        },
        {
          mode: "proxy_equity_plan_vote_v1",
          purpose: "Equity incentive plan vote, share reserve increase, new plan benefits, or equity compensation table.",
          groups: [
            {
              title: "Display payload",
              items: ["shares_requested", "percent_of_outstanding", "proposal_ids", "key_tables"],
            },
            {
              title: "Investor-facing labels",
              items: ["Plan shares requested", "Share reserve increase", "Plan shares / outstanding", "Proposal id", "Board recommendation"],
            },
            {
              title: "Table labels",
              items: ["Equity compensation plan information", "New plan benefits", "Proposal-linked table", "Sample rows", "Warnings"],
            },
          ],
        },
        {
          mode: "proxy_transaction_vote_v1",
          purpose: "Merger, acquisition, sale, exchange, business-combination, or other transaction vote.",
          groups: [
            {
              title: "Display payload",
              items: ["consideration", "vote_required", "proposal_ids", "agreement_date", "merger_parties", "appraisal_rights_mentioned", "delisting_mentioned"],
            },
            {
              title: "Investor-facing labels",
              items: ["Consideration", "Vote required", "Agreement date", "Merger parties", "Appraisal rights", "Delisting"],
            },
            {
              title: "Router labels",
              items: ["strategic_transaction", "Preliminary merger proxy", "Transaction vote", "Adjournment proposal", "Closing conditions"],
            },
          ],
        },
        {
          mode: "proxy_capital_structure_vote_v1",
          purpose: "Reverse split, authorized-share increase, charter amendment, bylaw amendment, or listing-compliance vote.",
          groups: [
            {
              title: "Display payload",
              items: ["reverse_split", "dilution", "capital_structure_proposals"],
            },
            {
              title: "Investor-facing labels",
              items: ["Reverse split ratio", "Authorized share increase", "Certificate amendment", "Listing compliance", "Minimum bid"],
            },
            {
              title: "Router labels",
              items: ["dilution_risk", "listing_risk", "Share authorization", "Capital structure proposal", "Board recommendation"],
            },
          ],
        },
        {
          mode: "proxy_governance_vote_v1",
          purpose: "Contested solicitation, governance proposal, shareholder proposal, supplement, or proxy amendment.",
          groups: [
            {
              title: "Display payload",
              items: ["contested", "supplement", "supplemental_analysis", "shareholder_or_governance_proposals"],
            },
            {
              title: "Supplement labels",
              items: ["material_type", "parent_references", "change_signals", "reconciliation", "parent proxy context"],
            },
            {
              title: "Governance labels",
              items: ["Contested solicitation", "Third-party proxy card", "Director nominee withdrawal", "Shareholder proposal", "Board against", "Legal/regulatory proposal"],
            },
          ],
        },
        {
          mode: "proxy_spac_transaction_status_v1",
          purpose: "SPAC/de-SPAC business-combination status, redemption, minimum cash, closing condition, or ticker-change proxy.",
          groups: [
            {
              title: "Display payload",
              items: ["spac_transaction_kind", "redemption_mentioned", "trust_account_mentioned", "minimum_cash_condition_mentioned", "closing_condition_mentioned", "ticker_change_mentioned", "vote_required", "proposal_ids"],
            },
            {
              title: "SPAC status labels",
              items: ["business_combination_status", "redemption_result", "minimum_cash_condition", "ticker_change", "closing_condition", "closing_update"],
            },
            {
              title: "Investor-facing labels",
              items: ["Redemption", "Trust account", "Minimum cash", "Closing condition", "Ticker change", "Vote required"],
            },
          ],
        },
        {
          mode: "proxy_ipo_listing_v1",
          purpose: "Proxy/router path for an IPO or listing-related proxy signal; IPO kind stays metadata, not a separate event type.",
          groups: [
            { title: "Display payload", items: ["ipo_kind", "listing_evidence"] },
            { title: "Labels", items: ["traditional", "spac", "IPO listing", "Direct listing", "First trading / listing date"] },
            { title: "Guardrails", items: ["Do not use for ordinary resale", "Do not use for shelf/ATM/offering dilution", "Do not use for post-closing SPAC updates"] },
          ],
        },
      ],
    };
  }

  if (roomKey === "s3-f3") {
    return {
      overview: [
        { title: "1. UI", items: ["offering_terms"] },
        {
          title: "2. Detail UI choices",
          items: [
            "shelf_capacity",
            "resale_registration",
            "atm",
            "primary_offering",
            "registered_direct",
            "warrant_convertible",
            "mixed_offering",
            "rights_offering",
            "generic",
          ],
        },
      ],
      detailModes: [
        {
          mode: "shelf_capacity",
          purpose: "Base shelf or universal shelf with no active sale terms.",
          groups: [
            { title: "Snapshot", items: ["Shelf capacity", "Public float", "Capacity vs market cap", "Sale status"] },
            { title: "Offering Details", items: ["Offering Type", "Active Sale Terms", "Securities Covered", "Use of Proceeds"] },
            { title: "What To Watch", items: ["Prospectus supplement or takedown", "Price / shares / investors", "Underwriter or sale method"] },
          ],
        },
        {
          mode: "resale_registration",
          purpose: "Selling holder resale pool, including shares issued or issuable from prior financing.",
          groups: [
            { title: "Snapshot", items: ["Resale shares", "Overhang vs outstanding", "Company proceeds", "Selling holders", "Source instrument"] },
            { title: "Share Overhang", items: ["Current shares", "Resale shares", "Common warrants", "Convertible notes", "Convertible preferred"] },
            { title: "Offering Details", items: ["Selling Holders", "Agreement Date", "Sale Price", "Resale Method", "Source Instrument", "Registration Obligation"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "atm",
          purpose: "At-the-market program or embedded ATM supplement.",
          groups: [
            { title: "Snapshot", items: ["Program size", "Public float or market cap basis", "Size vs basis", "Sale method"] },
            { title: "ATM Program", items: ["Public float or market cap", "ATM capacity", "ATM capacity scale"] },
            { title: "Offering Details", items: ["Sales Agent", "Fee / Commission", "Agreement Date", "End Date", "Use of Proceeds"] },
          ],
        },
        {
          mode: "primary_offering",
          purpose: "Priced primary or underwritten takedown where the company sells new securities.",
          groups: [
            { title: "Snapshot", items: ["New shares", "Offer price", "Company proceeds", "Dilution vs outstanding"] },
            { title: "Offering Details", items: ["Offering Type", "Underwriter", "Closing Date", "Agreement Date", "Use of Proceeds", "Source Instrument"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "registered_direct",
          purpose: "Registered direct, PIPE-style takedown, or named investor primary sale.",
          groups: [
            { title: "Snapshot", items: ["New shares", "Offer price", "Company proceeds", "Dilution vs outstanding"] },
            { title: "Offering Details", items: ["Purchaser / Investor", "Placement Agent / Underwriter", "Closing Date", "Agreement Date", "Use of Proceeds", "Source Instrument"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "warrant_convertible",
          purpose: "Warrant, convertible note, convertible preferred, or similar share-equivalent exposure.",
          groups: [
            { title: "Snapshot", items: ["Underlying shares", "Exercise / Conversion Price", "Company proceeds", "Dilution vs outstanding or Variable"] },
            { title: "Share Overhang", items: ["Current shares", "Common warrants", "Pre-funded warrants", "Convertible notes", "Convertible preferred"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "mixed_offering",
          purpose: "Multiple active components such as primary, resale, warrants, ATM, or convertibles in one filing.",
          groups: [
            { title: "Snapshot", items: ["Primary component", "Resale component", "Warrant / convertible component", "Main risk"] },
            { title: "Share Overhang", items: ["Current shares", "Primary shares", "Resale shares", "Common warrants", "Convertible notes", "Pre-funded warrants"] },
            { title: "Offering Details", items: ["Offering Type", "Component Summary", "Purchaser / Selling Holders", "Source Instrument", "Use of Proceeds"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "rights_offering",
          purpose: "Subscription rights or rights offering terms.",
          groups: [
            { title: "Snapshot", items: ["Rights / shares offered", "Subscription price", "Company proceeds", "Record date"] },
            { title: "Offering Details", items: ["Record Date", "Subscription Period", "Oversubscription", "Backstop / Dealer Manager", "Use of Proceeds"] },
          ],
        },
        {
          mode: "S-3/A amendment layer",
          purpose: "Amendment-only layer shown when the filing is S-3/A or F-3/A.",
          groups: [
            {
              title: "What Changed",
              items: [
                "Prospectus date",
                "Share-count basis",
                "Reference prices",
                "Registered shares",
                "Offering size",
                "Selling holders",
                "Securities covered",
                "Exercise price",
                "Conversion terms",
                "Sale price",
                "Resale method",
                "Agreement date",
                "Effective date",
                "Registration obligation",
                "Use of proceeds",
                "Company proceeds",
                "Plan of distribution",
                "Risk factors",
                "Fee table",
                "Incorporated documents",
                "Expert consents",
                "Legal opinion",
                "Exhibit status",
              ],
            },
          ],
        },
      ],
    };
  }

  if (roomKey === "424b") {
    return {
      overview: [
        {
          title: "1. UI",
          items: ["offering_terms", "generic", "spac_transaction_status"],
        },
        {
          title: "2. Detail UI choices",
          items: [
            "shelf_capacity",
            "resale_registration",
            "atm",
            "primary_offering",
            "registered_direct",
            "warrant_convertible",
            "mixed_offering",
            "rights_offering",
            "ipo_pricing",
            "spac_ipo",
            "generic",
          ],
        },
      ],
      detailModes: [
        {
          mode: "shelf_capacity",
          purpose: "Base shelf or universal shelf with no active takedown terms.",
          groups: [
            { title: "Snapshot", items: ["Shelf capacity", "Market cap or public float", "Capacity vs basis", "Sale status"] },
            { title: "Shelf Details", items: ["Offering Type", "Shelf Capacity", "Sale Limitation", "Securities Covered", "Active Sale Terms", "Use of Proceeds"] },
            { title: "What To Watch", items: ["Prospectus supplement", "Takedown terms", "Price / shares / agents"] },
          ],
        },
        {
          mode: "resale_registration",
          purpose: "Selling holder resale pool, including shares issued or issuable from prior financing.",
          groups: [
            { title: "Snapshot", items: ["Resale shares", "Overhang vs outstanding", "Company proceeds", "Selling holders", "Source instrument"] },
            { title: "Share Overhang", items: ["Current shares", "Resale shares", "Common warrants", "Convertible notes", "Convertible preferred"] },
            { title: "Offering Details", items: ["Selling Holders", "Agreement Date", "Sale Price", "Resale Method", "Source Instrument", "Instrument Terms", "Registration Obligation"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "atm",
          purpose: "At-the-market program or ATM prospectus supplement.",
          groups: [
            { title: "Snapshot", items: ["Program size", "Market cap or public float", "Size vs basis", "Sale method"] },
            { title: "Share Overhang", items: ["Current shares", "ATM shares when source-backed", "Shelf capacity as future capacity"] },
            { title: "Offering Details", items: ["Sales Agent", "Fee / Commission", "Agreement Date", "End Date", "Sale Limitation", "Use of Proceeds"] },
          ],
        },
        {
          mode: "primary_offering",
          purpose: "Priced primary or underwritten offering where the company sells new securities.",
          groups: [
            { title: "Snapshot", items: ["New shares", "Offer price", "Company proceeds", "Dilution vs outstanding"] },
            { title: "Share Overhang", items: ["Current shares", "New shares", "Pre-funded warrants", "Common warrants when counted"] },
            { title: "Offering Details", items: ["Offering Type", "Underwriter", "Closing Date", "Agreement Date", "Use of Proceeds", "Warrant Terms"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "registered_direct",
          purpose: "Registered direct, PIPE-style takedown, or named investor primary sale.",
          groups: [
            { title: "Snapshot", items: ["New shares", "Offer price", "Company proceeds", "Dilution vs outstanding"] },
            { title: "Share Overhang", items: ["Current shares", "Common shares", "Pre-funded warrants", "Common warrants"] },
            { title: "Offering Details", items: ["Purchaser / Investor", "Placement Agent", "Closing Date", "Agreement Date", "Use of Proceeds", "Warrant Terms"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "warrant_convertible",
          purpose: "Warrant, convertible note, convertible preferred, right, or similar share-linked exposure.",
          groups: [
            { title: "Snapshot", items: ["Underlying shares", "Exercise / conversion price", "Company proceeds", "Dilution vs outstanding or Variable"] },
            { title: "Share Overhang", items: ["Current shares", "Common warrants", "Pre-funded warrants", "Convertible notes", "Convertible preferred"] },
            { title: "Offering Details", items: ["Offering Type", "Purchaser / Investor", "Placement Agent", "Closing Date", "Agreement Date", "Use of Proceeds"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "mixed_offering",
          purpose: "Multiple material components such as primary, resale, ATM, shelf, warrants, or convertibles in one filing.",
          groups: [
            { title: "Snapshot", items: ["Primary component", "Resale component", "Warrant component", "Company proceeds", "Shelf capacity"] },
            { title: "Share Overhang", items: ["Current shares", "Counted rows", "Conditional rows", "Shelf capacity as future capacity"] },
            { title: "Offering Details", items: ["Offering Type", "Main Components", "Purchaser / Selling Holders", "Sale Limitation", "Warrant Terms", "Use of Proceeds"] },
            { title: "Instrument Details", items: ["Type", "Shares / Securities", "Exercise / Conversion Price", "Reset / Floor", "Term / Limits"] },
          ],
        },
        {
          mode: "rights_offering",
          purpose: "Subscription rights or rights offering terms.",
          groups: [
            { title: "Snapshot", items: ["Rights / shares offered", "Subscription price", "Expiration", "Company proceeds"] },
            { title: "Offering Details", items: ["Record Date", "Subscription Period", "Oversubscription", "Backstop / Dealer Manager", "Use of Proceeds"] },
          ],
        },
        {
          mode: "ipo_pricing / spac_ipo",
          purpose: "Final IPO or SPAC IPO pricing prospectus.",
          groups: [
            { title: "Snapshot", items: ["Offering size", "Price", "Shares / units", "Expected proceeds"] },
            { title: "Offering Details", items: ["Offering Type", "Underwriter", "Closing Date", "Use of Proceeds"] },
            { title: "What To Watch", items: ["First trading", "Exercise / redemption mechanics", "Lock-up or stabilization terms"] },
          ],
        },
      ],
    };
  }

  return null;
}

function buildAccessionCopyText(
  run: SecDevRoomDetail["liveRuns"][number],
  items: Record<string, unknown>[],
  formFilter: string,
) {
  const rows = items
    .map((item, index) => {
      const accession = clientString(item.accession_number);
      if (!accession) return "";
      const formType = clientString(item.form_type) || "unknown";
      const title = clientString(item.title) || "-";
      const updated = clientString(item.updated);
      return `${index + 1}. ${accession} - ${formType}${updated ? ` - ${updated.slice(0, 10)}` : ""} - ${title}`;
    })
    .filter(Boolean);

  if (!rows.length) return "";

  return [
    `${formatLiveRunMode(run.mode)} - ${run.formTypes.join(", ")}`,
    formFilter === "all" ? `Items: ${rows.length}` : `Items: ${rows.length} (${formFilter})`,
    "No DB writes. No alerts. Use these for parser/router validation.",
    "",
    "Accessions:",
    ...rows,
  ].join("\n");
}

function buildExcludedCopyText(
  run: SecDevRoomDetail["liveRuns"][number],
  items: Record<string, unknown>[],
  formFilter: string,
) {
  const rows = items
    .map((item, index) => {
      const accession = clientString(item.accession_number);
      const formType = clientString(item.form_type) || "unknown";
      const title = clientString(item.title) || "-";
      const reason = clientString(item.skip_reason) || clientString(item.error) || "-";
      const gate = clientString(item.skip_gate) || "skip";
      const evidence = clientStringArray(item.skip_evidence);
      return [
        `${index + 1}. ${accession || "-"} - ${formType} - ${gate} - ${title}`,
        `   Reason: ${reason}`,
        ...evidence.map((item) => `   Evidence: ${item}`),
      ].join("\n");
    })
    .filter(Boolean);

  if (!rows.length) return "";

  return [
    `${formatLiveRunMode(run.mode)} excluded SEC filings - ${run.formTypes.join(", ")}`,
    formFilter === "all" ? `Excluded items: ${rows.length}` : `Excluded items: ${rows.length} (${formFilter})`,
    "No DB writes. No alerts. Review these for investable-universe gate quality.",
    "",
    ...rows,
  ].join("\n");
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

function PromptPreviewSections({ previews }: { previews: SecDevRoomDetail["promptPreviews"] }) {
  if (!previews.length) return <div className={styles.emptyState}>No prompt preview found for this room.</div>;

  return (
    <div className={styles.previewStack}>
      {previews.map((file) => (
        <section className={styles.previewCard} key={file.file}>
          <div className={styles.previewHeader}>
            <div>
              <strong>{file.file}</strong>
              <p>Prompt body extracted from the TypeScript source.</p>
            </div>
          </div>
          {file.prompts.map((prompt) => (
            <article className={styles.promptPreview} key={`${file.file}-${prompt.name}`}>
              <h3>{prompt.name}</h3>
              <pre>{prompt.text}</pre>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function OutputPreviewSections({
  formFilter,
  liveRuns,
  previews,
}: {
  formFilter: string;
  liveRuns: SecDevRoomDetail["liveRuns"];
  previews: SecDevRoomDetail["outputPreviews"];
}) {
  const visiblePreviews = filterOutputPreviewsByForm(previews, formFilter);
  const liveOutputItems = liveRuns
    .flatMap((run, runIndex) =>
      filterLiveItemsByForm(run.items, formFilter)
        .filter((item) => !isExcludedLiveItem(item))
        .map((item, itemIndex) => ({ item, run, key: `${run.mode}-${run.ranAt}-${runIndex}-${itemIndex}` })),
    )
    .slice(0, 10);

  if (!previews.length && !liveOutputItems.length) {
    return <div className={styles.emptyState}>No expected site output JSON or live/persist output found for this room.</div>;
  }
  if (!visiblePreviews.length && !liveOutputItems.length) {
    return <div className={styles.emptyState}>No {formFilter} site output preview or live/persist output found for this room.</div>;
  }

  return (
    <div className={styles.previewStack}>
      {liveOutputItems.length ? (
        <section className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <div>
              <strong>Latest live / persist output</strong>
              <p>Recent actual development runs and persisted DB filing events for this room.</p>
            </div>
          </div>
          <div className={styles.outputRunList}>
            {liveOutputItems.map(({ item, key, run }, index) => {
              const detailUrl = clientString(item.detail_url);
              const runtimeOutput = readClientRecord(item.runtime_output);
              const displayPayloadDebug = readClientRecord(runtimeOutput?.display_payload_debug);
              const detailUi = clientString(displayPayloadDebug?.display_mode);
              const displayType = clientString(runtimeOutput?.display_type);
              const title = clientString(item.title) || clientString(item.event_id) || clientString(item.accession_number) || "SEC filing output";
              return (
                <details className={styles.outputRunItem} key={key} open={index === 0}>
                  <summary className={styles.outputRunSummary}>
                    <div className={styles.outputRunMain}>
                      <strong>{title}</strong>
                      <p>{[formatLiveRunMode(run.mode), clientString(item.form_type), clientString(item.accession_number)].filter(Boolean).join(" - ")}</p>
                    </div>
                    <div className={styles.outputRunBadges}>
                      <span>{clientString(item.form_type) || "-"}</span>
                      <span>{clientString(item.ticker) || "-"}</span>
                      <span>{clientString(item.score) || "-"}</span>
                      <span>{clientString(item.delivery_level) || "-"}</span>
                      {displayType ? <span>{displayType}</span> : null}
                      {detailUi ? <span>{detailUi}</span> : null}
                      {detailUrl ? (
                        <a href={detailUrl} onClick={(event) => event.stopPropagation()}>
                          Open detail
                        </a>
                      ) : null}
                    </div>
                  </summary>
                  <div className={styles.outputRunBody}>
                    <div className={styles.outputMetaGrid}>
                      <PreviewField label="Form" value={clientString(item.form_type) || "-"} />
                      <PreviewField label="Ticker" value={clientString(item.ticker) || "-"} />
                      <PreviewField label="Event type" value={clientString(item.event_type) || "-"} />
                      <PreviewField label="Score" value={clientString(item.score) || "-"} />
                      <PreviewField label="Delivery" value={clientString(item.delivery_level) || "-"} />
                      <PreviewField label="Ran at" value={formatDate(run.ranAt)} />
                    </div>
                    <RuntimeOutputCard value={item.runtime_output} />
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ) : null}
      {visiblePreviews.map((preview) => (
        <section className={styles.outputPreviewCard} key={preview.file}>
          <div className={styles.previewHeader}>
            <div>
              <strong>{preview.eventTitle}</strong>
              <p>{[preview.formType, preview.file].filter(Boolean).join(" - ")}</p>
            </div>
            <StatusBadge status={preview.score === null ? "not_run" : "pass"} />
          </div>
          <div className={styles.outputMetaGrid}>
            <PreviewField label="Form" value={preview.formType || "-"} />
            <PreviewField label="Ticker" value={preview.ticker} />
            <PreviewField label="Event type" value={preview.eventType} />
            <PreviewField label="Display type" value={preview.displayType} />
            <PreviewField label="Parser route" value={preview.parserRoute} />
            <PreviewField label="Score" value={preview.score === null ? "-" : String(preview.score)} />
            <PreviewField label="Delivery" value={preview.deliveryLevel} />
            <PreviewField label="Signal" value={preview.signal} />
          </div>
          {resolvePreviewFilingSummary(preview) ? (
            <div className={styles.outputTextBlock}>
              <span>Filing summary</span>
              <p>{resolvePreviewFilingSummary(preview)}</p>
            </div>
          ) : null}
          {!preview.isParserCompletedArchive && preview.quickTake ? (
            <div className={styles.outputTextBlock}>
              <span>Quick take</span>
              <p>{preview.quickTake}</p>
            </div>
          ) : null}
          {!resolvePreviewFilingSummary(preview) && preview.summary ? (
            <div className={styles.outputTextBlock}>
              <span>Summary</span>
              <p>{preview.summary}</p>
            </div>
          ) : null}
          {preview.scoreReason ? (
            <div className={styles.outputTextBlock}>
              <span>Score reason</span>
              <p>{preview.scoreReason}</p>
            </div>
          ) : null}
          <div className={styles.outputColumns}>
            <PreviewList title="Key evidence" items={preview.keyEvidence} />
            {!preview.isParserCompletedArchive ? <PreviewList title="What to watch next" items={preview.whatToWatchNext} /> : null}
            <PreviewList title="Parser signals" items={preview.parserSignals} />
            <PreviewList title="Integration notes" items={preview.integrationNotes} />
          </div>
          {preview.displayData.length ? (
            <div className={styles.displayDataGrid}>
              {preview.displayData.map((field) => (
                <PreviewField key={field.label} label={field.label} value={field.value} />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.previewField}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function resolvePreviewFilingSummary(preview: SecDevRoomDetail["outputPreviews"][number]) {
  return preview.filingSummary || (preview.isParserCompletedArchive ? preview.summary : "");
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.previewList}>
      <span>{title}</span>
      {items.length ? (
        <ol>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <p>-</p>
      )}
    </div>
  );
}

function FileSections({ files }: { files: SecDevRoomDetail["files"] }) {
  const visibleFiles = files.filter((file) => file.exists);
  if (!visibleFiles.length) return <div className={styles.emptyState}>No files found for this section.</div>;

  return (
    <div className={styles.fileStack}>
      {visibleFiles.map((file) => (
        <section className={styles.fileCard} key={file.path}>
          <div className={styles.fileHeader}>
            <div>
              <strong>{file.name}</strong>
              <p>{file.path}</p>
            </div>
            {file.truncated ? <span className={styles.truncated}>truncated</span> : null}
          </div>
          <pre className={styles.codeBlock}>{file.content}</pre>
        </section>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "pass" | "fail" | "idle" | "neutral";
}) {
  return (
    <article className={`${styles.metricCard} ${styles[tone]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatusBadge({ status }: { status: "pass" | "fail" | "not_run" }) {
  const label = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NOT RUN";
  return <span className={`${styles.statusBadge} ${styles[status]}`}>{label}</span>;
}

function roomFromDetail(detail: SecDevRoomDetail): SecDevRoomSnapshot {
  return {
    key: detail.key,
    label: detail.label,
    forms: detail.forms,
    folder: detail.folder,
    adapterKey: detail.adapterKey,
    testFiles: detail.testFiles,
    status: detail.status,
    passCount: detail.passCount,
    failCount: detail.failCount,
    notRunCount: detail.notRunCount,
    lastRunAt: detail.lastRunAt,
  };
}

function isTabKey(value: string): value is TabKey {
  return ["overview", "parser", "prompt", "outputs", "results", "tests", "live", "issues", "excluded"].includes(value);
}

function formatLiveRunMode(mode: string) {
  if (mode === "live_dry_run") return "Live SEC dry-run";
  if (mode === "latest_analysis_dry_run") return "Latest analysis dry-run";
  if (mode === "accession_samples") return "Accession samples";
  if (mode === "accession_dry_run") return "Accession dry-run";
  if (mode === "controlled_persist") return "Controlled persist";
  if (mode === "reset_analysis") return "Delete existing analysis";
  if (mode === "recent_persisted") return "Recent persisted event";
  return mode;
}

function filterLiveItemsByForm(items: Array<Record<string, unknown>>, formFilter: string) {
  if (formFilter === "all") return items;
  const normalizedFilter = normalizeClientFormType(formFilter);
  return items.filter((item) => normalizeClientFormType(clientString(item.form_type)) === normalizedFilter);
}

function isExcludedLiveItem(item: Record<string, unknown>) {
  return item.is_excluded === true || Boolean(clientString(item.skip_gate)) || clientString(item.analysis_action) === "skip_analysis";
}

function filterOutputPreviewsByForm(previews: SecDevRoomDetail["outputPreviews"], formFilter: string) {
  if (formFilter === "all") return previews;
  const normalizedFilter = normalizeClientFormType(formFilter);
  return previews.filter((preview) => normalizeClientFormType(preview.formType) === normalizedFilter);
}

function normalizeClientFormType(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function clampLiveSampleCount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function formatParentContextSummary(value: unknown) {
  const context = readClientRecord(value);
  if (!context) return "";
  const parts = [
    clientString(context.status),
    clientString(context.parent_accession),
    clientString(context.match_method),
    context.registration_number_match === true ? "registration match" : "",
    context.comparison_allowed === false ? "comparison blocked" : "",
  ].filter(Boolean);
  return parts.join(" / ");
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

function clientDisplayData(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readClientRecord(item);
      if (!record) return "";
      const label = clientString(record.label);
      const fieldValue = clientString(record.value);
      return label ? `${label}: ${fieldValue || "-"}` : fieldValue;
    })
    .filter(Boolean);
}
