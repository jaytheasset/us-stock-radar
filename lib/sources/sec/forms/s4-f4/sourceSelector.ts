import { createHash } from "node:crypto";
import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";

/** Offline/transient HTML input. Never place this input in a persisted binding. */
export interface S4F4SourceDocument {
  accession: string;
  url: string;
  filename: string;
  role: "current" | "parent" | "exhibit";
  html: string;
  /** Required caller purpose for optional sources; no automatic acquisition. */
  purpose?: "amendment-comparison" | "direct-supplement";
}

export interface S4F4SelectedSection {
  heading: string;
  reason: "toc-body-section" | "body-heading-section" | "direct-definition";
  /** Half-open JS UTF-16 offsets in the original HTML, NOT UTF-8 byte offsets. */
  htmlStart: number;
  htmlEnd: number;
  text: string;
}

// Topic routing only: these expressions do not establish transaction facts.
const CORE = /\b(mergers?|business combination|exchange offer|consent solicitation|consideration|closing conditions?|conditions to|conditions precedent|regulatory approvals?|termination|extension|ownership|equity stake|dilution|special meeting|extraordinary general meeting|vote required|voting|quorum|stock issuance|share issuance|domestication|governing documents?|organizational documents?|adjournment)\b/i;
const EXCLUDE = /^(?:annex|appendix|exhibit)\b|\b(tax consequences|tax considerations|tax effects|risk factors|forward.looking|compensation|incentive plan|stock purchase plan|financial statements|financial information|fairness opinion|representations and warranties|payments upon termination|termination scenario)\b/i;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const start = (n: AnyNode) => n.startIndex ?? 0;
const end = (n: AnyNode) => (n.endIndex ?? start(n)) + 1;
const isElement = (n: AnyNode): n is Element => "attribs" in n;

