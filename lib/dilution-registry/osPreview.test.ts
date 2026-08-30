import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateDilutionRegistryOsPreview,
  type DilutionRegistryOsSourceBundle,
} from "./osPreview.ts";
import {
  fetchOfficialSecFilingDocument,
  isSafeSecSourceRef,
} from "./osPreviewSecFallback.ts";
import type { DilutionRegistryPayload } from "./preview.ts";

const evidence =
  "As of August 10, 2026, there were 62,214,156 shares of the registrant’s common stock issued and outstanding.";
const s3Evidence =
  "The aggregate market value\nof our outstanding common stock held by non-affiliates pursuant to General Instruction I.B.6 of Form S-3 was $20,529,470, which was calculated\nbased on 55,116,953 shares of common stock outstanding, as of June 24, 2026, of which 29,602,697 shares were held by non-affiliates, and\na price per share of $0.6935 which was the closing sale price of our common stock on the Nasdaq Capital Market on May 27, 2026, and which\nwas within 60 days of the filing of the registration statement of which this prospectus forms a part.";
const b424Evidence =
  "As of the date of this prospectus\nsupplement, the aggregate market value of our outstanding common stock held by non-affiliates pursuant to General Instruction I.B.6\nof Form S-3 was $13,061,451, which was calculated based on 62,214,156 shares of common stock outstanding, as of August 11, 2026, of which\n36,959,400 shares were held by non-affiliates, and a price per share of $0.3534, which was the closing sale price of our common stock\non the Nasdaq Capital Market on June 15, 2026, and which was within 60 days of the date of the Sales Agreement.";
const q1BaselineFixture = {
  sourceAccession: "0001213900-26-057059",
  sourceForm: "10-Q",
  sourceRef: "ea0290631-10q_veea.htm",
  asOf: "2026-05-13",
  securityClassTitle: "Common Stock",
  sharesOutstanding: "50407567",
  classStatus: "COMPLETE_SINGLE",
  resolverStatus: "RESOLVED",
  issuerTotal: "50407567",
} as const;

function candidate(
  override: Record<string, unknown> = {},
): DilutionRegistryPayload {
  return {
    issuer: { issuer_cik: "0001840317", ticker: "VEEA" },
    instruments: [],
    snapshots: [],
    activities: [],
    totals: [],
    os_observations: [
      {
        observation_type: "source_stated",
        shares_outstanding: "62214156",
        as_of: "2026-08-10",
        security_class_kind: "common_stock",
        security_class_title: "common stock",
        source_accession: "0001213900-26-087946",
        source_form: "10-Q",
        source_ref: "ea0301195-10q_veea.htm",
        evidence,
        ...override,
      },
    ],
  };
}

function sourceBundle(
  override: Partial<DilutionRegistryOsSourceBundle> = {},
): DilutionRegistryOsSourceBundle {
  return {
    ok: true,
    sourceMode: "stored",
    classUniverseMode: "exact_filing",
    ledger: {
      issuer_cik: "0001840317",
      accession_number: "0001213900-26-087946",
      form: "10-Q",
      primary_document: "ea0301195-10q_veea.htm",
    },
    documents: [
      {
        source_ref: "ea0301195-10q_veea.htm",
        source_url:
          "https://www.sec.gov/Archives/edgar/data/1840317/000121390026087946/ea0301195-10q_veea.htm",
        document_name: "ea0301195-10q_veea.htm",
        text: evidence,
      },
    ],
    classUniverse: {
      issuer_cik: "0001840317",
      source_accession: "0001213900-26-087946",
      source_form: "10-Q",
      universe_as_of: "2026-08-10",
      source_documents: ["ea0301195-10q_veea.htm"],
      status: "COMPLETE_SINGLE",
      reason: "COMPLETE_SINGLE_COMMON_STOCK",
      required_canonical_security_class_ids: [
        "sc:v1:0001840317:common_stock:single",
      ],
      class_evidence: [{ sharesOutstanding: "62214156" }],
    },
    ...override,
  };
}

