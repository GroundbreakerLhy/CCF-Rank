import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY,
  matchCandidates,
  normalizeOpenAlexID,
} from "../.scaffold/citation-tests/core.js";
import { OpenAlexProvider } from "../.scaffold/citation-tests/providers.js";

import {
  CitationService,
  parseCache,
} from "../.scaffold/citation-tests/service.js";
import { CitationHTTP } from "../.scaffold/citation-tests/http.js";

const identity = {
  key: "1:PC6ML68F",
  title: "Open world image aesthetic assessment",
  year: 2026,
  author: "Liao",
};
const candidate = {
  id: "https://openalex.org/W7220942938",
  doi: "10.1109/cvprf71909.2026.00937",
  title: "Open World Image Aesthetic Assessment",
  year: 2026,
  authors: [],
  count: 0,
  url: "https://openalex.org/W7220942938",
};
const work = {
  id: candidate.id,
  doi: `https://doi.org/${candidate.doi}`,
  display_name: candidate.title,
  publication_year: 2026,
  cited_by_count: 0,
  authorships: [],
};
function provider(responses) {
  let now = 0;
  const urls = [];
  const http = new CitationHTTP(
    async (url) => {
      urls.push(url);
      if (!responses.length) throw new Error("Unexpected request");
      return { status: 200, data: responses.shift() };
    },
    () => now,
    async (ms) => {
      now += ms;
    },
    () => true,
  );
  return {
    provider: new OpenAlexProvider(http, () => ({ openAlexKey: "" })),
    urls,
  };
}
function service(provider) {
  let now = 1000;
  const value = new CitationService({
    provider,
    now: () => now,
    ttl: () => 7 * DAY,
    changed: () => {},
  });
  return {
    value,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("reported CVPR Findings paper auto-matches despite missing authors and shows zero", async () => {
  const result = matchCandidates(identity, [candidate]);
  assert.equal(result.status, "ok");
  assert.equal(result.candidate.count, 0);
  assert.match(result.detail, /作者信息缺失/);
  const { provider: p, urls } = provider([
    { meta: { count: 1 }, results: [work] },
  ]);
  assert.equal((await p.lookup(identity)).result.count, 0);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("search.title=%22"));
});
test("missing data is different from conflicting data; title alone needs confirmation", () => {
  assert.equal(
    matchCandidates(identity, [{ ...candidate, authors: ["Another Author"] }])
      .status,
    "ambiguous",
  );
  assert.equal(
    matchCandidates(identity, [{ ...candidate, year: 2025 }]).status,
    "ambiguous",
  );
  assert.equal(
    matchCandidates({ ...identity, year: undefined }, [candidate]).status,
    "ambiguous",
  );
  const authorCorroboration = matchCandidates(
    { ...identity, year: undefined },
    [{ ...candidate, authors: ["Mingxiang Liao"] }],
  );
  assert.equal(authorCorroboration.status, "ok");
});
test("near titles remain candidates but never become automatic matches", () => {
  const result = matchCandidates(identity, [
    { ...candidate, title: "Open World Image Aesthetic Assessment Framework" },
  ]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidate, undefined);
  assert.match(result.candidates[0].reasons.join(" "), /标题存在差异/);
});
test("irrelevant fulltext hits do not become candidates", () => {
  const result = matchCandidates(identity, [
    candidate,
    {
      ...candidate,
      id: "https://openalex.org/W2",
      title:
        "AesCanvas: A Large-Scale Dataset and Benchmark for Aesthetic Critique and Contextual Suitability",
    },
  ]);
  assert.equal(result.status, "ok");
  assert.equal(result.candidates.length, 1);
});
test("search widens once when phrase search misses, and never selects a near title automatically", async () => {
  const { provider: p, urls } = provider([
    { meta: { count: 0 }, results: [] },
    {
      meta: { count: 1 },
      results: [
        {
          ...work,
          display_name: "Open World Image Aesthetic Assessment Framework",
        },
      ],
    },
  ]);
  const result = await p.lookup(identity);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 1);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes("search.title=%22"));
  assert.ok(!urls[1].includes("%22"));
});
test("matching candidates with year/author conflicts are preserved with explanations", async () => {
  const { provider: p, urls } = provider([
    { meta: { count: 1 }, results: [{ ...work, publication_year: 2025 }] },
  ]);
  const result = await p.lookup(identity);
  assert.equal(result.status, "ambiguous");
  assert.match(result.candidates[0].reasons.join(" "), /年份不一致/);
  assert.equal(urls.length, 1);
});
test("confirmation binds a paper, preserves OpenAlex source and survives restart", async () => {
  const seen = [];
  const { value: s, advance } = service({
    lookup: async (_identity, binding) => {
      seen.push(binding);
      return {
        status: "ok",
        result: {
          count: 8,
          source: "openalex",
          paperID: candidate.id,
          url: candidate.url,
          matchedBy: "confirmed",
        },
      };
    },
  });
  s.confirmCandidate(identity, candidate);
  assert.equal(s.get(identity).boundPaperID, candidate.id);
  assert.equal(s.get(identity).result.source, "openalex");
  assert.equal(s.get(identity).result.matchedBy, "confirmed");
  await s.refresh(identity);
  assert.equal(seen.length, 0);
  advance(7 * DAY);
  await s.refresh(identity);
  assert.deepEqual(seen, [candidate.id]);
  assert.equal(s.get(identity).result.count, 8);
  const restored = service({
    lookup: async () => ({ status: "not-found" }),
  }).value;
  restored.load(s.serialize());
  assert.equal(restored.get(identity).boundPaperID, candidate.id);
  assert.equal(restored.get({ ...identity, year: 2025 }), undefined);
});
test("confirmed provider retrieves the bound record directly despite metadata differences", async () => {
  const { provider: p, urls } = provider([
    {
      ...work,
      display_name: "Updated version title",
      publication_year: 2025,
      cited_by_count: 3,
    },
  ]);
  const result = await p.lookup(identity, candidate.id);
  assert.equal(result.result.matchedBy, "confirmed");
  assert.equal(result.result.count, 3);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("/W7220942938?"));
  assert.ok(!urls[0].includes("search"));
});
test("a failed bound refresh keeps binding, count and successful timestamp", async () => {
  const { value: s } = service({
    lookup: async () => {
      throw new Error("offline");
    },
  });
  s.confirmCandidate(identity, candidate);
  const before = s.get(identity).result;
  await s.refresh(identity, true);
  assert.equal(s.get(identity).boundPaperID, candidate.id);
  assert.deepEqual(s.get(identity).result, before);
  assert.equal(s.get(identity).status, "error");
});
test("confirmation prevents an older in-flight query from overwriting the chosen paper", async () => {
  let resolve;
  const { value: s } = service({
    lookup: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const old = s.refresh(identity);
  await Promise.resolve();
  s.confirmCandidate(identity, { ...candidate, count: 7 });
  resolve({ status: "not-found" });
  await old;
  assert.equal(s.get(identity).result.count, 7);
  assert.equal(s.get(identity).boundPaperID, candidate.id);
});
test("searching candidates leaves existing manual counts unchanged and shares the serial queue", async () => {
  let active = 0,
    max = 0;
  const { value: s } = service({
    lookup: async () => {
      active++;
      max = Math.max(active, max);
      await Promise.resolve();
      active--;
      return {
        status: "ambiguous",
        candidates: [{ ...candidate, reasons: [] }],
      };
    },
  });
  s.setManual(identity, 99);
  await Promise.all([s.findCandidates(identity), s.findCandidates(identity)]);
  assert.equal(max, 1);
  assert.equal(s.get(identity).result.count, 99);
  assert.equal(s.get(identity).result.source, "manual");
});
test("legacy misses expire on upgrade, successes survive and invalid bindings are rejected", () => {
  const success = {
    identity: "x",
    status: "ok",
    checkedAt: 1,
    retryAt: 10,
    result: {
      count: 0,
      source: "openalex",
      paperID: candidate.id,
      url: candidate.url,
      matchedBy: "title",
      updatedAt: 1,
    },
  };
  const cache = parseCache(
    JSON.stringify({
      version: 1,
      items: {
        success,
        miss: { ...success, status: "not-found", result: undefined },
        bad: { ...success, boundPaperID: "https://example.com/W1" },
      },
    }),
  );
  assert.deepEqual([...cache.keys()], ["success"]);
  for (const input of [
    "W7220942938",
    candidate.id,
    "https://openalex.org/works/W7220942938",
  ])
    assert.equal(normalizeOpenAlexID(input), candidate.id);
  assert.equal(normalizeOpenAlexID("https://example.com/W1"), undefined);
  assert.equal(normalizeOpenAlexID(123), undefined);
});
