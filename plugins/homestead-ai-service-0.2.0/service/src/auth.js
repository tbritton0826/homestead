"use strict";

const crypto = require("crypto");

function computeSignature(secret, timestamp, nonce, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}\n${nonce}\n${body}`).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createVerifier(options = {}) {
  const maximumAgeMs = Number(options.maximumAgeMs) || 5 * 60 * 1000;
  const seen = new Map();

  function prune(now) {
    for (const [nonce, expiry] of seen.entries()) if (expiry <= now) seen.delete(nonce);
  }

  return function verify(headers, rawBody, secret) {
    if (!secret || secret.length < 32) {
      const error = new Error("AI_SHARED_SECRET must contain at least 32 characters.");
      error.statusCode = 503;
      error.code = "SERVICE_SECRET_INVALID";
      throw error;
    }
    const timestamp = String(headers["x-homestead-timestamp"] || "");
    const nonce = String(headers["x-homestead-nonce"] || "");
    const signature = String(headers["x-homestead-signature"] || "");
    const parsedTimestamp = Number(timestamp);
    const now = Date.now();
    if (!Number.isFinite(parsedTimestamp) || Math.abs(now - parsedTimestamp) > maximumAgeMs) {
      const error = new Error("Signed request timestamp is missing or expired.");
      error.statusCode = 401;
      error.code = "SIGNATURE_EXPIRED";
      throw error;
    }
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(nonce)) {
      const error = new Error("Signed request nonce is invalid.");
      error.statusCode = 401;
      error.code = "NONCE_INVALID";
      throw error;
    }
    prune(now);
    if (seen.has(nonce)) {
      const error = new Error("Signed request nonce has already been used.");
      error.statusCode = 409;
      error.code = "REPLAY_DENIED";
      throw error;
    }
    const expected = computeSignature(secret, timestamp, nonce, rawBody);
    if (!safeEqual(expected, signature)) {
      const error = new Error("Signed request authentication failed.");
      error.statusCode = 401;
      error.code = "SIGNATURE_INVALID";
      throw error;
    }
    seen.set(nonce, now + maximumAgeMs);
    return true;
  };
}

module.exports = { computeSignature, createVerifier, safeEqual };
