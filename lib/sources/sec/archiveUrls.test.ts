import assert from "node:assert/strict";
import {
  buildSecArchiveFilingUrls,
  buildSecArchiveIndexUrlFromMasterFilename,
} from "./archiveUrls.ts";

const capricor = buildSecArchiveFilingUrls("0001133869", "0001104659-26-078327");
assert.deepEqual(capricor, {
  archiveDirectoryUrl:
    "https://www.sec.gov/Archives/edgar/data/1133869/000110465926078327",
  indexJsonUrl:
    "https://www.sec.gov/Archives/edgar/data/1133869/000110465926078327/index.json",
  indexHtmlUrl:
    "https://www.sec.gov/Archives/edgar/data/1133869/000110465926078327/0001104659-26-078327-index.html",
  submissionTextUrl:
    "https://www.sec.gov/Archives/edgar/data/1133869/000110465926078327/0001104659-26-078327.txt",
});

assert.equal(
  buildSecArchiveIndexUrlFromMasterFilename(
    "edgar/data/1133869/0001104659-26-078327.txt",
  ),
  capricor?.indexHtmlUrl,
);
assert.equal(
  buildSecArchiveIndexUrlFromMasterFilename(
    "/edgar/data/1133869/000110465926078327/0001104659-26-078327.TXT",
  ),
  capricor?.indexHtmlUrl,
);
assert.equal(
  buildSecArchiveIndexUrlFromMasterFilename(
    "edgar\\data\\1133869\\0001104659-26-078327.txt",
  ),
  capricor?.indexHtmlUrl,
);
assert.equal(
  buildSecArchiveIndexUrlFromMasterFilename(
    "edgar/data/1133869/not-an-accession.txt",
  ),
  null,
);
assert.equal(buildSecArchiveFilingUrls("not-a-cik", "0001104659-26-078327"), null);
assert.equal(buildSecArchiveFilingUrls("1133869", "000110465926078327"), null);

console.log("SEC archive URL tests passed.");
