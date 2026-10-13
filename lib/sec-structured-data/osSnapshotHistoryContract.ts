import type {SnapshotShareCountHistoryObservation} from './shareCountHistory.ts';

export const OS_SNAPSHOT_HISTORY_SOURCE='sec_os_snapshot_verified' as const;
export const OS_SNAPSHOT_PUBLICATION_VERSION='os-snapshot-history-publication-v1' as const;

/** A source-specific lineage; never a human approval or XBRL authority claim. */
export function validateOsSnapshotHistory(row:SnapshotShareCountHistoryObservation){
 const p=row.sourceProvenance.snapshot as Record<string,any>|undefined;
 const identity=row.securityClassIdentity.identity as Record<string,unknown>|undefined;
 if(row.observationType!=='source_stated'||row.securityClassBasis!=='SOURCE_STATED_SECURITY_CLASS'
  ||row.shareBasisIdentity!=='shares_outstanding:source_stated'||row.sourceAnalyzer!==null
  ||row.authoritativeStatus!==null||row.authoritativeDecisionVersion!==null||row.authoritativeDecisionReason!==null
  ||row.authoritativeDecisionLineage!==null||row.sourceConceptLocalName!==null||row.sourceConceptNamespaceUri!==null
  ||row.acceptedAtSource!=='sec_filing_ledger'||!row.acceptedAt||!row.filingLedgerRawSourceId
  ||row.canonicalSecurityClassStatus!=='mapped'||row.canonicalSecurityClassKind!=='common_stock'
  ||row.canonicalSecurityClassId!==`sc:v1:${row.issuerCik}:common_stock:single`
  ||!p||p.version!==OS_SNAPSHOT_PUBLICATION_VERSION||!uuid(p.runId)||!uuid(p.rawId)
  ||!hash(p.rawHash)||!hash(p.outputHash)||!hash(p.sourceFingerprint)||!hash(p.schemaHash)
  ||!/^\d+$/.test(String(p.universeId))||!hash(p.universeHash)||!hash(p.ledgerHash)
  ||(p.decisionId!==null&&!uuid(p.decisionId))||!Number.isInteger(p.recordIndex)||p.recordIndex<0
  ||p.record?.scope!=='class'||p.record.quantity!==row.sharesOutstanding||p.record.as_of_date!==row.asOf
  ||p.record.share_class!==identity?.title||row.sourceArtifactId!==p.rawId
  ||!row.sourceEvidence||row.sourceEvidence.length>600||row.sourceProvenance.approval!==undefined
  ||row.shareBasisMetadata.measurement!=='shares_outstanding'
  ||(row.shareBasisMetadata.unit as Record<string,unknown>)?.kind!=='shares')throw Error('invalid verified O/S Snapshot history lineage');
}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
