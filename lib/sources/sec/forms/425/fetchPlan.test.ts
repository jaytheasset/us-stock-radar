import assert from "node:assert/strict";

import { matchesSecFormFetchRule } from "../common/fetchPlan";
import { sec425FetchPlan } from "./fetchPlan";

const transactionCommunications = sec425FetchPlan.rules.find(
  (rule) => rule.id === "transaction-communications",
);
const dealAgreementReference = sec425FetchPlan.rules.find((rule) => rule.id === "deal-agreement-reference");

assert.ok(transactionCommunications);
assert.ok(dealAgreementReference);

assert.equal(
  matchesSecFormFetchRule(
    {
      type: "GRAPHIC",
      description: null,
      document: "psbnewsletter052226001.jpg",
      url: "https://www.sec.gov/Archives/edgar/data/example/psbnewsletter052226001.jpg",
    },
    transactionCommunications,
  ),
  false,
);

assert.equal(
  matchesSecFormFetchRule(
    {
      type: "EX-99.1",
      description: "Investor Presentation",
      document: "ex99-1.htm",
      url: "https://www.sec.gov/Archives/edgar/data/example/ex99-1.htm",
    },
    transactionCommunications,
  ),
  true,
);

assert.equal(
  matchesSecFormFetchRule(
    {
      type: "GRAPHIC",
      description: "Logo",
      document: "shareholder-letter-logo.jpg",
      url: "https://www.sec.gov/Archives/edgar/data/example/shareholder-letter-logo.jpg",
    },
    transactionCommunications,
  ),
  false,
);

assert.equal(
  matchesSecFormFetchRule(
    {
      type: "CORRESP",
      description: "Shareholder Letter",
      document: "shareholder-letter.htm",
      url: "https://www.sec.gov/Archives/edgar/data/example/shareholder-letter.htm",
    },
    transactionCommunications,
  ),
  true,
);

assert.equal(
  matchesSecFormFetchRule(
    {
      type: "EX-10.1",
      description: "Target Extension Promissory Note",
      document: "ex10-1.htm",
      url: "https://www.sec.gov/Archives/edgar/data/example/ex10-1.htm",
    },
    dealAgreementReference,
  ),
  true,
);

console.log("sec 425 fetch plan fixtures passed");
