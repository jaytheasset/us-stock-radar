import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { buildOwnershipParserFactRows } from "./ownershipParserFacts.ts";
import {
  buildOwnershipContextReferenceInventory,
  type OwnershipContextReferenceInventory,
} from "./ownershipStructuredContext.ts";
import {
  OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION,
  buildOwnershipNeutralSourceBlocks,
} from "./ownershipNeutralSourceBlocks.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";
const fingerprint = `ownership-context-v1:${"a".repeat(64)}`;

const fidelityCases = [
  "source-agig-form4-purchase.json",
  "source-venu-form4-section16-derivative-gift.json",
  "source-uwmc-form4-multi-owner-10b5-1-conversion.json",
  "source-amcor-form144-no-prior-sales.json",
  "source-walmart-form144-namespaced.json",
] as const;

test("five retained SEC fixtures have complete lossless leaf and attribute coverage without full XML in the prompt", () => {
  let exactZeroCount = 0;
  let exactEmptyCount = 0;
  for (const filename of fidelityCases) {
    const state = canonicalState(filename);
    const result = buildOwnershipNeutralSourceBlocks({
      xml: state.sourceXml,
      rawForm: state.formType,
      accessionNumber: state.accession,
      inventory: state.inventory,
    });
    assert.equal(result.prompt.version, OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION, filename);
    assert.equal(result.audit.source_sha256, sha256(state.sourceXml), filename);
    assert.equal(Object.hasOwn(result.prompt, "source_sha256"), false, filename);
    assert.equal(result.prompt.coverage.complete, true, filename);
    assert.equal(result.prompt.coverage.leaf_count, result.prompt.coverage.emitted_leaf_count, filename);
    assert.equal(result.prompt.coverage.attribute_count, result.prompt.coverage.emitted_attribute_count, filename);
    assert.equal(result.prompt.coverage.unmapped_leaf_count, 0, filename);
    assert.equal(result.prompt.coverage.unmapped_attribute_count, 0, filename);
    assert.equal(result.prompt.coverage.duplicate_field_count, 0, filename);
    assert.equal(result.prompt.coverage.unrecognized_section_count, 0, filename);
    assert.equal(result.audit.field_manifest.length,
      result.prompt.coverage.leaf_count + result.prompt.coverage.attribute_count, filename);

    const serializedPrompt = JSON.stringify(result.prompt);
    assert.equal(serializedPrompt.includes(state.sourceXml), false, `${filename}: full XML excluded`);
    assert.equal(serializedPrompt.includes("<ownershipDocument"), false, filename);
    assert.equal(serializedPrompt.includes("<edgarSubmission"), false, filename);
    assert.doesNotMatch(serializedPrompt,
      /economic_direction|owner_attribution|footnote_summary|primary_score|delivery_level|parser_conclusion/i,
      filename);
    assert.doesNotMatch(serializedPrompt,
      /ownership:(?:leaf|attribute|locator|xml-underlying|block)|(?:row|owner|security|evidence):form(?:4|144)|source_sha256/i,
      `${filename}: internal audit/canonical IDs stay server-only`);

    const promptFields = sourceFields(result.prompt.blocks);
    exactZeroCount += promptFields.filter((field) => field.lexicalValue === "0").length;
    exactEmptyCount += promptFields.filter((field) => field.lexicalValue === "").length;
    const independentFields = independentXmlFields(state.sourceXml);
    assert.equal(XMLValidator.validate(state.sourceXml), true, `${filename}: independently well-formed XML`);
    assert.equal(independentFields.size, result.audit.field_manifest.length, `${filename}: independent field count`);
    const remaining = [...promptFields];
    for (const manifest of result.audit.field_manifest) {
      const lexical = state.sourceXml.slice(manifest.source_start, manifest.source_end);
      const decoded = independentFields.get(manifest.xml_path);
      const matchIndex = remaining.findIndex((field) => field.lexicalValue === lexical
        && field.decodedValue === decoded && sha256(field.lexicalValue) === manifest.raw_sha256);
      assert.notEqual(matchIndex, -1, `${filename}: ${manifest.xml_path}`);
      assert.ok(remaining[matchIndex].relativePath.length > 0, `${filename}: prompt path ${manifest.xml_path}`);
      remaining.splice(matchIndex, 1);
    }
    assert.equal(remaining.length, 0, `${filename}: every prompt field consumed exactly once`);
  }
  assert.ok(exactZeroCount > 0, "exact lexical zero values survive across retained fixtures");
  assert.ok(exactEmptyCount > 0, "exact empty/null-like XML leaves survive across retained fixtures");
});

