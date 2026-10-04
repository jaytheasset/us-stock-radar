import assert from "node:assert/strict";
import test from "node:test";
import { parseProxyFiling } from "./parser.ts";

const blocksFor = (filingText: string, formType = "DEF 14A") =>
  parseProxyFiling({ formType, filingText }).raw.discoveryBlocks;
const join = (blocks: ReturnType<typeof blocksFor>) => blocks.map(b => b.text).join("\n");

test("full continuous bodies, repeated numbers and late subsections survive exact 6k source chunks", () => {
  const text = [
    "PROPOSAL 1", "FIRST_OCCURRENCE " + "Body prose. ".repeat(800),
    "Board Discretion", "LATE_DISCRETION", "Effects", "LATE_EFFECTS",
    "Fractional Shares", "LATE_FRACTIONS", "Effective Time", "LATE_TIME",
    "PROPOSAL 2", "Second body. ".repeat(100),
    "PROPOSAL 1", "Repeated body. ".repeat(600), "REPEATED_TAIL",
    "ADDITIONAL INFORMATION", "Unselected unrelated text. ".repeat(150), "OUTSIDE_SECTION",
  ].map(line => line.trim()).join("\n");
  const blocks = blocksFor(text);
  for (const marker of ["LATE_DISCRETION", "LATE_EFFECTS", "LATE_FRACTIONS", "LATE_TIME", "REPEATED_TAIL"]) {
    assert.ok(join(blocks).includes(marker), marker);
  }
  assert.ok(!join(blocks).includes("OUTSIDE_SECTION"));
  assert.ok(blocks.filter(b => b.cues.includes("proposal_body_section")).length > 3);
  for (const b of blocks) {
    assert.ok(b.text.length <= 6000);
    assert.equal(text.slice(b.startChar, b.endChar), b.text);
    assert.equal(b.sourceDocumentIndex, 0);
    assert.match(b.id, /^D1-B\d+$/);
    assert.ok(!(b.text.includes("LATE_TIME") && b.text.includes("PROPOSAL 2")), "body chunks stop at the next peer heading");
  }
  const end = text.indexOf("\nADDITIONAL INFORMATION");
  for (let offset = 0; offset < end; offset++) {
    assert.ok(blocks.some(b => b.startChar <= offset && b.endChar > offset) || /\s/.test(text[offset]));
  }
});

test("TOC final entries do not expand across unrelated chapters; ITEM and MATTER bodies remain", () => {
  const text = [
    "CONTENTS", "ITEM 1 ........ 3", "ITEM 2 ........ 4",
    "Introduction. ".repeat(400), "UNRELATED_MIDDLE", "Introduction. ".repeat(400),
    "ITEM 1", "First body. ".repeat(100), "ITEM_ONE_TAIL",
    "MATTER 2", "Second body. ".repeat(100), "MATTER_TWO_TAIL",
    "OTHER BUSINESS", "Generic closing. ".repeat(200), "OTHER_BUSINESS_TAIL",
  ].join("\n");
  const source = join(blocksFor(text));
  assert.ok(!source.includes("UNRELATED_MIDDLE"));
  assert.ok(source.includes("ITEM_ONE_TAIL"));
  assert.ok(source.includes("MATTER_TWO_TAIL"));
  assert.ok(!source.includes("OTHER_BUSINESS_TAIL"));
});

test("local voting references and explicitly linked appendices preserve competing wording", () => {
  const text = [
    "The Board recommends Proposal 1. See Appendix B for the form.",
    "Support text. ".repeat(80), "SEPARATE_CONTEXT",
    "Unrelated introduction. ".repeat(200),
    "PROPOSAL 1", "Refer to Appendix A for the proposed text.",
    "Body. ".repeat(300), "BODY_TAIL",
    "OTHER MATTERS", "Unrelated closing. ".repeat(200),
    "APPENDIX A", "Form text. ".repeat(200), "APPENDIX_A_TAIL",
    "APPENDIX B", "Competing form text. ".repeat(200), "APPENDIX_B_TAIL",
    "APPENDIX C", "Unreferenced form. ".repeat(200), "UNREFERENCED_TAIL",
  ].join("\n");
  const source = join(blocksFor(text));
  assert.ok(source.includes("Proposal 1"));
  assert.ok(source.includes("APPENDIX_A_TAIL"));
  assert.ok(source.includes("APPENDIX_B_TAIL"));
  assert.ok(!source.includes("UNREFERENCED_TAIL"));
});

test("a full proxy mentioning a supplement is not routed by semantic inventory", () => {
  const text = ["PROXY STATEMENT", "This supplement amends the proxy statement.",
    "PROPOSAL 1", "Proposal body. ".repeat(500), "FULL_PROXY_TAIL", "OTHER MATTERS"].join("\n");
  assert.ok(join(blocksFor(text)).includes("FULL_PROXY_TAIL"));
});

test("parent-only supplement does not import sections, appendices or generic full-document fallback", () => {
  const text = ["SUPPLEMENT TO THE PROXY STATEMENT",
    "We filed a definitive proxy statement. This supplement does not change the proposals in the proxy statement.",
    "Administrative discussion. ".repeat(300), "UNRELATED_TAIL", "APPENDIX A", "Unrelated form. ".repeat(300)].join("\n");
  const blocks = blocksFor(text, "DEFA14A");
  assert.ok(!join(blocks).includes("UNRELATED_TAIL"));
  assert.ok(!blocks.some(b => b.cues.includes("proposal_body_section") || b.cues.includes("explicitly_referenced_attachment_section")));
});

