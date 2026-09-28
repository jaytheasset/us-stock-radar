import { createHash } from "node:crypto";
import { XMLValidator } from "fast-xml-parser";
import type { OwnershipContextReferenceInventory } from "./ownershipStructuredContext.ts";

export const OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION =
  "ownership_neutral_source_blocks_v1.1-selection-refs" as const;

export const OWNERSHIP_CONTEXT_SELECTION_REFS_VERSION =
  "ownership_context_selection_refs_v1" as const;

export type OwnershipNeutralSourceBlock = Readonly<{
  block_type: string;
  label: string;
  source: "sec_ownership_xml";
  text: string;
}>;

export type OwnershipNeutralSourcePromptPackage = Readonly<{
  version: typeof OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION;
  declared_form: string;
  accession_number: string;
  blocks: readonly OwnershipNeutralSourceBlock[];
  coverage: Readonly<{
    leaf_count: number;
    emitted_leaf_count: number;
    attribute_count: number;
    emitted_attribute_count: number;
    unmapped_leaf_count: number;
    unmapped_attribute_count: number;
    duplicate_field_count: number;
    unrecognized_section_count: number;
    complete: boolean;
  }>;
}>;

export type OwnershipContextSelectionRowBinding = Readonly<{
  row: string;
  canonicalRowRef: string;
  owners: readonly Readonly<{ owner: string; canonicalOwnerRef: string }>[];
  rowSecurity: Readonly<{ security: string; canonicalSecurityRef: string }> | null;
  underlyingSecurities: readonly Readonly<{ security: string; canonicalSecurityRef: string }>[];
  footnotes: readonly Readonly<{ footnote: string; canonicalFootnoteRef: string }>[];
  canonicalEvidenceRefs: readonly string[];
}>;

export type OwnershipContextSelectionBindings = Readonly<{
  version: typeof OWNERSHIP_CONTEXT_SELECTION_REFS_VERSION;
  rows: readonly OwnershipContextSelectionRowBinding[];
}>;

export type OwnershipNeutralSourceAudit = Readonly<{
  source_sha256: string;
  source_length: number;
  root_local_name: string;
  ignored_xml_node_count: number;
  locator_manifest: readonly Readonly<{
    locator_ref: string;
    xml_path: string;
    local_name: string;
    source_start: number;
    source_end: number;
  }>[];
  field_manifest: readonly Readonly<{
    field_ref: string;
    field_kind: "leaf" | "attribute";
    xml_path: string;
    local_name: string;
    block_id: string;
    source_start: number;
    source_end: number;
    raw_sha256: string;
  }>[];
  unrecognized_sections: readonly Readonly<{
    locator_ref: string;
    xml_path: string;
    local_name: string;
  }>[];
}>;

export type OwnershipNeutralSourceBlocksResult = Readonly<{
  prompt: OwnershipNeutralSourcePromptPackage;
  audit: OwnershipNeutralSourceAudit;
}>;

type XmlAttribute = {
  name: string;
  localName: string;
  rawValue: string;
  decodedValue: string;
  sourceStart: number;
  sourceEnd: number;
};

type XmlNode = {
  name: string;
  localName: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  textParts: string[];
  parent: XmlNode | null;
  order: number;
  sourceStart: number;
  sourceEnd: number;
  innerStart: number;
  closeStart: number;
  path: string;
};

type NeutralField = Readonly<{
  field_ref: string;
  xml_name: string;
  xml_relative_path: string;
  lexical_value: string;
  decoded_value: string;
  empty: boolean;
}>;

type NeutralAttribute = Readonly<{
  attribute_ref: string;
  xml_name: string;
  xml_relative_path: string;
  lexical_value: string;
  decoded_value: string;
}>;

type BlockDescriptor = {
  node: XmlNode;
  blockId: string;
  blockType: string;
  label: string;
  locatorRef: string;
  metadata: Record<string, unknown>;
  fields: NeutralField[];
  attributes: NeutralAttribute[];
};

const FORM4_ROW_ELEMENTS = new Set([
  "nonDerivativeTransaction",
  "derivativeTransaction",
  "nonDerivativeHolding",
  "derivativeHolding",
]);

