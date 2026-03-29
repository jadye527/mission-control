"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const auth_v1_1 = require("@/lib/auth-v1");
const auth_2 = require("@/lib/auth");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json({
        invites: (0, auth_2.listTenantInvites)(auth.user.tenant_id).map((invite) => ({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            tenant_id: invite.tenant_id,
            workspace_id: invite.workspace_id,
            workspace_name: invite.workspace_name,
            workspace_slug: invite.workspace_slug,
            invited_by_username: invite.invited_by_username,
            token_hint: invite.token_hint,
            expires_at: invite.expires_at,
            accepted_at: invite.accepted_at,
            revoked_at: invite.revoked_at,
            created_at: invite.created_at,
        })),
    });
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const email = String((body === null || body === void 0 ? void 0 : body.email) || '').trim().toLowerCase();
    const role = String((body === null || body === void 0 ? void 0 : body.role) || 'viewer');
    if (!email || !['admin', 'operator', 'viewer'].includes(role)) {
        return server_1.NextResponse.json({ error: 'Valid email and role are required' }, { status: 400 });
    }
    try {
        const created = (0, auth_v1_1.createInviteForCurrentUser)(auth.user, {
            email,
            role,
            workspace_id: (body === null || body === void 0 ? void 0 : body.workspace_id) ? Number(body.workspace_id) : undefined,
            expires_in_days: (body === null || body === void 0 ? void 0 : body.expires_in_days) ? Number(body.expires_in_days) : undefined,
        });
        return server_1.NextResponse.json(created, { status: 201 });
    }
    catch (error) {
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to create invite' }, { status: 400 });
    }
}
async function DELETE(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const inviteId = Number(body === null || body === void 0 ? void 0 : body.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
        return server_1.NextResponse.json({ error: 'Invite id is required' }, { status: 400 });
    }
    const ok = (0, auth_v1_1.revokeCurrentTenantInvite)(auth.user, inviteId);
    if (!ok)
        return server_1.NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    return server_1.NextResponse.json({ success: true });
}
