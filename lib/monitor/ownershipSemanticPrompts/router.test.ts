import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildOwnershipStructuredContextResponseSchema } from "../ownershipStructuredContextAnalyzer.ts";
import type { OwnershipContextReferenceInventory } from "../ownershipStructuredContext.ts";
import { routeOwnershipSemanticPrompt } from "./router.ts";

type CanonicalForm = "form4" | "form144";
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../../sources/sec/forms/ownership/fixtures");
const cases = [
  { fixture: "source-agig-form4-purchase.json", id: "form4", canonicalForm: "form4", amendment: false },
  { fixture: "form4a-correction-row-safety.json", id: "form4A", canonicalForm: "form4", amendment: true },
  { fixture: "source-amcor-form144-no-prior-sales.json", id: "form144", canonicalForm: "form144", amendment: false },
  { fixture: "source-globe-form144a-no-remarks.json", id: "form144A", canonicalForm: "form144", amendment: true },
] as const;

test("retained offline fixtures select four independent semantic routes", () => {
  for (const item of cases) {
    const fixture = JSON.parse(readFileSync(join(fixtureRoot, item.fixture), "utf8")) as { formType: string };
    const routed = routeOwnershipSemanticPrompt({
      rawForm: fixture.formType,
      canonicalForm: item.canonicalForm,
      isAmendment: item.amendment,
    });
    assert.equal(routed.ok, true, item.fixture);
    if (!routed.ok) continue;
    assert.equal(routed.route.id, item.id);
    assert.match(routed.route.systemRules.join(" "), /Subject, then Scope, then Evidence, then Relation/);
    assert.equal(routed.route.outputFactFields.includes("economic_direction" as never), false);
    assert.equal(routed.route.outputFactFields.includes("amendment_effect"), item.amendment);
  }
});

test("each route carries its own form semantics and response fields", () => {
  const routed = Object.fromEntries(cases.map((item) => {
    const rawForm = item.id === "form4" ? "4" : item.id === "form4A" ? "4/A" : item.id === "form144" ? "144" : "144/A";
    const result = routeOwnershipSemanticPrompt({ rawForm, canonicalForm: item.canonicalForm, isAmendment: item.amendment });
    assert.equal(result.ok, true);
    return [item.id, result.ok ? result.route : null];
  }));
  const { form4, form4A, form144, form144A } = routed;
  if (!form4 || !form4A || !form144 || !form144A) assert.fail("all retained routes must resolve");
  assert.match(form4.systemRules.join(" "), /Table I non-derivative securities and Table II derivative securities/);
  assert.match(form4A.systemRules.join(" "), /Do not assume full replacement/);
  assert.match(form144.systemRules.join(" "), /proposed-sale notice, not proof that a sale was executed/);
  assert.match(form144A.systemRules.join(" "), /Never describe a Form 144\/A amendment as an executed sale/);
  assert.equal(form4.outputFactFields.includes("derivative_underlying_relation"), true);
  assert.equal(form144.outputFactFields.includes("derivative_underlying_relation"), false);
  assert.equal(form4.outputFactFields.includes("owner_relations"), true);
  assert.equal(form144.outputFactFields.includes("owner_relations"), false);
  assert.equal(form144.outputFactFields.includes("rule_10b5_1"), false);

  for (const item of cases) {
    const schema = buildOwnershipStructuredContextResponseSchema(inventory(item.canonicalForm, item.amendment));
    const properties = (((schema.properties as Record<string, unknown>).rows as Record<string, unknown>).items as Record<string, unknown>).properties as Record<string, unknown>;
    assert.equal(Object.hasOwn(properties, "economic_direction"), false, item.id);
    assert.equal(Object.hasOwn(properties, "amendment_effect"), item.amendment, item.id);
    assert.equal(Object.hasOwn(properties, "derivative_underlying_relation"), item.canonicalForm === "form4", item.id);
    assert.equal(Object.hasOwn(properties, "owner_relations"), item.canonicalForm === "form4", item.id);
    assert.equal(Object.hasOwn(properties, "rule_10b5_1"), item.canonicalForm === "form4", item.id);
  }
});

test("unknown, family-mismatched, and amendment-mismatched raw forms fail closed", () => {
  assert.deepEqual(
    routeOwnershipSemanticPrompt({ rawForm: "5", canonicalForm: "form4", isAmendment: false }),
    { ok: false, reason: "ownership_semantic_prompt_form_unknown" },
  );
  assert.deepEqual(
    routeOwnershipSemanticPrompt({ rawForm: "144", canonicalForm: "form4", isAmendment: false }),
    { ok: false, reason: "ownership_semantic_prompt_form_family_mismatch" },
  );
  assert.deepEqual(
    routeOwnershipSemanticPrompt({ rawForm: "4/A", canonicalForm: "form4", isAmendment: false }),
    { ok: false, reason: "ownership_semantic_prompt_amendment_mismatch" },
  );
});

function inventory(form: CanonicalForm, isAmendment: boolean): OwnershipContextReferenceInventory {
  return {
    version: "ownership_context_v1",
    eventRef: "event:22222222-2222-4222-8222-222222222222",
    form,
    isAmendment,
    sourceFingerprint: `ownership-context-v1:${"a".repeat(64)}`,
    filingRule10b51: form === "form4" ? false : null,
    sourceReportingOwnerNames: form === "form4" ? ["Owner"] : [],
    footnotes: [],
    rows: [{
      rowRef: `row:${form}:0`,
      ownerNames: ["Owner"],
      ownerRefs: [`owner:${form}:0:0`],
      securityTitle: "Common",
      securityRef: `security:${form}:0`,
      underlyingSecurityRefs: form === "form4" ? ["security:form4:underlying:0"] : [],
      evidenceRefs: [`evidence:${form}:0:0`],
      linkedFootnoteRefs: [],
      direct: {
        transactionKind: form === "form4" ? "derivative" : null,
        acquiredDisposedCode: null,
        directOrIndirectOwnership: null,
        is10b51: null,
        allowedUnderlyingSecurityRefs: form === "form4" ? ["security:form4:underlying:0"] : [],
      },
    }],
  };
}
