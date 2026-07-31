import assert from "node:assert/strict";
import test from "node:test";
import {
  readStoredFilingSourceContent,
  readStoredNewsSourceContent,
} from "./originalSourceContent.ts";

test("reads news HTML from raw, nested article, and seed metadata storage paths", () => {
  assert.equal(
    readStoredNewsSourceContent({ rawPayload: { full_text_html: "<article>raw</article>" } }).html,
    "<article>raw</article>",
  );
  assert.equal(
    readStoredNewsSourceContent({ nestedPayload: { article_html: "<article>nested</article>" } }).html,
    "<article>nested</article>",
  );
  assert.equal(
    readStoredNewsSourceContent({ metadata: { original_html: "<article>seed</article>" } }).html,
    "<article>seed</article>",
  );
  assert.equal(
    readStoredNewsSourceContent({ rawItem: { body_text: "Stored article text" } }).text,
    "Stored article text",
  );
});

test("reads SEC HTML and text from primary-document and seed metadata storage paths", () => {
  assert.equal(
    readStoredFilingSourceContent({ rawPayload: { primary_document_html: "<html>SEC</html>" } }).html,
    "<html>SEC</html>",
  );
  assert.equal(
    readStoredFilingSourceContent({ metadata: { filing_html: "<html>seed SEC</html>" } }).html,
    "<html>seed SEC</html>",
  );
  assert.equal(
    readStoredFilingSourceContent({ metadata: { filing_text: "Stored filing text" } }).text,
    "Stored filing text",
  );
});
