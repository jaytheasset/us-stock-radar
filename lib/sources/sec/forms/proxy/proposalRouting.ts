import {
  buildProxyFinalStructuredInput,
  runProxyFinalStructuredGemini,
  type ProxyCapitalFacts,
  type ProxyFinalStructuredConflict,
  type ProxyFinalStructuredFact,
  type ProxyProposalCategory,
} from "./finalStructured.ts";
import {
  PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS,
  runProxyProposalDiscoveryGemini,
  type ProxyAnalysisHandoffResult,
  type ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";

export const PROXY_PROPOSAL_ROUTING_MODELS = {
  call1: "gemini-2.5-flash-lite",
  call2: "gemini-3.5-flash",
} as const;

export const PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS = {
  call1: PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS,
  call2: 16_384,
} as const;

export const PROXY_PROPOSAL_ROUTING_MAX_LLM_CALLS = 2 as const;

export type ProxyProposalRoutingFinalProposal = {
  proposal_id: string;
  title: string;
  claims: ProxyAnalysisHandoffResult["candidates"][number]["claims"];
  evidence: string[];
} & ({
  category: "capital_structure";
  capital_facts: ProxyCapitalFacts;
} | {
  category: Exclude<ProxyProposalCategory, "capital_structure">;
  facts: ProxyFinalStructuredFact[];
  source_conflicts: ProxyFinalStructuredConflict[];
});

type Call1Run = Awaited<ReturnType<typeof runProxyProposalDiscoveryGemini>>;
type Call2Run = Awaited<ReturnType<typeof runProxyFinalStructuredGemini>>;

export type ProxyProposalRoutingResult = {
  ok: boolean;
  error: { stage: "call1" | "call2"; message: string } | null;
  llmCallCount: number;
  call1: { model: typeof PROXY_PROPOSAL_ROUTING_MODELS.call1; run: Call1Run };
  call2: {
    model: typeof PROXY_PROPOSAL_ROUTING_MODELS.call2;
    run: Call2Run;
  } | null;
  finalProposals: ProxyProposalRoutingFinalProposal[] | null;
};

export async function runProxyProposalRouting({
  apiKey,
  sourcePackage,
  formType,
  fetchImpl = fetch,
}: {
  apiKey: string;
  sourcePackage: ProxyProposalDiscoverySourcePackage;
  formType: string;
  fetchImpl?: typeof fetch;
}): Promise<ProxyProposalRoutingResult> {
  let llmCallCount = 0;
  const guardedFetch = (stage: "call1" | "call2"): typeof fetch => {
    let called = false;
    return async (input, init) => {
      if (called || llmCallCount >= PROXY_PROPOSAL_ROUTING_MAX_LLM_CALLS) {
        throw new Error(`Proxy proposal routing allows one request per stage; ${stage} cannot call again`);
      }
      called = true;
      llmCallCount += 1;
      return fetchImpl(input, init);
    };
  };

  const call1Run = await runProxyProposalDiscoveryGemini({
    apiKey,
    model: PROXY_PROPOSAL_ROUTING_MODELS.call1,
    sourcePackage,
    maxOutputTokens: PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.call1,
    fetchImpl: guardedFetch("call1"),
  });
  const call1 = {
    model: PROXY_PROPOSAL_ROUTING_MODELS.call1,
    run: call1Run,
  } as const;
  if (!call1Run.transportOk || !call1Run.validation.ok || !call1Run.validation.value) {
    return {
      ok: false,
      error: { stage: "call1", message: runFailureMessage(call1Run) },
      llmCallCount,
      call1,
      call2: null,
      finalProposals: null,
    };
  }

  let call2Input;
  try {
    // Project identity here; the Call 2 builder never receives the source package.
    const provenance = sourcePackage.provenance || {};
    const issuer = provenance.issuer_identity;
    const companyName = issuer && typeof issuer === "object" && !Array.isArray(issuer)
      ? (issuer as Record<string, unknown>).company_name : null;
    call2Input = buildProxyFinalStructuredInput({
      stage1: call1Run.validation.value,
      filing: {
        form_type: formType,
        accession_number: identityText(provenance.accession_number),
        filing_date: identityText(provenance.filing_date),
        company_name: identityText(companyName),
        source_url: identityText(provenance.source_url) || identityText(provenance.primary_document_url),
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        stage: "call2",
        message: error instanceof Error ? error.message : String(error),
      },
      llmCallCount,
      call1,
      call2: null,
      finalProposals: null,
    };
  }

  const call2Run = await runProxyFinalStructuredGemini({
    apiKey,
    model: PROXY_PROPOSAL_ROUTING_MODELS.call2,
    input: call2Input,
    maxOutputTokens: PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.call2,
    fetchImpl: guardedFetch("call2"),
  });
  const call2 = {
    model: PROXY_PROPOSAL_ROUTING_MODELS.call2,
    run: call2Run,
  } as const;
  if (!call2Run.transportOk || !call2Run.validation.ok || !call2Run.validation.value) {
    return {
      ok: false,
      error: { stage: "call2", message: runFailureMessage(call2Run) },
      llmCallCount,
      call1,
      call2,
      finalProposals: null,
    };
  }

  const finalProposals = call2Run.validation.value.items.flatMap<ProxyProposalRoutingFinalProposal>((item) => {
    if (!item.is_proposal || item.category === null) return [];
    const proposalIndex = Number(item.proposal_id.slice(1)) - 1;
    const proposal = call2Input.handoff.candidates[proposalIndex];
    if (!proposal) {
      throw new Error(`Validated Call 2 references missing Call 1 proposal ${item.proposal_id}`);
    }
    const identity = {
      proposal_id: item.proposal_id,
      title: proposal.title,
      claims: structuredClone(proposal.claims),
      evidence: [...new Set(proposal.claims.flatMap((claim) => claim.evidence))],
    };
    if (item.category === "capital_structure") {
      return [{ ...identity, category: item.category, capital_facts: structuredClone(item.capital_facts) }];
    }
    return [{
      ...identity,
      category: item.category,
      facts: structuredClone(item.facts),
      source_conflicts: structuredClone(item.source_conflicts),
    }];
  });

  return {
    ok: true,
    error: null,
    llmCallCount,
    call1,
    call2,
    finalProposals,
  };
}

function identityText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function runFailureMessage(run: {
  error?: string;
  validation: { errors: string[] };
}) {
  return run.error || run.validation.errors.join("; ") || "Proxy proposal call failed";
}
