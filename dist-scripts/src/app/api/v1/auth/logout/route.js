"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_v1_1 = require("@/lib/auth-v1");
const db_1 = require("@/lib/db");
async function POST(request) {
    const { user } = (0, auth_v1_1.logoutCurrentSession)(request);
    if (user) {
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({ action: 'logout', actor: user.username, actor_id: user.id, ip_address: ipAddress });
    }
    const response = server_1.NextResponse.json({ ok: true });
    (0, auth_v1_1.clearSessionCookie)(response, request);
    return response;
}
