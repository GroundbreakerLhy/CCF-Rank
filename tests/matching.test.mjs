import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countSortKey,
  matchCandidates,
  normalizeDOI,
  normalizeTitle,
} from "../.scaffold/citation-tests/core.js";

const identity = {
  key: "1:ABC123",
  doi: "10.1234/example",
  title: "Attention Is All You Need",
  year: 2017,
  author: "Vaswani",
};
const candidate = {
  id: "W1",
  doi: identity.doi,
  title: identity.title,
  year: 2017,
  authors: ["Ashish Vaswani"],
  count: 0,
  url: "https://openalex.org/W1",
};

test("DOI URLs, prefixes, encoding and case normalize; invalid identifiers are rejected", () => {
  for (const doi of [
    " DOI: 10.1234/Example ",
    "https://dx.doi.org/10.1234/Example",
    "https://doi.org/10.1234%2FExample",
  ])
    assert.equal(normalizeDOI(doi), identity.doi);
  for (const bad of ["", "not-a-doi", "10.12/x", "10.1234/a b", "10.1234/%ZZ"])
    assert.equal(normalizeDOI(bad), undefined);
});
test("Unicode title normalization preserves non-Latin distinctions", () => {
  assert.equal(
    normalizeTitle("Ａttention—Is All You Need!"),
    normalizeTitle(identity.title),
  );
  assert.notEqual(
    normalizeTitle("图神经网络研究"),
    normalizeTitle("量子计算研究"),
  );
});
test("DOI outranks changed title/year; zero is a valid count", () => {
  assert.equal(
    matchCandidates(identity, [
      { ...candidate, title: "Alternate title", year: 2020 },
    ]).matchedBy,
    "doi",
  );
  assert.equal(matchCandidates(identity, [candidate]).candidate.count, 0);
});
test("title fallback requires corroboration and sends conflicting metadata to confirmation", () => {
  const noDOI = { ...identity, doi: undefined };
  assert.equal(matchCandidates(noDOI, [candidate]).matchedBy, "title");
  assert.equal(
    matchCandidates(noDOI, [{ ...candidate, year: 2018 }]).status,
    "ambiguous",
  );
  assert.equal(
    matchCandidates(noDOI, [{ ...candidate, authors: ["Another Person"] }])
      .status,
    "ambiguous",
  );
  assert.equal(
    matchCandidates(identity, [{ ...candidate, doi: "10.1234/wrong" }]).status,
    "ambiguous",
  );
  assert.equal(
    matchCandidates({ ...noDOI, year: undefined, author: undefined }, [
      candidate,
    ]).status,
    "ambiguous",
  );
});
test("same-title ambiguity is never resolved by citation count; duplicate IDs deduplicate", () => {
  assert.equal(
    matchCandidates({ ...identity, doi: undefined }, [
      candidate,
      { ...candidate, id: "W2", count: 99999 },
    ]).status,
    "ambiguous",
  );
  assert.equal(matchCandidates(identity, [candidate, candidate]).status, "ok");
});
test("count sort keys order 0, 2, 10, 100 and large integers correctly", () => {
  assert.deepEqual(
    [100, 10, 0, Number.MAX_SAFE_INTEGER, 2]
      .map(countSortKey)
      .sort()
      .map(Number),
    [0, 2, 10, 100, Number.MAX_SAFE_INTEGER],
  );
});
