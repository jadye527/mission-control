"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const crypto_1 = require("crypto");
const db_1 = require("@/lib/db");
const email_1 = require("@/lib/email");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const TOKEN_TTL = 60 * 60; // 1 hour in seconds
/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Always returns 200 to prevent email enumeration.
 */
async function POST(request) {
    try {
        const rateCheck = (0, rate_limit_1.loginLimiter)(request);
        if (rateCheck)
            return rateCheck;
        const body = await request.json().catch(() => ({}));
        const email = String((body === null || body === void 0 ? void 0 : body.email) || '').trim().toLowerCase();
        if (!email) {
            return server_1.NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT id, email FROM users WHERE email = ? LIMIT 1')
            .get(email);
        // Always 200 — don't reveal whether email exists
        if (!user) {
            return server_1.NextResponse.json({ ok: true });
        }
        // Invalidate existing tokens for this user
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
        // Generate token
        const rawToken = (0, crypto_1.randomBytes)(32).toString('hex');
        const tokenHash = (0, crypto_1.createHash)('sha256').update(rawToken).digest('hex');
        const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL;
        db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, tokenHash, expiresAt);
        const result = await (0, email_1.sendPasswordResetEmail)(user.email, rawToken);
        if (!result.ok) {
            logger_1.logger.error({ err: result.error, userId: user.id }, 'Failed to send password reset email');
        }
        return server_1.NextResponse.json({ ok: true });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/auth/forgot-password error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
