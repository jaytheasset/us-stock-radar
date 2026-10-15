import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as previewClient from "./previewClient.ts";
import * as applyClient from "./applyClient.ts";

type Element = { type: unknown; props: Record<string, unknown> };

// Run the actual component handlers with deterministic hook state and digest timing.
// No HTTP request, browser session, or database is created by this harness.
function componentHarness() {
  const state: unknown[] = [];
  let cursor = 0;
  let requests = 0;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
  };
  const exports: { DilutionRegistryPreview?: (props: { canApply: boolean }) => Element } = {};
  const js = ts.transpileModule(readFileSync("components/admin/DilutionRegistryPreview.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  vm.runInNewContext(js, {
    exports,
    fetch: async () => { requests += 1; throw new Error("No HTTP in concurrency regression"); },
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/lib/dilution-registry/previewClient") return previewClient;
      if (name === "@/lib/dilution-registry/applyClient") return applyClient;
      if (name === "./DilutionRegistryPreview.module.css") return { default: {} };
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });
  function render() { cursor = 0; return exports.DilutionRegistryPreview!({ canApply: true }); }
  function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
    if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as Element;
    return predicate(element) ? element : find(element.props.children, predicate);
  }
  function button(label: string) {
    const result = find(render(), (node) => node.type === "button" && node.props.children === label);
    assert.ok(result, `button ${label}`);
    return result;
  }
  return {
    type(source: string) {
      const input = find(render(), (node) => node.type === "textarea");
      assert.ok(input);
      (input.props.onChange as (event: unknown) => void)({ target: { value: source } });
    },
    click(label: string) { return (button(label).props.onClick as () => Promise<void>)(); },
    enabled: () => !button("Apply").props.disabled,
    requests: () => requests,
  };
}

function source(ticker: string) {
  const url = `https://www.sec.gov/Archives/edgar/data/1/000000000124000001/${ticker}.htm`;
  const ref = `sec-raw:v1:11111111-1111-4111-8111-111111111111:${createHash("sha256").update(url).digest("hex")}`;
  return JSON.stringify({
    issuer: { issuer_cik: "0000000001", ticker },
    instruments: [{ instrument_key: "one" }], snapshots: [], activities: [], totals: [],
    corporate_action_clause_bindings: [{
      instrument_key: "one", execution_id: `fse:v1:${"a".repeat(64)}`,
      canonical_security_class_id: "sc:v1:0000000001:common_stock:single",
      contract_accession: "0000000001-24-000001", contract_raw_item_id: "11111111-1111-4111-8111-111111111111",
      source_ref: ref, source_document_url: url,
      field_adjustments: [{ field: "remaining_units", operation: "multiply_by_split_ratio", evidence_identity: {
        version: "corporate_action_evidence_identity_v1", source_ref: ref,
        range_start: 0, range_end: 6, source_content_hash: "b".repeat(64), exact_source: true,
      } }],
    }],
  });
}

test("edits, overlapping Preview and stale Apply preparation cannot publish an old source", async (t) => {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const pending: Array<() => Promise<void>> = [];
  t.mock.method(crypto.subtle, "digest", (...args: Parameters<typeof digest>) => new Promise<ArrayBuffer>((resolve) => {
    pending.push(async () => resolve(await digest(...args)));
  }));
  const ui = componentHarness();
  ui.type(source("A"));
  const first = ui.click("Preview");
  ui.type(source("B"));
  const second = ui.click("Preview");
  await pending.shift()!(); await first;
  assert.equal(ui.enabled(), false, "old Preview cannot enable Apply while newer Preview is pending");
  await pending.shift()!(); await second;
  assert.equal(ui.enabled(), true);
  const apply = ui.click("Apply");
  ui.type(source("C"));
  await pending.shift()!(); await apply;
  assert.equal(ui.requests(), 0, "editing during async Apply validation must prevent sending the prior source");
  assert.equal(ui.enabled(), false);
  const old = ui.click("Preview");
  ui.type("{");
  await ui.click("Preview");
  await pending.shift()!(); await old;
  assert.equal(ui.enabled(), false, "late success cannot overwrite a newer invalid Preview");
  assert.equal(ui.requests(), 0);
});