function s3Candidate(
  override: Record<string, unknown> = {},
): DilutionRegistryPayload {
  return {
    issuer: { issuer_cik: "0001840317", ticker: "VEEA" },
    instruments: [],
    snapshots: [],
    activities: [],
    totals: [],
    os_observations: [
      {
        observation_type: "source_stated",
        shares_outstanding: "55116953",
        as_of: "2026-06-24",
        security_class_kind: "common_stock",
        security_class_title: "common stock",
        source_accession: "0001213900-26-072701",
        source_form: "S-3",
        source_ref: "ea0295954-s3_veea.htm",
        evidence: s3Evidence,
        ...override,
      },
    ],
  };
}

function s3SourceBundle(): DilutionRegistryOsSourceBundle {
  return {
    ...sourceBundle(),
    sourceMode: "official_sec_fallback",
    classUniverseMode: "issuer_reference",
    ledger: {
      issuer_cik: "0001840317",
      accession_number: "0001213900-26-072701",
      form: "S-3",
      primary_document: "ea0295954-s3_veea.htm",
    },
    documents: [
      {
        source_ref: "ea0295954-s3_veea.htm",
        source_url:
          "https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/ea0295954-s3_veea.htm",
        document_name: "ea0295954-s3_veea.htm",
        text: s3Evidence,
      },
    ],
  };
}

function q1BaselineClassUniverse(): NonNullable<
  DilutionRegistryOsSourceBundle["classUniverse"]
> {
  return {
    ...sourceBundle().classUniverse!,
    source_accession: q1BaselineFixture.sourceAccession,
    source_form: q1BaselineFixture.sourceForm,
    universe_as_of: q1BaselineFixture.asOf,
    source_documents: [q1BaselineFixture.sourceRef],
    status: q1BaselineFixture.classStatus,
    reason: "COMPLETE_SINGLE_COMMON_STOCK",
    class_evidence: [{ sharesOutstanding: q1BaselineFixture.sharesOutstanding }],
  };
}

function b424Candidate(): DilutionRegistryPayload {
  return {
    issuer: { issuer_cik: "0001840317", ticker: "VEEA" },
    instruments: [],
    snapshots: [],
    activities: [],
    totals: [],
    os_observations: [
      {
        observation_type: "source_stated",
        shares_outstanding: "62214156",
        as_of: "2026-08-11",
        security_class_kind: "common_stock",
        security_class_title: "common stock",
        source_accession: "0001213900-26-088706",
        source_form: "424B5",
        source_ref: "ea0301578-424b5_veea.htm",
        evidence: b424Evidence,
      },
    ],
  };
}

function b424SourceBundle(): DilutionRegistryOsSourceBundle {
  return {
    ...sourceBundle(),
    sourceMode: "official_sec_fallback",
    classUniverseMode: "issuer_reference",
    ledger: {
      issuer_cik: "0001840317",
      accession_number: "0001213900-26-088706",
      form: "424B5",
      primary_document: "ea0301578-424b5_veea.htm",
    },
    documents: [
      {
        source_ref: "ea0301578-424b5_veea.htm",
        source_url:
          "https://www.sec.gov/Archives/edgar/data/1840317/000121390026088706/ea0301578-424b5_veea.htm",
        document_name: "ea0301578-424b5_veea.htm",
        text: b424Evidence,
      },
    ],
  };
}

async function preview(
  payload: DilutionRegistryPayload,
  bundle = sourceBundle(),
) {
  let reads = 0;
  const rows = await validateDilutionRegistryOsPreview(payload, {
    async readSourceBundle() {
      reads += 1;
      return bundle;
    },
  });
  return { reads, rows };
}

