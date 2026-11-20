'use strict';
const crypto = require('crypto');

const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
const isLegacyHash = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

async function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || typeof stored !== 'string') return false;
  if (stored.startsWith('s1$')) {
    const [, s, k] = stored.split('$');
    const got = await scrypt(pw, Buffer.from(s, 'base64'));
    const exp = Buffer.from(k, 'base64');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  }
  if (isLegacyHash(stored)) { // formato de la versión anterior (SHA-256 sin sal); se migra al iniciar sesión
    const h = Buffer.from(crypto.createHash('sha256').update(pw).digest('hex'));
    return crypto.timingSafeEqual(h, Buffer.from(stored));
  }
  return false;
}

function createTokens(secret, ttlMs = 12 * 3600 * 1000) {
  const mac = body => crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return {
    sign(payload) {
      const now = Date.now();
      const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlMs })).toString('base64url');
      return body + '.' + mac(body);
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 2000) return null;
      const [body, sig, extra] = token.split('.');
      if (!body || !sig || extra !== undefined) return null;
      const a = Buffer.from(sig), b = Buffer.from(mac(body));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString());
        return p && p.exp > Date.now() && Number.isSafeInteger(p.uid) ? p : null;
      } catch { return null; }
    }
  };
}

function createLimiter() {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3);
  timer.unref();
  return {
    tooMany(key, max, windowMs) {
      const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < windowMs);
      arr.push(now); hits.set(key, arr); return arr.length > max;
    },
    clear: key => hits.delete(key)
  };
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

async function verifyRecaptcha(secret, token, remoteip, fetchImpl = fetch) {
  if (!secret) return true;
  if (typeof token !== 'string' || !token.trim() || token.length > 4096) return false;
  const body = new URLSearchParams({ secret, response: token.trim() });
  if (remoteip) body.set('remoteip', String(remoteip));
  try {
    const r = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!(j && j.success === true);
  } catch { return false; }
}

module.exports = { hashPassword, verifyPassword, isLegacyHash, createTokens, createLimiter, sha256, verifyRecaptcha };