const FORM4_KNOWN_ROOT_SECTIONS = new Set([
  "schemaVersion",
  "documentType",
  "periodOfReport",
  "dateOfOriginalSubmission",
  "noSecuritiesOwned",
  "notSubjectToSection16",
  "form3HoldingsReported",
  "form4TransactionsReported",
  "issuer",
  "reportingOwner",
  "aff10b5One",
  "nonDerivativeTable",
  "derivativeTable",
  "footnotes",
  "remarks",
  "ownerSignature",
]);

const FORM144_KNOWN_HEADER_SECTIONS = new Set(["submissionType", "previousAccessionNumber", "filerInfo"]);
const FORM144_KNOWN_FORM_SECTIONS = new Set([
  "issuerInfo",
  "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold",
  "relationshipsToIssuer",
  "securitiesInformation",
  "securitiesToBeSold",
  "nothingToReportFlagOnSecuritiesSoldInPast3Months",
  "securitiesSoldInPast3Months",
  "remarks",
  "noticeSignature",
]);

export function buildOwnershipNeutralSourceBlocks(input: Readonly<{
  xml: string;
  rawForm: string;
  accessionNumber: string;
  inventory: OwnershipContextReferenceInventory;
}>): OwnershipNeutralSourceBlocksResult {
  const sourceSha256 = sha256(input.xml);
  if (XMLValidator.validate(input.xml.trim()) !== true) {
    throw new Error("ownership_neutral_source_blocks_xml_invalid");
  }
  const parsed = parseXml(input.xml);
  const form = normalizeForm(input.rawForm);
  if (!form) throw new Error("ownership_neutral_source_blocks_form_unsupported");
  const expectedRoot = form === "form4" ? "ownershipDocument" : "edgarSubmission";
  if (parsed.root.localName !== expectedRoot) throw new Error("ownership_neutral_source_blocks_root_mismatch");
  if (input.inventory.form !== form) throw new Error("ownership_neutral_source_blocks_inventory_form_mismatch");

  const allNodes = flattenNodes(parsed.root);
  const selectionBindings = buildOwnershipContextSelectionBindings(input.inventory);
  const locators = new Map<XmlNode, string>();
  allNodes.forEach((node, index) => locators.set(node, `ownership:locator:${pad(index)}`));
  const descriptors = buildBlockDescriptors({
    root: parsed.root,
    nodes: allNodes,
    form,
    inventory: input.inventory,
    selectionBindings,
    locators,
    sourceXml: input.xml,
  });
  const descriptorByNode = new Map(descriptors.map((descriptor) => [descriptor.node, descriptor]));

  const leafNodes = allNodes.filter((node) => node.children.length === 0);
  const fieldManifest: Array<OwnershipNeutralSourceAudit["field_manifest"][number]> = [];
  const emittedFieldRefs: string[] = [];
  const unmappedLeafRefs: string[] = [];
  const unmappedAttributeRefs: string[] = [];
  let leafOrdinal = 0;
  let attributeOrdinal = 0;

  for (const node of allNodes) {
    const descriptor = nearestDescriptor(node, descriptorByNode);
    if (node.children.length === 0) {
      const fieldRef = `ownership:leaf:${pad(leafOrdinal++)}`;
      if (!descriptor) {
        unmappedLeafRefs.push(fieldRef);
      } else {
        const lexical = input.xml.slice(node.innerStart, node.closeStart);
        descriptor.fields.push(Object.freeze({
          field_ref: fieldRef,
          xml_name: node.localName,
          xml_relative_path: relativeXmlPath(node, descriptor.node),
          lexical_value: lexical,
          decoded_value: decodeLeafXml(lexical),
          empty: lexical.length === 0,
        }));
        emittedFieldRefs.push(fieldRef);
        fieldManifest.push(Object.freeze({
          field_ref: fieldRef,
          field_kind: "leaf",
          xml_path: node.path,
          local_name: node.localName,
          block_id: descriptor.blockId,
          source_start: node.innerStart,
          source_end: node.closeStart,
          raw_sha256: sha256(lexical),
        }));
      }
    }
    for (const attribute of node.attributes) {
      const attributeRef = `ownership:attribute:${pad(attributeOrdinal++)}`;
      if (!descriptor) {
        unmappedAttributeRefs.push(attributeRef);
      } else {
        descriptor.attributes.push(Object.freeze({
          attribute_ref: attributeRef,
          xml_name: attribute.localName,
          xml_relative_path: `${relativeXmlPath(node, descriptor.node)}/@${attribute.localName}`,
          lexical_value: attribute.rawValue,
          decoded_value: attribute.decodedValue,
        }));
        emittedFieldRefs.push(attributeRef);
        fieldManifest.push(Object.freeze({
          field_ref: attributeRef,
          field_kind: "attribute",
          xml_path: `${node.path}/@${attribute.name}`,
          local_name: attribute.localName,
          block_id: descriptor.blockId,
          source_start: attribute.sourceStart,
          source_end: attribute.sourceEnd,
          raw_sha256: sha256(attribute.rawValue),
        }));
      }
    }
  }

  const duplicateFieldRefs = [...new Set(emittedFieldRefs.filter(
    (fieldRef, index) => emittedFieldRefs.indexOf(fieldRef) !== index,
  ))];
  const unrecognized = descriptors.filter((descriptor) => descriptor.blockType === "unrecognized_xml_section");
  const blocks = descriptors
    .filter((descriptor) => descriptor.fields.length > 0 || descriptor.attributes.length > 0)
    .map((descriptor) => Object.freeze({
      block_type: descriptor.blockType,
      label: descriptor.label,
      source: "sec_ownership_xml" as const,
      text: JSON.stringify({
        ...descriptor.metadata,
        fields: descriptor.fields.map(({ field_ref: _fieldRef, ...field }) => field),
        attributes: descriptor.attributes.map(({ attribute_ref: _attributeRef, ...attribute }) => attribute),
      }),
    }));
  const complete = unmappedLeafRefs.length === 0
    && unmappedAttributeRefs.length === 0
    && duplicateFieldRefs.length === 0
    && leafOrdinal === leafNodes.length
    && attributeOrdinal === allNodes.reduce((sum, node) => sum + node.attributes.length, 0);

  return Object.freeze({
    prompt: Object.freeze({
      version: OWNERSHIP_NEUTRAL_SOURCE_BLOCKS_VERSION,
      declared_form: input.rawForm,
      accession_number: input.accessionNumber,
      blocks: Object.freeze(blocks),
      coverage: Object.freeze({
        leaf_count: leafOrdinal,
        emitted_leaf_count: leafOrdinal - unmappedLeafRefs.length,
        attribute_count: attributeOrdinal,
        emitted_attribute_count: attributeOrdinal - unmappedAttributeRefs.length,
        unmapped_leaf_count: unmappedLeafRefs.length,
        unmapped_attribute_count: unmappedAttributeRefs.length,
        duplicate_field_count: duplicateFieldRefs.length,
        unrecognized_section_count: unrecognized.length,
        complete,
      }),
    }),
    audit: Object.freeze({
      source_sha256: sourceSha256,
      source_length: input.xml.length,
      root_local_name: parsed.root.localName,
      ignored_xml_node_count: parsed.ignoredNodeCount,
      locator_manifest: Object.freeze(allNodes.map((node) => Object.freeze({
        locator_ref: locators.get(node)!,
        xml_path: node.path,
        local_name: node.localName,
        source_start: node.sourceStart,
        source_end: node.sourceEnd,
      }))),
      field_manifest: Object.freeze(fieldManifest),
      unrecognized_sections: Object.freeze(unrecognized.map((descriptor) => Object.freeze({
        locator_ref: descriptor.locatorRef,
        xml_path: descriptor.node.path,
        local_name: descriptor.node.localName,
      }))),
    }),
  });
}

