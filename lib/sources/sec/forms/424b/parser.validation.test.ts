import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse424bFiling } from "./parser";
import type { Sec424bFixtureInput, Sec424bParserOutput } from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "424b");
const fixturesDir = join(roomDir, "fixtures");

const forbiddenParserJudgmentKeys = new Set([
  "analysis_output",
  "analysis_action",
  "delivery_level",
  "display_mode",
  "event_title",
  "event_type",
  "expected_delivery_level",
  "expected_impact",
  "quick_take",
  "score",
  "score_reason",
  "signal",
  "supply_segments",
]);

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

function findForbiddenKeys(value: unknown, path = "parser_output"): string[] {
  if (value == null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const keyPath = `${path}.${key}`;
    const current = forbiddenParserJudgmentKeys.has(key) ? [keyPath] : [];
    return [...current, ...findForbiddenKeys(child, keyPath)];
  });
}

function parseFixture(name: string): Sec424bParserOutput {
  const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, `${name}.json`));
  return parse424bFiling(fixture);
}

function blockText(output: Sec424bParserOutput): string {
  const blocks = output.raw.cleaned_source_blocks;
  assert.ok(Array.isArray(blocks), "cleaned_source_blocks must be an array");
  return blocks
    .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

describe("424B parser validation guardrails", () => {
  it("keeps parser output free of final event, score, delivery, display, and analysis fields", () => {
    for (const name of fixtureNames()) {
      const output = parseFixture(name);

      assert.deepEqual(findForbiddenKeys(output), [], `${name} parser output contains judgment keys`);
      assert.deepEqual(output.facts, {}, `${name} parser should not pre-fill LLM facts`);
      assert.deepEqual(output.signals, [], `${name} parser should not preselect analysis signals`);
      assert.equal(output.raw.deterministicCandidate ?? null, null, `${name} parser should not make deterministic display choices`);
    }
  });

  it("preserves source blocks for representative 424B structures without calculating final UI values", () => {
    const primary = blockText(parseFixture("primary-high-dilution"));
    assert.match(primary, /30,000,000 shares/i);
    assert.match(primary, /\$1\.00 per share/i);
    assert.match(primary, /\$27,600,000/i);

    const resale = blockText(parseFixture("resale-overhang"));
    assert.match(resale, /12,500,000 shares/i);
    assert.match(resale, /will not receive any proceeds/i);
    assert.match(resale, /conversion of notes and exercise of warrants/i);

    const atm = blockText(parseFixture("atm-market-context"));
    assert.match(atm, /At Market Issuance Sales Agreement/i);
    assert.match(atm, /\$100,000,000/i);
    assert.match(atm, /at-the-market offering under Rule 415/i);

    const warrants = blockText(parseFixture("multi-leg-warrant-offering"));
    assert.match(warrants, /pre-funded warrants/i);
    assert.match(warrants, /common warrants/i);
    assert.match(warrants, /\$0\.00001 per share/i);
    assert.match(warrants, /\$3\.80 per share/i);
  });

  it("keeps structured-note reference assets as source text instead of issuer facts", () => {
    const output = parseFixture("structured-note-pdf");
    const text = blockText(output);

    assert.deepEqual(output.facts, {});
    assert.match(text, /Issuer:\s*Nomura America Finance/i);
    assert.match(text, /Reference Asset:\s*Common Stock of Tesla/i);
    assert.match(text, /\(TSLA\)/i);
    assert.ok(output.warnings.includes("PDF text-layer page markers detected; table pairings may require review."));
  });

  it("keeps non-common security variants as source blocks for LLM classification", () => {
    for (const name of ["final-preferred-depositary", "rights-offering", "structured-note-pdf"]) {
      const output = parseFixture(name);

      assert.deepEqual(output.facts, {}, `${name} should remain parser source blocks only`);
      assert.ok(blockText(output).length > 100, `${name} should preserve source text for analysis`);
      assert.equal(output.raw.deterministicCandidate ?? null, null, `${name} should not choose final UI mode`);
    }
  });

  it("warns on preliminary blanks without inferring missing final terms", () => {
    const output = parse424bFiling({
      formType: "424B5",
      accessionNumber: "0000000000-26-009999",
      issuer: {
        name: "Placeholder Bancorp, Inc.",
        ticker: "PHBC",
        exchange: "NYSE",
      },
      filingText:
        "Subject to Completion Preliminary Prospectus Supplement Placeholder Bancorp, Inc. [?? Depositary Shares. Each depositary share represents a 1/40th interest in Series A Preferred Stock. Dividends will accrue at a rate of [??% per annum. The liquidation preference will be $1,000 per preferred share, equivalent to $25 per depositary share.",
    });

    assert.deepEqual(output.facts, {});
    assert.match(blockText(output), /\[\?\?/);
    assert.ok(
      output.warnings.includes(
        "Preliminary, blank, or formula-based terms detected; parser should not infer missing final values.",
      ),
    );
  });
});
