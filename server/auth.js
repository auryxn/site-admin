/*
 * server/auth.js — tiny HMAC token issuer/verifier (no deps).
 * Secret is read from env SITE_SECRET or a stable default.
 */
'use strict';

const crypto = require('node:crypto');

function getSecret() {
  return (
    process.env.SITE_SECRET ||
    'site-admin-dev-secret-change-me-in-production-9c41a7e0d3b6'
  );
}

// Signed token = base64url(payload).base64url(HMAC-SHA256(payload))
function signToken(payload, expiresInSeconds = 60 * 60 * 24) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000) };
  body.exp = body.iat + expiresInSeconds;
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken, getSecret };
