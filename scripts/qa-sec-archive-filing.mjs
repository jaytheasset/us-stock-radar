#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archivePagePath = path.join(repoRoot, "app", "filings", "archive", "[id]", "page.tsx");
const filingDetailPath = path.join(repoRoot, "app", "filings", "[id]", "page.tsx");
const checks = [];

try {
  const archivePage = readFileSync(archivePagePath, "utf8");
  const filingDetail = readFileSync(filingDetailPath, "utf8");

  check("SEC filing archive route exists", archivePage.includes("FilingArchiveDetailPage"));
  check("archive route is filings-specific", archivePage.includes("<Link href=\"/filings\">Filings</Link>"));
  check("archive route does not use news archive route", !archivePage.includes("/news/archive"));
  check("archive route labels source as SEC Filing", archivePage.includes("SEC Filing"));
  check("archive route does not use release heading", !archivePage.includes("Original Release Text"));
  check("archive route shows original filing/source text heading", archivePage.includes("Original Filing Text / Source Text"));
  check("archive route includes source inventory", archivePage.includes("Attachment / Source Inventory"));
  check("archive route includes attachment snippets", archivePage.includes("Selected Attachment Snippets"));
  check(
    "archive summary suffix is exact",
    archivePage.includes("Limited market impact detected. The original source is included below for reference."),
  );
  check(
    "archive summary uses filing_summary before archive fallback fields",
    archivePage.includes('filingSummary: readString(displayPayloadData, "filing_summary")') &&
      archivePage.includes('readString(metadata, "archive_summary") ||') &&
      archivePage.includes('readString(eventRow, "quick_take") ||') &&
      archivePage.includes('readString(eventRow, "summary")'),
  );
  check("archive route uses existing raw source fields", [
    "raw_items",
    "body_text",
    "analysis_text",
    "documents",
    "attachment_texts",
    "primary_document_url",
  ].every((token) => archivePage.includes(token)));
  check("archive route does not require Bullish section", !archivePage.includes("Bullish"));
  check("archive route does not require Bearish section", !archivePage.includes("Bearish"));
  check("archive route does not require Watch Next section", !archivePage.includes("What To Watch Next"));
  check("archive route rejects non-archive filings", archivePage.includes('readString(eventRow, "delivery_level") !== "archive"'));
  check("archive route rejects non-filing events", archivePage.includes('readString(eventRow, "source_group") !== "filings"'));
  check("full filing detail imports redirect", filingDetail.includes('import { redirect } from "next/navigation";'));
  check("full filing detail redirects archive filings", filingDetail.includes('item.deliveryLevel === "archive"'));
  check("full filing detail redirects to /filings/archive/[id]", filingDetail.includes("redirect(`/filings/archive/${item.id}`)"));

  const ok = checks.every((item) => item.ok);
  console.log(
    JSON.stringify(
      {
        ok,
        summary: {
          archiveUrlPattern: "/filings/archive/[id]",
          directFullDetailArchiveBehavior: "redirects to /filings/archive/[id]",
          fallbackSummaryOrder: [
            "events.metadata.display_payload.data.filing_summary",
            "events.metadata.archive_summary",
            "events.quick_take",
            "events.summary",
          ],
          liveCalls: false,
        },
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}
