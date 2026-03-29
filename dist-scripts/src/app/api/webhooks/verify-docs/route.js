"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
/**
 * GET /api/webhooks/verify-docs - Returns webhook signature verification documentation
 * No secrets exposed. Accessible to any authenticated user (viewer+).
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json({
        algorithm: 'HMAC-SHA256',
        header: 'X-MC-Signature',
        format: 'sha256=<hex-digest>',
        description: 'Mission Control signs webhook payloads using HMAC-SHA256. The signature is sent in the X-MC-Signature header.',
        verification_steps: [
            '1. Extract the raw request body as a UTF-8 string (do NOT parse JSON first).',
            '2. Read the X-MC-Signature header value.',
            '3. Compute HMAC-SHA256 of the raw body using your webhook secret.',
            '4. Format the expected value as: sha256=<hex-digest>',
            '5. Compare the computed value with the header using a constant-time comparison.',
            '6. Reject the request if they do not match.',
        ],
        example_nodejs: `
const crypto = require('crypto');

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signatureHeader);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

// In your Express/Fastify handler:
// const isValid = verifySignature(MY_SECRET, req.rawBody, req.headers['x-mc-signature']);
`.trim(),
    });
}
