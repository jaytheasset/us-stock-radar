import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFile(`${root}/${path}`, "utf8");
const fixtureSet = "news_filings_local_qa_v1";
const beginMarker = `-- BEGIN News/Filings local QA fixtures (${fixtureSet})`;
const endMarker = `-- END News/Filings local QA fixtures (${fixtureSet})`;

function readFixtureBlock(seed: string) {
  const start = seed.indexOf(beginMarker);
  const end = seed.indexOf(endMarker);

  assert.ok(start >= 0, "News/Filings fixture BEGIN marker must exist");
  assert.ok(end > start, "News/Filings fixture END marker must follow BEGIN");
  return seed.slice(start, end + endMarker.length);
}

function fixtureLine(block: string, id: string) {
  const line = block.split("\n").find((candidate) => candidate.includes(id));
  assert.ok(line, `fixture row ${id} must exist`);
  return line;
}

function sqlTupleFieldCount(line: string) {
  let depth = 0;
  let fields = 1;
  let inString = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && inString && line[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === "'") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 1) fields += 1;
  }

  assert.equal(inString, false, "fixture tuple must close every SQL string");
  assert.equal(depth, 0, "fixture tuple must balance parentheses");
  return fields;
}

test("News and Filings seed sources are disabled synthetic local fixtures", async () => {
  const seed = await read("supabase/seed.sql");
  const block = readFixtureBlock(seed);

  assert.match(seed, /^begin;/);
  assert.match(seed, /commit;\s*$/);
  assert.match(block, /insert into public\.sources as existing/);
  assert.match(block, /'local-news-qa',\s*'Local QA News',\s*'news'::public\.source_group,\s*'manual'::public\.runtime_owner,\s*false/);
  assert.match(block, /'local-filings-qa',\s*'Local QA Filings',\s*'filings'::public\.source_group,\s*'manual'::public\.runtime_owner,\s*false/);
  assert.match(block, /'local_only', true/);
  assert.match(block, /'synthetic', true/);
  assert.match(block, /'not_provider_observation', true/);
  assert.match(block, new RegExp(`'fixture_set', '${fixtureSet}'`));
  assert.match(block, /on conflict \(code\) do update/);
  assert.equal(block.match(/on conflict \(id\) do update/g)?.length, 2);
});

