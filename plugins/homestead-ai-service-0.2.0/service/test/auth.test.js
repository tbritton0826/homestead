"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSignature, createVerifier } = require("../src/auth.js");

test("accepts a valid signed request and rejects replay", () => {
  const secret = "a".repeat(40);
  const timestamp = String(Date.now());
  const nonce = "nonce_abcdefghijklmnop";
  const body = JSON.stringify({ hello: "Homestead" });
  const headers = {
    "x-homestead-timestamp": timestamp,
    "x-homestead-nonce": nonce,
    "x-homestead-signature": computeSignature(secret, timestamp, nonce, body),
  };
  const verify = createVerifier();
  assert.equal(verify(headers, body, secret), true);
  assert.throws(() => verify(headers, body, secret), /already been used/);
});

test("rejects an invalid signature", () => {
  const verify = createVerifier();
  assert.throws(() => verify({
    "x-homestead-timestamp": String(Date.now()),
    "x-homestead-nonce": "nonce_abcdefghijklmnop",
    "x-homestead-signature": "invalid",
  }, "{}", "b".repeat(40)), /authentication failed/);
});
