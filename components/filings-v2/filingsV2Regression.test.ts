import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveFilingPreviewFields } from "../../lib/filingPreviewContract.ts";
import {
  createLiveFeedV2Preview,
  type LiveFeedV2PreviewSource,
} from "../../lib/liveFeedV2Preview.ts";
import { resolveFilingsV2LoadState } from "../../lib/filingsV2LoadState.ts";
import { resolveFilingsV2SelectedRecord } from "./filingsV2Selection.ts";

test("public filing filters expose analysis groups on desktop and mobile", () => {
  const desktopFilter = readFileSync(
    new URL("./FilingsV2FilterBar.tsx", import.meta.url),
    "utf8",
  );
  const mobileFilter = readFileSync(
    new URL("./MobileFilingsV2FilterSheet.tsx", import.meta.url),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../../app/api/filings-v2/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(desktopFilter, /label: "Filing Group"/);
  assert.match(desktopFilter, /filingsV2FilingGroupOptions/);
  assert.match(mobileFilter, /label: "Filing group"/);
  assert.match(mobileFilter, /filingsV2FilingGroupOptions/);
  assert.match(workspace, /\["filing_groups", filters\.filingGroups\]/);
  assert.match(route, /"filing_groups"/);
  assert.doesNotMatch(desktopFilter, /Form Type|10-K\/A|8-K\/A/);
  assert.doesNotMatch(mobileFilter, /Form type|10-K\/A|8-K\/A/);
  assert.doesNotMatch(workspace, /form_types|filters\.formTypes/);
});

test("filings and Live Feed previews share the stored CRM brief and key evidence", () => {
  const quickTake =
    "Salesforce announced a definitive agreement to acquire Informatica for approximately $8 billion, subject to closing conditions.";
  const filingBrief =
    "Salesforce, Inc. has entered into a definitive agreement to acquire Informatica Inc. for approximately $8 billion.";
  const materialEvents = [
    {
      event_summary: filingBrief,
      role: "primary",
    },
  ];
  const keyEvidence = [
    "Salesforce and Informatica issued a joint press release announcing a definitive agreement to acquire Informatica.",
    "The transaction is valued at approximately $8 billion in equity value.",
    "The deal is subject to required regulatory clearances and other customary closing conditions.",
  ];
  const filingsPreview = resolveFilingPreviewFields({
    keyEvidence,
    materialEvents,
    quickTake,
  });
  const liveFeedSource: LiveFeedV2PreviewSource = {
    accessionNumber: "0001193125-25-126271",
    category: "Strategic Transaction",
    companyName: "Salesforce, Inc.",
    detailHref: "/filings/6b038d6e-a5a1-4150-ab0e-b41c8e30e1f5",
    feedType: "filings",
    formType: "8-K",
    headline: "Salesforce to Acquire Informatica",
    id: "6b038d6e-a5a1-4150-ab0e-b41c8e30e1f5",
    impactScore: 75,
    keyEvidence,
    keyPointsLabel: filingsPreview.keyPointsLabel,
    primaryTicker: "CRM",
    publishedAt: "2025-05-27T00:00:00.000Z",
    sentiment: "Neutral",
    source: "SEC",
    summary: filingsPreview.filingBrief,
    showKeyPoints: filingsPreview.showKeyPoints,
    ticker: "CRM",
  };
  const liveFeedPreview = createLiveFeedV2Preview(liveFeedSource);

  assert.equal(liveFeedPreview.kind, "filing");
  assert.equal(filingsPreview.filingBrief, filingBrief);
  assert.equal(filingsPreview.filingBrief, liveFeedPreview.filingBrief);
  assert.deepEqual(filingsPreview.keyPoints, liveFeedPreview.keyPoints);
  assert.equal(filingsPreview.keyPointsLabel, liveFeedPreview.keyPointsLabel);
  assert.equal(filingsPreview.showKeyPoints, liveFeedPreview.showKeyPoints);
  assert.equal(filingsPreview.keyPoints.length, 3);
});

test("governance filing previews use up to three unique key-change titles on both surfaces", () => {
  const displayPayload = {
    display_type: "governance_event",
    data: {
      key_changes: [
        { title: "  Director appointed  " },
        { title: "" },
        { title: "Director appointed" },
        { title: "Committee membership changed" },
        { title: "New chair elected" },
        { title: "This fourth unique title is excluded" },
      ],
    },
  };
  const filingsPreview = resolveFilingPreviewFields({
    displayPayload,
    keyEvidence: ["Event-analysis evidence must not be used."],
  });
  const liveFeedPreview = createLiveFeedV2Preview({
    accessionNumber: null,
    category: "Governance",
    companyName: "Example, Inc.",
    detailHref: "/filings/governance-event",
    feedType: "filings",
    formType: "8-K",
    headline: "Board update",
    id: "governance-event",
    impactScore: 50,
    keyEvidence: filingsPreview.keyPoints,
    keyPointsLabel: filingsPreview.keyPointsLabel,
    publishedAt: "2026-08-04T00:00:00.000Z",
    sentiment: "Neutral",
    showKeyPoints: filingsPreview.showKeyPoints,
    source: "SEC",
    summary: filingsPreview.filingBrief,
    ticker: "TEST",
  });

  assert.deepEqual(filingsPreview.keyPoints, [
    "Director appointed",
    "Committee membership changed",
    "New chair elected",
  ]);
  assert.equal(filingsPreview.keyPointsLabel, "Key Changes");
  assert.equal(filingsPreview.showKeyPoints, true);
  assert.equal(liveFeedPreview.kind, "filing");
  assert.deepEqual(liveFeedPreview.keyPoints, filingsPreview.keyPoints);
  assert.equal(liveFeedPreview.keyPointsLabel, filingsPreview.keyPointsLabel);
  assert.equal(liveFeedPreview.showKeyPoints, filingsPreview.showKeyPoints);
});

test("8-K/6-K earnings previews share up to three stored business-update titles in order", () => {
  const filingBrief = "Stored primary earnings event summary.";
  const filingsPreview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "operating_event",
      data: {
        business_catalysts: [
          { summary: "Long body is not preview copy.", title: "Revenue outlook" },
          { title: "Margin outlook", value: "74%" },
          { title: "Capital return" },
          { title: "Fourth item is excluded" },
        ],
        display_version: "sec_8k_6k_operating_event_v1",
        operating_mode: "earnings",
      },
    },
    keyEvidence: ["Generic evidence must not be used for this earnings preview."],
    materialEvents: [
      { event_summary: filingBrief, event_type: "earnings", role: "primary" },
    ],
  });
  const liveFeedPreview = createLiveFeedV2Preview({
    category: "Earnings",
    detailHref: "/filings/earnings-event",
    feedType: "filings",
    headline: "Earnings update",
    id: "earnings-event",
    impactScore: 82,
    keyEvidence: filingsPreview.keyPoints,
    keyPointsLabel: filingsPreview.keyPointsLabel,
    publishedAt: "2026-08-04T00:00:00.000Z",
    sentiment: "Bullish",
    showKeyPoints: filingsPreview.showKeyPoints,
    source: "SEC",
    summary: filingsPreview.filingBrief,
    ticker: "TEST",
  });

  assert.deepEqual(filingsPreview.keyPoints, [
    "Revenue outlook",
    "Margin outlook",
    "Capital return",
  ]);
  assert.equal(filingsPreview.filingBrief, filingBrief);
  assert.equal(filingsPreview.keyPointsLabel, "Key Business Updates");
  assert.equal(filingsPreview.showKeyPoints, true);
  assert.equal(liveFeedPreview.kind, "filing");
  assert.deepEqual(liveFeedPreview.keyPoints, filingsPreview.keyPoints);
  assert.equal(liveFeedPreview.filingBrief, filingBrief);
  assert.equal(liveFeedPreview.keyPointsLabel, "Key Business Updates");
  assert.equal(liveFeedPreview.showKeyPoints, true);
});

