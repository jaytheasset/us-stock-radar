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
  assert.match(sections, /field\.label === "Conversion"/);
});
