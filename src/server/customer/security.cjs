const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function failure(status, message) { const error = new Error(message); error.status = status; return error; }
function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw failure(400, `Invalid ${label}.`);
  return value.trim();
}
function email(value) {
  const result = text(value, 3, 254, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw failure(400, 'Invalid email.');
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 256) throw failure(400, 'Use a password of 12–256 characters.');
  return value;
}
async function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt-v1:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(value, stored) {
  const [version, salt, expected] = String(stored || '').split(':');
  // Apply the same expensive operation to nonexistent accounts to reduce enumeration.
  const actual = await scrypt(String(value), salt || 'missing-account', 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return version === 'scrypt-v1' && /^[a-f0-9]{128}$/.test(expected || '') && crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('='); return [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
}
function configuration(env) {
  const origin = new URL(env.HOMESTEAD_CUSTOMER_ORIGIN || 'http://localhost:7312');
  const production = env.NODE_ENV === 'production';
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Customer origin must be an origin only');
  if (production && origin.protocol !== 'https:') throw new Error('HTTPS customer origin required in production');
  if (!production && origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('HTTP customer origin must be loopback');
  return { origin: origin.origin, secure: origin.protocol === 'https:',
    sessionName: production ? '__Host-homestead_customer' : 'homestead_customer',
    csrfName: production ? '__Host-homestead_customer_csrf' : 'homestead_customer_csrf' };
}
function setCookie(res, name, value, config, maxAge = 604800) {
  res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? '; Secure' : ''}`);
}
async function rateLimit(db, key, maximum, seconds = 900) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const result = await db.query(`INSERT INTO customer_rate_limits(key_hash,count,expires_at) VALUES($1,1,$2)
    ON CONFLICT(key_hash) DO UPDATE SET count=customer_rate_limits.count+1 RETURNING count`, [digest(`${key}:${bucket}`), new Date((bucket + 1) * seconds * 1000)]);
  if (result.rows[0].count > maximum) throw failure(429, 'Too many attempts. Try again later.');
}
module.exports = { randomToken, digest, failure, text, email, password, hashPassword, verifyPassword, cookies, configuration, setCookie, rateLimit };
