"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { computeSignature } = require("../src/auth.js");

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Service did not start in time.")), 5000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening on port")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Service exited early with ${code}.`)); });
  });
}

test("signed plugin-to-service turn succeeds end to end", async (t) => {
  const port = 19000 + (process.pid % 1000);
  const secret = "homestead-integration-secret-1234567890";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: require("node:path").resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), AI_SHARED_SECRET: secret, AI_PROVIDER: "mock", AI_ALLOWED_PROVIDERS: "mock", AI_MODEL: "mock-1", AI_ALLOWED_MODELS: "mock-1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  await waitForReady(child);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.authenticationConfigured, true);

  const body = JSON.stringify({ messages: [{ role: "user", content: "Hello Homestead" }], tools: [], systemContext: "Integration test", model: {} });
  const timestamp = String(Date.now());
  const nonce = "nonce_integration_123456";
  const response = await fetch(`http://127.0.0.1:${port}/v1/turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Homestead-Timestamp": timestamp,
      "X-Homestead-Nonce": nonce,
      "X-Homestead-Signature": computeSignature(secret, timestamp, nonce, body),
    },
    body,
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.type, "message");
  assert.match(result.message.content, /Hello Homestead/);

  const modelsBody = "{}";
  const modelsTimestamp = String(Date.now());
  const modelsNonce = "nonce_models_1234567890";
  const modelsResponse = await fetch(`http://127.0.0.1:${port}/v1/models`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Homestead-Timestamp": modelsTimestamp,
      "X-Homestead-Nonce": modelsNonce,
      "X-Homestead-Signature": computeSignature(secret, modelsTimestamp, modelsNonce, modelsBody),
    },
    body: modelsBody,
  });
  const catalog = await modelsResponse.json();
  assert.equal(modelsResponse.status, 200);
  assert.equal(catalog.defaultModel, "mock-1");
  assert.equal(catalog.models[0].toolCapable, true);
});