test("the real stored VEEA source-stated candidate is Verified without calculation", async () => {
  const result = await preview(candidate());
  assert.equal(result.reads, 1);
  assert.deepEqual(result.rows, [
    {
      index: 0,
      status: "Verified",
      sharesOutstanding: "62214156",
      asOf: "2026-08-10",
      securityClassTitle: "common stock",
      sourceAccession: "0001213900-26-087946",
      sourceForm: "10-Q",
      sourceRef: "ea0301195-10q_veea.htm",
      evidence,
      sourceCheck:
        "Exact stored SEC filing, source_ref, contiguous evidence, stated shares/date/class, and single-common-class source match.",
      reasons: [],
    },
  ]);
});

test("a deliberate one-share mismatch is Not Verified", async () => {
  const result = await preview(candidate({ shares_outstanding: "62214155" }));
  assert.equal(result.rows[0]?.status, "Not Verified");
  assert.match(result.rows[0]?.reasons.join(" ") ?? "", /digits do not exactly match/i);
});

test("future or hypothetical O/S wording cannot be Verified", async () => {
  for (const futureEvidence of [
    "Following the offering, 70,000,000 shares of common stock are expected to be outstanding as of August 10, 2026.",
    "Pro forma shares of common stock outstanding as of August 10, 2026 are estimated to be 70,000,000.",
  ]) {
    const result = await preview(
      candidate({ shares_outstanding: "70000000", evidence: futureEvidence }),
      sourceBundle({
        documents: [
          {
            source_ref: "ea0301195-10q_veea.htm",
            source_url:
              "https://www.sec.gov/Archives/edgar/data/1840317/000121390026087946/ea0301195-10q_veea.htm",
            document_name: "ea0301195-10q_veea.htm",
            text: futureEvidence,
          },
        ],
        classUniverse: {
          ...sourceBundle().classUniverse!,
          class_evidence: [{ sharesOutstanding: "70000000" }],
        },
      }),
    );
    assert.equal(result.rows[0]?.status, "Not Verified", futureEvidence);
    assert.match(
      result.rows[0]?.reasons.join(" ") ?? "",
      /future, hypothetical, projected, pro forma, or post-offering/i,
    );
  }
});

test("a future issuer-reference snapshot cannot verify an earlier S-3 observation", async () => {
  const result = await preview(s3Candidate(), s3SourceBundle());
  assert.equal(result.reads, 1);
  assert.equal(result.rows[0]?.status, "Review");
  assert.equal(result.rows[0]?.sharesOutstanding, "55116953");
  assert.equal(result.rows[0]?.asOf, "2026-06-24");
  assert.match(
    result.rows[0]?.reasons.join(" ") ?? "",
    /later than the observation date/i,
  );
});

test("the latest eligible prior issuer-reference snapshot can verify the S-3", async () => {
  const bundle = s3SourceBundle();
  bundle.classUniverse = q1BaselineClassUniverse();
  const result = await preview(s3Candidate(), bundle);
  assert.equal(result.rows[0]?.status, "Verified");
  assert.equal(
    result.rows[0]?.sourceCheck,
    "Exact official SEC fallback filing, source_ref, contiguous evidence, stated shares/date/class, and stored issuer single-common-class confirmation.",
  );
});

test("the recorded VEEA Q1 baseline is COMPLETE_SINGLE and RESOLVED at 50,407,567", () => {
  const universe = q1BaselineClassUniverse();
  assert.deepEqual(q1BaselineFixture, {
    sourceAccession: "0001213900-26-057059",
    sourceForm: "10-Q",
    sourceRef: "ea0290631-10q_veea.htm",
    asOf: "2026-05-13",
    securityClassTitle: "Common Stock",
    sharesOutstanding: "50407567",
    classStatus: "COMPLETE_SINGLE",
    resolverStatus: "RESOLVED",
    issuerTotal: "50407567",
  });
  assert.equal(universe.status, "COMPLETE_SINGLE");
  assert.deepEqual(universe.class_evidence, [{ sharesOutstanding: "50407567" }]);
  assert.equal(q1BaselineFixture.resolverStatus, "RESOLVED");
  assert.equal(q1BaselineFixture.issuerTotal, "50407567");
  assert.doesNotMatch(JSON.stringify({ q1BaselineFixture, universe }), /62214156|62,214,156/);
});

