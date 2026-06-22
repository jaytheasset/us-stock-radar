import { describe, expect, it } from "./testExpect";
import sc13Adapter, {
  sc13AdapterKey,
  sc13AnalysisMode,
  sc13ParserGroup,
  sc13SupportedForms,
} from "./adapter";
import { buildSc13AnalysisPrompt } from "./analysisPrompt";
import { secSc13FetchPlan } from "./fetchPlan";
import { parseSc13Filing } from "./parser";

describe("SC 13 adapter contract", () => {
  it("exports the live integration entrypoints for this form family", () => {
    expect(sc13AdapterKey).toBe("sc13");
    expect(sc13ParserGroup).toBe("sc13");
    expect(sc13AnalysisMode).toBe("analysis_only");
    expect(sc13SupportedForms).toEqual(["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"]);

    expect(sc13Adapter.parser).toBe(parseSc13Filing);
    expect(sc13Adapter.parse).toBe(parseSc13Filing);
    expect("buildRouterPrompt" in sc13Adapter).toBe(false);
    expect("getDeterministicRoute" in sc13Adapter).toBe(false);
    expect("buildDeterministicResult" in sc13Adapter).toBe(false);
    expect("buildDisplayPayload" in sc13Adapter).toBe(false);
    expect(sc13Adapter.buildAnalysisPrompt).toBe(buildSc13AnalysisPrompt);
    expect(sc13Adapter.fetchPlan).toBe(secSc13FetchPlan);
    expect(sc13Adapter.displayVersions.ownership).toBe("sc13-ownership-v1");
  });
});
