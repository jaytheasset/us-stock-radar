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
  assert.match(periodicRoom, /Filing Brief = analysis_output\.quick_take/);
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
