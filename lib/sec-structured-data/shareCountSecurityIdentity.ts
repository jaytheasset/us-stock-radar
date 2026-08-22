export const SHARE_COUNT_SECURITY_CLASS_ID_VERSION = "share-count-security-class-v1" as const;
export const SHARE_COUNT_SECURITY_CLASS_KIND = "common_stock" as const;

export type CanonicalSecurityClassIdentity = {
  status: "mapped" | "unavailable";
  canonicalSecurityClassId: string | null;
  canonicalSecurityClassKind: typeof SHARE_COUNT_SECURITY_CLASS_KIND | null;
  provenance: Record<string, unknown>;
};

export type AuthoritativeSecurityClassInput =
  | {
      issuerCik: string;
      basis: "SINGLE_COMMON_STOCK_CLASS";
      sourceCanonicalKey: string;
      sourceIdentity: unknown;
      sourceFactKey: string;
      sourceContextRef: string;
    }
  | {
      issuerCik: string;
      basis: "CLASS_SPECIFIC_COMMON_STOCK";
      sourceCanonicalKey: string;
      sourceIdentity: {
        axis: { namespaceUri: string | null; localName: string };
        member: { namespaceUri: string | null; localName: string };
      };
      sourceFactKey: string;
      sourceContextRef: string;
    };

export type CanonicalSecurityClassSupport = {
  observationId: string | null;
  canonicalSecurityClassId: string;
  canonicalSecurityClassKind: typeof SHARE_COUNT_SECURITY_CLASS_KIND;
  securityClassBasis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK";
  sourceFactKey: string;
  accessionNumber: string;
};

export function deriveAuthoritativeCanonicalSecurityClassIdentity(
  input: AuthoritativeSecurityClassInput,
): CanonicalSecurityClassIdentity {
  const baseProvenance = {
    version: SHARE_COUNT_SECURITY_CLASS_ID_VERSION,
    derivation: "authoritative_filing_xbrl_context",
    issuerCik: input.issuerCik,
    securityClassBasis: input.basis,
    sourceCanonicalKey: input.sourceCanonicalKey,
    sourceIdentity: structuredClone(input.sourceIdentity),
    sourceFactKey: input.sourceFactKey,
    sourceContextRef: input.sourceContextRef,
  };

  if (input.basis === "SINGLE_COMMON_STOCK_CLASS") {
    return {
      status: "mapped",
      canonicalSecurityClassId: `sc:v1:${input.issuerCik}:common_stock:single`,
      canonicalSecurityClassKind: SHARE_COUNT_SECURITY_CLASS_KIND,
      provenance: {
        ...baseProvenance,
        rule: "eligible_single_common_stock_filing_context",
      },
    };
  }

  const { axis, member } = input.sourceIdentity;
  if (!resolvedQName(axis) || !resolvedQName(member)
    || axis.localName !== "StatementClassOfStockAxis"
    || !isUsGaapNamespace(axis.namespaceUri)
    || !isUsGaapNamespace(member.namespaceUri)) {
    return unavailable(baseProvenance, "UNSUPPORTED_CLASS_MEMBER_IDENTITY");
  }

  const memberIdentity = `${axis.namespaceUri}#${axis.localName}|${member.namespaceUri}#${member.localName}`;
  return {
    status: "mapped",
    canonicalSecurityClassId: `sc:v1:${input.issuerCik}:common_stock:us-gaap:${member.localName}`,
    canonicalSecurityClassKind: SHARE_COUNT_SECURITY_CLASS_KIND,
    provenance: {
      ...baseProvenance,
      rule: "eligible_class_specific_common_stock_filing_context",
      memberIdentity,
    },
  };
}

