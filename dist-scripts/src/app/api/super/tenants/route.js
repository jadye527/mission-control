"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const super_admin_1 = require("@/lib/super-admin");
/**
 * GET /api/super/tenants - List tenants and latest provisioning status
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    return server_1.NextResponse.json({ tenants: (0, super_admin_1.listTenants)() });
}
/**
 * POST /api/super/tenants - Create tenant and queue bootstrap job
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json();
        const created = (0, super_admin_1.createTenantAndBootstrapJob)(body, auth.user.username);
        return server_1.NextResponse.json(created, { status: 201 });
    }
    catch (error) {
        if (String((error === null || error === void 0 ? void 0 : error.message) || '').includes('UNIQUE')) {
            return server_1.NextResponse.json({ error: 'Tenant slug or linux user already exists' }, { status: 409 });
        }
        return server_1.NextResponse.json({ error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to create tenant bootstrap job' }, { status: 400 });
    }
}
