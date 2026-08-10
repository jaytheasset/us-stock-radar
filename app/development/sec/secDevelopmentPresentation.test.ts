import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("periodic-report debug room documents the preview and analysis copy contract", () => {
  const source = readFileSync(
    new URL("./SecDevelopmentClient.tsx", import.meta.url),
    "utf8",
  );
  const periodicRoom = source.slice(
    source.indexOf('if (roomKey === "periodic-reports")'),
    source.indexOf('if (roomKey === "424b")'),
  );

  assert.match(
    periodicRoom,
    /Applies to 10-K \/ 10-Q \/ 20-F and 10-K\/A \/ 10-Q\/A \/ 20-F\/A/,
  );
  assert.match(
    periodicRoom,
    /Filing Brief = primary material_events\.event_summary, then first material_events\.event_summary, then analysis_output\.quick_take, then analysis_output\.summary/,
  );
  assert.match(
    periodicRoom,
    /Key Points = event_analysis\.key_evidence \(max 3\)/,
  );
  assert.match(
    periodicRoom,
    /material_events\.event_summary is not required for periodic-report previews/,
  );
  assert.match(
    periodicRoom,
    /Analysis page primary copy normally uses analysis_output\.why_it_matters; analysis_output\.summary is shown separately/,
  );
  assert.match(
    periodicRoom,
    /analysis_output\.quick_take is primarily preview, feed, and alert copy/,
  );
});

test("SEC analysis review separates saved results from execution controls", () => {
  const client = readFileSync(
    new URL("./SecDevelopmentClient.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./sec-development.module.css", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../../../lib/development/secFormDevDashboard.ts", import.meta.url),
    "utf8",
  );

  assert.match(client, /Recent analysis results/);
  assert.match(client, /Accession, event ID, ticker, company, or CIK/);
  assert.match(client, /Find exact saved result/);
  assert.match(client, /view: "detail"/);
  assert.match(client, /key: "eventId" \| "accession"/);
  assert.match(client, /No recent match\. Use the exact persisted lookup/);
  assert.doesNotMatch(client, /No actual analysis result matches/);
  assert.match(client, /First analysis result/);
  assert.match(client, /Validation errors/);
  assert.match(client, /Correction execution and basis/);
  assert.match(client, /Before \/ after correction/);
  assert.match(client, /Collection &amp; data lineage/);
  assert.match(client, /Named data sources/);
  assert.match(client, /detail\.diagnosticSnapshot/);
  assert.match(client, /activeSnapshot\.summary\.status === "read_failed"/);
  assert.match(client, /formatDiagnosticSummaryStatus\(activeSnapshot\.summary\.status\)/);
  assert.match(client, /exact \$\{visibleResults\.length === 1 \? "match" : "matches"\}/);
  assert.match(client, /detail\.liveRuns\.filter\(\(run\) => run\.mode !== "recent_persisted"\)/);
  assert.match(client, /Current saved record/);
  assert.match(client, /Check current saved record/);
  assert.match(client, /getSecExactPersistedRecordStatus/);
  assert.match(client, /executionHistoryExactFilter/);
  assert.match(client, /The execution result was recorded at run time; no current persisted record was found/);
  assert.match(client, /Dry run \/ sample inspection/);
  assert.match(client, /Controlled persist/);
  assert.match(client, /기록 없음/);

  assert.match(dashboard, /company_name: readPersistedEventCompanyName\(row\)/);
  assert.match(dashboard, /cik: readPersistedEventCik\(row\)/);
  assert.match(dashboard, /filed_at: readPersistedEventFiledAt\(row\)/);
  assert.match(dashboard, /analyzed_at:/);
  assert.match(dashboard, /analysis_status:/);
  assert.match(dashboard, /readRecentPersistenceContextMap/);
  assert.match(dashboard, /buildRoomDiagnosticSnapshot/);
  assert.equal((dashboard.match(/readPersistedRoomResults\(room,/g) || []).length, 2);
  assert.match(dashboard, /buildRoomDiagnosticSnapshot\(room, persistedRead\.runs/);
  assert.match(dashboard, /readSecPersistenceContextMap\(rawItemIds, supabaseSelect\)/);
  assert.match(dashboard, /source_read_statuses: lineageReadStatuses/);

  assert.match(styles, /@media \(max-width: 1280px\) and \(min-width: 981px\)/);
  assert.match(styles, /html\[data-theme="dark"\]/);
  assert.match(styles, /\.analysisReviewWorkspace/);

  const historyCard = client.slice(
    client.indexOf("function LiveRunCard"),
    client.indexOf("function ValidationRepairTraceCard"),
  );
  assert.doesNotMatch(historyCard, /href=\{item\.detail_url\}/);
  assert.match(historyCard, /Open confirmed current detail/);
});
