import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseOwnershipFiling } from "./parser.ts";

const here = dirname(fileURLToPath(import.meta.url));

const sourceFixtureFiles = [
  "fixtures/source-agig-form4-purchase.json",
  "fixtures/source-uwmc-form4-multi-owner-10b5-1-conversion.json",
  "fixtures/source-venu-form4-section16-derivative-gift.json",
  "fixtures/source-amcor-form144-no-prior-sales.json",
  "fixtures/source-globe-form144a-no-remarks.json",
  "fixtures/source-walmart-form144-namespaced.json",
];

interface SourceFixture {
  id: string;
  formType: string;
  accessionNumber: string;
  source: {
    url: string;
    retrieved_at: string;
    sha256: string;
  };
  filingText: string;
  expected: Array<{
    label: string;
    path: string;
    value: unknown;
    evidence?: string;
    evidenceTag?: string;
  }>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(here, relativePath), "utf8")) as T;
}

test("ownership parser matches source-backed SEC filing fixtures", () => {
  for (const fixtureFile of sourceFixtureFiles) {
    const fixture = readJson<SourceFixture>(fixtureFile);
    assert.equal(
      createHash("sha256").update(fixture.filingText).digest("hex"),
      fixture.source.sha256,
      `${fixture.id}: stored SEC source hash changed`,
    );

    const parsed = parseOwnershipFiling({
      id: fixture.id,
      formType: fixture.formType,
      accessionNumber: fixture.accessionNumber,
      filingText: fixture.filingText,
    });

    for (const check of fixture.expected) {
      if (check.evidence) {
        assert.ok(
          fixture.filingText.includes(check.evidence),
          `${fixture.id} ${check.label}: source evidence missing: ${check.evidence}`,
        );
      }
      if (check.evidenceTag) {
        assert.ok(
          new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(check.evidenceTag)}\\b`, "i").test(
            fixture.filingText,
          ),
          `${fixture.id} ${check.label}: source tag missing: ${check.evidenceTag}`,
        );
      }
      assert.deepEqual(
        getPath(parsed, check.path),
        check.value,
        `${fixture.id} ${check.label}: parser output did not match SEC source-backed expected value`,
      );
    }
  }
});

function getPath(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (segment === "length" && Array.isArray(value)) {
      return value.length;
    }
    if (/^\d+$/.test(segment) && Array.isArray(value)) {
      return value[Number(segment)];
    }
    if (typeof value === "object" && segment in value) {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
