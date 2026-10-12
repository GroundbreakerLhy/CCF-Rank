import { test } from "node:test";
import assert from "node:assert/strict";
import { CitationHTTP } from "../.scaffold/citation-tests/http.js";
import { OpenAlexProvider } from "../.scaffold/citation-tests/providers.js";

const identity = {
  key: "1:ABC123",
  doi: "10.1234/example",
  title: "Attention Is All You Need",
  year: 2017,
  author: "Vaswani",
};
function transport(responses) {
  let now = 0;
  const calls = [];
  const sleeps = [];
  const http = new CitationHTTP(
    async (url, headers) => {
      calls.push({ url, headers, time: now });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error("Unexpected request");
      return response;
    },
    () => now,
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => true,
  );
  return { http, calls, sleeps };
}
const oa = (extra = {}) => ({
  id: "https://openalex.org/W1",
  doi: `https://doi.org/${identity.doi}`,
  display_name: identity.title,
  publication_year: 2017,
  cited_by_count: 0,
  authorships: [{ author: { display_name: "Ashish Vaswani" } }],
  ...extra,
});
function openAlex(http) {
  return new OpenAlexProvider(http, () => ({
    openAlexKey: "oa-secret",
  }));
}

test("OpenAlex success returns zero and sends the key only in the header", async () => {
  const { http, calls } = transport([{ status: 200, data: oa() }]);
  const result = await openAlex(http).lookup(identity);
  assert.equal(result.result.count, 0);
  assert.equal(result.result.source, "openalex");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, "Bearer oa-secret");
  assert.ok(
    calls[0].url.includes(
      encodeURIComponent(`https://doi.org/${identity.doi}`),
    ),
  );
  assert.ok(!calls[0].url.includes("secret"));
});
test("DOI 404 falls back to exact corroborated title search", async () => {
  const { http, calls } = transport([
    { status: 404 },
    { status: 200, data: { meta: { count: 1 }, results: [oa()] } },
  ]);
  const result = await openAlex(http).lookup(identity);
  assert.equal(result.status, "ok");
  assert.ok(calls[1].url.includes("search.title=%22"));
  assert.ok(calls[1].time - calls[0].time >= 1100);
});
test("OpenAlex outage retries once and never contacts another provider", async () => {
  const { http, calls } = transport([{ status: 503 }, { status: 503 }]);
  await assert.rejects(openAlex(http).lookup(identity), /HTTP 503/);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.url.startsWith("https://api.openalex.org/")),
  );
});
test("authentication and invalid counts report errors without secrets or fallback", async () => {
  for (const response of [
    { status: 401 },
    { status: 200, data: oa({ cited_by_count: null }) },
  ]) {
    const { http, calls } = transport([response]);
    await assert.rejects(
      openAlex(http).lookup(identity),
      (e) => !e.message.includes("secret"),
    );
    assert.equal(calls.length, 1);
  }
});
test("ambiguous and truncated title searches never accept the first hit", async () => {
  for (const data of [
    {
      meta: { count: 2 },
      results: [oa(), oa({ id: "https://openalex.org/W2" })],
    },
    { meta: { count: 100 }, results: [oa()] },
  ]) {
    const { http } = transport([{ status: 200, data }]);
    assert.equal(
      (await openAlex(http).lookup({ ...identity, doi: undefined })).status,
      "ambiguous",
    );
  }
});
test("429 honors Retry-After; long cooldowns do not block the batch and suppress repeat requests", async () => {
  const short = transport([
    { status: 429, retryAfter: "5" },
    { status: 200, data: {} },
  ]);
  await short.http.get("oa", "https://example.org", {});
  assert.ok(short.calls[1].time >= 5000);
  const long = transport([{ status: 429, retryAfter: "3600" }]);
  await assert.rejects(long.http.get("oa", "https://example.org", {}));
  await assert.rejects(long.http.get("oa", "https://example.org", {}));
  assert.equal(long.calls.length, 1);
});
test("network retries are bounded, stop is respected and remote error text is sanitized", async () => {
  const { http, calls } = transport([
    new Error("secret URL"),
    new Error("secret URL"),
  ]);
  await assert.rejects(
    http.get("oa", "url", {}),
    (e) => !e.message.includes("secret"),
  );
  assert.equal(calls.length, 2);
  let fetched = false;
  const stopped = new CitationHTTP(
    async () => {
      fetched = true;
    },
    Date.now,
    async () => {},
    () => false,
  );
  await assert.rejects(stopped.get("oa", "url", {}));
  assert.equal(fetched, false);
});
