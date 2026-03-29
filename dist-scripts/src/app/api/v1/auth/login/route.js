"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const auth_v1_1 = require("@/lib/auth-v1");
const rate_limit_1 = require("@/lib/rate-limit");
async function POST(request) {
    const rateCheck = (0, rate_limit_1.loginLimiter)(request);
    if (rateCheck)
        return rateCheck;
    const body = await request.json().catch(() => ({}));
    const identifier = String((body === null || body === void 0 ? void 0 : body.username) || (body === null || body === void 0 ? void 0 : body.email) || '').trim();
    const password = String((body === null || body === void 0 ? void 0 : body.password) || '');
    if (!identifier || !password) {
        return server_1.NextResponse.json({ error: 'Username/email and password are required' }, { status: 400 });
    }
    const user = (0, auth_1.authenticateUser)(identifier, password);
    if (!user) {
        return server_1.NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    const { token, expiresAt } = (0, auth_v1_1.issueSessionForUser)(user, request);
    const response = server_1.NextResponse.json((0, auth_v1_1.buildAuthPayload)(user));
    (0, auth_v1_1.applySessionCookie)(response, request, token, expiresAt);
    return response;
}
