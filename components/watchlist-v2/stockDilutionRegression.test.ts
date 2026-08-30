import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock detail dilution uses the own-data API and never passes the FMP snapshot", async () => {
  const client = await readFile(
    new URL("./StockRadarWatchlistV2.tsx", import.meta.url),
    "utf8",
  );
  const sections = await readFile(
    new URL("./StockFundamentalsSections.tsx", import.meta.url),
    "utf8",
  );
  const sectionCss = await readFile(
    new URL("./StockFundamentalsSections.module.css", import.meta.url),
    "utf8",
  );
  const ownSection = sections.slice(
    sections.indexOf("function DilutionSection("),
    sections.indexOf("function FmpDilutionSection("),
  );
  const instrumentCard = sections.slice(
    sections.indexOf("function DilutionInstrumentCard("),
    sections.indexOf("function DilutionActivityRow("),
  );

  assert.match(client, /\/api\/market\/dilution\?symbol=/);
  assert.match(client, /dilutionSnapshot=\{dilution\}/);
  assert.match(ownSection, /data-dilution-source="stock-radar"/);
  assert.match(ownSection, /Last Checked/);
  assert.match(ownSection, /Float Shares/);
  assert.match(ownSection, /Free Float/);
  assert.doesNotMatch(ownSection, /weightedAverageShsOutDil|stockBasedCompensation|calculateTrailingEquityCashFlow/);
  assert.doesNotMatch(instrumentCard, /Last Checked/);
  assert.match(
    sectionCss,
    /\.dilutionInstrumentGrid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?border-top:/,
  );
  assert.match(
    sectionCss,
    /\.dilutionInstrumentCard \{[\s\S]*?border: 0;[\s\S]*?border-bottom:/,
  );
  assert.match(
    sectionCss,
    /@media \(max-width: 760px\) \{[\s\S]*?\.dilutionInstrumentCard \{[\s\S]*?border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);/,
  );
  assert.match(sections, /const DILUTION_WIDE_CONVERSION_MIN_CHARACTERS = 32/);
  assert.match(
    instrumentCard,
    /field\.label === "Conversion" &&[\s\S]*?field\.value\.length >= DILUTION_WIDE_CONVERSION_MIN_CHARACTERS/,
  );
});

test("stock detail dilution renders the membership response without hidden paid values", async () => {
  const client = await readFile(
    new URL("./StockRadarWatchlistV2.tsx", import.meta.url),
    "utf8",
  );
  const sections = await readFile(
    new URL("./StockFundamentalsSections.tsx", import.meta.url),
    "utf8",
  );
  const preview = sections.slice(
    sections.indexOf("function DilutionInstrumentPreview("),
    sections.indexOf("function getDilutionLockHref("),
  );

  assert.match(client, /StockDilutionMembershipResponse/);
  assert.match(client, /!candidate\.access/);
  assert.match(client, /!candidate\.counts/);
  assert.match(sections, /count=\{data\.counts\.current\}/);
  assert.match(sections, /<span>Current \{data\.counts\.current\}<\/span>/);
  assert.match(sections, /showDetails=\{data\.access\.canViewCurrentDetails\}/);
  assert.match(sections, /data\.access\.canViewActivity \?/);
  assert.match(sections, /data\.access\.canViewHistory \?/);
  assert.match(sections, /View all contracts with Pro/);
  assert.match(sections, /View issuance and conversion activity with Advanced/);
  assert.match(sections, /View dilution history with Advanced/);
  assert.match(preview, /instrument\.name/);
  assert.match(preview, /instrument\.type/);
  assert.match(preview, /instrument\.status/);
  assert.match(preview, /instrument\.asOf/);
  assert.doesNotMatch(
    preview,
    /originalAmount|remainingAmount|remainingUnits|remainingPotentialShares|conversionPrice|exercisePrice|priceFormula|interestRate|sharesIssued/,
  );
});

test("dilution locks reuse signup return URLs for guests and premium for members", async () => {
  const sections = await readFile(
    new URL("./StockFundamentalsSections.tsx", import.meta.url),
    "utf8",
  );
  const hrefHelper = sections.slice(
    sections.indexOf("function getDilutionLockHref("),
    sections.indexOf("function instrumentTypeLabel("),
  );

  assert.match(hrefHelper, /if \(!isGuest\) return "\/premium"/);
  assert.match(hrefHelper, /`\/signup\?next=\$\{encodeURIComponent\(`\/stocks\/\$\{symbol\}`\)\}`/);
});
