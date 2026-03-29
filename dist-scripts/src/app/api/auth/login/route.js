"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const session_cookie_1 = require("@/lib/session-cookie");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
async function POST(request) {
    var _a, _b;
    try {
        const rateCheck = (0, rate_limit_1.loginLimiter)(request);
        if (rateCheck)
            return rateCheck;
        const { username, password } = await request.json();
        if (!username || !password) {
            return server_1.NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
        }
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;
        const user = (0, auth_1.authenticateUser)(username, password);
        if (!user) {
            (0, db_1.logAuditEvent)({ action: 'login_failed', actor: username, ip_address: ipAddress, user_agent: userAgent });
            // When no users exist at all, give actionable feedback instead of "Invalid credentials"
            if ((0, db_1.needsFirstTimeSetup)()) {
                return server_1.NextResponse.json({
                    error: 'No admin account has been created yet',
                    code: 'NO_USERS',
                    hint: 'Visit /setup to create your admin account',
                }, { status: 401 });
            }
            return server_1.NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }
        const { token, expiresAt } = (0, auth_1.createSession)(user.id, ipAddress, userAgent, user.workspace_id);
        (0, db_1.logAuditEvent)({ action: 'login', actor: user.username, actor_id: user.id, ip_address: ipAddress, user_agent: userAgent });
        const response = server_1.NextResponse.json({
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                role: user.role,
                provider: user.provider || 'local',
                email: user.email || null,
                avatar_url: user.avatar_url || null,
                workspace_id: (_a = user.workspace_id) !== null && _a !== void 0 ? _a : 1,
                tenant_id: (_b = user.tenant_id) !== null && _b !== void 0 ? _b : 1,
            },
        });
        const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
        const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
        response.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest })));
        return response;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Login error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
