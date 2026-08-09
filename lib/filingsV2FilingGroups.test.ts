import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  filingGroupIncludesEffectiveForm,
  filingsV2FilingGroupLabel,
  filingsV2FilingGroupOptions,
  formatFilingsV2FormType,
  resolveFilingsV2FilingGroupQuery,
} from "./filingsV2FilingGroups.ts";
import {
  SEC_CURRENT_REPORT_FORMS,
  SEC_FORM_ROOM_MANIFEST,
  SEC_PERIODIC_REPORT_FORMS,
  SEC_S1_F1_FORMS,
} from "./sources/sec/forms/common/forms.ts";

test("public filing groups are derived from every analysis room", () => {
  assert.deepEqual(
    filingsV2FilingGroupOptions.map((option) => option.value),
    SEC_FORM_ROOM_MANIFEST.map((room) => room.slug),
  );
  assert.equal(filingsV2FilingGroupLabel["8k-6k"], "Current reports");
  assert.equal(
    filingsV2FilingGroupLabel["periodic-reports"],
    "Periodic reports",
  );
  assert.equal(filingsV2FilingGroupLabel.effect, "Effectiveness notices");
});

test("selected groups expand from the shared manifest as a deduplicated OR union", () => {
  const current = resolveFilingsV2FilingGroupQuery(["8k-6k"]);
  assert.deepEqual(current.formTypes, [...SEC_CURRENT_REPORT_FORMS]);
  assert.deepEqual(current.effectiveFilingForms, [...SEC_CURRENT_REPORT_FORMS]);
  assert.equal(current.includeEffectiveness, false);

  const periodic = resolveFilingsV2FilingGroupQuery(["periodic-reports"]);
  assert.deepEqual(periodic.formTypes, [...SEC_PERIODIC_REPORT_FORMS]);

  const combined = resolveFilingsV2FilingGroupQuery([
    "s1-f1",
    "8k-6k",
    "s1-f1",
  ]);
  assert.deepEqual(
    new Set(combined.formTypes),
    new Set([...SEC_CURRENT_REPORT_FORMS, ...SEC_S1_F1_FORMS]),
  );
  assert.equal(combined.formTypes.length, new Set(combined.formTypes).size);
});

test("EFFECT matching uses related forms produced by existing parser fixtures", () => {
  const s1Effect = readExpectedEffect("s1-effective");
  const unknownEffect = readExpectedEffect("insufficient-context");

  assert.equal(s1Effect.effectiveFilingForm, "S-1");
  assert.equal(
    filingGroupIncludesEffectiveForm(
      "s1-f1",
      s1Effect.effectiveFilingForm,
    ),
    true,
  );
  assert.equal(
    filingGroupIncludesEffectiveForm(
      "s3-f3",
      s1Effect.effectiveFilingForm,
    ),
    false,
  );
  assert.equal(unknownEffect.effectiveFilingForm, null);
  assert.equal(
    filingGroupIncludesEffectiveForm(
      "s1-f1",
      unknownEffect.effectiveFilingForm,
    ),
    false,
  );

  assert.deepEqual(resolveFilingsV2FilingGroupQuery(["effect"]), {
    effectiveFilingForms: [],
    formTypes: [],
    includeEffectiveness: true,
  });
  assert.equal(formatFilingsV2FormType("EFFECT", "S-1"), "EFFECT · S-1");
  assert.equal(formatFilingsV2FormType("EFFECT", null), "EFFECT");
});

test("filings RPC reads and filters only persisted EFFECT relationship data", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260809183000_common_market_cap_filter_bands.sql",
    ),
    "utf8",
  );

  assert.match(
    sql,
    /metadata\s*->\s*'display_payload'\s*->\s*'data'\s*->>\s*'effective_filing_form'/,
  );
  assert.match(sql, /p_include_effectiveness/);
  assert.match(sql, /= any\(p_effective_filing_forms\)/);
  assert.match(sql, /'effective_filing_form', v\.effective_filing_form/);
});

test("filings RPC prefers resolved market cap, keeps legacy fallback, and uses shared bands", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260809183000_common_market_cap_filter_bands.sql"),
    "utf8",
  );
  const resolvedIndex = sql.indexOf("metadata -> 'resolved_market_cap' ->> 'value'");
  const legacyIndex = sql.indexOf("metadata -> 'market_context' ->> 'market_cap'");
  const optionSource = readFileSync(
    join(process.cwd(), "components", "filings-v2", "FilingsV2MarketCapOption.tsx"),
    "utf8",
  );

  assert.ok(resolvedIndex >= 0 && legacyIndex > resolvedIndex);
  assert.match(optionSource, /marketCapRangeLabels\[marketCap\]/);
  assert.match(sql, /when jsonb_typeof\(e\.metadata -> 'resolved_market_cap'\) = 'object'/);
  assert.match(sql, /'Micro' = any\(p_market_caps\) and n\.market_cap >= 0 and n\.market_cap < 100000000/);
  assert.match(sql, /'Small' = any\(p_market_caps\) and n\.market_cap >= 100000000 and n\.market_cap < 2000000000/);
  assert.match(sql, /'Mid' = any\(p_market_caps\) and n\.market_cap >= 2000000000 and n\.market_cap < 10000000000/);
  assert.match(sql, /'Large' = any\(p_market_caps\) and n\.market_cap >= 10000000000 and n\.market_cap < 200000000000/);
  assert.match(sql, /'Mega' = any\(p_market_caps\) and n\.market_cap >= 200000000000/);
});

function readExpectedEffect(name: string) {
  const expected = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        "lib",
        "sources",
        "sec",
        "forms",
        "effect",
        "expected",
        `${name}.expected.json`,
      ),
      "utf8",
    ),
  ) as { parser_output: { facts: { effectiveFilingForm: string | null } } };
  return expected.parser_output.facts;
}
