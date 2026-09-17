"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createSubscriptionService, verifyLicenseToken } = require("../src/server/subscription-entitlements.cjs");

const productionFree = createSubscriptionService({ env: { NODE_ENV: "production" } });
assert.equal(productionFree.status().tier, "free");
assert.equal(productionFree.status().limits.users, 1);
assert.equal(productionFree.status().limits.concurrentStreams, 1);
assert.equal(productionFree.has("coreMedia"), true);
assert.equal(productionFree.has("multiUser"), false);
assert.equal(productionFree.allowsLibrary("movies"), true);
assert.equal(productionFree.allowsLibrary("photos"), false);
assert.equal(productionFree.allowsLibrary("adult"), false);

const developmentPreview = createSubscriptionService({ env: { NODE_ENV: "development" } });
assert.equal(developmentPreview.status().tier, "pro");
assert.equal(developmentPreview.status().developmentPreview, true);
assert.equal(developmentPreview.has("plugins"), true);

const familyPreview = createSubscriptionService({ env: { NODE_ENV: "development", HOMESTEAD_SUBSCRIPTION_TIER: "family" } });
assert.equal(familyPreview.has("multiUser"), true);
assert.equal(familyPreview.has("familyLibrary"), true);
assert.equal(familyPreview.has("cloud"), false);
assert.equal(familyPreview.allowsLibrary("photos"), true);
assert.equal(familyPreview.allowsLibrary("inventory"), false);

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const payload = Buffer.from(JSON.stringify({ tier: "plus", customerId: "customer-test", expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString("base64url");
const token = `${payload}.${signature}`;
assert.equal(verifyLicenseToken(token, publicKey).tier, "plus");
assert.equal(verifyLicenseToken(`${payload}.${signature.slice(0, -2)}xx`, publicKey), null);

const signedPlus = createSubscriptionService({ env: { NODE_ENV: "production", HOMESTEAD_LICENSE_TOKEN: token, HOMESTEAD_LICENSE_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }) } });
assert.equal(signedPlus.status().tier, "plus");
assert.equal(signedPlus.status().source, "signed-license");
assert.equal(signedPlus.has("cloud"), true);
assert.equal(signedPlus.has("liveTV"), false);

let nowMs = Date.now();
const singleStream = createSubscriptionService({ env: { NODE_ENV: "production" }, now: () => nowMs });
assert.equal(singleStream.claimStream({ clientId: "device-a", mediaKey: "movie-a.mp4" }).allowed, true);
assert.equal(singleStream.claimStream({ clientId: "device-a", mediaKey: "movie-b.mp4" }).allowed, true);
assert.equal(singleStream.claimStream({ clientId: "device-b", mediaKey: "movie-c.mp4" }).allowed, false);
assert.equal(singleStream.releaseStream("device-a"), true);
assert.equal(singleStream.claimStream({ clientId: "device-b", mediaKey: "movie-c.mp4" }).allowed, true);
singleStream.releaseStream("device-b");
singleStream.claimStream({ clientId: "device-a", mediaKey: "movie-a.mp4" });
nowMs += 121000;
assert.equal(singleStream.claimStream({ clientId: "device-b", mediaKey: "movie-c.mp4" }).allowed, true);

console.log("Homestead subscription entitlement, signed-license, and single-stream checks passed.");