test("8-K/6-K earnings previews hide the complete business-update section when titles are absent", () => {
  const filingsPreview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "operating_event",
      data: {
        business_catalysts: [{ summary: "Body without title." }, { title: "  " }],
        display_version: "sec_8k_6k_operating_event_v1",
        operating_mode: "earnings",
      },
    },
    keyEvidence: ["Do not fall back to generic evidence."],
    materialEvents: [
      { event_summary: "Stored earnings brief.", event_type: "earnings", role: "primary" },
    ],
  });
  const liveFeedPreview = createLiveFeedV2Preview({
    category: "Earnings",
    detailHref: "/filings/earnings-without-updates",
    feedType: "filings",
    headline: "Earnings without business updates",
    id: "earnings-without-updates",
    impactScore: 60,
    keyEvidence: filingsPreview.keyPoints,
    keyPointsLabel: filingsPreview.keyPointsLabel,
    publishedAt: "2026-08-04T00:00:00.000Z",
    sentiment: "Neutral",
    showKeyPoints: filingsPreview.showKeyPoints,
    source: "SEC",
    summary: filingsPreview.filingBrief,
    ticker: "TEST",
  });

  assert.deepEqual(filingsPreview.keyPoints, []);
  assert.equal(filingsPreview.keyPointsLabel, "Key Business Updates");
  assert.equal(filingsPreview.showKeyPoints, false);
  assert.equal(liveFeedPreview.kind, "filing");
  assert.deepEqual(liveFeedPreview.keyPoints, []);
  assert.equal(liveFeedPreview.keyPointsLabel, "Key Business Updates");
  assert.equal(liveFeedPreview.showKeyPoints, false);
});

test("GME-style 8-K/6-K ATM capacity maps stored snapshot metrics on both surfaces", () => {
  const filingBrief = "GameStop disclosed additional at-the-market offering capacity.";
  const filingsPreview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "capital_financing",
      data: {
        capital_mode: "atm_capacity",
        display_version: "sec_8k_6k_capital_financing_v1",
        snapshot_metrics: [
          { label: "  ATM capacity  ", value: "  $100 million  " },
          { label: "ATM capacity", value: "$100 million" },
          { label: "Shares sold", value: "12 million" },
          { label: "Average price", value: "$8.25" },
          { label: "Remaining capacity", value: "$25 million" },
          { label: "Excluded fifth metric", value: "Not shown" },
        ],
      },
    },
    keyEvidence: ["Generic evidence must not replace the capital snapshot."],
    materialEvents: [
      { event_summary: filingBrief, event_type: "dilution_risk", role: "primary" },
    ],
  });
  const liveFeedPreview = createLiveFeedV2Preview({
    category: "Dilution",
    detailHref: "/filings/1d877a76-51d9-46eb-a6f4-6971b872b251",
    feedType: "filings",
    headline: "ATM capacity update",
    id: "1d877a76-51d9-46eb-a6f4-6971b872b251",
    impactScore: 80,
    keyEvidence: filingsPreview.keyPoints,
    keyPointsLabel: filingsPreview.keyPointsLabel,
    publishedAt: "2026-08-04T00:00:00.000Z",
    sentiment: "Bearish",
    showKeyPoints: filingsPreview.showKeyPoints,
    source: "SEC",
    summary: filingsPreview.filingBrief,
    ticker: "GME",
  });

  assert.equal(filingsPreview.filingBrief, filingBrief);
  assert.deepEqual(filingsPreview.keyPoints, [
    "ATM capacity: $100 million",
    "Shares sold: 12 million",
    "Average price: $8.25",
    "Remaining capacity: $25 million",
  ]);
  assert.equal(filingsPreview.keyPointsLabel, "Capital Snapshot");
  assert.equal(filingsPreview.showKeyPoints, true);
  assert.equal(liveFeedPreview.kind, "filing");
  assert.deepEqual(liveFeedPreview.keyPoints, filingsPreview.keyPoints);
  assert.equal(liveFeedPreview.filingBrief, filingsPreview.filingBrief);
  assert.equal(liveFeedPreview.keyPointsLabel, filingsPreview.keyPointsLabel);
  assert.equal(liveFeedPreview.showKeyPoints, filingsPreview.showKeyPoints);
});

test("AMC-style 8-K/6-K equity issuance maps valid snapshot rows", () => {
  const preview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "capital_financing",
      data: {
        capital_mode: "equity_issuance",
        display_version: "sec_8k_6k_capital_financing_v1",
        snapshot_metrics: [
          { label: "Shares issued", value: "50 million" },
          { label: "Gross proceeds", value: "$150 million" },
        ],
      },
    },
    keyEvidence: [],
    materialEvents: [
      {
        event_summary: "AMC completed an equity issuance.",
        event_type: "dilution_risk",
        role: "primary",
      },
    ],
  });

  assert.deepEqual(preview.keyPoints, [
    "Shares issued: 50 million",
    "Gross proceeds: $150 million",
  ]);
  assert.equal(preview.keyPointsLabel, "Capital Snapshot");
  assert.equal(preview.showKeyPoints, true);
});

test("capital snapshots hide the complete section when stored rows are empty or invalid", () => {
  for (const snapshotMetrics of [
    [],
    [null, {}, { label: " " }, { value: "$10 million" }, { label: 10, value: 20 }],
  ]) {
    const preview = resolveFilingPreviewFields({
      displayPayload: {
        display_type: "capital_financing",
        data: {
          capital_mode: "share_linked_financing",
          display_version: "sec_8k_6k_capital_financing_v1",
          snapshot_metrics: snapshotMetrics,
        },
      },
      keyEvidence: ["This fallback must stay hidden."],
      materialEvents: [
        { event_summary: "Financing brief.", event_type: "dilution_risk", role: "primary" },
      ],
    });

    assert.deepEqual(preview.keyPoints, []);
    assert.equal(preview.keyPointsLabel, "Capital Snapshot");
    assert.equal(preview.showKeyPoints, false);
  }
});

test("debt liquidity and capital return modes remain outside the dilution snapshot rule", () => {
  for (const capitalMode of ["debt_liquidity", "capital_return"]) {
    const preview = resolveFilingPreviewFields({
      displayPayload: {
        display_type: "capital_financing",
        data: {
          capital_mode: capitalMode,
          display_version: "sec_8k_6k_capital_financing_v1",
          snapshot_metrics: [{ label: "Must not render", value: "$1" }],
        },
      },
      keyEvidence: ["Existing generic point"],
      materialEvents: [
        { event_summary: "Capital brief.", event_type: "dilution_risk", role: "primary" },
      ],
    });

    assert.deepEqual(preview.keyPoints, ["Existing generic point"]);
    assert.equal(preview.keyPointsLabel, "Key Points");
    assert.equal(preview.showKeyPoints, true);
  }
});

