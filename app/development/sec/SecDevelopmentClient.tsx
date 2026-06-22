"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./sec-development.module.css";
import type { SecDevRoomDetail, SecDevRoomSnapshot } from "@/lib/development/secFormDevDashboard";

type TabKey = "overview" | "parser" | "prompt" | "outputs" | "results" | "tests" | "live" | "excluded";

export function SecDevelopmentClient({ initialRooms }: { initialRooms: SecDevRoomSnapshot[] }) {
  const [rooms, setRooms] = useState(initialRooms);
  const [selectedRoom, setSelectedRoom] = useState(initialRooms[0]?.key || "");
  const [detail, setDetail] = useState<SecDevRoomDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningLive, setRunningLive] = useState(false);
  const [runningLatestAnalysis, setRunningLatestAnalysis] = useState(false);
  const [collectingSamples, setCollectingSamples] = useState(false);
  const [runningAccessionDryRun, setRunningAccessionDryRun] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [accessionNumber, setAccessionNumber] = useState("");
  const [dryRunAccession, setDryRunAccession] = useState("");
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
  const liveSampleCountNumber = clampLiveSampleCount(liveSampleCount);
  const selectedRunFormCount = Math.max(1, selectedRunForms.length);
  const selectedRunLabel = liveFormFilter === "all" ? "all forms " : `${liveFormFilter} `;
  const selectedRunCountLabel = liveFormFilter === "all" ? `${liveSampleCountNumber}/form` : String(liveSampleCountNumber);

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
          attachmentLimit: 6,
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
            <button className={styles.primaryButton} disabled={running || loading || !selectedRoom} onClick={runTests} type="button">
              {running ? "Running..." : "Run room tests"}
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
          <label>
            <span>Controlled persist accession</span>
            <input
              onChange={(event) => setAccessionNumber(event.target.value)}
              placeholder="0000000000-00-000000"
              value={accessionNumber}
            />
          </label>
          <button
            className={styles.dangerButton}
            disabled={persisting || loading || !accessionNumber.trim()}
            onClick={runControlledPersist}
            type="button"
          >
            {persisting ? "Persisting..." : "Persist one, alerts off"}
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
    return <OutputPreviewSections formFilter={liveFormFilter} previews={detail.outputPreviews} />;
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
  const parentFilingContext = readClientRecord(output.parent_filing_context);

  return (
    <div className={styles.runtimeOutputCard}>
      <div className={styles.runtimeOutputHeader}>
        <strong>Runtime Output</strong>
        <span>actual dry-run result</span>
      </div>
      <div className={styles.outputMetaGrid}>
        <PreviewField label="Ticker" value={clientString(output.ticker)} />
        <PreviewField label="Event type" value={clientString(output.event_type)} />
        <PreviewField label="Display type" value={clientString(output.display_type)} />
        <PreviewField label="Parser route" value={clientString(output.parser_route)} />
        <PreviewField label="Score" value={clientString(output.score)} />
        <PreviewField label="Delivery" value={clientString(output.delivery_level)} />
        <PreviewField label="Signal" value={clientString(output.signal)} />
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
      {transactionFingerprint ? (
        <div className={styles.outputTextBlock}>
          <span>Transaction fingerprint</span>
          <pre>{JSON.stringify(transactionFingerprint, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
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
  previews,
}: {
  formFilter: string;
  previews: SecDevRoomDetail["outputPreviews"];
}) {
  const visiblePreviews = filterOutputPreviewsByForm(previews, formFilter);
  if (!previews.length) return <div className={styles.emptyState}>No expected site output JSON found for this room.</div>;
  if (!visiblePreviews.length) return <div className={styles.emptyState}>No {formFilter} site output preview found for this room.</div>;

  return (
    <div className={styles.previewStack}>
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

function formatLiveRunMode(mode: string) {
  if (mode === "live_dry_run") return "Live SEC dry-run";
  if (mode === "latest_analysis_dry_run") return "Latest analysis dry-run";
  if (mode === "accession_samples") return "Accession samples";
  if (mode === "accession_dry_run") return "Accession dry-run";
  if (mode === "controlled_persist") return "Controlled persist";
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
