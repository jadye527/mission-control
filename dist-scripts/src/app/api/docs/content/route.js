"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const rate_limit_1 = require("@/lib/rate-limit");
const logger_1 = require("@/lib/logger");
const docs_knowledge_1 = require("@/lib/docs-knowledge");
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    const rateCheck = (0, rate_limit_1.readLimiter)(request);
    if (rateCheck)
        return rateCheck;
    try {
        const { searchParams } = new URL(request.url);
        const path = (searchParams.get('path') || '').trim();
        if (!path) {
            return server_1.NextResponse.json({ error: 'Path required' }, { status: 400 });
        }
        try {
            const doc = await (0, docs_knowledge_1.readDocsContent)(path);
            return server_1.NextResponse.json(doc);
        }
        catch (error) {
            const message = error.message || '';
            if (message.includes('Path not allowed')) {
                return server_1.NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
            }
            if (message.includes('not configured')) {
                return server_1.NextResponse.json({ error: 'Docs directory not configured' }, { status: 500 });
            }
            return server_1.NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'GET /api/docs/content error');
        return server_1.NextResponse.json({ error: 'Failed to load doc content' }, { status: 500 });
    }
}