test("UWMC blocks preserve separate owners, row-scoped D/I, and exact F1/F3/F5 locality without semantic answers", () => {
  const state = canonicalState("source-uwmc-form4-multi-owner-10b5-1-conversion.json");
  const result = buildOwnershipNeutralSourceBlocks({
    xml: state.sourceXml,
    rawForm: state.formType,
    accessionNumber: state.accession,
    inventory: state.inventory,
  });
  const blocks = result.prompt.blocks.map((block) => ({ ...block, data: JSON.parse(block.text) as Row }));
  const owners = blocks.filter((block) => block.block_type === "reporting_owner");
  assert.equal(owners.length, 2);
  assert.deepEqual(owners.map((block) => [
    fieldValue(block.data, "rptOwnerName"),
    fieldValue(block.data, "rptOwnerCik"),
  ]), [
    ["Mat Ishbia", "0001841794"],
    ["SFS HOLDING CORP", "0001842002"],
  ]);

  const candidateRows = blocks.filter((block) => block.block_type === "form4_row"
    && typeof block.data.row === "string");
  assert.equal(candidateRows.length, 5);
  const sale0 = candidateRows.find((block) => block.data.row === "R1")!;
  assert.equal(fieldValue(sale0.data, "transactionCode"), "S");
  assert.equal(fieldValueAtPath(sale0.data, "transactionAmounts/transactionAcquiredDisposedCode/value"), "D");
  assert.equal(fieldValueAtPath(sale0.data, "ownershipNature/directOrIndirectOwnership/value"), "I");
  assert.match(String(sale0.data.xml_scope_note), /this XML row element.*not an owner-specific conclusion/i);

  const footnotes = blocks.filter((block) => block.block_type === "footnote");
  const f1 = footnotes.find((block) => block.data.footnote === "F1")!;
  const f3 = footnotes.find((block) => block.data.footnote === "F3")!;
  const f5 = footnotes.find((block) => block.data.footnote === "F5")!;
  assert.equal(f3.data.exact_text_raw,
    state.sourceXml.match(/<footnote id="F3">([\s\S]*?)<\/footnote>/)?.[1]);
  assert.deepEqual(f1.data.linked_rows, ["R1", "R2", "R4"]);
  assert.deepEqual(f3.data.linked_rows, ["R1", "R2", "R3", "R4", "R5"]);
  assert.deepEqual(f5.data.linked_rows, ["R3", "R5"]);
  assert.deepEqual(f1.data.linked_source_row_ordinals, [0, 1, 3]);
  assert.deepEqual(f3.data.linked_source_row_ordinals, [0, 1, 2, 3, 5]);
  assert.match(String(f3.data.exact_text_raw), /held directly by SFS Corp.*indirectly by Mat Ishbia/i);
  assert.match(String(f5.data.text_decoded), /SFS Holding Corp\. \("SFS Corp"\)/i);

  const derivative = candidateRows.find((block) => block.data.row === "R5")!;
  assert.equal(fieldValueAtPath(derivative.data, "securityTitle/value"), "UWM Paired Interests");
  const underlying = blocks.find((block) => block.block_type === "underlying_security"
    && block.data.row === "R5")!;
  assert.equal(underlying.data.underlying_security, "S6");
  assert.equal(fieldValueAtPath(underlying.data, "underlyingSecurityTitle/value"), "Class A Common Stock");
  const f10 = footnotes.find((block) => block.data.footnote === "F10")!;
  const f7 = footnotes.find((block) => block.data.footnote === "F7")!;
  assert.deepEqual(f7.data.linked_source_row_ordinals, [4]);
  assert.deepEqual(f10.data.linked_source_row_ordinals, [6]);
  const f10Attributes = result.audit.field_manifest.filter((field) =>
    field.field_kind === "attribute" && field.xml_path.includes("derivativeHolding")
    && field.xml_path.endsWith("/@id")
    && state.sourceXml.slice(field.source_start, field.source_end) === "F10");
  assert.equal(f10Attributes.length, 2, "both field-level F10 references remain distinct");
  assert.equal(JSON.stringify(result.prompt).includes("SFS is direct"), false);
  assert.equal(JSON.stringify(result.prompt).includes("Mat is indirect"), false);
});

