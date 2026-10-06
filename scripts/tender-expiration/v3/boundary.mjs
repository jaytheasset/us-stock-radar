import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateOutput } from './contract.ts';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Positional opaque labels only; original source text and order are unchanged. */
export function projectSource(source) {
  const evidenceMap = {};
  const evidence = source.evidence.map((e, i) => {
    const ref = `E${i + 1}`;
    const { id, text, ...provenance } = e;
    evidenceMap[ref] = { evidence_id: id, ...provenance };
    return { ref, text };
  });
  return { providerSource: { form: source.form, coverage: {
    partialDocuments: source.coverage.partialDocuments,
    unavailable: source.coverage.unavailable,
    externalReferences: source.coverage.externalReferences,
    selection: source.coverage.selection,
  }, evidence }, evidenceMap };
}

/** Exact pre-frozen identity lookup only. Never fixes dates/refs or selects evidence. */
export function resolveProvenance({ raw, mapBytes, frozenMapHash, source }) {
  const refs = projectSource(source).providerSource.evidence.map(e => e.ref);
  const validation = validateOutput(raw, refs);
  if (!validation.providerSchema.valid || !validation.local.valid) return { valid: false, errors: ['output-validation-failed'], resolved: [] };
  if (hash(mapBytes) !== frozenMapHash) return { valid: false, errors: ['mapping-hash-mismatch'], resolved: [] };
  let map;
  try { map = JSON.parse(mapBytes); } catch { return { valid: false, errors: ['invalid-mapping-json'], resolved: [] }; }
  // Exact mapping metadata must still match the unchanged actual Evidence inventory.
  if (!isDeepStrictEqual(map, projectSource(source).evidenceMap)) return { valid: false, errors: ['mapping-source-mismatch'], resolved: [] };
  const output = JSON.parse(raw);
  const resolved = [];
  for (const [fact_index, fact] of output.facts.entries()) {
    for (const ref of fact.evidence_refs) {
      const entry = map[ref];
      const actual = source.evidence.find(e => e.id === entry?.evidence_id);
      if (!actual || actual.accession !== source.accession || entry.accession !== source.accession || entry.document.accession !== source.accession) {
        return { valid: false, errors: ['foreign-or-missing-evidence'], resolved: [] };
      }
      resolved.push({ fact_index, ref, evidence_id: entry.evidence_id, accession: entry.accession });
    }
  }
  return { valid: true, errors: [], mappingHash: frozenMapHash, resolved };
}
