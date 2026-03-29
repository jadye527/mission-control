"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const auth_v1_1 = require("@/lib/auth-v1");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json({
        api_keys: (0, auth_1.listUserApiKeys)(auth.user.id, auth.user.tenant_id).map((key) => ({
            id: key.id,
            label: key.label,
            key_prefix: key.key_prefix,
            role: key.role,
            scopes: key.scopes,
            expires_at: key.expires_at,
            last_used_at: key.last_used_at,
            last_used_ip: key.last_used_ip,
            is_revoked: key.is_revoked,
            workspace_id: key.workspace_id,
            tenant_id: key.tenant_id,
            created_at: key.created_at,
        })),
    });
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const label = String((body === null || body === void 0 ? void 0 : body.label) || '').trim();
    if (!label)
        return server_1.NextResponse.json({ error: 'label is required' }, { status: 400 });
    const created = (0, auth_v1_1.createCurrentUserApiKey)(auth.user, {
        label,
        role: body === null || body === void 0 ? void 0 : body.role,
        scopes: Array.isArray(body === null || body === void 0 ? void 0 : body.scopes) ? body.scopes.map((value) => String(value)) : undefined,
        expires_in_days: (body === null || body === void 0 ? void 0 : body.expires_in_days) ? Number(body.expires_in_days) : undefined,
    });
    return server_1.NextResponse.json({
        api_key: created.rawKey,
        key: {
            id: created.record.id,
            label: created.record.label,
            key_prefix: created.record.key_prefix,
            role: created.record.role,
            scopes: created.record.scopes,
            expires_at: created.record.expires_at,
            workspace_id: created.record.workspace_id,
            tenant_id: created.record.tenant_id,
            created_at: created.record.created_at,
        },
    }, { status: 201 });
}
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const keyId = Number(body === null || body === void 0 ? void 0 : body.id);
    if (!Number.isInteger(keyId) || keyId <= 0) {
        return server_1.NextResponse.json({ error: 'Key id is required' }, { status: 400 });
    }
    const revoked = (0, auth_v1_1.revokeCurrentUserApiKey)(auth.user, keyId);
    if (!revoked)
        return server_1.NextResponse.json({ error: 'Key not found' }, { status: 404 });
    return server_1.NextResponse.json({ success: true });
}