function buildBlockDescriptors(input: Readonly<{
  root: XmlNode;
  nodes: readonly XmlNode[];
  form: "form4" | "form144";
  inventory: OwnershipContextReferenceInventory;
  selectionBindings: OwnershipContextSelectionBindings;
  locators: ReadonlyMap<XmlNode, string>;
  sourceXml: string;
}>) {
  const descriptors: BlockDescriptor[] = [];
  const descriptorNodes = new Set<XmlNode>();
  const add = (
    node: XmlNode,
    blockType: string,
    label: string,
    metadata: Record<string, unknown> = {},
  ) => {
    if (descriptorNodes.has(node)) return;
    const ordinal = descriptors.filter((descriptor) => descriptor.blockType === blockType).length;
    descriptors.push({
      node,
      blockId: `ownership:block:${blockType}:${pad(ordinal)}`,
      blockType,
      label,
      locatorRef: input.locators.get(node)!,
      metadata,
      fields: [],
      attributes: [],
    });
    descriptorNodes.add(node);
  };
  add(input.root, "filing", "FILING", {
    declared_form: input.form,
    source_scope: "Current SEC ownership XML document only.",
  });

  if (input.form === "form4") {
    const ownerNodes = input.nodes.filter((node) => node.localName === "reportingOwner");
    ownerNodes.forEach((node, ownerOrdinal) => add(node, "reporting_owner", "REPORTING OWNER", {
      reporting_owner_ordinal: ownerOrdinal,
      owner: input.selectionBindings.rows[0]?.owners[ownerOrdinal]?.owner ?? null,
    }));
    const transactionNodes = [
      ...input.nodes.filter((node) => node.localName === "nonDerivativeTransaction"),
      ...input.nodes.filter((node) => node.localName === "derivativeTransaction"),
    ];
    const rowNodes = input.nodes.filter((node) => FORM4_ROW_ELEMENTS.has(node.localName));
    rowNodes.forEach((node, xmlRowOrdinal) => {
      const candidateIndex = transactionNodes.indexOf(node);
      const inventoryRow = candidateIndex >= 0 ? input.inventory.rows[candidateIndex] : null;
      const selectionRow = candidateIndex >= 0 ? input.selectionBindings.rows[candidateIndex] : null;
      const table = node.localName.startsWith("derivative") ? "II" : "I";
      const entryKind = node.localName.endsWith("Transaction") ? "transaction" : "holding";
      add(node, "form4_row", `TABLE ${table} ${entryKind.toUpperCase()} ROW`, {
        source_row_ordinal: xmlRowOrdinal,
        row: selectionRow?.row ?? null,
        table,
        entry_kind: entryKind,
        security: selectionRow?.rowSecurity?.security ?? null,
        evidence_choices: selectionRow
          ? [selectionRow.row, ...selectionRow.footnotes.map((footnote) => footnote.footnote)]
          : [],
        linked_footnotes: readFootnoteRefs(node).map(shortFootnoteRef),
        xml_scope_note: "Any D/I value is scoped to this XML row element and is not an owner-specific conclusion.",
      });
    });
    const underlyingNodes = input.nodes.filter((node) => node.localName === "underlyingSecurity");
    underlyingNodes.forEach((node, underlyingOrdinal) => {
      const transactionNode = nearestAncestor(node, (candidate) => candidate.localName === "derivativeTransaction");
      const candidateIndex = transactionNode ? transactionNodes.indexOf(transactionNode) : -1;
      const inventoryRow = candidateIndex >= 0 ? input.inventory.rows[candidateIndex] : null;
      const selectionRow = candidateIndex >= 0 ? input.selectionBindings.rows[candidateIndex] : null;
      const siblings = transactionNode
        ? descendants(transactionNode).filter((candidate) => candidate.localName === "underlyingSecurity")
        : [];
      const withinRowOrdinal = siblings.indexOf(node);
      add(node, "underlying_security", "UNDERLYING SECURITY", {
        source_underlying_ordinal: underlyingOrdinal,
        underlying_security: selectionRow?.underlyingSecurities[withinRowOrdinal]?.security ?? null,
        row: selectionRow?.row ?? null,
      });
    });
    input.nodes.filter((node) => node.localName === "footnote").forEach((node) => add(
      node,
      "footnote",
      "FOOTNOTE",
      footnoteMetadata(node, rowNodes, input.inventory, input.sourceXml),
    ));
    input.nodes.filter((node) => node.localName === "remarks").forEach((node) => add(node, "remarks", "REMARKS", {
      exact_text_raw: input.sourceXml.slice(node.innerStart, node.closeStart),
    }));
    input.nodes.filter((node) => node.localName === "ownerSignature").forEach((node) => add(node, "signature", "SIGNATURE"));
    input.nodes.filter((node) => node.localName === "aff10b5One").forEach((node) => add(
      node,
      "rule_10b5_1_information",
      "RULE 10B5-1 XML FLAG",
      { xml_scope_note: "This is the XML element's direct value; no row or owner attribution is supplied." },
    ));
    for (const child of input.root.children) {
      if (!FORM4_KNOWN_ROOT_SECTIONS.has(child.localName)) {
        add(child, "unrecognized_xml_section", "UNRECOGNIZED XML SECTION");
      }
    }
  } else {
    input.nodes.filter((node) => node.localName === "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold")
      .forEach((node) => add(node, "form144_account_person", "ACCOUNT PERSON", {
        owner: input.selectionBindings.rows[0]?.owners[0]?.owner ?? null,
      }));
    input.nodes.filter((node) => node.localName === "relationshipsToIssuer")
      .forEach((node) => add(node, "form144_account_relationships", "ACCOUNT RELATIONSHIPS"));
    const saleNodes = input.nodes.filter((node) => node.localName === "securitiesInformation");
    saleNodes.forEach((node, index) => add(node, "form144_proposed_sale", "PROPOSED SALE SECURITIES INFORMATION", {
      row: input.selectionBindings.rows[index]?.row ?? null,
      security: input.selectionBindings.rows[index]?.rowSecurity?.security ?? null,
      evidence_choices: input.selectionBindings.rows[index]
        ? [input.selectionBindings.rows[index].row, ...input.selectionBindings.rows[index].footnotes.map((footnote) => footnote.footnote)]
        : [],
      linked_footnotes: readFootnoteRefs(node).map(shortFootnoteRef),
      temporal_scope: "proposed_sale",
    }));
    input.nodes.filter((node) => node.localName === "brokerOrMarketmakerDetails")
      .forEach((node) => add(node, "form144_broker", "BROKER OR MARKET MAKER", {
        proposed_sale_ordinal: saleNodes.indexOf(nearestAncestor(
          node,
          (candidate) => candidate.localName === "securitiesInformation",
        )!),
      }));
    input.nodes.filter((node) => node.localName === "securitiesToBeSold")
      .forEach((node, index) => add(node, "form144_acquisition_history", "ACQUISITION HISTORY", {
        acquisition_ordinal: index,
        temporal_scope: "historical_acquisition",
      }));
    input.nodes.filter((node) => node.localName === "nothingToReportFlagOnSecuritiesSoldInPast3Months")
      .forEach((node) => add(node, "form144_prior_sales_status", "PRIOR SALES STATUS", {
        temporal_scope: "historical_prior_sales",
      }));
    input.nodes.filter((node) => node.localName === "securitiesSoldInPast3Months")
      .forEach((node, index) => add(node, "form144_prior_sale", "PRIOR SALE", {
        prior_sale_ordinal: index,
        temporal_scope: "historical_prior_sales",
      }));
    input.nodes.filter((node) => node.localName === "planAdoptionDates")
      .forEach((node, index) => add(node, "form144_rule_10b5_1_information", "RULE 10B5-1 INFORMATION", {
        plan_date_ordinal: index,
      }));
    input.nodes.filter((node) => node.localName === "remarks").forEach((node) => add(node, "remarks", "REMARKS"));
    input.nodes.filter((node) => node.localName === "noticeSignature").forEach((node) => add(node, "signature", "SIGNATURE"));
    const header = input.nodes.find((node) => node.localName === "headerData");
    const formData = input.nodes.find((node) => node.localName === "formData");
    for (const child of header?.children ?? []) {
      if (!FORM144_KNOWN_HEADER_SECTIONS.has(child.localName)) {
        add(child, "unrecognized_xml_section", "UNRECOGNIZED HEADER SECTION");
      }
    }
    for (const child of formData?.children ?? []) {
      if (!FORM144_KNOWN_FORM_SECTIONS.has(child.localName)) {
        add(child, "unrecognized_xml_section", "UNRECOGNIZED FORM SECTION");
      }
    }
  }
  return descriptors.sort((left, right) => left.node.order - right.node.order);
}

