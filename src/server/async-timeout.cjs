class AsyncOperationTimeoutError extends Error {
  constructor(label, timeoutMs) {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    super(`${label} did not respond within ${seconds} seconds.`);
    this.name = "AsyncOperationTimeoutError";
    this.code = "ASYNC_OPERATION_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

function normalizeTimeoutMs(value, fallback = 20000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

async function runWithTimeout(operation, options = {}) {
  if (typeof operation !== "function") throw new TypeError("Timed operation must be a function.");
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const label = String(options.label || "Operation").trim() || "Operation";
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new AsyncOperationTimeoutError(label, timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  AsyncOperationTimeoutError,
  normalizeTimeoutMs,
  runWithTimeout,
};
