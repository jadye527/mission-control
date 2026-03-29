"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const db_2 = require("@/lib/db");
const session_cookie_1 = require("@/lib/session-cookie");
const logger_1 = require("@/lib/logger");
const INSECURE_PASSWORDS = new Set([
    'admin',
    'password',
    'change-me-on-first-login',
    'changeme',
    'testpass123',
]);
async function GET() {
    return server_1.NextResponse.json({ needsSetup: (0, db_1.needsFirstTimeSetup)() });
}
async function POST(request) {
    try {
        // Only allow setup when no users exist
        if (!(0, db_1.needsFirstTimeSetup)()) {
            return server_1.NextResponse.json({ error: 'Setup has already been completed' }, { status: 403 });
        }
        const body = await request.json();
        const { username, password, displayName } = body;
        // Validate username
        if (!username || typeof username !== 'string') {
            return server_1.NextResponse.json({ error: 'Username is required' }, { status: 400 });
        }
        const trimmedUsername = username.trim().toLowerCase();
        if (trimmedUsername.length < 2 || trimmedUsername.length > 64) {
            return server_1.NextResponse.json({ error: 'Username must be 2-64 characters' }, { status: 400 });
        }
        if (!/^[a-z0-9_.-]+$/.test(trimmedUsername)) {
            return server_1.NextResponse.json({ error: 'Username can only contain lowercase letters, numbers, dots, hyphens, and underscores' }, { status: 400 });
        }
        // Validate password
        if (!password || typeof password !== 'string') {
            return server_1.NextResponse.json({ error: 'Password is required' }, { status: 400 });
        }
        if (password.length < 12) {
            return server_1.NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 });
        }
        if (INSECURE_PASSWORDS.has(password)) {
            return server_1.NextResponse.json({ error: 'That password is too common. Choose a stronger one.' }, { status: 400 });
        }
        // Double-check no users exist (race safety — createUser will also fail on duplicate username)
        if (!(0, db_1.needsFirstTimeSetup)()) {
            return server_1.NextResponse.json({ error: 'Another admin was created while you were setting up' }, { status: 409 });
        }
        const resolvedDisplayName = (displayName === null || displayName === void 0 ? void 0 : displayName.trim()) ||
            trimmedUsername.charAt(0).toUpperCase() + trimmedUsername.slice(1);
        const user = (0, auth_1.createUser)(trimmedUsername, password, resolvedDisplayName, 'admin');
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;
        (0, db_2.logAuditEvent)({
            action: 'setup_admin_created',
            actor: user.username,
            actor_id: user.id,
            ip_address: ipAddress,
            user_agent: userAgent,
        });
        logger_1.logger.info(`First-time setup: admin user "${user.username}" created`);
        // Auto-login: create session and set cookie
        const { token, expiresAt } = (0, auth_1.createSession)(user.id, ipAddress, userAgent, user.workspace_id);
        const response = server_1.NextResponse.json({
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                role: user.role,
            },
        });
        const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
        const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
        response.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest })));
        return response;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Setup error');
        return server_1.NextResponse.json({ error: 'Failed to create admin account' }, { status: 500 });
    }
}