test("the real VEEA 424B5 is Verified using the 2026-08-10 class baseline", async () => {
  const bundle = b424SourceBundle();
  assert.equal(bundle.classUniverse?.universe_as_of, "2026-08-10");
  const result = await preview(b424Candidate(), bundle);
  assert.equal(result.reads, 1);
  assert.equal(result.rows[0]?.status, "Verified");
  assert.equal(result.rows[0]?.sharesOutstanding, "62214156");
  assert.equal(result.rows[0]?.asOf, "2026-08-11");
  assert.equal(result.rows[0]?.sourceAccession, "0001213900-26-088706");
  assert.equal(result.rows[0]?.sourceRef, "ea0301578-424b5_veea.htm");
  assert.equal(
    result.rows[0]?.sourceCheck,
    "Exact official SEC fallback filing, source_ref, contiguous evidence, stated shares/date/class, and stored issuer single-common-class confirmation.",
  );
});

test("S-3 one-share and evidence-date mismatches are Not Verified without correction", async () => {
  const oneShare = await preview(
    s3Candidate({ shares_outstanding: "55116954" }),
    s3SourceBundle(),
  );
  assert.equal(oneShare.rows[0]?.status, "Not Verified");
  assert.equal(oneShare.rows[0]?.sharesOutstanding, "55116954");
  assert.notEqual(oneShare.rows[0]?.sharesOutstanding, "55116953");
  assert.match(oneShare.rows[0]?.reasons.join(" ") ?? "", /digits do not exactly match/i);

  const date = await preview(
    s3Candidate({ as_of: "2026-06-23" }),
    s3SourceBundle(),
  );
  assert.equal(date.rows[0]?.status, "Not Verified");
  assert.equal(date.rows[0]?.asOf, "2026-06-23");
  assert.match(date.rows[0]?.reasons.join(" ") ?? "", /date does not exactly match/i);
});

test("a source_ref or contiguous evidence mismatch is Not Verified", async () => {
  const sourceRef = await preview(candidate({ source_ref: "missing-document.htm" }));
  assert.equal(sourceRef.rows[0]?.status, "Not Verified");
  assert.match(sourceRef.rows[0]?.reasons.join(" ") ?? "", /source_ref/i);

  const mismatchedEvidence = await preview(
    candidate({ evidence: `${evidence} Not contiguous.` }),
  );
  assert.equal(mismatchedEvidence.rows[0]?.status, "Not Verified");
  assert.match(mismatchedEvidence.rows[0]?.reasons.join(" ") ?? "", /contiguous excerpt/i);
});

test("multi-class fails closed as Review and never returns an issuer total", async () => {
  const bundle = sourceBundle({
    classUniverse: {
      ...sourceBundle().classUniverse!,
      status: "COMPLETE_MULTI",
      reason: "COMPLETE_MULTI_COMMON_STOCK",
      required_canonical_security_class_ids: ["class-a", "class-b"],
      class_evidence: [
        { sharesOutstanding: "62214156" },
        { sharesOutstanding: "1" },
      ],
    },
  });
  const result = await preview(candidate(), bundle);
  assert.equal(result.rows[0]?.status, "Review");
  assert.match(result.rows[0]?.reasons.join(" ") ?? "", /multiple common classes/i);
  assert.equal("issuerTotal" in (result.rows[0] ?? {}), false);
});

