import assert from "node:assert/strict";
import { test } from "node:test";
import { createGecko } from "../../electron/gecko.js";

const reply = (status, body = {}) => ({ status, ok: status < 400, statusText: String(status), json: async () => body });

test("gecko queue: a rate-limited call waits and is tried again, high priority first", async () => {
  const seen = [];
  const gecko = createGecko({
    net: {
      fetch: async (url) => {
        const q = url.split("query=")[1];
        seen.push(q);
        // The first call is rate limited; every call after it answers.
        return seen.length === 1 ? reply(429) : reply(200, { q });
      },
    },
    spacingMs: 1,
    maxSpacingMs: 4,
    backoffMs: 5,
  });
  const low = gecko.get("/search/pools?query=low", "low");
  const high = gecko.get("/search/pools?query=high", "high");
  assert.deepEqual(await low, { q: "low" });
  assert.deepEqual(await high, { q: "high" });
  // The waiting high-priority call goes before the retried low one.
  assert.deepEqual(seen, ["low", "high", "low"]);
});

test("gecko queue: gives up after four rate limits, refuses other hosts' paths", async () => {
  let calls = 0;
  const gecko = createGecko({ net: { fetch: async () => (calls++, reply(429)) }, spacingMs: 1, maxSpacingMs: 4, backoffMs: 1 });
  await assert.rejects(gecko.get("/search/pools?query=x"), /rate limit/);
  assert.equal(calls, 4);
  await assert.rejects(gecko.get("/simple/token_price"), /not allowed/);
});
