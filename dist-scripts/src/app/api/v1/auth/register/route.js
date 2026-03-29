"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_v1_1 = require("@/lib/auth-v1");
const logger_1 = require("@/lib/logger");
async function POST(request) {
    var _a;
    try {
        const body = await request.json().catch(() => ({}));
        const username = String((body === null || body === void 0 ? void 0 : body.username) || '').trim();
        const password = String((body === null || body === void 0 ? void 0 : body.password) || '');
        const displayName = String((body === null || body === void 0 ? void 0 : body.display_name) || (body === null || body === void 0 ? void 0 : body.displayName) || username).trim();
        const email = (body === null || body === void 0 ? void 0 : body.email) ? String(body.email).trim().toLowerCase() : null;
        if (!username || !password || !displayName) {
            return server_1.NextResponse.json({ error: 'username, password, and display_name are required' }, { status: 400 });
        }
        const user = (0, auth_v1_1.registerUserWithTenant)({
            username,
            password,
            displayName,
            email,
            inviteToken: (body === null || body === void 0 ? void 0 : body.invite_token) ? String(body.invite_token) : null,
            tenantName: (body === null || body === void 0 ? void 0 : body.tenant_name) ? String(body.tenant_name) : null,
            tenantSlug: (body === null || body === void 0 ? void 0 : body.tenant_slug) ? String(body.tenant_slug) : null,
            workspaceName: (body === null || body === void 0 ? void 0 : body.workspace_name) ? String(body.workspace_name) : null,
        });
        const { token, expiresAt } = (0, auth_v1_1.issueSessionForUser)(user, request);
        const response = server_1.NextResponse.json((0, auth_v1_1.buildAuthPayload)(user), { status: 201 });
        (0, auth_v1_1.applySessionCookie)(response, request, token, expiresAt);
        return response;
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'POST /api/v1/auth/register error');
        const message = ((_a = error === null || error === void 0 ? void 0 : error.message) === null || _a === void 0 ? void 0 : _a.includes('UNIQUE constraint failed'))
            ? 'Username or email already exists'
            : (error === null || error === void 0 ? void 0 : error.message) || 'Failed to register account';
        const status = /exists|invalid|expired|required|match/i.test(message) ? 400 : 500;
        return server_1.NextResponse.json({ error: message }, { status });
    }
}