test("scaled, ADS/ordinary, and unresolved-class candidates remain Review", async () => {
  const scaledEvidence =
    "As of August 10, 2026, there were approximately 62 million shares of common stock outstanding.";
  const scaled = await preview(
    candidate({
      shares_outstanding: "62",
      evidence: scaledEvidence,
    }),
    sourceBundle({
      documents: [
        {
          source_ref: "ea0301195-10q_veea.htm",
          source_url:
            "https://www.sec.gov/Archives/edgar/data/1840317/000121390026087946/ea0301195-10q_veea.htm",
          document_name: "ea0301195-10q_veea.htm",
          text: scaledEvidence,
        },
      ],
    }),
  );
  assert.equal(scaled.rows[0]?.status, "Review");

  const adsEvidence =
    "As of August 10, 2026, there were 62,214,156 ordinary shares outstanding, represented by ADSs.";
  const ads = await preview(
    candidate({ security_class_title: "ordinary shares", evidence: adsEvidence }),
    sourceBundle({
      documents: [
        {
          source_ref: "ea0301195-10q_veea.htm",
          source_url:
            "https://www.sec.gov/Archives/edgar/data/1840317/000121390026087946/ea0301195-10q_veea.htm",
          document_name: "ea0301195-10q_veea.htm",
          text: adsEvidence,
        },
      ],
    }),
  );
  assert.equal(ads.rows[0]?.status, "Review");

  const unresolved = await preview(candidate(), sourceBundle({ classUniverse: null }));
  assert.equal(unresolved.rows[0]?.status, "Review");
});

test("malformed candidates, including GPT-supplied source_type, are Not Verified", async () => {
  const result = await preview(candidate({ source_type: "sec_filing_text_level2" }));
  assert.equal(result.reads, 0);
  assert.equal(result.rows[0]?.status, "Not Verified");
  assert.match(result.rows[0]?.reasons.join(" ") ?? "", /source_type is not allowed/i);
});

test("non-canonical CIK and accession values fail before any source lookup", async () => {
  const badAccession = await preview(
    s3Candidate({ source_accession: "1213900-26-072701" }),
    s3SourceBundle(),
  );
  assert.equal(badAccession.reads, 0);
  assert.equal(badAccession.rows[0]?.status, "Not Verified");

  const badCikPayload = s3Candidate();
  badCikPayload.issuer = { issuer_cik: "1840317", ticker: "VEEA" };
  const badCik = await preview(badCikPayload, s3SourceBundle());
  assert.equal(badCik.reads, 0);
  assert.equal(badCik.rows[0]?.status, "Not Verified");
});

test("source_ref accepts one safe filename and blocks URL/path injection before lookup", async () => {
  assert.equal(isSafeSecSourceRef("ea0295954-s3_veea.htm"), true);
  for (const value of [
    "https://evil.example/filing.htm",
    "../filing.htm",
    "folder/filing.htm",
    "folder\\filing.htm",
    "filing.htm?next=1",
    "filing.htm#evidence",
    "filing%2ehtm",
  ]) {
    assert.equal(isSafeSecSourceRef(value), false, value);
    const result = await preview(s3Candidate({ source_ref: value }), s3SourceBundle());
    assert.equal(result.reads, 0);
    assert.equal(result.rows[0]?.status, "Not Verified");
  }

  const clientUrl = await preview(
    s3Candidate({ source_url: "https://evil.example/client-controlled" }),
    s3SourceBundle(),
  );
  assert.equal(clientUrl.reads, 0);
  assert.equal(clientUrl.rows[0]?.status, "Not Verified");
  assert.match(clientUrl.rows[0]?.reasons.join(" ") ?? "", /source_url is not allowed/i);
});

