import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCache } from "../.scaffold/citation-tests/service.js";
import { OpenAlexProvider } from "../.scaffold/citation-tests/providers.js";

import { CitationHTTP } from "../.scaffold/citation-tests/http.js";

test("migration drops retired automatic counts and failures but keeps OpenAlex and manual results", () => {
  const result = {
    count: 5,
    source: "openalex",
    paperID: "W1",
    url: "https://openalex.org/W1",
    matchedBy: "doi",
    updatedAt: 1,
  };
  const entry = {
    identity: "fingerprint",
    status: "ok",
    checkedAt: 1,
    retryAt: 100,
    result,
  };
  const legacyError = "semantic-scholar 请求限流，请稍后刷新";
  const entries = parseCache(
    JSON.stringify({
      version: 1,
      items: {
        openalex: entry,
        manual: {
          ...entry,
          result: { ...result, source: "manual", matchedBy: "manual" },
        },
        retired: {
          ...entry,
          result: { ...result, source: "semantic-scholar" },
        },
        retiredError: {
          ...entry,
          status: "error",
          result: undefined,
          error: legacyError,
        },
        retainedSuccess: { ...entry, status: "error", error: legacyError },
      },
    }),
  );
  assert.deepEqual(
    [...entries.keys()],
    ["openalex", "manual", "retainedSuccess"],
  );
  assert.equal(entries.get("retainedSuccess").result.count, 5);
  assert.equal(entries.get("retainedSuccess").status, "ok");
  assert.equal(entries.get("retainedSuccess").retryAt, 0);
  assert.equal(entries.get("retainedSuccess").error, undefined);
});

test("DOI and title misses end at OpenAlex, including installations with retired fallback settings", async () => {
  let now = 0;
  const calls = [];
  const http = new CitationHTTP(
    async (url, headers) => {
      calls.push({ url, headers });
      return calls.length === 1
        ? { status: 404, data: null }
        : { status: 200, data: { meta: { count: 0 }, results: [] } };
    },
    () => now,
    async (ms) => {
      now += ms;
    },
    () => true,
  );
  // Old preferences may remain on disk; they must have no effect.
  const provider = new OpenAlexProvider(http, () => ({
    openAlexKey: "",
    fallback: true,
    semanticKey: "retired-secret",
  }));
  assert.equal(
    (
      await provider.lookup({
        key: "1:ABC",
        doi: "10.1234/test",
        title: "A sufficiently long title",
        year: 2020,
      })
    ).status,
    "not-found",
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every((call) =>
      call.url.startsWith("https://api.openalex.org/works"),
    ),
  );
  assert.ok(
    calls.every(
      (call) => !Object.values(call.headers).includes("retired-secret"),
    ),
  );
});

test("new API credentials bypass old cooldown while unchanged credentials keep it", async () => {
  let now = 0;
  let calls = 0;
  const http = new CitationHTTP(
    async () => {
      calls++;
      return calls === 1
        ? { status: 429, data: null, retryAfter: "3600" }
        : { status: 200, data: {} };
    },
    () => now,
    async (ms) => {
      now += ms;
    },
    () => true,
  );
  await assert.rejects(
    http.get("openalex", "https://api.openalex.org/works", {}),
  );
  await assert.rejects(
    http.get("openalex", "https://api.openalex.org/works", {}),
  );
  assert.equal(calls, 1);
  await http.get("openalex", "https://api.openalex.org/works", {
    Authorization: "Bearer new-key",
  });
  assert.equal(calls, 2);
  assert.ok(now < 3600_000);
});
