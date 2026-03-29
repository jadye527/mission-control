"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const session_cookie_1 = require("@/lib/session-cookie");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * POST /api/auth/signup
 * Public registration endpoint for the external MVP.
 * Creates a new org (tenant) + admin user + session in one transaction.
 *
 * Body: { email, password, org_name }
 * Returns: { user } + sets session cookie (7-day expiry via createSession).
 *
 * Password hashing: scrypt via hashPassword() in src/lib/password.ts
 * (equivalent security to bcrypt; algorithm is internal and can be swapped).
 */
async function POST(request) {
    var _a;
    try {
        const rateCheck = (0, rate_limit_1.loginLimiter)(request);
        if (rateCheck)
            return rateCheck;
        const body = await request.json();
        const { email, password, org_name } = body !== null && body !== void 0 ? body : {};
        if (!email || !password || !org_name) {
            return server_1.NextResponse.json({ error: 'email, password, and org_name are required' }, { status: 400 });
        }
        if (!EMAIL_RE.test(String(email))) {
            return server_1.NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
        }
        if (String(password).length < 12) {
            return server_1.NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 });
        }
        const db = (0, db_1.getDatabase)();
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;
        // Check email uniqueness
        const existing = db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(String(email));
        if (existing) {
            return server_1.NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
        }
        // Provision org (tenant) + default workspace + admin user in one transaction
        const result = db.transaction(() => {
            const slug = String(org_name)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 48) + '-' + Date.now().toString(36);
            // Create tenant (org)
            const tenantResult = db.prepare(`
        INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, created_by)
        VALUES (?, ?, ?, 'starter', 'active', '', '', 'signup')
      `).run(slug, String(org_name), slug);
            const tenantId = tenantResult.lastInsertRowid;
            // Create default workspace
            const wsResult = db.prepare(`
        INSERT INTO workspaces (slug, name, tenant_id)
        VALUES (?, ?, ?)
      `).run(slug, String(org_name), tenantId);
            const workspaceId = wsResult.lastInsertRowid;
            // Create admin user linked to this org
            const username = String(email).split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30);
            const user = (0, auth_1.createUser)(username, String(password), username, 'admin', {
                email: String(email),
                workspace_id: workspaceId,
                tenant_id: tenantId,
                is_default_membership: true,
            });
            return { user, tenantId, workspaceId };
        })();
        const { token, expiresAt } = (0, auth_1.createSession)(result.user.id, ipAddress, userAgent, result.workspaceId);
        (0, db_1.logAuditEvent)({
            action: 'signup',
            actor: result.user.username,
            actor_id: result.user.id,
            ip_address: ipAddress,
            user_agent: userAgent,
        });
        const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
        const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
        const response = server_1.NextResponse.json({
            user: {
                id: result.user.id,
                username: result.user.username,
                display_name: result.user.display_name,
                role: result.user.role,
                email: (_a = result.user.email) !== null && _a !== void 0 ? _a : null,
                workspace_id: result.workspaceId,
                tenant_id: result.tenantId,
            },
        }, { status: 201 });
        response.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest })));
        return response;
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('UNIQUE constraint')) {
            return server_1.NextResponse.json({ error: 'Username already taken — try a different email' }, { status: 409 });
        }
        logger_1.logger.error({ err: error }, 'Signup error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
