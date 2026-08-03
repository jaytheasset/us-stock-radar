import assert from "node:assert/strict";
import test from "node:test";

import { collectSecDevIssues } from "./secDevelopmentIssues.ts";

test("SEC debug issues surface display payload warnings through the existing warning path", () => {
  const warning = "A Key Evidence item exceeds the 18-word contract and must be rewritten without changing its source-backed meaning.";
  const issues = collectSecDevIssues(
    {
      key: "current-reports",
      label: "SEC 8-K / 6-K",
      forms: ["8-K", "6-K"],
      liveRuns: [{
        mode: "live_dry_run",
        status: "pass",
        ranAt: "2026-08-04T00:00:00.000Z",
        durationMs: 1,
        room: "current-reports",
        formTypes: ["8-K"],
        accessionNumber: "0000000000-26-000001",
        rawItemId: "raw-item",
        summary: "Completed",
        items: [{
          form_type: "8-K",
          ok: true,
          runtime_output: {
            display_payload_debug: {
              display_warnings: [warning],
            },
          },
        }],
        diagnostics: null,
        error: null,
      }],
    },
    "all",
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.severity, "warning");
  assert.equal(issues[0]?.source, "display_warnings");
  assert.equal(issues[0]?.message, warning);
});
