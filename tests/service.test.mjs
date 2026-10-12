import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, fingerprint } from "../.scaffold/citation-tests/core.js";
import {
  CitationService,
  parseCache,
} from "../.scaffold/citation-tests/service.js";

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
const ok = (count = 12) => ({
  status: "ok",
  result: {
    count,
    source: "openalex",
    paperID: "W1",
    url: candidate.url,
    matchedBy: "doi",
  },
});
function service(provider = { lookup: async () => ok() }) {
  let now = 1000;
  let ttl = 7 * DAY;
  let changes = 0;
  const s = new CitationService({
    provider,
    now: () => now,
    ttl: () => ttl,
    changed: () => changes++,
  });
  return {
    s,
    advance: (ms) => (now += ms),
    ttl: (ms) => (ttl = ms),
    changes: () => changes,
  };
}

test("single-flight, positive cache expiry, force refresh and round-trip persistence", async () => {
  let calls = 0;
  const { s, advance } = service({
    lookup: async () => {
      calls++;
      return ok(0);
    },
  });
  await Promise.all([
    s.refresh(identity),
    s.refresh(identity),
    s.refresh(identity),
  ]);
  assert.equal(calls, 1);
  await s.refresh(identity);
  assert.equal(calls, 1);
  advance(7 * DAY);
  await s.refresh(identity);
  assert.equal(calls, 2);
  await s.refresh(identity, true);
  assert.equal(calls, 3);
  const restored = service().s;
  restored.load(s.serialize());
  assert.equal(restored.get(identity).result.count, 0);
});
test("metadata and library keys isolate cache; shortening TTL takes effect immediately", async () => {
  const { s, advance, ttl } = service();
  await s.refresh(identity);
  for (const changed of [
    { year: 2018 },
    { title: "Another title" },
    { doi: "10.1234/new" },
    { author: "Other" },
    { key: "2:ABC123" },
  ])
    assert.equal(s.get({ ...identity, ...changed }), undefined);
  advance(2 * DAY);
  ttl(DAY);
  await s.refresh(identity);
  assert.equal(s.get(identity).result.updatedAt, 1000 + 2 * DAY);
});
test("negative/ambiguous records wait one day, errors wait fifteen minutes", async () => {
  for (const status of ["not-found", "ambiguous", "error"]) {
    let calls = 0;
    const { s, advance } = service({
      lookup: async () => {
        calls++;
        if (status === "error") throw new Error("offline");
        return { status };
      },
    });
    await s.refresh(identity);
    await s.refresh(identity);
    assert.equal(calls, 1);
    advance(status === "error" ? 15 * 60_000 : DAY);
    await s.refresh(identity);
    assert.equal(calls, 2);
  }
});
test("failed refresh preserves prior count/source/timestamp; later lower counts are accepted", async () => {
  let response = ok(100);
  const { s, advance } = service({
    lookup: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
  });
  await s.refresh(identity);
  const prior = s.get(identity).result;
  advance(7 * DAY);
  response = new Error("offline");
  await s.refresh(identity);
  assert.equal(s.get(identity).status, "error");
  assert.deepEqual(s.get(identity).result, prior);
  response = ok(90);
  await s.refresh(identity, true);
  assert.equal(s.get(identity).result.count, 90);
});
test("manual override survives force refresh, validation and persistence", async () => {
  let calls = 0;
  const { s } = service({
    lookup: async () => {
      calls++;
      return ok();
    },
  });
  s.setManual(identity, 0);
  await s.refresh(identity, true);
  assert.equal(calls, 0);
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => s.setManual(identity, value));
  const restored = service().s;
  restored.load(s.serialize());
  assert.equal(restored.get(identity).result.source, "manual");
  s.remove(identity.key);
  await s.refresh(identity);
  assert.equal(calls, 1);
});
test("manual/deletion/cancellation/shutdown prevent in-flight responses from overwriting state", async () => {
  for (const action of ["manual", "remove", "cancel", "stop"]) {
    let resolve;
    const { s } = service({ lookup: () => new Promise((r) => (resolve = r)) });
    const work = s.refresh(identity);
    await Promise.resolve();
    if (action === "manual") s.setManual(identity, 55);
    if (action === "remove") s.remove(identity.key);
    if (action === "cancel") s.cancelPending();
    if (action === "stop") s.stop();
    resolve(ok(1));
    await work;
    if (action === "manual") assert.equal(s.get(identity).result.count, 55);
    else assert.equal(s.get(identity), undefined);
  }
});
test("changed metadata during a request replaces older result without races", async () => {
  let resolve;
  let calls = 0;
  const { s } = service({
    lookup: () =>
      ++calls === 1
        ? new Promise((r) => (resolve = r))
        : Promise.resolve(ok(22)),
  });
  const first = s.refresh(identity);
  await Promise.resolve();
  const changed = { ...identity, title: "A newly corrected title" };
  const second = s.refresh(changed);
  resolve(ok(11));
  await Promise.all([first, second]);
  assert.equal(s.get(changed).result.count, 22);
  assert.equal(s.get(identity), undefined);
});
test("serial queue has one active lookup and is bounded", async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const { s } = service({
    lookup: async () => {
      calls++;
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      active--;
      return ok();
    },
  });
  await Promise.all(
    Array.from({ length: 250 }, (_, i) =>
      s.refresh({ ...identity, key: `1:${i}` }),
    ),
  );
  assert.equal(maximum, 1);
  assert.equal(calls, 200);
});
test("corrupt/unknown cache schemas and invalid entries are ignored", () => {
  for (const raw of [
    "bad json",
    "null",
    '{"version":2,"items":{}}',
    '{"version":1,"items":{"a":null}}',
  ])
    assert.equal(parseCache(raw).size, 0);
  const valid = {
    identity: fingerprint(identity),
    status: "ok",
    checkedAt: 0,
    retryAt: 0,
    result: { ...ok().result, updatedAt: 0 },
  };
  const corrupt = { ...valid, result: { ...valid.result, count: -1 } };
  const invalidDate = {
    ...valid,
    result: { ...valid.result, updatedAt: 1e100 },
  };
  assert.equal(
    parseCache(
      JSON.stringify({ version: 1, items: { valid, corrupt, invalidDate } }),
    ).size,
    1,
  );
});
