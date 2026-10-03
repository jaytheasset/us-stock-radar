import {
  buildProxyProposalClassificationInput,
  runProxyProposalClassificationGemini,
  type ProxyProposalCategory,
} from "./proposalClassification.ts";
import {
  runProxyProposalDiscoveryGemini,
  type ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";
import {
  buildProxyProceduralBallotInputs,
  runProxyProceduralBallotGemini,
} from "./proceduralBallotVerification.ts";

export const PROXY_PROPOSAL_ROUTING_MODELS = {
  stage1: "gemini-2.5-flash-lite",
  stage2: "gemini-2.5-flash-lite",
  stage2b: "gemini-3.5-flash",
} as const;

export const PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS = {
  stage1: 4_096,
  stage2: 2_048,
  stage2b: 1_024,
} as const;

export type ProxyProposalRoutingFinalProposal = {
  proposal_id: string;
  title: string;
  action_summary: string;
  evidence: string[];
  category: ProxyProposalCategory;
};

type Stage1Run = Awaited<ReturnType<typeof runProxyProposalDiscoveryGemini>>;
type Stage2Run = Awaited<ReturnType<typeof runProxyProposalClassificationGemini>>;
type Stage2BRun = Awaited<ReturnType<typeof runProxyProceduralBallotGemini>>;

export type ProxyProposalRoutingResult = {
  ok: boolean;
  error: { stage: "stage1" | "stage2" | "stage2b"; message: string } | null;
  stage1: { model: typeof PROXY_PROPOSAL_ROUTING_MODELS.stage1; run: Stage1Run };
  stage2: {
    model: typeof PROXY_PROPOSAL_ROUTING_MODELS.stage2;
    run: Stage2Run;
  } | null;
  stage2b: Array<{
    proposal_id: string;
    model: typeof PROXY_PROPOSAL_ROUTING_MODELS.stage2b;
    run: Stage2BRun;
  }>;
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
  const stage1Run = await runProxyProposalDiscoveryGemini({
    apiKey,
    model: PROXY_PROPOSAL_ROUTING_MODELS.stage1,
    sourcePackage,
    maxOutputTokens: PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage1,
    fetchImpl,
  });
  const stage1 = {
    model: PROXY_PROPOSAL_ROUTING_MODELS.stage1,
    run: stage1Run,
  } as const;
  if (!stage1Run.transportOk || !stage1Run.validation.ok || !stage1Run.validation.value) {
    return {
      ok: false,
      error: { stage: "stage1", message: runFailureMessage(stage1Run) },
      stage1,
      stage2: null,
      stage2b: [],
      finalProposals: null,
    };
  }

  const stage2Input = buildProxyProposalClassificationInput(stage1Run.validation.value);
  const stage2Run = await runProxyProposalClassificationGemini({
    apiKey,
    model: PROXY_PROPOSAL_ROUTING_MODELS.stage2,
    input: stage2Input,
    maxOutputTokens: PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage2,
    fetchImpl,
  });
  const stage2 = {
    model: PROXY_PROPOSAL_ROUTING_MODELS.stage2,
    run: stage2Run,
  } as const;
  if (!stage2Run.transportOk || !stage2Run.validation.ok || !stage2Run.validation.value) {
    return {
      ok: false,
      error: { stage: "stage2", message: runFailureMessage(stage2Run) },
      stage1,
      stage2,
      stage2b: [],
      finalProposals: null,
    };
  }

  const stage2bInputs = buildProxyProceduralBallotInputs({
    stage1: stage1Run.validation.value,
    stage2: stage2Run.validation.value,
    sourcePackage,
    formType,
  });
  const stage2b: ProxyProposalRoutingResult["stage2b"] = [];
  for (const input of stage2bInputs) {
    const run = await runProxyProceduralBallotGemini({
      apiKey,
      model: PROXY_PROPOSAL_ROUTING_MODELS.stage2b,
      input,
      maxOutputTokens: PROXY_PROPOSAL_ROUTING_MAX_OUTPUT_TOKENS.stage2b,
      fetchImpl,
    });
    stage2b.push({
      proposal_id: input.proposal_id,
      model: PROXY_PROPOSAL_ROUTING_MODELS.stage2b,
      run,
    });
  }

  const failedStage2B = stage2b.find(({ run }) => (
    !run.transportOk || !run.validation.ok || !run.validation.value
  ));
  if (failedStage2B) {
    return {
      ok: false,
      error: {
        stage: "stage2b",
        message: `${failedStage2B.proposal_id}: ${runFailureMessage(failedStage2B.run)}`,
      },
      stage1,
      stage2,
      stage2b,
      finalProposals: null,
    };
  }

  const proceduralDecisions = new Map(
    stage2b.map(({ proposal_id, run }) => [
      proposal_id,
      run.validation.value?.is_ballot_proposal === true,
    ]),
  );
  const finalProposals = stage2Run.validation.value.items.flatMap((classification) => {
    if (!classification.is_proposal || classification.category === null) return [];
    if (classification.category === "procedural"
      && proceduralDecisions.get(classification.proposal_id) !== true) {
      return [];
    }
    const proposalIndex = Number(classification.proposal_id.slice(1)) - 1;
    const proposal = stage1Run.validation.value?.proposals[proposalIndex];
    if (!proposal) {
      throw new Error(`Validated Stage 2 references missing Stage 1 proposal ${classification.proposal_id}`);
    }
    return [{
      proposal_id: classification.proposal_id,
      title: proposal.title,
      action_summary: proposal.action_summary,
      evidence: [...proposal.evidence],
      category: classification.category,
    }];
  });

  return {
    ok: true,
    error: null,
    stage1,
    stage2,
    stage2b,
    finalProposals,
  };
}

function runFailureMessage(run: {
  error?: string;
  validation: { errors: string[] };
}) {
  return run.error || run.validation.errors.join("; ") || "Proxy proposal stage failed";
}
