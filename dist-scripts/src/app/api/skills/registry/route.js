"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const skill_registry_1 = require("@/lib/skill-registry");
const VALID_SOURCES = ['clawhub', 'skills-sh', 'awesome-openclaw'];
const VALID_TARGETS = ['user-agents', 'user-codex', 'project-agents', 'project-codex', 'openclaw', 'workspace'];
/**
 * GET /api/skills/registry?source=clawhub&q=terraform
 * Proxied search — server-side only, rate-limited.
 */
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const limited = (0, rate_limit_1.heavyLimiter)(request);
    if (limited)
        return limited;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const query = searchParams.get('q') || '';
    if (!source || !VALID_SOURCES.includes(source)) {
        return server_1.NextResponse.json({ error: `Invalid source. Use: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
    }
    if (!query.trim()) {
        return server_1.NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }
    const result = await (0, skill_registry_1.searchRegistry)(source, query.trim());
    return server_1.NextResponse.json(result);
}
/**
 * POST /api/skills/registry — Install skill from external registry.
 * Admin-only. Downloads, validates, security-scans, and writes to disk.
 */
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const limited = (0, rate_limit_1.heavyLimiter)(request);
    if (limited)
        return limited;
    const body = await request.json().catch(() => ({}));
    const { source, slug, targetRoot } = body;
    if (!source || !VALID_SOURCES.includes(source)) {
        return server_1.NextResponse.json({ error: `Invalid source. Use: ${VALID_SOURCES.join(', ')}` }, { status: 400 });
    }
    if (!slug || typeof slug !== 'string' || slug.length > 200) {
        return server_1.NextResponse.json({ error: 'Valid slug is required' }, { status: 400 });
    }
    if (!targetRoot || !VALID_TARGETS.includes(targetRoot)) {
        return server_1.NextResponse.json({ error: `Invalid targetRoot. Use: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
    }
    const result = await (0, skill_registry_1.installFromRegistry)({ source, slug, targetRoot });
    if (!result.ok) {
        return server_1.NextResponse.json(result, { status: 422 });
    }
    return server_1.NextResponse.json(result);
}
/**
 * PUT /api/skills/registry — Security-check content without installing.
 * Useful for preview/audit before install.
 */
async function PUT(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => ({}));
    const content = typeof (body === null || body === void 0 ? void 0 : body.content) === 'string' ? body.content : '';
    if (!content.trim()) {
        return server_1.NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }
    const report = (0, skill_registry_1.checkSkillSecurity)(content);
    return server_1.NextResponse.json({ security: report });
}
exports.dynamic = 'force-dynamic';
