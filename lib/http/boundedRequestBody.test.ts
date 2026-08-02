import assert from "node:assert/strict";
import test from "node:test";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "./boundedRequestBody.ts";

test("rejects a declared oversized body before reading it", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("small"));
      controller.close();
    },
  });
  const request = streamRequest(body, { "content-length": "11" });

  await assert.rejects(
    readBoundedRequestText(request, 10),
    RequestBodyTooLargeError,
  );
});

test("stops an undeclared streamed body as soon as it crosses the cap", async () => {
  let canceled = false;
  const chunks = ["12345", "67890", "overflow"];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(new TextEncoder().encode(next));
      else controller.close();
    },
    cancel() {
      canceled = true;
    },
  });

  await assert.rejects(
    readBoundedRequestText(streamRequest(body), 10),
    RequestBodyTooLargeError,
  );
  assert.equal(canceled, true);
});

test("returns exact raw text at the byte limit, including split UTF-8", async () => {
  const bytes = new TextEncoder().encode("A😀B");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 3));
      controller.enqueue(bytes.slice(3));
      controller.close();
    },
  });

  assert.equal(
    await readBoundedRequestText(streamRequest(body), bytes.byteLength),
    "A😀B",
  );
});

test("invalid JSON remains available to route-specific parsing semantics", async () => {
  const request = new Request("https://radar.example/webhook", {
    method: "POST",
    body: "{not-json",
  });
  const raw = await readBoundedRequestText(request, 128);
  assert.equal(raw, "{not-json");
  assert.throws(() => JSON.parse(raw));
});

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers?: HeadersInit,
) {
  return new Request("https://radar.example/webhook", {
    body,
    headers,
    method: "POST",
    // Node's fetch implementation requires this for streamed request bodies.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
