const crypto = require('node:crypto');

// Fixed field order and audience separate these proofs from license signatures.
function proofMessage(action, body) {
  return Buffer.from(JSON.stringify(['homestead-server-link-v1', action, body.installationId,
    body.timestamp, body.nonce, body.data]));
}
function publicIdentity(pem) {
  if (typeof pem !== 'string' || pem.length > 1000) throw new Error('Invalid server identity.');
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid server identity.');
  return {publicKey:key.export({type:'spki',format:'pem'}),
    fingerprint:crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')};
}
function signRequest(identity, action, data, now = Date.now()) {
  const body = {installationId:identity.installationId, timestamp:Math.floor(now / 1000), nonce:crypto.randomBytes(24).toString('base64url'), data};
  return {...body, signature:crypto.sign(null, proofMessage(action, body), identity.privateKey).toString('base64url')};
}
function validProof(action, body, publicKey, now = Date.now()) {
  try {
    return typeof body.installationId === 'string' && /^[a-f0-9-]{36}$/i.test(body.installationId)
      && Number.isInteger(body.timestamp) && Math.abs(body.timestamp * 1000 - now) <= 120000
      && typeof body.nonce === 'string' && /^[\w-]{32}$/.test(body.nonce)
      && typeof body.signature === 'string' && /^[\w-]{86}$/.test(body.signature)
      && body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      && crypto.verify(null, proofMessage(action, body), publicKey, Buffer.from(body.signature, 'base64url'));
  } catch { return false; }
}
module.exports = {proofMessage, publicIdentity, signRequest, validProof};