test("other filing families and mismatched primary events retain the generic preview", () => {
  for (const input of [
    {
      displayPayload: {
        display_type: "offering_terms",
        data: {
          capital_mode: "equity_issuance",
          display_version: "sec_8k_6k_capital_financing_v1",
          snapshot_metrics: [{ label: "S-3 metric", value: "$25 million" }],
        },
      },
      materialEvents: [
        { event_summary: "S-3 brief.", event_type: "dilution_risk", role: "primary" },
      ],
    },
    {
      displayPayload: {
        display_type: "capital_financing",
        data: {
          capital_mode: "equity_issuance",
          display_version: "sec_8k_6k_capital_financing_v1",
          snapshot_metrics: [{ label: "Secondary dilution", value: "$25 million" }],
        },
      },
      materialEvents: [
        { event_summary: "Operating brief.", event_type: "operating_update", role: "primary" },
        { event_summary: "Dilution detail.", event_type: "dilution_risk", role: "secondary" },
      ],
    },
  ]) {
    const preview = resolveFilingPreviewFields({
      ...input,
      keyEvidence: ["Existing generic point"],
    });

    assert.deepEqual(preview.keyPoints, ["Existing generic point"]);
    assert.equal(preview.keyPointsLabel, "Key Points");
    assert.equal(preview.showKeyPoints, true);
  }
});

test("non-earnings 8-K/6-K operating events retain the generic Key Points contract", () => {
  const preview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "operating_event",
      data: {
        business_catalysts: [{ title: "Must remain detail-only" }],
        display_version: "sec_8k_6k_operating_event_v1",
        operating_mode: "operating_update",
      },
    },
    keyEvidence: ["Existing generic point"],
    materialEvents: [
      { event_summary: "Operating brief.", event_type: "operating_update", role: "primary" },
    ],
  });

  assert.deepEqual(preview.keyPoints, ["Existing generic point"]);
  assert.equal(preview.keyPointsLabel, "Key Points");
  assert.equal(preview.showKeyPoints, true);
});

test("earnings display copy does not override a non-earnings canonical material event", () => {
  const preview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "operating_event",
      data: {
        business_catalysts: [{ title: "Must not leak into the preview" }],
        display_version: "sec_8k_6k_operating_event_v1",
        operating_mode: "earnings",
      },
    },
    keyEvidence: ["Existing non-earnings key point"],
    materialEvents: [
      { event_summary: "Canonical operating brief.", event_type: "operating_update", role: "primary" },
    ],
  });

  assert.deepEqual(preview.keyPoints, ["Existing non-earnings key point"]);
  assert.equal(preview.keyPointsLabel, "Key Points");
  assert.equal(preview.showKeyPoints, true);
});

test("governance previews hide empty key changes without falling back to evidence", () => {
  const preview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "governance_event",
      data: { key_changes: [{ title: "  " }, {}, null] },
    },
    keyEvidence: ["Do not render this fallback."],
  });

  assert.deepEqual(preview.keyPoints, []);
  assert.equal(preview.keyPointsLabel, "Key Changes");
  assert.equal(preview.showKeyPoints, false);
});

test("filings RPC governance identity recovers key changes when display_type is omitted", () => {
  const preview = resolveFilingPreviewFields({
    displayPayload: {
      data: {
        key_changes: [
          { title: "  Chief executive transition  " },
          { title: "Board committee reassignment" },
        ],
      },
    },
    governanceEvent: true,
    keyEvidence: ["Event-analysis evidence must remain ignored."],
  });

  assert.deepEqual(preview.keyPoints, [
    "Chief executive transition",
    "Board committee reassignment",
  ]);
  assert.equal(preview.keyPointsLabel, "Key Changes");
  assert.equal(preview.showKeyPoints, true);
});

test("non-governance previews retain event-analysis evidence and the Key Points label", () => {
  const preview = resolveFilingPreviewFields({
    displayPayload: {
      display_type: "financing_event",
      data: { key_changes: [{ title: "Do not use this governance field." }] },
    },
    keyEvidence: [" One ", "", "One", "Two", "Three", "Four"],
  });

  assert.deepEqual(preview.keyPoints, ["One", "Two", "Three"]);
  assert.equal(preview.keyPointsLabel, "Key Points");
  assert.equal(preview.showKeyPoints, true);
});

test("filing preview brief prefers primary material event then preserves fallbacks", () => {
  assert.equal(
    resolveFilingPreviewFields({
      materialEvents: [
        { event_summary: "Secondary event.", role: "secondary" },
        { event_summary: "Primary event.", role: "primary" },
      ],
      quickTake: "Quick take.",
      summary: "Summary.",
    }).filingBrief,
    "Primary event.",
  );
  assert.equal(
    resolveFilingPreviewFields({
      materialEvents: [
        { event_summary: "First valid event." },
        { event_summary: "Later event." },
      ],
      quickTake: "Quick take.",
    }).filingBrief,
    "First valid event.",
  );
  assert.equal(
    resolveFilingPreviewFields({ quickTake: "Quick take.", summary: "Summary." })
      .filingBrief,
    "Quick take.",
  );
});