test("Form 144 blocks keep proposed sale, broker, acquisition, prior sales, and 10b5 dates in separate temporal sections", () => {
  const amcor = sourceBlocks("source-amcor-form144-no-prior-sales.json");
  const amcorTypes = amcor.prompt.blocks.map((block) => block.block_type);
  assert.ok(amcorTypes.includes("form144_proposed_sale"));
  assert.ok(amcorTypes.includes("form144_broker"));
  assert.ok(amcorTypes.includes("form144_acquisition_history"));
  assert.ok(amcorTypes.includes("form144_prior_sales_status"));
  assert.equal(amcorTypes.includes("form144_prior_sale"), false);

  const walmart = sourceBlocks("source-walmart-form144-namespaced.json");
  const blocks = walmart.prompt.blocks.map((block) => ({ ...block, data: JSON.parse(block.text) as Row }));
  assert.ok(blocks.some((block) => block.block_type === "form144_proposed_sale"
    && block.data.temporal_scope === "proposed_sale"));
  assert.ok(blocks.some((block) => block.block_type === "form144_acquisition_history"
    && block.data.temporal_scope === "historical_acquisition"));
  assert.ok(blocks.some((block) => block.block_type === "form144_prior_sale"
    && block.data.temporal_scope === "historical_prior_sales"));
  assert.ok(blocks.some((block) => block.block_type === "form144_rule_10b5_1_information"));
  assert.ok(blocks.some((block) => block.block_type === "remarks"));
  assert.equal(walmart.prompt.coverage.complete, true);

  const multiple = sourceBlocks("form144-ambiguous-10b5-multiple-rows.json");
  const brokers = multiple.prompt.blocks
    .filter((block) => block.block_type === "form144_broker")
    .map((block) => (JSON.parse(block.text) as Row).proposed_sale_ordinal);
  assert.deepEqual(brokers, [0, 1], "each broker is bound to its ancestor proposed-sale block");
});

test("Form 4/A and Form 144/A routing preserve direct amendment identifiers without claiming amendment meaning", () => {
  const form4 = canonicalState("source-agig-form4-purchase.json", {
    formType: "4/A",
    transformXml: (xml) => xml.replace("<documentType>4</documentType>", "<documentType>4/A</documentType>"),
  });
  const form4Blocks = buildOwnershipNeutralSourceBlocks({
    xml: form4.sourceXml, rawForm: form4.formType, accessionNumber: form4.accession, inventory: form4.inventory,
  });
  assert.equal(form4Blocks.prompt.declared_form, "4/A");
  assert.equal(allFieldValues(form4Blocks.prompt.blocks, "documentType").includes("4/A"), true);

  const form144 = canonicalState("source-amcor-form144-no-prior-sales.json", {
    formType: "144/A",
    transformXml: (xml) => xml.replace("<submissionType>144</submissionType>", "<submissionType>144/A</submissionType>"),
  });
  const form144Blocks = buildOwnershipNeutralSourceBlocks({
    xml: form144.sourceXml, rawForm: form144.formType, accessionNumber: form144.accession, inventory: form144.inventory,
  });
  assert.equal(form144Blocks.prompt.declared_form, "144/A");
  assert.equal(allFieldValues(form144Blocks.prompt.blocks, "submissionType").includes("144/A"), true);
  assert.doesNotMatch(JSON.stringify([form4Blocks.prompt, form144Blocks.prompt]), /amendment_effect|restates|modifies/);
});