function footnoteMetadata(
  node: XmlNode,
  rowNodes: readonly XmlNode[],
  inventory: OwnershipContextReferenceInventory,
  sourceXml: string,
) {
  const xmlId = node.attributes.find((attribute) => attribute.localName === "id")?.decodedValue ?? "";
  const transactionNodes = [
    ...rowNodes.filter((row) => row.localName === "nonDerivativeTransaction"),
    ...rowNodes.filter((row) => row.localName === "derivativeTransaction"),
  ];
  const linkedRows = transactionNodes
    .map((row, index) => readFootnoteRefs(row).includes(`footnote:${xmlId}`) ? inventory.rows[index]?.rowRef : null)
    .filter((value): value is string => Boolean(value));
  const linkedSourceRowOrdinals = rowNodes
    .map((row, index) => readFootnoteRefs(row).includes(`footnote:${xmlId}`)
      ? index
      : null)
    .filter((value): value is number => value !== null);
  const exactTextRaw = sourceXml.slice(node.innerStart, node.closeStart);
  return {
    footnote: xmlId,
    exact_text_raw: exactTextRaw,
    text_decoded: decodeLeafXml(exactTextRaw),
    linked_source_row_ordinals: linkedSourceRowOrdinals,
    linked_rows: linkedRows.map((rowRef) => inventory.rows.findIndex((row) => row.rowRef === rowRef))
      .filter((index) => index >= 0)
      .map((index) => `R${index + 1}`),
  };
}

