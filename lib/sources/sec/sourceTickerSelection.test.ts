import assert from "node:assert/strict";
import test from "node:test";
import {
  selectSourceBackedSecTickerRow,
  type SecTickerSelectionRow,
} from "./sourceTickerSelection.ts";

const alphabetRows: SecTickerSelectionRow[] = [
  { cik: "0001652044", ticker: "GOOG", exchange: "Nasdaq", name: "Alphabet Inc." },
  { cik: "0001652044", ticker: "GOOGL", exchange: "Nasdaq", name: "Alphabet Inc." },
  { cik: "0001652044", ticker: "GOOGM", exchange: "Nasdaq", name: "Alphabet Inc." },
  { cik: "0001652044", ticker: "GOOGN", exchange: "Nasdaq", name: "Alphabet Inc." },
];

for (const sourceTicker of ["GOOG", "GOOGL"]) {
  test(`SEC source ticker ${sourceTicker} remains primary`, () => {
    assert.equal(
      selectSourceBackedSecTickerRow(alphabetRows, sourceTicker)?.ticker,
      sourceTicker,
    );
  });
}
