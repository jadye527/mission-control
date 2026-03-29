"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const crypto_1 = require("crypto");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const rate_limit_1 = require("@/lib/rate-limit");
/**
 * Mask an API key for display: show first 4 and last 5 chars.
 * e.g. "mc_a1b2c3d4e5f6g7h8i9j0" -> "mc_a****j0"
 */
function maskApiKey(key) {
    if (key.length <= 9)
        return '****';
    return key.slice(0, 4) + '-****-****-' + key.slice(-5);
}
/**
 * GET /api/tokens/rotate - Get metadata about the current API key
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const db = (0, db_1.getDatabase)();
    // Check for DB-stored override first
    const row = db.prepare("SELECT value, updated_by, updated_at FROM settings WHERE key = 'security.api_key'").get();
    if (row) {
        return server_1.NextResponse.json({
            masked_key: maskApiKey(row.value),
            source: 'database',
            last_rotated_at: row.updated_at,
            last_rotated_by: row.updated_by,
        });
    }
    // Fall back to env var
    const envKey = (process.env.API_KEY || '').trim();
    if (envKey) {
        return server_1.NextResponse.json({
            masked_key: maskApiKey(envKey),
            source: 'environment',
            last_rotated_at: null,
            last_rotated_by: null,
        });
    }
    return server_1.NextResponse.json({
        masked_key: null,
        source: 'none',
        last_rotated_at: null,
        last_rotated_by: null,
    });
}
/**
 * POST /api/tokens/rotate - Generate and store a new API key
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.mutationLimiter)(request);
    if (rateCheck)
        return rateCheck;
    // Generate a new key: mc_ prefix + 32 random hex chars
    const newKey = 'mc_' + (0, crypto_1.randomBytes)(24).toString('hex');
    const db = (0, db_1.getDatabase)();
    // Get old key info for audit trail
    const existing = db.prepare("SELECT value FROM settings WHERE key = 'security.api_key'").get();
    const oldSource = existing ? 'database' : (process.env.API_KEY || '').trim() ? 'environment' : 'none';
    const oldMasked = existing
        ? maskApiKey(existing.value)
        : (process.env.API_KEY || '').trim()
            ? maskApiKey((process.env.API_KEY || '').trim())
            : null;
    // Store new key in settings table (overrides env var)
    db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES ('security.api_key', ?, 'Active API key (overrides API_KEY env var)', 'security', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `).run(newKey, auth.user.username);
    // Audit log
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    (0, db_1.logAuditEvent)({
        action: 'api_key_rotated',
        actor: auth.user.username,
        actor_id: auth.user.id,
        detail: {
            old_source: oldSource,
            old_key_masked: oldMasked,
            new_key_masked: maskApiKey(newKey),
        },
        ip_address: ipAddress,
    });
    return server_1.NextResponse.json({
        key: newKey,
        masked_key: maskApiKey(newKey),
        rotated_at: Math.floor(Date.now() / 1000),
        rotated_by: auth.user.username,
        message: 'API key rotated successfully. Copy the key now — it will not be shown again.',
    });
}