test("unknown XML sections are surfaced in a dedicated block and never silently dropped", () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const xml = state.sourceXml.replace(
    "</ownershipDocument>",
    "<futureSection code=\"X0\"><futureValue>007</futureValue></futureSection></ownershipDocument>",
  );
  const result = buildOwnershipNeutralSourceBlocks({
    xml, rawForm: state.formType, accessionNumber: state.accession, inventory: state.inventory,
  });
  assert.equal(result.prompt.coverage.complete, true);
  assert.equal(result.prompt.coverage.unrecognized_section_count, 1);
  const unknown = result.prompt.blocks.find((block) => block.block_type === "unrecognized_xml_section");
  assert.ok(unknown);
  assert.equal(fieldValue(JSON.parse(unknown.text) as Row, "futureValue"), "007");
  assert.equal((record(JSON.parse(unknown.text)).attributes as Row[])[0]?.lexical_value, "X0");
});

test("entity decoding is single-pass, CDATA stays literal, and mixed content fails closed", () => {
  const state = canonicalState("source-agig-form4-purchase.json");
  const entityXml = state.sourceXml.replace(
    "ABUNDIA GLOBAL IMPACT GROUP, INC.",
    "A&amp;amp;lt;B<![CDATA[&amp;C]]>",
  );
  const entityResult = buildOwnershipNeutralSourceBlocks({
    xml: entityXml,
    rawForm: state.formType,
    accessionNumber: state.accession,
    inventory: state.inventory,
  });
  const issuerName = [...sourceFields(entityResult.prompt.blocks).values()]
    .find((field) => field.relativePath.endsWith("issuerName"));
  assert.equal(issuerName?.lexicalValue, "A&amp;amp;lt;B<![CDATA[&amp;C]]>");
  assert.equal(issuerName?.decodedValue, "A&amp;lt;B&amp;C");

  const mixedXml = state.sourceXml.replace(
    "<issuerName>ABUNDIA GLOBAL IMPACT GROUP, INC.</issuerName>",
    "<issuerName>ABUNDIA <legalName>GLOBAL</legalName> IMPACT GROUP, INC.</issuerName>",
  );
  assert.throws(() => buildOwnershipNeutralSourceBlocks({
    xml: mixedXml,
    rawForm: state.formType,
    accessionNumber: state.accession,
    inventory: state.inventory,
  }), /ownership_neutral_source_blocks_mixed_content_unsupported/);
});

test("footnote IDs cannot collide with reserved R/O/S selection namespaces", () => {
  const base = canonicalState("source-agig-form4-purchase.json");
  const xml = base.sourceXml.replaceAll('id="F1"', 'id="R1"');
  const state = canonicalState("source-agig-form4-purchase.json", { transformXml: () => xml });
  assert.throws(() => buildOwnershipNeutralSourceBlocks({
    xml: state.sourceXml,
    rawForm: state.formType,
    accessionNumber: state.accession,
    inventory: state.inventory,
  }), /ownership_context_selection_footnote_ref_invalid/);
});

function sourceBlocks(filename: string) {
  const state = canonicalState(filename);
  return buildOwnershipNeutralSourceBlocks({
    xml: state.sourceXml,
    rawForm: state.formType,
    accessionNumber: state.accession,
    inventory: state.inventory,
  });
}