test("stacked labels for the same numbered body are not mistaken for a TOC run", () => {
  const source = join(blocksFor(["PROPOSAL NUMBER 1", "PROPOSAL 1: AMENDMENT",
    "Body narrative. ".repeat(500), "STACKED_BODY_TAIL", "PROPOSAL NUMBER 2",
    "Second body. ".repeat(100), "OTHER MATTERS"].join("\n")));
  assert.ok(source.includes("STACKED_BODY_TAIL"));
});

test("auxiliary references select paragraphs without overlapping chunks or bridging intervening prose", () => {
  const repeated = "The Board recommends Proposal 1 and Proposal 2. This paragraph is repeated verbatim.";
  const source = [repeated, "Unselected prose. ".repeat(200), "UNSELECTED_GAP", "More prose. ".repeat(200), repeated].join("\n\n");
  const blocks = blocksFor(source);
  assert.ok(join(blocks).includes("Board recommends"));
  assert.ok(!join(blocks).includes("UNSELECTED_GAP"));
  assert.equal(join(blocks).split("This paragraph is repeated verbatim.").length - 1, 1);
  const ordered = [...blocks].sort((a, b) => a.startChar - b.startChar);
  assert.ok(ordered.every((b, i) => !i || ordered[i - 1].endChar <= b.startChar));
  assert.ok(blocks.every(b => b.text === source.slice(b.startChar, b.endChar)));
});

test("a voting subsection crosses page furniture but stops at the next real heading", () => {
  const source = ["Vote Required; Quorum; Broker Non-votes", "First paragraph about the vote.",
    "1", "Table of Contents", "The voting requirement differs here. KEEP_SECOND_ACCOUNT.",
    "OTHER MATTERS", "Administrative prose. ".repeat(200), "UNSELECTED_TAIL"].join("\n\n");
  const blocks = blocksFor(source);
  assert.ok(join(blocks).includes("KEEP_SECOND_ACCOUNT"));
  assert.ok(!join(blocks).includes("UNSELECTED_TAIL"));
});

test("an agenda introduction retains complete adjacent table rows, including generic other-business", () => {
  const source = ["The Special Meeting will be held for the following purposes:", "| | |", "| 1 |",
    "| Adopt the first amendment with bracketed quantity [167,500,000]. |",
    "| 2 |", "| Transact such other business as may properly come before the meeting. |",
    "Unrelated post-table narrative. ".repeat(200), "AFTER_TABLE_TAIL"].join("\n\n");
  const blocks = blocksFor(source);
  assert.ok(join(blocks).includes("[167,500,000]"));
  assert.ok(join(blocks).includes("such other business"));
  assert.ok(!join(blocks).includes("AFTER_TABLE_TAIL"));
});

test("plan body benefits-table labels are not mistaken for document-level chapters", () => {
  const source = ["PROPOSAL 1", "Plan body. ".repeat(100), "Executive Officers",
    "Benefits table and following conditions. ".repeat(200), "PLAN_BODY_TAIL",
    "PROPOSAL 2", "Other body. ".repeat(100)].join("\n\n");
  assert.ok(join(blocksFor(source)).includes("PLAN_BODY_TAIL"));
});

test("a long referenced attachment keeps identity and the addressed section, not the entire plan", () => {
  const source = ["PROPOSAL 1", "See Section 2 of Appendix A for the proposed text.",
    "Main body. ".repeat(100), "OTHER MATTERS", "Administrative material. ".repeat(100),
    "APPENDIX A", "2026 INCENTIVE PLAN", "SECTION 1 Purpose", "Unaddressed introduction. ".repeat(400),
    "SECTION 2 Amendment", "Addressed text. ".repeat(400), "ADDRESSED_TAIL",
    "SECTION 3 Administration", "Unaddressed rest. ".repeat(400), "UNADDRESSED_TAIL"].join("\n\n");
  const blocks = blocksFor(source);
  assert.ok(join(blocks).includes("2026 INCENTIVE PLAN"), "a year in a title is not a numbered section");
  assert.ok(join(blocks).includes("ADDRESSED_TAIL"));
  assert.ok(!join(blocks).includes("UNADDRESSED_TAIL"));
  assert.ok(!join(blocks).includes("Unaddressed introduction."));
});

test("even a short chaptered appendix is not included whole merely because it is referenced", () => {
  const source = ["PROPOSAL 1", "See Section 2 of Appendix A.", "Body text. ".repeat(100),
    "OTHER MATTERS", "APPENDIX A", "2026 PLAN", "SECTION 1 Purpose", "Unaddressed purpose. ".repeat(70),
    "SECTION 2 Amendment", "RETAIN_AMENDMENT", "Addressed paragraph. ".repeat(70),
    "SECTION 3 Administration", "Unaddressed rules. ".repeat(70), "DROP_UNREFERENCED_CHAPTER"].join("\n\n");
  const sourceBlocks = join(blocksFor(source));
  assert.ok(sourceBlocks.includes("RETAIN_AMENDMENT"));
  assert.ok(!sourceBlocks.includes("DROP_UNREFERENCED_CHAPTER"));
});
