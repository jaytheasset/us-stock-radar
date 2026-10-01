import assert from "node:assert/strict";
import test from "node:test";
import { readSecLineageFilingDate, secLineageParentDateFilter } from "./secFilingDate.ts";

test("ingestion and legacy date spellings agree; missing, conflicting and invalid dates fail closed", () => {
  for (const payload of [{filing_date:"2024-06-17"},{filed_date:"2024-06-17"},
    {filing_date:"2024-06-17",filed_date:"2024-06-17"}]) {
    assert.equal(readSecLineageFilingDate(payload),"2024-06-17");
  }
  for (const payload of [null,{}, {filing_date:"2024-06-17",filed_date:"2024-06-18"},
    {filing_date:"2024-02-30"}, {filed_date:"2023-02-29"}, {filing_date:"0000-01-01"},
    {filing_date:123}, {filing_date:"2024-06-17T12:00:00Z"},
    {filing_date:"2024-06-17",filed_date:"bad"}]) assert.equal(readSecLineageFilingDate(payload),null);
  assert.equal(readSecLineageFilingDate({filing_date:"2024-02-29"}),"2024-02-29");
  assert.deepEqual(secLineageParentDateFilter("2024-06-17"),{
    or:"(raw_payload->>filing_date.eq.2024-06-17,raw_payload->>filed_date.eq.2024-06-17)",
  });
  assert.throws(()=>secLineageParentDateFilter(null));
  assert.throws(()=>secLineageParentDateFilter("2024-06-17),cik.eq.1"));
});