export function buildOwnershipContextSelectionBindings(
  inventory: OwnershipContextReferenceInventory,
): OwnershipContextSelectionBindings {
  let securityOrdinal = 1;
  const seenFootnotes = new Set<string>();
  for (const footnote of inventory.footnotes) {
    const short = shortFootnoteRef(footnote.footnoteRef);
    if (!short || seenFootnotes.has(short)) throw new Error("ownership_context_selection_footnote_ref_invalid");
    seenFootnotes.add(short);
  }
  const rows = inventory.rows.map((row, rowIndex) => {
    const rowSecurity = row.securityRef
      ? { security: `S${securityOrdinal++}`, canonicalSecurityRef: row.securityRef }
      : null;
    const underlyingSecurities = row.underlyingSecurityRefs.map((canonicalSecurityRef) => ({
      security: `S${securityOrdinal++}`,
      canonicalSecurityRef,
    }));
    return Object.freeze({
      row: `R${rowIndex + 1}`,
      canonicalRowRef: row.rowRef,
      owners: Object.freeze(row.ownerRefs.map((canonicalOwnerRef, ownerIndex) => Object.freeze({
        owner: `O${ownerIndex + 1}`,
        canonicalOwnerRef,
      }))),
      rowSecurity: rowSecurity ? Object.freeze(rowSecurity) : null,
      underlyingSecurities: Object.freeze(underlyingSecurities.map((item) => Object.freeze(item))),
      footnotes: Object.freeze(row.linkedFootnoteRefs.map((canonicalFootnoteRef) => Object.freeze({
        footnote: shortFootnoteRef(canonicalFootnoteRef),
        canonicalFootnoteRef,
      }))),
      canonicalEvidenceRefs: Object.freeze([...row.evidenceRefs]),
    });
  });
  return Object.freeze({
    version: OWNERSHIP_CONTEXT_SELECTION_REFS_VERSION,
    rows: Object.freeze(rows),
  });
}

