"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PATCH = PATCH;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const password_1 = require("@/lib/password");
const session_cookie_1 = require("@/lib/session-cookie");
const logger_1 = require("@/lib/logger");
async function GET(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const user = (0, auth_1.getUserFromRequest)(request);
    if (!user) {
        return server_1.NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return server_1.NextResponse.json({
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
}
/**
 * PATCH /api/auth/me - Self-service password change and display name update.
 * Body: { current_password, new_password } and/or { display_name }
 */
async function PATCH(request) {
    var _a, _b, _c;
    const user = (0, auth_1.getUserFromRequest)(request);
    if (!user) {
        return server_1.NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    // API key users (id=0) cannot change passwords
    if (user.id === 0) {
        return server_1.NextResponse.json({ error: 'API key users cannot change passwords' }, { status: 403 });
    }
    try {
        const { current_password, new_password, display_name } = await request.json();
        const updates = {};
        // Handle password change
        if (new_password) {
            if (!current_password) {
                return server_1.NextResponse.json({ error: 'Current password is required' }, { status: 400 });
            }
            if (new_password.length < 8) {
                return server_1.NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
            }
            // Verify current password by fetching stored hash
            const { getDatabase } = await Promise.resolve().then(() => __importStar(require('@/lib/db')));
            const db = getDatabase();
            const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
            if (!row || !(0, password_1.verifyPassword)(current_password, row.password_hash)) {
                return server_1.NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
            }
            updates.password = new_password;
        }
        // Handle display name update
        if (display_name !== undefined) {
            if (!display_name.trim()) {
                return server_1.NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 });
            }
            updates.display_name = display_name.trim();
        }
        if (Object.keys(updates).length === 0) {
            return server_1.NextResponse.json({ error: 'No updates provided' }, { status: 400 });
        }
        const updated = (0, auth_1.updateUser)(user.id, updates);
        if (!updated) {
            return server_1.NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;
        if (updates.password) {
            (0, db_1.logAuditEvent)({ action: 'password_change', actor: user.username, actor_id: user.id, ip_address: ipAddress });
            // Revoke all existing sessions and issue a fresh one for this request
            (0, auth_1.destroyAllUserSessions)(user.id);
        }
        if (updates.display_name) {
            (0, db_1.logAuditEvent)({ action: 'profile_update', actor: user.username, actor_id: user.id, detail: { display_name: updates.display_name }, ip_address: ipAddress });
        }
        const response = server_1.NextResponse.json({
            success: true,
            user: {
                id: updated.id,
                username: updated.username,
                display_name: updated.display_name,
                role: updated.role,
                provider: updated.provider || 'local',
                email: updated.email || null,
                avatar_url: updated.avatar_url || null,
                workspace_id: (_a = updated.workspace_id) !== null && _a !== void 0 ? _a : 1,
                tenant_id: (_b = updated.tenant_id) !== null && _b !== void 0 ? _b : 1,
            },
        });
        // Issue a fresh session cookie after password change (old ones were just revoked)
        if (updates.password) {
            const { token, expiresAt } = (0, auth_1.createSession)(user.id, ipAddress, userAgent, (_c = user.workspace_id) !== null && _c !== void 0 ? _c : 1);
            const isSecureRequest = (0, session_cookie_1.isRequestSecure)(request);
            const cookieName = (0, session_cookie_1.getMcSessionCookieName)(isSecureRequest);
            response.cookies.set(cookieName, token, Object.assign({}, (0, session_cookie_1.getMcSessionCookieOptions)({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest })));
        }
        return response;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'PATCH /api/auth/me error');
        return server_1.NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
}
