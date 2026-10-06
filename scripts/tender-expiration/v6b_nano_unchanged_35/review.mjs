import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateEvidenceSupport } from "../v3_1/evaluate.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const raw=fs.readFileSync(path.join(here,"run","structured.txt"),"utf8");
const review=JSON.parse(fs.readFileSync(path.join(here,"evidence-support-review.json"),"utf8"));
const result=evaluateEvidenceSupport(raw,review);
const output=JSON.parse(raw);
const fact=output.facts?.[0];
if (fact?.current !== review.claims.current.value) {
  result.pass=false; result.errors.push("current-value-mismatch");
}
if (Object.hasOwn(fact??{}, "previous")) {
  result.pass=false; result.errors.push("unexpected-previous");
}
if (fact?.current === "2023-07-28") {
  result.pass=false; result.errors.push("distractor-date-selected");
}
if (Array.isArray(output.unresolved) && output.unresolved.length !== 0) {
  result.pass=false; result.errors.push("unexpected-unresolved");
}
const finalResult={...result,currentValue:fact?.current??null,previousAbsent:!Object.hasOwn(fact??{},"previous"),unresolved:output.unresolved,failureClass:result.pass?null:"MODEL_ERROR"};
process.stdout.write(JSON.stringify(finalResult,null,2)+"\n");
if(!result.pass) process.exitCode=1;
