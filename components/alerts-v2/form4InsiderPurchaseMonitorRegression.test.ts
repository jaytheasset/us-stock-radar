import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("./Form4InsiderPurchaseMonitor.tsx", import.meta.url),
  "utf8",
);
const builderSource = readFileSync(
  new URL("./ListingMonitorDraftBuilder.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./Form4InsiderPurchaseMonitor.module.css", import.meta.url),
  "utf8",
);
const consumerSource = readFileSync(
  new URL("../../lib/monitor/listingMonitorAlertConsumer.ts", import.meta.url),
  "utf8",
);

test("monitor and alerts surfaces expose one typed internal Form 4 purchase workflow", () => {
  assert.match(builderSource, /<Form4InsiderPurchaseBuilder authRequired=/);
  assert.match(builderSource, /<Form4PurchaseMonitorSummary/);
  assert.match(builderSource, /<Form4PurchaseAlertDetails[\s\S]*alert=\{alert\}/);
  assert.match(componentSource, /fetch\("\/api\/monitors\/listing"/);
  assert.match(componentSource, /method: "POST"/);
  assert.match(componentSource, /body: JSON\.stringify\(\{ form4Purchase: settings \}\)/);
  assert.match(componentSource, /method: "PATCH"/);
  assert.match(componentSource, /body: JSON\.stringify\(\{ form4Purchase: next \}\)/);
  assert.match(componentSource, />Internal alert</);
  assert.match(componentSource, /Form 4 purchase alert/);
  assert.match(consumerSource, /`\$\{input\.matchEvidence\.ticker\} Form 4 purchase`/);
  assert.doesNotMatch(consumerSource, /Form 4 insider purchase reported/);
  assert.doesNotMatch(componentSource, /임원·이사 매수 알림|매수 신고/);
  assert.doesNotMatch(componentSource, /telegram|email|sms|push/i);
});

test("alert evidence renders every matching row and all required literal fields", () => {
  assert.match(componentSource, /evidence\.matches\.map\(\(match\) =>/);
  assert.match(componentSource, /buildForm4PurchaseAlertCopy\(evidence, settings\)/);
  assert.match(componentSource, /\{copy\.title\}/);
  assert.match(componentSource, /\{match\.ownerName\}/);
  assert.match(componentSource, /formatOwnerRole\(match\.ownerRoles, match\.officerTitle\)/);
  assert.match(componentSource, />Shares<\/dt><dd>\{formatShares\(match\.shares\)\}/);
  assert.match(componentSource, />Price per share<\/dt><dd>\{match\.pricePerShare === null/);
  assert.match(componentSource, /match\.ownershipRelation === "direct" \? "Direct" : "Indirect"/);
  assert.match(componentSource, />Transaction date<\/dt><dd>\{formatTransactionDate\(match\.transactionDate\)\}/);
  assert.match(componentSource, /Filed \{formatTimestamp\(evidence\.filedAt\)\}/);
  assert.match(componentSource, /SEC original/);
  assert.match(componentSource, />Ownership source details<\/summary>/);
  assert.match(componentSource, /\{copy\.summary\}/);
  assert.doesNotMatch(componentSource, /\{evidence\.reason\}/);
});

test("monitor form supports watchlist or direct ticker, role, optional row threshold, and mobile layout", () => {
  assert.match(componentSource, /<option value="watchlist">My watchlist<\/option>/);
  assert.match(componentSource, /<option value="ticker">Choose a ticker<\/option>/);
  assert.match(componentSource, /<option value="officer_or_director">Officer or director<\/option>/);
  assert.match(componentSource, /<option value="officer">Officer<\/option>/);
  assert.match(componentSource, /<option value="director">Director<\/option>/);
  assert.match(componentSource, /Minimum shares <span>Optional<\/span>/);
  assert.match(componentSource, /Gifts, option exercises,[\s\S]*conversions, sales, and uncertain owner relationships do not trigger/);
  assert.match(styles, /@media \(max-width: 700px\) \{[\s\S]*\.fields,[\s\S]*\.matchRows dl \{[\s\S]*grid-template-columns: 1fr;/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});