function shortFootnoteRef(value: string) {
  const short = value.startsWith("footnote:") ? value.slice("footnote:".length) : value;
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(short) || /^(?:R|O|S)\d+$/i.test(short)) {
    throw new Error("ownership_context_selection_footnote_ref_invalid");
  }
  return short;
}

function nearestDescriptor(node: XmlNode, descriptors: ReadonlyMap<XmlNode, BlockDescriptor>) {
  let current: XmlNode | null = node;
  while (current) {
    const descriptor = descriptors.get(current);
    if (descriptor) return descriptor;
    current = current.parent;
  }
  return null;
}

function nearestAncestor(node: XmlNode, predicate: (candidate: XmlNode) => boolean) {
  let current: XmlNode | null = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

function descendants(node: XmlNode): XmlNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function readFootnoteRefs(node: XmlNode) {
  return [...new Set(descendants(node)
    .filter((candidate) => candidate.localName === "footnoteId")
    .flatMap((candidate) => candidate.attributes)
    .filter((attribute) => attribute.localName === "id")
    .map((attribute) => `footnote:${attribute.decodedValue}`))];
}

function parseXml(xml: string) {
  const tokenPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<[^>]+>|[^<]+/g;
  const stack: XmlNode[] = [];
  const roots: XmlNode[] = [];
  let ignoredNodeCount = 0;
  let order = 0;
  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    const start = match.index;
    if (token.startsWith("<!--") || token.startsWith("<?") || (token.startsWith("<!") && !token.startsWith("<![CDATA["))) {
      ignoredNodeCount += 1;
      continue;
    }
    if (token.startsWith("<![CDATA[")) {
      if (stack.length === 0) throw new Error("ownership_neutral_source_blocks_cdata_outside_root");
      stack.at(-1)!.textParts.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith("</")) {
      const closingName = token.slice(2, -1).trim();
      const node = stack.pop();
      if (!node || node.name !== closingName) throw new Error("ownership_neutral_source_blocks_xml_unbalanced");
      node.closeStart = start;
      node.sourceEnd = start + token.length;
      continue;
    }
    if (token.startsWith("<")) {
      const opening = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?\s*>$/);
      if (!opening) throw new Error("ownership_neutral_source_blocks_xml_tag_invalid");
      const name = opening[1];
      const selfClosing = /\/\s*>$/.test(token);
      const parent = stack.at(-1) ?? null;
      const attributes = parseAttributes(token, start);
      const node: XmlNode = {
        name,
        localName: localName(name),
        attributes,
        children: [],
        textParts: [],
        parent,
        order: order++,
        sourceStart: start,
        sourceEnd: start + token.length,
        innerStart: start + token.length,
        closeStart: start + token.length,
        path: "",
      };
      if (parent) parent.children.push(node);
      else roots.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }
    if (stack.length > 0) stack.at(-1)!.textParts.push(token);
    else if (token.trim()) throw new Error("ownership_neutral_source_blocks_text_outside_root");
  }
  if (stack.length > 0 || roots.length !== 1) throw new Error("ownership_neutral_source_blocks_xml_unbalanced");
  for (const node of flattenNodes(roots[0])) {
    if (node.children.length > 0 && node.textParts.some((part) => part.trim().length > 0)) {
      throw new Error("ownership_neutral_source_blocks_mixed_content_unsupported");
    }
  }
  assignPaths(roots[0], `/${roots[0].name}`);
  return { root: roots[0], ignoredNodeCount };
}