export function deriveLevel2CanonicalSecurityClassIdentity(input: {
  issuerCik: string;
  securityClassKind: typeof SHARE_COUNT_SECURITY_CLASS_KIND;
  sourceTitle: string;
  supports: readonly CanonicalSecurityClassSupport[];
}): CanonicalSecurityClassIdentity {
  const support = input.supports.filter((row) =>
    row.canonicalSecurityClassKind === SHARE_COUNT_SECURITY_CLASS_KIND);
  const distinctIds = [...new Set(support.map((row) => row.canonicalSecurityClassId))];
  const allSingleClass = support.length > 0
    && support.every((row) => row.securityClassBasis === "SINGLE_COMMON_STOCK_CLASS");
  const provenance = {
    version: SHARE_COUNT_SECURITY_CLASS_ID_VERSION,
    derivation: "level2_explicit_common_stock_plus_authoritative_single_class_evidence",
    issuerCik: input.issuerCik,
    sourceDeclaredClassKind: input.securityClassKind,
    sourceTitle: input.sourceTitle,
    supportingObservations: support.map((row) => ({
      observationId: row.observationId,
      canonicalSecurityClassId: row.canonicalSecurityClassId,
      securityClassBasis: row.securityClassBasis,
      sourceFactKey: row.sourceFactKey,
      accessionNumber: row.accessionNumber,
    })),
  };

  if (!allSingleClass || distinctIds.length !== 1) {
    return unavailable(
      provenance,
      support.length === 0
        ? "AUTHORITATIVE_SINGLE_CLASS_EVIDENCE_UNAVAILABLE"
        : "MULTI_CLASS_OR_CONFLICTING_CLASS_EVIDENCE",
    );
  }

  return {
    status: "mapped",
    canonicalSecurityClassId: distinctIds[0]!,
    canonicalSecurityClassKind: SHARE_COUNT_SECURITY_CLASS_KIND,
    provenance: { ...provenance, rule: "exactly_one_authoritative_common_stock_class" },
  };
}

export function canonicalSecurityClassSupportsFromDatabaseRows(
  rows: readonly Record<string, unknown>[],
  issuerCik: string,
): CanonicalSecurityClassSupport[] {
  return rows.flatMap((row) => {
    if (String(row.issuer_cik ?? "") !== issuerCik
      || row.source_type !== "sec_authoritative_os"
      || row.canonical_security_class_status !== "mapped"
      || row.canonical_security_class_kind !== SHARE_COUNT_SECURITY_CLASS_KIND
      || (row.security_class_basis !== "SINGLE_COMMON_STOCK_CLASS"
        && row.security_class_basis !== "CLASS_SPECIFIC_COMMON_STOCK")) return [];
    const canonicalSecurityClassId = String(row.canonical_security_class_id ?? "");
    const sourceFactKey = String(row.source_fact_key ?? "");
    const accessionNumber = String(row.accession_number ?? "");
    if (!canonicalSecurityClassId.startsWith(`sc:v1:${issuerCik}:common_stock:`)
      || !/^[0-9a-f]{64}$/.test(sourceFactKey)
      || !/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(accessionNumber)) return [];
    return [{
      observationId: row.id === null || row.id === undefined ? null : String(row.id),
      canonicalSecurityClassId,
      canonicalSecurityClassKind: SHARE_COUNT_SECURITY_CLASS_KIND,
      securityClassBasis: row.security_class_basis,
      sourceFactKey,
      accessionNumber,
    }];
  });
}

function unavailable(
  provenance: Record<string, unknown>,
  reason: string,
): CanonicalSecurityClassIdentity {
  return {
    status: "unavailable",
    canonicalSecurityClassId: null,
    canonicalSecurityClassKind: null,
    provenance: { ...provenance, reason },
  };
}

function resolvedQName(value: { namespaceUri: string | null; localName: string }) {
  return Boolean(value.namespaceUri?.trim() && value.localName.trim());
}

function isUsGaapNamespace(value: string | null) {
  return value !== null && /^http:\/\/fasb\.org\/us-gaap\/[0-9]{4}$/.test(value);
}
