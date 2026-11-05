const test = require("node:test");
const assert = require("node:assert");
const limits = require("../src/services/ai/limits");

/**
 * The limits that keep a self-hosted model from taking the CRM down with it.
 *
 * Ollama runs on the same two cores as everything else, and one generation holds a core for the
 * better part of a minute. These are not throughput tuning - they are the difference between a slow
 * assistant and a slow leads table.
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(() => {
  limits.reset();
  process.env.AI_MAX_CONCURRENT_REQUESTS = "2";
  process.env.AI_MAX_QUEUED_REQUESTS = "2";
  process.env.AI_MAX_REQUESTS_PER_MINUTE = "5";
});
test.after(() => {
  limits.reset();
  delete process.env.AI_MAX_CONCURRENT_REQUESTS;
  delete process.env.AI_MAX_QUEUED_REQUESTS;
  delete process.env.AI_MAX_REQUESTS_PER_MINUTE;
});

test("only the configured number run at once", async () => {
  let concurrent = 0;
  let peak = 0;

  const work = () => limits.withLimits(1, async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await wait(30);
    concurrent -= 1;
  });

  // Four pieces of work, two slots: they must not all run together.
  await Promise.all([work(), work(), work(), work()]);
  assert.strictEqual(peak, 2, `${peak} ran at once`);
});

test("work past the queue is refused quickly rather than queued slowly", async () => {
  // Two running, two queued, and the fifth has nowhere to go. A refusal in a second beats a
  // spinner for two minutes.
  const held = [work(), work(), work(), work()];
  await wait(5);

  await assert.rejects(
    () => limits.withLimits(1, async () => {}),
    (error) => error.code === "AI_BUSY" && error.status === 503,
  );

  await Promise.all(held);

  function work() {
    return limits.withLimits(1, () => wait(40));
  }
});

test("one person cannot use the whole assistant", async () => {
  for (let i = 0; i < 5; i += 1) await limits.withLimits(7, async () => {});
  await assert.rejects(
    () => limits.withLimits(7, async () => {}),
    (error) => error.code === "AI_RATE_LIMITED" && error.status === 429,
  );
});

test("the rate limit is per person, not shared", async () => {
  // One busy user must not lock everyone else out.
  for (let i = 0; i < 5; i += 1) await limits.withLimits(7, async () => {});
  await limits.withLimits(8, async () => {});
});

test("a failing request never leaks its slot", async () => {
  /*
   * The failure that would be worst to debug: a thrown error leaving a slot held, so the assistant
   * slowly stops answering and nothing says why.
   */
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => limits.withLimits(1, async () => { throw new Error("tool exploded"); }));
  }
  assert.strictEqual(limits.state().running, 0, "a slot was left held");

  // And it still works afterwards.
  let ran = false;
  await limits.withLimits(1, async () => { ran = true; });
  assert.ok(ran);
});

test("a rate-limited request never takes a slot", async () => {
  for (let i = 0; i < 5; i += 1) await limits.withLimits(9, async () => {});
  await assert.rejects(() => limits.withLimits(9, async () => {}));
  // Refused before queueing, so someone spamming does not occupy the machine.
  assert.strictEqual(limits.state().running, 0);
  assert.strictEqual(limits.state().queued, 0);
});
