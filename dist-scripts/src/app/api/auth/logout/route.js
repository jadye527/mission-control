"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const session_cookie_1 = require("@/lib/session-cookie");
async function POST(request) {
    const user = (0, auth_1.getUserFromRequest)(request);
    const cookieHeader = request.headers.get('cookie') || '';
    const token = (0, session_cookie_1.parseMcSessionCookieHeader)(cookieHeader);
    if (token) {
        (0, auth_1.destroySession)(token);
    }
    if (user) {
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        (0, db_1.logAuditEvent)({ action: 'logout', actor: user.username, actor_id: user.id, ip_address: ipAddress });
    }
    const response = server_1.NextResponse.json({ ok: true });
    const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
    const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
    response.cookies.set(cookieName, '', Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: 0, isSecureRequest })));
    return response;
}