/** Retains row/cell boundaries, empty cells, spans and all text; no table truncation. */
export function renderS4F4SourceHtml(html: string): string {
  const root = parseDocument(html);
  function render(n: AnyNode): string {
    if (n.type === "text") return n.data.replace(/[\s\u00a0]+/g, " ");
    if (!isElement(n)) return "children" in n ? n.children.map(render).join("") : "";
    if (["script", "style", "ix:hidden"].includes(n.name)) return "";
    const body = n.children.map(render).join("");
    if (n.name === "table") return `\n[TABLE]\n${body}\n[/TABLE]\n`;
    if (n.name === "tr") return `\n${body}\n`;
    if (n.name === "td" || n.name === "th") {
      const spans = ["colspan", "rowspan"].filter((a) => n.attribs[a])
        .map((a) => `${a}=${n.attribs[a]}`).join(" ");
      return `|${spans ? `[${spans}]` : ""}${body}|`;
    }
    if (/^(p|div|h[1-6]|li|br|hr)$/.test(n.name)) return `\n${body}\n`;
    return body;
  }
  return render(root).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Heading = { text: string; offset: number; toc: boolean };

function selectDocument(source: S4F4SourceDocument) {
  const root = parseDocument(source.html, { withStartIndices: true, withEndIndices: true });
  const elements = DomUtils.findAll(() => true, root.children);
  const targets = new Map<string, Element>();
  for (const n of elements) {
    for (const id of [n.attribs.id, n.attribs.name]) if (id && !targets.has(id)) targets.set(id, n);
  }
  // Index body blocks once. A heading must occupy its own block, not be inline emphasis.
  const blocks = elements.filter((n) => /^(p|h[1-6]|div)$/.test(n.name)
    && !n.children.some((c) => isElement(c) && /^(p|div|table)$/.test(c.name)));
  const textCache = new Map<Element, string>();
  const textOf = (n: Element) => {
    if (!textCache.has(n)) textCache.set(n, norm(DomUtils.textContent(n)));
    return textCache.get(n)!;
  };
  const headings: Heading[] = [];
  for (const n of blocks) {
    const text = textOf(n);
    if (text.length < 5 || text.length > 220 || /^table of contents$/i.test(text)) continue;
    let tableParent = n.parent;
    while (tableParent && !(isElement(tableParent) && tableParent.name === "table")) tableParent = tableParent.parent;
    // Column labels, totals and footnote cells are not section boundaries. SEC Q&A
    // sometimes puts a whole question in a small layout table; retain those headings.
    if (tableParent && !(text.endsWith("?") && norm(DomUtils.textContent(tableParent)).length <= 300)) continue;
    const bold = DomUtils.findAll((e) => /^(b|strong)$/.test(e.name)
      || /font-weight\s*:\s*(bold|[7-9]00)/i.test(e.attribs.style ?? ""), n.children);
    const boldText = norm(bold.map((e) => DomUtils.textContent(e)).join(" "));
    const styled = /font-weight\s*:\s*(bold|[7-9]00)/i.test(n.attribs.style ?? "")
      || key(boldText) === key(text);
    const caps = text === text.toUpperCase() && /[A-Z]{3}/.test(text);
    const plainCaption = text.length <= 120 && text.endsWith(":") && CORE.test(text);
    if (/^h[1-6]$/.test(n.name) || plainCaption || ((styled || caps) && !/[.;]$/.test(text))) {
      // TOC link labels are not body headings.
      if (DomUtils.findAll((e) => e.name === "a" && !!e.attribs.href?.startsWith("#"), n.children).length) continue;
      headings.push({ text, offset: start(n), toc: false });
    }
  }
  const toc = new Map<number, Heading>();
  for (const link of elements.filter((n) => n.name === "a" && n.attribs.href?.startsWith("#"))) {
    const label = norm(DomUtils.textContent(link));
    if (label.length < 5 || label.length > 220 || /^(table of contents|page[s]?\b)/i.test(label)) continue;
    const target = targets.get(link.attribs.href.slice(1));
    if (!target || start(target) <= start(link)) continue;
    // Confirm the link label against an actual nearby body heading. No TOC-only evidence.
    const heading = headings.find((h) => Math.abs(h.offset - start(target)) < 1800 && key(h.text) === key(label));
    if (heading) toc.set(heading.offset, { ...heading, toc: true });
  }
  const tocHeadings = [...toc.values()].sort((a, b) => a.offset - b.offset);
  const allHeadings = [...new Map([...headings, ...tocHeadings].map((h) => [h.offset, h])).values()]
    .sort((a, b) => a.offset - b.offset);
  const ranges: Array<Omit<S4F4SelectedSection, "text">> = [];
  for (const h of allHeadings) {
    if (!CORE.test(h.text) || EXCLUDE.test(h.text)) continue;
    const boundaries = h.toc ? tocHeadings : allHeadings;
    const next = boundaries.find((n) => n.offset > h.offset);
    ranges.push({ heading: h.text, reason: h.toc ? "toc-body-section" : "body-heading-section",
      htmlStart: h.offset, htmlEnd: next?.offset ?? source.html.length });
  }
  // Limited direct supplementation for economic definitions; no recursive reference graph.
  let definitions = 0;
  for (const [blockIndex, n] of blocks.entries()) {
    const text = textOf(n);
    if (/^[“"‘'][^“”"\n]{0,90}\b(cash|proceeds|consideration|purchase price)\b[^“”"\n]{0,50}[”"’'][^“”"\n]{0,180}\b(?:means|shall mean)\b/i.test(text)
      && !ranges.some((r) => start(n) >= r.htmlStart && end(n) <= r.htmlEnd)) {
      if (definitions++ >= 12) break;
      let definitionEnd = end(n);
      // A definition can continue across page furniture; stop at the next definition/heading.
      for (const following of blocks.slice(blockIndex + 1, blockIndex + 9)) {
        const followingText = textOf(following);
        if (/^[“"‘']/.test(followingText) || allHeadings.some((h) => h.offset === start(following))) break;
        definitionEnd = end(following);
      }
      ranges.push({ heading: text.slice(0,100), reason: "direct-definition", htmlStart: start(n), htmlEnd: definitionEnd });
    }
  }
  // Expand a boundary if it would bisect a table (including multi-row headers).
  const tables = elements.filter((n) => n.name === "table");
  for (const r of ranges) for (const table of tables) {
    if (start(table) < r.htmlStart && end(table) > r.htmlStart) r.htmlStart = start(table);
    if (start(table) < r.htmlEnd && end(table) > r.htmlEnd) r.htmlEnd = end(table);
  }
  // Union overlap: selected text occurs once per document, never once per topic.
  const merged: typeof ranges = [];
  for (const r of ranges.sort((a,b) => a.htmlStart - b.htmlStart || b.htmlEnd - a.htmlEnd)) {
    const prev = merged.at(-1);
    if (prev && r.htmlStart < prev.htmlEnd) prev.htmlEnd = Math.max(prev.htmlEnd, r.htmlEnd);
    else merged.push({ ...r });
  }
  const sections: S4F4SelectedSection[] = merged.map((r) => ({ ...r,
    text: renderS4F4SourceHtml(source.html.slice(r.htmlStart, r.htmlEnd)) }));
  return {
    accession: source.accession, url: source.url, filename: source.filename, role: source.role,
    purpose: source.purpose ?? null,
    sha256: createHash("sha256").update(source.html, "utf8").digest("hex"),
    originalHtmlChars: source.html.length, originalHtmlUtf8Bytes: Buffer.byteLength(source.html),
    tocBodyMatches: tocHeadings.length, sections,
    coverage: sections.length ? "selected-context-requires-review" : "no-core-heading-selected",
  };
}

export function selectS4F4Sources(input: {
  form: "S-4" | "F-4" | "S-4/A" | "F-4/A";
  documents: S4F4SourceDocument[];
}) {
  if (!["S-4", "F-4", "S-4/A", "F-4/A"].includes(input.form)) throw new Error("Unsupported form");
  if (input.documents.filter((d) => d.role === "current").length !== 1) throw new Error("Exactly one current source required");
  for (const d of input.documents) {
    if (d.role === "parent" && d.purpose !== "amendment-comparison") throw new Error("Parent requires comparison purpose");
    if (d.role === "exhibit" && d.purpose !== "direct-supplement") throw new Error("Exhibit requires supplement purpose");
  }
  const documents = input.documents.map(selectDocument);
  const chars = documents.reduce((sum,d) => sum + d.sections.reduce((s,r) => s + r.text.length,0),0);
  const utf8Bytes = documents.reduce((sum,d) => sum + d.sections.reduce((s,r) => s + Buffer.byteLength(r.text),0),0);
  const metadataUtf8Bytes = Buffer.byteLength(JSON.stringify(documents.map((d) => ({ ...d,
    sections: d.sections.map(({ text: _text, ...r }) => r) }))));
  return {
    version: "s4-f4-core-sections-v1", form: input.form, documents,
    amendmentComparison: input.form.endsWith("/A")
      ? (documents.some((d) => d.role === "parent") ? "separate-parent-context-available" : "parent-not-provided-current-still-selectable")
      : "not-requested",
    metrics: { chars, utf8Bytes, metadataUtf8Bytes, metadataToEvidenceRatio: metadataUtf8Bytes / Math.max(utf8Bytes,1),
      localTokenEstimate: { low: Math.ceil(chars / 5), high: Math.ceil(chars / 3), method: "character heuristic only; NOT Gemini tokenizer" } },
    limitations: ["Selection is not a FACT result or a completeness finding.",
      "Unselected/unavailable references are not evidence of absence in the filing.",
      "No recursive references, automatic fetch, fixed byte cutoff, or amendment-change inference."],
  };
}