function parseAttributes(openingTag: string, absoluteStart: number) {
  const tagNameEnd = openingTag.search(/[\s/>]/);
  const attributes: XmlAttribute[] = [];
  const pattern = /([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  pattern.lastIndex = Math.max(1, tagNameEnd);
  for (const match of openingTag.matchAll(pattern)) {
    const rawValue = match[3];
    const valueOffset = match.index + match[0].indexOf(rawValue);
    attributes.push({
      name: match[1],
      localName: localName(match[1]),
      rawValue,
      decodedValue: decodeXml(rawValue),
      sourceStart: absoluteStart + valueOffset,
      sourceEnd: absoluteStart + valueOffset + rawValue.length,
    });
  }
  return attributes;
}

function assignPaths(node: XmlNode, path: string) {
  node.path = path;
  const totals = new Map<string, number>();
  for (const child of node.children) totals.set(child.name, (totals.get(child.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const child of node.children) {
    const ordinal = seen.get(child.name) ?? 0;
    seen.set(child.name, ordinal + 1);
    const segment = totals.get(child.name)! > 1 ? `${child.name}[${ordinal}]` : child.name;
    assignPaths(child, `${node.path}/${segment}`);
  }
}

function flattenNodes(root: XmlNode): XmlNode[] {
  return [root, ...root.children.flatMap(flattenNodes)].sort((left, right) => left.order - right.order);
}

function normalizeForm(value: string): "form4" | "form144" | null {
  const form = value.trim().toUpperCase().replace(/^FORM\s+/, "");
  if (form === "4" || form === "4/A") return "form4";
  if (form === "144" || form === "144/A") return "form144";
  return null;
}

function localName(value: string) {
  return value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
}

function relativeXmlPath(node: XmlNode, descriptorNode: XmlNode) {
  if (node === descriptorNode) return node.localName;
  const relative = node.path.slice(descriptorNode.path.length + 1);
  return relative
    .split("/")
    .map((segment) => segment.replace(/^.*:/, ""))
    .join("/");
}

function decodeLeafXml(value: string) {
  let decoded = "";
  let cursor = 0;
  const cdataPattern = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  for (const match of value.matchAll(cdataPattern)) {
    decoded += decodeXml(stripIgnoredXml(value.slice(cursor, match.index)));
    decoded += match[1];
    cursor = match.index + match[0].length;
  }
  decoded += decodeXml(stripIgnoredXml(value.slice(cursor)));
  return decoded;
}

function stripIgnoredXml(value: string) {
  return value.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>/g, "");
}

function decodeXml(value: string) {
  return value.replace(
    /&(amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos" || normalized === "#39") return "'";
      if (normalized.startsWith("#x")) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      if (normalized.startsWith("#")) return String.fromCodePoint(Number(normalized.slice(1)));
      return entity;
    },
  );
}

function pad(value: number) {
  return String(value).padStart(4, "0");
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