test("fixture SQL targets the canonical source, event, and enum schema", async () => {
  const schema = await read(
    "supabase/migrations/20260728113243_canonical_baseline.sql",
  );
  const sourceTable = schema.match(
    /CREATE TABLE IF NOT EXISTS "public"\."sources" \(([\s\S]*?)\n\);/,
  )?.[1];
  const eventTable = schema.match(
    /CREATE TABLE IF NOT EXISTS "public"\."events" \(([\s\S]*?)\n\);/,
  )?.[1];

  assert.ok(sourceTable);
  assert.ok(eventTable);
  for (const column of [
    "code",
    "name",
    "source_group",
    "runtime_owner",
    "enabled",
    "poll_interval_seconds",
    "metadata",
  ]) {
    assert.match(sourceTable, new RegExp(`"${column}"`));
  }
  for (const column of [
    "id",
    "raw_item_id",
    "source_code",
    "source_group",
    "source_name",
    "source_url",
    "published_at",
    "ticker",
    "market",
    "event_type",
    "score",
    "delivery_level",
    "impact",
    "signal",
    "market_scope",
    "sector",
    "industry_group",
    "theme_group",
    "sub_theme",
    "title",
    "quick_take",
    "summary",
    "reason",
    "event_date",
    "detected_at",
    "group_dedupe_key",
    "cross_group_event_key",
    "metadata",
  ]) {
    assert.match(eventTable, new RegExp(`"${column}"`));
  }
  assert.match(schema, /CREATE TYPE "public"\."event_delivery_level" AS ENUM \(\s*'archive',\s*'feed',\s*'alert'/);
  assert.match(schema, /CREATE TYPE "public"\."event_signal" AS ENUM \(\s*'bullish',\s*'bearish',\s*'volatile',\s*'neutral'/);
  assert.match(schema, /CREATE TYPE "public"\."runtime_owner" AS ENUM \([\s\S]*'manual'/);
});

test("News fixtures preserve all linked IDs and cover public taxonomy", async () => {
  const seed = await read("supabase/seed.sql");
  const taxonomy = await read("lib/taxonomyRegistry.ts");
  const block = readFixtureBlock(seed);
  const newsBlock = block.slice(
    block.indexOf("with news_fixtures"),
    block.indexOf("with filing_fixtures"),
  );
  const visibleNewsIds = [
    "94000000-0000-4000-8000-000000000001",
    ...Array.from(
      { length: 21 },
      (_, index) => `97000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ];
  const publicEventTypes = [
    "listing_risk",
    "dilution_risk",
    "earnings",
    "sales_performance",
    "product_update",
    "leadership_governance",
    "insider_ownership",
    "ipo_listing",
    "shareholder_vote",
    "strategic_transaction",
    "financial_risk",
    "legal_risk",
    "dividends",
    "capital_return",
    "fda_clinical",
    "policy_regulation",
    "macro_market",
  ];
  const themeGroups = [
    "ai_data_center",
    "crypto_digital_assets",
    "healthcare_momentum",
    "power_energy_resources",
    "defense_geopolitics",
    "rates_credit_banks",
    "retail_momentum_flows",
    "policy_regulation",
  ];
  const representativeSubThemes = [
    "ai_chips_hbm",
    "bitcoin",
    "glp1_obesity_drugs",
    "nuclear_uranium",
    "defense_spending",
    "interest_rates",
    "quantum_computing",
    "antitrust_big_tech_scrutiny",
  ];
  const newsRows = newsBlock
    .split("\n")
    .filter((line) => line.trimStart().startsWith("('") && line.includes("news-"));

  assert.equal(newsRows.length, 24);
  for (const row of newsRows) assert.equal(sqlTupleFieldCount(row), 16);
  for (const id of visibleNewsIds) {
    assert.doesNotMatch(fixtureLine(newsBlock, id), /'archive'/);
  }
  for (const eventType of publicEventTypes) {
    assert.match(newsBlock, new RegExp(`'${eventType}'`));
  }
  for (const themeGroup of themeGroups) {
    assert.match(newsBlock, new RegExp(`'${themeGroup}'`));
    assert.match(taxonomy, new RegExp(`slug: "${themeGroup}"`));
  }
  for (const subTheme of representativeSubThemes) {
    assert.match(newsBlock, new RegExp(`'${subTheme}'`));
    assert.match(taxonomy, new RegExp(`"${subTheme}"`));
  }

  assert.match(fixtureLine(newsBlock, visibleNewsIds[0]), /75, 'alert'/);
  assert.match(fixtureLine(newsBlock, visibleNewsIds[1]), /50, 'feed'/);
  assert.match(fixtureLine(newsBlock, visibleNewsIds[2]), /74, 'feed'/);
  assert.match(fixtureLine(newsBlock, "97000000-0000-4000-8000-000000000022"), /49, 'archive'/);
  assert.match(fixtureLine(newsBlock, "97000000-0000-4000-8000-000000000023"), /35, 'archive'/);
  assert.match(newsBlock, /transaction_timestamp\(\) - fixture\.age/);
  assert.match(newsBlock, /'local-qa:news:' \|\| fixture\.scenario_id/);
});

test("Filings fixtures cover form, delivery, and archive scenarios", async () => {
  const seed = await read("supabase/seed.sql");
  const block = readFixtureBlock(seed);
  const filingBlock = block.slice(block.indexOf("with filing_fixtures"));
  const filingIds = [
    "94000000-0000-4000-8000-000000000002",
    ...Array.from(
      { length: 5 },
      (_, index) => `98000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ];
  const filingRows = filingBlock
    .split("\n")
    .filter((line) => line.trimStart().startsWith("('") && line.includes("filing-"));

  assert.equal(filingRows.length, 6);
  for (const row of filingRows) assert.equal(sqlTupleFieldCount(row), 15);
  for (const id of filingIds) fixtureLine(filingBlock, id);
  for (const formType of ["8-K", "10-Q", "S-3", "SC 13D", "4"]) {
    assert.match(filingBlock, new RegExp(`'${formType}'`));
  }
  assert.match(fixtureLine(filingBlock, filingIds[0]), /75, 'alert'/);
  assert.match(fixtureLine(filingBlock, filingIds[1]), /74, 'feed'/);
  assert.match(fixtureLine(filingBlock, filingIds[3]), /50, 'feed'/);
  assert.match(fixtureLine(filingBlock, filingIds[4]), /49, 'archive'/);
  assert.match(fixtureLine(filingBlock, filingIds[5]), /35, 'archive'/);
  assert.match(filingBlock, /'accession_number', fixture\.accession_number/);
  assert.match(filingBlock, /'form_type', fixture\.form_type/);
  assert.match(filingBlock, /'company_name', fixture\.company_name/);
});

test("fixtures expose no provider URL or user and delivery side effects", async () => {
  const seed = await read("supabase/seed.sql");
  const block = readFixtureBlock(seed);
  const writesBeforeCleanup = block.slice(0, block.indexOf("-- Remove only"));

  assert.doesNotMatch(writesBeforeCleanup, /'browser-news'|'browser-filing'/);
  assert.doesNotMatch(block, /https?:\/\//);
  assert.equal(block.match(/source_url = null/g)?.length, 2);
  assert.match(block, /'Local QA News',\s*null,\s*transaction_timestamp/);
  assert.match(block, /'Local QA Filings',\s*null,\s*transaction_timestamp/);
  assert.doesNotMatch(
    block,
    /insert into public\.(?:raw_[a-z0-9_]+|provider_[a-z0-9_]+|user_[a-z0-9_]+|[a-z0-9_]*follow[a-z0-9_]*|[a-z0-9_]*history[a-z0-9_]*|[a-z0-9_]*alert[a-z0-9_]*|[a-z0-9_]*deliver[a-z0-9_]*)/i,
  );
});

test("obsolete browser codes are removed only when orphaned", async () => {
  const seed = await read("supabase/seed.sql");
  const block = readFixtureBlock(seed);

  assert.match(
    block,
    /delete from public\.sources as source[\s\S]*source\.code in \('browser-news', 'browser-filing'\)[\s\S]*not exists \([\s\S]*event\.source_code = source\.code[\s\S]*\);/,
  );
  assert.match(
    block,
    /delete from public\.event_types as event_type[\s\S]*event_type\.code in \('browser-news', 'browser-filing'\)[\s\S]*not exists \([\s\S]*event\.event_type = event_type\.code[\s\S]*\);/,
  );
});