test("official fallback constructs only exact SEC Archives URLs and validates membership/form", async () => {
  const seen: string[] = [];
  const responses = [
    new Response(JSON.stringify({
      directory: {
        name: "/Archives/edgar/data/1840317/000121390026072701",
        item: [{ name: "ea0295954-s3_veea.htm" }],
      },
    }), { headers: { "content-type": "application/json" } }),
    new Response('<div id="formName"><strong>Form S-3</strong></div>', {
      headers: { "content-type": "text/html" },
    }),
    new Response(`<p>${s3Evidence}</p>`, {
      headers: { "content-type": "text/html" },
    }),
  ];
  const result = await fetchOfficialSecFilingDocument({
    issuerCik: "0001840317",
    accessionNumber: "0001213900-26-072701",
    sourceForm: "S-3",
    sourceRef: "ea0295954-s3_veea.htm",
    requestPolicy: {
      async fetch(url) {
        seen.push(url);
        return responses.shift()!;
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [
    "https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/index.json",
    "https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/0001213900-26-072701-index.html",
    "https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/ea0295954-s3_veea.htm",
  ]);
});

test("official fallback rejects redirects outside the exact SEC host allowlist", async () => {
  const seen: string[] = [];
  const result = await fetchOfficialSecFilingDocument({
    issuerCik: "0001840317",
    accessionNumber: "0001213900-26-072701",
    sourceForm: "S-3",
    sourceRef: "ea0295954-s3_veea.htm",
    requestPolicy: {
      async fetch(url) {
        seen.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/stolen.htm" },
        });
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /not an allowed official Archives URL/i);
  assert.deepEqual(seen, [
    "https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/index.json",
  ]);
});

test("official fallback fails closed on source membership or exact-form mismatch", async () => {
  const missing = await fetchOfficialSecFilingDocument({
    issuerCik: "0001840317",
    accessionNumber: "0001213900-26-072701",
    sourceForm: "S-3",
    sourceRef: "ea0295954-s3_veea.htm",
    requestPolicy: {
      async fetch() {
        return new Response(JSON.stringify({
          directory: {
            name: "/Archives/edgar/data/1840317/000121390026072701",
            item: [{ name: "different.htm" }],
          },
        }), { headers: { "content-type": "application/json" } });
      },
    },
  });
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.reason, /not listed in the exact official SEC filing/i);

  const responses = [
    new Response(JSON.stringify({
      directory: {
        name: "/Archives/edgar/data/1840317/000121390026072701",
        item: [{ name: "ea0295954-s3_veea.htm" }],
      },
    }), { headers: { "content-type": "application/json" } }),
    new Response('<div id="formName"><strong>Form 8-K</strong></div>', {
      headers: { "content-type": "text/html" },
    }),
  ];
  const wrongForm = await fetchOfficialSecFilingDocument({
    issuerCik: "0001840317",
    accessionNumber: "0001213900-26-072701",
    sourceForm: "S-3",
    sourceRef: "ea0295954-s3_veea.htm",
    requestPolicy: { async fetch() { return responses.shift()!; } },
  });
  assert.equal(wrongForm.ok, false);
  assert.match(wrongForm.ok ? "" : wrongForm.reason, /does not exactly match source_form/i);
});

test("the O/S notice is exactly English and states server re-verification", () => {
  const component = readFileSync(
    "components/admin/DilutionRegistryPreview.tsx",
    "utf8",
  );
  assert.match(
    component,
    /One Apply saves the Registry first, then server-reverifies and saves only Verified Shares Outstanding\./,
  );
  assert.match(component, /Apply rechecks this exact SEC source before any O\/S save\./);
  assert.doesNotMatch(component, /Shares Outstanding[^\r\n]*[가-힣]/);
  assert.doesNotMatch(component, /[가-힣]/);
});

test("the server adapter and preview route are read-only and do not call persistence or Registry RPC", () => {
  const server = readFileSync("lib/dilution-registry/osPreviewServer.ts", "utf8");
  const route = readFileSync(
    "app/api/admin/data/dilution-registry/preview/route.ts",
    "utf8",
  );
  const combined = `${server}\n${route}`;
  assert.match(combined, /supabaseSelect/);
  assert.match(server, /universe_as_of: `lte\.\$\{context\.asOf\}`/);
  assert.ok(
    server.indexOf("if (!sourceResult.ok") < server.indexOf("const official = await fetchOfficialSecFilingDocument"),
    "local lookup failures must return before the official SEC fallback call",
  );
  assert.match(server, /exactLocalRows\.length > 0[\s\S]*network fallback was not attempted/);
  assert.doesNotMatch(
    combined,
    /supabase(?:Upsert|Update|Delete|Rpc)|writeLevel2ShareCountObservation|persistLevel2ShareCountObservation|apply_dilution_registry_v1/,
  );
});
