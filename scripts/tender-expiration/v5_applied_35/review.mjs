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
  result.pass=false;
  result.errors.push("current-value-mismatch");
}
if (fact?.previous !== review.claims.previous.value) {
  result.pass=false;
  result.errors.push("previous-value-mismatch");
}
fs.writeFileSync(path.join(here,"semantic-review.json"),JSON.stringify({
  ...result,
  currentValue:fact?.current??null,
  previousValue:fact?.previous??null,
  unresolved:output.unresolved,
  failureClass:result.pass?null:"MODEL_ERROR",
},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(result,null,2));
if(!result.pass) process.exitCode=1;