function canonicalState(
  filename: string,
  overrides: { formType?: string; transformXml?: (xml: string) => string } = {},
) {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const sourceXml = overrides.transformXml
    ? overrides.transformXml(String(fixture.filingText))
    : String(fixture.filingText);
  const accession = String(fixture.accessionNumber);
  const formType = overrides.formType ?? String(fixture.formType);
  const form = formType.toUpperCase().startsWith("144") ? "form144" as const : "form4" as const;
  const rawItem = {
    id: rawItemId,
    source_unique_id: accession,
    raw_payload: {
      form_type: formType,
      accession_number: accession,
      cik: xmlValue(sourceXml, "issuerCik"),
      ownership_issuer_cik: xmlValue(sourceXml, "issuerCik"),
      ticker: xmlValue(sourceXml, "issuerTradingSymbol"),
      ownership_issuer_trading_symbol: xmlValue(sourceXml, "issuerTradingSymbol"),
      ownership_source_text: sourceXml,
      ownership_source_url: `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({
    eventId,
    rawItem,
    symbol: xmlValue(sourceXml, "issuerTradingSymbol"),
  });
  const rows = form === "form4" ? built.form4Transactions : built.form144ProposedSales;
  const inventory = buildOwnershipContextReferenceInventory({
    eventId,
    form,
    isAmendment: formType.endsWith("/A"),
    sourceFingerprint: fingerprint,
    rows,
    sourceXml,
  });
  return { sourceXml, accession, formType, inventory };
}

function sourceFields(blocks: readonly Readonly<{ text: string }>[]) {
  const fields: Array<{ lexicalValue: string; decodedValue: string; relativePath: string }> = [];
  for (const block of blocks) {
    const data = JSON.parse(block.text) as Row;
    for (const field of (data.fields as Row[])) {
      fields.push({
        lexicalValue: String(field.lexical_value),
        decodedValue: String(field.decoded_value),
        relativePath: String(field.xml_relative_path),
      });
    }
    for (const attribute of (data.attributes as Row[])) {
      fields.push({
        lexicalValue: String(attribute.lexical_value),
        decodedValue: String(attribute.decoded_value),
        relativePath: String(attribute.xml_relative_path),
      });
    }
  }
  return fields;
}

function fieldValue(data: Row, xmlName: string) {
  return (data.fields as Row[]).find((field) => field.xml_name === xmlName)?.lexical_value;
}

function fieldValueAtPath(data: Row, xmlRelativePath: string) {
  return (data.fields as Row[]).find((field) => field.xml_relative_path === xmlRelativePath)?.lexical_value;
}

function independentXmlFields(xml: string) {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: true,
  });
  const parsed = parser.parse(xml) as Row[];
  const fields = new Map<string, string>();
  const elements = parsed.filter((entry) => elementName(entry) !== null);
  for (const entry of elements) walkIndependentElement(entry, "", fields);
  return fields;
}

function walkIndependentElement(entry: Row, parentPath: string, fields: Map<string, string>) {
  const name = elementName(entry)!;
  const path = `${parentPath}/${name}`;
  const content = Array.isArray(entry[name]) ? entry[name] as Row[] : [];
  const childElements = content.filter((child) => elementName(child) !== null);
  const attributes = record(entry[":@"]);
  for (const [attributeName, value] of Object.entries(attributes)) {
    fields.set(`${path}/@${attributeName.replace(/^@_/, "")}`, String(value));
  }
  if (childElements.length === 0) {
    const decoded = content.map((child) => {
      if (Object.hasOwn(child, "#text")) return String(child["#text"] ?? "");
      if (Object.hasOwn(child, "#cdata")) return String(child["#cdata"] ?? "");
      return "";
    }).join("");
    fields.set(path, decoded);
    return;
  }
  const totals = new Map<string, number>();
  for (const child of childElements) {
    const childName = elementName(child)!;
    totals.set(childName, (totals.get(childName) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const child of childElements) {
    const childName = elementName(child)!;
    const ordinal = seen.get(childName) ?? 0;
    seen.set(childName, ordinal + 1);
    const indexed = totals.get(childName)! > 1 ? `${childName}[${ordinal}]` : childName;
    const indexedChild = { ...child };
    delete indexedChild[childName];
    indexedChild[indexed] = child[childName];
    walkIndependentElement(indexedChild, path, fields);
  }
}

function elementName(entry: Row) {
  return Object.keys(entry).find((key) => key !== ":@" && !key.startsWith("#") && !key.startsWith("?")) ?? null;
}

function allFieldValues(blocks: readonly Readonly<{ text: string }>[], xmlName: string) {
  return blocks.flatMap((block) => (JSON.parse(block.text).fields as Row[])
    .filter((field) => field.xml_name === xmlName)
    .map((field) => String(field.lexical_value)));
}

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
