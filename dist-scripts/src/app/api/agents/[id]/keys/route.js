"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const crypto_1 = require("crypto");
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const ALLOWED_SCOPES = new Set([
    'viewer',
    'operator',
    'admin',
    'agent:self',
    'agent:diagnostics',
    'agent:attribution',
    'agent:heartbeat',
    'agent:messages',
]);
function hashApiKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
function resolveAgent(db, idParam, workspaceId) {
    if (/^\d+$/.test(idParam)) {
        return db
            .prepare(`SELECT id, name, workspace_id FROM agents WHERE id = ? AND workspace_id = ?`)
            .get(Number(idParam), workspaceId) || null;
    }
    return db
        .prepare(`SELECT id, name, workspace_id FROM agents WHERE name = ? AND workspace_id = ?`)
        .get(idParam, workspaceId) || null;
}
function parseScopes(rawScopes) {
    const fallback = ['viewer', 'agent:self'];
    if (!Array.isArray(rawScopes))
        return fallback;
    const scopes = rawScopes
        .map((scope) => String(scope).trim())
        .filter((scope) => scope.length > 0 && ALLOWED_SCOPES.has(scope));
    if (scopes.length === 0)
        return fallback;
    return Array.from(new Set(scopes));
}
function parseExpiry(body) {
    if ((body === null || body === void 0 ? void 0 : body.expires_at) != null) {
        const value = Number(body.expires_at);
        if (!Number.isInteger(value) || value <= 0)
            throw new Error('expires_at must be a future unix timestamp');
        return value;
    }
    if ((body === null || body === void 0 ? void 0 : body.expires_in_days) != null) {
        const days = Number(body.expires_in_days);
        if (!Number.isFinite(days) || days <= 0 || days > 3650) {
            throw new Error('expires_in_days must be between 1 and 3650');
        }
        return Math.floor(Date.now() / 1000) + Math.floor(days * 24 * 60 * 60);
    }
    return null;
}
async function GET(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolved = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const agent = resolveAgent(db, resolved.id, workspaceId);
        if (!agent)
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        const rows = db
            .prepare(`
        SELECT id, name, key_prefix, scopes, created_by, expires_at, revoked_at, last_used_at, created_at, updated_at
        FROM agent_api_keys
        WHERE agent_id = ? AND workspace_id = ?
        ORDER BY created_at DESC, id DESC
      `)
            .all(agent.id, workspaceId);
        return server_1.NextResponse.json({
            agent: { id: agent.id, name: agent.name },
            keys: rows.map((row) => (Object.assign(Object.assign({}, row), { scopes: (() => {
                    try {
                        const parsed = JSON.parse(row.scopes);
                        return Array.isArray(parsed) ? parsed : [];
                    }
                    catch (_a) {
                        return [];
                    }
                })() }))),
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/agents/[id]/keys error');
        return server_1.NextResponse.json({ error: 'Failed to list agent API keys' }, { status: 500 });
    }
}
async function POST(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolved = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const agent = resolveAgent(db, resolved.id, workspaceId);
        if (!agent)
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        const body = await request.json().catch(() => ({}));
        const name = String((body === null || body === void 0 ? void 0 : body.name) || 'default').trim().slice(0, 128);
        if (!name)
            return server_1.NextResponse.json({ error: 'name is required' }, { status: 400 });
        let expiresAt = null;
        try {
            expiresAt = parseExpiry(body);
        }
        catch (error) {
            return server_1.NextResponse.json({ error: error.message }, { status: 400 });
        }
        const scopes = parseScopes(body === null || body === void 0 ? void 0 : body.scopes);
        const now = Math.floor(Date.now() / 1000);
        const rawKey = `mca_${(0, crypto_1.randomBytes)(24).toString('hex')}`;
        const keyHash = hashApiKey(rawKey);
        const keyPrefix = rawKey.slice(0, 12);
        const result = db
            .prepare(`
        INSERT INTO agent_api_keys (
          agent_id, workspace_id, name, key_hash, key_prefix, scopes, expires_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
            .run(agent.id, workspaceId, name, keyHash, keyPrefix, JSON.stringify(scopes), expiresAt, auth.user.username, now, now);
        return server_1.NextResponse.json({
            key: {
                id: Number(result.lastInsertRowid),
                name,
                key_prefix: keyPrefix,
                scopes,
                expires_at: expiresAt,
                created_at: now,
            },
            api_key: rawKey,
        }, { status: 201 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/agents/[id]/keys error');
        return server_1.NextResponse.json({ error: 'Failed to create agent API key' }, { status: 500 });
    }
}
async function DELETE(request, { params }) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const db = (0, db_1.getDatabase)();
        const resolved = await params;
        const workspaceId = (_a = auth.user.workspace_id) !== null && _a !== void 0 ? _a : 1;
        const agent = resolveAgent(db, resolved.id, workspaceId);
        if (!agent)
            return server_1.NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        const body = await request.json().catch(() => ({}));
        const keyId = Number(body === null || body === void 0 ? void 0 : body.key_id);
        if (!Number.isInteger(keyId) || keyId <= 0) {
            return server_1.NextResponse.json({ error: 'key_id must be a positive integer' }, { status: 400 });
        }
        const now = Math.floor(Date.now() / 1000);
        const result = db
            .prepare(`
        UPDATE agent_api_keys
        SET revoked_at = ?, updated_at = ?
        WHERE id = ? AND agent_id = ? AND workspace_id = ? AND revoked_at IS NULL
      `)
            .run(now, now, keyId, agent.id, workspaceId);
        if (result.changes < 1) {
            return server_1.NextResponse.json({ error: 'Active key not found for this agent' }, { status: 404 });
        }
        return server_1.NextResponse.json({ success: true, key_id: keyId, revoked_at: now });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'DELETE /api/agents/[id]/keys error');
        return server_1.NextResponse.json({ error: 'Failed to revoke agent API key' }, { status: 500 });
    }
}
