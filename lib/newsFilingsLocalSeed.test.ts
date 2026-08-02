import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const seedPath = `${process.cwd()}/supabase/seed.sql`;

test("News and Filings QA fixtures stay out of the seed", async () => {
  const seed = await readFile(seedPath, "utf8");
  const removedIds = [
    "94000000-0000-4000-8000-000000000001",
    "94000000-0000-4000-8000-000000000002",
    ...Array.from(
      { length: 23 },
      (_, index) => `97000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
    ...Array.from(
      { length: 5 },
      (_, index) => `98000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ];

  assert.match(seed, /^begin;/);
  assert.match(seed, /commit;\s*$/);
  assert.doesNotMatch(seed, /local-news-qa|local-filings-qa/);
  assert.doesNotMatch(seed, /news_filings_local_qa_v1/);

  for (const id of removedIds) {
    assert.equal(seed.includes(id), false, `${id} must not be recreated by the seed`);
  }
});
