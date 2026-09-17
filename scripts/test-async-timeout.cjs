const assert = require("assert");
const {
  AsyncOperationTimeoutError,
  normalizeTimeoutMs,
  runWithTimeout,
} = require("../src/server/async-timeout.cjs");

(async () => {
  assert.equal(normalizeTimeoutMs("25"), 25);
  assert.equal(normalizeTimeoutMs("invalid", 40), 40);
  assert.equal(await runWithTimeout(() => Promise.resolve("complete"), { timeoutMs: 50 }), "complete");
  await assert.rejects(
    runWithTimeout(() => new Promise(() => {}), { timeoutMs: 20, label: "Metadata providers" }),
    (error) => {
      assert(error instanceof AsyncOperationTimeoutError);
      assert.equal(error.code, "ASYNC_OPERATION_TIMEOUT");
      assert.equal(error.timeoutMs, 20);
      assert.match(error.message, /Metadata providers did not respond within 1 seconds/);
      return true;
    },
  );
  await assert.rejects(
    runWithTimeout(() => Promise.reject(new Error("provider failed")), { timeoutMs: 50 }),
    /provider failed/,
  );
  console.log("Async provider timeout tests: PASSED");
})();
