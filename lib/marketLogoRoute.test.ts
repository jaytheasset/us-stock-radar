import assert from "node:assert/strict";
import test from "node:test";
import { preferredCompanyLogoUrl } from "./companyLogoAsset.ts";

test("market logo route prefers the square provider icon", () => {
  assert.equal(
    preferredCompanyLogoUrl({
      iconUrl: "https://api.polygon.io/v3/reference/tickers/CEG/icon",
      logoUrl: "https://api.polygon.io/v3/reference/tickers/CEG/logo",
    }),
    "https://api.polygon.io/v3/reference/tickers/CEG/icon",
  );
});

test("market logo route falls back to the provider wordmark", () => {
  assert.equal(
    preferredCompanyLogoUrl({
      iconUrl: null,
      logoUrl: "https://api.polygon.io/v3/reference/tickers/CEG/logo",
    }),
    "https://api.polygon.io/v3/reference/tickers/CEG/logo",
  );
});
