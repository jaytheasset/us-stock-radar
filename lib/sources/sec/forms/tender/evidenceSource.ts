import { createHash } from "node:crypto";
import { parseDocument } from "htmlparser2";
import type { AnyNode } from "domhandler";

export const tenderSourceHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export const TENDER_EVIDENCE_FORMS = ["SC TO-I", "SC TO-I/A", "SC TO-T", "SC TO-T/A", "SC TO-C", "SC 13E3", "SC 13E3/A", "SC 14D9", "SC 14D9/A", "CB", "CB/A"] as const;
export type TenderSourceDocument = {
  accession: string;
  form: string;
  documentId: string;
  url: string;
  role: "primary" | "attachment";
  /** Original fetched HTML or prepared document text; never analysis_text/Parser facts. */
  content: string;
  format: "html" | "text";
  completeness: "complete" | "excerpt" | "truncated";
};
export type TenderSourcePacket = {
  accession: string;
  form: string;
  documents: TenderSourceDocument[];
  unavailable: Array<{ documentId: string; reason: string }>;
};

/** Versioned rendering, preserving table rows, cells, spans and paragraph boundaries. */
export function renderTenderSource(html: string): string {
  function render(node: AnyNode): string {
    if (node.type === "text") return node.data.replace(/[\s\u00a0]+/g, " ");
    if (!("attribs" in node)) return "children" in node ? node.children.map(render).join("") : "";
    if (["script", "style", "ix:hidden"].includes(node.name)) return "";
    const body = node.children.map(render).join("");
    if (node.name === "table") return `\n[TABLE]\n${body}\n[/TABLE]\n`;
    if (node.name === "tr") return `\n${body}\n`;
    if (node.name === "td" || node.name === "th") {
      const spans = ["colspan", "rowspan"].filter((key) => node.attribs[key]).map((key) => `${key}=${node.attribs[key]}`).join(" ");
      return `|${spans ? `[${spans}]` : ""}${body}|`;
    }
    return /^(p|div|h[1-6]|li|br|hr)$/.test(node.name) ? `\n${body}\n` : body;
  }
  return render(parseDocument(html)).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Retrieval vocabulary only. No expressions assign transaction meaning or values.
const relevant = /\b(?:item\s*4|solicitation|recommend\w*|tender\w*|offer\w*|purchase|consideration|expir\w*|exten\w*|prorat\w*|withdraw\w*|minimum|regulatory|antitrust|accepted|exchange|shares?|special committee|fairness|fair\b|opinion|amend\w*|previously|increased|decreased)\b/i;

export function selectTenderSourceSlices(text: string) {
  const units: Array<{ start: number; end: number; heading: string | null }> = [];
  let heading: string | null = null;
  let tableStart = -1;
  let depth = 0;
  for (const match of text.matchAll(/[^\n]+/g)) {
    const line = match[0];
    const start = match.index!;
    if (line === "[TABLE]") { if (depth++ === 0) tableStart = start; continue; }
    if (line === "[/TABLE]") {
      if (--depth === 0) units.push({ start: tableStart, end: start + line.length, heading });
      continue;
    }
    if (depth > 0) continue;
    if (line.length < 160 && (/^Item\s+\d+\b/i.test(line) || (/[A-Z]{3}/.test(line) && line === line.toUpperCase()))) heading = line;
    units.push({ start, end: start + line.length, heading });
  }
  // Text supplied by a caller may contain an incomplete table; keep it, flag via completeness.
  if (depth > 0) units.push({ start: tableStart, end: text.length, heading });
  const ranges = new Map<string, { start: number; end: number; heading: string | null }>();
  units.forEach((unit, i) => {
    if (!relevant.test(text.slice(unit.start, unit.end))) return;
    const start = units[Math.max(0, i - 1)].start;
    const end = units[Math.min(units.length - 1, i + 1)].end;
    ranges.set(`${start}:${end}`, { start, end, heading: unit.heading });
  });
  return [...ranges.values()];
}

export function validateTenderFiling(packet: Pick<TenderSourcePacket, "accession" | "form">) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(packet.accession) || !TENDER_EVIDENCE_FORMS.includes(packet.form as typeof TENDER_EVIDENCE_FORMS[number])) throw new Error("Invalid Tender filing identity");
}

export function validateTenderDocument(document: TenderSourceDocument, packet: Pick<TenderSourcePacket, "accession" | "form">) {
  validateTenderFiling(packet);
  if (document.accession !== packet.accession || document.form !== packet.form) throw new Error("Cross-filing document rejected");
  const url = new URL(document.url);
  const path = url.pathname.match(/^\/Archives\/edgar\/data\/\d+\/(\d{18})\/([^/]+)$/);
  if (url.origin !== "https://www.sec.gov" || url.username || url.password || url.search || url.hash || !path || path[1] !== packet.accession.replaceAll("-", "") || path[2] !== document.documentId) throw new Error("Document URL/identity mismatch");
  if (!["primary", "attachment"].includes(document.role) || !["html", "text"].includes(document.format) || !["complete", "excerpt", "truncated"].includes(document.completeness)) throw new Error("Invalid source document metadata");
}
