import assert from "node:assert/strict";
import test from "node:test";
import { handleListingConditionCompilerPost } from "../../app/api/monitors/listing/compile/handler.ts";
import { handleSec425PreviewPost } from "../../app/api/monitors/listing/compile/425-preview/handler.ts";
import { handleListingMonitorConfirmationPost } from "../../app/api/monitors/listing/confirm/handler.ts";

test("reviewed delegated handlers reject cross-origin and unauthenticated calls before work", async () => {
  for (const handler of [handleListingConditionCompilerPost, handleSec425PreviewPost, handleListingMonitorConfirmationPost]) {
    for (const crossOrigin of [true, false]) {
      let identityReads = 0;
      const request = new Request("http://localhost/api/monitors/listing/compile", {
        method: "POST", headers: { Origin: crossOrigin ? "https://untrusted.example" : "http://localhost" },
      });
      request.json = async () => assert.fail("rejected request body must not be read");
      const response = await handler(request, {
        resolveUserId: async () => { identityReads += 1; return null; },
        compile: async () => assert.fail("rejected request must not compile or call a provider"),
      });
      assert.equal(response.status, crossOrigin ? 403 : 401);
      assert.equal(identityReads, crossOrigin ? 0 : 1);
    }
  }
});