test("filings preview batches evidence and shares governance presentation fields", () => {
  const source = readFileSync(
    new URL("../../lib/filingsV2Data.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /supabaseSelect\("event_analysis", \{[\s\S]*select: "event_id,key_evidence"/);
  assert.match(source, /event_id: `in\.\(\$\{eventIds\.join\(","\)\}\)`/);
  assert.equal(source.match(/supabaseSelect\("event_analysis"/g)?.length, 1);
  assert.match(source, /supabaseSelect\("events", \{[\s\S]*display_type:metadata->display_payload->>display_type/);
  assert.match(source, /display_version:metadata->display_payload->data->>display_version/);
  assert.match(source, /operating_mode:metadata->display_payload->data->>operating_mode/);
  assert.match(source, /business_catalysts:metadata->display_payload->data->business_catalysts/);
  assert.match(source, /capital_mode:metadata->display_payload->data->>capital_mode/);
  assert.match(source, /snapshot_metrics:metadata->display_payload->data->snapshot_metrics/);
  assert.match(source, /displayType === "operating_event"/);
  assert.match(source, /displayVersion === "sec_8k_6k_operating_event_v1"/);
  assert.match(source, /operatingMode === "earnings"/);
  assert.match(source, /displayType === "capital_financing"/);
  assert.match(source, /displayVersion === "sec_8k_6k_capital_financing_v1"/);
  assert.doesNotMatch(source, /select: "id,metadata"/);
  assert.doesNotMatch(source, /event_summary[\s\S]*points\.push/);
  assert.match(source, /quickTake: row\.quick_take,[\s\S]*summary: row\.summary/);
  assert.match(source, /materialEvents: metadata\?\.material_events/);
  assert.match(source, /governanceEvent: record\.events\.includes\("governance"\)/);
  assert.match(source, /governanceEvent: eventTypes\.includes\("governance"\)/);

  const liveFeedSource = readFileSync(
    new URL("../../lib/liveFeed.ts", import.meta.url),
    "utf8",
  );
  const liveFeedV2Source = readFileSync(
    new URL("../../lib/liveFeedV2.ts", import.meta.url),
    "utf8",
  );
  const filingsDetailSource = readFileSync(
    new URL("./FilingsV2Detail.tsx", import.meta.url),
    "utf8",
  );
  const feedPreviewSource = readFileSync(
    new URL("../feed-v2/FeedFilingPreview.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    liveFeedSource,
    /const filingPreviewFields = resolveFilingPreviewFields\(\{[\s\S]*displayPayload: readMetadataRecord\(row\)\?\.display_payload,[\s\S]*keyEvidence,[\s\S]*materialEvents: readMetadataRecord\(row\)\?\.material_events,[\s\S]*quickTake,[\s\S]*summary/,
  );
  assert.match(liveFeedV2Source, /keyPoints: item\.filingKeyPoints/);
  assert.match(liveFeedV2Source, /keyPointsLabel: item\.filingKeyPointsLabel/);
  assert.match(liveFeedV2Source, /showKeyPoints: item\.showFilingKeyPoints/);
  assert.match(
    liveFeedV2Source,
    /summary: filingPreviewFields\?\.filingBrief \|\| item\.quickTake \|\| item\.summary/,
  );
  assert.match(filingsDetailSource, /record\.showKeyPoints && record\.keyPoints\.length/);
  assert.match(filingsDetailSource, /\{record\.keyPointsLabel\}/);
  assert.match(feedPreviewSource, /filing\.showKeyPoints \?/);
  assert.match(feedPreviewSource, /\{filing\.keyPointsLabel\}/);
});

test("does not keep a stale filing selection when filtered results are empty", () => {
  const records = [{ id: "visible" }];

  assert.equal(resolveFilingsV2SelectedRecord(records, "stale")?.id, "visible");
  assert.equal(resolveFilingsV2SelectedRecord([], "stale"), undefined);
});

test("distinguishes complete, partial, and unavailable filing loads", () => {
  assert.equal(resolveFilingsV2LoadState(3, 3), "ready");
  assert.equal(resolveFilingsV2LoadState(2, 3), "partial");
  assert.equal(resolveFilingsV2LoadState(0, 3), "unavailable");
});

test("filing detail embeds stored SEC source in the sandbox and resolves related filings broadly", () => {
  const source = readFileSync(
    new URL("../../app/filings/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /readStoredFilingSourceContent/);
  assert.match(source, /<SecFilingHtmlViewer/);
  assert.match(source, /fetchEventTickers\(item\.id\)/);
  assert.match(source, /symbol: `eq\.\$\{ticker\}`/);
  assert.match(source, /selectRelatedFilingRows/);
  assert.match(source, /source_group: "eq\.filings"/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{ __html: embeddedHtml \}\}/);
});

test("news and filing analysis share one source-verification disclosure", () => {
  const analysisSource = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.tsx", import.meta.url),
    "utf8",
  );
  const filingSource = readFileSync(
    new URL("../../app/filings/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(filingSource, /<GenericFilingAnalysis/);
  assert.equal(
    analysisSource.match(/AI-assisted analysis\. Verify material facts against the original source\. Scores, labels, and directional signals are not investment recommendations\./g)?.length,
    1,
  );
  assert.equal(analysisSource.match(/\{AI_ANALYSIS_DISCLOSURE\}/g)?.length, 1);
});

test("shared news and filing analysis use the readable mobile typography scale", () => {
  const analysisSource = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.tsx", import.meta.url),
    "utf8",
  );
  const analysisStyles = readFileSync(
    new URL(
      "../filing-analysis-v2/GenericFilingAnalysis.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  const scoreStyles = readFileSync(
    new URL("../filing-analysis-v2/ScoreRationale.module.css", import.meta.url),
    "utf8",
  );
  const scoreSource = readFileSync(
    new URL("../filing-analysis-v2/ScoreRationale.tsx", import.meta.url),
    "utf8",
  );
  const googleStyles = readFileSync(
    new URL("../ui/GooglePreferredSourceLink.module.css", import.meta.url),
    "utf8",
  );
  const liveRoomSource = readFileSync(
    new URL("../live-room/LiveRoomEntryButton.tsx", import.meta.url),
    "utf8",
  );
  const mobileAnalysisStyles = analysisStyles.slice(
    analysisStyles.indexOf("@media (max-width: 760px)"),
  );
  const mobileScoreStyles = scoreStyles.slice(
    scoreStyles.indexOf("@media (max-width: 760px)"),
  );
  const mobileGoogleStyles = googleStyles.slice(
    googleStyles.indexOf("@media (max-width: 760px)"),
  );

  assert.match(mobileAnalysisStyles, /\.hero h1 \{[^}]*font-size: var\(--sr-font-size-heading-sm\);/);
  assert.match(mobileAnalysisStyles, /\.heroTimestamp \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.companyLine \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.tickerLine strong \{[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(mobileAnalysisStyles, /\.classification > span \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.impactScore strong \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileAnalysisStyles, /\.sectionLabel \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileAnalysisStyles, /\.card p \{[^}]*font-size: var\(--sr-font-size-lg-plus\);/);
  assert.match(mobileAnalysisStyles, /\.analysisDisclosure \{[^}]*font-size: var\(--sr-font-size-sm\);/);
  assert.match(mobileAnalysisStyles, /\.analysisLiveRoomButton \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileAnalysisStyles, /\.price-card-mobile-collapsible \.detail-price\)[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(mobileAnalysisStyles, /\.price-card-mobile-collapsible \.detail-change\)[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileAnalysisStyles, /\.price-chart-mobile-toggle\)[^}]*font-size: var\(--sr-font-size-base\);/);

  assert.match(mobileScoreStyles, /\.scoreBlock > span \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileScoreStyles, /\.scoreBlock \{[^}]*display: contents;/);
  assert.match(mobileScoreStyles, /\.scoreBlock > span \{[^}]*grid-column: 1;[^}]*grid-row: 1;/);
  assert.match(mobileScoreStyles, /\.scoreBlock > strong \{[^}]*grid-column: 2;[^}]*grid-row: 1;/);
  assert.match(mobileScoreStyles, /\.signal \{[^}]*grid-column: 3;[^}]*grid-row: 1;/);
  assert.match(mobileScoreStyles, /\.headingRow h2 \{[^}]*font-size: var\(--sr-font-size-xl\);/);
  assert.match(mobileScoreStyles, /\.headingRow h2 \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;[^}]*border-top: var\(--sr-border-width\) solid var\(--sr-color-divider\);/);
  assert.match(mobileScoreStyles, /\.copy p \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/);
  assert.match(mobileScoreStyles, /\.signal \{[^}]*font-size: var\(--sr-font-size-md\);/);
  assert.match(mobileScoreStyles, /\.signal\[data-score-tone="default"\],[\s\S]*\.signal\[data-score-tone="neutral"\] \{[^}]*color: var\(--sr-color-text-muted\);/);
  assert.match(mobileScoreStyles, /:global\(\[data-sr-theme="light"\]\) \.signal\[data-score-tone="default"\],[\s\S]*:global\(\[data-sr-theme="light"\]\) \.signal\[data-score-tone="neutral"\] \{[^}]*color: var\(--sr-color-text-muted\);/);
  assert.match(mobileScoreStyles, /\.copy p \{[^}]*font-size: var\(--sr-font-size-lg-plus\);/);
  assert.match(scoreStyles, /\.scoreBlock > strong \{[^}]*font-size: var\(--sr-font-size-heading-lg\);/);
  assert.match(scoreSource, /const scoreTone = getDirectionalScoreTone\(score, signal\);/);
  assert.match(scoreSource, /<strong data-score-tone=\{scoreTone\}>\{score\}<\/strong>/);
  assert.match(scoreSource, /<h2>Score Rationale<\/h2>[\s\S]*data-score-tone=\{scoreTone\}[\s\S]*\{signal\}/);
  assert.equal(scoreSource.match(/\{signal\}/g)?.length, 1);
  assert.match(mobileGoogleStyles, /\.summary \{[^}]*font-size: var\(--sr-font-size-md\);/);

  assert.match(analysisSource, /className=\{styles\.analysisLiveRoomButton\}[\s\S]*label="Discuss in Live Room"/);
  assert.match(liveRoomSource, /className\?: string;/);
  assert.match(liveRoomSource, /className=\{\[styles\.button, className\]\.filter\(Boolean\)\.join\(" "\)\}/);
});

test("filing analysis inherits the final news-document mobile gutter and type hierarchy", () => {
  const analysisSource = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../filing-analysis-v2/GenericFilingAnalysis.module.css", import.meta.url),
    "utf8",
  );
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 760px)"));

  assert.match(analysisSource, /styles\.filingDocument/);
  assert.match(
    mobileStyles,
    /\.filingDocument \.workspace \{[\s\S]*padding-right: var\(--sr-space-2\);[\s\S]*padding-left: var\(--sr-space-2\);/,
  );
  assert.match(
    mobileStyles,
    /\.filingDocument :is\(\.hero, \.card, \.railCard, \.rendererCard\) \{[\s\S]*box-sizing: border-box;[\s\S]*width: 100%;[\s\S]*max-width: 100%;/,
  );
  assert.match(
    mobileStyles,
    /\.filingDocument \.summaryHeader \{[\s\S]*flex-direction: row;[\s\S]*align-items: center;/,
  );
  assert.match(
    mobileStyles,
    /@media \(max-width: 360px\) \{[\s\S]*\.filingDocument \.summaryHeader > :last-child > svg:last-child \{[^}]*display: none;/,
  );
  assert.doesNotMatch(
    mobileStyles,
    /\.filingDocument \.summaryHeader > :last-child > svg \{[^}]*display: none;/,
  );
  assert.match(mobileStyles, /\.filingDocument \.hero h1 \{[^}]*font-size: var\(--sr-font-size-heading-md\);/);
  assert.match(mobileStyles, /\.filingDocument \.heroTimestamp \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(mobileStyles, /\.filingDocument \.companyLine \{[^}]*font-size: 16px;/);
  assert.match(
    mobileStyles,
    /\.filingDocument \.sectionLabel,[\s\S]*\.filingDocument \.specializedBody :is\(h2, h3\) \{[\s\S]*font-size: var\(--sr-font-size-2xl\);/,
  );
  assert.match(
    mobileStyles,
    /\.filingDocument \.card p,[\s\S]*\.filingDocument \.specializedBody :is\(p, li, dd, td\) \{[\s\S]*font-size: 16px;[\s\S]*line-height: 1\.6;/,
  );
  assert.match(mobileStyles, /\.filingDocument \.specializedBody \[class\*="label" i\] \{[\s\S]*font-size: max\(13px, 1em\);/);
  assert.match(
    mobileStyles,
    /\.filingDocument \.rendererCard :global\(\.context-mover-copy strong\) \{[\s\S]*font-size: 16px;/,
  );
});

test("specialized filing cards define their own readable mobile typography", () => {
  const readMobileStyles = (name: string, breakpoint: number) => {
    const styles = readFileSync(
      new URL(`../filing-analysis-v2/${name}.module.css`, import.meta.url),
      "utf8",
    );
    const marker = `@media (max-width: ${breakpoint}px)`;
    const mobileStyles = styles.slice(styles.indexOf(marker));

    assert.ok(mobileStyles.startsWith(marker), `${name} must define mobile styles`);
    return mobileStyles;
  };

  const snapshotStyles = readMobileStyles("ListingFinancialRiskSnapshot", 760);
  const operatingStyles = readMobileStyles("OperatingLegalRoutine", 700);
  const financingStyles = readMobileStyles("FinancingDilutionCapitalStructure", 760);
  const remainingStyles = [
    readMobileStyles("GovernanceEventDetails", 640),
    readMobileStyles("OwnershipDetails", 760),
    readMobileStyles("PeriodicReports", 700),
    readMobileStyles("ProxyVoteDetails", 640),
    readMobileStyles("S8Details", 700),
    readMobileStyles("TenderOfferDetails", 640),
  ];

  assert.match(snapshotStyles, /\.snapshot h2 \{[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(snapshotStyles, /\.item dt \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(snapshotStyles, /\.item strong \{[^}]*font-size: 16px;/);
  assert.match(snapshotStyles, /\.item span \{[^}]*font-size: var\(--sr-font-size-base\);/);

  assert.match(operatingStyles, /\.panelHeading h2,[\s\S]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(operatingStyles, /\.updateHeading strong,[\s\S]*font-size: 16px;/);
  assert.match(operatingStyles, /\.updateList p,[\s\S]*font-size: 16px;[\s\S]*line-height: 1\.6;/);

  assert.match(financingStyles, /\.sectionHeading h2 \{[^}]*font-size: var\(--sr-font-size-2xl\);/);
  assert.match(financingStyles, /\.headline span,[\s\S]*font-size: var\(--sr-font-size-base\);/);
  assert.match(financingStyles, /\.legendCopy > strong,[\s\S]*font-size: 16px;/);
  assert.match(financingStyles, /\.legendValue i \{[^}]*font-size: var\(--sr-font-size-base\);/);
  assert.match(financingStyles, /\.detailRows strong,[\s\S]*font-size: 16px;/);

  for (const styles of remainingStyles) {
    assert.match(styles, /font-size: var\(--sr-font-size-2xl\);/);
    assert.match(styles, /font-size: var\(--sr-font-size-base\);/);
    assert.match(styles, /font-size: 16px;/);
  }
});

test("legacy filing chart mobile display override follows the desktop hidden rule", () => {
  const globals = readFileSync(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );
  const desktopHiddenRule =
    /\.filing-detail-page \.price-chart-mobile-toggle\s*\{\s*display:\s*none;/g;
  const mobileVisibleRule =
    /\.filing-detail-page \.price-chart-mobile-toggle\s*\{\s*display:\s*inline-flex;/g;
  const desktopHiddenMatches = [...globals.matchAll(desktopHiddenRule)];
  const mobileVisibleMatches = [...globals.matchAll(mobileVisibleRule)];
  const desktopRuleIndex = desktopHiddenMatches[0]?.index ?? -1;
  const mobileRuleIndex = mobileVisibleMatches[0]?.index ?? -1;

  assert.equal(
    desktopHiddenMatches.length,
    1,
    "desktop chart toggle must have exactly one default hidden rule",
  );
  assert.equal(
    mobileVisibleMatches.length,
    1,
    "mobile chart toggle must have exactly one visible override",
  );
  assert.ok(
    mobileRuleIndex > desktopRuleIndex,
    "the equal-specificity mobile display override must follow the desktop rule",
  );
  assert.equal(
    desktopHiddenMatches.some(
      (match) => (match.index ?? -1) > mobileRuleIndex,
    ),
    false,
    "no later desktop hidden rule may override the mobile chart toggle",
  );
  assert.match(
    globals.slice(desktopRuleIndex, mobileRuleIndex),
    /@media \(max-width: 760px\)/,
  );
  assert.match(
    globals.slice(mobileRuleIndex),
    /data-mobile-chart-expanded="false"[\s\S]*:is\(\.price-range-control, \.price-chart-details\) \{[\s\S]*display: none;/,
  );
});

test("filings preview rail keeps intrinsic ad widths constrained after route transitions", () => {
  const adStyles = readFileSync(
    new URL("./FilingsRailAdSlot.module.css", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(adStyles, /\.slot\.mobileSlot\s*\{[\s\S]*display:\s*none;/);
  assert.match(
    adStyles,
    /@media \(max-width: 760\.98px\)\s*\{[\s\S]*\.slot\.desktopSlot\s*\{[\s\S]*display:\s*none;/,
  );
  assert.match(
    styles,
    /\.detailContent\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.match(styles, /\.detailPreviewCard\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(
    styles,
    /\.detailAdArea\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/,
  );
});

test("filings preview uses a 960px rail breakpoint and an accessible intermediate drawer", () => {
  const clientSource = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );
  const detailSource = readFileSync(
    new URL("./FilingsV2Detail.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL("../ui/BottomSheetShell.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(0, 1fr\) clamp\(340px, 25vw, 380px\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 959\.98px\)[\s\S]*\.root\s*\{[\s\S]*grid-template-columns:\s*1fr;[\s\S]*\.detailRail\s*\{\s*display:\s*none;/,
  );
  assert.match(styles, /@media \(min-width: 960px\)/);
  assert.match(
    clientSource,
    /window\.matchMedia\("\(min-width: 960px\)"\)/,
  );
  assert.match(
    clientSource,
    /usesMobileSheet[\s\S]*setIsTabletDetailDrawerOpen\(true\)/,
  );
  assert.match(
    clientSource,
    /setIsTabletDetailDrawerOpen\(false\)[\s\S]*intermediateViewport\.addEventListener\("change", dismissDrawerOutsideViewport\)[\s\S]*intermediateViewport\.removeEventListener\("change", dismissDrawerOutsideViewport\)/,
  );
  assert.ok(
    clientSource.indexOf("className={styles.detailRailPreview}") <
      clientSource.indexOf("className={styles.premiumCtaDesktop}"),
    "the selected filing preview must precede the upgrade card in the rail",
  );
  assert.match(detailSource, /TabletFilingsV2DetailDrawer/);
  assert.match(detailSource, /viewport="intermediate"/);
  assert.match(detailSource, /closeLabel="Close filing preview"/);
  assert.match(detailSource, /showHandle=\{false\}/);
  assert.match(
    shellSource,
    /viewport === "intermediate"[\s\S]*"\(min-width: 761px\) and \(max-width: 959\.98px\)"/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) and \(max-width: 959\.98px\)[\s\S]*\.tabletDetailDrawerSurface\.tabletDetailDrawerSurface\s*\{[\s\S]*right:\s*0;[\s\S]*left:\s*auto;[\s\S]*height:\s*100dvh;/,
  );
  assert.doesNotMatch(styles, /> div\[aria-hidden="true"\]/);
  assert.match(shellSource, /directOverlayActivation[\s\S]*requestDismiss\(\)/);
  assert.match(shellSource, /restoreFocus\(opener\)/);
  const shellStyles = readFileSync(
    new URL("../ui/BottomSheetShell.module.css", import.meta.url),
    "utf8",
  );
  assert.match(
    shellStyles,
    /\.intermediateRoot \.overlay\s*\{[\s\S]*inset:\s*0;/,
  );
  assert.match(detailSource, /MobileFilingsV2DetailSheet/);
  assert.match(clientSource, /window\.matchMedia\("\(max-width: 760\.98px\)"\)/);
});

test("filings preview renders exactly one plan-gated responsive ad after its CTA", () => {
  const clientSource = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );
  const detailSource = readFileSync(
    new URL("./FilingsV2Detail.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    detailSource,
    /detailActionArea[\s\S]*previewAdSize \? \([\s\S]*<FilingsRailAdSlot size=\{previewAdSize\} \/>/,
  );
  assert.equal(
    detailSource.match(/<FilingsRailAdSlot/g)?.length,
    1,
    "the reusable preview content must render one ad slot at most",
  );
  assert.match(clientSource, /viewerPlan === "free" \? "300x250" : null/);
  assert.match(clientSource, /viewerPlan === "free" \? "320x100" : null/);
});

test("filings preview uses shared Saved and Watchlist actions with batched viewer state", () => {
  const detailSource = readFileSync(
    new URL("./FilingsV2Detail.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = readFileSync(
    new URL("../../app/filings/page.tsx", import.meta.url),
    "utf8",
  );
  const clientSource = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );

  assert.match(detailSource, /<WatchlistButton/);
  assert.match(detailSource, /record\.ticker \? \(/);
  assert.match(detailSource, /ticker=\{record\.ticker\}/);
  assert.match(detailSource, /<SavedContentButton/);
  assert.match(detailSource, /contentId=\{record\.id\}/);
  assert.match(detailSource, /contentType="filing"/);
  assert.match(pageSource, /getViewerContentState/);
  assert.match(clientSource, /savedContentBatchSize = 100/);
  assert.match(clientSource, /\/api\/saved\?\$\{search\.toString\(\)\}/);
  assert.match(clientSource, /fetch\("\/api\/watchlist"/);
});

test("filings mobile landing keeps one accessible preferred-source link and a flat full-width list", () => {
  const filterSource = readFileSync(
    new URL("./FilingsV2FilterBar.tsx", import.meta.url),
    "utf8",
  );
  const listSource = readFileSync(
    new URL("./FilingsV2List.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = readFileSync(
    new URL("./StockRadarFilingsV2.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(filterSource, /import \{ ChevronDown, Search, SlidersHorizontal, X \} from "lucide-react";/);
  assert.match(
    filterSource,
    /preferredSourceUrl\?: string \| null;[\s\S]*<button aria-label="Search" className=\{styles\.searchButton\} type="submit">[\s\S]*<Search aria-hidden="true" className=\{styles\.searchButtonIcon\}/,
  );
  assert.match(
    filterSource,
    /className=\{styles\.mobilePreferredSourceLink\}[\s\S]*<GooglePreferredSourceLink[\s\S]*ariaLabel="Add Stock Radar on Google"[\s\S]*header[\s\S]*href=\{preferredSourceUrl\}/,
  );
  assert.match(
    listSource,
    /<GooglePreferredSourceLink[\s\S]*ariaLabel="Add Stock Radar on Google"[\s\S]*header[\s\S]*href=\{preferredSourceUrl\}/,
  );
  assert.match(pageSource, /<FilingsV2FilterBar[\s\S]*preferredSourceUrl=\{preferredSourceUrl\}/);
  assert.doesNotMatch(filterSource, /ariaLabel="Add Stock Radar on Google Google"/);
  assert.doesNotMatch(listSource, /ariaLabel="Add Stock Radar on Google Google"/);

  assert.match(styles, /\.mobilePreferredSourceLink \{[\s\S]*display: none;/);
  assert.match(styles, /\.searchButtonIcon \{[\s\S]*display: none;/);
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*\.filterUtilityRow \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto;[\s\S]*\.searchForm \{[\s\S]*height: 44px;[\s\S]*min-height: 44px;[\s\S]*grid-template-columns: minmax\(0, 1fr\) 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*border-radius: var\(--sr-radius-action\);[\s\S]*background: var\(--sr-color-surface-control\);[\s\S]*\.searchForm:focus-within \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*box-shadow: 0 0 0 2px var\(--sr-color-accent-active-soft\);/,
  );
  assert.match(
    styles,
    /\.searchControl > label \{[\s\S]*height: 42px;[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*\.searchControl > label:focus-within \{[\s\S]*border: 0;[\s\S]*box-shadow: none;[\s\S]*\.searchControl > label > span:first-child \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.searchControl > label input \{[\s\S]*font-size: 16px;[\s\S]*\.searchControl > label input::placeholder \{[\s\S]*color: transparent;[\s\S]*\.searchControl::after \{[\s\S]*content: "Search filings";[\s\S]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    styles,
    /\.searchForm > \.searchButton \{[\s\S]*width: 44px;[\s\S]*height: 42px;[\s\S]*min-height: 42px;[\s\S]*border: 0;[\s\S]*border-left: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*\.searchForm > \.searchButton:focus-visible \{[\s\S]*outline: 0;[\s\S]*\.searchButtonIcon \{[\s\S]*display: block;/,
  );
  assert.doesNotMatch(styles, /\.searchForm \{[^}]*overflow:\s*hidden;/);
  assert.match(
    styles,
    /\.mobileFilterActions \.mobileFilterTrigger \{[\s\S]*min-height: 44px;[\s\S]*border-color: var\(--sr-color-border-control\);[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobileFilterActions \.mobileFilterTrigger > span:first-child \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobilePreferredSourceLink \{[\s\S]*display: flex;[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*height: 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*\.mobilePreferredSourceLink > a > span::after \{[\s\S]*content: "Google";/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*\.primaryColumn \{[\s\S]*display: grid;[\s\S]*gap: var\(--sr-space-3\);[\s\S]*\.controlBand \{[\s\S]*padding: 0;[\s\S]*\.summaryStrip \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.mobileFilterSheetContent \{[\s\S]*padding: calc\(var\(--sr-space-8\) \* 2\) var\(--sr-space-4\) var\(--sr-space-6\);[\s\S]*\.mobileFilterSheetContent header p,[\s\S]*\.mobileFilterGroup h3 \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobileFilterGroup > div > button \{[\s\S]*min-height: 44px;[\s\S]*padding: var\(--sr-space-2\) var\(--sr-space-2-5\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*\.mobileFilterSheetActions > button \{[\s\S]*min-height: 44px;[\s\S]*padding: 0 var\(--sr-space-4\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: var\(--sr-font-weight-semibold\);[\s\S]*line-height: var\(--sr-line-height-none\);/,
  );
  assert.match(
    styles,
    /\.listPanel \{[\s\S]*width: calc\(100% \+ \(var\(--sr-page-gutter-mobile\) \* 2\)\);[\s\S]*margin-inline: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*\.listHeader \{[\s\S]*min-height: 40px;[\s\S]*gap: var\(--sr-space-2\);[\s\S]*padding-inline: var\(--sr-space-4\);[\s\S]*background: var\(--sr-color-surface-control-strong\);[\s\S]*\.listHeaderTitle \{[\s\S]*width: auto;[\s\S]*flex: 1 1 auto;[\s\S]*\.listHeaderTitle > a \{[\s\S]*display: none;[\s\S]*\.listHeaderCount \{[\s\S]*width: auto;[\s\S]*flex: 0 0 auto;[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);/,
  );
  const mobileListHeader =
    [...styles.matchAll(/\.listHeader \{[^}]*\}/g)].at(-1)?.[0] ?? "";
  assert.doesNotMatch(mobileListHeader, /linear-gradient/);
  const desktopListHeader = styles.match(/^\.listHeader \{[^}]*\}/m)?.[0] ?? "";
  assert.match(
    desktopListHeader,
    /background: linear-gradient\([\s\S]*var\(--sr-color-surface-table-header-start\),[\s\S]*var\(--sr-color-surface-table-header-end\)/,
  );
  assert.match(styles, /\.filingItemSlot::after \{[\s\S]*background: var\(--sr-color-border\);/);
  assert.match(styles, /\.listFooter \{[\s\S]*background: transparent;/);
  assert.match(
    styles,
    /@media \(max-width: 340px\) \{[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*width: 44px;[\s\S]*padding: 0;[\s\S]*\.mobilePreferredSourceLink > a > span \{[\s\S]*clip-path: inset\(50%\);/,
  );

  assert.match(styles, /\.searchForm \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) max-content;/);
  assert.match(
    styles,
    /\.listPanel \{[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
});

test("filing feed rows use watchlist density and plain representative event metadata", () => {
  const listSource = readFileSync(
    new URL("./FilingsV2List.tsx", import.meta.url),
    "utf8",
  );
  const marketReactionSource = readFileSync(
    new URL("./FilingsV2MarketReaction.tsx", import.meta.url),
    "utf8",
  );
  const dataSource = readFileSync(
    new URL("../../lib/filingsV2Data.ts", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(listSource, /const visibleEvents = record\.events\.slice\(0, 1\);/);
  assert.match(listSource, /className=\{styles\.filingEventMeta\}/);
  assert.match(listSource, /data-ticker-available=\{record\.ticker \? "true" : "false"\}/);
  assert.match(listSource, /className=\{styles\.mobileIdentityTicker\}/);
  assert.match(listSource, /record\.ticker \? \([\s\S]*styles\.mobileIdentityTicker/);
  assert.doesNotMatch(listSource, /record\.ticker \?\? record\.formType/);
  assert.match(listSource, /className=\{styles\.mobileFilingClassification\}/);
  assert.match(listSource, /className=\{styles\.mobileFilingFooter\}/);
  assert.ok(
    marketReactionSource.indexOf("{hasChange ? <span") <
      marketReactionSource.indexOf("{hasPrice ? <strong>"),
    "quote DOM should expose change before price for mobile reading order",
  );
  assert.match(
    styles,
    /\.filingPrice strong \{[\s\S]*?order: 1;[\s\S]*?\.filingPrice > span:not\(\.filingDataUnavailable\) \{[\s\S]*?order: 2;/,
  );
  assert.match(
    styles,
    /\.root \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) clamp\(340px, 25vw, 380px\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*?\.detailIdentity \{[\s\S]*?padding-right: calc\(var\(--sr-size-close-button\) \* 3 \+ var\(--sr-space-3\)\);/,
  );
  assert.match(
    styles,
    /\.filingItem \{[\s\S]*min-height: 82px;[\s\S]*gap: var\(--sr-space-3\);[\s\S]*padding: var\(--sr-space-2\) var\(--sr-space-4\);/,
  );
  assert.match(
    styles,
    /\.filingTitle \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-semibold\);/,
  );
  assert.match(
    styles,
    /\.identity strong \{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-heavy\);/,
  );
  assert.match(
    styles,
    /\.filingImpact \.impactScore \{[\s\S]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.filingTitle \{[\s\S]*?font-size: var\(--sr-font-size-sm\);[\s\S]*?font-weight: 600;[\s\S]*?line-height: var\(--sr-line-height-snug\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.filingItemTime \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?line-height: var\(--sr-line-height-default\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.formLabel,[\s\S]*?\.eventBadges \.filingEventMeta \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?font-weight: 600;/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.filingImpact \.signal \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?font-weight: var\(--sr-font-weight-regular\);[\s\S]*?\.filingImpact \.impactScore \{[\s\S]*?font-weight: 600;/,
  );
  assert.match(
    styles,
    /\.formLabel \{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*padding: 0;[\s\S]*background: transparent;/,
  );
  assert.match(
    styles,
    /\.eventBadges \.filingEventMeta \{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*padding: 0;[\s\S]*background: transparent;/,
  );
  assert.match(
    styles,
    /\.filingItem\.selectedFilingItem::before \{[\s\S]*top: 0;[\s\S]*bottom: 0;[\s\S]*width: 3px;[\s\S]*border-radius: 0;[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1440px\) and \(min-width: 761px\) \{[\s\S]*?\.filingSparkline \{[\s\S]*?display: none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*?\.filingItem \{[\s\S]*?min-height: 132px;[\s\S]*?grid-template-columns: minmax\(40px, auto\) minmax\(0, 1fr\) auto;[\s\S]*?grid-template-rows: auto auto auto;[\s\S]*?column-gap: var\(--sr-space-2\);[\s\S]*?row-gap: 7px;[\s\S]*?padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*?background: var\(--sr-color-surface-table-row\);/,
  );
  assert.match(
    styles,
    /\.filingItem\[data-ticker-available="false"\] \.mobileFilingClassification \{[\s\S]*grid-column: 1 \/ 3;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*?\.filingTitle \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;[\s\S]*?font-size: 18px;[\s\S]*?font-weight: 650;[\s\S]*?line-height: 1\.4;[\s\S]*?-webkit-line-clamp: 2;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*?\.filingPrice \{[\s\S]*?min-width: max-content;[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 3;[\s\S]*?flex-direction: row;[\s\S]*?align-items: baseline;[\s\S]*?justify-self: end;[\s\S]*?gap: var\(--sr-space-1\);[\s\S]*?white-space: nowrap;/,
  );
  assert.match(dataSource, /readHydratedMarketQuoteMap\(quoteSymbols\)/);
  assert.match(
    styles,
    /\.listHeaderCount \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.listHeaderTitle h2 \{[\s\S]*font-size: var\(--sr-font-size-xl\);[\s\S]*font-weight: var\(--sr-font-weight-display\);[\s\S]*\.liveLabel \{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-label\);[\s\S]*\.identity strong \{[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 800;[\s\S]*letter-spacing: 0\.02em;/,
  );
  assert.match(
    styles,
    /\.mobileFilingClassification \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.mobileFilingClassification \.formLabel,[\s\S]*\.mobileFilingClassification \.filingEventMeta,[\s\S]*\.mobileFilingClassification \.eventOverflow,[\s\S]*\.mobileFilingClassification \.metadataEmpty \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: 650;[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.mobileFilingClassification \.filingEventMeta \{[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*text-transform: none;/,
  );
  assert.match(
    styles,
    /\.mobileFilingFooter \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.mobileFiledAt \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.mobileFilingSource \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.mobileFilingSource::before \{[\s\S]*margin: 0 var\(--sr-space-1\);[\s\S]*content: "·";/,
  );
  assert.match(
    styles,
    /\.filingPrice strong \{[\s\S]*order: 2;[\s\S]*font-size: 15px;[\s\S]*font-weight: 600;[\s\S]*\.filingPrice > span:not\(\.filingDataUnavailable\) \{[\s\S]*order: 1;[\s\S]*font-size: 15px;[\s\S]*font-weight: 700;[\s\S]*\.filingImpact \.signal \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 700;[\s\S]*\.filingImpact \.impactScore \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 600;/,
  );
  assert.match(
    listSource,
    /className=\{styles\.mobileFiledAt\}[\s\S]*\{filingDateLabel\}\{" "\}\{record\.filedTime\}/,
  );
  assert.doesNotMatch(listSource, /mobileFiledDate|mobileFiledTime/);
  assert.doesNotMatch(styles, /\.mobileFiledDate::after/);
  assert.match(
    styles,
    /@media \(max-width: 760\.98px\) \{[\s\S]*?\.filingPriceUnavailable \{[\s\S]*?display: none;/,
  );
});

test("mobile filings premium CTA is a flat list row while desktop keeps its premium card", () => {
  const styles = readFileSync(
    new URL("./StockRadarFilingsV2.module.css", import.meta.url),
    "utf8",
  );
  const mobileRule = [...styles.matchAll(/\.premiumCtaMobile\s*\{[^}]*\}/g)].at(-1)?.[0] ?? "";

  assert.match(
    mobileRule,
    /display: block;[\s\S]*min-width: 0;[\s\S]*min-height: 0;[\s\S]*margin: 0;[\s\S]*border: 0;[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: 0;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-table-row\);[\s\S]*box-shadow: none;/,
  );
  assert.doesNotMatch(mobileRule, /border-top|gradient|accent-border-premium/);
  assert.match(
    styles,
    /\.premiumCtaMobile \.premiumCtaCopy \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*align-items: center;[\s\S]*column-gap: var\(--sr-space-3\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy > span \{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-label\);[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy strong \{[\s\S]*font: 700 16px \/ 1\.25 var\(--sr-font-family-sans\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy p \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*line-height: 1\.4;/,
  );
  assert.match(
    styles,
    /\.premiumCtaMobile \.premiumCtaLink \{[\s\S]*grid-row: 1 \/ 4;[\s\S]*min-height: 40px;[\s\S]*align-self: center;[\s\S]*padding: 0 var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-primary-action\);[\s\S]*font: 700 var\(--sr-font-size-base\) \/ var\(--sr-line-height-none\)[\s\S]*\.premiumCtaMobile \.premiumCtaLinkIcon,[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.premiumCta \{[\s\S]*min-height: 152px;[\s\S]*var\(--sr-color-accent-cta-top\)[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
  );
});
