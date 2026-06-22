import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse424bFiling } from "./parser";
import type { Sec424bFixtureInput } from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "424b");
const fixturesDir = join(roomDir, "fixtures");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

describe("parse424bFiling", () => {
  for (const name of fixtureNames()) {
    it(`builds compact source blocks for ${name}`, () => {
      const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, `${name}.json`));
      const output = parse424bFiling(fixture);

      assert.equal(output.parserVersion, "424b-parser-v1");
      assert.equal(output.parserGroup, "424b");
      assert.equal(output.formType, fixture.formType);
      assert.equal(output.accessionNumber, fixture.accessionNumber);
      assert.equal(output.isSupported, true);

      const blocks = output.raw.cleaned_source_blocks as
        | Array<{ block_type?: unknown; label?: unknown; source?: unknown; text?: unknown }>
        | undefined;
      assert.ok(Array.isArray(blocks), "cleaned_source_blocks must be an array");
      assert.ok(blocks.length > 0, "cleaned_source_blocks must not be empty");
      assert.ok(blocks.length <= 36, "cleaned_source_blocks should stay compact");
      assert.ok(
        blocks.some((block) => block.block_type === "primary_document_excerpt"),
        "primary document excerpt is required",
      );
      assert.ok(
        blocks.every(
          (block) =>
            typeof block.block_type === "string" &&
            typeof block.label === "string" &&
            typeof block.source === "string" &&
            typeof block.text === "string" &&
            block.text.length > 0 &&
            block.text.length <= 12_000,
        ),
        "each source block must be compact and source-backed",
      );

      const serialized = JSON.stringify(output);
      assert.ok(!serialized.includes("router_decision"));
      assert.ok(!serialized.includes("display_type_hint"));
    });
  }
});
